const MAX_TEXT = 12000
const MAX_ELEMENTS = 200
const interactiveSelector = 'a,button,input,textarea,select,[contenteditable="true"]'
const blockedActionWords = /delete\s+account|remove\s+account|authorize|install|删除账号|注销账号|授权|安装/i
const sensitiveWords = /password|passwd|pwd|new-password|current-password|captcha|verification|one[-\s]?time(?:[-\s]?code)?|security[-\s]?code|payment|billing|checkout|security|account\s*recovery|two[-\s]?factor|\botp\b|credit[-\s]?card|card[-_\s]*(?:number|no)|cc[-_](?:number|exp|csc|type)|bank(?:ing|\s+account|-account)?|routing[-\s]?number|account[-\s]?number|cloud\s*metadata|metadata\s+service|admin(?:istration)?|router|credit\s*card|密码|口令|验证码|支付|付款|账单|银行卡|信用卡|银行|安全|身份验证|权限管理|管理后台|管理控制台/i
const elementIdentities = new WeakMap()
let nextElementIdentity = 1
const snapshotRecords = new Map()
const MAX_SNAPSHOT_HISTORY = 8

function elementIdentity(node) {
  if (!elementIdentities.has(node)) elementIdentities.set(node, nextElementIdentity++)
  return elementIdentities.get(node)
}

function textOf(node) { return (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim() }
function safePageUrl() {
  try {
    const parsed = new URL(location.href)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().slice(0, 2048)
  } catch {
    return location.origin
  }
}
function stableHash(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
function fieldMetadata(node) {
  return [
    node?.getAttribute?.('type'),
    node?.getAttribute?.('name'),
    node?.getAttribute?.('id'),
    node?.getAttribute?.('autocomplete'),
    node?.getAttribute?.('inputmode'),
    node?.getAttribute?.('placeholder'),
    node?.getAttribute?.('aria-label'),
    textOf(node),
  ].filter(Boolean).join(' ')
}
function associatedLabel(node) {
  const id = node?.getAttribute?.('id')
  const escapedId = id
    ? (globalThis.CSS?.escape ? globalThis.CSS.escape(id) : id.replace(/(["\\])/g, '\\$1'))
    : ''
  const explicit = escapedId ? document.querySelector(`label[for="${escapedId}"]`) : null
  return textOf(explicit || node?.closest?.('label'))
}
function hasHiddenAncestor(node) {
  let current = node
  while (current && current !== document.documentElement) {
    if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return true
    current = current.parentElement
  }
  return false
}
function pageSensitive() {
  const controls = [...document.querySelectorAll('form,input,textarea,select,[contenteditable="true"]')]
    .slice(0, 400)
    .map((node) => fieldMetadata(node))
    .join('\n')
  return sensitiveWords.test(`${location.href}\n${document.title}\n${textOf(document.body).slice(0, 6000)}\n${controls}`)
}
function revision() {
  const nodes = [...document.querySelectorAll(interactiveSelector)]
  const visible = nodes.filter((node) => isVisible(node)).length
  const identity = nodes.filter((node) => isVisible(node)).map((node) => elementIdentity(node)).join('.')
  const values = nodes
    .filter((node) => isVisible(node))
    .map((node) => stableHash([
      'value' in node ? String(node.value || '') : textOf(node),
      canonicalHref(node) || '',
    ].join('|')))
    .join('.')
  return `${stableHash(location.href)}|${document.body?.innerText?.length || 0}|${visible}|${identity}|${stableHash(values)}`
}
function isVisible(node) {
  if (!node?.isConnected || node.getClientRects().length === 0 || hasHiddenAncestor(node)) return false
  const style = globalThis.getComputedStyle?.(node)
  const rect = node.getBoundingClientRect()
  if (rect.width <= 1 || rect.height <= 1 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false
  if (style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') return false
  if (style?.clip && style.clip !== 'auto' && /rect\(\s*0/i.test(style.clip)) return false
  if (style?.clipPath && style.clipPath !== 'none') return false
  return true
}
function isContentEditable(node) {
  return node?.getAttribute?.('contenteditable') === 'true' || node?.isContentEditable === true
}
function isDisabled(node) {
  return Boolean(node?.disabled || node?.getAttribute?.('aria-disabled') === 'true' || node?.readOnly || node?.getAttribute?.('aria-readonly') === 'true')
}
function safeHref(node) {
  const canonical = canonicalHref(node)
  if (!canonical) return undefined
  try {
    const parsed = new URL(canonical)
    parsed.search = ''
    parsed.hash = ''
    return `${parsed.origin}${parsed.pathname}`.slice(0, 512)
  } catch {
    return undefined
  }
}
function canonicalHref(node) {
  const raw = node?.getAttribute?.('href')
  if (!raw) return undefined
  try {
    const parsed = new URL(raw, location.href)
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined
    // Credential-bearing links are not safe to expose or execute.  Do not
    // silently sanitize them here: doing so would make the preview show a
    // different target from the URL the browser would actually open.
    if (parsed.username || parsed.password) return undefined
    parsed.username = ''
    parsed.password = ''
    const value = parsed.toString()
    // Do not expose or partially bind unbounded URL targets. Native validation
    // requires this opaque target for links, so an overlong URL fails closed.
    return value.length <= 2048 ? value : undefined
  } catch {
    return undefined
  }
}
function hrefFingerprint(node) {
  const canonical = canonicalHref(node)
  return canonical ? stableHash(canonical) : undefined
}
function safeElement(node, index) {
  if (!isVisible(node)) return null
  const tagName = (node.tagName || '').toLowerCase()
  const type = isContentEditable(node)
    ? 'contenteditable'
    : (node.getAttribute('type') || (tagName === 'input' ? 'text' : node.tagName) || '').toLowerCase()
  const name = (node.getAttribute('aria-label') || node.getAttribute('name') || associatedLabel(node) || (tagName === 'button' || tagName === 'a' ? textOf(node) : '')).slice(0, 240)
  if (type === 'password' || node.type === 'hidden' || sensitiveWords.test(fieldMetadata(node))) return null
  const rect = node.getBoundingClientRect()
  const hasValue = isContentEditable(node)
    ? textOf(node).length > 0
    : 'value' in node && String(node.value || '').length > 0
  return {
    token: `e-${elementIdentity(node)}-${type}-${name.toLowerCase().replace(/\W+/g, '-').slice(0, 24)}`,
    role: node.getAttribute('role') || (node.tagName || '').toLowerCase(),
    name,
    inputType: type,
    hasValue,
    href: safeHref(node),
    hrefFingerprint: hrefFingerprint(node),
    targetHref: canonicalHref(node),
    disabled: Boolean(node.disabled),
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  }
}
function snapshot() {
  const sensitive = pageSensitive()
  const nodes = [...document.querySelectorAll(interactiveSelector)]
  const pageRevision = revision()
  const snapshotId = globalThis.crypto?.randomUUID?.() || `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const records = new Map()
  const elements = []
  for (const node of nodes) {
    if (elements.length >= MAX_ELEMENTS) break
    const element = safeElement(node, elements.length)
    if (!element) continue
    records.set(element.token, { node, fingerprint: fingerprint(node, element) })
    elements.push(element)
  }
  snapshotRecords.set(snapshotId, { pageRevision, origin: location.origin, records })
  while (snapshotRecords.size > MAX_SNAPSHOT_HISTORY) snapshotRecords.delete(snapshotRecords.keys().next().value)
  return {
    snapshotId,
    url: safePageUrl(),
    origin: location.origin,
    title: document.title.slice(0, 512),
    text: textOf(document.body).slice(0, MAX_TEXT),
    textSummary: textOf(document.body).slice(0, MAX_TEXT),
    elements,
    sensitive,
    restricted: sensitive,
    sensitiveReason: sensitive ? '此页面包含密码、验证码、支付或账号安全内容' : undefined,
    restrictionReason: sensitive ? '此页面包含密码、验证码、支付或账号安全内容' : undefined,
    pageRevision,
  }
}
function fingerprint(node, element) {
  return [
    node.tagName,
    element.inputType,
    element.name,
    node.getAttribute('aria-label') || '',
    node.getAttribute('name') || '',
    node.getAttribute('disabled') || '',
    node.getAttribute('readonly') || '',
    hrefFingerprint(node) || '',
    node.getAttribute('role') || '',
    node.getAttribute('aria-disabled') || '',
    node.getAttribute('aria-readonly') || '',
    stableHash('value' in node ? String(node.value || '') : textOf(node)),
  ].join('|')
}
function findNode(token, snapshotId) {
  const record = snapshotRecords.get(snapshotId)?.records.get(token)
  if (!record || !record.node?.isConnected || !isVisible(record.node)) return null
  const current = safeElement(record.node, 0)
  if (!current || fingerprint(record.node, current) !== record.fingerprint) return null
  return record.node
}
function guard(name, payload) {
  if (name !== 'navigate') {
    const record = snapshotRecords.get(payload?.snapshotId)
    if (!record || !payload?.pageRevision || payload.pageRevision !== revision() || record.pageRevision !== payload.pageRevision || record.origin !== location.origin) {
      return { ok: false, summary: '页面已变化，请重新获取快照。', errorCode: 'stale_snapshot', recoverable: true }
    }
  }
  if (pageSensitive()) return { ok: false, summary: '当前页面被安全策略阻止。', errorCode: 'page_restricted', recoverable: false }
  return null
}
function hasExecutableExtension(value) {
  let candidate = String(value || '')
  try { candidate = decodeURIComponent(candidate) } catch { /* keep the raw name */ }
  return /\.(?:exe|msi|dmg|pkg|app|deb|rpm|sh|bat|cmd)(?:$|[?#])/i.test(candidate)
}
async function action(name, payload) {
  // A restricted page still returns a bounded snapshot so the app can explain
  // why actions are unavailable. Every mutating action is guarded below.
  if (name === 'snapshot') return snapshot()
  const denied = guard(name, payload)
  if (denied) return denied
  const node = name === 'navigate' ? null : findNode(payload?.elementToken, payload?.snapshotId)
  if (name !== 'navigate' && !node) return { ok: false, summary: '元素已失效，请重新获取快照。', errorCode: 'stale_page', recoverable: true }
  if (name === 'navigate') {
    if (payload?.url) {
      try {
        const destination = new URL(payload.url)
        if (!['http:', 'https:'].includes(destination.protocol)) return { ok: false, summary: '仅允许打开 http(s) 网页。', errorCode: 'blocked', recoverable: false }
        location.href = destination.toString()
      } catch {
        return { ok: false, summary: '网页地址无效。', errorCode: 'blocked', recoverable: false }
      }
    }
    return { ok: true, summary: '已打开网页。' }
  }
  if (['fillDraft', 'click', 'download', 'submit'].includes(name) && isDisabled(node)) {
    return { ok: false, summary: '该控件已禁用或只读，无法操作。', errorCode: 'disabled_control', recoverable: true }
  }
  if (name === 'click' && node.tagName.toLowerCase() === 'a') {
    const href = canonicalHref(node)
    if (!href) return { ok: false, summary: '该链接目标无法安全验证，已阻止。', errorCode: 'blocked', recoverable: false }
    try {
      const parsed = new URL(href)
      if (!isPublicHttpUrl(parsed.toString())) return { ok: false, summary: '该链接目标不符合安全策略。', errorCode: 'blocked', recoverable: false }
    } catch {
      return { ok: false, summary: '该链接地址无效。', errorCode: 'blocked', recoverable: false }
    }
  }
  const label = `${node.getAttribute('aria-label') || ''} ${node.getAttribute('name') || ''} ${textOf(node)}`
  if ((name === 'click' || name === 'submit') && blockedActionWords.test(label)) return { ok: false, summary: '该元素具有不可逆高风险语义，已阻止。', errorCode: 'blocked', recoverable: false }
  if (name === 'fillDraft') {
    const tagName = node.tagName.toLowerCase()
    const inputType = String(node.getAttribute('type') || (tagName === 'input' ? 'text' : '')).toLowerCase()
    const metadata = fieldMetadata(node)
    if ((!['text', 'search', 'email', 'url', 'tel'].includes(inputType) && tagName !== 'textarea' && !isContentEditable(node)) || sensitiveWords.test(metadata) || ['file', 'number', 'date', 'month', 'week', 'time', 'datetime-local', 'password'].includes(inputType)) return { ok: false, summary: '仅允许填写普通文本字段。', errorCode: 'blocked', recoverable: false }
    const value = String(payload?.value || '').slice(0, 2000)
    node.focus()
    if (isContentEditable(node)) {
      node.textContent = value
    } else {
      node.value = value
    }
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, summary: '已填写草稿，尚未提交。', data: { elementToken: payload.elementToken }, snapshot: snapshot() }
  }
  if (name === 'click') { node.click(); return { ok: true, summary: '已点击普通元素。', snapshot: snapshot() } }
  if (name === 'download') {
    if (node.tagName.toLowerCase() !== 'a') return { ok: false, summary: '仅允许触发链接下载。', errorCode: 'blocked', recoverable: false }
    const href = canonicalHref(node)
    if (!href) return { ok: false, summary: '该下载目标无法安全验证，已阻止。', errorCode: 'blocked', recoverable: false }
    let parsed
    try {
      parsed = new URL(href)
      if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, summary: '下载地址协议不安全。', errorCode: 'blocked', recoverable: false }
    } catch {
      return { ok: false, summary: '下载地址无效。', errorCode: 'blocked', recoverable: false }
    }
    const fileName = node.getAttribute('download') || parsed.pathname.split('/').pop() || 'download'
    if (hasExecutableExtension(href) || hasExecutableExtension(fileName)) return { ok: false, summary: '可执行文件下载已阻止。', errorCode: 'page_restricted', recoverable: false }
    node.click()
    return { ok: true, summary: '已触发普通下载。', download: { fileName: fileName.slice(0, 240), url: `${parsed.origin}${parsed.pathname}` }, snapshot: snapshot() }
  }
  if (name === 'submit') {
    const inputType = String(node.getAttribute('type') || '').toLowerCase()
    const tagName = node.tagName.toLowerCase()
    if (!((tagName === 'button' && (!inputType || inputType === 'submit')) || (tagName === 'input' && ['submit', 'image'].includes(inputType)))) {
      return { ok: false, summary: '只允许提交明确的普通提交控件。', errorCode: 'blocked', recoverable: false }
    }
    const form = node.form || node.closest('form')
    if (!form) return { ok: false, summary: '未找到可提交的普通表单。', errorCode: 'page_restricted', recoverable: false }
    const actionUrl = form.getAttribute('action') || location.href
    if (!isPublicHttpUrl(new URL(actionUrl, location.href).toString())) return { ok: false, summary: '表单目标不符合安全策略。', errorCode: 'blocked', recoverable: false }
    form.requestSubmit(node.type === 'submit' ? node : undefined)
    return { ok: true, summary: '已提交普通表单。', snapshot: snapshot() }
  }
  return { ok: false, summary: '未知浏览器动作。', errorCode: 'protocol', recoverable: false }
}

function isPublicHttpUrl(value) {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')) return false
    const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
    if (ipv4) {
      const [a, b] = ipv4.slice(1).map(Number)
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127)) return false
    }
    return true
  } catch {
    return false
  }
}

if (!globalThis.__papyrusBridgeInstalled) {
  globalThis.__papyrusBridgeInstalled = true
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'bridge.request') return false
    action(message.action, message.payload || {}).then(sendResponse)
    return true
  })
}
