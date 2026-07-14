import {
  defaultProviderConfigs,
  getEffectiveContextLimit,
  isProviderValidated,
  providerOrder,
  type LlmProviderConfig,
  type ProviderId,
} from './modelCatalog'
import { canCallProvider } from './llmClient'
import {
  useAppStore,
  type ModelCapabilityTier,
  type ModelTierAssessment,
  type ScallionModelMetadata,
} from '../stores/useAppStore'

export const modelTierDescriptions: Record<ModelCapabilityTier, string> = {
  T1: '中坚模型：负责复杂写作、长篇整合、严肃研究、合规审查和 ultra+hive 聚合。',
  T2: '普通模型：负责常规改写、规划、资料整理、平台运营和大多数日常秘书任务。',
  T3: '轻量模型：负责分类、摘要、缓存复用、格式整理和重复的小任务。',
}

export function refreshLocalModelTierAssessments() {
  const state = useAppStore.getState()
  const assessments = buildModelTierAssessments(state.providerConfigs, state.scallionModels)
  state.setModelTierAssessments(assessments)

  return assessments
}

export function buildModelTierAssessments(
  providerConfigs: Record<ProviderId, LlmProviderConfig>,
  scallionModels: ScallionModelMetadata[] = [],
): ModelTierAssessment[] {
  const now = Date.now()
  const providerAssessments = providerOrder.map((providerId) => {
    const provider = providerConfigs[providerId] ?? defaultProviderConfigs[providerId]
    const available = canCallProvider(provider) && isProviderValidated(provider)
    const score = scoreModel({
      providerId,
      label: provider.label,
      modelName: provider.modelName,
      type: provider.type,
      available,
      contextWindowTokens: getEffectiveContextLimit(provider),
    })

    return {
      id: providerId,
      providerId,
      label: provider.label,
      modelName: provider.modelName,
      tier: tierForScore(score),
      score,
      rationale: rationaleForScore(score, getEffectiveContextLimit(provider), provider.label),
      available,
      contextWindowTokens: getEffectiveContextLimit(provider),
      updatedAt: now,
    } satisfies ModelTierAssessment
  })

  const scallionAssessments = scallionModels.map((model, index) => {
    const score = scoreModel({
      providerId: 'qwen36',
      label: model.label,
      modelName: model.modelName,
      type: 'scallion_proxy',
      available: model.available,
      contextWindowTokens: model.contextWindowTokens ?? defaultProviderConfigs.qwen36.contextWindowTokens,
    })

    return {
      id: `qwen36:${model.id || model.modelName || index}`,
      providerId: 'qwen36' as const,
      label: model.label,
      modelName: model.modelName,
      tier: tierForScore(score),
      score,
      rationale: rationaleForScore(
        score,
        model.contextWindowTokens ?? defaultProviderConfigs.qwen36.contextWindowTokens,
        model.label,
      ),
      available: model.available,
      contextWindowTokens: model.contextWindowTokens,
      updatedAt: now,
    } satisfies ModelTierAssessment
  })

  return [...scallionAssessments, ...providerAssessments]
}

export function getProviderTier(providerId: ProviderId) {
  const state = useAppStore.getState()
  const assessment =
    state.modelTierAssessments.find((item) => item.providerId === providerId && item.available) ??
    buildModelTierAssessments(state.providerConfigs, state.scallionModels).find(
      (item) => item.providerId === providerId,
    )

  return assessment?.tier ?? 'T2'
}

export function getProviderTierWeight(providerId: ProviderId) {
  const state = useAppStore.getState()
  const tier = getProviderTier(providerId)

  return state.modelTierWeights[tier] ?? 1
}

export function isProviderAllowedForAuto(providerId: ProviderId) {
  const allowed = useAppStore.getState().autoModelProviderIds
  return allowed.length ? allowed.includes(providerId) : providerId === 'qwen36'
}

function scoreModel(input: {
  providerId: ProviderId
  label: string
  modelName: string
  type: LlmProviderConfig['type']
  available: boolean
  contextWindowTokens: number
}) {
  const haystack = `${input.label} ${input.modelName} ${input.providerId}`.toLowerCase()
  let score = input.available ? 42 : 18

  if (input.type === 'scallion_proxy') score += 10
  if (input.contextWindowTokens >= 1000000) score += 18
  else if (input.contextWindowTokens >= 262144) score += 12
  else if (input.contextWindowTokens >= 131072) score += 8
  else if (input.contextWindowTokens >= 65536) score += 4

  if (/opus|sonnet|gpt-4\.1|gpt-5|claude|kimi-k2|qwen3-235b|deepseek-r1|o3|o4/.test(haystack)) {
    score += 22
  }
  if (/mini|flash|turbo|lite|small|8b|14b|speed|groq/.test(haystack)) {
    score -= 10
  }
  if (/writer|creative|long|reason|instruct|plus|large|pro|max|235b|72b|70b/.test(haystack)) {
    score += 8
  }
  if (/embedding|rerank|vision|audio|tts|image/.test(haystack)) {
    score -= 28
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}

function tierForScore(score: number): ModelCapabilityTier {
  if (score >= 76) return 'T1'
  if (score >= 48) return 'T2'
  return 'T3'
}

function rationaleForScore(score: number, contextWindowTokens: number, label: string) {
  const tier = tierForScore(score)
  const contextLabel =
    contextWindowTokens >= 1000000
      ? '1M+'
      : contextWindowTokens >= 262144
        ? '256K+'
        : contextWindowTokens >= 131072
          ? '128K+'
          : `${Math.round(contextWindowTokens / 1024)}K`

  return `${label} 按本地规则评为 ${tier}：综合上下文 ${contextLabel}、模型名称特征、可用状态，以及写作/文学/agent 任务适配度。`
}
