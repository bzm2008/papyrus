import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

type Listener = (...args: unknown[]) => unknown

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static latest: MockWebSocket | undefined
  readonly url: string
  readonly sent: unknown[] = []
  readyState = MockWebSocket.OPEN
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
  private messageListeners: Listener[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.latest = this
  }

  addEventListener(type: string, listener: Listener) {
    if (type === 'message') this.messageListeners.push(listener)
  }

  send(value: string) {
    this.sent.push(JSON.parse(value))
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  emitMessage(value: unknown) {
    const event = { data: JSON.stringify(value) }
    this.onmessage?.(event)
    for (const listener of [...this.messageListeners]) listener(event)
  }
}

function createHarness() {
  const messageListeners: Listener[] = []
  const removedListeners: Listener[] = []
  const activatedListeners: Listener[] = []
  const updatedListeners: Listener[] = []
  const injected: Array<Record<string, unknown>> = []
  const removedStorage: string[][] = []
  const sentToTab: Array<{ tabId: number; message: unknown }> = []
  const intervalCallbacks: Array<() => void> = []

  const chrome = {
    runtime: {
      id: 'papyrus-test-extension',
      onMessage: { addListener: (listener: Listener) => messageListeners.push(listener) },
    },
    scripting: {
      executeScript: async (details: Record<string, unknown>) => {
        injected.push(details)
        return []
      },
    },
    tabs: {
      sendMessage: async (tabId: number, message: unknown) => {
        sentToTab.push({ tabId, message })
        return {
          ok: true,
          summary: '快照已返回',
          snapshot: {
            snapshotId: 'snapshot-1',
            pageRevision: 'revision-1',
            url: 'https://example.com',
            origin: 'https://example.com',
            title: 'Example',
            text: 'Public',
            elements: [],
          },
        }
      },
      onRemoved: { addListener: (listener: Listener) => removedListeners.push(listener) },
      onActivated: { addListener: (listener: Listener) => activatedListeners.push(listener) },
      onUpdated: { addListener: (listener: Listener) => updatedListeners.push(listener) },
    },
    storage: { session: { remove: async (keys: string[]) => removedStorage.push(keys) } },
  }

  const context = vm.createContext({
    chrome,
    WebSocket: MockWebSocket,
    URL,
    setTimeout,
    clearTimeout,
    setInterval: (callback: () => void) => {
      intervalCallbacks.push(callback)
      return callback
    },
    clearInterval: (callback: () => void) => {
      const index = intervalCallbacks.indexOf(callback)
      if (index >= 0) intervalCallbacks.splice(index, 1)
    },
    console,
  })
  const workerPath = path.resolve(process.cwd(), 'apps/browser-bridge/service_worker.js')
  vm.runInContext(fs.readFileSync(workerPath, 'utf8'), context, { filename: workerPath })

  return {
    chrome,
    listeners: messageListeners,
    removedListeners,
    activatedListeners,
    updatedListeners,
    injected,
    removedStorage,
    sentToTab,
    intervalCallbacks,
  }
}

function findListener(harness: ReturnType<typeof createHarness>) {
  const listener = harness.listeners[0]
  expect(listener).toBeTypeOf('function')
  return listener
}

async function flushAsync() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe('Browser Bridge extension protocol', () => {
  it('pairs only the requested current tab and forwards bounded requests', async () => {
    const harness = createHarness()
    const listener = findListener(harness)
    const responses: unknown[] = []
    const result = listener(
      {
        type: 'connect',
        config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-1', nonce: 'nonce-1' },
        tabId: 17,
        origin: 'https://example.com',
      },
      {},
      (value: unknown) => responses.push(value),
    )

    expect(result).toBe(true)
    await flushAsync()
    expect(harness.injected).toEqual([{ target: { tabId: 17 }, files: ['content_script.js'] }])
    const socket = MockWebSocket.latest
    expect(socket?.url).toBe('ws://127.0.0.1:43121/bridge')
    socket?.onopen?.()
    expect(socket?.sent).toEqual([
      {
        type: 'pair',
        payload: {
          token: 'token-1',
          nonce: 'nonce-1',
          extensionId: 'papyrus-test-extension',
          tabId: 17,
          origin: 'https://example.com',
        },
      },
    ])

    socket?.emitMessage({ type: 'paired' })
    await flushAsync()
    expect(responses).toEqual([{ ok: true }])
    expect(harness.removedStorage).toContainEqual(['wsUrl', 'token', 'nonce'])
    expect(harness.intervalCallbacks).toHaveLength(1)

    socket?.emitMessage({ type: 'request', requestId: 'request-1', action: 'snapshot', payload: {} })
    await flushAsync()
    expect(harness.sentToTab).toEqual([{ tabId: 17, message: { type: 'bridge.request', action: 'snapshot', payload: {} } }])
    expect(socket?.sent.at(-1)).toEqual({
      type: 'response',
      requestId: 'request-1',
      tabId: 17,
      payload: { ok: true, summary: '快照已返回' },
      snapshot: {
        snapshotId: 'snapshot-1',
        pageRevision: 'revision-1',
        url: 'https://example.com',
        origin: 'https://example.com',
        title: 'Example',
        text: 'Public',
        elements: [],
      },
    })
    harness.intervalCallbacks[0]?.()
    expect(socket?.sent.at(-1)).toMatchObject({ type: 'heartbeat', at: expect.any(Number) })
  })

  it('invalidates the active connection when the tab changes or disconnects', async () => {
    const harness = createHarness()
    const listener = findListener(harness)
    const responses: unknown[] = []
    listener(
      {
        type: 'connect',
        config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-2', nonce: 'nonce-2' },
        tabId: 18,
        origin: 'https://example.com',
      },
      {},
      (value: unknown) => responses.push(value),
    )
    await flushAsync()
    const socket = MockWebSocket.latest
    socket?.onopen?.()
    socket?.emitMessage({ type: 'paired' })
    await flushAsync()

    harness.activatedListeners[0]({ tabId: 99 })
    expect(socket?.readyState).toBe(MockWebSocket.CLOSED)
    expect(harness.intervalCallbacks).toHaveLength(0)

    const disconnectResponse: unknown[] = []
    listener({ type: 'disconnect' }, {}, (value: unknown) => disconnectResponse.push(value))
    expect(disconnectResponse).toEqual([{ ok: false }])
    expect(responses).toEqual([{ ok: true }])
  })

  it('rejects non-loopback bridge endpoints and non-web page origins before injection', async () => {
    const harness = createHarness()
    const listener = findListener(harness)
    const responses: unknown[] = []

    listener(
      {
        type: 'connect',
        config: { wsUrl: 'ws://localhost:43121/bridge', token: 'token-local', nonce: 'nonce-local' },
        tabId: 19,
        origin: 'https://example.com',
      },
      {},
      (value: unknown) => responses.push(value),
    )
    await flushAsync()

    listener(
      {
        type: 'connect',
        config: { wsUrl: 'wss://127.0.0.1:43121/bridge', token: 'token-tls', nonce: 'nonce-tls' },
        tabId: 19,
        origin: 'https://example.com',
      },
      {},
      (value: unknown) => responses.push(value),
    )
    await flushAsync()

    listener(
      {
        type: 'connect',
        config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-file', nonce: 'nonce-file' },
        tabId: 19,
        origin: 'file:///tmp/document.html',
      },
      {},
      (value: unknown) => responses.push(value),
    )
    await flushAsync()

    expect(responses).toEqual([
      { ok: false, message: '配对地址必须是 Papyrus 提供的本机回环地址。' },
      { ok: false, message: '配对地址必须是 Papyrus 提供的本机回环地址。' },
      { ok: false, message: '仅支持 http(s) 网页。' },
    ])
    expect(harness.injected).toHaveLength(0)
  })

  it('notifies the native bridge before a cross-origin navigation and reinjects after load', async () => {
    const harness = createHarness()
    const listener = findListener(harness)
    const responses: unknown[] = []
    listener(
      {
        type: 'connect',
        config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-3', nonce: 'nonce-3' },
        tabId: 20,
        origin: 'https://example.com',
      },
      {},
      (value: unknown) => responses.push(value),
    )
    await flushAsync()
    const socket = MockWebSocket.latest
    socket?.onopen?.()
    socket?.emitMessage({ type: 'paired' })
    await flushAsync()

    harness.updatedListeners[0](20, { status: 'loading', url: 'https://other.example.test/' })
    expect(socket?.sent.at(-1)).toEqual({ type: 'navigation' })

    harness.updatedListeners[0](20, { status: 'complete', url: 'https://other.example.test/' })
    await flushAsync()
    expect(harness.injected.at(-1)).toEqual({ target: { tabId: 20 }, files: ['content_script.js'] })
    expect(responses).toEqual([{ ok: true }])
  })
})
