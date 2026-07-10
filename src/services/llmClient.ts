import { invoke } from '@tauri-apps/api/core'
import { useAppStore, type LlmProviderConfig } from '../stores/useAppStore'

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

type ScallionModel = {
  id?: string
  name?: string
  displayName?: string
  label?: string
  modelName?: string
  model_name?: string
  available?: boolean
  enabled?: boolean
  contextWindowTokens?: number
  context_window_tokens?: number
  contextWindow?: number
  context_window?: number
}

type ScallionModelResponse = {
  data?: ScallionModel[]
  models?: ScallionModel[]
}

type ScallionModelPayload = ScallionModelResponse | ScallionModel[]

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
) {
  const modelName = resolveProviderModelName(provider)

  if (!modelName) {
    throw new Error('Model Name 不能为空')
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

    return callViaTauri(provider, messages, {
      temperature: requestBody.temperature,
      maxTokens: requestBody.max_tokens,
    })
  }

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse

  if (!response.ok) {
    throw new Error(payload.error?.message || `LLM 请求失败：HTTP ${response.status}`)
  }

  const content = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text

  if (!content?.trim()) {
    throw new Error('LLM 没有返回可用文本')
  }

  return content.trim()
}

export async function callOpenAICompatibleStream(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  { signal, onToken, sampling }: StreamOptions,
) {
  return withLlmRetry(() => callOpenAICompatibleStreamOnce(provider, messages, { signal, onToken, sampling }))
}

async function callOpenAICompatibleStreamOnce(
  provider: LlmProviderConfig,
  messages: ChatMessage[],
  { signal, onToken, sampling }: StreamOptions,
) {
  const modelName = resolveProviderModelName(provider)

  if (!modelName) {
    throw new Error('Model Name 不能为空')
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

    const fallback = await callViaTauri(provider, messages, {
      temperature: sampling?.temperature ?? 0.45,
      maxTokens: sampling?.maxTokens ?? 8192,
      frequencyPenalty: sampling?.frequencyPenalty,
      presencePenalty: sampling?.presencePenalty,
    })
    onToken(fallback)
    return fallback
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse
    throw new Error(payload.error?.message || `LLM 请求失败：HTTP ${response.status}`)
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
    return content.trim()
  }

  return fullText.trim()
}

export async function fetchScallionProxyModels(provider: LlmProviderConfig) {
  if (provider.type !== 'scallion_proxy' || !provider.baseUrl.trim()) {
    return []
  }

  const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/models`
  const headers: Record<string, string> = {}
  const apiKey = resolveProviderApiKey(provider)

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(endpoint, { method: 'GET', headers })
  const payload = (await response.json().catch(() => ({}))) as ScallionModelPayload

  if (!response.ok) {
    throw new Error(`模型元数据请求失败：HTTP ${response.status}`)
  }

  const models = Array.isArray(payload) ? payload : payload.models ?? payload.data ?? []

  return (
    models.map((model) => ({
      id: model.id || model.modelName || model.model_name || model.name || model.displayName || '',
      label: model.label || model.displayName || model.name || model.modelName || model.model_name || model.id || '',
      modelName: model.id || model.modelName || model.model_name || model.name || '',
      available: model.available ?? model.enabled ?? true,
      contextWindowTokens:
        model.contextWindowTokens ??
        model.context_window_tokens ??
        model.contextWindow ??
        model.context_window,
    }))
  ).filter((model) => model.id || model.modelName || model.contextWindowTokens)
}

export function canCallProvider(provider: LlmProviderConfig) {
  const modelName = resolveProviderModelName(provider)

  if (provider.type === 'scallion_proxy') {
    return Boolean(provider.baseUrl.trim() && modelName && resolveProviderApiKey(provider))
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

async function withLlmRetry<T>(run: () => Promise<T>, maxAttempts = 3): Promise<T> {
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

      if (!isTransientLlmError(error) || attempt >= maxAttempts) {
        break
      }

      await delay(650 * attempt ** 2)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('LLM 请求失败')
}

function isTransientLlmError(error: unknown) {
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
