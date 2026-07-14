import type {
  AgentRunInput,
  AgentRunResult,
  UnifiedAgentIntent,
  WpsAgentTodo,
  WpsPlanDraft,
  WpsDocumentSnapshot,
  WpsPatchOperation,
} from '../types'
import { findSkillFromPrompt, inferSkillForPrompt } from '../skills'
import { createSelectionFingerprint } from './wpsDocumentBridge'
import {
  classifyWpsAgentError,
  readSseResponse,
  shouldFallbackToNonStream,
  WpsAgentError,
  type WpsAgentTransport,
} from './wpsAgentRuntime'

export { parseSseChunks, shouldFallbackToNonStream } from './wpsAgentRuntime'

const LLM_API = 'https://scallion.uno/api/papyrus/llm/chat'
const MODELS_API = 'https://scallion.uno/api/papyrus/llm/models'
const PRIMARY_MODEL = 'agnes-2.0-flash'
const FALLBACK_MODEL = 'agnes-2.0-flash'
const REQUEST_TIMEOUT_MS = 45000

type ScallionModelPayload =
  | Array<{
      id?: string
      modelName?: string
      model_name?: string
      name?: string
      available?: boolean
      enabled?: boolean
      plan_available?: boolean
      planAvailable?: boolean
      available_for_plan?: boolean
      availableForPlan?: boolean
      allowed?: boolean
    }>
  | {
      data?: Array<{
        id?: string
        modelName?: string
        model_name?: string
        name?: string
        available?: boolean
        enabled?: boolean
        plan_available?: boolean
        planAvailable?: boolean
        available_for_plan?: boolean
        availableForPlan?: boolean
        allowed?: boolean
      }>
      models?: Array<{
        id?: string
        modelName?: string
        model_name?: string
        name?: string
        available?: boolean
        enabled?: boolean
        plan_available?: boolean
        planAvailable?: boolean
        available_for_plan?: boolean
        availableForPlan?: boolean
        allowed?: boolean
      }>
    }

let modelListPromise: Promise<string[]> | undefined
let modelListToken: string | undefined

type LlmPayload = {
  choices?: Array<{
    message?: {
      content?: string
    }
    text?: string
  }>
  error?: {
    message?: string
    type?: string
    code?: string
  }
}

type WpsAgentPlan = {
  intent: UnifiedAgentIntent
  writeIntent: boolean
  operation: WpsPatchOperation
  agents: Array<'writer' | 'critic' | 'stylist' | 'proofreader' | 'researcher'>
  needsSelection: boolean
  goal: string
  cautions: string[]
}

type AgentJson = {
  reply?: string
  patch?: {
    title?: string
    content?: string
    operation?: WpsPatchOperation
  } | null
  checks?: string[]
}

type ValidationResult = {
  ok: boolean
  issues: string[]
}

export async function createWpsPlanDraft(input: {
  request: string
  snapshot: WpsDocumentSnapshot
  selectedSkill?: AgentRunInput['selectedSkill']
  token?: string
  previousPlan?: WpsPlanDraft
  feedback?: string
  signal?: AbortSignal
  model?: string
}): Promise<WpsPlanDraft> {
  const request = input.request.trim()

  if (!request) {
    throw new Error('请输入要规划的任务。')
  }

  const executionPrompt = input.previousPlan?.executionPrompt ?? request
  const now = Date.now()
  const local = localPlan(executionPrompt, input.snapshot)
  let planText = createLocalPlanText(executionPrompt, input.snapshot, local)

  if (input.token) {
    const system = [
      '你是 Papyrus WPS 插件的 /plan 规划器。',
      '只输出可协商的执行规划，不要执行写入，不要生成正文。',
      '风格接近 Codex：目标、步骤、风险、预期写入方式要清楚。',
      '输出简短 Markdown。',
    ].join('\n')
    const user = [
      '用户请求：' + executionPrompt,
      input.previousPlan ? '当前规划：\n' + input.previousPlan.planText : '',
      input.feedback ? '用户反馈：' + input.feedback : '',
      input.selectedSkill ? '选中技能：' + input.selectedSkill.name + '\n' + input.selectedSkill.systemHint : '',
      buildContext(input.snapshot),
    ].filter(Boolean).join('\n\n')

    planText = (await callScallion(input.token, input.model ?? PRIMARY_MODEL, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], 0.2, 1600, { signal: input.signal })).content
  }

  return {
    id: input.previousPlan?.id ?? createLocalId(),
    request,
    executionPrompt,
    planText,
    feedback: input.feedback ? [...(input.previousPlan?.feedback ?? []), input.feedback].slice(-6) : (input.previousPlan?.feedback ?? []),
    createdAt: input.previousPlan?.createdAt ?? now,
    updatedAt: now,
  }
}
export async function runUnifiedAgent(input: AgentRunInput): Promise<AgentRunResult> {
  if (!input.token) {
    throw new Error('请先登录 Scallion 后使用内置模型。')
  }

  const resolvedInput = {
    ...input,
    selectedSkill: findSkillFromPrompt(input.prompt) ?? input.selectedSkill ?? inferSkillForPrompt(input.prompt),
  }
  const trace: string[] = []
  const todos = createTodos(resolvedInput.prompt, resolvedInput.snapshot, resolvedInput.approvedPlan)
  const report = (status: string) => {
    trace.push(status)
    advanceTodos(todos, status)
    resolvedInput.onStatus?.(status)
    resolvedInput.onStage?.(status)
  }

  report('规划任务')
  let plan: WpsAgentPlan
  try {
      plan = await createPlan(resolvedInput)
  } catch (error) {
    throwIfAborted(resolvedInput.signal, error)
    plan = localPlan(resolvedInput.prompt, resolvedInput.snapshot)
  }
  const sanitizedPlan = sanitizePlan(plan, resolvedInput)

  if (sanitizedPlan.needsSelection && !resolvedInput.snapshot.selectionText.trim()) {
    return {
      reply: '请先在 WPS 文档中选中要处理的文字，然后再发给我。',
      intent: sanitizedPlan.intent,
      trace,
      todos,
    }
  }

  report('读取文档上下文')
  throwIfAborted(resolvedInput.signal)
  const context = buildContext(resolvedInput.snapshot)

  report('生成结果')
  const generated = await generateWithFallback(resolvedInput, sanitizedPlan, context)
  let parsed = parseAgentJson(generated.content)
  let validation = validateAgentJson(parsed, sanitizedPlan, resolvedInput.snapshot)

  if (!validation.ok) {
    report('校验并修复')
    let repaired = ''
    try {
      repaired = await repairOutput(resolvedInput, sanitizedPlan, context, parsed ?? {}, validation.issues)
    } catch (error) {
      throwIfAborted(resolvedInput.signal, error)
    }
    if (repaired) {
      parsed = parseAgentJson(repaired)
      validation = validateAgentJson(parsed, sanitizedPlan, resolvedInput.snapshot)
    }
  }

  if (!validation.ok) {
    report('输出协议异常')
    return {
      reply: sanitizedPlan.writeIntent ? '模型结果未通过写入校验，内容没有写入文档。请重试本次任务。' : generated.content,
      intent: sanitizedPlan.intent,
      trace,
      todos,
      checks: validation.issues,
      model: generated.model,
      transport: generated.transport,
      usedFallback: generated.usedFallback,
      recoverableError: '模型结果格式异常，请重试本次任务。',
    }
  }

  report('完成')
  const result = toRunResult(parsed ?? {}, sanitizedPlan, trace, resolvedInput.snapshot)
  return { ...result, todos, model: generated.model, transport: generated.transport, usedFallback: generated.usedFallback }
}


export function inferIntent(prompt: string, selectionText: string): UnifiedAgentIntent {
  const normalized = prompt.toLowerCase()
  const hasSelection = Boolean(selectionText.trim())

  if (/(审阅|诊断|检查|问题|评价|批改|review|comment|校对|纠错)/i.test(prompt)) {
    return 'review_document'
  }

  if (
    hasSelection &&
    /(润色|改写|缩写|扩写|降噪|纠错|替换|变成|改成|rewrite|polish|shorten|expand)/i.test(prompt)
  ) {
    return 'rewrite_selection'
  }

  if (/(写|续写|生成|起草|插入|追加|提纲|正文|段落|write|draft|continue|insert|append|outline)/i.test(prompt)) {
    return 'write_document'
  }

  if (normalized.includes('@润色') && hasSelection) {
    return 'rewrite_selection'
  }

  return 'answer_only'
}

async function createPlan(input: AgentRunInput): Promise<WpsAgentPlan> {
  const local = localPlan(input.prompt, input.snapshot)
  const system = [
    '你是 Papyrus WPS 插件的任务规划器。',
    '只输出严格 JSON，不要 Markdown，不要解释。',
    '字段：intent, writeIntent, operation, agents, needsSelection, goal, cautions。',
    'intent 只能是 answer_only, rewrite_selection, write_document, review_document。',
    'operation 只能是 replace_selection, insert_at_cursor, append_document, copy_only。',
    'agents 只能从 writer, critic, stylist, proofreader, researcher 中选择。',
    '只有用户明确要求写入、改写、续写、生成正文、替换选区、插入内容时 writeIntent 才为 true。',
    '审阅、解释、建议、评价默认不写入文档，除非用户明确要求给出可替换版本。',
  ].join('\n')
  const user = [
    `用户指令：${input.prompt}`,
    input.approvedPlan ? `已批准规划：\n${input.approvedPlan.planText}` : '',
    `当前是否有选区：${input.snapshot.selectionText.trim() ? '是' : '否'}`,
    `本地初判：${JSON.stringify(local)}`,
  ].join('\n')
  const raw = (await callScallion(input.token, input.model ?? PRIMARY_MODEL, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], 0.1, 900, { signal: input.signal })).content

  return { ...local, ...parseJsonObject(raw) } as WpsAgentPlan
}

function localPlan(prompt: string, snapshot: WpsDocumentSnapshot): WpsAgentPlan {
  const intent = inferIntent(prompt, snapshot.selectionText)
  const hasSelection = Boolean(snapshot.selectionText.trim())
  const writeIntent = intent === 'rewrite_selection' || intent === 'write_document'
  const operation: WpsPatchOperation =
    intent === 'rewrite_selection' && hasSelection
      ? 'replace_selection'
      : intent === 'write_document'
        ? 'insert_at_cursor'
        : 'copy_only'

  return {
    intent,
    writeIntent,
    operation,
    agents: inferAgents(prompt, intent),
    needsSelection: intent === 'rewrite_selection',
    goal: prompt.trim().slice(0, 160) || '处理当前写作任务',
    cautions: inferCautions(prompt, intent),
  }
}

function sanitizePlan(plan: WpsAgentPlan, input: AgentRunInput): WpsAgentPlan {
  const fallback = localPlan(input.prompt, input.snapshot)
  const intent = isIntent(plan.intent) ? plan.intent : fallback.intent
  const writeIntent =
    intent === 'review_document'
      ? false
      : intent === 'rewrite_selection' || intent === 'write_document'
      ? plan.writeIntent !== false
      : Boolean(plan.writeIntent && /改写|写入|替换|插入|生成|正文|rewrite|write/i.test(input.prompt))
  const operation = isPatchOperation(plan.operation) ? plan.operation : fallback.operation

  return {
    intent,
    writeIntent,
    operation: writeIntent ? operationForIntent(intent, operation, input.snapshot) : 'copy_only',
    agents: normalizeAgents(plan.agents?.length ? plan.agents : fallback.agents),
    needsSelection: intent === 'rewrite_selection',
    goal: safeString(plan.goal) || fallback.goal,
    cautions: Array.isArray(plan.cautions) ? plan.cautions.map(safeString).filter(Boolean).slice(0, 5) : fallback.cautions,
  }
}

async function generateWithFallback(
  input: AgentRunInput,
  plan: WpsAgentPlan,
  context: string,
) {
  const messages = buildGenerationMessages(input, plan, context)
  return callScallion(input.token, input.model ?? PRIMARY_MODEL, messages, 0.42, 4096, {
    stream: true,
    signal: input.signal,
    onDraft: input.onDraft,
    onRuntime: input.onRuntime,
  })
}

function buildGenerationMessages(input: AgentRunInput, plan: WpsAgentPlan, context: string) {
  const system = [
    '你是 Papyrus 的 WPS 写作 agent，不是普通聊天机器人。',
    '你会根据计划调用内部角色：主笔负责成稿，刺客负责找问题，文风师负责一致性，校对员负责病句错字，研究员负责提醒事实风险。',
    '必须把“给用户看的答复”和“可写入 WPS 的正文补丁”分开。',
    '只输出严格 JSON，不要 Markdown，不要代码块。',
    'JSON 结构：{"reply":"给用户看的简短答复","patch":{"title":"标题","content":"可写入正文","operation":"replace_selection|insert_at_cursor|append_document|copy_only"},"checks":["完成的检查"]}',
    '如果 writeIntent=false，patch 必须为 null。',
    '如果 writeIntent=true，patch.content 只能放可直接写入文档的正文，不要放解释、清单标题、工具过程或寒暄。',
    '不要编造来源。涉及实时事实、具体法规、价格、新闻时，如果没有可靠资料，只能标注待核实或建议用户提供材料。',
  ].join('\n')
  const user = [
    `计划：${JSON.stringify(plan)}`,
    input.approvedPlan ? `已批准规划：\n${input.approvedPlan.planText}` : '',
    input.selectedSkill ? `显式技能：${input.selectedSkill.name}\n${input.selectedSkill.systemHint}` : '',
    `用户指令：\n${input.prompt}`,
    context,
  ].filter(Boolean).join('\n\n')

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

async function repairOutput(
  input: AgentRunInput,
  plan: WpsAgentPlan,
  context: string,
  previous: AgentJson,
  issues: string[],
) {
  const system = [
    '你是 Papyrus WPS agent 的输出修复器。',
    '只输出符合协议的严格 JSON。',
    '保留用户意图，修复 reply/patch 的结构问题。',
  ].join('\n')
  const user = [
    `问题：${issues.join('；')}`,
    `计划：${JSON.stringify(plan)}`,
    `原输出：${JSON.stringify(previous)}`,
    `用户指令：${input.prompt}`,
    context,
  ].join('\n\n')

  return (await callScallion(input.token, input.model ?? FALLBACK_MODEL, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], 0.2, 2200, { signal: input.signal })).content
}

export async function callScallion(
  token: string | undefined,
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  temperature: number,
  maxTokens: number,
  options: { stream?: boolean; signal?: AbortSignal; onDraft?: (draft: string) => void; onRuntime?: AgentRunInput['onRuntime'] } = {},
  allowModelRecovery = true,
) {
  throwIfAborted(options.signal)
  const resolvedModel = await resolveScallionModel(token, model, options.signal)
  inputRuntime(options, resolvedModel, options.stream && supportsStreaming() ? 'stream' : 'non_stream', false)
  if (options.stream && supportsStreaming()) {
    let receivedToken = false
    try {
      const content = await requestScallion(token, resolvedModel, messages, temperature, maxTokens, true, options.signal, (draft) => {
        receivedToken = true
        options.onDraft?.(extractVisibleDraft(draft))
      })
      inputRuntime(options, resolvedModel, 'stream', false)
      return { content, model: resolvedModel, transport: 'stream' as const, usedFallback: false }
    } catch (error) {
      if (allowModelRecovery && isPlanModelForbidden(error)) {
        const nextModel = await recoverWpsModel(token, resolvedModel, options.signal)
        if (nextModel) {
          return callScallion(token, nextModel, messages, temperature, maxTokens, options, false)
        }
      }
      if (!shouldFallbackToNonStream(receivedToken, error)) {
        // Keep the structured error intact so the host can react to 401/403
        // responses (session expiry, plan refresh, or model recovery).
        throw classifyWpsAgentError(error)
      }
      const content = await requestScallion(token, resolvedModel, messages, temperature, maxTokens, false, options.signal)
      options.onDraft?.(extractVisibleDraft(content))
      inputRuntime(options, resolvedModel, 'non_stream', true)
      return { content, model: resolvedModel, transport: 'non_stream' as const, usedFallback: true }
    }
  }

  let content: string
  try {
    content = await requestScallion(token, resolvedModel, messages, temperature, maxTokens, false, options.signal)
  } catch (error) {
    if (allowModelRecovery && isPlanModelForbidden(error)) {
      const nextModel = await recoverWpsModel(token, resolvedModel, options.signal)
      if (nextModel) {
        return callScallion(token, nextModel, messages, temperature, maxTokens, options, false)
      }
    }
    throw classifyWpsAgentError(error)
  }
  inputRuntime(options, resolvedModel, 'non_stream', Boolean(options.stream))
  return { content, model: resolvedModel, transport: 'non_stream' as const, usedFallback: Boolean(options.stream) }
}

async function requestScallion(
  token: string | undefined,
  resolvedModel: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  temperature: number,
  maxTokens: number,
  stream: boolean,
  externalSignal?: AbortSignal,
  onDraft?: (draft: string) => void,
): Promise<string> {
  if (externalSignal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort()
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(LLM_API, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: resolvedModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream,
      }),
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as LlmPayload
      const error = new Error(payload.error?.message || `Scallion 模型请求失败: HTTP ${response.status}`) as Error & {
        code?: string
        status?: number
        retryable?: boolean
      }
      error.code = payload.error?.type ?? payload.error?.code
      error.status = response.status
      error.retryable = response.status >= 500 || response.status === 408 || response.status === 429
      throw error
    }

    if (stream) {
      return readSseResponse(response, { signal: controller.signal, onToken: onDraft })
    }

    const payload = (await response.json().catch(() => ({}))) as LlmPayload
    const content = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text

    if (!content?.trim()) {
      throw new Error('模型没有返回可用文本。')
    }

    return content.trim()
  } catch (error) {
    if (timedOut) {
      throw new Error('模型响应超时', { cause: error })
    }
    throw error
  } finally {
    window.clearTimeout(timer)
    externalSignal?.removeEventListener('abort', abortFromCaller)
  }
}

async function resolveScallionModel(token: string | undefined, preferredModel: string, signal?: AbortSignal) {
  try {
    const models = await raceWithAbort(getAvailableScallionModels(token), signal)
    if (!models.length) {
      throw new WpsAgentError('server', '当前套餐没有可用的 Scallion 模型。', false)
    }
    return models.find((model) => model === preferredModel) ?? models[0]
  } catch (error) {
    if (error instanceof WpsAgentError) {
      throw error
    }
    throw new WpsAgentError('network', '无法读取当前套餐模型目录，请刷新后重试。')
  }
}

async function getAvailableScallionModels(token: string | undefined) {
  if (!modelListPromise || modelListToken !== token) {
    modelListToken = token
    modelListPromise = fetchAvailableScallionModels(token).catch((error) => {
      modelListPromise = undefined
      modelListToken = undefined
      throw error
    })
  }

  return modelListPromise
}

async function recoverWpsModel(token: string | undefined, failedModel: string, signal?: AbortSignal) {
  modelListPromise = undefined
  modelListToken = undefined
  try {
    const models = await raceWithAbort(getAvailableScallionModels(token), signal)
    return models.find((model) => model !== failedModel) ?? undefined
  } catch {
    return undefined
  }
}

function isPlanModelForbidden(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'plan_model_forbidden')
}

async function fetchAvailableScallionModels(token: string | undefined) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 12000)
  let response: Response
  try {
    response = await fetch(`${MODELS_API}?include_unavailable=1`, { headers, signal: controller.signal })
  } catch (error) {
    throw new Error('模型列表请求超时或失败', { cause: error })
  } finally {
    window.clearTimeout(timer)
  }
  const payload = (await response.json().catch(() => ({}))) as ScallionModelPayload

  if (!response.ok) {
    throw new Error(`Scallion 模型列表请求失败: HTTP ${response.status}`)
  }

  const models = Array.isArray(payload) ? payload : payload.models ?? payload.data ?? []

  return models
    .filter((model) => {
      const planAvailable =
        model.plan_available ?? model.planAvailable ?? model.available_for_plan ?? model.availableForPlan ?? model.allowed ?? true
      return (model.available ?? model.enabled ?? true) && planAvailable
    })
    .map((model) => model.id || model.modelName || model.model_name || model.name || '')
    .filter(Boolean)
}

function buildContext(snapshot: WpsDocumentSnapshot) {
  return [
    snapshot.selectionText ? `当前选区：\n${snapshot.selectionText}` : '当前没有选区。',
    snapshot.documentExcerpt ? `文档上下文摘录：\n${snapshot.documentExcerpt}` : '',
    `估算字数：${snapshot.wordCount}`,
  ].filter(Boolean).join('\n\n')
}

function createTodos(prompt: string, snapshot: WpsDocumentSnapshot, approvedPlan?: WpsPlanDraft): WpsAgentTodo[] {
  const hasSelection = Boolean(snapshot.selectionText.trim())
  return [
    {
      id: 'plan',
      title: approvedPlan ? '执行已批准规划' : '判断任务路径',
      detail: approvedPlan?.planText.split('\n').find(Boolean) ?? prompt.slice(0, 72),
      status: 'pending',
    },
    {
      id: 'context',
      title: hasSelection ? '读取选区' : '读取文档上下文',
      detail: hasSelection ? `${snapshot.selectionText.length} 字选区` : `${snapshot.wordCount} 字上下文`,
      status: 'pending',
    },
    {
      id: 'generate',
      title: '生成结果',
      detail: '调用 Papyrus WPS agent 并按技能规则整理输出',
      status: 'pending',
    },
    {
      id: 'validate',
      title: '校验可写入内容',
      detail: '分离回复和 WPS 文稿补丁，必要时修复 JSON 输出',
      status: 'pending',
    },
  ]
}

function advanceTodos(todos: WpsAgentTodo[], status: string) {
  const current = status.includes('规划') ? 'plan'
    : status.includes('读取') ? 'context'
      : status.includes('生成') ? 'generate'
        : status.includes('校验') || status.includes('修复') ? 'validate'
          : status.includes('完成') ? 'done'
            : undefined

  if (!current) {
    return
  }

  for (const todo of todos) {
    if (current === 'done') {
      todo.status = todo.status === 'blocked' ? 'blocked' : 'completed'
    } else if (todo.id === current) {
      todo.status = 'running'
    } else if (todo.status === 'running') {
      todo.status = 'completed'
    }
  }
}

function createLocalPlanText(prompt: string, snapshot: WpsDocumentSnapshot, plan: WpsAgentPlan) {
  const agents = plan.agents.join(' / ')
  return [
    '# WPS 秘书规划',
    '',
    `目标：${plan.goal || prompt}`,
    '',
    '步骤',
    `1. 读取${snapshot.selectionText.trim() ? '当前选区' : '文档上下文'}并确认写入边界。`,
    `2. 调度 ${agents || 'writer'} 处理任务。`,
    plan.writeIntent ? `3. 生成可写入 WPS 的正文补丁，建议操作：${plan.operation}。` : '3. 只生成答复，不修改 WPS 文档。',
    '4. 校验输出，确保回复和文稿内容分离。',
    '',
    '风险',
    plan.cautions.length ? plan.cautions.map((item) => `- ${item}`).join('\n') : '- 没有外部资料时，不编造实时事实或来源。',
  ].join('\n')
}

function createLocalId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
function parseAgentJson(raw: string): AgentJson | undefined {
  const parsed = parseJsonObject(raw)

  if (!parsed) {
    return undefined
  }

  const output = parsed as AgentJson
  const patch = output.patch && typeof output.patch === 'object'
    ? {
        ...output.patch,
        content: cleanPatchContent(safeString(output.patch.content)),
      }
    : output.patch

  return {
    ...output,
    patch,
    checks: Array.isArray(output.checks) ? output.checks.map(safeString).filter(Boolean).slice(0, 8) : [],
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(raw.trim()) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function validateAgentJson(output: AgentJson | undefined, plan: WpsAgentPlan, snapshot: WpsDocumentSnapshot): ValidationResult {
  const issues: string[] = []
  if (!output) {
    return { ok: false, issues: ['模型没有返回完整 JSON'] }
  }
  const reply = safeString(output.reply)

  if (!reply) {
    issues.push('缺少 reply')
  }

  if (!plan.writeIntent) {
    if (output.patch && safeString(output.patch.content)) {
      issues.push('非写入任务不应返回 patch')
    }
    return { ok: issues.length === 0, issues }
  }

  const patch = output.patch
  const content = safeString(patch?.content)

  if (!patch) {
    issues.push('写入任务缺少 patch')
  }

  if (!content || content.length < 2) {
    issues.push('patch.content 为空')
  }

  if (/```|^正文[:：]/m.test(content)) {
    issues.push('patch.content 包含代码块或正文标签')
  }

  if (plan.intent === 'rewrite_selection' && snapshot.selectionText.trim() && content.trim() === snapshot.selectionText.trim()) {
    issues.push('改写结果与原选区完全相同')
  }

  if (patch?.operation && !isPatchOperation(patch.operation)) {
    issues.push('patch.operation 非法')
  }

  return { ok: issues.length === 0, issues }
}

function toRunResult(output: AgentJson, plan: WpsAgentPlan, trace: string[], snapshot: WpsDocumentSnapshot): AgentRunResult {
  const reply = safeString(output.reply) || (plan.writeIntent ? '已完成。' : '我处理完了。')
  const patchContent = safeString(output.patch?.content)
  const operation = isPatchOperation(output.patch?.operation) ? output.patch.operation : plan.operation

  if (!plan.writeIntent || !patchContent) {
    return {
      reply,
      intent: plan.intent,
      trace,
      checks: output.checks,
    }
  }

  return {
    reply,
    intent: plan.intent,
    trace,
    patch: {
      title: safeString(output.patch?.title) || patchTitle(plan.intent),
      content: cleanPatchContent(patchContent),
      recommendedOperation: operation,
      sourceSelectionFingerprint: createSelectionFingerprint(snapshot.selectionText),
      sourceContextSummary: sourceContextSummary(snapshot),
    },
    checks: output.checks,
  }
}

function cleanPatchContent(value: string) {
  return value
    .replace(/^```(?:text|markdown|md)?/i, '')
    .replace(/```$/i, '')
    .replace(/^正文\s*[:：]\s*/i, '')
    .trim()
}

function sourceContextSummary(snapshot: WpsDocumentSnapshot) {
  const source = snapshot.selectionText || snapshot.documentExcerpt
  return source.replace(/\s+/g, ' ').trim().slice(0, 160)
}

function supportsStreaming() {
  return typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined' && typeof AbortController !== 'undefined'
}

function extractVisibleDraft(raw: string) {
  const reply = extractJsonString(raw, 'reply')
  if (reply) {
    return reply
  }

  const patch = raw.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)/)
  if (patch?.[1]) {
    return decodeJsonString(patch[1])
  }

  return '正在生成可写入文稿...'
}

function extractJsonString(raw: string, key: string) {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`))
  return match?.[1] ? decodeJsonString(match[1]) : ''
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    return value.replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
}

function throwIfAborted(signal?: AbortSignal, error?: unknown) {
  if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
    throw error instanceof Error ? error : new DOMException('Aborted', 'AbortError')
  }
}

function inputRuntime(
  options: { onRuntime?: AgentRunInput['onRuntime'] },
  model: string,
  transport: WpsAgentTransport,
  usedFallback: boolean,
) {
  options.onRuntime?.({ model, transport, usedFallback })
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

function operationForIntent(
  intent: UnifiedAgentIntent,
  requested: WpsPatchOperation,
  snapshot: WpsDocumentSnapshot,
): WpsPatchOperation {
  if (intent === 'rewrite_selection' && snapshot.selectionText.trim()) {
    return 'replace_selection'
  }

  if (requested === 'append_document') {
    return 'append_document'
  }

  return 'insert_at_cursor'
}

function patchTitle(intent: UnifiedAgentIntent) {
  if (intent === 'rewrite_selection') {
    return '选区改写'
  }

  if (intent === 'review_document') {
    return '审阅修订'
  }

  return '正文生成'
}

function inferAgents(prompt: string, intent: UnifiedAgentIntent): WpsAgentPlan['agents'] {
  const agents: WpsAgentPlan['agents'] = ['writer']

  if (/事实|来源|资料|引用|核实|最新|搜索|research/i.test(prompt)) {
    agents.push('researcher')
  }

  if (/(审阅|诊断|批改|问题|逻辑|反例|review)/i.test(prompt) || intent === 'review_document') {
    agents.push('critic')
  }

  if (/(润色|风格|语气|降噪|像我|style|polish)/i.test(prompt)) {
    agents.push('stylist')
  }

  if (/(错别字|病句|标点|校对|纠错|proof)/i.test(prompt)) {
    agents.push('proofreader')
  }

  return normalizeAgents(agents)
}

function normalizeAgents(value: unknown): WpsAgentPlan['agents'] {
  const allowed = new Set<WpsAgentPlan['agents'][number]>(['writer', 'critic', 'stylist', 'proofreader', 'researcher'])
  const agents = Array.isArray(value)
    ? value.filter((item): item is WpsAgentPlan['agents'][number] => allowed.has(item))
    : []

  return agents.includes('writer') ? [...new Set(agents)] : ['writer', ...new Set(agents)]
}

function inferCautions(prompt: string, intent: UnifiedAgentIntent) {
  const cautions: string[] = []

  if (/最新|今天|新闻|价格|政策|法规|事实|来源|引用/i.test(prompt)) {
    cautions.push('涉及可能变化的事实时，不要编造来源；没有材料则标注待核实。')
  }

  if (intent === 'rewrite_selection') {
    cautions.push('保留原意，只改变表达质量。')
  }

  if (intent === 'review_document') {
    cautions.push('先指出问题和修改理由，不默认写入正文。')
  }

  return cautions
}

function isIntent(value: unknown): value is UnifiedAgentIntent {
  return (
    value === 'answer_only' ||
    value === 'rewrite_selection' ||
    value === 'write_document' ||
    value === 'review_document'
  )
}

function isPatchOperation(value: unknown): value is WpsPatchOperation {
  return (
    value === 'replace_selection' ||
    value === 'insert_at_cursor' ||
    value === 'append_document' ||
    value === 'copy_only'
  )
}

function safeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
