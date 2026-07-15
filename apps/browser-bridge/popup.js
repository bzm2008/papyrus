const fields = ['wsUrl', 'token', 'nonce']
const status = document.querySelector('#status')

function setStatus(message, error = false) {
  status.textContent = message
  status.className = error ? 'error' : ''
}

chrome.storage.session.get(fields, (stored) => fields.forEach((id) => {
  if (stored[id]) document.querySelector(`#${id}`).value = stored[id]
}))

document.querySelector('#connect').addEventListener('click', async () => {
  const values = Object.fromEntries(fields.map((id) => [id, document.querySelector(`#${id}`).value.trim()]))
  if (!values.wsUrl || !values.token || !values.nonce) return setStatus('请填写完整的配对信息。', true)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) return setStatus('无法读取当前标签页。', true)
  try {
    const tabUrl = new URL(tab.url)
    if (!['http:', 'https:'].includes(tabUrl.protocol)) return setStatus('仅支持 http(s) 网页，已拒绝当前标签页。', true)
    await chrome.storage.session.set(values)
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
