import { useAppStore, type FlowTrace, type SemanticTaskCacheEntry } from '../stores/useAppStore'

export function createSemanticFingerprint(prompt: string) {
  return Array.from(tokenize(prompt)).sort().join('|').slice(0, 220)
}

export function findExactSemanticCacheHit(prompt: string, taskType: string) {
  if (!isCacheableTask(taskType, prompt)) {
    return undefined
  }

  const promptFingerprint = createSemanticFingerprint(prompt)
  const hit = useAppStore
    .getState()
    .semanticTaskCache.find(
      (entry) => entry.taskType === taskType && entry.promptFingerprint === promptFingerprint,
    )

  if (!hit) {
    return undefined
  }

  useAppStore.getState().putSemanticTaskCache({
    ...hit,
    hitCount: hit.hitCount + 1,
    updatedAt: Date.now(),
  })

  return hit
}

export function findSemanticCacheHit(prompt: string, taskType: string) {
  const exactHit = findExactSemanticCacheHit(prompt, taskType)
  if (exactHit) {
    return exactHit
  }

  const tokens = tokenize(prompt)
  if (tokens.size < 3 || !isCacheableTask(taskType, prompt)) {
    return undefined
  }

  const hit = useAppStore
    .getState()
    .semanticTaskCache.map((entry) => ({
      entry,
      score:
        entry.taskType === taskType
          ? jaccard(tokens, new Set(entry.promptFingerprint.split('|').filter(Boolean)))
          : 0,
    }))
    .filter((item) => item.score >= 0.78)
    .sort((left, right) => right.score - left.score)[0]?.entry

  if (!hit) {
    return undefined
  }

  useAppStore.getState().putSemanticTaskCache({
    ...hit,
    hitCount: hit.hitCount + 1,
    updatedAt: Date.now(),
  })

  return hit
}

export function rememberSemanticResult(
  prompt: string,
  taskType: string,
  summary: string,
  sources?: FlowTrace['sources'],
): SemanticTaskCacheEntry | undefined {
  if (!summary.trim() || !isCacheableTask(taskType, prompt)) {
    return undefined
  }

  return useAppStore.getState().putSemanticTaskCache({
    taskType,
    promptFingerprint: createSemanticFingerprint(prompt),
    promptExcerpt: prompt.trim().slice(0, 260),
    summary: trimCacheSummary(summary, taskType),
    sources,
  })
}

function isCacheableTask(taskType: string, prompt: string) {
  if (taskType.startsWith('model-cache:')) {
    return true
  }

  return /research|academic|资料|核查|引用|文献|搜索|RAG|project|context|跨文档/i.test(
    `${taskType} ${prompt}`,
  )
}

function trimCacheSummary(summary: string, taskType: string) {
  const limit = taskType.startsWith('model-cache:') ? 8000 : 1400
  return summary.trim().slice(0, limit)
}

function tokenize(text: string) {
  const normalized = text.toLowerCase()
  const latin = normalized.match(/[a-z0-9]{2,}/g) ?? []
  const cjk = normalized.match(/[\u4e00-\u9fa5]{2}/g) ?? []
  return new Set([...latin, ...cjk].filter((token) => !stopwords.has(token)))
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) {
    return 0
  }

  let intersection = 0
  left.forEach((token) => {
    if (right.has(token)) {
      intersection += 1
    }
  })

  return intersection / (left.size + right.size - intersection)
}

const stopwords = new Set(['the', 'and', 'for', 'with', 'this', 'that', '一个', '可以', '需要'])
