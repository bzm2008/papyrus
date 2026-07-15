let bridgeSocket
let activeTabId
let reconnectTimer
let heartbeatTimer
let connectionGeneration = 0
let tabGeneration = 0

function isLoopbackBridgeUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'ws:'
      && parsed.hostname === '127.0.0.1'
      && Boolean(parsed.port)
      && (parsed.pathname === '/bridge' || parsed.pathname === '/bridge/')
  } catch {
    return false
  }
}

function sendSocket(value) {
  if (bridgeSocket?.readyState === WebSocket.OPEN) bridgeSocket.send(JSON.stringify(value))
}

function sendSocketTo(socket, value) {
  if (bridgeSocket !== socket || socket.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(value))
  return true
}

function closeSocket() {
  connectionGeneration += 1
  tabGeneration += 1
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = undefined
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = undefined
  activeTabId = undefined
  const socket = bridgeSocket
  bridgeSocket = undefined
  if (socket) socket.close()
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  sendSocket({ type: 'heartbeat', at: Date.now() })
  heartbeatTimer = setInterval(() => sendSocket({ type: 'heartbeat', at: Date.now() }), 15000)
}

async function connectBridge(config, tabId, origin) {
  if (!isLoopbackBridgeUrl(config?.wsUrl)) return { ok: false, message: '配对地址必须是 Papyrus 提供的本机回环地址。' }
  if (!Number.isInteger(tabId) || tabId < 0) return { ok: false, message: '当前标签页无效。' }
  try {
    if (!/^https?:$/.test(new URL(origin).protocol)) return { ok: false, message: '仅支持 http(s) 网页。' }
  } catch {
    return { ok: false, message: '网页来源无效。' }
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content_script.js'] })
  } catch {
    return { ok: false, message: '当前页面不允许注入 Browser Bridge。' }
  }
  closeSocket()
  const generation = ++connectionGeneration
  const socket = new WebSocket(config.wsUrl)
  bridgeSocket = socket
  activeTabId = tabId
  socket.onopen = () => sendSocket({ type: 'pair', payload: { token: config.token, nonce: config.nonce, extensionId: chrome.runtime.id, tabId, origin } })
  socket.onmessage = async (event) => {
    if (bridgeSocket !== socket || generation !== connectionGeneration || activeTabId !== tabId) return
    let message
    try { message = JSON.parse(event.data) } catch { return }
    if (message.type !== 'request' || message.requestId == null || activeTabId == null) return
    const requestTabId = activeTabId
    const requestTabGeneration = tabGeneration
    try {
      const response = await chrome.tabs.sendMessage(requestTabId, { type: 'bridge.request', action: message.action, payload: message.payload })
      if (bridgeSocket !== socket || generation !== connectionGeneration || activeTabId !== requestTabId || tabGeneration !== requestTabGeneration) return
      const snapshot = response && typeof response === 'object' ? response.snapshot : undefined
      const payload = response && typeof response === 'object' ? { ...response } : response
      if (payload && typeof payload === 'object') delete payload.snapshot
      sendSocketTo(socket, { type: 'response', requestId: message.requestId, tabId: requestTabId, payload, ...(snapshot ? { snapshot } : {}) })
    } catch (error) {
      if (bridgeSocket !== socket || generation !== connectionGeneration || activeTabId !== requestTabId || tabGeneration !== requestTabGeneration) return
      sendSocketTo(socket, { type: 'response', requestId: message.requestId, tabId: requestTabId, payload: { ok: false, summary: error instanceof Error ? error.message : '标签页不可用', errorCode: 'browser_disconnected', recoverable: true } })
    }
  }
  socket.onerror = () => undefined
  socket.onclose = () => {
    if (bridgeSocket !== socket || generation !== connectionGeneration) return
    bridgeSocket = undefined
    reconnectTimer = undefined
    activeTabId = undefined
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (bridgeSocket === socket && generation === connectionGeneration) closeSocket()
      resolve({ ok: false, message: '连接超时。' })
    }, 5000)
    socket.addEventListener('message', (event) => {
      if (bridgeSocket !== socket || generation !== connectionGeneration) return
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'paired') {
          clearTimeout(timer)
          startHeartbeat()
          // The native side consumes the token after this handshake. Remove it
          // from the extension session store so a popup cannot replay it.
          chrome.storage.session.remove(['wsUrl', 'token', 'nonce'])
          resolve({ ok: true })
        } else if (message.type === 'error') {
          clearTimeout(timer)
          closeSocket()
          resolve({ ok: false, message: typeof message.message === 'string' ? message.message.slice(0, 200) : 'Browser Bridge 配对失败。' })
        }
      } catch { /* ignore malformed bridge messages */ }
    }, { once: true })
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'connect') {
    connectBridge(message.config, message.tabId, message.origin).then(sendResponse)
    return true
  }
  if (message?.type === 'disconnect') {
    const hadSocket = Boolean(bridgeSocket)
    closeSocket()
    chrome.storage.session.remove(['wsUrl', 'token', 'nonce'])
    sendResponse({ ok: hadSocket })
    return false
  }
  if (message?.type === 'status') {
    sendResponse({ ok: Boolean(bridgeSocket && activeTabId != null), tabId: activeTabId })
    return false
  }
  return false
})

chrome.tabs.onRemoved.addListener((tabId) => { if (tabId === activeTabId) closeSocket() })
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (activeTabId != null && tabId !== activeTabId) closeSocket()
})
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.status === 'loading') {
    tabGeneration += 1
    sendSocket({ type: 'navigation' })
  }
  if (tabId === activeTabId && changeInfo.status === 'complete') {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content_script.js'] }).catch(() => undefined)
  }
})
