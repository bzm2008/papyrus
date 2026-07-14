export type BrowserBridgeAction = 'navigate' | 'snapshot' | 'fillDraft' | 'click' | 'download' | 'submit'

export type BrowserBridgeMessage =
  | { type: 'pair'; payload: { token: string; nonce: string; extensionId: string; tabId: number; origin: string } }
  | { type: 'paired' }
  | { type: 'navigation' }
  | { type: 'request'; requestId: string; action: BrowserBridgeAction; payload: Record<string, unknown> }
  | { type: 'response'; requestId: string; tabId?: number; payload: Record<string, unknown>; snapshot?: BrowserPageSnapshot }
  | { type: 'snapshot'; payload: BrowserPageSnapshot }

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

export type BrowserPageSnapshot = {
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

export function encodeBrowserBridgeMessage(message: BrowserBridgeMessage) {
  return JSON.stringify(message)
}

export function decodeBrowserBridgeMessage(raw: string): BrowserBridgeMessage | undefined {
  try {
    const value = JSON.parse(raw) as BrowserBridgeMessage
    if (!value || typeof value !== 'object' || typeof value.type !== 'string') return undefined
    if (value.type === 'request' && (!value.requestId || !value.action)) return undefined
    if (value.type === 'response' && !value.requestId) return undefined
    return value
  } catch {
    return undefined
  }
}
