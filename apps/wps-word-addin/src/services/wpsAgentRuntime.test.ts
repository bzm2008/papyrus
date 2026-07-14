import { afterEach, describe, expect, it, vi } from 'vitest'
import * as unifiedAgent from './wpsUnifiedAgent'
import * as documentBridge from './wpsDocumentBridge'
import { classifyWpsAgentError, readSseResponse, shouldRefreshWpsQuotaAfterError } from './wpsAgentRuntime'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type RuntimeExports = {
  parseSseChunks?: (chunks: string[]) => string
  shouldFallbackToNonStream?: (receivedToken: boolean, error: unknown) => boolean
}

type BridgeExports = {
  createSelectionFingerprint?: (selection: string) => string
}

const runtime = unifiedAgent as typeof unifiedAgent & RuntimeExports
const bridge = documentBridge as typeof documentBridge & BridgeExports

describe('WPS agent streaming protocol', () => {
  it('reassembles SSE tokens split across chunks', () => {
    expect(runtime.parseSseChunks).toEqual(expect.any(Function))
    const result = runtime.parseSseChunks?.([
      'data: {"choices":[{"delta":{"content":"第"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"一句"}}]}\n\n',
      'data: [DONE]\n\n',
    ])

    expect(result).toBe('第一句')
  })

  it('only falls back before the stream receives a token', () => {
    expect(runtime.shouldFallbackToNonStream).toEqual(expect.any(Function))
    expect(runtime.shouldFallbackToNonStream?.(false, new TypeError('Failed to fetch'))).toBe(true)
    expect(runtime.shouldFallbackToNonStream?.(true, new TypeError('Failed to fetch'))).toBe(false)
    expect(runtime.shouldFallbackToNonStream?.(false, new DOMException('Aborted', 'AbortError'))).toBe(false)
  })

  it('accepts split data prefixes and gateway JSON responses', () => {
    expect(runtime.parseSseChunks?.([
      'da',
      'ta: {"choices":[{"delta":{"content":"流式"}}]}\n',
      'data: {"choices":[{"delta":{"content":"兼容"}}]}\n',
    ])).toBe('流式兼容')
    expect(runtime.parseSseChunks?.([
      '{"choices":[{"message":{"content":"普通 JSON"}}]}',
    ])).toBe('普通 JSON')
  })

  it('classifies timeout and authentication errors for the UI', () => {
    expect(classifyWpsAgentError(new Error('HTTP 401')).kind).toBe('authentication')
    expect(classifyWpsAgentError(new Error('request timeout')).kind).toBe('timeout')
    expect(classifyWpsAgentError(new DOMException('Aborted', 'AbortError')).kind).toBe('cancelled')
    expect(
      classifyWpsAgentError(Object.assign(new Error('当前套餐不可用该模型'), { code: 'plan_model_forbidden' })).kind,
    ).toBe('plan_forbidden')
  })

  it('refreshes quota after non-cancelled model errors but not auth or cancellation', () => {
    expect(shouldRefreshWpsQuotaAfterError(new Error('HTTP 402'))).toBe(true)
    expect(shouldRefreshWpsQuotaAfterError(new Error('HTTP 503'))).toBe(true)
    expect(shouldRefreshWpsQuotaAfterError(new DOMException('Aborted', 'AbortError'))).toBe(false)
    expect(shouldRefreshWpsQuotaAfterError(Object.assign(new Error('JWT 失效'), { status: 401 }))).toBe(false)
  })

  it('preserves gateway error code, status, and retryability', () => {
    const unauthorized = classifyWpsAgentError(
      Object.assign(new Error('JWT 失效'), { code: 'unauthorized', status: 401, retryable: false }),
    )
    expect(unauthorized).toMatchObject({
      kind: 'authentication',
      code: 'unauthorized',
      status: 401,
      retryable: false,
      recoverable: false,
    })

    const forbidden = classifyWpsAgentError(
      Object.assign(new Error('当前套餐不可用该模型'), { code: 'plan_model_forbidden', status: 403 }),
    )
    expect(forbidden).toMatchObject({
      kind: 'plan_forbidden',
      code: 'plan_model_forbidden',
      status: 403,
      retryable: false,
    })
  })

  it('keeps structured auth errors when a streaming request fails before its first token', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'agnes-2.0-flash', plan_available: true }] }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { type: 'unauthorized', message: 'JWT 失效' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })

    await expect(
      unifiedAgent.callScallion(
        'stream-auth-test-token',
        'agnes-2.0-flash',
        [{ role: 'user', content: '测试' }],
        0.2,
        128,
        { stream: true },
      ),
    ).rejects.toMatchObject({
      name: 'WpsAgentError',
      kind: 'authentication',
      code: 'unauthorized',
      status: 401,
      retryable: false,
    })
  })

  it('rejects a truncated SSE response after partial content', async () => {
    const encoder = new TextEncoder()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"半截"}}]}\n\n'))
        controller.close()
      },
    }))

    await expect(readSseResponse(response, {})).rejects.toMatchObject({ kind: 'network' })
  })

  it('accepts a completed SSE response', async () => {
    const encoder = new TextEncoder()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"完整"}}]}\n\ndata: [DONE]\n\n'))
        controller.close()
      },
    }))

    await expect(readSseResponse(response, {})).resolves.toBe('完整')
  })
})

describe('WPS patch source protection', () => {
  it('creates a stable fingerprint for the source selection', () => {
    expect(bridge.createSelectionFingerprint).toEqual(expect.any(Function))
    expect(bridge.createSelectionFingerprint?.('  原始\r\n选区  ')).toBe(
      bridge.createSelectionFingerprint?.('原始\n选区'),
    )
  })

  it('changes the fingerprint when the selection changes', () => {
    expect(bridge.createSelectionFingerprint?.('原始选区')).not.toBe(
      bridge.createSelectionFingerprint?.('已修改选区'),
    )
  })
})
