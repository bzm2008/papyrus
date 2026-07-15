import type { Page } from '@playwright/test'
import path from 'node:path'

export type ProductionSnapshot = {
  tabId?: number
  url: string
  origin?: string
  title: string
  text: string
  textSummary?: string
  elements: Array<{
    token: string
    role: string
    name: string
    inputType?: string
    hasValue: boolean
    href?: string
    hrefFingerprint?: string
    disabled?: boolean
    bounds?: { x: number; y: number; width: number; height: number }
  }>
  snapshotId?: string
  sensitive?: boolean
  sensitiveReason?: string
  restricted?: boolean
  restrictionReason?: string
  pageRevision?: string
}

export type ProductionActionResult = {
  ok: boolean
  summary: string
  data?: Record<string, unknown>
  errorCode?: string
  recoverable?: boolean
}

type BridgeMessage = {
  type: 'bridge.request'
  action: string
  payload: Record<string, unknown>
}

declare global {
  interface Window {
    __papyrusBridgeRequest?: (message: BridgeMessage) => Promise<unknown>
    __papyrusBridgeListeners?: Array<(message: BridgeMessage, sender: unknown, sendResponse: (value: unknown) => void) => boolean | void>
  }
}

const productionContentScript = path.resolve(process.cwd(), 'apps/browser-bridge/content_script.js')

/**
 * Installs the production content script in a real Chromium tab. The only
 * test seam is the extension runtime message transport; snapshots/actions
 * still execute from apps/browser-bridge/content_script.js.
 */
export async function installProductionBridge(page: Page, pathName = '/ordinary.html') {
  await page.addInitScript(() => {
    const listeners: NonNullable<Window['__papyrusBridgeListeners']> = []
    window.__papyrusBridgeListeners = listeners
    window.__papyrusBridgeRequest = (message) => new Promise((resolve, reject) => {
      const listener = listeners.at(-1)
      if (!listener) {
        reject(new Error('production bridge listener is not installed'))
        return
      }
      let settled = false
      const sendResponse = (value: unknown) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      try {
        const result = listener(message, { id: 'playwright-fixture' }, sendResponse)
        if (result !== true && result !== undefined) sendResponse(result)
      } catch (error) {
        reject(error)
      }
    })
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          onMessage: {
            addListener(listener: NonNullable<Window['__papyrusBridgeListeners']>[number]) {
              listeners.push(listener)
            },
          },
        },
      },
    })
  })
  await page.goto(pathName)
  await page.addScriptTag({ path: productionContentScript })
}

export async function request<T = unknown>(page: Page, action: string, payload: Record<string, unknown> = {}) {
  return page.evaluate(async ({ action: requestedAction, payload: requestedPayload }) => {
    if (!window.__papyrusBridgeRequest) throw new Error('bridge request helper is unavailable')
    return await window.__papyrusBridgeRequest({ type: 'bridge.request', action: requestedAction, payload: requestedPayload }) as T
  }, { action, payload })
}

export async function snapshot(page: Page) {
  return request<ProductionSnapshot>(page, 'snapshot')
}

export function elementByName(pageSnapshot: ProductionSnapshot, name: string) {
  const found = pageSnapshot.elements.find((element) => element.name === name || element.name.toLowerCase() === name.toLowerCase())
  if (!found) throw new Error(`element not found in production snapshot: ${name}`)
  return found
}

export function staleResult(result: ProductionActionResult) {
  return !result.ok && ['stale_page', 'stale_snapshot'].includes(result.errorCode ?? '')
}
