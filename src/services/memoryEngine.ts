import { estimateTokens } from './tokenizer'
import {
  useAppStore,
  type AgentMemoryKind,
  type AgentMemoryRecord,
  type AgentMemoryScope,
  type AgentRunRecord,
  type FlowAgentId,
  type RemoteRelayPlatform,
} from '../stores/useAppStore'

export type RememberMemoryInput = {
  content: string
  kind?: AgentMemoryKind
  scope?: AgentMemoryScope
  agentId?: FlowAgentId
  chatId?: string
  articleId?: string
  projectId?: string
  remotePlatform?: RemoteRelayPlatform
  remoteSenderId?: string
  tags?: string[]
  confidence?: number
  source?: string
  sourceRunId?: string
}

export type RecallMemoryOptions = {
  scope?: AgentMemoryScope
  agentId?: FlowAgentId
  chatId?: string
  articleId?: string
  projectId?: string
  remotePlatform?: RemoteRelayPlatform
  remoteSenderId?: string
  limit?: number
  includeTentative?: boolean
}

export type MemoryObservation = {
  run: AgentRunRecord
  response?: string
  patchContent?: string
  remotePlatform?: RemoteRelayPlatform
  remoteSenderId?: string
}

export function rememberMemory(input: RememberMemoryInput) {
  const content = normalizeContent(input.content)

  if (!content) {
    return undefined
  }

  const state = useAppStore.getState()
  const now = Date.now()
  const scope = input.scope ?? inferScope(input)
  const kind = input.kind ?? 'fact'
  const tags = normalizeTags(input.tags ?? inferTags(content, kind))
  const confidence = clamp(input.confidence ?? defaultConfidence(kind), 0.1, 1)
  const existing = findSimilarMemory(content, {
    scope,
    kind,
    chatId: input.chatId ?? state.activeChatId,
    projectId: input.projectId ?? state.activeStoryProjectId,
    remotePlatform: input.remotePlatform,
    remoteSenderId: input.remoteSenderId,
  })

  const memory = useAppStore.getState().upsertAgentMemory({
    id: existing?.id,
    scope,
    agentId: input.agentId,
    chatId: input.chatId ?? state.activeChatId,
    articleId: input.articleId ?? state.activeArticleId,
    projectId: input.projectId ?? state.activeStoryProjectId,
    remotePlatform: input.remotePlatform,
    remoteSenderId: input.remoteSenderId,
    kind,
    content: existing ? mergeMemoryContent(existing.content, content) : content,
    tags: normalizeTags([...(existing?.tags ?? []), ...tags]),
    confidence: Math.max(existing?.confidence ?? 0, confidence),
    source: input.source ?? existing?.source ?? 'manual',
    sourceRunId: input.sourceRunId ?? existing?.sourceRunId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: existing?.lastUsedAt,
    useCount: existing?.useCount ?? 0,
    status: confidence >= 0.68 ? 'active' : 'tentative',
  })

  return memory
}

export function recallMemories(query: string, options: RecallMemoryOptions = {}) {
  const state = useAppStore.getState()
  const terms = tokenize(query)
  const now = Date.now()
  const limit = options.limit ?? 8

  const scored = state.agentMemoryRecords
    .filter((memory) => memory.status === 'active' || (options.includeTentative && memory.status === 'tentative'))
    .filter((memory) => memoryMatchesScope(memory, options, state.activeChatId, state.activeStoryProjectId))
    .map((memory) => ({
      memory,
      score: scoreMemory(memory, terms, now),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  useAppStore.getState().touchAgentMemory(scored.map((item) => item.memory.id))

  return scored
}

export function forgetMemory(id: string) {
  useAppStore.getState().forgetAgentMemory(id)
}

export function composeMemoryContext(query: string, options: RecallMemoryOptions = {}) {
  const recalled = recallMemories(query, options)

  if (!recalled.length) {
    return { text: '', memories: [] as AgentMemoryRecord[], tokenEstimate: 0 }
  }

  const text = recalled
    .map(({ memory, score }, index) => {
      const labels = [memory.kind, memory.scope, ...memory.tags.slice(0, 4)].filter(Boolean).join(' / ')

      return `${index + 1}. [${labels}; score ${score.toFixed(2)}] ${memory.content}`
    })
    .join('\n')

  return {
    text,
    memories: recalled.map((item) => item.memory),
    tokenEstimate: estimateTokens(text),
  }
}

export function observeAgentRun(observation: MemoryObservation) {
  const memories: AgentMemoryRecord[] = []
  const { run, response, patchContent, remotePlatform, remoteSenderId } = observation
  const summary = summarizeRun(run, response, patchContent)

  if (summary) {
    const memory = rememberMemory({
      kind: 'run_summary',
      scope: remotePlatform || run.source === 'remote' ? 'remote' : 'chat',
      content: summary,
      tags: ['agent-run', run.mode, run.status],
      confidence: run.status === 'completed' ? 0.72 : 0.42,
      source: 'agent_harness',
      sourceRunId: run.id,
      remotePlatform: remotePlatform ?? run.remotePlatform,
      remoteSenderId: remoteSenderId ?? run.remoteSenderId,
    })

    if (memory) {
      memories.push(memory)
    }
  }

  if (remotePlatform && remoteSenderId) {
    const memory = rememberMemory({
      kind: 'remote_contact',
      scope: 'remote',
      content: `${remotePlatform}:${remoteSenderId} usually sends ${run.mode} tasks. Latest request: ${run.prompt.slice(0, 180)}`,
      tags: ['remote', remotePlatform, run.mode],
      confidence: 0.78,
      source: 'remote_relay',
      sourceRunId: run.id,
      remotePlatform,
      remoteSenderId,
    })

    if (memory) {
      memories.push(memory)
    }
  }

  for (const memory of extractStableUserMemories(run.prompt, run.id)) {
    memories.push(memory)
  }

  return memories
}

function inferScope(input: RememberMemoryInput): AgentMemoryScope {
  if (input.remotePlatform || input.remoteSenderId) {
    return 'remote'
  }

  if (input.projectId) {
    return 'project'
  }

  if (input.chatId || input.articleId) {
    return 'chat'
  }

  return 'global'
}

function findSimilarMemory(
  content: string,
  options: {
    scope: AgentMemoryScope
    kind: AgentMemoryKind
    chatId?: string
    projectId?: string
    remotePlatform?: RemoteRelayPlatform
    remoteSenderId?: string
  },
) {
  const normalized = normalizeForCompare(content)

  return useAppStore.getState().agentMemoryRecords.find((memory) => {
    if (memory.status === 'archived' || memory.scope !== options.scope || memory.kind !== options.kind) {
      return false
    }

    if (options.scope === 'chat' && memory.chatId !== options.chatId) {
      return false
    }

    if (options.scope === 'project' && memory.projectId !== options.projectId) {
      return false
    }

    if (options.scope === 'remote') {
      if (memory.remotePlatform !== options.remotePlatform || memory.remoteSenderId !== options.remoteSenderId) {
        return false
      }
    }

    const existing = normalizeForCompare(memory.content)
    return existing.includes(normalized.slice(0, 80)) || normalized.includes(existing.slice(0, 80))
  })
}

function scoreMemory(memory: AgentMemoryRecord, terms: string[], now: number) {
  const haystack = tokenize([memory.content, memory.kind, memory.scope, ...memory.tags].join(' '))
  const termScore = terms.length
    ? terms.reduce((score, term) => score + (haystack.includes(term) ? 1.8 : partialTermScore(haystack, term)), 0) /
      Math.sqrt(terms.length)
    : 0.6
  const tagBoost = memory.tags.some((tag) => terms.includes(tag)) ? 1.2 : 0
  const recencyDays = Math.max(0, (now - memory.updatedAt) / 86_400_000)
  const recency = 1 / (1 + recencyDays / 30)
  const reuse = Math.min(1.2, Math.log1p(memory.useCount) / 2)
  const confidence = memory.confidence
  const tentativePenalty = memory.status === 'tentative' ? -0.6 : 0

  return termScore + tagBoost + recency + reuse + confidence + tentativePenalty
}

function partialTermScore(haystack: string[], term: string) {
  if (term.length < 3) {
    return 0
  }

  return haystack.some((word) => word.includes(term) || term.includes(word)) ? 0.5 : 0
}

function memoryMatchesScope(
  memory: AgentMemoryRecord,
  options: RecallMemoryOptions,
  activeChatId?: string,
  activeProjectId?: string,
) {
  if (options.scope && memory.scope !== options.scope && memory.scope !== 'global') {
    return false
  }

  if (options.agentId && memory.agentId && memory.agentId !== options.agentId) {
    return false
  }

  if (options.chatId && memory.chatId && memory.chatId !== options.chatId) {
    return false
  }

  if (!options.chatId && memory.scope === 'chat' && memory.chatId && memory.chatId !== activeChatId) {
    return false
  }

  if (options.projectId && memory.projectId && memory.projectId !== options.projectId) {
    return false
  }

  if (!options.projectId && memory.scope === 'project' && memory.projectId && memory.projectId !== activeProjectId) {
    return false
  }

  if (options.remotePlatform && memory.remotePlatform !== options.remotePlatform) {
    return false
  }

  if (options.remoteSenderId && memory.remoteSenderId !== options.remoteSenderId) {
    return false
  }

  return true
}

function summarizeRun(run: AgentRunRecord, response?: string, patchContent?: string) {
  const result = response || patchContent || run.summary

  if (!result?.trim()) {
    return ''
  }

  return [
    `Request: ${run.prompt.slice(0, 240)}`,
    `Result: ${result.replace(/\s+/g, ' ').slice(0, 420)}`,
    `Mode: ${run.mode}; source: ${run.source}; status: ${run.status}`,
  ].join('\n')
}

function extractStableUserMemories(prompt: string, runId: string) {
  const memories: AgentMemoryRecord[] = []
  const preferencePatterns = [
    /(?:以后|往后|之后|默认|记住|请记住|prefer|preference|always|never)(.{6,180})/i,
    /(?:不要|别再|避免)(.{4,120})/i,
  ]

  for (const pattern of preferencePatterns) {
    const match = prompt.match(pattern)

    if (!match?.[0]) {
      continue
    }

    const memory = rememberMemory({
      kind: 'preference',
      scope: 'global',
      content: match[0].trim(),
      tags: ['user-preference'],
      confidence: 0.82,
      source: 'prompt_observation',
      sourceRunId: runId,
    })

    if (memory) {
      memories.push(memory)
    }
  }

  return memories
}

function mergeMemoryContent(existing: string, next: string) {
  if (existing.includes(next)) {
    return existing
  }

  if (next.includes(existing)) {
    return next
  }

  return `${next}\nPrevious note: ${existing}`.slice(0, 1200)
}

function normalizeContent(content: string) {
  return content.replace(/\s+/g, ' ').trim().slice(0, 1200)
}

function normalizeTags(tags: string[]) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12),
    ),
  )
}

function inferTags(content: string, kind: AgentMemoryKind) {
  const tags: string[] = [kind]
  const lowered = content.toLowerCase()

  if (/style|tone|voice|文风|语气/.test(lowered)) {
    tags.push('style')
  }

  if (/remote|wechat|qq|feishu|wecom|微信|飞书|企业微信/.test(lowered)) {
    tags.push('remote')
  }

  if (/chapter|scene|novel|章节|场景|小说/.test(lowered)) {
    tags.push('story')
  }

  return tags
}

function defaultConfidence(kind: AgentMemoryKind) {
  if (kind === 'preference' || kind === 'remote_contact') {
    return 0.78
  }

  if (kind === 'run_summary') {
    return 0.62
  }

  return 0.7
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\u4e00-\u9fff]+/gu, ' ')
        .split(/\s+/)
        .flatMap((token) => splitToken(token))
        .filter((token) => token.length >= 2)
        .slice(0, 160),
    ),
  )
}

function splitToken(token: string) {
  if (/^[\u4e00-\u9fff]+$/u.test(token) && token.length > 2) {
    const grams: string[] = []

    for (let index = 0; index < token.length - 1; index += 1) {
      grams.push(token.slice(index, index + 2))
    }

    return [token, ...grams]
  }

  return [token]
}

function normalizeForCompare(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
