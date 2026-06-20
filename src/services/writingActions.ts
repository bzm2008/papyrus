import { type LlmProviderConfig, useAppStore } from '../stores/useAppStore'
import { composeSystemPrompt } from './agentPromptContext'
import { callOpenAICompatible, canCallProvider } from './llmClient'
import { retrieveMentionContext } from './projectContext'

export type WritingAction = '指令' | '审查' | '纠错' | '查重' | '降噪'

export type CompanionRewriteResult =
  | {
      kind: 'rewrite'
      action: WritingAction
      replacementText: string
      summary: string
      confidence: number
      highlights: string[]
      notes: string[]
    }
  | {
      kind: 'diagnostic'
      action: '查重'
      verdict: 'likely_human' | 'mixed' | 'likely_ai'
      summary: string
      confidence: number
      reasons: string[]
      signals: string[]
    }

export async function runCompanionRewrite({
  action,
  selectedText,
  customPrompt,
  provider,
}: {
  action: WritingAction
  selectedText: string
  customPrompt?: string
  provider: LlmProviderConfig
}): Promise<CompanionRewriteResult> {
  const text = selectedText.trim() || '这段文字'

  if (action === '查重') {
    if (!canCallProvider(provider)) {
      return createMockCheckup(text)
    }

    const mentionContext = await retrieveMentionContext(useAppStore.getState().mentionContextItems)
    const response = await callOpenAICompatible(provider, [
      {
        role: 'system',
        content: composeSystemPrompt(
          '你是 Papyrus 的查重审查器。只返回严格 JSON，不要解释。输出格式：{"kind":"diagnostic","verdict":"likely_human|mixed|likely_ai","confidence":0到1之间小数,"summary":"一句话","reasons":["原因1","原因2"],"signals":["信号1","信号2"]}。判断重点是是否存在明显 AI 腔、模板化、空泛推进、过度对称、缺少具体经验/细节/出处。',
        ),
      },
      {
        role: 'user',
        content: [
          mentionContext ? `@ 提及对象检索结果：\n${mentionContext}` : '',
          `请对下面文本做查重诊断。\n\n文本：\n${text}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ])

    return parseCheckupResult(response, text)
  }

  if (!canCallProvider(provider)) {
    return createMockRewrite(action, text, customPrompt)
  }

  const mentionContext = await retrieveMentionContext(useAppStore.getState().mentionContextItems)
  const response = await callOpenAICompatible(provider, [
    {
      role: 'system',
      content: composeSystemPrompt(
        '你是 Papyrus 的伴写助手。只返回严格 JSON，不要解释。输出格式：{"kind":"rewrite","summary":"一句话","replacementText":"改写后的正文","confidence":0到1之间小数,"highlights":["改动点1","改动点2"],"notes":["补充说明1","补充说明2"]}。保留作者核心意思和当前语气，不要扩写。对“降噪”优先消除模板句、空话、过度修饰和 AI 腔；对“审查”优先收紧逻辑与事实风险；对“纠错”只做最小必要修正；对“指令”按用户指定处理。',
      ),
    },
    {
      role: 'user',
      content: [
        mentionContext ? `@ 提及对象检索结果：\n${mentionContext}` : '',
        buildActionPrompt(action, text, customPrompt),
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ])

  return parseRewriteResult(response, action, text, customPrompt)
}

function buildActionPrompt(action: WritingAction, text: string, customPrompt?: string) {
  if (action === '指令') {
    return `请按这个指令处理选中文本：${customPrompt?.trim() || '优化表达'}\n\n选中文本：\n${text}`
  }

  const prompts: Record<Exclude<WritingAction, '指令' | '查重'>, string> = {
    审查: '请审查这段文字的逻辑、事实风险和论证薄弱处，并给出更稳妥的正文版本。',
    纠错: '请修正错别字、病句和标点问题，只做最小必要修改。',
    降噪: '请去除明显 AI 腔、模板化表达和空泛修饰，保留原意和作者声音。',
  }

  if (action === '查重') {
    return `请对这段文字做查重诊断。\n\n选中文本：\n${text}`
  }

  return `${prompts[action]}\n\n选中文本：\n${text}`
}

function parseRewriteResult(
  response: string,
  action: WritingAction,
  fallbackText: string,
  customPrompt?: string,
): CompanionRewriteResult {
  const parsed = tryParseJson(response)

  if (isRewriteResult(parsed)) {
    return {
      kind: 'rewrite',
      action,
      replacementText: normalizeRewriteText(parsed.replacementText || fallbackText),
      summary: parsed.summary?.trim() || `${action}完成`,
      confidence: clampConfidence(parsed.confidence),
      highlights: normalizeStringArray(parsed.highlights),
      notes: normalizeStringArray(parsed.notes),
    }
  }

  return createMockRewrite(action, fallbackText, customPrompt)
}

function parseCheckupResult(response: string, fallbackText: string): CompanionRewriteResult {
  const parsed = tryParseJson(response)

  if (isCheckupResult(parsed)) {
    return {
      kind: 'diagnostic',
      action: '查重',
      verdict: normalizeVerdict(parsed.verdict),
      summary: parsed.summary?.trim() || '查重完成',
      confidence: clampConfidence(parsed.confidence),
      reasons: normalizeStringArray(parsed.reasons),
      signals: normalizeStringArray(parsed.signals),
    }
  }

  return createMockCheckup(fallbackText)
}

function createMockRewrite(action: WritingAction, selectedText: string, prompt?: string): CompanionRewriteResult {
  const text = selectedText || '这段文字'

  if (action === '指令') {
    return {
      kind: 'rewrite',
      action,
      replacementText: `${text}（已按“${prompt?.trim() || '自定义指令'}”进行模拟改写）`,
      summary: '已按自定义指令生成模拟结果',
      confidence: 0.68,
      highlights: ['按指令重写'],
      notes: ['本地回退结果'],
    }
  }

  const replacements: Record<Exclude<WritingAction, '指令' | '查重'>, string> = {
    审查: `${text}（审查提示：这里已补上一处论证压力测试，请后续核实材料来源。）`,
    纠错: `${text}（已完成模拟纠错）`,
    降噪: neutralizeSlop(text),
  }

  if (action === '查重') {
    return createMockCheckup(text)
  }

  return {
    kind: 'rewrite',
    action,
    replacementText: normalizeRewriteText(replacements[action]),
    summary:
      action === '降噪' ? '已生成降噪建议稿' : action === '纠错' ? '已完成纠错建议稿' : '已完成审查建议稿',
    confidence: 0.66,
    highlights: action === '降噪' ? ['消除空话', '收紧句子'] : ['局部修改'],
    notes: ['本地回退结果'],
  }
}

function createMockCheckup(text: string): CompanionRewriteResult {
  const score = scoreAiLikelihood(text)
  const verdict = score >= 0.7 ? 'likely_ai' : score >= 0.45 ? 'mixed' : 'likely_human'
  const signals = collectAiSignals(text)

  return {
    kind: 'diagnostic',
    action: '查重',
    verdict,
    summary:
      verdict === 'likely_ai'
        ? '这段文字更像 AI 写作或重度润色结果。'
        : verdict === 'mixed'
          ? '这段文字呈现人写与机写混合特征。'
          : '这段文字更接近人工写作。',
    confidence: clampConfidence(score),
    reasons:
      signals.length > 0
        ? signals
        : ['未发现特别强的模板化痕迹，但仍建议检查是否有具体经历、出处和可验证细节。'],
    signals,
  }
}

function neutralizeSlop(text: string) {
  const rules: Array<[RegExp, string]> = [
    [/在当今[^，。；！？]*[，。；！？]/g, ''],
    [/总而言之[，：:]?/g, ''],
    [/不难看出/g, ''],
    [/值得一提的是/g, ''],
    [/从某种程度上来说/g, ''],
    [/可以说/g, ''],
    [/进一步来说/g, ''],
    [/与此同时/g, ''],
    [/在这个过程中/g, ''],
    [/需要注意的是/g, ''],
  ]

  let result = text
  for (const [pattern, replacement] of rules) {
    result = result.replace(pattern, replacement)
  }

  result = result
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\s*\n+\s*/g, '\n')
    .replace(/([，。！？；])\1+/g, '$1')
    .trim()

  return result === text ? `${text}（已收紧表达并减少空话）` : result
}

function scoreAiLikelihood(text: string) {
  const signals = collectAiSignals(text)
  const lengthFactor = Math.min(0.15, countWritingChars(text) / 1800)
  return Math.min(1, signals.length * 0.12 + lengthFactor)
}

function collectAiSignals(text: string) {
  const lower = text.toLowerCase()
  const signals: string[] = []
  const patterns: Array<[RegExp, string]> = [
    [/总而言之|综上所述|显而易见|不难看出/g, '结论腔过强'],
    [/在当今|随着.*的发展|可以说|进一步来说/g, '泛化推进明显'],
    [/值得一提的是|需要注意的是|与此同时/g, '连接词偏多'],
    [/首先[^，。！？；]*其次[^，。！？；]*最后/g, '层级模板化'],
    [/(重要的是|核心在于|本质上)/g, '抽象判断偏多'],
    [/(我们可以看到|让我们|接下来)/g, '讲解口吻偏强'],
    [/(提升效率|优化体验|赋能|闭环|生态)/g, 'AI/商业套话'],
    [/(分析一下|进行深入分析|深入探讨)/g, '分析话术重复'],
  ]

  for (const [pattern, label] of patterns) {
    if (pattern.test(text)) {
      signals.push(label)
    }
  }

  const repeated = findRepeatedFragments(lower)
  if (repeated.length) {
    signals.push(...repeated.map((item) => `重复片段：${item}`))
  }

  return uniqueStrings(signals).slice(0, 6)
}

function findRepeatedFragments(text: string) {
  const chunks = text
    .replace(/\s+/g, ' ')
    .split(/[。！？；,，]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12)

  const counts = new Map<string, number>()
  for (const chunk of chunks) {
    counts.set(chunk, (counts.get(chunk) ?? 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([chunk]) => chunk.slice(0, 24))
}

function normalizeRewriteText(value: string) {
  return value.trim().replace(/\s*\n+\s*/g, '\n')
}

function tryParseJson(value: string): Record<string, unknown> | undefined {
  const text = value.trim()
  const jsonCandidate =
    text.match(/```json\s*([\s\S]*?)```/i)?.[1] ??
    text.match(/```(?:text|markdown|md)?\s*([\s\S]*?)```/i)?.[1] ??
    text

  try {
    const parsed = JSON.parse(jsonCandidate)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function isRewriteResult(value: Record<string, unknown> | undefined): value is {
  kind?: string
  replacementText?: string
  summary?: string
  confidence?: number
  highlights?: unknown
  notes?: unknown
} {
  return !!value && (value.kind === 'rewrite' || typeof value.replacementText === 'string')
}

function isCheckupResult(value: Record<string, unknown> | undefined): value is {
  kind?: string
  verdict?: string
  summary?: string
  confidence?: number
  reasons?: unknown
  signals?: unknown
} {
  return !!value && (value.kind === 'diagnostic' || typeof value.verdict === 'string')
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 8)
}

function normalizeVerdict(value: unknown): 'likely_human' | 'mixed' | 'likely_ai' {
  return value === 'likely_ai' || value === 'mixed' ? value : 'likely_human'
}

function clampConfidence(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.7
  }

  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function countWritingChars(value: string) {
  return Array.from(value.replace(/\s+/g, '')).length
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}
