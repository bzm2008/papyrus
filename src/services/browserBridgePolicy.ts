export type BrowserPageClassification = {
  sensitive: boolean
  reason?: string
}

export type BrowserElementSnapshot = {
  token: string
  role: string
  name: string
  inputType?: string
  hasValue: boolean
  href?: string
  disabled?: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}

export type BrowserSnapshot = {
  tabId?: number
  url: string
  origin?: string
  title: string
  text: string
  textSummary?: string
  elements: BrowserElementSnapshot[]
  snapshotId?: string
  sensitive?: boolean
  sensitiveReason?: string
  restricted?: boolean
  restrictionReason?: string
  pageRevision?: string
}

const MAX_TEXT = 12_000
const MAX_ELEMENTS = 200

const sensitivePatterns: Array<[RegExp, string]> = [
  [/password|passwd|pwd|new[-\s]?password|current[-\s]?password|密码|口令/i, '检测到密码或口令安全字段'],
  [/captcha|验证码|verification\s*code|one[-\s]?time(?:[-\s]?code)?|security[-\s]?code|\botp\b|安全验证/i, '检测到验证码或安全验证页面'],
  [/payment|billing|checkout|credit[-\s]?card|card(?:\s*number)?|cc[-_](?:number|exp|csc|type)|bank(?:ing|\s+account|-account)?|routing[-\s]?number|account[-\s]?number|信用卡|银行卡|银行|支付|付款|收款/i, '检测到支付或账单页面'],
  [/security|account\s*recovery|two[-\s]?factor|账号安全|账户安全|身份验证/i, '检测到账号安全或身份验证页面'],
  [/extensions?|权限管理|开发者模式|admin(?:istration)?|router|cloud\s*metadata|metadata service|后台管理|管理控制台|chrome:\/\/extensions/i, '检测到管理或内部控制页面'],
]

export function classifyBrowserPage(input: Pick<BrowserSnapshot, 'url' | 'title' | 'text'>): BrowserPageClassification {
  const source = `${input.url}\n${input.title}\n${input.text}`
  const hit = sensitivePatterns.find(([pattern]) => pattern.test(source))
  return hit ? { sensitive: true, reason: hit[1] } : { sensitive: false }
}

function safeText(value: unknown, limit: number) {
  return typeof value === 'string' ? value.split('\u0000').join('').slice(0, limit) : ''
}

export function limitBrowserSnapshot(snapshot: BrowserSnapshot): BrowserSnapshot {
  const classification = classifyBrowserPage(snapshot)
  const elements = (Array.isArray(snapshot.elements) ? snapshot.elements : [])
    .filter((element) => element && typeof element.token === 'string')
    .filter((element) => !/password|passwd|pwd|new[-\s]?password|current[-\s]?password|captcha|验证码|payment|credit[-\s]?card|card(?:\s*number)?|cc[-_](?:number|exp|csc|type)|bank|routing[-\s]?number|account[-\s]?number|otp|one[-\s]?time|security[-\s]?code|支付|银行卡|信用卡|安全|admin|管理/i.test(`${element.inputType ?? ''} ${element.name}`))
    .slice(0, MAX_ELEMENTS)
    .map((element) => ({
      token: safeText(element.token, 128),
      role: safeText(element.role, 64),
      name: safeText(element.name, 240),
      ...(element.inputType ? { inputType: safeText(element.inputType, 64) } : {}),
      hasValue: element.hasValue === true,
      ...(element.href ? { href: safeText(element.href, 512) } : {}),
      ...(typeof element.disabled === 'boolean' ? { disabled: element.disabled } : {}),
      ...(element.bounds ? { bounds: element.bounds } : {}),
    }))

  return {
    url: safeText(snapshot.url, 2_048),
    ...(snapshot.tabId === undefined ? {} : { tabId: snapshot.tabId }),
    ...(snapshot.origin ? { origin: safeText(snapshot.origin, 256) } : {}),
    title: safeText(snapshot.title, 512),
    text: safeText(snapshot.text, MAX_TEXT),
    textSummary: safeText(snapshot.textSummary ?? snapshot.text, MAX_TEXT),
    elements,
    ...(classification.sensitive || snapshot.sensitive || snapshot.restricted
      ? {
          sensitive: true,
          restricted: true,
          sensitiveReason: snapshot.sensitiveReason ?? snapshot.restrictionReason ?? classification.reason,
          restrictionReason: snapshot.restrictionReason ?? snapshot.sensitiveReason ?? classification.reason,
        }
      : {}),
    ...(snapshot.snapshotId ? { snapshotId: safeText(snapshot.snapshotId, 128) } : {}),
    ...(snapshot.pageRevision ? { pageRevision: safeText(snapshot.pageRevision, 128) } : {}),
  }
}

export function riskForBrowserAction(action: string, sensitivePage: boolean, semanticLabel = '') {
  if (sensitivePage) return 'blocked' as const
  if (action === 'browser_submit' || action === 'browser_download') return 'high' as const
  if (action === 'browser_click') {
    const label = semanticLabel.trim().toLowerCase()
    if (/(delete|remove|destroy|erase|clear all|logout|log out|sign out|unsubscribe|revoke|terminate|删除|移除|销毁|清空|注销|退出登录|撤销|终止|卸载)/i.test(label)) {
      return 'blocked' as const
    }
    if (/(next|previous|prev|back|continue reading|read more|next page|下一页|上一页|返回|继续阅读|更多|翻页)/i.test(label)) {
      return 'reversible' as const
    }
    return 'high' as const
  }
  if (action === 'browser_fill_draft') return 'reversible' as const
  return 'read' as const
}

export function isSafeBrowserOrigin(url: string) {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const hostname = parsed.hostname.toLowerCase()
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false
    const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
    if (ipv4) {
      const [a, b] = ipv4.slice(1).map(Number)
      if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127) return false
    }
    if (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')) return false
    return true
  } catch {
    return false
  }
}

export const browserSnapshotLimits = { maxText: MAX_TEXT, maxElements: MAX_ELEMENTS } as const
