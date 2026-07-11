export type WpsAgentTransport = 'stream' | 'non_stream'

export type WpsAgentErrorKind =
  | 'cancelled'
  | 'timeout'
  | 'authentication'
  | 'network'
  | 'server'
  | 'protocol'
  | 'stream_unavailable'

export class WpsAgentError extends Error {
  readonly kind: WpsAgentErrorKind
  readonly recoverable: boolean

  constructor(kind: WpsAgentErrorKind, message: string, recoverable = kind === 'network' || kind === 'server' || kind === 'stream_unavailable') {
    super(message)
    this.name = 'WpsAgentError'
    this.kind = kind
    this.recoverable = recoverable
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

export function classifyWpsAgentError(error: unknown): WpsAgentError {
  if (error instanceof WpsAgentError) {
    return error
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new WpsAgentError('cancelled', '已取消本次生成。', false)
  }

  const message = error instanceof Error ? error.message : String(error || '')

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
