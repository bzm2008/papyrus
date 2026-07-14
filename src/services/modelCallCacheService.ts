import { callOpenAICompatible, type ChatMessage } from './llmClient'
import type { LlmProviderConfig } from './modelCatalog'
import {
  createSemanticFingerprint,
  findExactSemanticCacheHit,
  findSemanticCacheHit,
  rememberSemanticResult,
} from './semanticCacheService'
import { useAppStore, type FlowThinkingEffort } from '../stores/useAppStore'
import {
  getAgentSamplingProfile,
  type AgentSamplingPhase,
  type AgentSamplingProfile,
} from './agentSamplingService'

export type CacheableModelStage =
  | 'classification'
  | 'planning'
  | 'research'
  | 'project_context'
  | 'agent_output'
  | 'judge'
  | 'compression'

export type CachedModelCallOptions = {
  stage: CacheableModelStage
  taskType: string
  prompt: string
  agentId?: string
  providerRole?: string
  thinkingEffort?: FlowThinkingEffort
  contextHash?: string
  samplingPhase?: AgentSamplingPhase
  sampling?: AgentSamplingProfile
  signal?: AbortSignal
  bypass?: boolean
}

export async function callCacheableModel(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  options: CachedModelCallOptions,
) {
  const cacheKey = createModelCallCacheKey(options)

  if (!options.bypass && isCacheableStage(options.stage)) {
    const hit =
      findExactSemanticCacheHit(cacheKey, cacheTaskType(options)) ??
      findSemanticCacheHit(cacheKey, cacheTaskType(options))

    if (hit?.summary) {
      recordModelCacheMetric(cacheKey, options.stage, true)
      return hit.summary
    }
  }

  const sampling =
    options.sampling ??
    getAgentSamplingProfile(options.samplingPhase ?? stageToSamplingPhase(options.stage), options.thinkingEffort)
  const result = await callOpenAICompatible(provider, messages, options.signal, sampling)

  if (isCacheableStage(options.stage)) {
    rememberSemanticResult(cacheKey, cacheTaskType(options), result)
    recordModelCacheMetric(cacheKey, options.stage, false, '首次调用或上下文变化')
  } else {
    recordModelCacheMetric(cacheKey, options.stage, false, '该阶段不适合安全复用')
  }

  return result
}

function stageToSamplingPhase(stage: CacheableModelStage): AgentSamplingPhase {
  if (stage === 'planning') return 'planning'
  if (stage === 'research') return 'research'
  if (stage === 'project_context') return 'compression'
  if (stage === 'agent_output') return 'agent_output'
  if (stage === 'judge') return 'judge'
  if (stage === 'compression') return 'compression'
  return 'classification'
}

export function createModelCallCacheKey(options: CachedModelCallOptions) {
  return [
    options.stage,
    options.taskType,
    options.agentId ?? 'secretary',
    options.providerRole ?? 'default',
    options.thinkingEffort ?? 'medium',
    options.contextHash ?? 'ctx:none',
    createSemanticFingerprint(options.prompt),
  ]
    .filter(Boolean)
    .join('::')
}

export function getModelCacheStats() {
  const metrics = useAppStore.getState().modelCallCacheMetrics.filter((metric) => metric.cacheable)
  const hits = metrics.filter((metric) => metric.hit).length
  const total = metrics.length

  return {
    hits,
    total,
    misses: total - hits,
    hitRate: total ? Math.round((hits / total) * 100) : 0,
    targetHitRate: 80,
    lastMissReasons: metrics
      .filter((metric) => !metric.hit && metric.missReason)
      .slice(0, 5)
      .map((metric) => metric.missReason!),
  }
}

function recordModelCacheMetric(
  cacheKey: string,
  stage: CacheableModelStage,
  hit: boolean,
  missReason?: string,
) {
  useAppStore.getState().recordModelCallCacheMetric({
    cacheKey,
    stage,
    cacheable: isCacheableStage(stage),
    hit,
    missReason,
  })
}

function isCacheableStage(stage: CacheableModelStage) {
  return [
    'classification',
    'planning',
    'research',
    'project_context',
    'agent_output',
    'judge',
    'compression',
  ].includes(stage)
}

function cacheTaskType(options: CachedModelCallOptions) {
  return `model-cache:${options.stage}:${options.taskType}`
}
