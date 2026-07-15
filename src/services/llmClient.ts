import { invoke } from '@tauri-apps/api/core'
import { useAppStore, type LlmProviderConfig } from '../stores/useAppStore'

const SCALLION_MODELS_TIMEOUT_MS = 15_000

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
  }
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
}

export type LlmErrorCode =
  | 'unauthorized'
  | 'quota_exhausted'
  | 'plan_model_forbidden'
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

  constructor(
    message: string,
    options: {
      code: LlmErrorCode
      status?: number
      plan?: string
      recoverable?: boolean
    },
  ) {
    super(message)
    this.name = 'LlmRequestError'
    this.code = options.code
    this.status = options.status
    this.plan = options.plan
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
) {
  const modelName = resolveProviderModelName(provider)

  if (!modelName) {
    throw new Error('Model Name 不能为空')
  }

  assertScallionModelListed(provider, modelName)

  const endpoint = resolveChatEndpoint(provider.baseUrl, provider.type)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const apiKey = resolveProviderApiKey(provider)

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const requestBody = {
    model: modelName,
    messages,
    temperature: sampling?.temperature ?? 0.45,
    max_tokens: sampling?.maxTokens ?? 8192,
    frequency_penalty: sampling?.frequencyPenalty,
    presence_penalty: sampling?.presencePenalty,
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
    })
    scheduleScallionQuotaRefresh(provider)
    return fallback
  }

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse

  if (!response.ok) {
    const error = createHttpError(response.status, payload)

    if (provider.type === 'scallion_proxy') {
      if (error.code === 'unauthorized') {
        useAppStore.getState().expireScallionSession()
      } else if (error.code === 'quota_exhausted') {
        scheduleScallionQuotaRefresh(provider)
      }
    }

    if (allowModelRecovery && provider.type === 'scallion_proxy' && error.code === 'plan_model_forbidden') {
      const recoveredProvider = await recoverScallionModel(provider)

      if (recoveredProvider) {
        return callOpenAICompatibleOnce(recoveredProvider, messages, signal, sampling, false)
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

  return withLlmRetry(
    () =>
      callOpenAICompatibleStreamOnce(provider, messages, {
        signal,
        sampling,
        onToken: (token) => {
          if (token) {
            receivedToken = true
          }
          onToken(token)
        },
      }),
    3,
    (error) => !receivedToken && !signal?.aborted && isTransientLlmError(error),
  )
}

async function callOpenAICompatibleStreamOnce(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  { signal, onToken, sampling }: StreamOptions,
  allowModelRecovery = true,
) {
  const modelName = resolveProviderModelName(provider)

  if (!modelName) {
    throw new Error('Model Name 不能为空')
  }

  assertScallionModelListed(provider, modelName)

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
        model: modelName,
        messages,
        temperature: sampling?.temperature ?? 0.45,
        max_tokens: sampling?.maxTokens ?? 8192,
        frequency_penalty: sampling?.frequencyPenalty,
        presence_penalty: sampling?.presencePenalty,
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
    })
    onToken(fallback)
    scheduleScallionQuotaRefresh(provider)
    return fallback
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse
    const error = createHttpError(response.status, payload)

    if (provider.type === 'scallion_proxy') {
      if (error.code === 'unauthorized') {
        useAppStore.getState().expireScallionSession()
      } else if (error.code === 'quota_exhausted') {
        scheduleScallionQuotaRefresh(provider)
      }
    }

    if (allowModelRecovery && provider.type === 'scallion_proxy' && error.code === 'plan_model_forbidden') {
      const recoveredProvider = await recoverScallionModel(provider)

      if (recoveredProvider) {
        return callOpenAICompatibleStreamOnce(
          recoveredProvider,
          messages,
          { signal, onToken, sampling },
          false,
        )
      }
    }

    throw error
  }

  if (!response.body) {
    const text = await callOpenAICompatible(provider, messages, signal)
    onToken(text)
    return text
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
    const payload = JSON.parse(rawText || '{}') as ChatCompletionResponse
    const content = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text

    if (!content?.trim()) {
      throw new Error('LLM 没有返回可用文本')
    }

    onToken(content)
    scheduleScallionQuotaRefresh(provider)
    return content.trim()
  }

  scheduleScallionQuotaRefresh(provider)
  return fullText.trim()
}

export async function fetchScallionProxyModels(
  provider: LlmProviderConfig,
  options: { includeUnavailable?: boolean } = {},
) {
  if (provider.type !== 'scallion_proxy' || !provider.baseUrl.trim()) {
    return []
  }

  if (!resolveProviderApiKey(provider)) {
    return []
  }

  const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/models${
    options.includeUnavailable === false ? '' : '?include_unavailable=1'
  }`
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

  return models
    .map((model) => {
      const id = model.id?.trim() || model.modelName?.trim() || model.model_name?.trim() || ''
      const name = model.name?.trim() || model.displayName?.trim() || model.label?.trim() || id
      const contextWindowTokens = toPositiveNumber(
        model.context_window_tokens ?? model.contextWindowTokens ?? model.context_window ?? model.contextWindow,
      )

      return {
        id,
        label: name,
        modelName: id,
        name,
        provider: model.provider,
        billingMode: model.billingMode ?? model.billing_mode,
        callPrice: toPositiveNumber(model.callPrice ?? model.call_price),
        planAvailable:
          model.planAvailable ??
          model.plan_available ??
          model.availableForPlan ??
          model.available_for_plan ??
          model.allowed ??
          true,
        requiredPlan: model.requiredPlan ?? model.required_plan,
        availabilityReason: model.availabilityReason ?? model.availability_reason,
        available: model.available ?? model.enabled ?? true,
        contextWindowTokens,
        contextWindowLabel: model.contextWindowLabel ?? model.context_window_label,
      }
    })
    .filter((model) => Boolean(model.id))
}

export function canCallProvider(provider: LlmProviderConfig) {
  const modelName = resolveProviderModelName(provider)

  if (provider.type === 'scallion_proxy') {
    const stateModels = useAppStore.getState().scallionModels
    const listedModelIsUsable = stateModels.some(
      (model) => model.id === modelName && model.available && model.planAvailable !== false,
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

function resolveProviderModelName(provider: LlmProviderConfig) {
  return provider.modelName.trim()
}

function assertScallionModelListed(provider: LlmProviderConfig, modelName: string) {
  if (provider.type !== 'scallion_proxy') {
    return
  }

  const listed = useAppStore.getState().scallionModels.some(
    (model) => model.id === modelName && model.available && model.planAvailable !== false,
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
  options: { temperature: number; maxTokens: number; frequencyPenalty?: number; presencePenalty?: number },
) {
  const modelName = resolveProviderModelName(provider)
  const payload: NativeLlmPayload = {
    request: {
      baseUrl: provider.baseUrl,
      modelName,
      apiKey: resolveProviderApiKey(provider),
      providerType: provider.type,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    },
  }

  try {
    return await invoke<string>('llm_chat', payload)
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error || 'LLM 请求失败，Tauri 通道不可用'))
  }
}

export function resolveChatEndpoint(baseUrl: string, providerType: ProviderType) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')

  if (!trimmed) {
    return ''
  }

  if (/\/chat\/completions$/i.test(trimmed) || /\/chat$/i.test(trimmed)) {
    return trimmed
  }

  return providerType === 'scallion_proxy' ? `${trimmed}/chat` : `${trimmed}/chat/completions`
}

function isLocalCompatibleEndpoint(baseUrl: string) {
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
  const message = payloadError?.message || `LLM 请求失败：HTTP ${status}`
  const type = payloadError?.type || payloadError?.code
  let code: LlmErrorCode = 'http_error'

  if (status === 401) code = 'unauthorized'
  else if (status === 402) code = 'quota_exhausted'
  else if (status === 403 && type === 'plan_model_forbidden') code = 'plan_model_forbidden'
  else if (status === 403) code = 'forbidden'
  else if (status === 429) code = 'rate_limited'
  else if (status >= 500) code = 'server_error'

  return new LlmRequestError(message, {
    code,
    status,
    plan: payloadError?.plan,
    recoverable: code === 'plan_model_forbidden' || code === 'server_error' || code === 'rate_limited',
  })
}

async function recoverScallionModel(provider: LlmProviderConfig) {
  try {
    const { refreshScallionModels, refreshScallionQuota } = await import('./scallionAccountService')
    await Promise.allSettled([refreshScallionModels(), refreshScallionQuota()])
    const state = useAppStore.getState()
    const next = state.scallionModels.find(
      (model) => model.available && model.planAvailable !== false && model.id,
    )

    if (!next) {
      return undefined
    }

    return {
      ...state.providerConfigs.qwen36,
      ...provider,
      modelName: next.id,
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

function toPositiveNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined
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
