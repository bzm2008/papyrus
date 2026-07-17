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

let quotaRefreshInFlight: { token: string; promise: Promise<ScallionQuota | undefined> } | undefined
let modelsRefreshInFlight: { token: string; promise: Promise<ScallionModelMetadata[]> } | undefined

export type ScallionQuotaDisplay = {
  value?: number
  source: 'realtime' | 'cached' | 'unavailable'
  status: ScallionSyncStatus
}
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
    manual_models?: unknown
    manualModels?: unknown
    auto_models?: unknown
    autoModels?: unknown
    auto?: {
      monthly_limit?: number
      daily_limit?: number
      monthly_used?: number
      daily_used?: number
      monthly_remaining?: number
      daily_remaining?: number
    }
    plan?: {
      key?: string
      name?: string
      expires_at?: string | null
      manual_models?: string[]
      auto_models?: string[]
      auto_monthly_calls?: number
      auto_daily_calls?: number
      external_api?: boolean | string
    }
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
  plan?: {
    key?: string
    name?: string
    expires_at?: string | null
    manual_models?: string[]
    auto_models?: string[]
    auto_monthly_calls?: number
    auto_daily_calls?: number
    external_api?: boolean | string
  }
  auto?: {
    monthly_limit?: number
    daily_limit?: number
    monthly_used?: number
    daily_used?: number
    monthly_remaining?: number
    daily_remaining?: number
  }
}

export async function refreshScallionRuntimeMetadata() {
  await Promise.allSettled([refreshScallionModels(), refreshScallionQuota()])
}

export function refreshScallionModels(options: { force?: boolean } = {}) {
  const state = useAppStore.getState()

  if (!state.scallionToken) {
    state.setScallionModelMetadata([])
    state.setScallionPlan(undefined)
    state.setScallionSyncState('models', { status: 'idle', error: undefined, attemptedAt: Date.now() })
    return Promise.resolve([])
  }

  const tokenAtRequest = state.scallionToken
  if (!options.force && modelsRefreshInFlight?.token === tokenAtRequest) {
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
    catalog = await fetchScallionProxyModelCatalog(provider)
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
  const current = useAppStore.getState()
  // The catalog parser is intentionally pure. Commit its plan only after the
  // JWT freshness check so an old account response cannot alter a new session.
  current.setScallionPlan(catalog.plan)
  if (catalog.plan?.key === 'free' && catalog.plan.manualModels?.length === 0 && (catalog.plan.autoModels?.length ?? 0) > 0) {
    current.setModelRoutingMode('auto')
  }
  const models = catalog.models
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
    manualAvailable: model.manualAvailable ?? model.planAvailable !== false,
    autoAvailable: model.autoAvailable ?? model.planAvailable !== false,
    autoOnly: model.autoOnly === true,
    requiredPlan: model.requiredPlan,
    autoRequiredPlan: model.autoRequiredPlan,
    availabilityReason: model.availabilityReason,
    // `plan_available` describes manual selection for the new gateway. An
    // Auto-only model must remain visible and routable through Auto.
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
    state.setScallionPlan(undefined)
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

    if (!hasQuotaBalance(payload, payload.user ?? userAtRequest)) {
      const error = new Error('Scallion 额度响应缺少 points_balance，请稍后重试')
      ;(error as Error & { code?: string }).code = 'protocol_error'
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
    // Free has no manual model entitlement in the gateway contract.
    if (quota.planKey === 'free') {
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

/** Only a successful authenticated quota sync is labelled realtime. */
export function getScallionQuotaDisplay(input: {
  token?: string
  quota?: ScallionQuota
  user?: ScallionUser
  syncStatus?: ScallionSyncStatus
}): ScallionQuotaDisplay {
  const status = input.syncStatus ?? 'idle'
  const livePoints = finiteNumber(input.quota?.pointsBalance)
  const fallbackPoints = [input.quota?.remaining, input.user?.points, input.user?.balance]
    .map(finiteNumber)
    .find((value): value is number => value !== undefined)

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

  const auto = payload.auto ?? quotaObject?.auto
  const plan = payload.plan ?? quotaObject?.plan
  const quotaAuto = quotaObject?.auto
  const quotaPayload = quotaObject as (Partial<ScallionQuota> & {
    manual_models?: unknown
    auto_models?: unknown
    manualModels?: unknown
    autoModels?: unknown
  }) | undefined
  const manualModels = normalizeStringList(
    payload.manual_models ?? payload.manualModels ?? quotaPayload?.manual_models ?? quotaPayload?.manualModels ?? plan?.manual_models,
  )
  const autoModels = normalizeStringList(
    payload.auto_models ?? payload.autoModels ?? quotaPayload?.auto_models ?? quotaPayload?.autoModels ?? plan?.auto_models,
  )

  return {
    remaining: pointsBalance,
    pointsBalance,
    balance,
    quota: quotaValue,
    unifiedPoints: payload.unified_points ?? quotaObject?.unifiedPoints,
    total,
    planKey: normalizePlanKey(plan?.key) ?? fallbackPlanKey,
    planName: plan?.name || scallionPlanName(fallbackPlanKey),
    planExpiresAt: plan?.expires_at ?? accountUser?.member_expires_at,
    unit: quotaObject?.unit || '积分',
    isMember: quotaObject?.isMember ?? payload.is_member ?? accountUser?.is_member === true,
    manualModels,
    autoModels,
    autoMonthlyCalls: firstOptionalNumber(payload.auto_monthly_calls, payload.autoMonthlyCalls, plan?.auto_monthly_calls, auto?.monthly_limit, quotaAuto?.monthly_limit),
    autoDailyCalls: firstOptionalNumber(payload.auto_daily_calls, payload.autoDailyCalls, plan?.auto_daily_calls, auto?.daily_limit, quotaAuto?.daily_limit),
    autoMonthlyUsed: firstOptionalNumber(payload.auto_monthly_used, payload.autoMonthlyUsed, auto?.monthly_used, quotaAuto?.monthly_used),
    autoDailyUsed: firstOptionalNumber(payload.auto_daily_used, payload.autoDailyUsed, auto?.daily_used, quotaAuto?.daily_used),
    autoMonthlyRemaining: firstOptionalNumber(payload.auto_monthly_remaining, payload.autoMonthlyRemaining, auto?.monthly_remaining, quotaAuto?.monthly_remaining),
    autoDailyRemaining: firstOptionalNumber(payload.auto_daily_remaining, payload.autoDailyRemaining, auto?.daily_remaining, quotaAuto?.daily_remaining),
    externalApi: firstExternalApi(payload.external_api, payload.externalApi, plan?.external_api),
    memberPriceLabel:
      quotaObject?.memberPriceLabel || quotaObject?.member_price_label || payload.member_price_label || '9.9 元/月',
    upgradeUrl: quotaObject?.upgradeUrl || quotaObject?.upgrade_url || payload.upgrade_url || DEFAULT_UPGRADE_URL,
    topUpUrl: quotaObject?.topUpUrl || quotaObject?.top_up_url || payload.top_up_url || DEFAULT_UPGRADE_URL,
    updatedAt: Date.now(),
  }
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : []
}

function firstExternalApi(...values: unknown[]): boolean | string | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function firstOptionalNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    const number = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(number)) return Math.max(0, number)
  }
  return undefined
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

function finiteNumber(value: unknown) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return undefined
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : undefined
}

function hasQuotaBalance(payload: AccountPayload, user?: ScallionUser) {
  const quotaObject = payload.quota && typeof payload.quota === 'object' ? payload.quota : undefined
  return [
    payload.points_balance,
    quotaObject?.points_balance,
    quotaObject?.pointsBalance,
    payload.balance,
    payload.points,
    payload.remainingPoints,
    payload.remaining_points,
    typeof payload.quota === 'number' ? payload.quota : undefined,
    quotaObject?.quota,
    quotaObject?.remaining,
    user?.points,
    user?.balance,
  ].some((value) => finiteNumber(value) !== undefined)
}

function isUnauthorizedError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'unauthorized')
}
