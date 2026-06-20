import { estimateTokens } from './tokenizer'
import { useAppStore } from '../stores/useAppStore'

export function composeWritingKnowledgeContext(query: string, limit = 10) {
  const state = useAppStore.getState()
  const terms = tokenize(query)
  const projectId = state.activeStoryProjectId
  const chatId = state.activeChatId

  const projectMemories = state.projectWritingMemories
    .filter((memory) => memory.enabled)
    .filter((memory) => !memory.projectId || memory.projectId === projectId || memory.chatId === chatId)
    .map((memory) => ({
      label: memory.title,
      content: memory.content,
      tags: memory.tags,
      updatedAt: memory.updatedAt,
      score: scoreText([memory.title, memory.content, ...memory.tags].join('\n'), terms, memory.updatedAt),
    }))

  const storyMemories = state.storyMemories
    .filter((memory) => memory.status === 'active' || memory.status === 'tentative')
    .map((memory) => ({
      label: `${memory.subject} / ${memory.field}`,
      content: memory.value,
      tags: [memory.category],
      updatedAt: memory.updatedAt,
      score: scoreText([memory.subject, memory.field, memory.value, memory.evidence].join('\n'), terms, memory.updatedAt),
    }))

  const resources = state.resources
    .filter((resource) => resource.includedInContext && resource.content)
    .map((resource) => ({
      label: resource.name,
      content: resource.content.slice(0, 900),
      tags: ['resource', resource.type],
      updatedAt: resource.importedAt,
      score: scoreText([resource.name, resource.content.slice(0, 1600)].join('\n'), terms, resource.importedAt),
    }))

  const ranked = [...projectMemories, ...storyMemories, ...resources]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  if (!ranked.length) {
    return { text: '', tokenEstimate: 0 }
  }

  const text = ranked
    .map((item, index) => {
      const tags = item.tags.filter(Boolean).slice(0, 4).join(' / ')
      return `${index + 1}. [${tags || 'knowledge'}] ${item.label}: ${item.content}`
    })
    .join('\n')

  return { text, tokenEstimate: estimateTokens(text) }
}

function scoreText(text: string, terms: string[], updatedAt: number) {
  const haystack = tokenize(text)
  const termScore = terms.length
    ? terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
    : 0.4
  const ageDays = Math.max(0, (Date.now() - updatedAt) / 86_400_000)
  const recency = 1 / (1 + ageDays / 45)

  return termScore + recency
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\u4e00-\u9fff]+/gu, ' ')
        .split(/\s+/)
        .flatMap((token) => {
          if (/^[\u4e00-\u9fff]+$/u.test(token) && token.length > 2) {
            const grams: string[] = []
            for (let index = 0; index < token.length - 1; index += 1) {
              grams.push(token.slice(index, index + 2))
            }
            return [token, ...grams]
          }
          return [token]
        })
        .filter((token) => token.length >= 2)
        .slice(0, 160),
    ),
  )
}
