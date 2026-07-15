import type { WebExtractResult as BridgeWebExtractResult } from './browserBridgeClient'
import { invokeBrowserBridge } from './browserBridgeClient'

export type WebExtractResult = BridgeWebExtractResult & {
  canonicalUrl?: string
  language?: string
  excerpt?: string
}

export type WebExtractErrorCode =
  | 'blocked'
  | 'network'
  | 'timeout'
  | 'unsupported_content_type'
  | 'response_too_large'
  | 'user_cancelled'
  | 'protocol'

export class WebExtractError extends Error {
  readonly code: WebExtractErrorCode
  readonly recoverable: boolean

  constructor(message: string, code: WebExtractErrorCode, recoverable = true) {
    super(message)
    this.name = 'WebExtractError'
    this.code = code
    this.recoverable = recoverable
  }
}

export type WebExtractInvoker = (command: string, args?: Record<string, unknown>) => Promise<unknown>

let invokeFn: WebExtractInvoker = (command, args) => invokeBrowserBridge(command, args)

export function setWebExtractInvokerForTests(next: WebExtractInvoker) {
  invokeFn = next
}

export function resetWebExtractInvokerForTests() {
  invokeFn = (command, args) => invokeBrowserBridge(command, args)
}

export async function extractPublicWebPage(url: string, runId: string, signal?: AbortSignal) {
  if (!url.trim()) {
    throw new WebExtractError('网页地址不能为空。', 'protocol', true)
  }

  let removeAbortListener: () => void = () => undefined
  let rejectOnAbort: ((reason: unknown) => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    rejectOnAbort = reject
  })

  const cancel = () => {
    try {
      void Promise.resolve(invokeFn('work_assistant_cancel_run', { run: runId })).catch(() => undefined)
    } catch {
      // Cancellation is best-effort when the native bridge is already gone;
      // the caller still receives the prompt local cancellation result.
    }
    rejectOnAbort?.(new WebExtractError('网页提取已取消。', 'user_cancelled', true))
  }

  if (signal?.aborted) {
    cancel()
    throw new WebExtractError('网页提取已取消。', 'user_cancelled', true)
  } else if (signal) {
    signal.addEventListener('abort', cancel, { once: true })
    removeAbortListener = () => signal.removeEventListener('abort', cancel)
  }

  try {
    const request = invokeExtract(url, runId)
    const result = await Promise.race([request, abortPromise]).catch((error) => {
      throw normalizeWebExtractError(error, signal)
    })
    return { ...result, provenance: 'native' as const }
  } finally {
    removeAbortListener()
  }
}

async function invokeExtract(url: string, runId: string) {
  const args = { url, runId }
  try {
    return await invokeFn('work_assistant_web_extract', args) as WebExtractResult
  } catch (error) {
    // Older WebView builds expose the pre-alias command. Only fall back when
    // the command itself is missing; network and policy errors must not issue
    // a second request.
    const message = error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : String(error ?? '')
    if (/unknown|unexpected command|not found|未找到|不存在/i.test(message)) {
      return await invokeFn('web_extract', args) as WebExtractResult
    }
    throw error
  }
}

function normalizeWebExtractError(error: unknown, signal?: AbortSignal): WebExtractError {
  if (error instanceof WebExtractError) return error
  if (signal?.aborted) return new WebExtractError('网页提取已取消。', 'user_cancelled', true)

  const payload = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const rawCode = typeof payload.code === 'string' ? payload.code.toLowerCase() : ''
  const status = typeof payload.status === 'number' ? payload.status : undefined
  const message = typeof payload.message === 'string' ? payload.message : String(error ?? '')
  const source = `${rawCode} ${message}`.toLowerCase()

  if (rawCode === 'cancelled' || rawCode === 'user_cancelled') {
    return new WebExtractError('网页提取已取消。', 'user_cancelled', true)
  }

  if (rawCode === 'unsupported_content_type' || source.includes('content type') || source.includes('内容类型')) {
    return new WebExtractError('网页内容类型不支持，仅允许 HTML 或纯文本。', 'unsupported_content_type', false)
  }
  if (rawCode === 'response_too_large' || source.includes('too large') || source.includes('超过限制')) {
    return new WebExtractError('网页响应过大，已停止读取。', 'response_too_large', true)
  }
  if (rawCode === 'timeout' || source.includes('timed out') || source.includes('超时')) {
    return new WebExtractError('网页读取超时，请稍后重试。', 'timeout', true)
  }
  if (rawCode === 'blocked' || status === 403 || source.includes('阻止') || source.includes('private') || source.includes('内网')) {
    return new WebExtractError(message || '网页地址或重定向不符合安全策略。', 'blocked', false)
  }
  if (rawCode === 'network' || source.includes('network') || source.includes('网络') || source.includes('读取网页失败')) {
    return new WebExtractError('网络暂不可用，请检查连接后重试。', 'network', true)
  }
  return new WebExtractError(message || '网页提取协议无效。', 'protocol', true)
}
