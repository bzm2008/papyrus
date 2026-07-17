import { useAppStore, type ModelRoutingMode } from '../stores/useAppStore'
import {
  getEffectiveContextLimit,
  isProviderValidated,
  providerOrder,
  type LlmProviderConfig,
  type ProviderId,
} from './modelCatalog'
import { canCallProvider } from './llmClient'
import {
  getProviderTier,
  getProviderTierWeight,
  isProviderAllowedForAuto,
} from './modelGovernanceService'
import { getScallionRoutingAccess } from './scallionModelCatalog'
import type { SecretaryTaskComplexity } from './secretaryTaskClassifier'

export type ModelProviderRole =
  | 'classification'
  | 'planning'
  | 'agent'
  | 'writer'
  | 'judge'
  | 'compression'
  | 'repair'

export type ModelRoutingDecision = {
  provider: LlmProviderConfig
  providerId: ProviderId
  mode: ModelRoutingMode
  role: ModelProviderRole
  reason: string
  fallbackUsed: boolean
}

export function selectModelForRole(
  role: ModelProviderRole,
  options: { complexity?: SecretaryTaskComplexity; writeIntent?: boolean; thinkingEffort?: string } = {},
): ModelRoutingDecision {
  const store = useAppStore.getState()
  const fallback = store.providerConfigs[store.activeProviderId] ?? store.providerConfigs.qwen36

  if (store.modelRoutingMode !== 'auto') {
    return {
      provider: fallback,
      providerId: fallback.id,
      mode: 'manual',
      role,
      reason: '手动模型模式',
      fallbackUsed: false,
    }
  }

  if (store.providerConfigs.qwen36.type === 'scallion_proxy') {
    const configuredModelName = store.providerConfigs.qwen36.modelName.trim()
    const autoModels = store.scallionModels.filter(
      (model) => model.available !== false && getScallionRoutingAccess(model, 'auto'),
    )
    const autoModel =
      autoModels.find(
        (model) => model.id === configuredModelName || model.modelName === configuredModelName,
      ) ?? autoModels[0]
    if (autoModel) {
      const provider = {
        ...store.providerConfigs.qwen36,
        modelName: autoModel.modelName || autoModel.id,
        label: autoModel.label || store.providerConfigs.qwen36.label,
        serverContextWindowTokens:
          autoModel.contextWindowTokens ?? store.providerConfigs.qwen36.serverContextWindowTokens,
      }
      return {
        provider,
        providerId: 'qwen36',
        mode: 'auto',
        role,
        reason: `Auto 路由选择 ${provider.label}`,
        fallbackUsed: false,
      }
    }
  }

  const usable = providerOrder
    .map((providerId) => store.providerConfigs[providerId])
    .filter((provider): provider is LlmProviderConfig => Boolean(provider))
    .filter((provider) => isProviderAllowedForAuto(provider.id))
    .filter((provider) => canCallProvider(provider) && isProviderValidated(provider))

  const fallbackCandidates = [fallback, store.providerConfigs.qwen36]
    .filter(Boolean)
    .filter((provider, index, list): provider is LlmProviderConfig =>
      Boolean(provider && list.findIndex((item) => item?.id === provider.id) === index),
    )
  const candidates = usable.length ? usable : fallbackCandidates
  const selected = [...candidates].sort(
    (left, right) => scoreProvider(right, role, options) - scoreProvider(left, role, options),
  )[0] ?? fallback

  return {
    provider: selected,
    providerId: selected.id,
    mode: 'auto',
    role,
    reason: describeRoleReason(role, selected, options),
    fallbackUsed: usable.length === 0 || selected.id === fallback.id,
  }
}

export function describeModelRouting(decision: ModelRoutingDecision) {
  if (decision.mode === 'manual') {
    return `手动模型：${decision.provider.label}`
  }

  return `Auto ${roleLabel(decision.role)}：${decision.provider.label}${decision.fallbackUsed ? '（兜底）' : ''}`
}

function scoreProvider(
  provider: LlmProviderConfig,
  role: ModelProviderRole,
  options: { complexity?: SecretaryTaskComplexity; writeIntent?: boolean; thinkingEffort?: string },
) {
  const context = getEffectiveContextLimit(provider)
  const id = provider.id
  let score = provider.type === 'scallion_proxy' ? 45 : 20

  if (canCallProvider(provider)) {
    score += 20
  }

  if (isProviderValidated(provider)) {
    score += 15
  }

  if (role === 'classification' || role === 'compression' || role === 'planning' || role === 'judge') {
    score += lightweightPreference(id)
    score += Math.min(context / 131072, 2) * 4
  } else {
    score += qualityPreference(id)
    score += Math.min(context / 131072, 8) * 8
  }

  if ((role === 'writer' || role === 'repair') && (options.writeIntent || options.complexity === 'complex' || options.complexity === 'goal')) {
    score += Math.min(context / 131072, 8) * 6
  }

  if (options.thinkingEffort === 'ultra_hive') {
    if (role === 'writer' || role === 'repair' || role === 'agent') {
      score += qualityPreference(id) * 1.5
      score += Math.min(context / 131072, 8) * 8
    } else {
      score += lightweightPreference(id) * 0.4
    }
  }

  if (options.complexity === 'simple' && (role === 'agent' || role === 'planning')) {
    score += lightweightPreference(id) * 0.5
  }

  const tierWeight = getProviderTierWeight(id)
  return score * tierWeight
}

function lightweightPreference(id: ProviderId) {
  if (id === 'qwen36') return 18
  if (id === 'groq' || id === 'deepseek' || id === 'bailian') return 14
  if (id === 'siliconflow' || id === 'glm') return 10
  return 4
}

function qualityPreference(id: ProviderId) {
  if (id === 'openai' || id === 'openrouter' || id === 'minimax') return 18
  if (id === 'qwen36' || id === 'doubao' || id === 'moonshot') return 16
  if (id === 'siliconflow' || id === 'bailian') return 12
  return 6
}

function describeRoleReason(
  role: ModelProviderRole,
  provider: LlmProviderConfig,
  options: { complexity?: SecretaryTaskComplexity; writeIntent?: boolean; thinkingEffort?: string },
) {
  const contextLabel = `${Math.round(getEffectiveContextLimit(provider) / 1024)}K`
  const tier = getProviderTier(provider.id)
  if (options.thinkingEffort === 'ultra_hive' && (role === 'writer' || role === 'repair' || role === 'agent')) {
    return `ultra+hive 优先完成质量，选择 ${tier} 高质量或大上下文模型（${contextLabel}）。`
  }

  if (role === 'writer' || role === 'repair') {
    return `正文/修复阶段优先选择 ${tier} 高质量或大上下文模型（${contextLabel}）。`
  }

  if (options.complexity === 'simple') {
    return `简单任务优先使用 ${tier} 轻量模型，减少协作开销（${contextLabel}）。`
  }

  return `规划、分类、压缩和裁判阶段优先使用 ${tier} 轻量可靠模型（${contextLabel}）。`
}

function roleLabel(role: ModelProviderRole) {
  const labels: Record<ModelProviderRole, string> = {
    classification: '分类',
    planning: '规划',
    agent: '执行',
    writer: '成稿',
    judge: '裁判',
    compression: '压缩',
    repair: '修复',
  }
  return labels[role]
}
