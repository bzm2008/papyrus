import { fetchScallionProxyModels } from './llmClient'
import { buildModelTierAssessments } from './modelGovernanceService'
import {
  useAppStore,
  type ScallionModelMetadata,
  type ScallionQuota,
  type ScallionUser,
} from '../stores/useAppStore'

const SCALLION_QUOTA_API = 'https://scallion.uno/api/papyrus/llm/quota'
const DEFAULT_UPGRADE_URL = 'https://scallion.uno/pricing'
const SCALLION_REQUEST_TIMEOUT_MS = 15_000

let quotaRefreshInFlight: { token: string; promise: Promise<ScallionQuota | undefined> } | undefined
let modelsRefreshInFlight: { token: string; promise: Promise<ScallionModelMetadata[]> } | undefined

type AccountPayload = {
  user?: ScallionUser
  quota?: number | (Partial<ScallionQuota> & {
    points_balance?: number
    points?: number
    remaining_points?: number
    remainingPoints?: number
    total_points?: number
    totalPoints?: number
    upgrade_url?: string
    top_up_url?: string
    member_price_label?: string
  })
  points_balance?: number
  balance?: number
  unified_points?: boolean
  points?: number
  remaining_points?: number
  remainingPoints?: number
  total_points?: number
  totalPoints?: number
  upgrade_url?: string
  top_up_url?: string
  member_price_label?: string
  member_type?: string
  is_member?: boolean
  plan?: {
    key?: string
    name?: string
    expires_at?: string | null
  }
}

export async function refreshScallionRuntimeMetadata() {
  await Promise.allSettled([refreshScallionModels(), refreshScallionQuota()])
}

export function refreshScallionModels() {
  const state = useAppStore.getState()

  if (!state.scallionToken) {
    state.setScallionModelMetadata([])
    state.setScallionSyncState('models', { status: 'idle', error: undefined, attemptedAt: Date.now() })
    return Promise.resolve([])
  }

  const tokenAtRequest = state.scallionToken
  if (modelsRefreshInFlight?.token === tokenAtRequest) {
    return modelsRefreshInFlight.promise
  }

  state.setScallionSyncState('models', {
    status: 'syncing',
    error: undefined,
    attemptedAt: Date.now(),
  })

  const promise = refreshScallionModelsOnce(tokenAtRequest)
    .then((models) => {
      const current = useAppStore.getState()
      if (current.scallionToken === tokenAtRequest) {
        const updatedAt = models.reduce<number | undefined>(
          (latest, model) => (latest === undefined || model.updatedAt > latest ? model.updatedAt : latest),
          undefined,
        )
        current.setScallionSyncState('models', {
          status: 'ready',
          error: undefined,
          updatedAt: updatedAt ?? Date.now(),
        })
      }
      return models
    })
    .catch((error) => {
      const current = useAppStore.getState()
      if (current.scallionToken === tokenAtRequest) {
        current.setScallionSyncState('models', {
          status: current.scallionModels.length ? 'stale' : 'error',
          error: error instanceof Error ? error.message : '无法同步 Scallion 模型目录',
        })
      }
      throw error
    })
    .finally(() => {
      if (modelsRefreshInFlight?.promise === promise) {
        modelsRefreshInFlight = undefined
      }
    })
  modelsRefreshInFlight = { token: tokenAtRequest, promise }
  return promise
}

async function refreshScallionModelsOnce(tokenAtRequest: string): Promise<ScallionModelMetadata[]> {
  const state = useAppStore.getState()
  const provider = state.providerConfigs.qwen36
  let models: Awaited<ReturnType<typeof fetchScallionProxyModels>>

  try {
    // The selector must be able to explain plan restrictions, so always ask
    // the gateway for its complete public catalog. The gateway still remains
    // the authority for which entries are callable.
    models = await fetchScallionProxyModels(provider, { includeUnavailable: true })
  } catch (error) {
    if (isUnauthorizedError(error) && useAppStore.getState().scallionToken === tokenAtRequest) {
      useAppStore.getState().expireScallionSession()
    }
    throw error
  }
  if (useAppStore.getState().scallionToken !== tokenAtRequest) {
    return []
  }
  const now = Date.now()
  const metadata: ScallionModelMetadata[] = models.map((model, index) => ({
    id: model.id || model.modelName || `scallion-${index}`,
    label: model.label || model.id || model.modelName || `内置模型 ${index + 1}`,
    modelName: model.modelName || model.id || provider.modelName,
    name: model.name,
    provider: model.provider,
    billingMode: model.billingMode,
    callPrice: model.callPrice,
    contextWindowLabel: model.contextWindowLabel,
    contextWindowTokens: model.contextWindowTokens ?? provider.contextWindowTokens,
    planAvailable: model.planAvailable !== false,
    requiredPlan: model.requiredPlan,
    availabilityReason: model.availabilityReason,
    available: model.available !== false && model.planAvailable !== false,
    updatedAt: now,
  }))

  state.setScallionModelMetadata(metadata)
  const nextState = useAppStore.getState()
  const assessments = buildModelTierAssessments(nextState.providerConfigs, metadata)
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

export function refreshScallionQuota() {
  const state = useAppStore.getState()
  const token = state.scallionToken

  if (!token) {
    const fallback = quotaFromUser(state.scallionUser)
    state.setScallionQuota(fallback)
    state.setScallionSyncState('quota', {
      status: fallback ? 'ready' : 'idle',
      error: undefined,
      attemptedAt: Date.now(),
      updatedAt: fallback?.updatedAt,
    })
    return Promise.resolve(fallback)
  }

  if (quotaRefreshInFlight?.token === token) {
    return quotaRefreshInFlight.promise
  }

  state.setScallionSyncState('quota', {
    status: 'syncing',
    error: undefined,
    attemptedAt: Date.now(),
  })

  const promise = refreshScallionQuotaOnce(token, state.scallionUser).finally(() => {
    if (quotaRefreshInFlight?.promise === promise) {
      quotaRefreshInFlight = undefined
    }
  })
  quotaRefreshInFlight = { token, promise }
  return promise
}

async function refreshScallionQuotaOnce(token: string, userAtRequest?: ScallionUser) {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined

  try {
    const controller = new AbortController()
    timeout = globalThis.setTimeout(() => controller.abort(), SCALLION_REQUEST_TIMEOUT_MS)
    const response = await fetch(SCALLION_QUOTA_API, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    })
    globalThis.clearTimeout(timeout)
    const payload = (await response.json().catch(() => ({}))) as AccountPayload

    if (!response.ok) {
      const error = new Error(response.status === 401 ? 'Scallion 登录已过期，请重新登录' : '账户额度接口暂不可用')
      ;(error as Error & { code?: string; status?: number }).code = response.status === 401 ? 'unauthorized' : 'http_error'
      ;(error as Error & { code?: string; status?: number }).status = response.status
      throw error
    }

    if (useAppStore.getState().scallionToken !== token) {
      return undefined
    }

    if (payload.user) {
      useAppStore.getState().setScallionSession(token, payload.user)
    }

    const quota = normalizeQuota(payload, payload.user ?? userAtRequest)
    useAppStore.getState().setScallionQuota(quota)
    useAppStore.getState().setScallionSyncState('quota', {
      status: 'ready',
      error: undefined,
      updatedAt: quota.updatedAt,
    })
    return quota
  } catch (error) {
    if (useAppStore.getState().scallionToken !== token) {
      return undefined
    }

    if (isUnauthorizedError(error)) {
      useAppStore.getState().expireScallionSession()
      return undefined
    }

    const current = useAppStore.getState()
    const fallback = current.scallionQuota ?? quotaFromUser(current.scallionUser ?? userAtRequest)
    if (fallback && current.scallionQuota !== fallback) {
      current.setScallionQuota(fallback)
    }
    current.setScallionSyncState('quota', {
      status: fallback ? 'stale' : 'error',
      error: error instanceof Error ? error.message : '无法同步 Scallion 积分余额',
      updatedAt: fallback?.updatedAt,
    })
    return fallback
  } finally {
    if (timeout !== undefined) {
      globalThis.clearTimeout(timeout)
    }
  }
}

export function quotaFromUser(user?: ScallionUser): ScallionQuota | undefined {
  if (!user) {
    return undefined
  }

  const memberType = typeof user.member_type === 'string' ? user.member_type.trim() : ''
  const planKey = memberType ? normalizePlanKey(memberType) ?? 'free' : 'free'
  const planName = scallionPlanName(planKey)

  const pointsBalance = firstNumber(user.points, user.balance, 0)

  return {
    remaining: pointsBalance,
    pointsBalance,
    balance: user.balance,
    planKey,
    planName,
    planExpiresAt: user.member_expires_at,
    unit: '积分',
    isMember: user.is_member === true,
    memberPriceLabel: '9.9 元/月',
    upgradeUrl: DEFAULT_UPGRADE_URL,
    topUpUrl: DEFAULT_UPGRADE_URL,
    updatedAt: Date.now(),
  }
}

export function normalizeQuota(payload: AccountPayload, user?: ScallionUser): ScallionQuota {
  const accountUser = user ?? payload.user
  const quotaObject = payload.quota && typeof payload.quota === 'object' ? payload.quota : undefined
  const payloadMemberType = typeof payload.member_type === 'string' ? payload.member_type.trim() : ''
  const userMemberType = typeof accountUser?.member_type === 'string' ? accountUser.member_type.trim() : ''
  const fallbackPlanKey = normalizePlanKey(payloadMemberType || userMemberType) ?? 'free'
  const pointsBalance = firstNumber(
    payload.points_balance,
    quotaObject?.points_balance,
    quotaObject?.pointsBalance,
    quotaObject?.remainingPoints,
    quotaObject?.remaining_points,
    quotaObject?.points,
    payload.points,
    payload.remainingPoints,
    payload.remaining_points,
    payload.balance,
    typeof payload.quota === 'number' ? payload.quota : undefined,
    accountUser?.points,
    accountUser?.balance,
    0,
  )
  const balance = firstNumber(payload.balance, quotaObject?.balance, accountUser?.balance)
  const quotaValue = firstNumber(
    typeof payload.quota === 'number' ? payload.quota : undefined,
    quotaObject?.quota,
    quotaObject?.remaining,
  )
  const total = firstNumber(
    quotaObject?.total,
    quotaObject?.totalPoints,
    quotaObject?.total_points,
    payload.totalPoints,
    payload.total_points,
  )

  return {
    remaining: pointsBalance,
    pointsBalance,
    balance,
    quota: quotaValue,
    unifiedPoints: payload.unified_points ?? quotaObject?.unifiedPoints,
    total,
    planKey: normalizePlanKey(payload.plan?.key) ?? fallbackPlanKey,
    planName: payload.plan?.name || scallionPlanName(fallbackPlanKey),
    planExpiresAt: payload.plan?.expires_at ?? accountUser?.member_expires_at,
    unit: quotaObject?.unit || '积分',
    isMember: quotaObject?.isMember ?? payload.is_member ?? accountUser?.is_member === true,
    memberPriceLabel:
      quotaObject?.memberPriceLabel || quotaObject?.member_price_label || payload.member_price_label || '9.9 元/月',
    upgradeUrl: quotaObject?.upgradeUrl || quotaObject?.upgrade_url || payload.upgrade_url || DEFAULT_UPGRADE_URL,
    topUpUrl: quotaObject?.topUpUrl || quotaObject?.top_up_url || payload.top_up_url || DEFAULT_UPGRADE_URL,
    updatedAt: Date.now(),
  }
}

function scallionPlanName(memberType: string) {
  const names: Record<string, string> = {
    free: 'Free',
    briefly: 'Briefly',
    futher: 'Futher',
    deeper: 'Deeper',
  }

  return names[memberType.toLowerCase()] ?? memberType
}

function normalizePlanKey(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  return normalized && normalized !== 'none' ? normalized : undefined
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      continue
    }

    const number = typeof value === 'number' ? value : Number(value)

    if (Number.isFinite(number)) {
      return Math.max(0, number)
    }
  }

  return 0
}

function isUnauthorizedError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'unauthorized')
}
