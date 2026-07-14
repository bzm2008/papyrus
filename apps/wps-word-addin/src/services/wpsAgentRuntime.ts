export type WpsAgentTransport = 'stream' | 'non_stream'

export type WpsAgentErrorKind =
  | 'cancelled'
  | 'timeout'
  | 'authentication'
  | 'plan_forbidden'
  | 'network'
  | 'server'
  | 'protocol'
  | 'stream_unavailable'

export class WpsAgentError extends Error {
  readonly kind: WpsAgentErrorKind
  readonly recoverable: boolean
  readonly code?: string
  readonly status?: number
  readonly retryable: boolean

  constructor(
    kind: WpsAgentErrorKind,
    message: string,
    recoverable = kind === 'network' || kind === 'server' || kind === 'stream_unavailable',
    details: { code?: string; status?: number; retryable?: boolean } = {},
  ) {
    super(message)
    this.name = 'WpsAgentError'
    this.kind = kind
    this.recoverable = recoverable
    this.code = details.code ?? defaultErrorCode(kind)
    this.status = details.status
    this.retryable = details.retryable ?? recoverable
  }
}

export function parseSseChunks(chunks: string[]) {
  let buffer = ''
  let text = ''

  for (const chunk of chunks) {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      text += parseSseLine(line)
    }
  }

  return text + parseSseLine(buffer)
}

export function shouldFallbackToNonStream(receivedToken: boolean, error: unknown) {
  if (receivedToken) {
    return false
  }
  const kind = classifyWpsAgentError(error).kind
  return kind === 'network' || kind === 'timeout' || kind === 'server' || kind === 'stream_unavailable'
}

export function shouldRefreshWpsQuotaAfterError(error: unknown) {
  const classified = classifyWpsAgentError(error)
  return classified.kind !== 'cancelled' && classified.kind !== 'authentication'
}

export function classifyWpsAgentError(error: unknown): WpsAgentError {
  if (error instanceof WpsAgentError) {
    return error
  }

  const details = readErrorDetails(error)
  const message = error instanceof Error ? error.message : String(error || '')
  const inferredStatus = details.status ?? parseHttpStatus(message)
  const normalizedDetails = inferredStatus === details.status ? details : { ...details, status: inferredStatus }

  if (normalizedDetails.code === 'plan_model_forbidden') {
    return new WpsAgentError('plan_forbidden', '当前套餐不可用该模型，请从模型目录选择套餐内模型。', false, {
      ...normalizedDetails,
      retryable: false,
    })
  }

  if (normalizedDetails.status === 401 || normalizedDetails.code === 'unauthorized') {
    return new WpsAgentError('authentication', '登录状态已失效，请重新登录。', false, {
      ...normalizedDetails,
      code: normalizedDetails.code ?? 'unauthorized',
      retryable: false,
    })
  }

  if (normalizedDetails.status === 403 || normalizedDetails.code === 'forbidden') {
    return new WpsAgentError('authentication', '当前请求未获 Scallion 授权，请刷新套餐或重新登录。', false, {
      ...normalizedDetails,
      code: normalizedDetails.code ?? 'forbidden',
      retryable: false,
    })
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new WpsAgentError('cancelled', '已取消本次生成。', false)
  }

  if (/timeout|超时/i.test(message)) {
    return new WpsAgentError('timeout', '模型响应超时，请稍后重试。')
  }

  if (/401|403|unauthorized|forbidden|登录/i.test(message)) {
    return new WpsAgentError('authentication', '登录状态已失效，请重新登录。', false)
  }

  if (/failed to fetch|network|网络|connection|stream/i.test(message)) {
    return new WpsAgentError('network', '模型连接中断，可重试本次任务。')
  }

  if (/json|协议|返回|content/i.test(message)) {
    return new WpsAgentError('protocol', '模型返回格式异常，本次结果不会写入文档。', false)
  }

  return new WpsAgentError('server', message || '模型服务暂不可用，可重试本次任务。')
}

function parseHttpStatus(message: string) {
  const match = message.match(/\bHTTP\s*(\d{3})\b|\bstatus\s*[:=]?\s*(\d{3})\b/i)
  const status = Number(match?.[1] ?? match?.[2])
  return Number.isInteger(status) ? status : undefined
}

function readErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') {
    return { code: undefined, status: undefined, retryable: undefined }
  }

  const value = error as { code?: unknown; status?: unknown; retryable?: unknown; recoverable?: unknown }
  const status = typeof value.status === 'number' && Number.isFinite(value.status) ? value.status : undefined
  const code = typeof value.code === 'string' && value.code.trim() ? value.code.trim() : undefined
  const retryable = typeof value.retryable === 'boolean'
    ? value.retryable
    : typeof value.recoverable === 'boolean'
      ? value.recoverable
      : undefined

  return { code, status, retryable }
}

function defaultErrorCode(kind: WpsAgentErrorKind) {
  const codes: Partial<Record<WpsAgentErrorKind, string>> = {
    cancelled: 'aborted',
    timeout: 'timeout',
    authentication: 'unauthorized',
    plan_forbidden: 'plan_model_forbidden',
    network: 'network_error',
    server: 'server_error',
    protocol: 'protocol_error',
    stream_unavailable: 'stream_unavailable',
  }

  return codes[kind]
}

export async function readSseResponse(
  response: Response,
  options: { signal?: AbortSignal; onToken?: (text: string) => void },
) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new WpsAgentError('stream_unavailable', '当前 WPS 环境不支持流式响应。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let sawSseEvent = false
  let sawDone = false

  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const { value, done } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim().startsWith('data:')) {
        sawSseEvent = true
      }
      if (isDoneLine(line)) {
        sawDone = true
        continue
      }
      const token = parseSseLine(line)
      if (token) {
        text += token
        options.onToken?.(text)
      }
    }
  }

  buffer += decoder.decode()
  if (buffer.trim().startsWith('data:')) {
    sawSseEvent = true
  }
  if (isDoneLine(buffer)) {
    sawDone = true
  }
  const tail = parseSseLine(buffer)
  if (tail) {
    text += tail
    options.onToken?.(text)
  }

  if (sawSseEvent && !sawDone) {
    throw new WpsAgentError('network', text ? '流式响应中断，已接收的草稿不会写入文档。' : '流式响应中断，可重试本次任务。')
  }

  if (!text.trim()) {
    throw new WpsAgentError('stream_unavailable', '流式响应未返回文本。')
  }

  return text.trim()
}

function parseSseLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':') || trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
    return ''
  }

  const payloadText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
  try {
    const payload = JSON.parse(payloadText) as {
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string }; text?: string }>
    }
    const choice = payload.choices?.[0]
    return choice?.delta?.content || choice?.message?.content || choice?.text || ''
  } catch {
    return ''
  }
}

function isDoneLine(line: string) {
  const trimmed = line.trim()
  return trimmed === 'data: [DONE]' || trimmed === '[DONE]'
}
