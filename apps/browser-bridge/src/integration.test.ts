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
  const timeoutCallbacks: Array<{ callback: () => void; delay: number }> = []
  let failInjection = false
  let tabMessageHandler: (tabId: number, message: unknown) => Promise<unknown> = async () => ({
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
  })

  const chrome = {
    runtime: {
      id: 'papyrus-test-extension',
      onMessage: { addListener: (listener: Listener) => messageListeners.push(listener) },
    },
    scripting: {
      executeScript: async (details: Record<string, unknown>) => {
        injected.push(details)
        if (failInjection) throw new Error('injection blocked')
        return []
      },
    },
    tabs: {
      sendMessage: async (tabId: number, message: unknown) => {
        sentToTab.push({ tabId, message })
        return tabMessageHandler(tabId, message)
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
    setTimeout: (callback: () => void, delay: number) => {
      const timer = { callback, delay }
      timeoutCallbacks.push(timer)
      return timer
    },
    clearTimeout: (timer: { callback: () => void; delay: number }) => {
      const index = timeoutCallbacks.indexOf(timer)
      if (index >= 0) timeoutCallbacks.splice(index, 1)
    },
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
    runTimeout: (delay: number) => {
      const index = timeoutCallbacks.findIndex((timer) => timer.delay === delay)
      if (index < 0) return false
      const [timer] = timeoutCallbacks.splice(index, 1)
      timer.callback()
      return true
    },
    setFailInjection: (value: boolean) => { failInjection = value },
    setTabMessageHandler: (handler: (tabId: number, message: unknown) => Promise<unknown>) => { tabMessageHandler = handler },
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
  it('keeps the shared JSON protocol fixtures parseable by the extension harness', () => {
    const fixtureDir = path.resolve(process.cwd(), 'apps/browser-bridge/test-fixtures/protocol')
    for (const file of ['pair.json', 'snapshot.json', 'action-request.json', 'action-response.json']) {
      const value = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8')) as Record<string, unknown>
      expect(value.type).toBeTypeOf('string')
    }
  })

  it('rejects a missing active tab before attempting injection', async () => {
    const harness = createHarness()
    const listener = findListener(harness)
    const responses: unknown[] = []

    listener({ type: 'connect', config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-missing', nonce: 'nonce-missing' }, origin: 'https://example.com' }, {}, (value: unknown) => responses.push(value))
    await flushAsync()

    expect(responses).toEqual([{ ok: false, message: '当前标签页无效。' }])
    expect(harness.injected).toHaveLength(0)
  })

  it('reports injection failures without opening a socket', async () => {
    const harness = createHarness()
    harness.setFailInjection(true)
    const listener = findListener(harness)
    const responses: unknown[] = []

    listener({ type: 'connect', config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-inject', nonce: 'nonce-inject' }, tabId: 21, origin: 'https://example.com' }, {}, (value: unknown) => responses.push(value))
    await flushAsync()

    expect(responses).toEqual([{ ok: false, message: '当前页面不允许注入 Browser Bridge。' }])
    expect(MockWebSocket.latest).toBeUndefined()
  })

  it('surfaces a wrong pairing response and keeps the token for a retry', async () => {
    const harness = createHarness()
    const listener = findListener(harness)
    const responses: unknown[] = []
    listener({ type: 'connect', config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-wrong', nonce: 'nonce-wrong' }, tabId: 22, origin: 'https://example.com' }, {}, (value: unknown) => responses.push(value))
    await flushAsync()
    const socket = MockWebSocket.latest
    socket?.onopen?.()
    socket?.emitMessage({ type: 'error', message: 'token mismatch' })
    await flushAsync()

    expect(responses).toEqual([{ ok: false, message: 'token mismatch' }])
    expect(harness.removedStorage).toHaveLength(0)
  })

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

  it('requires explicit re-pairing after a service-worker restart', async () => {
    const harness = createHarness()
    const listener = findListener(harness)
    listener({ type: 'connect', config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-restart', nonce: 'nonce-restart' }, tabId: 24, origin: 'https://example.com' }, {}, () => undefined)
    await flushAsync()
    const socket = MockWebSocket.latest
    socket?.onopen?.()
    socket?.emitMessage({ type: 'paired' })
    await flushAsync()
    expect(harness.removedStorage).toContainEqual(['wsUrl', 'token', 'nonce'])

    const restarted = createHarness()
    const statusResponses: unknown[] = []
    findListener(restarted)({ type: 'status' }, {}, (value: unknown) => statusResponses.push(value))
    expect(statusResponses[0]).toMatchObject({ ok: false })
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

  it('closes the bridge when the paired tab is removed', async () => {
    const harness = createHarness()
    const listener = findListener(harness)
    listener({ type: 'connect', config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-close', nonce: 'nonce-close' }, tabId: 23, origin: 'https://example.com' }, {}, () => undefined)
    await flushAsync()
    const socket = MockWebSocket.latest
    socket?.onopen?.()
    socket?.emitMessage({ type: 'paired' })
    await flushAsync()

    harness.removedListeners[0](23)
    expect(socket?.readyState).toBe(MockWebSocket.CLOSED)
    expect(harness.intervalCallbacks).toHaveLength(0)
  })

  it('clears the active tab and heartbeat when the socket closes remotely', async () => {
    const harness = createHarness()
    const listener = findListener(harness)
    listener({ type: 'connect', config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-remote-close', nonce: 'nonce-remote-close' }, tabId: 25, origin: 'https://example.com' }, {}, () => undefined)
    await flushAsync()
    const socket = MockWebSocket.latest
    socket?.onopen?.()
    socket?.emitMessage({ type: 'paired' })
    await flushAsync()
    expect(harness.intervalCallbacks).toHaveLength(1)

    socket?.close()
    expect(harness.intervalCallbacks).toHaveLength(0)
    const statusResponses: unknown[] = []
    listener({ type: 'status' }, {}, (value: unknown) => statusResponses.push(value))
    expect(statusResponses).toEqual([{ ok: false, tabId: undefined }])
  })

  it('drops a tab response that resolves after the connection generation changes', async () => {
    const harness = createHarness()
    let releaseResponse: ((value: unknown) => void) | undefined
    harness.setTabMessageHandler(() => new Promise((resolve) => { releaseResponse = resolve }))
    const listener = findListener(harness)
    listener({ type: 'connect', config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-stale-1', nonce: 'nonce-stale-1' }, tabId: 26, origin: 'https://example.com' }, {}, () => undefined)
    await flushAsync()
    const firstSocket = MockWebSocket.latest
    firstSocket?.onopen?.()
    firstSocket?.emitMessage({ type: 'paired' })
    await flushAsync()

    firstSocket?.emitMessage({ type: 'request', requestId: 'stale-request', action: 'snapshot', payload: {} })
    await flushAsync()
    expect(harness.sentToTab).toHaveLength(1)

    harness.activatedListeners[0]({ tabId: 99 })
    listener({ type: 'connect', config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-stale-2', nonce: 'nonce-stale-2' }, tabId: 99, origin: 'https://example.com' }, {}, () => undefined)
    await flushAsync()
    const secondSocket = MockWebSocket.latest
    secondSocket?.onopen?.()
    secondSocket?.emitMessage({ type: 'paired' })
    await flushAsync()
    const sentBeforeRelease = [...secondSocket?.sent ?? []]

    releaseResponse?.({ ok: true, summary: '来自旧标签页', snapshot: { snapshotId: 'old', pageRevision: 'old', url: 'https://example.com', origin: 'https://example.com', title: 'Old', text: 'Old', elements: [] } })
    await flushAsync()

    expect(secondSocket?.sent).toEqual(sentBeforeRelease)
    expect(secondSocket?.sent).not.toContainEqual(expect.objectContaining({ type: 'response', requestId: 'stale-request' }))
  })

  it('drops an in-flight tab response after navigation starts', async () => {
    const harness = createHarness()
    let releaseResponse: ((value: unknown) => void) | undefined
    harness.setTabMessageHandler(() => new Promise((resolve) => { releaseResponse = resolve }))
    const listener = findListener(harness)
    listener({ type: 'connect', config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-navigation', nonce: 'nonce-navigation' }, tabId: 28, origin: 'https://example.com' }, {}, () => undefined)
    await flushAsync()
    const socket = MockWebSocket.latest
    socket?.onopen?.()
    socket?.emitMessage({ type: 'paired' })
    await flushAsync()

    socket?.emitMessage({ type: 'request', requestId: 'navigation-request', action: 'snapshot', payload: {} })
    await flushAsync()
    harness.updatedListeners[0](28, { status: 'loading', url: 'https://example.com/next' })
    const sentBeforeRelease = [...socket?.sent ?? []]
    releaseResponse?.({ ok: true, summary: '来自导航前页面', snapshot: { snapshotId: 'old', pageRevision: 'old', url: 'https://example.com', origin: 'https://example.com', title: 'Old', text: 'Old', elements: [] } })
    await flushAsync()

    expect(socket?.sent).toEqual(sentBeforeRelease)
    expect(socket?.sent).not.toContainEqual(expect.objectContaining({ type: 'response', requestId: 'navigation-request' }))
  })

  it('closes a handshake that times out and ignores a late paired frame', async () => {
    const harness = createHarness()
    const listener = findListener(harness)
    const responses: unknown[] = []
    listener({ type: 'connect', config: { wsUrl: 'ws://127.0.0.1:43121/bridge', token: 'token-timeout', nonce: 'nonce-timeout' }, tabId: 27, origin: 'https://example.com' }, {}, (value: unknown) => responses.push(value))
    await flushAsync()
    const socket = MockWebSocket.latest
    expect(socket).toBeDefined()
    expect(socket?.url).toBe('ws://127.0.0.1:43121/bridge')

    expect(harness.runTimeout(5000)).toBe(true)
    await flushAsync()
    expect(responses).toEqual([{ ok: false, message: '连接超时。' }])
    expect(socket?.readyState).toBe(MockWebSocket.CLOSED)
    expect(harness.intervalCallbacks).toHaveLength(0)

    socket?.emitMessage({ type: 'paired' })
    await Promise.resolve()
    expect(harness.intervalCallbacks).toHaveLength(0)
    expect(harness.removedStorage).toHaveLength(0)

    const statusResponses: unknown[] = []
    listener({ type: 'status' }, {}, (value: unknown) => statusResponses.push(value))
    expect(statusResponses).toEqual([{ ok: false, tabId: undefined }])
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
