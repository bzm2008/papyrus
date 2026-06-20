export type StructuredAgentOutput = {
  summary: string
  keyPoints: string[]
  risks: string[]
  handoff: string
  confidence: number
  newInformation: boolean
}

export function agentProtocolInstruction() {
  return [
    '输出必须极简、结构化，不要寒暄，不要说“好的/收到/我来处理”。',
    '优先输出 JSON；如无法输出 JSON，使用紧凑 Markdown。',
    '字段固定为：summary, keyPoints, risks, handoff, confidence, newInformation。',
    'summary 不超过 120 字；keyPoints 最多 5 条；risks 最多 3 条；confidence 为 0 到 1。',
    '不要重复任务背景；引用上游结果时使用 outputId 或摘要，不要整段复制。',
  ].join('\n')
}

export function parseStructuredAgentOutput(text: string): StructuredAgentOutput {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0]

  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as Partial<StructuredAgentOutput>
      return normalizeStructuredOutput(parsed, text)
    } catch {
      // Fall through to Markdown heuristics.
    }
  }

  return compactAgentOutput(text)
}

export function compactAgentOutput(text: string, maxChars = 420): StructuredAgentOutput {
  const clean = text.replace(/\s+/g, ' ').trim()
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\d.\s]+/, '').trim())
    .filter(Boolean)

  return {
    summary: (lines[0] || clean).slice(0, maxChars),
    keyPoints: lines.slice(1, 6).map((line) => line.slice(0, 140)),
    risks: lines.filter((line) => /风险|缺口|注意|不确定|引用|合规/.test(line)).slice(0, 3),
    handoff: clean.slice(0, 260),
    confidence: inferConfidence(clean),
    newInformation: clean.length > 80 && !/无新增|没有新增|重复/.test(clean),
  }
}

export function shouldEarlyStopAgentLoop(outputs: StructuredAgentOutput[]) {
  const latest = outputs.at(-1)

  if (!latest) {
    return { stop: false }
  }

  if (latest.confidence >= 0.9 && latest.risks.length === 0) {
    return { stop: true, reason: '子任务置信度达到 90% 且无高风险，已早停后续协作。' }
  }

  const lastTwo = outputs.slice(-2)
  if (lastTwo.length === 2 && lastTwo.every((item) => !item.newInformation)) {
    return { stop: true, reason: '连续两轮没有新增信息，已停止重复协作。' }
  }

  return { stop: false }
}

export function formatStructuredOutputForHandoff(entryId: string, output: StructuredAgentOutput) {
  return [
    `outputId: ${entryId}`,
    `summary: ${output.summary}`,
    output.keyPoints.length ? `keyPoints: ${output.keyPoints.join('；')}` : '',
    output.risks.length ? `risks: ${output.risks.join('；')}` : '',
    `confidence: ${output.confidence.toFixed(2)}`,
    output.handoff ? `handoff: ${output.handoff}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function normalizeStructuredOutput(
  value: Partial<StructuredAgentOutput>,
  fallbackText: string,
): StructuredAgentOutput {
  const fallback = compactAgentOutput(fallbackText)
  const summary = typeof value.summary === 'string' && value.summary.trim()
    ? value.summary.trim()
    : fallback.summary

  return {
    summary: summary.slice(0, 420),
    keyPoints: normalizeStringArray(value.keyPoints).slice(0, 5),
    risks: normalizeStringArray(value.risks).slice(0, 3),
    handoff:
      typeof value.handoff === 'string' && value.handoff.trim()
        ? value.handoff.trim().slice(0, 420)
        : fallback.handoff,
    confidence: clampNumber(Number(value.confidence ?? fallback.confidence), 0, 1),
    newInformation:
      typeof value.newInformation === 'boolean' ? value.newInformation : fallback.newInformation,
  }
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function inferConfidence(text: string) {
  if (/不确定|可能|需要核查|缺少|风险/.test(text)) {
    return 0.62
  }

  if (/完成|确认|明确|可执行|已满足/.test(text)) {
    return 0.88
  }

  return 0.74
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
