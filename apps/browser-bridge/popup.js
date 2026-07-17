const discoveryUrl = 'http://127.0.0.1:43121/pairing'
const status = document.querySelector('#status')

function setStatus(message, error = false) {
  status.textContent = message
  status.className = error ? 'error' : ''
}

async function discoverPairing() {
  const response = await fetch(discoveryUrl, { cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error('Papyrus 尚未启动 Browser Bridge。')
  const pairing = await response.json()
  if (!pairing?.wsUrl || !pairing?.token || !pairing?.nonce) {
    throw new Error('Papyrus 返回的 Browser Bridge 配对信息无效。')
  }
  return { wsUrl: pairing.wsUrl, token: pairing.token, nonce: pairing.nonce }
}

document.querySelector('#connect').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) return setStatus('无法读取当前标签页。', true)
  try {
    const tabUrl = new URL(tab.url)
    if (!['http:', 'https:'].includes(tabUrl.protocol)) return setStatus('仅支持 http(s) 网页，已拒绝当前标签页。', true)
    setStatus('正在连接当前标签页…')
    const values = await discoverPairing()
    const response = await chrome.runtime.sendMessage({
      type: 'connect',
      config: values,
      tabId: tab.id,
      origin: tabUrl.origin,
    })
    setStatus(response?.ok ? '已连接当前标签页。' : (response?.message || '连接失败。'), !response?.ok)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '连接失败。', true)
  }
})

document.querySelector('#disconnect').addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'disconnect' })
  setStatus(response?.ok ? '已断开。' : '没有活动连接。', !response?.ok)
})
