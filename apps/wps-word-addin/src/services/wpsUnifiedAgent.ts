import type {
  AgentRunInput,
  AgentRunResult,
  UnifiedAgentIntent,
  WpsDocumentSnapshot,
  WpsPatchOperation,
} from '../types'

const LLM_API = 'https://scallion.uno/api/papyrus/llm/chat'
const PRIMARY_MODEL = 'mimo-v2.5-pro'
const FALLBACK_MODEL = 'astron-code-latest'
const REQUEST_TIMEOUT_MS = 45000

type LlmPayload = {
  choices?: Array<{
    message?: {
      content?: string
    }
    text?: string
  }>
  error?: {
    message?: string
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

export async function runUnifiedAgent(input: AgentRunInput): Promise<AgentRunResult> {
  if (!input.token) {
    throw new Error('请先登录 Scallion 后使用内置模型。')
  }

  const trace: string[] = []
  const report = (status: string) => {
    trace.push(status)
    input.onStatus?.(status)
  }

  report('规划任务')
  const plan = await createPlan(input).catch(() => localPlan(input.prompt, input.snapshot))
  const sanitizedPlan = sanitizePlan(plan, input)

  if (sanitizedPlan.needsSelection && !input.snapshot.selectionText.trim()) {
    return {
      reply: '请先在 WPS 文档中选中要处理的文字，然后再发给我。',
      intent: sanitizedPlan.intent,
      trace,
    }
  }

  report('读取文档上下文')
  const context = buildContext(input.snapshot)

  report('生成结果')
  const generated = await generateWithFallback(input, sanitizedPlan, context)
  let parsed = parseAgentJson(generated, sanitizedPlan)
  let validation = validateAgentJson(parsed, sanitizedPlan, input.snapshot)

  if (!validation.ok) {
    report('校验并修复')
    const repaired = await repairOutput(input, sanitizedPlan, context, parsed, validation.issues).catch(
      () => '',
    )
    if (repaired) {
      parsed = parseAgentJson(repaired, sanitizedPlan)
      validation = validateAgentJson(parsed, sanitizedPlan, input.snapshot)
    }
  }

  if (!validation.ok) {
    parsed = fallbackFromRaw(generated, sanitizedPlan)
    validation = validateAgentJson(parsed, sanitizedPlan, input.snapshot)
  }

  report(validation.ok ? '完成' : '完成但已降级处理')
  return toRunResult(parsed, sanitizedPlan, trace)
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
    `当前是否有选区：${input.snapshot.selectionText.trim() ? '是' : '否'}`,
    `本地初判：${JSON.stringify(local)}`,
  ].join('\n')
  const raw = await callScallion(input.token, PRIMARY_MODEL, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], 0.1, 900)

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
    intent === 'rewrite_selection' || intent === 'write_document'
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

  try {
    return await callScallion(input.token, PRIMARY_MODEL, messages, 0.42, 4096)
  } catch (error) {
    console.warn('Primary Papyrus model failed, falling back.', error)
    return callScallion(input.token, FALLBACK_MODEL, messages, 0.38, 4096)
  }
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

  return callScallion(input.token, FALLBACK_MODEL, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], 0.2, 2200)
}

async function callScallion(
  token: string | undefined,
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  temperature: number,
  maxTokens: number,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(LLM_API, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
    })
    const payload = (await response.json().catch(() => ({}))) as LlmPayload

    if (!response.ok) {
      throw new Error(payload.error?.message || `Scallion 模型请求失败: HTTP ${response.status}`)
    }

    const content = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text

    if (!content?.trim()) {
      throw new Error('模型没有返回可用文本。')
    }

    return content.trim()
  } finally {
    window.clearTimeout(timer)
  }
}

function buildContext(snapshot: WpsDocumentSnapshot) {
  return [
    snapshot.selectionText ? `当前选区：\n${snapshot.selectionText}` : '当前没有选区。',
    snapshot.documentExcerpt ? `文档上下文摘录：\n${snapshot.documentExcerpt}` : '',
    `估算字数：${snapshot.wordCount}`,
  ].filter(Boolean).join('\n\n')
}

function parseAgentJson(raw: string, plan: WpsAgentPlan): AgentJson {
  const parsed = parseJsonObject(raw)

  if (parsed) {
    return parsed as AgentJson
  }

  return fallbackFromRaw(raw, plan)
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  const jsonText = match?.[0] ?? cleaned

  try {
    return JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function validateAgentJson(output: AgentJson, plan: WpsAgentPlan, snapshot: WpsDocumentSnapshot): ValidationResult {
  const issues: string[] = []
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

function fallbackFromRaw(raw: string, plan: WpsAgentPlan): AgentJson {
  if (!plan.writeIntent) {
    return { reply: raw.trim(), patch: null, checks: ['降级为普通答复'] }
  }

  const draft = extractDraft(raw)

  return {
    reply: plan.intent === 'rewrite_selection' ? '我已生成可替换选区的版本。' : '我已生成可写入文档的正文。',
    patch: {
      title: patchTitle(plan.intent),
      content: draft,
      operation: plan.operation,
    },
    checks: ['降级提取正文'],
  }
}

function toRunResult(output: AgentJson, plan: WpsAgentPlan, trace: string[]): AgentRunResult {
  const reply = safeString(output.reply) || (plan.writeIntent ? '已完成。' : '我处理完了。')
  const patchContent = safeString(output.patch?.content)
  const operation = isPatchOperation(output.patch?.operation) ? output.patch.operation : plan.operation

  if (!plan.writeIntent || !patchContent) {
    return {
      reply,
      intent: plan.intent,
      trace,
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
    },
  }
}

function extractDraft(raw: string) {
  const match =
    raw.match(/正文\s*[:：]\s*([\s\S]+)/) ??
    raw.match(/```(?:text|markdown|md)?\s*([\s\S]*?)```/i)

  return cleanPatchContent((match?.[1] ?? raw).trim())
}

function cleanPatchContent(value: string) {
  return value
    .replace(/^```(?:text|markdown|md)?/i, '')
    .replace(/```$/i, '')
    .replace(/^正文\s*[:：]\s*/i, '')
    .trim()
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
