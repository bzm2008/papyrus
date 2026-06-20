import { composeSystemPrompt } from './agentPromptContext'
import { failAgentRun, finishAgentRun, startAgentRun, type AgentHarnessRunInput } from './agentHarness'
import { formatSkillPacksForPrompt } from './agentSkillPacks'
import { composeSkillPrompt } from './agentSkillLibrary'
import {
  agentProtocolInstruction,
  formatStructuredOutputForHandoff,
  parseStructuredAgentOutput,
  shouldEarlyStopAgentLoop,
  type StructuredAgentOutput,
} from './agentProtocolService'
import { composeWritingContext } from './contextComposer'
import {
  extractDraftText,
  inferPatchOperation,
  queueDocumentPatch,
  shouldCreateArticleFromPrompt,
  shouldCreateDocumentPatch,
} from './documentPatchService'
import {
  callOpenAICompatible,
  callOpenAICompatibleStream,
  canCallProvider,
  type ChatMessage,
} from './llmClient'
import { describeModelRouting, selectModelForRole } from './modelRouterService'
import { retrieveMentionContext } from './projectContext'
import {
  composeGoalExecutionPrompt,
  describeThinkingEffort,
  judgeSecretaryGoal,
} from './secretaryGoalService'
import {
  classifySecretaryTask,
  type SecretaryTaskClassification,
  type SecretaryTaskComplexity,
} from './secretaryTaskClassifier'
import { findSemanticCacheHit, rememberSemanticResult } from './semanticCacheService'
import {
  getEnabledStudioAgents,
  getStudioAgent,
  getStudioAgentCatalogForPrompt,
  routeStudioAgents,
  type AgentRoutingDecision,
} from './studioAgentLibrary'
import {
  buildOrUpdateStoryProject,
  commitChapter,
  createChapterBrief,
  reviewDraft,
  shouldUseStoryPipeline,
  type StoryBrief,
} from './storyEngine'
import { searchWeb } from './webSearchService'
import { composeWritingTaskPrompt } from './writingTaskTypes'
import {
  type AgentTodo,
  type DocumentPatchOperation,
  type FlowAgentId,
  type FlowThinkingEffort,
  type FlowTrace,
  type ImportedResource,
  type SecretaryPlanDraft,
  useAppStore,
} from '../stores/useAppStore'

export type AgentToolName = 'web_search' | 'project_context' | 'document_patch'

export type AgentRunPlan = {
  needsWebSearch: boolean
  subAgents: FlowAgentId[]
  toolCalls: Array<{
    name: AgentToolName
    reason: string
    query?: string
  }>
  writeIntent: boolean
  documentPatchOperation?: DocumentPatchOperation
  replyMode: 'conversation_only' | 'conversation_with_patch'
  conversationGoal: string
  routingRationale?: string
  taskComplexity?: SecretaryTaskComplexity
  taskType?: string
  classificationConfidence?: number
  maxAgentCount?: number
  earlyStopReason?: string
  semanticCacheHitId?: string
  modelRoutingSummary?: string[]
}

export type AgentRunResult = {
  response: string
  patchContent?: string
  sources?: FlowTrace['sources']
  streamedMessageId?: string
}

type AgentOutput = {
  agentId: FlowAgentId
  label: string
  content: string
  outputId?: string
  structured?: StructuredAgentOutput
  sources?: FlowTrace['sources']
}

type SendFlowMessageOptions = Partial<Omit<AgentHarnessRunInput, 'prompt' | 'mode'>> & {
  displayPrompt?: string
  approvedPlanId?: string
  thinkingEffort?: FlowThinkingEffort
  goalId?: string
  guidanceNotes?: string[]
  queuedInputId?: string
}

const sharedAgentRules = [
  'Papyrus 是文学创作工作站，目标是帮助用户完成真实写作工作。',
  '你可以使用联网搜索、项目上下文和文稿补丁工具。不要因为训练截止时间而拒绝实时问题；需要实时信息时应主动规划联网搜索。',
  '事实、推断、设定和建议必须分开。不要编造来源。',
  '只有当任务需要产出正文、续写、改写、插入、替换或用户明确要求写入文稿时，才生成文稿补丁。',
  '对话说明、来源说明、计划过程、工作室 Agent 结论不要写入文稿。',
  '始终遵守 STYLE.md、WORLD.md、用户负向记忆、导入资源和当前文稿上下文。',
].join('\n')

export async function sendFlowMessage(
  prompt: string,
  harnessInput: SendFlowMessageOptions = {},
) {
  const content = prompt.trim()
  const displayContent = (harnessInput.displayPrompt ?? content).trim()

  if (!content) {
    return
  }

  const store = useAppStore.getState()
  const provider = store.providerConfigs[store.activeProviderId]
  const thinkingEffort = harnessInput.thinkingEffort ?? store.flowThinkingEffort
  const activeGoal =
    harnessInput.goalId && store.activeSecretaryGoal?.id === harnessInput.goalId
      ? store.activeSecretaryGoal
      : undefined
  const guidanceNotes = [
    ...(harnessInput.guidanceNotes ?? []),
    ...store.queuedUserInputs
      .filter((input) => input.status === 'guidance')
      .slice(-6)
      .map((input) => input.content),
  ]
  const executionContent = activeGoal
    ? composeGoalExecutionPrompt(activeGoal, content, thinkingEffort, guidanceNotes)
    : composeExecutionControlPrompt(content, thinkingEffort, guidanceNotes)
  const run = startAgentRun({
    prompt: executionContent,
    mode: 'flow',
    source: harnessInput.source ?? 'local',
    remoteJobId: harnessInput.remoteJobId,
    remotePlatform: harnessInput.remotePlatform,
    remoteSenderId: harnessInput.remoteSenderId,
  })

  store.clearFlowRun()
  store.setActiveAgentRunId(run.id)
  store.addFlowMessage({ role: 'user', content: displayContent || content })
  if (guidanceNotes.length) {
    store.addFlowTrace({
      kind: 'memory',
      title: '本轮引导',
      detail: guidanceNotes.join('\n'),
      status: 'completed',
      agentId: 'writer',
      endedAt: Date.now(),
    })
  }
  store.setLlmRunState('running', '秘书长正在判断任务路径')

  try {
    const plan = await planAgentRun(executionContent)
    const result = await executeAgentRun(executionContent, plan)

    if (!result.streamedMessageId) {
      useAppStore.getState().addFlowMessage({
        role: 'assistant',
        agentId: 'writer',
        content: result.response,
      })
    }

    if (plan.writeIntent && result.patchContent) {
      queueDocumentPatch({
        operation: plan.documentPatchOperation ?? inferPatchOperation(executionContent),
        title: '秘书长生成正文补丁',
        content: result.patchContent,
        createArticle: shouldCreateArticleFromPrompt(executionContent),
        targetChatId: useAppStore.getState().activeChatId,
      })
    }

    finishAgentRun(run, {
      status: 'completed',
      response: result.response,
      patchContent: result.patchContent,
      summary: summarizeFlowRun(executionContent, plan, result),
    })

    if (activeGoal) {
      await runGoalJudgePass(activeGoal.id, result.response || result.patchContent || '', thinkingEffort)
    }

    useAppStore
      .getState()
      .setLlmRunState(
        'idle',
        canCallProvider(provider) ? '秘书长已完成本轮编排' : '使用本地保守编排完成',
      )
  } catch (error) {
    failAgentRun(run, error)
    useAppStore.getState().addFlowMessage({
      role: 'assistant',
      agentId: 'writer',
      content: `Agent 编排失败：${error instanceof Error ? error.message : '未知错误'}`,
    })
    useAppStore.getState().setLlmRunState('error', 'Agent 编排失败')
  }
}

export async function createSecretaryPlanDraft(
  request: string,
  executionPrompt = request,
): Promise<SecretaryPlanDraft | undefined> {
  const cleanRequest = request.trim()
  const cleanExecutionPrompt = executionPrompt.trim()

  if (!cleanRequest || !cleanExecutionPrompt) {
    return undefined
  }

  const store = useAppStore.getState()
  const classification = classifySecretaryTask(cleanExecutionPrompt)
  const plannerRouting = selectModelForRole('planning', { complexity: classification.complexity })
  const provider = plannerRouting.provider
  store.clearFlowRun()
  store.addFlowMessage({ role: 'user', content: cleanRequest })
  store.setLlmRunState('running', '正在生成规划')

  try {
    const planText = canCallProvider(provider)
      ? await callOpenAICompatible(provider, [
          {
            role: 'system',
            content: composeSystemPrompt(
              [
                sharedAgentRules,
                '你是 Papyrus 的 /plan 规划器，只输出可协商的执行规划，不要执行 Agent。',
                '风格像 Codex 的任务规划：清晰、可执行、便于用户修改。',
                '请用简短 Markdown 输出，包含目标、步骤和风险。',
                describeModelRouting(plannerRouting),
              ].join('\n'),
            ),
          },
          {
            role: 'user',
            content: [
              `用户请求：${cleanExecutionPrompt}`,
              `复杂度：${classification.complexity}`,
              `当前文稿摘要：${store.editorText.slice(0, 1200)}`,
              store.resources.length
                ? `可用资源：${store.resources.slice(0, 10).map((resource) => resource.name).join(' / ')}`
                : '',
              '只产生规划，不要写入正文或修改文稿。',
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ])
      : createFallbackSecretaryPlan(cleanExecutionPrompt)

    const draft = useAppStore.getState().setSecretaryPlanDraft({
      request: cleanRequest,
      executionPrompt: cleanExecutionPrompt,
      planText,
      feedback: [],
    })

    useAppStore.getState().addFlowMessage({
      role: 'assistant',
      agentId: 'writer',
      content: planText,
    })
    useAppStore.getState().setLlmRunState('idle', '规划已生成')
    return draft
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    useAppStore.getState().addFlowMessage({
      role: 'assistant',
      agentId: 'writer',
      content: `规划生成失败：${message}`,
    })
    useAppStore.getState().setLlmRunState('error', '规划生成失败')
    return undefined
  }
}

export async function reviseSecretaryPlanDraft(feedback: string) {
  const current = useAppStore.getState().secretaryPlanDraft

  if (!current) {
    return undefined
  }

  const cleanFeedback = feedback.trim()
  if (!cleanFeedback) {
    return current
  }

  const plannerRouting = selectModelForRole('planning', { complexity: 'standard' })
  const provider = plannerRouting.provider
  useAppStore.getState().setLlmRunState('running', '正在修订规划')

  try {
    const planText = canCallProvider(provider)
      ? await callOpenAICompatible(provider, [
          {
            role: 'system',
            content: [
              '你是 Papyrus /plan 规划器，根据用户反馈修订规划，只输出 Markdown。',
              describeModelRouting(plannerRouting),
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `原始请求：${current.executionPrompt}`,
              `当前规划：\n${current.planText}`,
              `用户反馈：${cleanFeedback}`,
              '请输出修订后的完整规划。',
            ].join('\n\n'),
          },
        ])
      : [current.planText, '', '反馈:', cleanFeedback].join('\n')

    useAppStore.getState().reviseSecretaryPlanDraft(cleanFeedback, { planText })
    const latestAssistant = [...useAppStore.getState().flowMessages]
      .reverse()
      .find((message) => message.role === 'assistant')

    if (latestAssistant) {
      useAppStore.getState().updateFlowMessage(latestAssistant.id, { content: planText })
    }

    useAppStore.getState().setLlmRunState('idle', '规划已修订')
    return useAppStore.getState().secretaryPlanDraft
  } catch (error) {
    useAppStore.getState().setLlmRunState('error', error instanceof Error ? error.message : '规划修订失败')
    return current
  }
}

async function runGoalJudgePass(
  goalId: string,
  stageResult: string,
  thinkingEffort: FlowThinkingEffort,
) {
  const goal = useAppStore.getState().activeSecretaryGoal

  if (!goal || goal.id !== goalId) {
    return
  }

  const judge = await judgeSecretaryGoal(goal, stageResult, thinkingEffort)
  useAppStore.getState().addGoalCheckpoint({
    goalId,
    title: '裁判检查',
    summary: judge.summary,
    judge,
  })

  if (judge.verdict === 'complete') {
    useAppStore.getState().updateSecretaryGoal(goalId, {
      status: 'completed',
      currentProgress: judge.summary,
    })
  } else if (judge.verdict === 'blocked') {
    useAppStore.getState().updateSecretaryGoal(goalId, {
      status: 'blocked',
      currentProgress: judge.nextStep || judge.summary,
    })
  } else if (judge.verdict === 'early_stop') {
    useAppStore.getState().updateSecretaryGoal(goalId, {
      status: 'active',
      currentProgress: judge.nextStep || judge.summary,
    })
  } else {
    useAppStore.getState().updateSecretaryGoal(goalId, {
      status: 'active',
      currentProgress: judge.nextStep || judge.summary,
    })
  }
}

function composeExecutionControlPrompt(
  content: string,
  thinkingEffort: FlowThinkingEffort,
  guidanceNotes: string[],
) {
  return [
    content,
    '',
    `【思考强度】${describeThinkingEffort(thinkingEffort)}`,
    guidanceNotes.length
      ? ['【用户运行中引导】', ...guidanceNotes.map((note, index) => `${index + 1}. ${note}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function planAgentRun(prompt: string): Promise<AgentRunPlan> {
  const store = useAppStore.getState()
  const classification = classifySecretaryTask(prompt, {
    activeGoal: Boolean(store.activeSecretaryGoal),
    writeIntent: shouldCreateDocumentPatch(prompt) || hasLongformIntent(prompt),
  })
  const plannerModel = selectModelForRole('planning', { complexity: classification.complexity })
  const provider = plannerModel.provider
  const reviewMode = store.flowReviewMode
  const agentCatalog = getStudioAgentCatalogForPrompt(
    store.customStudioAgents,
    store.disabledBuiltInStudioAgentIds,
  )

  if (canCallProvider(provider)) {
    const step = store.addAgentStep({
      type: 'plan',
      title: 'Plan agent run',
      status: 'running',
      details: [
        'Deciding tools, sub agents, document write intent, and web search needs.',
        `任务复杂度：${classification.complexity}（${Math.round(classification.confidence * 100)}%）`,
        describeModelRouting(plannerModel),
      ].join('\n'),
      isExpanded: true,
      agentId: 'writer',
    })
    const trace = store.addFlowTrace({
      kind: 'plan',
      title: '秘书长自主规划',
      detail: [
        '正在判断是否需要联网、工作室 Agent、项目上下文或文稿写入。',
        `复杂度：${classification.complexity}`,
        describeModelRouting(plannerModel),
      ].join('\n'),
      status: 'running',
      agentId: 'writer',
    })

    try {
      const rawPlan = await callOpenAICompatible(provider, [
        {
          role: 'system',
          content: composeSystemPrompt(
            [
              sharedAgentRules,
              '当前日期是 2026-06-20，时区 Asia/Shanghai。',
              '你只输出严格 JSON，不要 Markdown，不要解释。',
              '字段必须是：needsWebSearch, subAgents, toolCalls, writeIntent, documentPatchOperation, replyMode, conversationGoal。',
              '简单任务必须避免多 Agent 协作；标准任务最多 2 个执行 Agent；复杂任务最多 3 个主力 + 2 个审查/顾问。',
              '所有子 Agent 后续会按结构化协议输出，不要安排寒暄、复述背景或重复审查。',
              'subAgents 必须从下方启用的工作室 Agent id 中选择，不能调用已禁用或不存在的 Agent。',
              '先判断任务类别，再选择最多 3 个主力 Agent；如有必要再选择最多 2 个审查/顾问 Agent。复杂 /goal 可分阶段增加，但单阶段仍要克制。',
              '事实争议优先资料核查/研究类 Agent；表达争议优先文风师/出版编辑；结构争议优先结构编辑；平台策略争议优先对应平台运营专家；法律/政策/投资/财务风险必须加入合规或专业审查。',
              `启用的工作室 Agent：\n${agentCatalog}`,
              formatSkillPacksForPrompt(prompt),
              'toolCalls 中 name 只能是 web_search, project_context, document_patch。',
              '当任务涉及今天、最近、新闻、实时事实、外部材料、引用、来源、趋势、人物/公司/政策/产品变动、事实核验时，needsWebSearch 必须为 true，并添加 web_search toolCall。',
              '当任务只是解释、闲聊、建议或审查，不要写入文稿。只有正文创作、续写、润色替换、插入、补写、改写才 writeIntent=true。',
              '判断写入文稿的例子：用户说“写一段/续写/补完/模仿某种叙事写/生成中篇/写到文稿里/改写这一节”时 writeIntent=true；用户说“怎么看/有什么问题/解释一下/给建议/靠谱吗”时 writeIntent=false。',
              'writeIntent=true 时，对话里只需要一句说明，真正正文必须进入 DocumentPatch，不要把计划、来源、审查过程或工具轨迹写进正文。',
              reviewMode === 'auto'
                ? '当前是 自动执行：不要把澄清问题抛给用户。请基于已有上下文做合理假设，必要时自主规划调查、大纲、初稿、审核和再稿。'
                : '当前是人工审阅模式：可以更谨慎，但仍应先产出可审阅结果，而不是停在确认问题上。',
            ].join('\n'),
          ),
        },
        {
          role: 'user',
          content: [
            `用户请求：${prompt}`,
            `本地复杂度分类：${classification.complexity}`,
            `分类理由：${classification.reasons.join('；') || '无'}`,
            `建议 Agent 数量：${classification.suggestedAgentCount}`,
            `执行模式：${reviewMode === 'auto' ? '自动执行' : '人工审阅'}`,
            `当前文稿摘录：${store.editorText.slice(0, 1600)}`,
            `可用资源：${store.resources
              .slice(0, 12)
              .map((resource) => resource.name)
              .join(' / ')}`,
            '请给出执行计划 JSON。',
          ].join('\n\n'),
        },
      ])
      const plan = sanitizePlan(parseJsonPlan(rawPlan), prompt, classification, [describeModelRouting(plannerModel)])

      useAppStore.getState().updateFlowTrace(trace.id, {
        detail: formatPlanDetail(plan),
        status: 'completed',
        endedAt: Date.now(),
      })
      useAppStore.getState().updateAgentStep(step.id, {
        details: formatPlanDetail(plan),
        status: 'completed',
        endedAt: Date.now(),
      })

      return plan
    } catch (error) {
      useAppStore.getState().updateFlowTrace(trace.id, {
        detail: `模型规划失败，已切换到本地保守规划：${
          error instanceof Error ? error.message : '未知错误'
        }`,
        status: 'error',
        endedAt: Date.now(),
      })
      useAppStore.getState().updateAgentStep(step.id, {
        details: error instanceof Error ? error.message : 'Unknown planning error',
        status: 'error',
        endedAt: Date.now(),
      })
    }
  }

  const fallbackPlan = createFallbackPlan(prompt, classification, [describeModelRouting(plannerModel)])
  useAppStore.getState().addAgentStep({
    type: 'plan',
    title: 'Local fallback plan',
    status: 'completed',
    details: formatPlanDetail(fallbackPlan),
    isExpanded: false,
    agentId: 'writer',
    endedAt: Date.now(),
  })
  useAppStore.getState().addFlowTrace({
    kind: 'plan',
    title: '本地保守规划',
    detail: formatPlanDetail(fallbackPlan),
    status: 'completed',
    agentId: 'writer',
    endedAt: Date.now(),
  })

  return fallbackPlan
}

export async function executeAgentRun(prompt: string, plan: AgentRunPlan): Promise<AgentRunResult> {
  useAppStore.getState().setAgentTodos(createTodos(prompt, plan))
  const subAgentStepIds = new Map<FlowAgentId, string>()
  const storyBrief = shouldUseStoryPipeline(prompt, plan.writeIntent)
    ? runStoryPreparation(prompt)
    : undefined

  useAppStore
    .getState()
    .agentTodos.filter((todo) => todo.agentId !== 'writer' && todo.status !== 'completed')
    .forEach((todo) => {
      const step = useAppStore.getState().addAgentStep({
        type: 'sub_agent',
        title: todo.title,
        status: 'pending',
        details: todo.detail,
        isExpanded: false,
        agentId: todo.agentId,
      })
      subAgentStepIds.set(todo.agentId, step.id)
    })

  const semanticCacheHit = findSemanticCacheHit(prompt, plan.taskType ?? 'general')
  if (semanticCacheHit) {
    plan.semanticCacheHitId = semanticCacheHit.id
    useAppStore.getState().addFlowTrace({
      kind: 'tool',
      title: '命中语义缓存',
      detail: `复用本地缓存：${semanticCacheHit.summary.slice(0, 360)}`,
      status: 'completed',
      sources: semanticCacheHit.sources,
      agentId: firstEnabledAgent(['citation-checker', 'archivist']) ?? 'writer',
      toolName: 'project_context',
      endedAt: Date.now(),
    })
  }

  const sources = semanticCacheHit?.sources?.length ? semanticCacheHit.sources : await executeToolCalls(prompt, plan)
  const outputs: AgentOutput[] = []
  const structuredOutputs: StructuredAgentOutput[] = []

  for (const todo of useAppStore.getState().agentTodos) {
    if (todo.agentId === 'writer' || todo.status === 'completed') {
      continue
    }

    useAppStore.getState().updateAgentTodo(todo.id, { status: 'running' })
    const stepId = subAgentStepIds.get(todo.agentId)

    if (stepId) {
      useAppStore.getState().updateAgentStep(stepId, {
        status: 'running',
        details: todo.detail,
      })
    }

    try {
      const output = await runSubAgent(todo.agentId, prompt, plan, sources, stepId)
      outputs.push(output)
      if (output.structured) {
        structuredOutputs.push(output.structured)
        const earlyStop = shouldEarlyStopAgentLoop(structuredOutputs)

        if (earlyStop.stop) {
          plan.earlyStopReason = earlyStop.reason
          useAppStore.getState().addFlowTrace({
            kind: 'plan',
            title: '早停协作',
            detail: earlyStop.reason ?? '秘书长判断后续协作不会带来新增价值。',
            status: 'completed',
            agentId: 'writer',
            endedAt: Date.now(),
          })
        }
      }
      useAppStore.getState().updateAgentTodo(todo.id, { status: 'completed' })

      if (plan.earlyStopReason) {
        useAppStore
          .getState()
          .agentTodos.filter((item) => item.agentId !== 'writer' && item.status === 'pending')
          .forEach((item) => {
            useAppStore.getState().updateAgentTodo(item.id, {
              status: 'skipped',
              detail: plan.earlyStopReason,
            })
          })
        break
      }
    } catch (error) {
      useAppStore.getState().updateAgentTodo(todo.id, {
        status: 'blocked',
        detail: error instanceof Error ? error.message : '工作室 Agent 执行失败',
      })
    }
  }

  const writerTodo = useAppStore
    .getState()
    .agentTodos.find((todo) => todo.agentId === 'writer' && todo.status === 'pending')

  if (writerTodo) {
    useAppStore.getState().updateAgentTodo(writerTodo.id, { status: 'running' })
  }

  const assistantMessage = useAppStore.getState().addFlowMessage({
    role: 'assistant',
    agentId: 'writer',
    content: '秘书长开始整合结果…',
  })
  const updateStream = (text: string) => {
    const visibleText = plan.writeIntent ? visiblePatchConversationText(text) : text

    useAppStore.getState().updateFlowMessage(assistantMessage.id, {
      content: visibleText || '秘书长开始整合结果…',
    })
  }
  let writerText = await runWriter(prompt, plan, outputs, sources, updateStream, storyBrief)
  let patchContent = plan.writeIntent ? extractDraftText(writerText) : undefined

  if (plan.writeIntent && isInsufficientDraft(patchContent, prompt)) {
    writerText = await repairDraft(prompt, plan, outputs, sources, writerText, updateStream)
    patchContent = extractDraftText(writerText)
  }

  if (storyBrief && patchContent) {
    const reviewed = await runStoryReviewAndCommit(prompt, storyBrief, patchContent)
    patchContent = reviewed.patchContent
  }

  const response = plan.writeIntent ? stripDraftSection(writerText) : writerText
  if (plan.needsWebSearch || plan.toolCalls.some((toolCall) => toolCall.name === 'project_context')) {
    if (!semanticCacheHit) {
      rememberSemanticResult(prompt, plan.taskType ?? 'general', response || patchContent || writerText, sources)
    }
  }
  useAppStore.getState().updateFlowMessage(assistantMessage.id, {
    content: response.trim() || '已完成正文补丁，等待写入文稿。',
  })

  if (writerTodo) {
    useAppStore.getState().updateAgentTodo(writerTodo.id, { status: 'completed' })
  }

  return {
    response: response.trim() || '已完成正文补丁，等待写入文稿。',
    patchContent,
    sources,
    streamedMessageId: assistantMessage.id,
  }
}

function runStoryPreparation(prompt: string) {
  const prep = useAppStore.getState().addAgentStep({
    type: 'plan',
    title: '建立作品合同',
    status: 'running',
    details: '识别题材、作品目标、章节合同和审查闸门。',
    isExpanded: true,
    agentId: 'archivist',
  })
  const { project, genre } = buildOrUpdateStoryProject(prompt)
  const brief = createChapterBrief(prompt, project, genre)

  useAppStore.getState().updateAgentStep(prep.id, {
    status: 'completed',
    details: [
      `作品: ${project.title}`,
      `题材: ${project.genre}`,
      `章节: 第${brief.chapter.chapterNumber}章《${brief.chapter.title}》`,
      `任务书:\n${brief.briefText}`,
    ].join('\n'),
    endedAt: Date.now(),
  })

  return brief
}

async function runStoryReviewAndCommit(prompt: string, brief: StoryBrief, patchContent: string) {
  const reviewStep = useAppStore.getState().addAgentStep({
    type: 'sub_agent',
    title: '审查闸门: 多维 Reviewer',
    status: 'running',
    details: '检查设定、时间线、角色、逻辑、AI 味和节奏。',
    isExpanded: true,
    agentId: 'critic',
  })
  let issues = reviewDraft(patchContent, brief)

  useAppStore.getState().updateAgentStep(reviewStep.id, {
    status: 'completed',
    details: issues.length
      ? issues.map((item) => `${item.blocking ? '[阻断]' : '[建议]'} ${item.evidence} -> ${item.fixHint}`).join('\n')
      : '未发现阻断问题，可以进入提交链。',
    endedAt: Date.now(),
  })

  if (issues.some((item) => item.blocking)) {
    const repairStep = useAppStore.getState().addAgentStep({
      type: 'generation',
      title: '二稿修复',
      status: 'running',
      details: '初稿未过闸门，秘书长根据审查结果补写二稿。',
      isExpanded: true,
      agentId: 'writer',
    })
    const repairRouting = selectModelForRole('repair', { complexity: 'complex', writeIntent: true })
    const provider = repairRouting.provider

    if (canCallProvider(provider)) {
      const fixed = await callOpenAICompatible(provider, [
        {
          role: 'system',
          content:
            '你是 Papyrus 秘书长。请根据章节任务书和审查问题，直接输出修复后的正文，不要解释过程。',
        },
        {
          role: 'user',
          content: [
            `用户请求:\n${prompt}`,
            `章节任务书:\n${brief.briefText}`,
            `审查问题:\n${issues.map((item) => `${item.evidence}: ${item.fixHint}`).join('\n')}`,
            `模型路由:\n${describeModelRouting(repairRouting)}。${repairRouting.reason}`,
            `初稿:\n${patchContent}`,
          ].join('\n\n'),
        },
      ])
      patchContent = fixed.trim() || patchContent
      issues = reviewDraft(patchContent, brief)
      useAppStore.getState().updateAgentStep(repairStep.id, {
        status: 'completed',
        content: patchContent.slice(0, 1200),
        details: issues.some((item) => item.blocking)
          ? '二稿仍有阻断问题，将保留为 rejected commit，不写入长期事实。'
          : '二稿已通过阻断闸门。',
        endedAt: Date.now(),
      })
    } else {
      useAppStore.getState().updateAgentStep(repairStep.id, {
        status: 'completed',
        details: '当前模型不可用，保留原稿并记录 rejected commit。',
        endedAt: Date.now(),
      })
    }
  }

  const commitStep = useAppStore.getState().addAgentStep({
    type: 'tool',
    title: '章节提交与记忆投影',
    status: 'running',
    details: '抽取事件、人物状态、伏笔和摘要；accepted 后写入长期记忆。',
    isExpanded: true,
    agentId: 'archivist',
    toolName: 'chapter_commit',
  })
  const commit = commitChapter(patchContent, brief, issues)

  useAppStore.getState().updateAgentStep(commitStep.id, {
    status: 'completed',
    details: [
      `提交状态: ${commit.status}`,
      `字数: ${commit.wordCount}`,
      `节奏线: ${commit.dominantStrand}`,
      `摘要: ${commit.summary}`,
      commit.status === 'rejected' ? '阻断问题未写入长期事实。' : '事件、伏笔和摘要已进入作品记忆。',
    ].join('\n'),
    endedAt: Date.now(),
  })

  return { patchContent, commit }
}

function createTodos(
  prompt: string,
  plan: AgentRunPlan,
): Array<Omit<AgentTodo, 'id' | 'createdAt' | 'updatedAt'>> {
  const todos: Array<Omit<AgentTodo, 'id' | 'createdAt' | 'updatedAt'>> = [
    {
      title: '理解目标并制定路径',
      detail: plan.conversationGoal || prompt.slice(0, 180),
      status: 'completed',
      agentId: 'writer',
    },
  ]

  plan.toolCalls.forEach((toolCall) => {
    todos.push({
      title: `准备工具：${toolCall.name}`,
      detail: toolCall.reason || toolCall.query || '秘书长判断需要该工具。',
      status: 'completed',
      agentId: toolCall.name === 'web_search' ? firstEnabledAgent(['citation-checker', 'academic-historian']) ?? 'writer' : 'writer',
    })
  })

  plan.subAgents.forEach((agentId) => {
    const agent = getRuntimeAgent(agentId)
    todos.push({
      title: `调用${agent.shortName}`,
      detail: taskDetailForAgent(agentId),
      status: 'pending',
      agentId,
    })
  })

  todos.push({
    title: plan.writeIntent ? '秘书长整合并生成文稿补丁' : '秘书长整合并回复',
    detail: plan.writeIntent
      ? '只把正文内容放入 DocumentPatch，对话中保留简短说明和来源。'
      : '整合工具与工作室 Agent 结论，只在对话中回答。',
    status: 'pending',
    agentId: 'writer',
  })

  return todos
}

async function executeToolCalls(prompt: string, plan: AgentRunPlan) {
  const sources: NonNullable<FlowTrace['sources']> = []
  const webCalls = plan.toolCalls.filter((toolCall) => toolCall.name === 'web_search')
  const researchAgentId = firstEnabledAgent(['citation-checker', 'academic-historian', 'trend-researcher']) ?? 'writer'

  for (const toolCall of webCalls) {
    const query = toolCall.query?.trim() || buildSearchQuery(prompt, plan)
    const step = useAppStore.getState().addAgentStep({
      type: 'tool',
      title: 'Web search',
      status: 'running',
      details: `${toolCall.reason || 'Agent requested external evidence.'}\nQuery: ${query}`,
      isExpanded: true,
      agentId: researchAgentId,
      toolName: 'web_search',
    })
    const trace = useAppStore.getState().addFlowTrace({
      kind: 'tool',
      title: '正在联网搜索',
      detail: `${toolCall.reason || '秘书长判断需要外部资料'}\n查询：${query}`,
      status: 'running',
      agentId: researchAgentId,
      toolName: 'web_search',
    })

    try {
      const results = await searchWeb(query)
      const mapped = results.map((result) => ({
        title: result.title,
        url: result.url,
        excerpt: result.excerpt,
      }))
      sources.push(...mapped)
      useAppStore.getState().updateFlowTrace(trace.id, {
        detail: mapped.length ? `找到 ${mapped.length} 条来源。` : '搜索完成，但没有可用来源。',
        status: 'completed',
        sources: mapped,
        endedAt: Date.now(),
      })
      useAppStore.getState().updateAgentStep(step.id, {
        status: 'completed',
        details: mapped.length ? `Found ${mapped.length} sources.` : 'Search completed with no usable sources.',
        sources: mapped,
        endedAt: Date.now(),
      })
    } catch (error) {
      useAppStore.getState().updateFlowTrace(trace.id, {
        detail: error instanceof Error ? error.message : '联网搜索失败',
        status: 'error',
        endedAt: Date.now(),
      })
      useAppStore.getState().updateAgentStep(step.id, {
        status: 'error',
        details: error instanceof Error ? error.message : 'Web search failed',
        endedAt: Date.now(),
      })
    }
  }

  if (plan.toolCalls.some((toolCall) => toolCall.name === 'project_context')) {
    const detail = contextResources(useAppStore.getState().resources) || '当前没有已加入上下文的资源。'
    useAppStore.getState().addAgentStep({
      type: 'tool',
      title: 'Read project context',
      status: 'completed',
      details: detail.slice(0, 900),
      isExpanded: false,
      agentId: firstEnabledAgent(['archivist', 'citation-checker']) ?? 'writer',
      toolName: 'project_context',
      endedAt: Date.now(),
    })
    useAppStore.getState().addFlowTrace({
      kind: 'tool',
      title: '读取项目上下文',
      detail: detail.slice(0, 600),
      status: 'completed',
      agentId: firstEnabledAgent(['archivist', 'citation-checker']) ?? 'writer',
      toolName: 'project_context',
      endedAt: Date.now(),
    })
  }

  return dedupeSources(sources)
}

async function runSubAgent(
  agentId: FlowAgentId,
  prompt: string,
  plan: AgentRunPlan,
  sources: FlowTrace['sources'],
  existingStepId?: string,
): Promise<AgentOutput> {
  const profile = getRuntimeAgent(agentId)
  const stepId =
    existingStepId ??
    useAppStore.getState().addAgentStep({
      type: 'sub_agent',
      title: `调用 Agent：${profile.name}`,
      status: 'running',
      details: taskDetailForAgent(agentId),
      isExpanded: true,
      agentId,
    }).id
  const trace = useAppStore.getState().addFlowTrace({
    kind: 'agent',
    title: `调用 Agent：${profile.name}`,
    detail: taskDetailForAgent(agentId),
    status: 'running',
    agentId,
  })
  let content: string

  try {
    content = await callAgent(agentId, prompt, plan, sources)
  } catch (error) {
    useAppStore.getState().updateAgentStep(stepId, {
      status: 'error',
      details: error instanceof Error ? error.message : 'Sub agent failed',
      endedAt: Date.now(),
    })
    throw error
  }
  const structured = parseStructuredAgentOutput(content)
  const outputEntry = useAppStore.getState().putAgentOutputCache({
    agentRunId: useAppStore.getState().activeAgentRunId,
    agentId,
    outputType: getRuntimeAgent(agentId).outputType,
    summary: structured.summary,
    keyPoints: structured.keyPoints,
    risks: structured.risks,
    handoff: structured.handoff,
    confidence: structured.confidence,
    newInformation: structured.newInformation,
    rawLength: content.length,
  })
  const compactContent = formatStructuredOutputForHandoff(outputEntry.id, structured)

  useAppStore.getState().updateFlowTrace(trace.id, {
    detail: compactContent.slice(0, 420),
    status: 'completed',
    sources,
    endedAt: Date.now(),
  })
  useAppStore.getState().updateAgentStep(stepId, {
    status: 'completed',
    content: compactContent,
    sources,
    endedAt: Date.now(),
  })

  return {
    agentId,
    label: profile.name,
    content: compactContent,
    outputId: outputEntry.id,
    structured,
    sources,
  }
}

async function callAgent(
  agentId: FlowAgentId,
  prompt: string,
  plan: AgentRunPlan,
  sources?: FlowTrace['sources'],
) {
  const store = useAppStore.getState()
  const routing = selectModelForRole('agent', {
    complexity: plan.taskComplexity,
    writeIntent: plan.writeIntent,
  })
  const provider = routing.provider
  const profile = getRuntimeAgent(agentId)

  if (!canCallProvider(provider)) {
    return createMockAgentOutput(agentId, prompt, sources)
  }

  const system = composeSystemPrompt(
    [
      sharedAgentRules,
      profile.systemPrompt,
      agentProtocolInstruction(),
      profile.outputRules.length ? `输出规则：\n${profile.outputRules.map((rule) => `- ${rule}`).join('\n')}` : '',
      composeSkillPrompt(agentId, prompt),
    ]
      .filter(Boolean)
      .join('\n\n'),
  )

  return callOpenAICompatible(provider, [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        `秘书长计划：\n${JSON.stringify(plan, null, 2)}`,
        `模型路由：${describeModelRouting(routing)}。${routing.reason}`,
        composeWritingTaskPrompt(prompt),
        `用户任务：\n${prompt}`,
        sources?.length ? `联网来源：\n${formatSources(sources)}` : '',
        contextResources(store.resources),
        `当前文稿：\n${store.editorText.slice(0, 5000)}`,
        '只输出与你的专业角色相关的结构化结论、风险、素材或建议。不要写最终用户答复。',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ])
}

async function runWriter(
  prompt: string,
  plan: AgentRunPlan,
  outputs: AgentOutput[],
  sources?: FlowTrace['sources'],
  onText?: (text: string) => void,
  storyBrief?: StoryBrief,
) {
  const store = useAppStore.getState()
  const writerRouting = selectModelForRole('writer', {
    complexity: plan.taskComplexity,
    writeIntent: plan.writeIntent,
  })
  const provider = writerRouting.provider
  const reviewMode = store.flowReviewMode
  const step = useAppStore.getState().addAgentStep({
    type: 'generation',
    title: plan.writeIntent ? 'Generate manuscript patch' : 'Generate final reply',
    status: 'running',
    details: plan.writeIntent
      ? 'Streaming the manuscript-ready draft while keeping process notes out of the document.'
      : 'Streaming the concise conversation reply.',
    isExpanded: true,
    agentId: 'writer',
  })
  const trace = useAppStore.getState().addFlowTrace({
    kind: 'agent',
    title: '秘书长整合结果',
    detail: plan.writeIntent
      ? `整合工具、来源、项目上下文和工作室 Agent 结论，准备正文补丁。\n${describeModelRouting(writerRouting)}`
      : `整合工具、来源、项目上下文和工作室 Agent 结论，准备对话回复。\n${describeModelRouting(writerRouting)}`,
    status: 'running',
    agentId: 'writer',
  })

  const messages: ChatMessage[] = [
        {
          role: 'system',
          content: composeSystemPrompt(
            [
              sharedAgentRules,
              getRuntimeAgent('writer').systemPrompt,
              '整合工作室 Agent 结论时只使用其 summary/keyPoints/risks/handoff 和 outputId，不要复述完整上游内容。',
              composeSkillPrompt('writer', prompt),
            ]
              .filter(Boolean)
              .join('\n\n'),
          ),
        },
        {
          role: 'user',
          content: [
            `执行计划：\n${JSON.stringify(plan, null, 2)}`,
            `模型路由：${describeModelRouting(writerRouting)}。${writerRouting.reason}`,
            composeWritingTaskPrompt(prompt),
            store.compressedSummary ? `压缩摘要：\n${store.compressedSummary}` : '',
            store.mentionContextItems.length
              ? `@ 提及对象：\n${await retrieveMentionContext(store.mentionContextItems)}`
              : '',
            contextResources(store.resources),
            storyBrief ? `Story Contract / 写作任务书:\n${storyBrief.briefText}` : '',
            sources?.length ? `联网来源：\n${formatSources(sources)}` : '',
            outputs.length
              ? `工作室 Agent 结论：\n${outputs
                  .map((output) => `${output.label}${output.outputId ? ` (${output.outputId})` : ''}:\n${output.content}`)
                  .join('\n\n')}`
              : '',
            `当前文稿：\n${store.editorText.slice(0, 7000)}`,
            `近期对话：\n${formatRecentConversation()}`,
            `用户请求：\n${prompt}`,
            `执行模式：${reviewMode === 'auto' ? '自动执行' : '人工审阅'}`,
            reviewMode === 'auto'
              ? [
                  '自动执行硬性规则：',
                  '1. 不要以“我需要先说明/我需要你确认/在动笔之前”作为终点。',
                  '2. 不要向用户索要下一步确认；请用合理假设直接完成规划、调查、大纲、初稿、审核、再稿。',
                  '3. 复杂长文任务必须给出完整可用结果；篇幅受限时先输出一个完整章节或完整样章，并说明可继续扩展。',
                  '4. 如果用户要求模仿在世作者的具体笔法，不要逐字仿写其个人风格；改为使用相邻的通俗历史叙事特征，如清晰因果、口语化解释、章节悬念和克制幽默。',
                ].join('\n')
              : '人工审阅模式：可以提出风险和选择，但仍应给出可审阅的阶段成果。',
            plan.writeIntent
              ? '请严格输出两段：先用“答复:”给用户一句简洁说明；再用“正文:”输出唯一可写入文稿的正文内容。只有“正文:”后面的内容会进入文稿。不要把来源、解释、计划过程、工作室 Agent 结论或工具轨迹写进“正文”。'
              : '请只输出对话答复。不要包含“正文:”段落，不要生成文稿补丁。若使用了搜索来源，简洁列出来源链路。',
            sources?.length
              ? '已经提供联网来源，不要声称自己无法访问互联网。'
              : plan.needsWebSearch
                ? '搜索工具没有返回可用来源，请说明搜索失败或无结果，并基于已有上下文谨慎回答。'
                : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ]
  let streamedText = ''
  const response = canCallProvider(provider)
    ? await streamOrCall(provider, messages, (text) => {
        const delta = text.slice(streamedText.length)
        streamedText = text

        if (delta) {
          useAppStore.getState().appendAgentStepContent(step.id, delta)
        }

        onText?.(text)
      })
    : createMockWriterResponse(prompt, plan, outputs, sources)

  if (!streamedText) {
    useAppStore.getState().updateAgentStep(step.id, { content: response })
  }

  useAppStore.getState().updateFlowTrace(trace.id, {
    detail: response.slice(0, 420),
    status: 'completed',
    endedAt: Date.now(),
  })
  useAppStore.getState().updateAgentStep(step.id, {
    status: 'completed',
    endedAt: Date.now(),
  })

  return response
}

async function repairDraft(
  prompt: string,
  plan: AgentRunPlan,
  outputs: AgentOutput[],
  sources: FlowTrace['sources'],
  previousText: string,
  onText?: (text: string) => void,
) {
  const repairRouting = selectModelForRole('repair', {
    complexity: plan.taskComplexity,
    writeIntent: true,
  })
  const provider = repairRouting.provider
  const step = useAppStore.getState().addAgentStep({
    type: 'generation',
    title: 'Repair manuscript draft',
    status: 'running',
    details: 'Previous output looked too short or strategy-like, forcing a manuscript-ready rewrite.',
    isExpanded: true,
    agentId: 'writer',
  })
  const trace = useAppStore.getState().addFlowTrace({
    kind: 'agent',
    title: '秘书长补写正文',
    detail: `检测到上一次输出更像策略或过短，正在强制生成可写入文稿的正文。\n${describeModelRouting(repairRouting)}`,
    status: 'running',
    agentId: 'writer',
  })

  if (!canCallProvider(provider)) {
    const fallback = createMockWriterResponse(prompt, plan, outputs, sources)
    useAppStore.getState().updateAgentStep(step.id, {
      status: 'completed',
      content: fallback,
      endedAt: Date.now(),
    })
    useAppStore.getState().updateFlowTrace(trace.id, {
      detail: fallback.slice(0, 420),
      status: 'completed',
      endedAt: Date.now(),
    })
    return fallback
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: composeSystemPrompt(
        [
          sharedAgentRules,
          '你正在修复一次失败的长文输出。上一次只给了策略或内容过短，这次必须给出可直接进入文稿的正文。',
          '输出格式必须是：答复: 一句话说明。然后 正文: 后面给出完整正文。',
        ].join('\n'),
      ),
    },
    {
      role: 'user',
      content: [
        `用户请求：${prompt}`,
        `执行计划：\n${JSON.stringify(plan, null, 2)}`,
        outputs.length
          ? `工作室 Agent 结论：\n${outputs.map((output) => `${output.label}:\n${output.content}`).join('\n\n')}`
          : '',
        `模型路由：${describeModelRouting(repairRouting)}。${repairRouting.reason}`,
        sources?.length ? `来源：\n${formatSources(sources)}` : '',
        `上一次输出：\n${previousText}`,
        '请不要再总结策略。请直接写“正文:”，输出至少 1800 字的完整样章或完整第一节；如果用户要求中篇，先给出可继续扩展的第一大节。',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]
  let streamed = ''
  const response = await streamOrCall(provider, messages, (text) => {
    const delta = text.slice(streamed.length)
    streamed = text

    if (delta) {
      useAppStore.getState().appendAgentStepContent(step.id, delta)
    }
    onText?.(stripDraftSection(text) || '秘书长正在补写正文…')
  })

  useAppStore.getState().updateFlowTrace(trace.id, {
    detail: response.slice(0, 420),
    status: 'completed',
    endedAt: Date.now(),
  })
  useAppStore.getState().updateAgentStep(step.id, {
    status: 'completed',
    endedAt: Date.now(),
  })

  if (!streamed) {
    useAppStore.getState().updateAgentStep(step.id, { content: response })
    onText?.(stripDraftSection(response))
  }

  return response
}

function createFallbackSecretaryPlan(prompt: string) {
  const fallback = createFallbackPlan(prompt)

  return [
    '# 秘书执行规划',
    '',
    `目标：${fallback.conversationGoal}`,
    '',
    '步骤',
    '1. 梳理请求和当前文稿状态',
    fallback.needsWebSearch ? '2. 检索必要的外部资料' : '2. 核对已有上下文和约束',
    fallback.subAgents.length
      ? `3. 调度 ${fallback.subAgents.map((agentId) => getRuntimeAgent(agentId).shortName).join(' / ')} 协作处理`
      : '3. 由写作代理直接处理',
    fallback.writeIntent ? '4. 生成内容并自动写入文稿' : '4. 输出结果并保留执行轨迹',
    '',
    '确认这份规划后，秘书模式会开始自动执行。',
  ].join('\n')
}

function parseJsonPlan(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed

  return JSON.parse(jsonText) as Partial<AgentRunPlan>
}

async function streamOrCall(
  provider: Parameters<typeof callOpenAICompatible>[0],
  messages: ChatMessage[],
  onText?: (text: string) => void,
) {
  if (!onText) {
    return callOpenAICompatible(provider, messages)
  }

  let text = ''

  try {
    return await callOpenAICompatibleStream(provider, messages, {
      onToken: (token) => {
        text += token
        onText(text)
      },
    })
  } catch {
    const fallback = await callOpenAICompatible(provider, messages)
    onText(fallback)
    return fallback
  }
}

function isInsufficientDraft(draft: string | undefined, prompt: string) {
  if (!draft?.trim()) {
    return true
  }

  const normalized = draft.trim()
  const longform = hasLongformIntent(prompt)
  const tooShort = normalized.replace(/\s/g, '').length < (longform ? 900 : 160)
  const strategyLike =
    /执行策略|写作策略|创作策略|总结|大纲如下|我将|接下来|首先.*然后|建议先|可以从以下/i.test(
      normalized.slice(0, 500),
    ) && !/(正文|第一章|第一节|楔子|序章)/i.test(normalized.slice(0, 500))

  return tooShort || strategyLike
}

function sanitizePlan(
  input: Partial<AgentRunPlan>,
  prompt: string,
  classification = classifySecretaryTask(prompt),
  modelRoutingSummary: string[] = [],
): AgentRunPlan {
  const fallback = createFallbackPlan(prompt, classification, modelRoutingSummary)
  const routing = routeForPrompt(prompt)
  const routedAgents = [
    ...routing.primaryAgents,
    ...routing.reviewerAgents,
    ...routing.advisorAgents,
  ]
  const maxAgentCount = maxAgentsForClassification(classification)
  const subAgents = uniqueAgents(
    [...(input.subAgents ?? []), ...routedAgents, ...fallback.subAgents],
    maxAgentCount,
  )
  const toolCalls = normalizeToolCalls(input.toolCalls ?? [])
  const needsWebSearch = Boolean(input.needsWebSearch || toolCalls.some((call) => call.name === 'web_search'))
  const localWriteIntent = shouldCreateDocumentPatch(prompt) || hasLongformIntent(prompt)
  const writeIntent = Boolean(input.writeIntent ?? fallback.writeIntent) || localWriteIntent

  if (needsWebSearch && !toolCalls.some((call) => call.name === 'web_search')) {
    toolCalls.unshift({
      name: 'web_search',
      reason: '秘书长判断任务需要外部实时资料或事实核验。',
      query: buildSearchQuery(prompt, fallback),
    })
  }

  if (
    needsWebSearch &&
    !subAgents.some((agentId) => ['citation-checker', 'academic-historian', 'trend-researcher'].includes(agentId))
  ) {
    const researchAgent = firstEnabledAgent(['citation-checker', 'academic-historian', 'trend-researcher'])
    if (researchAgent) {
      subAgents.unshift(researchAgent)
    }
  }

  if (writeIntent && !toolCalls.some((call) => call.name === 'document_patch')) {
    toolCalls.push({
      name: 'document_patch',
      reason: '任务需要把正文写入或准备写入文稿。',
    })
  }

  if (shouldUseProjectContext(prompt, writeIntent) && !toolCalls.some((call) => call.name === 'project_context')) {
    toolCalls.push({
      name: 'project_context',
      reason: 'AI auto-reads imported project resources when useful.',
    })
  }

  if (shouldUseProjectContext(prompt, writeIntent) && !subAgents.includes('archivist')) {
    subAgents.push('archivist')
  }

  if (hasLongformIntent(prompt)) {
    ;[
      'draft-writer',
      'narrative-designer',
      'style-editor',
      'humanities-arguer',
      'proofreader',
    ].forEach((agentId) => {
      if (firstEnabledAgent([agentId]) && !subAgents.includes(agentId)) {
        subAgents.push(agentId)
      }
    })
  }

  return {
    needsWebSearch,
    subAgents,
    toolCalls,
    writeIntent,
    documentPatchOperation: normalizePatchOperation(input.documentPatchOperation, prompt),
    replyMode: writeIntent ? 'conversation_with_patch' : 'conversation_only',
    conversationGoal: input.conversationGoal?.trim() || fallback.conversationGoal,
    routingRationale: routing.rationale,
    taskComplexity: classification.complexity,
    taskType: classification.taskType,
    classificationConfidence: classification.confidence,
    maxAgentCount,
    modelRoutingSummary,
  }
}

function normalizeToolCalls(toolCalls: AgentRunPlan['toolCalls']) {
  const allowed = new Set<AgentToolName>(['web_search', 'project_context', 'document_patch'])
  const normalized: AgentRunPlan['toolCalls'] = []

  toolCalls.forEach((toolCall) => {
    if (!allowed.has(toolCall.name)) {
      return
    }

    if (normalized.some((existing) => existing.name === toolCall.name && existing.query === toolCall.query)) {
      return
    }

    normalized.push({
      name: toolCall.name,
      reason: toolCall.reason?.trim() || '秘书长判断需要该工具。',
      query: toolCall.query?.trim(),
    })
  })

  return normalized
}

function normalizePatchOperation(operation: unknown, prompt: string) {
  const allowed: DocumentPatchOperation[] = [
    'insert_at_cursor',
    'append_section',
    'replace_selection',
    'replace_document',
  ]

  return allowed.includes(operation as DocumentPatchOperation)
    ? (operation as DocumentPatchOperation)
    : inferPatchOperation(prompt)
}

function uniqueAgents(agents: FlowAgentId[], maxCount = 5) {
  const enabled = new Set(
    getEnabledStudioAgents(
      useAppStore.getState().customStudioAgents,
      useAppStore.getState().disabledBuiltInStudioAgentIds,
    ).map((agent) => agent.id),
  )

  return Array.from(new Set(agents.filter((agentId) => enabled.has(agentId) && agentId !== 'writer'))).slice(
    0,
    maxCount,
  )
}

function createFallbackPlan(
  prompt: string,
  classification = classifySecretaryTask(prompt),
  modelRoutingSummary: string[] = [],
): AgentRunPlan {
  const routing = routeForPrompt(prompt)
  const subAgents = new Set<FlowAgentId>([
    ...routing.primaryAgents,
    ...routing.reviewerAgents,
    ...routing.advisorAgents,
  ])
  const toolCalls: AgentRunPlan['toolCalls'] = []
  const needsWebSearch = hasRealtimeOrExternalIntent(prompt)
  const writeIntent = shouldCreateDocumentPatch(prompt) || hasLongformIntent(prompt)
  const complexLongform = hasLongformIntent(prompt)

  if (needsWebSearch) {
    addFirstEnabled(subAgents, ['citation-checker', 'academic-historian', 'trend-researcher'])
    toolCalls.push({
      name: 'web_search',
      reason: '请求可能涉及实时信息、外部事实或来源核验。',
      query: buildSearchQuery(prompt),
    })
  }

  if (complexLongform) {
    addFirstEnabled(subAgents, ['draft-writer'])
    addFirstEnabled(subAgents, ['narrative-designer', 'structure-editor'])
    addFirstEnabled(subAgents, ['style-editor'])
    addFirstEnabled(subAgents, ['humanities-arguer'])
    addFirstEnabled(subAgents, ['proofreader'])
  }

  if (hasCritiqueIntent(prompt)) {
    addFirstEnabled(subAgents, ['humanities-arguer', 'citation-checker'])
  }

  if (hasStoryIntent(prompt)) {
    addFirstEnabled(subAgents, ['narrative-designer', 'dialogue-specialist', 'structure-editor'])
  }

  if (writeIntent || hasStyleIntent(prompt)) {
    addFirstEnabled(subAgents, ['draft-writer', 'style-editor'])
  }

  if (hasProofreadIntent(prompt)) {
    addFirstEnabled(subAgents, ['proofreader'])
  }

  if (hasProjectIntent(prompt)) {
    subAgents.add('archivist')
    toolCalls.push({
      name: 'project_context',
      reason: '请求需要读取项目文件、资源、人物卡或长期记忆。',
    })
  }

  if (shouldUseProjectContext(prompt, writeIntent) && !toolCalls.some((call) => call.name === 'project_context')) {
    subAgents.add('archivist')
    toolCalls.push({
      name: 'project_context',
      reason: 'AI auto-reads imported project resources when useful.',
    })
  }

  if (writeIntent) {
    toolCalls.push({
      name: 'document_patch',
      reason: '请求需要生成可写入文稿的正文补丁。',
    })
  }

  const maxAgentCount = maxAgentsForClassification(classification)

  return {
    needsWebSearch,
    subAgents: uniqueAgents(Array.from(subAgents), maxAgentCount),
    toolCalls,
    writeIntent,
    documentPatchOperation: inferPatchOperation(prompt),
    replyMode: writeIntent ? 'conversation_with_patch' : 'conversation_only',
    conversationGoal: routing.rationale || (writeIntent ? '生成可写入文稿的正文' : '在对话中回答用户问题'),
    routingRationale: routing.rationale,
    taskComplexity: classification.complexity,
    taskType: classification.taskType,
    classificationConfidence: classification.confidence,
    maxAgentCount,
    modelRoutingSummary,
  }
}

function maxAgentsForClassification(classification: SecretaryTaskClassification) {
  if (classification.complexity === 'simple') {
    return Math.min(1, classification.suggestedAgentCount)
  }

  if (classification.complexity === 'standard') {
    return Math.min(2, classification.suggestedAgentCount)
  }

  return Math.min(5, classification.suggestedAgentCount || 5)
}

function hasRealtimeOrExternalIntent(prompt: string) {
  return /(今天|昨日|昨天|刚刚|最近|实时|当前|今年|新闻|消息|热搜|趋势|价格|政策|法规|版本|发布|更新|公司|人物|引用|来源|查证|核验|联网|搜索|latest|today|news|current|recent|source|verify)/i.test(
    prompt,
  )
}

function hasCritiqueIntent(prompt: string) {
  return /(反例|漏洞|批判|审查|逻辑|空话|论证|风险|缺陷|质疑|靠谱吗|counter|critic|risk)/i.test(prompt)
}

function hasStoryIntent(prompt: string) {
  return /(章节|故事|叙事|场景|人物|剧情|节奏|张力|大纲|对白|转场|plot|scene)/i.test(prompt)
}

function hasStyleIntent(prompt: string) {
  return /(文风|润色|语气|风格|句法|节奏|降噪|AIGC|统一|style|tone)/i.test(prompt)
}

function hasProofreadIntent(prompt: string) {
  return /(校对|错别字|病句|纠错|术语|重复|标点|清稿|proof)/i.test(prompt)
}

function shouldUseProjectContext(prompt: string, writeIntent: boolean) {
  return (
    hasUsableResources() &&
    (writeIntent || hasLongformIntent(prompt) || hasProjectIntent(prompt) || hasStoryIntent(prompt))
  )
}

function hasUsableResources() {
  return useAppStore.getState().resources.some((resource) => Boolean(resource.content?.trim()))
}

function hasProjectIntent(prompt: string) {
  return /(资源|文件|导入|设定|世界观|人物卡|记忆|摘要|档案|上下文|@|archive|context)/i.test(prompt)
}

function hasLongformIntent(prompt: string) {
  return /(完整|中篇|长篇|小说|历史|补全|补充完整|续写|成书|章节|大纲|初稿|再稿|全篇|完整结果|longform|novel)/i.test(
    prompt,
  )
}

function routeForPrompt(prompt: string): AgentRoutingDecision {
  const state = useAppStore.getState()
  return routeStudioAgents(prompt, {
    customAgents: state.customStudioAgents,
    disabledBuiltInIds: state.disabledBuiltInStudioAgentIds,
    allowMoreForGoal: Boolean(state.activeSecretaryGoal) || /\/goal|长篇|长期|连续|多章节/.test(prompt),
  })
}

function getRuntimeAgent(agentId: FlowAgentId) {
  const state = useAppStore.getState()
  return (
    getStudioAgent(agentId, state.customStudioAgents, state.disabledBuiltInStudioAgentIds) ??
    getStudioAgent('writer')
  )!
}

function firstEnabledAgent(ids: FlowAgentId[]) {
  const enabled = new Set(
    getEnabledStudioAgents(
      useAppStore.getState().customStudioAgents,
      useAppStore.getState().disabledBuiltInStudioAgentIds,
    ).map((agent) => agent.id),
  )

  return ids.find((id) => enabled.has(id))
}

function addFirstEnabled(target: Set<FlowAgentId>, ids: FlowAgentId[]) {
  const agentId = firstEnabledAgent(ids)
  if (agentId) {
    target.add(agentId)
  }
}

function buildSearchQuery(prompt: string, plan?: Pick<AgentRunPlan, 'conversationGoal'>) {
  const goal = plan?.conversationGoal?.trim()
  const query = goal && goal.length > 6 ? `${goal} ${prompt}` : prompt

  return query.replace(/\s+/g, ' ').slice(0, 180)
}

function formatPlanDetail(plan: AgentRunPlan) {
  return [
    `目标：${plan.conversationGoal}`,
    plan.taskComplexity
      ? `复杂度：${plan.taskComplexity} · 置信度 ${Math.round((plan.classificationConfidence ?? 0) * 100)}% · 上限 ${plan.maxAgentCount ?? 5} 个 Agent`
      : '',
    plan.modelRoutingSummary?.length ? `模型：${plan.modelRoutingSummary.join('；')}` : '',
    `联网：${plan.needsWebSearch ? '需要' : '不需要'}`,
    `Agent：${plan.subAgents.map((agentId) => getRuntimeAgent(agentId).shortName).join(' / ') || '无'}`,
    plan.routingRationale ? `调度理由：${plan.routingRationale}` : '',
    plan.semanticCacheHitId ? `语义缓存：命中 ${plan.semanticCacheHitId}` : '',
    plan.earlyStopReason ? `早停：${plan.earlyStopReason}` : '',
    `工具：${plan.toolCalls.map((call) => call.name).join(' / ') || '无'}`,
    `写入文稿：${plan.writeIntent ? plan.documentPatchOperation : '否'}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function summarizeFlowRun(prompt: string, plan: AgentRunPlan, result: AgentRunResult) {
  return [
    `Prompt: ${prompt.slice(0, 220)}`,
    `Goal: ${plan.conversationGoal}`,
    `Mode: ${plan.writeIntent ? 'document_patch' : 'conversation'}`,
    result.sources?.length ? `Sources: ${result.sources.map((source) => source.title).slice(0, 4).join(' / ')}` : '',
    `Result: ${(result.response || result.patchContent || '').replace(/\s+/g, ' ').slice(0, 360)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function taskDetailForAgent(agentId: FlowAgentId) {
  const agent = getRuntimeAgent(agentId)
  return [
    agent.description,
    agent.taskTypes.length ? `适用任务：${agent.taskTypes.join('、')}` : '',
    agent.outputRules.length ? `输出规则：${agent.outputRules.join('；')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function contextResources(resources: ImportedResource[]) {
  const composed = composeWritingContext()
  if (composed.text.trim()) {
    return `统一写作上下文:\n${composed.text}`
  }

  const included = resources.filter((resource) => resource.content)

  if (!included.length) {
    return ''
  }

  return `已加入上下文的资源：\n${included
    .slice(0, 8)
    .map((resource) => `[${resource.name}]\n${resource.content.slice(0, 1200)}`)
    .join('\n\n')}`
}

function formatSources(sources: NonNullable<FlowTrace['sources']>) {
  return sources
    .map((source, index) => `${index + 1}. ${source.title}\n${source.url ?? ''}\n${source.excerpt ?? ''}`)
    .join('\n\n')
}

function dedupeSources(sources: NonNullable<FlowTrace['sources']>) {
  const seen = new Set<string>()

  return sources.filter((source) => {
    const key = source.url || source.title

    if (!key || seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function formatRecentConversation() {
  const messages = useAppStore.getState().flowMessages.slice(-8)

  return messages.map((message) => `${message.role}: ${message.content}`).join('\n')
}

function stripDraftSection(response: string) {
  const draftIndex = response.search(/(?:正文|成稿|写入文稿|Draft)\s*[:：]/i)

  if (draftIndex < 0) {
    return response.trim()
  }

  const beforeDraft = response.slice(0, draftIndex).replace(/答复\s*[:：]/i, '').trim()

  return beforeDraft || '正文已准备好，等待写入文稿。'
}

function visiblePatchConversationText(response: string) {
  if (/(?:正文|成稿|写入文稿|Draft)\s*[:：]/i.test(response)) {
    return stripDraftSection(response)
  }

  if (response.length > 220) {
    return '秘书长正在准备正文补丁，正文不会塞进对话框；完成后会按当前模式写入文稿或等待审阅。'
  }

  return response.trim()
}

function createMockAgentOutput(agentId: FlowAgentId, prompt: string, sources?: FlowTrace['sources']) {
  const profile = getRuntimeAgent(agentId)
  const sourceNote = sources?.length
    ? `\n可参考来源：${sources.map((source) => source.title).join('；')}`
    : ''

  return `${profile.name}已处理“${prompt.slice(0, 80)}”。\n${taskDetailForAgent(agentId)}${sourceNote}`
}

function createMockWriterResponse(
  prompt: string,
  plan: AgentRunPlan,
  outputs: AgentOutput[],
  sources?: FlowTrace['sources'],
) {
  const sourceNote = sources?.length
    ? `\n来源链路：\n${sources
        .slice(0, 5)
        .map((source, index) => `${index + 1}. ${source.title}${source.url ? ` - ${source.url}` : ''}`)
        .join('\n')}`
    : plan.needsWebSearch
      ? '\n搜索工具没有返回可用来源，我会基于已有上下文谨慎处理。'
      : ''

  return [
    `答复: 秘书长已完成本轮任务“${prompt}”。${outputs.length ? `已调度：${outputs.map((output) => output.label).join('、')}。` : ''}${sourceNote}`,
    plan.writeIntent
      ? '正文: 这是一段可直接放入文稿的工作稿。它先收束材料中的中心问题，再把判断推进到更清晰的位置，让语气保持克制，同时避免把来源说明和执行过程写进正文。'
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
