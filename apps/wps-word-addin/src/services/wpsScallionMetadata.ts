import type {
  WpsScallionChannelState,
  WpsScallionModel,
  WpsScallionPlan,
  WpsScallionQuota,
  WpsScallionRuntimeMetadata,
} from '../types'

const MODELS_API = 'https://scallion.uno/api/papyrus/llm/models'
const QUOTA_API = 'https://scallion.uno/api/papyrus/llm/quota'
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
  available_for_plan?: boolean
  availableForPlan?: boolean
  manual_available?: boolean
  manualAvailable?: boolean
  auto_available?: boolean
  autoAvailable?: boolean
  auto_only?: boolean
  autoOnly?: boolean
  auto_required_plan?: string
  autoRequiredPlan?: string
  allowed?: boolean
  required_plan?: string
  requiredPlan?: string
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

type QuotaPayload = {
  auto?: {
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
  points_balance?: number
  balance?: number
  quota?: number | {
    remaining?: number
    points?: number
    total?: number
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
  }
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
  plan?: ModelPayload['plan']
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
  label: '可用' | '套餐不可用' | '手动不可用' | 'Auto 不可用' | '暂不可用'
  detail: string
}

export function getWpsModelAccess(
  model: Pick<
    WpsScallionModel,
    | 'available'
    | 'planAvailable'
    | 'requiredPlan'
    | 'autoRequiredPlan'
    | 'manualAvailable'
    | 'autoAvailable'
    | 'autoOnly'
    | 'availabilityReason'
  >,
  routingMode: 'manual' | 'auto' = 'manual',
): WpsModelAccess {
  const hasExplicitRoutingAccess =
    model.manualAvailable !== undefined || model.autoAvailable !== undefined || model.autoOnly === true
  if (model.planAvailable === false && !hasExplicitRoutingAccess) {
    return {
      usable: false,
      label: '套餐不可用',
      detail:
        model.availabilityReason ||
        requiredPlanDetail(model, routingMode),
    }
  }

  const modeAvailable =
    routingMode === 'auto'
      ? model.autoAvailable !== false
      : model.manualAvailable !== false && model.autoOnly !== true
  if (!modeAvailable) {
    return {
      usable: false,
      label: routingMode === 'auto' ? 'Auto 不可用' : '手动不可用',
      detail: requiredPlanDetail(model, routingMode),
    }
  }

  if (model.available === false) {
    return {
      usable: false,
      label: '暂不可用',
      detail: model.availabilityReason || '主站暂时不可用，请稍后刷新',
    }
  }

  return {
    usable: true,
    label: '可用',
    detail: routingMode === 'auto' ? '当前套餐可通过 Auto 调用' : '当前套餐可手动调用',
  }
}

function requiredPlanDetail(
  model: Pick<WpsScallionModel, 'requiredPlan' | 'autoRequiredPlan' | 'availabilityReason'>,
  routingMode: 'manual' | 'auto',
) {
  if (model.availabilityReason) return model.availabilityReason
  const requiredPlan = routingMode === 'auto' ? model.autoRequiredPlan || model.requiredPlan : model.requiredPlan
  return requiredPlan ? `需要 ${formatWpsPlanName(requiredPlan)} 套餐` : '当前套餐不可用'
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
  const plan = Array.isArray(payload) ? undefined : payload.plan
  const manualModels = normalizeStringList(plan?.manual_models ?? plan?.manualModels)
  const autoModels = normalizeStringList(plan?.auto_models ?? plan?.autoModels)
  const hasManualModels = Array.isArray(plan?.manual_models) || Array.isArray(plan?.manualModels)
  const hasAutoModels = Array.isArray(plan?.auto_models) || Array.isArray(plan?.autoModels)
  const byId = new Map<string, WpsScallionModel>()

  for (const model of rawModels) {
    const id = String(model.id ?? model.modelName ?? model.model_name ?? '').trim()
    if (!id) continue
    const explicitManual = model.manual_available ?? model.manualAvailable
    const explicitAuto = model.auto_available ?? model.autoAvailable
    const manualAvailable = explicitManual ?? (hasManualModels ? manualModels.includes(id) : undefined)
    const autoAvailable = explicitAuto ?? (hasAutoModels ? autoModels.includes(id) : undefined)
    const autoOnly = model.auto_only ?? model.autoOnly ?? (manualAvailable === false && autoAvailable !== false)
    const legacyPlanAvailable =
      model.plan_available ??
      model.planAvailable ??
      model.available_for_plan ??
      model.availableForPlan ??
      model.allowed
    const planAvailable =
      legacyPlanAvailable ??
      (hasManualModels || hasAutoModels ? manualAvailable !== false || autoAvailable !== false : true)
    const normalized: WpsScallionModel = {
      id,
      name: String(model.name ?? model.displayName ?? model.label ?? model.modelName ?? id).trim(),
      modelName: id,
      provider: model.provider,
      contextWindowTokens: positiveNumber(model.context_window_tokens ?? model.contextWindowTokens),
      contextWindowLabel: model.context_window_label ?? model.contextWindowLabel,
      planAvailable,
      requiredPlan: model.required_plan ?? model.requiredPlan,
      manualAvailable,
      autoAvailable,
      autoOnly,
      autoRequiredPlan: model.auto_required_plan ?? model.autoRequiredPlan,
      availabilityReason: model.availability_reason ?? model.availabilityReason,
      available: model.available ?? model.enabled ?? true,
    }
    const previous = byId.get(id)
    byId.set(id, previous ? mergeWpsModel(previous, normalized) : normalized)
  }

  return Array.from(byId.values())
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
    manualModels: normalizeStringList(
      payload.manual_models ?? payload.manualModels ?? quotaObject?.manual_models ?? quotaObject?.manualModels ?? payload.plan?.manual_models ?? payload.plan?.manualModels,
    ),
    autoModels: normalizeStringList(
      payload.auto_models ?? payload.autoModels ?? quotaObject?.auto_models ?? quotaObject?.autoModels ?? payload.plan?.auto_models ?? payload.plan?.autoModels,
    ),
    autoMonthlyCalls: firstOptionalNumber(
      payload.auto_monthly_calls,
      payload.autoMonthlyCalls,
      quotaObject?.auto_monthly_calls,
      quotaObject?.autoMonthlyCalls,
      payload.auto?.monthly_limit,
      payload.auto?.monthlyLimit,
      payload.plan?.auto_monthly_calls,
      payload.plan?.autoMonthlyCalls,
    ),
    autoDailyCalls: firstOptionalNumber(
      payload.auto_daily_calls,
      payload.autoDailyCalls,
      quotaObject?.auto_daily_calls,
      quotaObject?.autoDailyCalls,
      payload.auto?.daily_limit,
      payload.auto?.dailyLimit,
      payload.plan?.auto_daily_calls,
      payload.plan?.autoDailyCalls,
    ),
    autoMonthlyUsed: firstOptionalNumber(payload.auto_monthly_used, payload.autoMonthlyUsed, quotaObject?.auto_monthly_used, quotaObject?.autoMonthlyUsed, payload.auto?.monthly_used, payload.auto?.monthlyUsed),
    autoDailyUsed: firstOptionalNumber(payload.auto_daily_used, payload.autoDailyUsed, quotaObject?.auto_daily_used, quotaObject?.autoDailyUsed, payload.auto?.daily_used, payload.auto?.dailyUsed),
    autoMonthlyRemaining: firstOptionalNumber(payload.auto_monthly_remaining, payload.autoMonthlyRemaining, quotaObject?.auto_monthly_remaining, quotaObject?.autoMonthlyRemaining, payload.auto?.monthly_remaining, payload.auto?.monthlyRemaining),
    autoDailyRemaining: firstOptionalNumber(payload.auto_daily_remaining, payload.autoDailyRemaining, quotaObject?.auto_daily_remaining, quotaObject?.autoDailyRemaining, payload.auto?.daily_remaining, payload.auto?.dailyRemaining),
    externalApi: firstExternalApi(payload.external_api, payload.externalApi, quotaObject?.external_api, quotaObject?.externalApi, payload.plan?.external_api, payload.plan?.externalApi),
    updatedAt: Date.now(),
  }
}

function normalizeWpsPlan(plan?: ModelPayload['plan'] | QuotaPayload['plan']): WpsScallionPlan | undefined {
  if (!plan) return undefined

  const key = typeof plan.key === 'string' ? plan.key.trim() : ''
  const name = typeof plan.name === 'string' ? plan.name.trim() : ''
  const expiresAt = typeof plan.expires_at === 'string' || plan.expires_at === null ? plan.expires_at : undefined
  const manualModels = Array.isArray(plan.manual_models) || Array.isArray(plan.manualModels)
    ? normalizeStringList(plan.manual_models ?? plan.manualModels)
    : undefined
  const autoModels = Array.isArray(plan.auto_models) || Array.isArray(plan.autoModels)
    ? normalizeStringList(plan.auto_models ?? plan.autoModels)
    : undefined

  if (!key && !name && expiresAt === undefined && !manualModels && !autoModels) return undefined

  return {
    ...(key ? { key } : {}),
    ...(name ? { name } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(manualModels ? { manualModels } : {}),
    ...(autoModels ? { autoModels } : {}),
    autoMonthlyCalls: firstOptionalNumber(plan.auto_monthly_calls, plan.autoMonthlyCalls),
    autoDailyCalls: firstOptionalNumber(plan.auto_daily_calls, plan.autoDailyCalls),
    externalApi: firstExternalApi(plan.external_api, plan.externalApi),
  }
}

function positiveNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined
}

function nonNegativeNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : []
}

function firstExternalApi(...values: unknown[]): boolean | string | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function mergeWpsModel(previous: WpsScallionModel, next: WpsScallionModel): WpsScallionModel {
  return {
    ...previous,
    ...Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== undefined && value !== ''),
    ),
    manualAvailable: previous.manualAvailable ?? next.manualAvailable,
    autoAvailable: previous.autoAvailable ?? next.autoAvailable,
    autoOnly: previous.autoOnly ?? next.autoOnly,
    planAvailable: previous.planAvailable ?? next.planAvailable,
    available: previous.available !== false && next.available !== false,
  }
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
    const number = nonNegativeNumber(value)
    if (number !== undefined) return number
  }
  return undefined
}
