import { fetchScallionProxyModels } from './llmClient'
import { buildModelTierAssessments } from './modelGovernanceService'
import {
  useAppStore,
  type ScallionModelMetadata,
  type ScallionQuota,
  type ScallionUser,
} from '../stores/useAppStore'

const SCALLION_ACCOUNT_API = 'https://scallion.uno/api/papyrus/account'
const DEFAULT_UPGRADE_URL = 'https://scallion.uno/pricing'

type AccountPayload = {
  user?: ScallionUser
  quota?: Partial<ScallionQuota> & {
    points?: number
    remaining_points?: number
    remainingPoints?: number
    total_points?: number
    totalPoints?: number
    upgrade_url?: string
    top_up_url?: string
    member_price_label?: string
  }
  points?: number
  remaining_points?: number
  remainingPoints?: number
  total_points?: number
  totalPoints?: number
  upgrade_url?: string
  top_up_url?: string
  member_price_label?: string
}

export async function refreshScallionRuntimeMetadata() {
  await Promise.allSettled([refreshScallionModels(), refreshScallionQuota()])
}

export async function refreshScallionModels() {
  const state = useAppStore.getState()
  const provider = state.providerConfigs.qwen36
  const models = await fetchScallionProxyModels(provider)
  const now = Date.now()
  const metadata: ScallionModelMetadata[] = models.map((model, index) => ({
    id: model.id || model.modelName || `scallion-${index}`,
    label: model.label || model.id || model.modelName || `内置模型 ${index + 1}`,
    modelName: model.modelName || model.id || provider.modelName,
    contextWindowTokens: model.contextWindowTokens ?? provider.contextWindowTokens,
    available: model.available !== false,
    updatedAt: now,
  }))

  if (!metadata.length) {
    return metadata
  }

  const assessments = buildModelTierAssessments(state.providerConfigs, metadata)
  const enriched = metadata.map((model) => {
    const assessment = assessments.find(
      (item) => item.providerId === 'qwen36' && item.modelName === model.modelName,
    )

    return {
      ...model,
      tier: assessment?.tier,
      score: assessment?.score,
      rationale: assessment?.rationale,
    }
  })

  state.setScallionModelMetadata(enriched)
  state.setModelTierAssessments(assessments)

  return enriched
}

export async function refreshScallionQuota() {
  const state = useAppStore.getState()
  const token = state.scallionToken

  if (!token) {
    const fallback = quotaFromUser(state.scallionUser)
    state.setScallionQuota(fallback)
    return fallback
  }

  try {
    const response = await fetch(SCALLION_ACCOUNT_API, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const payload = (await response.json().catch(() => ({}))) as AccountPayload

    if (!response.ok) {
      throw new Error('账户额度接口暂不可用')
    }

    if (payload.user) {
      useAppStore.getState().setScallionSession(token, payload.user)
    }

    const quota = normalizeQuota(payload, payload.user ?? state.scallionUser)
    useAppStore.getState().setScallionQuota(quota)
    return quota
  } catch {
    const fallback = quotaFromUser(state.scallionUser)
    useAppStore.getState().setScallionQuota(fallback)
    return fallback
  }
}

export function quotaFromUser(user?: ScallionUser): ScallionQuota | undefined {
  if (!user) {
    return undefined
  }

  return {
    remaining: Math.max(0, Number(user.points ?? user.balance ?? 0)),
    unit: '积分',
    isMember: user.is_member === true,
    memberPriceLabel: '9.9 元/月',
    upgradeUrl: DEFAULT_UPGRADE_URL,
    topUpUrl: DEFAULT_UPGRADE_URL,
    updatedAt: Date.now(),
  }
}

function normalizeQuota(payload: AccountPayload, user?: ScallionUser): ScallionQuota {
  const quota = payload.quota ?? {}
  const remaining =
    quota.remaining ??
    quota.remainingPoints ??
    quota.remaining_points ??
    quota.points ??
    payload.remainingPoints ??
    payload.remaining_points ??
    payload.points ??
    user?.points ??
    user?.balance ??
    0
  const total =
    quota.total ??
    quota.totalPoints ??
    quota.total_points ??
    payload.totalPoints ??
    payload.total_points

  return {
    remaining: Math.max(0, Number(remaining) || 0),
    total: total === undefined ? undefined : Math.max(0, Number(total) || 0),
    unit: quota.unit || '积分',
    isMember: quota.isMember ?? user?.is_member === true,
    memberPriceLabel: quota.memberPriceLabel || quota.member_price_label || payload.member_price_label || '9.9 元/月',
    upgradeUrl: quota.upgradeUrl || quota.upgrade_url || payload.upgrade_url || DEFAULT_UPGRADE_URL,
    topUpUrl: quota.topUpUrl || quota.top_up_url || payload.top_up_url || DEFAULT_UPGRADE_URL,
    updatedAt: Date.now(),
  }
}
