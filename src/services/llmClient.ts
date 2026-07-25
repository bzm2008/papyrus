import { invoke } from '@tauri-apps/api/core'
import {
  useAppStore,
  type LlmProviderConfig,
  type ModelRoutingMode,
  type ScallionPlan,
} from '../stores/useAppStore'
import { getScallionExternalApiAccess } from './scallionModelCatalog'

const SCALLION_LLM_API_BASE = 'https://api.sca-hub.cn/api/papyrus/llm'
const SCALLION_MODELS_TIMEOUT_MS = 15_000
const SCALLION_RETIRED_AUTO_MODELS = new Set(['qwen/qwen3.5-122b-a10b'])
const SCALLION_MODEL_UNAVAILABLE_TYPES = new Set(['papyrus_model_err', 'papyrus_model_error', 'model_unavailable'])

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
    delta?: {
      content?: string
    }
    text?: string
  }>
  error?: {
    message?: string
    type?: string
    code?: string
    plan?: string
    auto_quota?: unknown
  }
  // Some gateway errors are returned at the top level by older proxies.
  message?: string
  type?: string
  code?: string
  plan?: string
}

type StreamOptions = {
  signal?: AbortSignal
  onToken: (token: string) => void
  sampling?: LlmSamplingOptions
}

export type LlmSamplingOptions = {
  temperature?: number
  maxTokens?: number
  frequencyPenalty?: number
  presencePenalty?: number
  /** Scallion-only routing hint. Omitted values follow the current app mode. */
  routingMode?: ModelRoutingMode
}

export type ScallionModel = {
  id?: string
  name?: string
  displayName?: string
  label?: string
  modelName?: string
  model_name?: string
  provider?: string
  billingMode?: string
  billing_mode?: string
  callPrice?: number
  call_price?: number
  available?: boolean
  enabled?: boolean
  planAvailable?: boolean
  plan_available?: boolean
  availableForPlan?: boolean
  available_for_plan?: boolean
  allowed?: boolean
  requiredPlan?: string
  required_plan?: string
  availabilityReason?: string
  availability_reason?: string
  manualAvailable?: boolean
  manual_available?: boolean
  autoAvailable?: boolean
  auto_available?: boolean
  autoOnly?: boolean
  auto_only?: boolean
  autoRequiredPlan?: string
  auto_required_plan?: string
  contextWindowTokens?: number
  context_window_tokens?: number
  contextWindow?: number
  context_window?: number
  contextWindowLabel?: string
  context_window_label?: string
}

type ScallionModelResponse = {
  data?: ScallionModel[]
  models?: ScallionModel[]
  plan?: ScallionPlanPayload
}

type ScallionPlanPayload = {
  key?: unknown
  name?: unknown
  expires_at?: unknown
  expiresAt?: unknown
  available_models?: unknown
  availableModels?: unknown
  manual_models?: unknown
  manualModels?: unknown
  auto_models?: unknown
  autoModels?: unknown
  auto_monthly_calls?: unknown
  autoMonthlyCalls?: unknown
  auto_daily_calls?: unknown
  autoDailyCalls?: unknown
  external_api?: unknown
  externalApi?: unknown
}

export type ScallionProxyModel = {
  id: string
  label: string
  modelName: string
  name?: string
  provider?: string
  billingMode?: string
  callPrice?: number
  planAvailable?: boolean
  requiredPlan?: string
  manualAvailable?: boolean
  autoAvailable?: boolean
  autoOnly?: boolean
  autoRequiredPlan?: string
  availabilityReason?: string
  available?: boolean
  contextWindowTokens?: number
  contextWindowLabel?: string
}

export type ScallionModelCatalog = {
  models: ScallionProxyModel[]
  plan?: ScallionPlan
}

export type LlmErrorCode =
  | 'unauthorized'
  | 'quota_exhausted'
  | 'auto_quota_exhausted'
  | 'plan_model_forbidden'
  | 'model_unavailable'
  | 'forbidden'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'protocol_error'
  | 'aborted'
  | 'request_uncertain'
  | 'http_error'

export class LlmRequestError extends Error {
  readonly code: LlmErrorCode
  readonly status?: number
  readonly plan?: string
  readonly recoverable: boolean
  readonly autoQuota?: unknown

  constructor(
    message: string,
    options: {
      code: LlmErrorCode
      status?: number
      plan?: string
      autoQuota?: unknown
      recoverable?: boolean
    },
  ) {
    super(message)
    this.name = 'LlmRequestError'
    this.code = options.code
    this.status = options.status
    this.plan = options.plan
    this.autoQuota = options.autoQuota
    this.recoverable = options.recoverable ?? false
  }
}

type NativeLlmPayload = {
  request: {
    baseUrl: string
    modelName: string
    apiKey: string
    providerType: LlmProviderConfig['type']
    messages: ChatMessage[]
    temperature: number
    maxTokens: number
    frequencyPenalty?: number
    presencePenalty?: number
    routingMode?: ModelRoutingMode
    autoModelHint?: string
  }
}

type ProviderType = LlmProviderConfig['type']

export async function callOpenAICompatible(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
  sampling?: LlmSamplingOptions,
) {
  return withLlmRetry(() => callOpenAICompatibleOnce(provider, messages, signal, sampling))
}

async function callOpenAICompatibleOnce(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
  sampling?: LlmSamplingOptions,
  allowModelRecovery = true,
  omitScallionRoutingMode = false,
) {
  assertExternalApiAllowed(provider)
  const modelName = resolveProviderModelName(provider, sampling?.routingMode)
  const routingMode = provider.type === 'scallion_proxy' ? resolveScallionRoutingMode(sampling?.routingMode) : undefined

  if (!modelName && !(provider.type === 'scallion_proxy' && routingMode === 'auto')) {
    throw new Error('Model Name 不能为空')
  }

  assertScallionModelListed(provider, modelName, sampling?.routingMode)

  if (shouldUseNativeScallionTransport(provider)) {
    try {
      return await callScallionViaNative(provider, messages, {
        temperature: sampling?.temperature ?? 0.45,
        maxTokens: sampling?.maxTokens ?? 8192,
        frequencyPenalty: sampling?.frequencyPenalty,
        presencePenalty: sampling?.presencePenalty,
        routingMode: sampling?.routingMode,
      })
    } catch (error) {
      if (allowModelRecovery && error instanceof LlmRequestError && isRecoverableScallionModelError(error)) {
        const requestedRoutingMode = resolveScallionRoutingMode(sampling?.routingMode)
        const recoveredProvider = await recoverScallionModel(provider, requestedRoutingMode)

        if (recoveredProvider) {
          return callOpenAICompatibleOnce(
            recoveredProvider,
            messages,
            signal,
            sampling ? { ...sampling, routingMode: requestedRoutingMode } : { routingMode: requestedRoutingMode },
            false,
          )
        }
      }

      throw error
    }
  }

  const endpoint = resolveChatEndpoint(provider.baseUrl, provider.type)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const apiKey = resolveProviderApiKey(provider)

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const requestBody = {
    ...(modelName
      ? { model: modelName }
      : omitScallionRoutingMode && provider.type === 'scallion_proxy'
        ? { model: resolveLegacyScallionModelName(provider) }
        : {}),
    messages,
    temperature: sampling?.temperature ?? 0.45,
    max_tokens: sampling?.maxTokens ?? 8192,
    frequency_penalty: sampling?.frequencyPenalty,
    presence_penalty: sampling?.presencePenalty,
    ...(provider.type === 'scallion_proxy' && !omitScallionRoutingMode
      ? { routing_mode: routingMode }
      : {}),
    stream: false,
  }
  let response: Response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify(requestBody),
    })
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }

    if (provider.type === 'scallion_proxy') {
      scheduleScallionQuotaRefresh(provider)
      throw new LlmRequestError('Scallion 请求结果不确定，未自动重试以避免重复扣费。请确认额度后重试。', {
        code: 'request_uncertain',
        recoverable: true,
      })
    }

    const fallback = await callViaTauri(provider, messages, {
      temperature: requestBody.temperature,
      maxTokens: requestBody.max_tokens,
      frequencyPenalty: requestBody.frequency_penalty,
      presencePenalty: requestBody.presence_penalty,
      routingMode: sampling?.routingMode,
    })
    scheduleScallionQuotaRefresh(provider)
    return fallback
  }

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse

  if (!response.ok) {
    const error = createHttpError(response.status, payload)

    if (
      allowModelRecovery &&
      provider.type === 'scallion_proxy' &&
      isUnsupportedRoutingModeError(error)
    ) {
      return callOpenAICompatibleOnce(
        provider,
        messages,
        signal,
        sampling,
        false,
        true,
      )
    }

    if (provider.type === 'scallion_proxy') {
      if (error.code === 'unauthorized') {
        useAppStore.getState().expireScallionSession()
      } else if (error.code === 'quota_exhausted' || error.code === 'auto_quota_exhausted') {
        scheduleScallionQuotaRefresh(provider)
      }
    }

    if (allowModelRecovery && provider.type === 'scallion_proxy' && isRecoverableScallionModelError(error)) {
      const requestedRoutingMode = resolveScallionRoutingMode(sampling?.routingMode)
      const recoveredProvider = await recoverScallionModel(provider, requestedRoutingMode)

      if (recoveredProvider) {
        return callOpenAICompatibleOnce(
          recoveredProvider,
          messages,
          signal,
          sampling ? { ...sampling, routingMode: requestedRoutingMode } : { routingMode: requestedRoutingMode },
          false,
        )
      }
    }

    throw error
  }

  const content = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text

  if (!content?.trim()) {
    throw new Error('LLM 没有返回可用文本')
  }

  scheduleScallionQuotaRefresh(provider)
  return content.trim()
}

export async function callOpenAICompatibleStream(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  { signal, onToken, sampling }: StreamOptions,
) {
  let receivedToken = false
  const emptyStreamFallback = { attempted: false }

  try {
    return await callOpenAICompatibleStreamOnce(
      provider,
      messages,
      {
        signal,
        sampling,
        onToken: (token) => {
          if (token) {
            receivedToken = true
          }
          onToken(token)
        },
      },
      true,
      emptyStreamFallback,
    )
  } catch (error) {
    if (
      receivedToken ||
      emptyStreamFallback.attempted ||
      signal?.aborted ||
      (error instanceof LlmRequestError && error.code === 'request_uncertain')
    ) {
      throw error
    }

    return fallbackFromEmptyStream(provider, messages, signal, sampling, onToken, emptyStreamFallback)
  }
}

async function callOpenAICompatibleStreamOnce(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  { signal, onToken, sampling }: StreamOptions,
  allowModelRecovery = true,
  emptyStreamFallback = { attempted: false },
  omitScallionRoutingMode = false,
) {
  assertExternalApiAllowed(provider)
  const modelName = resolveProviderModelName(provider, sampling?.routingMode)
  const routingMode = provider.type === 'scallion_proxy' ? resolveScallionRoutingMode(sampling?.routingMode) : undefined

  if (!modelName && !(provider.type === 'scallion_proxy' && routingMode === 'auto')) {
    throw new Error('Model Name 不能为空')
  }

  assertScallionModelListed(provider, modelName, sampling?.routingMode)

  if (shouldUseNativeScallionTransport(provider)) {
    try {
      const fallback = await callScallionViaNative(provider, messages, {
        temperature: sampling?.temperature ?? 0.45,
        maxTokens: sampling?.maxTokens ?? 8192,
        frequencyPenalty: sampling?.frequencyPenalty,
        presencePenalty: sampling?.presencePenalty,
        routingMode: sampling?.routingMode,
      })
      onToken(fallback)
      return fallback
    } catch (error) {
      if (allowModelRecovery && error instanceof LlmRequestError && isRecoverableScallionModelError(error)) {
        const requestedRoutingMode = resolveScallionRoutingMode(sampling?.routingMode)
        const recoveredProvider = await recoverScallionModel(provider, requestedRoutingMode)

        if (recoveredProvider) {
          return callOpenAICompatibleStreamOnce(
            recoveredProvider,
            messages,
            { signal, onToken, sampling: sampling ? { ...sampling, routingMode: requestedRoutingMode } : { routingMode: requestedRoutingMode } },
            false,
            emptyStreamFallback,
          )
        }
      }

      throw error
    }
  }

  const endpoint = resolveChatEndpoint(provider.baseUrl, provider.type)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const apiKey = resolveProviderApiKey(provider)

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  let response: Response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        ...(modelName
          ? { model: modelName }
          : omitScallionRoutingMode && provider.type === 'scallion_proxy'
            ? { model: resolveLegacyScallionModelName(provider) }
            : {}),
        messages,
        temperature: sampling?.temperature ?? 0.45,
        max_tokens: sampling?.maxTokens ?? 8192,
        frequency_penalty: sampling?.frequencyPenalty,
        presence_penalty: sampling?.presencePenalty,
        ...(provider.type === 'scallion_proxy' && !omitScallionRoutingMode
          ? { routing_mode: routingMode }
          : {}),
        stream: true,
      }),
    })
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }

    if (provider.type === 'scallion_proxy') {
      scheduleScallionQuotaRefresh(provider)
      throw new LlmRequestError('Scallion 流式请求结果不确定，未自动重试以避免重复扣费。请确认额度后重试。', {
        code: 'request_uncertain',
        recoverable: true,
      })
    }

    const fallback = await callViaTauri(provider, messages, {
      temperature: sampling?.temperature ?? 0.45,
      maxTokens: sampling?.maxTokens ?? 8192,
      frequencyPenalty: sampling?.frequencyPenalty,
      presencePenalty: sampling?.presencePenalty,
      routingMode: sampling?.routingMode,
    })
    onToken(fallback)
    scheduleScallionQuotaRefresh(provider)
    return fallback
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse
    const error = createHttpError(response.status, payload)

    if (
      allowModelRecovery &&
      provider.type === 'scallion_proxy' &&
      isUnsupportedRoutingModeError(error)
    ) {
      return callOpenAICompatibleStreamOnce(
        provider,
        messages,
        { signal, onToken, sampling },
        false,
        emptyStreamFallback,
        true,
      )
    }

    if (provider.type === 'scallion_proxy') {
      if (error.code === 'unauthorized') {
        useAppStore.getState().expireScallionSession()
      } else if (error.code === 'quota_exhausted' || error.code === 'auto_quota_exhausted') {
        scheduleScallionQuotaRefresh(provider)
      }
    }

    if (allowModelRecovery && provider.type === 'scallion_proxy' && isRecoverableScallionModelError(error)) {
      const requestedRoutingMode = resolveScallionRoutingMode(sampling?.routingMode)
      const recoveredProvider = await recoverScallionModel(provider, requestedRoutingMode)

      if (recoveredProvider) {
        return callOpenAICompatibleStreamOnce(
          recoveredProvider,
          messages,
          { signal, onToken, sampling: sampling ? { ...sampling, routingMode: requestedRoutingMode } : { routingMode: requestedRoutingMode } },
          false,
          emptyStreamFallback,
        )
      }
    }

    throw error
  }

  if (!response.body) {
    return fallbackFromEmptyStream(provider, messages, signal, sampling, onToken, emptyStreamFallback)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let rawText = ''

  while (true) {
    const { value, done } = await reader.read()

    if (done) {
      break
    }

    const chunk = decoder.decode(value, { stream: true })
    rawText += chunk
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const token = parseStreamLine(line)

      if (!token) {
        continue
      }

      fullText += token
      onToken(token)
    }
  }

  const tailToken = parseStreamLine(buffer)
  if (tailToken) {
    fullText += tailToken
    onToken(tailToken)
  }

  if (!fullText.trim()) {
    if (fullText.length > 0) {
      throw new LlmRequestError('流式响应只包含空白内容，未自动重试以避免重复请求。', {
        code: 'protocol_error',
        recoverable: true,
      })
    }

    const payload = tryParseChatCompletionResponse(rawText)
    const content = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text

    if (!content?.trim()) {
      return fallbackFromEmptyStream(provider, messages, signal, sampling, onToken, emptyStreamFallback)
    }

    onToken(content)
    scheduleScallionQuotaRefresh(provider)
    return content.trim()
  }

  scheduleScallionQuotaRefresh(provider)
  return fullText.trim()
}

async function fallbackFromEmptyStream(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  sampling: LlmSamplingOptions | undefined,
  onToken: (token: string) => void,
  state: { attempted: boolean },
) {
  if (state.attempted) {
    throw new LlmRequestError('流式响应未返回内容，已完成一次兼容回退。', {
      code: 'protocol_error',
      recoverable: true,
    })
  }

  state.attempted = true
  const fallback = await callOpenAICompatibleOnce(provider, messages, signal, sampling)
  onToken(fallback)
  return fallback
}

function tryParseChatCompletionResponse(value: string): ChatCompletionResponse {
  try {
    return JSON.parse(value || '{}') as ChatCompletionResponse
  } catch {
    return {}
  }
}

export async function fetchScallionProxyModels(
  provider: LlmProviderConfig,
  options: { includeUnavailable?: boolean } = {},
) {
  const catalog = await fetchScallionProxyModelCatalog(provider, options)
  return catalog.models
}

export async function fetchScallionProxyModelCatalog(
  provider: LlmProviderConfig,
  options: { includeUnavailable?: boolean } = {},
): Promise<ScallionModelCatalog> {
  if (provider.type !== 'scallion_proxy') {
    return { models: [] }
  }

  if (!resolveProviderApiKey(provider)) {
    return { models: [] }
  }

  // The gateway's /models response is the sole directory authority. Do not
  // add the legacy include_unavailable switch: older gateways used it to
  // expose provider-side models outside the Papyrus catalogue.
  void options
  const endpoint = `${resolveScallionLlmApiBase(provider.baseUrl)}/models`
  const headers: Record<string, string> = {}
  const apiKey = resolveProviderApiKey(provider)

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), SCALLION_MODELS_TIMEOUT_MS)
  let response: Response

  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch {
    if (controller.signal.aborted) {
      throw new LlmRequestError('模型目录请求超时，请稍后重试。', {
        code: 'network_error',
        recoverable: true,
      })
    }
    throw new LlmRequestError('无法读取 Scallion 模型目录，请检查网络后重试。', {
      code: 'network_error',
      recoverable: true,
    })
  } finally {
    globalThis.clearTimeout(timeout)
  }
  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new LlmRequestError('Scallion 模型目录响应格式无效，请稍后重试。', {
      code: 'protocol_error',
      recoverable: true,
    })
  }

  if (!response.ok) {
    throw createHttpError(response.status, payload as ChatCompletionResponse)
  }

  const models = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? Array.isArray((payload as ScallionModelResponse).models)
        ? (payload as ScallionModelResponse).models
        : Array.isArray((payload as ScallionModelResponse).data)
          ? (payload as ScallionModelResponse).data
          : undefined
      : undefined

  if (!models) {
    throw new LlmRequestError('Scallion 模型目录响应格式无效，请稍后重试。', {
      code: 'protocol_error',
      recoverable: true,
    })
  }

  const plan = normalizeScallionPlanPayload(
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as ScallionModelResponse).plan
      : undefined,
  )

  const manualModels = plan?.manualModels
  const autoModels = plan?.autoModels
  const byId = new Map<string, ScallionProxyModel>()

  for (const model of models) {
    const id = model.id?.trim() || model.modelName?.trim() || model.model_name?.trim() || ''
    if (!id) continue

    const explicitManual = model.manualAvailable ?? model.manual_available
    const explicitAuto = model.autoAvailable ?? model.auto_available
    const manualAvailable =
      explicitManual ?? (manualModels ? manualModels.includes(id) : undefined)
    const autoAvailable = explicitAuto ?? (autoModels ? autoModels.includes(id) : undefined)
    const autoOnly =
      model.autoOnly ?? model.auto_only ?? (manualAvailable === false && autoAvailable !== false)
    const hasModeFields =
      explicitManual !== undefined || explicitAuto !== undefined || model.autoOnly !== undefined || model.auto_only !== undefined
    const legacyPlanAvailable =
      model.planAvailable ??
      model.plan_available ??
      model.availableForPlan ??
      model.available_for_plan ??
      model.allowed
    const planAvailable =
      legacyPlanAvailable !== undefined
        ? legacyPlanAvailable
        : hasModeFields || manualModels !== undefined || autoModels !== undefined
          ? manualAvailable !== false || autoAvailable !== false
          : true
    const name = model.name?.trim() || model.displayName?.trim() || model.label?.trim() || id
    const normalized: ScallionProxyModel = {
      id,
      label: name,
      modelName: id,
      name,
      provider: model.provider,
      billingMode: model.billingMode ?? model.billing_mode,
      callPrice: toPositiveNumber(model.callPrice ?? model.call_price),
      planAvailable,
      requiredPlan: model.requiredPlan ?? model.required_plan,
      manualAvailable,
      autoAvailable,
      autoOnly,
      autoRequiredPlan: model.autoRequiredPlan ?? model.auto_required_plan,
      availabilityReason: model.availabilityReason ?? model.availability_reason,
      available:
        model.available ??
        model.enabled ??
        (hasModeFields || manualModels !== undefined || autoModels !== undefined ? true : legacyPlanAvailable !== false),
      contextWindowTokens: toPositiveNumber(
        model.context_window_tokens ?? model.contextWindowTokens ?? model.context_window ?? model.contextWindow,
      ),
      contextWindowLabel: model.contextWindowLabel ?? model.context_window_label,
    }
    const existing = byId.get(id)
    byId.set(id, existing ? mergeScallionModel(existing, normalized) : normalized)
  }

  return { plan, models: Array.from(byId.values()) }
}

export function canCallProvider(provider: LlmProviderConfig) {
  if (!isExternalApiProviderAllowed(provider)) {
    return false
  }

  const routingMode = resolveScallionRoutingMode()
  const modelName = resolveProviderModelName(provider, routingMode)

  if (provider.type === 'scallion_proxy') {
    const stateModels = useAppStore.getState().scallionModels
    if (routingMode === 'auto') {
      // Auto is selected by the gateway. Do not require a cached local model
      // or pin the request to Agnes when the catalogue is stale or incomplete.
      return Boolean(provider.baseUrl.trim() && resolveProviderApiKey(provider))
    }
    const listedModelIsUsable = stateModels.some(
      (model) =>
        (model.id === modelName || model.modelName === modelName) &&
        isScallionModelCallableWithPlan(model, routingMode),
    )

    return Boolean(provider.baseUrl.trim() && modelName && resolveProviderApiKey(provider) && listedModelIsUsable)
  }

  if (provider.type === 'custom') {
    return Boolean(
      provider.baseUrl.trim() &&
        modelName &&
        (resolveProviderApiKey(provider) || isLocalCompatibleEndpoint(provider.baseUrl)),
    )
  }

  return Boolean(provider.baseUrl.trim() && modelName && resolveProviderApiKey(provider))
}

function isExternalApiProviderAllowed(provider: LlmProviderConfig) {
  if (provider.type === 'scallion_proxy') {
    return true
  }

  // A user-configured OpenAI-compatible endpoint is independent of the
  // Scallion subscription. The gateway entitlement only governs built-in
  // vendor-key routing; custom endpoints use the user's own credentials.
  if (provider.type === 'custom') {
    return true
  }

  const state = useAppStore.getState()
  return getScallionExternalApiAccess({
    token: state.scallionToken,
    planKey: state.scallionQuota?.planKey ?? state.scallionPlan?.key ?? state.scallionUser?.member_type,
    planExternalApi: state.scallionPlan?.externalApi,
    quotaExternalApi: state.scallionQuota?.externalApi,
  }).allowed
}

function assertExternalApiAllowed(provider: LlmProviderConfig) {
  if (provider.type === 'scallion_proxy' || provider.type === 'custom') {
    return
  }

  const state = useAppStore.getState()
  const access = getScallionExternalApiAccess({
    token: state.scallionToken,
    planKey: state.scallionQuota?.planKey ?? state.scallionPlan?.key ?? state.scallionUser?.member_type,
    planExternalApi: state.scallionPlan?.externalApi,
    quotaExternalApi: state.scallionQuota?.externalApi,
  })
  if (!access.allowed) {
    throw new LlmRequestError(access.reason, {
      code: 'forbidden',
      status: 403,
      recoverable: true,
    })
  }
}

function resolveProviderModelName(provider: LlmProviderConfig, routingMode?: ModelRoutingMode) {
  const configured = provider.modelName.trim()
  if (provider.type !== 'scallion_proxy') {
    return configured
  }

  const mode = resolveScallionRoutingMode(routingMode)
  const listed = useAppStore.getState().scallionModels
  if (mode === 'auto') {
    // The gateway owns Auto pool selection. Sending no model lets the server
    // apply the current plan and routing policy instead of a stale local id.
    return ''
  }

  const configuredModel = listed.find((model) => model.id === configured || model.modelName === configured)
  if (configuredModel && isScallionModelCallableWithPlan(configuredModel, mode)) {
    return getScallionModelRequestName(configuredModel)
  }

  return configured
}

function resolveLegacyScallionModelName(provider: LlmProviderConfig) {
  const configured = provider.modelName.trim()
  const listed = useAppStore.getState().scallionModels
  const configuredModel = listed.find((model) => model.id === configured || model.modelName === configured)
  if (configuredModel && isScallionModelCallableWithPlan(configuredModel, 'auto')) {
    return getScallionModelRequestName(configuredModel) || configured
  }

  const autoModel = listed.find((model) => isScallionModelCallableWithPlan(model, 'auto'))
  return getScallionModelRequestName(autoModel) || configured
}

function assertScallionModelListed(
  provider: LlmProviderConfig,
  modelName: string,
  explicitRoutingMode?: ModelRoutingMode,
) {
  if (provider.type !== 'scallion_proxy') {
    return
  }

  const routingMode = resolveScallionRoutingMode(explicitRoutingMode)
  if (routingMode === 'auto') {
    return
  }
  const listed = useAppStore.getState().scallionModels.some(
    (model) =>
      (model.id === modelName || model.modelName === modelName) &&
      isScallionModelCallableWithPlan(model, routingMode),
  )

  if (!listed) {
      throw new LlmRequestError('当前模型不在套餐模型目录中，请刷新模型列表后重试。', {
      code: 'protocol_error',
      recoverable: true,
    })
  }
}

function resolveProviderApiKey(provider: LlmProviderConfig) {
  if (provider.type === 'scallion_proxy') {
    return useAppStore.getState().scallionToken?.trim() ?? ''
  }

  const configuredKey = provider.apiKey.trim()

  if (configuredKey) {
    return configuredKey
  }

  return ''
}

async function callViaTauri(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  options: {
    temperature: number
    maxTokens: number
    frequencyPenalty?: number
    presencePenalty?: number
    routingMode?: ModelRoutingMode
  },
) {
  const routingMode =
    provider.type === 'scallion_proxy' ? resolveScallionRoutingMode(options.routingMode) : undefined
  const modelName = resolveProviderModelName(provider, routingMode)
  const payload: NativeLlmPayload = {
    request: {
      baseUrl: provider.type === 'scallion_proxy'
        ? resolveScallionLlmApiBase(provider.baseUrl)
        : provider.baseUrl,
      modelName,
      apiKey: resolveProviderApiKey(provider),
      providerType: provider.type,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      frequencyPenalty: options.frequencyPenalty,
      presencePenalty: options.presencePenalty,
      routingMode,
      autoModelHint: routingMode === 'auto' ? resolveLegacyScallionModelName(provider) : undefined,
    },
  }

  try {
    return await invoke<string>('llm_chat', payload)
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error || 'LLM 请求失败，Tauri 通道不可用'))
  }
}

async function callScallionViaNative(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  options: {
    temperature: number
    maxTokens: number
    frequencyPenalty?: number
    presencePenalty?: number
    routingMode?: ModelRoutingMode
  },
) {
  try {
    const response = await callViaTauri(provider, messages, options)
    scheduleScallionQuotaRefresh(provider)
    return response
  } catch (error) {
    const nativeError = classifyNativeScallionError(error)
    if (nativeError.code === 'unauthorized') {
      useAppStore.getState().expireScallionSession()
    } else if (nativeError.code === 'quota_exhausted' || nativeError.code === 'auto_quota_exhausted') {
      scheduleScallionQuotaRefresh(provider)
    }
    throw nativeError
  }
}

function shouldUseNativeScallionTransport(provider: LlmProviderConfig) {
  return provider.type === 'scallion_proxy' && isTauriRuntimeAvailable()
}

function isTauriRuntimeAvailable() {
  const globalWindow = typeof window === 'undefined'
    ? undefined
    : window as Window & {
        __TAURI_INTERNALS__?: unknown
        __TAURI__?: unknown
      }
  return Boolean(
    globalWindow?.__TAURI_INTERNALS__ ||
    globalWindow?.__TAURI__ ||
    (typeof navigator !== 'undefined' && /\bTauri\b/i.test(navigator.userAgent)),
  )
}

function classifyNativeScallionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Scallion 调用失败')
  const httpStatus = Number(message.match(/HTTP\s+(\d{3})/i)?.[1])
  const lowered = message.toLowerCase()

  if (httpStatus === 401) {
    return new LlmRequestError('Scallion 登录已过期，请重新登录。', {
      code: 'unauthorized',
      status: 401,
      recoverable: true,
    })
  }
  if (httpStatus === 402) {
    return new LlmRequestError('Scallion 积分不足，请充值或进入主站查看套餐。', {
      code: 'quota_exhausted',
      status: 402,
      recoverable: true,
    })
  }
  if (lowered.includes('auto_quota_exhausted')) {
    return new LlmRequestError('Auto 调用次数已用尽，请等待额度刷新或切换可用模型。', {
      code: 'auto_quota_exhausted',
      status: Number.isFinite(httpStatus) ? httpStatus : undefined,
      recoverable: true,
    })
  }
  if (lowered.includes('plan_model_forbidden')) {
    return new LlmRequestError('当前套餐不可调用该模型，请刷新模型目录后重试。', {
      code: 'plan_model_forbidden',
      status: Number.isFinite(httpStatus) ? httpStatus : 403,
      recoverable: true,
    })
  }
  if (isModelUnavailableSignal(Number.isFinite(httpStatus) ? httpStatus : undefined, undefined, message)) {
    return new LlmRequestError('当前模型已下线，请刷新模型目录后重试。', {
      code: 'model_unavailable',
      status: Number.isFinite(httpStatus) ? httpStatus : 410,
      recoverable: true,
    })
  }
  if (httpStatus === 403) {
    return new LlmRequestError('当前套餐或账户权限无法调用该模型。', {
      code: 'forbidden',
      status: 403,
      recoverable: true,
    })
  }
  if (httpStatus === 429) {
    return new LlmRequestError('Scallion 调用过于频繁，请稍后重试。', {
      code: 'rate_limited',
      status: 429,
      recoverable: true,
    })
  }
  if (Number.isFinite(httpStatus) && httpStatus >= 500) {
    return new LlmRequestError('Scallion 服务暂不可用，请稍后重试。', {
      code: 'server_error',
      status: httpStatus,
      recoverable: true,
    })
  }

  return new LlmRequestError(message, {
    code: 'network_error',
    recoverable: true,
  })
}

export function resolveChatEndpoint(baseUrl: string, providerType: ProviderType) {
  if (providerType === 'scallion_proxy') {
    return `${resolveScallionLlmApiBase(baseUrl)}/chat`
  }

  const trimmed = baseUrl.trim().replace(/\/+$/, '')

  if (!trimmed) {
    return ''
  }

  if (/\/chat\/completions$/i.test(trimmed) || /\/chat$/i.test(trimmed)) {
    return trimmed
  }

  return `${trimmed}/chat/completions`
}

export function resolveScallionLlmApiBase(baseUrl?: string) {
  void baseUrl
  return SCALLION_LLM_API_BASE
}

export function isLocalCompatibleEndpoint(baseUrl: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(
    baseUrl.trim(),
  )
}

function parseStreamLine(line: string) {
  const trimmed = line.trim()

  if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
    return ''
  }

  const payloadText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed

  try {
    const payload = JSON.parse(payloadText) as ChatCompletionResponse
    return payload.choices?.[0]?.delta?.content || payload.choices?.[0]?.message?.content || ''
  } catch {
    return ''
  }
}

function createHttpError(status: number, payload: ChatCompletionResponse) {
  const payloadError = payload.error
  const message = payloadError?.message || payload.message || `LLM 请求失败：HTTP ${status}`
  const type = payloadError?.type || payloadError?.code || payload.type || payload.code
  let code: LlmErrorCode = 'http_error'

  if (status === 401) code = 'unauthorized'
  else if (type === 'auto_quota_exhausted') code = 'auto_quota_exhausted'
  else if (status === 402) code = 'quota_exhausted'
  else if (type === 'plan_model_forbidden') code = 'plan_model_forbidden'
  else if (isModelUnavailableSignal(status, type, message)) code = 'model_unavailable'
  else if (status === 403) code = 'forbidden'
  else if (status === 429) code = 'rate_limited'
  else if (status >= 500) code = 'server_error'

  return new LlmRequestError(message, {
    code,
    status,
    plan: payloadError?.plan || payload.plan,
    autoQuota: payloadError?.auto_quota,
    recoverable:
      code === 'plan_model_forbidden' ||
      code === 'model_unavailable' ||
      code === 'auto_quota_exhausted' ||
      code === 'server_error' ||
      code === 'rate_limited',
  })
}

function isUnsupportedRoutingModeError(error: LlmRequestError) {
  return error.status === 400 && /routing[_ -]?mode/i.test(error.message)
}

function isRecoverableScallionModelError(error: LlmRequestError) {
  return error.code === 'plan_model_forbidden' || error.code === 'model_unavailable'
}

async function recoverScallionModel(provider: LlmProviderConfig, requestedRoutingMode?: ModelRoutingMode) {
  try {
    const { refreshScallionModels, refreshScallionQuota } = await import('./scallionAccountService')
    // Keep the recovery sequence deterministic. The gateway contract requires
    // both endpoints to be refreshed, while the model list is the authoritative
    // source for the replacement id. A quota refresh failure must not discard a
    // valid model catalogue and trigger a second model charge.
    let refreshedModels: Awaited<ReturnType<typeof refreshScallionModels>>
    try {
      // A plan denial is an explicit signal that the cached catalog may be
      // stale. Do not reuse a same-token refresh started by another view.
      refreshedModels = await refreshScallionModels({ force: true })
    } catch {
      return undefined
    }
    await refreshScallionQuota().catch(() => undefined)
    const state = useAppStore.getState()
    const routingMode = requestedRoutingMode ?? resolveScallionRoutingMode()
    if (routingMode === 'auto') {
      // Keep recovery gateway-routed; selecting a replacement id locally would
      // reintroduce the stale-model pinning that caused the original failure.
      return { ...provider, modelName: provider.modelName }
    }
    const next = selectPreferredScallionModel(refreshedModels, (model) =>
      Boolean(getScallionModelRequestName(model)) && isScallionModelSelectableForMode(model, routingMode),
    )
    const nextModelName = getScallionModelRequestName(next)

    if (!next || !nextModelName) {
      return undefined
    }

    state.updateProviderModelMetadata('qwen36', {
      modelName: nextModelName,
      label: next.label || provider.label,
      contextWindowTokens: next.contextWindowTokens,
    })

    return {
      ...state.providerConfigs.qwen36,
      ...provider,
      modelName: nextModelName,
      label: next.label || provider.label,
      serverContextWindowTokens: next.contextWindowTokens ?? provider.serverContextWindowTokens,
    }
  } catch {
    return undefined
  }
}

function scheduleScallionQuotaRefresh(provider: LlmProviderConfig) {
  if (provider.type !== 'scallion_proxy') {
    return
  }

  void import('./scallionAccountService')
    .then(({ refreshScallionQuota }) => refreshScallionQuota())
    .catch(() => undefined)
}

function normalizeScallionPlanPayload(payload?: ScallionPlanPayload): ScallionPlan | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined
  }

  const rawKey = typeof payload.key === 'string' ? payload.key.trim().toLowerCase() : ''
  const key = rawKey && rawKey !== 'none' ? rawKey : ''
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  if (!key && !name) {
    return undefined
  }

  const availableModels = Array.isArray(payload.available_models)
    ? payload.available_models
    : Array.isArray(payload.availableModels)
      ? payload.availableModels
      : []
  const hasManualModels = Array.isArray(payload.manual_models) || Array.isArray(payload.manualModels)
  const hasAutoModels = Array.isArray(payload.auto_models) || Array.isArray(payload.autoModels)
  const manualModels = hasManualModels
    ? normalizeStringList(payload.manual_models ?? payload.manualModels)
    : undefined
  const autoModels = hasAutoModels
    ? normalizeStringList(payload.auto_models ?? payload.autoModels)
    : undefined
  const availableModelList = availableModels
    .filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
    .map((model) => model.trim())
  const combinedAvailableModels = Array.from(
    new Set([...availableModelList, ...(manualModels ?? []), ...(autoModels ?? [])]),
  )

  return {
    key: key || name.toLowerCase(),
    name: name || key || 'Free',
    expiresAt:
      typeof payload.expires_at === 'string' || payload.expires_at === null
        ? payload.expires_at
        : typeof payload.expiresAt === 'string' || payload.expiresAt === null
          ? payload.expiresAt
          : null,
    availableModels: combinedAvailableModels,
    manualModels,
    autoModels,
    autoMonthlyCalls: toNonNegativeNumber(payload.auto_monthly_calls ?? payload.autoMonthlyCalls),
    autoDailyCalls: toNonNegativeNumber(payload.auto_daily_calls ?? payload.autoDailyCalls),
    externalApi: normalizeExternalApi(payload.external_api ?? payload.externalApi),
    updatedAt: Date.now(),
  }
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : []
}

function normalizeExternalApi(value: unknown): boolean | string | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function resolveScallionRoutingMode(explicit?: ModelRoutingMode): ModelRoutingMode {
  const state = useAppStore.getState()
  if (explicit === 'auto') return 'auto'
  if (explicit === 'manual') {
    if (state.scallionPlan?.manualModels?.length === 0 && (state.scallionPlan.autoModels?.length ?? 0) > 0) {
      return 'auto'
    }
    return 'manual'
  }
  if (state.modelRoutingMode === 'auto') {
    return 'auto'
  }

  // Free currently exposes no manual models. Keep older persisted clients
  // working by treating an omitted routing hint as Auto when the live
  // entitlement or selected model proves that manual routing is unavailable.
  if (
    state.scallionPlan?.manualModels?.length === 0 &&
    (state.scallionPlan.autoModels?.length ?? 0) > 0
  ) {
    return 'auto'
  }

  const configuredModel = state.scallionModels.find(
    (model) =>
      model.id === state.providerConfigs.qwen36.modelName ||
      model.modelName === state.providerConfigs.qwen36.modelName,
  )
  if (
    configuredModel &&
    !isScallionModelCallable(configuredModel, 'manual') &&
    isScallionModelCallable(configuredModel, 'auto')
  ) {
    return 'auto'
  }

  return 'manual'
}

function isScallionModelCallable(
  model: Pick<ScallionProxyModel, 'manualAvailable' | 'autoAvailable' | 'autoOnly'>,
  routingMode: ModelRoutingMode,
) {
  if (routingMode === 'auto') {
    return model.autoAvailable !== false
  }
  return model.manualAvailable !== false && model.autoOnly !== true
}

function isScallionModelCallableWithPlan(
  model: Pick<ScallionProxyModel, 'available' | 'planAvailable' | 'manualAvailable' | 'autoAvailable' | 'autoOnly'>,
  routingMode: ModelRoutingMode,
) {
  const hasExplicitModeAccess =
    model.manualAvailable !== undefined || model.autoAvailable !== undefined || model.autoOnly === true
  return model.available !== false && (hasExplicitModeAccess || model.planAvailable !== false) && isScallionModelCallable(model, routingMode)
}

function isScallionModelSelectableForMode(
  model: Pick<ScallionProxyModel, 'planAvailable' | 'manualAvailable' | 'autoAvailable' | 'autoOnly'>,
  routingMode: ModelRoutingMode,
) {
  const hasExplicitModeAccess =
    model.manualAvailable !== undefined || model.autoAvailable !== undefined || model.autoOnly === true
  return (hasExplicitModeAccess || model.planAvailable !== false) && isScallionModelCallable(model, routingMode)
}

function selectPreferredScallionModel<T extends { id?: string; modelName?: string }>(
  models: readonly T[],
  isSelectable: (model: T) => boolean,
) {
  const selectable = models.filter(isSelectable)
  return (
    selectable.find((model) => !isRetiredScallionAutoModel(model)) ??
    selectable[0]
  )
}

function getScallionModelRequestName(model?: { id?: string; modelName?: string }) {
  return model?.id || model?.modelName || ''
}

function isRetiredScallionAutoModel(model: { id?: string; modelName?: string }) {
  return (
    SCALLION_RETIRED_AUTO_MODELS.has(normalizeScallionModelName(model.id)) ||
    SCALLION_RETIRED_AUTO_MODELS.has(normalizeScallionModelName(model.modelName))
  )
}

function normalizeScallionModelName(value?: string) {
  return value?.trim().toLowerCase() ?? ''
}

function isModelUnavailableSignal(status: number | undefined, type: unknown, message: string) {
  const normalizedType = String(type || '').trim().toLowerCase()
  const lowered = message.toLowerCase()
  return (
    status === 410 ||
    SCALLION_MODEL_UNAVAILABLE_TYPES.has(normalizedType) ||
    lowered.includes('papyrus_model_err') ||
    lowered.includes('papyrus_model_error') ||
    lowered.includes('model_unavailable') ||
    lowered.includes('end of life') ||
    lowered.includes('no longer available')
  )
}

function mergeScallionModel(
  previous: ScallionProxyModel,
  next: ScallionProxyModel,
): ScallionProxyModel {
  const merged = { ...previous }
  for (const [key, value] of Object.entries(next) as Array<[
    keyof ScallionProxyModel,
    ScallionProxyModel[keyof ScallionProxyModel],
  ]>) {
    if (value !== undefined && value !== '') {
      ;(merged as Record<string, unknown>)[key] = value
    }
  }
  // A duplicate entry must not turn a callable model into a restricted one
  // merely because one upstream branch omitted a field.
  merged.manualAvailable = previous.manualAvailable ?? next.manualAvailable
  merged.autoAvailable = previous.autoAvailable ?? next.autoAvailable
  merged.autoOnly = previous.autoOnly ?? next.autoOnly
  merged.planAvailable = previous.planAvailable ?? next.planAvailable
  merged.available = previous.available !== false && next.available !== false
  return merged
}

function toPositiveNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined
}

function toNonNegativeNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined
}

async function withLlmRetry<T>(
  run: () => Promise<T>,
  maxAttempts = 3,
  shouldRetry: (error: unknown) => boolean = isTransientLlmError,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        useAppStore
          .getState()
          .setLlmRunState('reconnecting', `模型连接中断，正在第 ${attempt} 次重连`)
      }

      const result = await run()

      if (attempt > 1) {
        useAppStore.getState().setLlmRunState('running', '连接已恢复，继续生成')
      }

      return result
    } catch (error) {
      lastError = error

      if (!shouldRetry(error) || attempt >= maxAttempts) {
        break
      }

      await delay(650 * attempt ** 2)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('LLM 请求失败')
}

function isTransientLlmError(error: unknown) {
  if (error instanceof LlmRequestError) {
    return error.code === 'server_error' || error.code === 'rate_limited' || error.code === 'network_error'
  }

  if (!(error instanceof Error)) {
    return true
  }

  const message = error.message.toLowerCase()

  if (/401|403|unauthorized|forbidden|api key|model name/.test(message)) {
    return false
  }

  return /network|failed to fetch|timeout|timed out|429|408|500|502|503|504|connection|reset|暂时|重试/.test(message)
}

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}
