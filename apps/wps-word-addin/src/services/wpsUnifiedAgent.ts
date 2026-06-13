import type {
  AgentRunInput,
  AgentRunResult,
  UnifiedAgentIntent,
  WpsPatchOperation,
} from '../types'

const LLM_API = 'https://scallion.uno/api/papyrus/llm/chat'
const PRIMARY_MODEL = 'mimo-v2.5-pro'
const FALLBACK_MODEL = 'astron-code-latest'

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

export async function runUnifiedAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const intent = inferIntent(input.prompt, input.snapshot.selectionText)
  const system = buildSystemPrompt(intent, input.selectedSkill?.systemHint)
  const user = buildUserPrompt(input, intent)
  const raw = await callScallion(input.token, PRIMARY_MODEL, system, user).catch(async (error) => {
    console.warn('Primary Papyrus model failed, falling back.', error)
    return callScallion(input.token, FALLBACK_MODEL, system, user)
  })
  const parsed = parseAgentResponse(raw, intent, input.snapshot.selectionText)

  return parsed
}

export function inferIntent(prompt: string, selectionText: string): UnifiedAgentIntent {
  const normalized = prompt.toLowerCase()
  const hasSelection = Boolean(selectionText.trim())

  if (/(审阅|诊断|检查|问题|评价|批改|review|comment)/i.test(prompt)) {
    return 'review_document'
  }

  if (
    hasSelection &&
    /(润色|改写|缩写|扩写|降噪|纠错|替换|变成|改成|rewrite|polish|shorten|expand)/i.test(
      prompt,
    )
  ) {
    return 'rewrite_selection'
  }

  if (
    /(写|续写|生成|起草|插入|追加|提纲|正文|段落|write|draft|continue|insert|append|outline)/i.test(
      prompt,
    )
  ) {
    return 'write_document'
  }

  if (normalized.includes('@润色') && hasSelection) {
    return 'rewrite_selection'
  }

  return 'answer_only'
}

function buildSystemPrompt(intent: UnifiedAgentIntent, skillHint?: string) {
  return [
    '你是 Papyrus 的 WPS 文字侧边栏文学秘书。',
    'Papyrus 是文学、文科写作、作文、说明文、议论文、记叙文、评论、散文、非虚构和网文写作的全能文字工作台。',
    '你必须区分对话建议和可写入文档的正文。事实、推断、创作设定和写作建议要分清，不要编造来源。',
    '回答要直接、具体、可执行。中文写作任务要使用自然中文标点和段落。',
    skillHint ? `当前显式技能要求：${skillHint}` : '',
    intent === 'answer_only'
      ? '当前任务只需要在侧边栏回答，不要生成文档补丁。'
      : '当前任务需要给出可应用到 WPS 文档的正文补丁。请用“答复:”和“正文:”两个部分输出。',
    intent === 'rewrite_selection'
      ? '正文部分只能给可直接替换选区的文本，不要加标题、解释或 Markdown 围栏。'
      : '',
    intent === 'review_document'
      ? '审阅任务优先列出关键问题、证据位置和修改建议。只有用户明确要求代改时才输出正文补丁。'
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildUserPrompt(input: AgentRunInput, intent: UnifiedAgentIntent) {
  return [
    `用户指令:\n${input.prompt}`,
    input.selectedSkill ? `显式技能: ${input.selectedSkill.name}` : '',
    `任务意图: ${intent}`,
    input.snapshot.selectionText
      ? `当前选区:\n${input.snapshot.selectionText}`
      : '当前没有选区。若需要改写，请提示用户先选中文本；若是生成任务，可以写入光标或追加文末。',
    input.snapshot.documentExcerpt ? `文档摘要:\n${input.snapshot.documentExcerpt}` : '',
    `估算字数: ${input.snapshot.wordCount}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function callScallion(token: string | undefined, model: string, system: string, user: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(LLM_API, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.45,
      max_tokens: 4096,
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
}

function parseAgentResponse(
  raw: string,
  intent: UnifiedAgentIntent,
  selectionText: string,
): AgentRunResult {
  if (intent === 'answer_only' || intent === 'review_document') {
    return {
      reply: raw,
      intent,
    }
  }

  const draft = extractDraft(raw)
  const replyMatch = raw.match(/答复\s*[:：]\s*([\s\S]*?)(?:\n\s*正文\s*[:：]|$)/)
  const reply = replyMatch?.[1]?.trim() || defaultPatchReply(intent)

  return {
    reply,
    intent,
    patch: {
      title: patchTitle(intent),
      content: draft,
      recommendedOperation: recommendedOperation(intent, selectionText),
    },
  }
}

function extractDraft(raw: string) {
  const match =
    raw.match(/正文\s*[:：]\s*([\s\S]+)/) ??
    raw.match(/```(?:text|markdown|md)?\s*([\s\S]*?)```/i)

  return (match?.[1] ?? raw).trim()
}

function recommendedOperation(
  intent: UnifiedAgentIntent,
  selectionText: string,
): WpsPatchOperation {
  if (intent === 'rewrite_selection' && selectionText.trim()) {
    return 'replace_selection'
  }

  return 'insert_at_cursor'
}

function patchTitle(intent: UnifiedAgentIntent) {
  if (intent === 'rewrite_selection') {
    return '选区改写'
  }

  return '正文生成'
}

function defaultPatchReply(intent: UnifiedAgentIntent) {
  return intent === 'rewrite_selection'
    ? '已生成可替换选区的版本。'
    : '已生成可写入文档的正文。'
}
