import { composeSystemPrompt } from './agentPromptContext'
import { callOpenAICompatible, canCallProvider } from './llmClient'
import { describeModelRouting, selectModelForRole } from './modelRouterService'
import {
  type FlowThinkingEffort,
  type GoalJudgeResult,
  type GoalJudgeVerdict,
  type SecretaryGoal,
  useAppStore,
} from '../stores/useAppStore'

const effortLabels: Record<FlowThinkingEffort, string> = {
  low: '低',
  medium: '中',
  high: '高',
  ultra_hive: 'ultra+hive',
}

export function createSecretaryGoalFromRequest(request: string): SecretaryGoal {
  const cleanRequest = request.trim() || '完成一个长程写作任务'
  const title = inferGoalTitle(cleanRequest)

  return useAppStore.getState().createSecretaryGoal({
    title,
    request: cleanRequest,
    acceptanceCriteria: [
      '结果覆盖用户提出的核心目标',
      '关键章节、论点、资料或设定前后一致',
      '文稿或交付物达到可继续使用的状态',
      '裁判 Agent 明确给出完成判断',
    ],
    phasePlan: [
      '明确目标、范围和当前材料',
      '拆分阶段任务并逐步写作或研究',
      '每个阶段结束后总结进度和缺口',
      '由裁判 Agent 检查是否满足验收标准',
      '未完成时继续下一阶段，完成后收束本轮目标',
    ],
    currentProgress: '目标已建立，秘书模式将按阶段推进。',
  })
}

export function composeGoalExecutionPrompt(
  goal: SecretaryGoal,
  request: string,
  effort: FlowThinkingEffort,
  guidanceNotes: string[] = [],
) {
  return [
    `【长程目标模式】${goal.title}`,
    '',
    `用户目标：${goal.request}`,
    request.trim() && request.trim() !== goal.request ? `本阶段请求：${request.trim()}` : '',
    '',
    `思考强度：${effortLabels[effort]}`,
    effortInstruction(effort),
    '',
    '验收标准：',
    ...goal.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`),
    '',
    '阶段计划：',
    ...goal.phasePlan.map((item, index) => `${index + 1}. ${item}`),
    '',
    `当前进度：${goal.currentProgress}`,
    guidanceNotes.length
      ? ['用户运行中引导：', ...guidanceNotes.map((note, index) => `${index + 1}. ${note}`)].join('\n')
      : '',
    '',
    '请推进当前目标的一个小到中等阶段。若需要写正文，请生成文稿补丁；若暂不写正文，请给出明确的阶段产出。完成后必须提供给裁判检查的摘要、证据和剩余缺口。',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function judgeSecretaryGoal(
  goal: SecretaryGoal,
  stageResult: string,
  effort: FlowThinkingEffort,
): Promise<GoalJudgeResult> {
  const routing = selectModelForRole('judge', { complexity: 'goal' })
  const provider = routing.provider

  if (!canCallProvider(provider)) {
    return fallbackJudge(goal, stageResult)
  }

  try {
    const raw = await callOpenAICompatible(provider, [
      {
        role: 'system',
        content: composeSystemPrompt(
          [
            '你是 Papyrus 的裁判 Agent，只负责判断长程目标是否满足验收标准。',
            '不要写正文，不要替秘书长完成任务。只输出严格 JSON。',
            'JSON 字段：verdict, summary, evidence, nextStep。',
            'verdict 只能是 continue、complete、blocked、early_stop。',
            'early_stop 用于阶段结果已高置信满足当前阶段且继续协作没有新增价值，但整个目标未必完全结束。',
            effort === 'ultra_hive'
              ? '当前是 ultra+hive：最大思考强度和蜂巢模式，只要任务质量需要，就提高审查标准并要求充分证据。'
              : '如果主要验收标准缺乏充分证据，请 verdict=continue；如果继续协作会重复，请 verdict=early_stop。',
            describeModelRouting(routing),
          ].join('\n'),
        ),
      },
      {
        role: 'user',
        content: [
          `目标：${goal.request}`,
          `验收标准：\n${goal.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
          `阶段计划：\n${goal.phasePlan.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
          `当前进度：${goal.currentProgress}`,
          `本阶段结果：\n${stageResult.slice(0, 6000)}`,
        ].join('\n\n'),
      },
    ])

    return sanitizeJudgeResult(JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw))
  } catch {
    return fallbackJudge(goal, stageResult)
  }
}

export function describeThinkingEffort(effort: FlowThinkingEffort) {
  return `${effortLabels[effort]}：${effortInstruction(effort)}`
}

function inferGoalTitle(request: string) {
  const compact = request.replace(/^\/goal\s*/i, '').replace(/\s+/g, ' ').trim()
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact || '长程写作目标'
}

function effortInstruction(effort: FlowThinkingEffort) {
  if (effort === 'low') {
    return '快速推进，减少工作室 Agent 和验证轮次，优先给出可用结果。'
  }

  if (effort === 'high') {
    return '更完整地规划、核查上下文、调度必要工作室 Agent，并在输出前自检。'
  }

  if (effort === 'ultra_hive') {
    return '最大思考强度 + 蜂巢集群：适合长篇、研究、合规和跨文档任务，优先完成质量，再用缓存和摘要减少重复消耗。'
  }

  return '平衡速度与可靠性，按默认秘书模式推进。'
}

function sanitizeJudgeResult(value: Partial<GoalJudgeResult>): GoalJudgeResult {
  const verdict: GoalJudgeVerdict =
    value.verdict === 'complete' ||
    value.verdict === 'blocked' ||
    value.verdict === 'early_stop'
      ? value.verdict
      : 'continue'

  return {
    verdict,
    summary: typeof value.summary === 'string' ? value.summary : '裁判已完成检查。',
    evidence: Array.isArray(value.evidence)
      ? value.evidence.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : [],
    nextStep: typeof value.nextStep === 'string' ? value.nextStep : '继续推进下一阶段。',
    checkedAt: Date.now(),
  }
}

function fallbackJudge(goal: SecretaryGoal, stageResult: string): GoalJudgeResult {
  const normalized = stageResult.replace(/\s/g, '')
  const likelyComplete =
    normalized.length > 1800 &&
    /(完成|已满足|终稿|全文|验收|收束|无剩余缺口)/.test(stageResult) &&
    goal.acceptanceCriteria.length > 0
  const likelyEarlyStop =
    !likelyComplete &&
    normalized.length > 800 &&
    /(无新增|重复|高置信|当前阶段完成|可以停止协作)/.test(stageResult)

  return {
    verdict: likelyComplete ? 'complete' : likelyEarlyStop ? 'early_stop' : 'continue',
    summary: likelyComplete
      ? '本地裁判认为主要目标已有较充分产出，可以收束。'
      : likelyEarlyStop
        ? '本地裁判认为当前阶段继续协作收益较低，可早停并进入整合。'
        : '本地裁判认为目标仍需要继续推进，至少再完成一个阶段。',
    evidence: [stageResult.slice(0, 160)].filter(Boolean),
    nextStep: likelyComplete
      ? '整理最终结果并结束目标。'
      : likelyEarlyStop
        ? '停止重复协作，由秘书长整合当前阶段结果。'
        : '继续补齐剩余章节、论点、资料或审校缺口。',
    checkedAt: Date.now(),
  }
}
