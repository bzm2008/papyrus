import { fetchScallionProxyModelCatalog } from './llmClient'
import { buildModelTierAssessments } from './modelGovernanceService'
import {
  useAppStore,
  type ScallionModelMetadata,
  type ScallionQuota,
  type ScallionSyncStatus,
  type ScallionUser,
} from '../stores/useAppStore'

const SCALLION_QUOTA_API = 'https://scallion.uno/api/papyrus/llm/quota'
const DEFAULT_UPGRADE_URL = 'https://scallion.uno/pricing'
const SCALLION_REQUEST_TIMEOUT_MS = 15_000

export type ScallionQuotaDisplay = {
  value?: number
  source: 'realtime' | 'cached' | 'unavailable'
  status: ScallionSyncStatus
}

let quotaRefreshInFlight: { token: string; promise: Promise<ScallionQuota | undefined> } | undefined
let modelsRefreshInFlight: { token: string; promise: Promise<ScallionModelMetadata[]> } | undefined

type AccountPayload = {
  user?: ScallionUser
  auto?: AutoQuotaPayload
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
    manual_models?: unknown
    auto_models?: unknown
    auto_monthly_calls?: unknown
    auto_daily_calls?: unknown
    auto_monthly_used?: unknown
    auto_daily_used?: unknown
    auto_monthly_remaining?: unknown
    auto_daily_remaining?: unknown
    external_api?: boolean | string
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
  manual_models?: unknown
  manualModels?: unknown
  auto_models?: unknown
  autoModels?: unknown
  auto_monthly_calls?: unknown
  autoMonthlyCalls?: unknown
  auto_daily_calls?: unknown
  autoDailyCalls?: unknown
  auto_monthly_used?: unknown
  autoMonthlyUsed?: unknown
  auto_daily_used?: unknown
  autoDailyUsed?: unknown
  auto_monthly_remaining?: unknown
  autoMonthlyRemaining?: unknown
  auto_daily_remaining?: unknown
  autoDailyRemaining?: unknown
  external_api?: boolean | string
  externalApi?: boolean | string
  member_type?: string
  is_member?: boolean
  plan?: {
    key?: string
    name?: string
    expires_at?: string | null
    manual_models?: unknown
    manualModels?: unknown
    auto_models?: unknown
    autoModels?: unknown
    auto_monthly_calls?: unknown
    autoMonthlyCalls?: unknown
    auto_daily_calls?: unknown
    autoDailyCalls?: unknown
    external_api?: boolean | string
    externalApi?: boolean | string
  }
}

type AutoQuotaPayload = {
  monthly_limit?: unknown
  daily_limit?: unknown
  monthly_used?: unknown
  daily_used?: unknown
  monthly_remaining?: unknown
  daily_remaining?: unknown
  monthlyLimit?: unknown
  dailyLimit?: unknown
  monthlyUsed?: unknown
  dailyUsed?: unknown
  monthlyRemaining?: unknown
  dailyRemaining?: unknown
}

export async function refreshScallionRuntimeMetadata() {
  await Promise.allSettled([refreshScallionModels(), refreshScallionQuota()])
}

export function refreshScallionModels() {
  const state = useAppStore.getState()

  if (!state.scallionToken) {
    state.setScallionModelMetadata([])
    state.setScallionPlan(undefined)
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
  let catalog: Awaited<ReturnType<typeof fetchScallionProxyModelCatalog>>

  try {
    // The selector must be able to explain plan restrictions, so always ask
    // the gateway for its complete public catalog. The gateway still remains
    // the authority for which entries are callable.
    catalog = await fetchScallionProxyModelCatalog(provider, { includeUnavailable: true })
  } catch (error) {
    if (isUnauthorizedError(error) && useAppStore.getState().scallionToken === tokenAtRequest) {
      useAppStore.getState().expireScallionSession()
    }
    throw error
  }
  if (useAppStore.getState().scallionToken !== tokenAtRequest) {
    return []
  }
  if (catalog.plan) {
    const current = useAppStore.getState()
    // A successful quota response is the billing authority. Do not let a
    // slower model-directory response overwrite a newer quota plan.
    if (current.scallionSync.quota.status !== 'ready') {
      current.setScallionPlan(catalog.plan)
    }
    if (catalog.plan.manualModels?.length === 0 && (catalog.plan.autoModels?.length ?? 0) > 0) {
      current.setModelRoutingMode('auto')
    }
  }
  const models = catalog.models
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
    manualAvailable: model.manualAvailable,
    autoAvailable: model.autoAvailable,
    autoOnly: model.autoOnly === true,
    autoRequiredPlan: model.autoRequiredPlan,
    requiredPlan: model.requiredPlan,
    availabilityReason: model.availabilityReason,
    available: model.available !== false,
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
      cache: 'no-store',
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

    if (!hasQuotaBalance(payload, payload.user ?? userAtRequest)) {
      const error = new Error('Scallion 额度响应缺少 points_balance，请稍后重试')
      ;(error as Error & { code?: string }).code = 'protocol_error'
      throw error
    }

    if (payload.user) {
      useAppStore.getState().setScallionSession(token, payload.user)
    }

    const quota = normalizeQuota(payload, payload.user ?? userAtRequest)
    useAppStore.getState().setScallionQuota(quota)
    if (quota.manualModels?.length === 0 && (quota.autoModels?.length ?? 0) > 0) {
      useAppStore.getState().setModelRoutingMode('auto')
    }
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
    const planFromModelCatalog = current.scallionPlan
    const fallback = current.scallionQuota ?? quotaFromUser(current.scallionUser ?? userAtRequest)
    if (fallback && current.scallionQuota !== fallback) {
      current.setScallionQuota(fallback)
      // A model catalog response carries the same entitlement and may win the
      // race while the quota endpoint is temporarily unavailable. Keep it
      // instead of replacing it with an older user snapshot.
      if (planFromModelCatalog) {
        current.setScallionPlan(planFromModelCatalog)
      }
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

/**
 * Keep quota labels honest at every surface. Only a successful quota response
 * carrying points_balance is allowed to be called realtime; persisted account
 * data and the last successful value are explicitly treated as cached.
 */
export function getScallionQuotaDisplay(input: {
  token?: string
  quota?: ScallionQuota
  user?: ScallionUser
  syncStatus?: ScallionSyncStatus
}): ScallionQuotaDisplay {
  const status = input.syncStatus ?? 'idle'
  const livePoints = finiteNumber(input.quota?.pointsBalance)
  const fallbackPoints = firstFiniteNumber(
    input.quota?.remaining,
    input.user?.points,
    input.user?.balance,
  )

  if (input.token?.trim() && status === 'ready' && livePoints !== undefined) {
    return { value: livePoints, source: 'realtime', status }
  }

  const cachedValue = livePoints ?? fallbackPoints
  return {
    value: cachedValue,
    source: cachedValue === undefined ? 'unavailable' : 'cached',
    status,
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
  const manualModels = normalizeStringList(
    payload.manual_models ??
      payload.manualModels ??
      quotaObject?.manual_models ??
      quotaObject?.manualModels ??
      payload.plan?.manual_models ??
      payload.plan?.manualModels,
  )
  const autoModels = normalizeStringList(
    payload.auto_models ??
      payload.autoModels ??
      quotaObject?.auto_models ??
      quotaObject?.autoModels ??
      payload.plan?.auto_models ??
      payload.plan?.autoModels,
  )
  const autoMonthlyCalls = firstOptionalNumber(
    payload.auto_monthly_calls,
    payload.autoMonthlyCalls,
    quotaObject?.auto_monthly_calls,
    quotaObject?.autoMonthlyCalls,
    payload.auto?.monthly_limit,
    payload.auto?.monthlyLimit,
    payload.plan?.auto_monthly_calls,
    payload.plan?.autoMonthlyCalls,
  )
  const autoDailyCalls = firstOptionalNumber(
    payload.auto_daily_calls,
    payload.autoDailyCalls,
    quotaObject?.auto_daily_calls,
    quotaObject?.autoDailyCalls,
    payload.auto?.daily_limit,
    payload.auto?.dailyLimit,
    payload.plan?.auto_daily_calls,
    payload.plan?.autoDailyCalls,
  )
  const autoMonthlyUsed = firstOptionalNumber(
    payload.auto_monthly_used,
    payload.autoMonthlyUsed,
    quotaObject?.auto_monthly_used,
    quotaObject?.autoMonthlyUsed,
    payload.auto?.monthly_used,
    payload.auto?.monthlyUsed,
  )
  const autoDailyUsed = firstOptionalNumber(
    payload.auto_daily_used,
    payload.autoDailyUsed,
    quotaObject?.auto_daily_used,
    quotaObject?.autoDailyUsed,
    payload.auto?.daily_used,
    payload.auto?.dailyUsed,
  )
  const autoMonthlyRemaining = firstOptionalNumber(
    payload.auto_monthly_remaining,
    payload.autoMonthlyRemaining,
    quotaObject?.auto_monthly_remaining,
    quotaObject?.autoMonthlyRemaining,
    payload.auto?.monthly_remaining,
    payload.auto?.monthlyRemaining,
  )
  const autoDailyRemaining = firstOptionalNumber(
    payload.auto_daily_remaining,
    payload.autoDailyRemaining,
    quotaObject?.auto_daily_remaining,
    quotaObject?.autoDailyRemaining,
    payload.auto?.daily_remaining,
    payload.auto?.dailyRemaining,
  )

  return {
    remaining: pointsBalance,
    pointsBalance,
    balance,
    quota: quotaValue,
    unifiedPoints: payload.unified_points ?? quotaObject?.unifiedPoints,
    manualModels,
    autoModels,
    autoMonthlyCalls,
    autoDailyCalls,
    autoMonthlyUsed,
    autoDailyUsed,
    autoMonthlyRemaining,
    autoDailyRemaining,
    externalApi: firstExternalApi(
      payload.external_api,
      payload.externalApi,
      quotaObject?.external_api,
      quotaObject?.externalApi,
      payload.plan?.external_api,
      payload.plan?.externalApi,
    ),
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

function firstOptionalNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) continue
    const number = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(number)) return Math.max(0, number)
  }
  return undefined
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : []
}

function firstExternalApi(...values: unknown[]): boolean | string | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const number = finiteNumber(value)
    if (number !== undefined) {
      return number
    }
  }
  return undefined
}

function finiteNumber(value: unknown) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return undefined
  }
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : undefined
}

function hasQuotaBalance(payload: AccountPayload, user?: ScallionUser) {
  const quotaObject = payload.quota && typeof payload.quota === 'object' ? payload.quota : undefined
  const values: unknown[] = [
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
    quotaObject?.quota,
    quotaObject?.remaining,
    user?.points,
    user?.balance,
  ]

  return values.some((value) => {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      return false
    }
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(number)
  })
}

function isUnauthorizedError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'unauthorized')
}
