import type {
  WpsScallionChannelState,
  WpsScallionModel,
  WpsScallionPlan,
  WpsScallionQuota,
  WpsScallionRuntimeMetadata,
} from '../types'

const MODELS_API = 'https://api.sca-hub.cn/api/papyrus/llm/models'
const QUOTA_API = 'https://api.sca-hub.cn/api/papyrus/llm/quota'
const REQUEST_TIMEOUT_MS = 15_000

type RawModel = {
  id?: string
  name?: string
  displayName?: string
  label?: string
  modelName?: string
  model_name?: string
  provider?: string
  available?: boolean
  enabled?: boolean
  plan_available?: boolean
  planAvailable?: boolean
  manual_available?: boolean
  manualAvailable?: boolean
  auto_available?: boolean
  autoAvailable?: boolean
  auto_only?: boolean
  autoOnly?: boolean
  available_for_plan?: boolean
  availableForPlan?: boolean
  required_plan?: string
  requiredPlan?: string
  auto_required_plan?: string
  autoRequiredPlan?: string
  availability_reason?: string
  availabilityReason?: string
  context_window_tokens?: number
  contextWindowTokens?: number
  context_window_label?: string
  contextWindowLabel?: string
}

type ModelPayload = {
  data?: RawModel[]
  models?: RawModel[]
  plan?: {
    key?: string
    name?: string
    expires_at?: string | null
    auto_monthly_calls?: number | null
    auto_daily_calls?: number | null
    auto_daily_unlimited?: boolean
    manual_models?: string[]
    auto_models?: string[]
  }
}

type QuotaPayload = {
  points_balance?: number
  balance?: number
  quota?: number | {
    remaining?: number
    points?: number
    total?: number
    auto?: {
      monthly_limit?: number | null
      daily_limit?: number | null
      daily_unlimited?: boolean
      monthly_used?: number
      daily_used?: number
      monthly_remaining?: number | null
      daily_remaining?: number | null
    }
  }
  plan?: {
    key?: string
    name?: string
    expires_at?: string | null
    auto_monthly_calls?: number | null
    auto_daily_calls?: number | null
    auto_daily_unlimited?: boolean
    manual_models?: string[]
    auto_models?: string[]
  }
  auto_monthly_calls?: number | null
  auto_daily_calls?: number | null
  auto_daily_unlimited?: boolean
  auto?: {
    monthly_limit?: number | null
    daily_limit?: number | null
    daily_unlimited?: boolean
    monthly_used?: number
    daily_used?: number
    monthly_remaining?: number | null
    daily_remaining?: number | null
  }
}

export async function fetchWpsScallionRuntimeMetadata(token: string): Promise<WpsScallionRuntimeMetadata> {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` }
  const [modelsResult, quotaResult] = await Promise.allSettled([
    fetchWithTimeout(`${MODELS_API}?include_unavailable=1`, { headers }),
    fetchWithTimeout(QUOTA_API, { headers }),
  ])

  const modelsResponse = fulfilledResponse(modelsResult)
  const quotaResponse = fulfilledResponse(quotaResult)
  const unauthorizedResponse = [modelsResponse, quotaResponse].find((response) => response?.status === 401)
  if (unauthorizedResponse) {
    const error = new Error('Scallion 登录已过期，请重新登录。') as Error & { code?: string; status?: number }
    error.code = 'unauthorized'
    error.status = 401
    throw error
  }

  const modelsPayload = modelsResponse
    ? ((await modelsResponse.json().catch(() => ({}))) as ModelPayload)
    : undefined
  const quotaPayload = quotaResponse
    ? ((await quotaResponse.json().catch(() => ({}))) as QuotaPayload)
    : undefined
  const modelsReady = Boolean(modelsResponse?.ok)
  const quotaReady = Boolean(quotaResponse?.ok)
  const modelsSync = channelState(modelsReady, modelsReady ? undefined : channelError('模型目录', modelsResult))
  const quotaSync = channelState(quotaReady, quotaReady ? undefined : channelError('积分额度', quotaResult))
  const plan = normalizeWpsPlan(quotaPayload?.plan ?? modelsPayload?.plan)

  return {
    models: modelsReady && modelsPayload ? parseWpsModelPayload(modelsPayload) : [],
    plan,
    quota:
      quotaReady && quotaPayload
        ? normalizeWpsQuota({ ...quotaPayload, plan: quotaPayload.plan ?? modelsPayload?.plan })
        : undefined,
    modelsSync,
    quotaSync,
  }
}

export function beginWpsRuntimeMetadataRefresh(
  previous?: WpsScallionRuntimeMetadata,
): WpsScallionRuntimeMetadata {
  return {
    models: previous?.models ?? [],
    plan: previous?.plan,
    quota: previous?.quota,
    modelsSync: { ...(previous?.modelsSync ?? { status: 'error' as const }), status: 'syncing', error: undefined },
    quotaSync: { ...(previous?.quotaSync ?? { status: 'error' as const }), status: 'syncing', error: undefined },
  }
}

export function mergeWpsRuntimeMetadata(
  previous: WpsScallionRuntimeMetadata | undefined,
  next: WpsScallionRuntimeMetadata,
): WpsScallionRuntimeMetadata {
  const modelsFailed = next.modelsSync.status === 'error'
  const quotaFailed = next.quotaSync.status === 'error'
  const modelsHavePrevious = Boolean(previous?.models.length)
  const quotaHasPrevious = Boolean(previous?.quota)

  return {
    models: next.modelsSync.status === 'ready' ? next.models : previous?.models ?? next.models,
    plan: next.plan ?? previous?.plan,
    quota: next.quotaSync.status === 'ready' ? next.quota : previous?.quota,
    modelsSync: {
      ...next.modelsSync,
      status: modelsFailed && modelsHavePrevious ? 'stale' : next.modelsSync.status,
    },
    quotaSync: {
      ...next.quotaSync,
      status: quotaFailed && quotaHasPrevious ? 'stale' : next.quotaSync.status,
    },
  }
}

export type WpsModelAccess = {
  usable: boolean
  label: '可用' | '仅 Auto 可用' | '套餐不可用' | '暂不可用'
  detail: string
}

export function getWpsModelAccess(
  model: Pick<WpsScallionModel, 'available' | 'planAvailable' | 'manualAvailable' | 'autoAvailable' | 'autoOnly' | 'requiredPlan' | 'autoRequiredPlan' | 'availabilityReason'>,
): WpsModelAccess {
  if (model.available === false) {
    return {
      usable: false,
      label: '暂不可用',
      detail: model.availabilityReason || '主站暂时不可用，请稍后刷新',
    }
  }

  const manualAvailable = model.manualAvailable ?? model.planAvailable !== false
  if (manualAvailable) {
    return {
      usable: true,
      label: '可用',
      detail: '当前套餐可手动调用',
    }
  }

  if (model.autoAvailable === true || model.autoOnly === true) {
    return {
      usable: false,
      label: '仅 Auto 可用',
      detail: model.availabilityReason || '当前套餐可由主站 Auto 路由使用',
    }
  }

  return {
    usable: false,
    label: '套餐不可用',
    detail: model.availabilityReason || (model.requiredPlan ? `需要 ${formatWpsPlanName(model.requiredPlan)} 套餐` : '当前套餐不可用'),
  }
}

export function formatWpsPlanName(value?: string) {
  const names: Record<string, string> = {
    free: 'Free',
    briefly: 'Briefly',
    futher: 'Futher',
    deeper: 'Deeper',
  }
  const normalized = value?.trim().toLowerCase() ?? ''
  if (!normalized || normalized === 'none') return 'Free'
  return names[normalized] ?? value?.trim() ?? 'Free'
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Scallion 套餐和模型同步超时，请稍后重试。', { cause: error })
    }
    throw error
  } finally {
    globalThis.clearTimeout(timer)
  }
}

export function parseWpsModelPayload(payload: ModelPayload | RawModel[]): WpsScallionModel[] {
  const rawModels = Array.isArray(payload) ? payload : payload.data ?? payload.models ?? []

  return rawModels
    .map((model) => {
      const id = String(model.id ?? '').trim()
      const name = String(model.name ?? model.displayName ?? model.label ?? model.modelName ?? id).trim()
      const planAvailable =
        model.plan_available ?? model.planAvailable ?? model.available_for_plan ?? model.availableForPlan ?? true
      const available = model.available ?? model.enabled ?? true
      const contextWindowTokens = positiveNumber(model.context_window_tokens ?? model.contextWindowTokens)

      return {
        id,
        name,
        modelName: id,
        provider: model.provider,
        contextWindowTokens,
        contextWindowLabel: model.context_window_label ?? model.contextWindowLabel,
        planAvailable,
        manualAvailable: model.manual_available ?? model.manualAvailable,
        autoAvailable: model.auto_available ?? model.autoAvailable,
        autoOnly: model.auto_only ?? model.autoOnly,
        requiredPlan: model.required_plan ?? model.requiredPlan,
        autoRequiredPlan: model.auto_required_plan ?? model.autoRequiredPlan,
        availabilityReason: model.availability_reason ?? model.availabilityReason,
        available,
      }
    })
    .filter((model) => Boolean(model.id))
}

function fulfilledResponse(result: PromiseSettledResult<Response>) {
  return result.status === 'fulfilled' ? result.value : undefined
}

function channelState(ok: boolean, error?: string): WpsScallionChannelState {
  return {
    status: ok ? 'ready' : 'error',
    ...(error ? { error } : {}),
    ...(ok ? { updatedAt: Date.now() } : {}),
  }
}

function channelError(label: string, result: PromiseSettledResult<Response>) {
  if (result.status === 'rejected') {
    return result.reason instanceof Error ? result.reason.message : `${label}同步失败`
  }
  return `${label}请求失败：HTTP ${result.value.status}`
}

export function normalizeWpsQuota(payload: QuotaPayload): WpsScallionQuota {
  const quotaObject = payload.quota && typeof payload.quota === 'object' ? payload.quota : undefined
  const auto = payload.auto ?? quotaObject?.auto
  const autoDailyUnlimited = firstBoolean(
    payload.auto_daily_unlimited,
    auto?.daily_unlimited,
    payload.plan?.auto_daily_unlimited,
  )
  const pointsBalance = firstNumber(
    payload.points_balance,
    quotaObject?.points,
    quotaObject?.remaining,
    payload.balance,
    typeof payload.quota === 'number' ? payload.quota : undefined,
  )

  return {
    pointsBalance,
    balance: firstNumber(payload.balance),
    quota: firstNumber(typeof payload.quota === 'number' ? payload.quota : quotaObject?.remaining),
    planKey: payload.plan?.key,
    planName: payload.plan?.name,
    planExpiresAt: payload.plan?.expires_at,
    autoMonthlyCalls: firstOptionalNumber(payload.auto_monthly_calls, payload.plan?.auto_monthly_calls, auto?.monthly_limit),
    autoDailyCalls: autoDailyUnlimited
      ? null
      : firstOptionalLimit(payload.auto_daily_calls, payload.plan?.auto_daily_calls, auto?.daily_limit),
    autoMonthlyUsed: firstOptionalNumber(auto?.monthly_used),
    autoDailyUsed: firstOptionalNumber(auto?.daily_used),
    autoMonthlyRemaining: firstOptionalNumber(auto?.monthly_remaining),
    autoDailyRemaining: autoDailyUnlimited ? null : firstOptionalLimit(auto?.daily_remaining),
    autoDailyUnlimited,
    updatedAt: Date.now(),
  }
}

function normalizeWpsPlan(plan?: ModelPayload['plan'] | QuotaPayload['plan']): WpsScallionPlan | undefined {
  if (!plan) return undefined

  const key = typeof plan.key === 'string' ? plan.key.trim() : ''
  const name = typeof plan.name === 'string' ? plan.name.trim() : ''
  const expiresAt = typeof plan.expires_at === 'string' || plan.expires_at === null ? plan.expires_at : undefined

  if (!key && !name && expiresAt === undefined) return undefined

  return {
    ...(key ? { key } : {}),
    ...(name ? { name } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(plan.auto_monthly_calls !== undefined ? { autoMonthlyCalls: firstOptionalNumber(plan.auto_monthly_calls) } : {}),
    ...(plan.auto_daily_calls !== undefined ? { autoDailyCalls: plan.auto_daily_calls === null ? null : firstOptionalLimit(plan.auto_daily_calls) } : {}),
    ...(plan.auto_daily_unlimited === true ? { autoDailyUnlimited: true } : {}),
    ...(Array.isArray(plan.manual_models) ? { manualModels: normalizeStringList(plan.manual_models) } : {}),
    ...(Array.isArray(plan.auto_models) ? { autoModels: normalizeStringList(plan.auto_models) } : {}),
  }
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : []
}

function positiveNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number)) return Math.max(0, number)
  }
  return 0
}

function firstOptionalNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    const number = Number(value)
    if (Number.isFinite(number)) return Math.max(0, number)
  }
  return undefined
}

function firstOptionalLimit(...values: unknown[]): number | null | undefined {
  for (const value of values) {
    if (value === null) return null
    if (value === undefined || value === '') continue
    const number = Number(value)
    if (Number.isFinite(number)) return Math.max(0, number)
  }
  return undefined
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true') return true
      if (normalized === 'false') return false
    }
  }
  return undefined
}
