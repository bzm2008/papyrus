import { invoke } from '@tauri-apps/api/core'

import type { BrowserSnapshot } from './browserBridgePolicy'

export type BrowserBridgePairing = {
  sessionId: string
  token: string
  nonce: string
  wsUrl: string
  expiresAt: number
}

export type BrowserBridgeConnectionState =
  | 'disabled'
  | 'listening'
  | 'pairing'
  | 'connected'
  | 'stale'
  | 'error'

export type BrowserBridgeStatus = {
  running: boolean
  paired: boolean
  sessionId?: string
  tabId?: number
  origin?: string
  pageRevision?: string
  expiresAt?: number
  wsUrl?: string
  error?: string
  connectionState?: BrowserBridgeConnectionState
}

export type BrowserActionResponse = {
  ok: boolean
  summary: string
  data?: Record<string, unknown>
  errorCode?: string
  recoverable?: boolean
}

export type BrowserActionPreview = {
  id: string
  revision: string
  action: string
  actionHash: string
  risk: 'reversible' | 'high'
  title: string
  targetSummary: string
  impactSummary: string
  reversible: boolean
  expiresAt: number
  origin: string
  pageTitle: string
  elementName?: string
}

export type BrowserApprovalGrant = {
  token: string
  previewId: string
  actionHash: string
  expires: number
}

export type BrowserActionPreviewInput = {
  action: 'navigate' | 'fillDraft' | 'click' | 'download' | 'submit'
  runId: string
  toolCallId: string
  elementToken?: string
  value?: string
  pageRevision: string
  snapshotId?: string
  url?: string
  directoryRootId?: string
}

export type BrowserApprovalContext = {
  previewId: string
  approvalToken: string
  actionHash: string
}

export type WebExtractResult = {
  url: string
  title: string
  text: string
  links: Array<{ title: string; url: string }>
  truncated: boolean
  /** Internal marker added only by the verified native extraction wrapper. */
  provenance?: 'native'
  canonicalUrl?: string
  language?: string
  excerpt?: string
}

export type BrowserBridgeInvoker = (command: string, args?: Record<string, unknown>) => Promise<unknown>

let invokeFn: BrowserBridgeInvoker = (command, args) => invoke(command, args)

const call = <T>(command: string, args?: Record<string, unknown>) => invokeFn(command, args) as Promise<T>

function abortError() {
  return new DOMException('Run cancelled', 'AbortError')
}

/**
 * Tauri invoke does not accept an AbortSignal. Race the native request with the
 * run signal while still observing the native promise so an aborted request
 * cannot become an unhandled rejection when the bridge responds later.
 */
function callWithAbort<T>(command: string, args: Record<string, unknown> | undefined, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject<T>(abortError())

  let pending: Promise<T>
  try {
    pending = call<T>(command, args)
  } catch (error) {
    return Promise.reject<T>(error)
  }
  if (!signal) return pending
  if (signal.aborted) {
    void pending.catch(() => undefined)
    return Promise.reject<T>(abortError())
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        if (signal.aborted) reject(abortError())
        else resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

export const invokeBrowserBridge = <T = unknown>(command: string, args?: Record<string, unknown>) =>
  call<T>(command, args)

export function setBrowserBridgeInvokerForTests(next: BrowserBridgeInvoker) {
  invokeFn = next
}

export function resetBrowserBridgeInvokerForTests() {
  invokeFn = (command, args) => invoke(command, args)
}

export const startBrowserBridgePairing = () => call<BrowserBridgePairing>('browser_bridge_start_pairing')
export async function getBrowserBridgeStatus() {
  const status = await call<Omit<BrowserBridgeStatus, 'connectionState'>>('browser_bridge_status')
  return { ...status, connectionState: deriveBrowserBridgeState(status) }
}
export const disconnectBrowserBridge = () => call<void>('browser_bridge_disconnect')
export const pairBrowserBridge = (token: string, nonce: string, extensionId: string, tabId: number, origin: string) =>
  call<BrowserBridgeStatus>('browser_bridge_pair', { token, nonce, extensionId, tabId, origin })
export const startBrowserActionPreview = (input: BrowserActionPreviewInput, signal?: AbortSignal) =>
  callWithAbort<BrowserActionPreview>('work_assistant_browser_preview_action', input as unknown as Record<string, unknown>, signal)
export const approveBrowserAction = (previewId: string, runId: string, signal?: AbortSignal) =>
  callWithAbort<BrowserApprovalGrant>('work_assistant_browser_approve_action', { previewId, runId, choice: 'once' }, signal)
export const rejectBrowserAction = (previewId: string, runId: string) =>
  call<void>('work_assistant_browser_reject_action', { previewId, runId })
export const cancelBrowserBridgeRun = (runId: string) =>
  call<void>('work_assistant_browser_cancel_run', { run: runId })
export const executeApprovedBrowserAction = (grant: BrowserApprovalContext, signal?: AbortSignal) =>
  callWithAbort<BrowserActionResponse>('work_assistant_browser_execute_action', {
    previewId: grant.previewId,
    approvalToken: grant.approvalToken,
    actionHash: grant.actionHash,
  }, signal)
function approvedBrowserAction(
  command: string,
  approval: BrowserApprovalContext | undefined,
  target?: Record<string, unknown>,
) {
  if (!approval) return Promise.reject<BrowserActionResponse>(new Error('浏览器动作必须先经过预览和用户批准。'))
  return call<BrowserActionResponse>(command, { ...target, ...approval })
}

export const openBrowserBridgeTab = (url: string | undefined, approval?: BrowserApprovalContext) =>
  approvedBrowserAction('browser_open', approval, { url })
export const browserSnapshot = (pageRevision?: string, snapshotId?: string, signal?: AbortSignal) =>
  callWithAbort<BrowserSnapshot>('browser_snapshot', pageRevision || snapshotId ? { pageRevision, snapshotId } : undefined, signal)
export const browserFillDraft = (elementToken: string, value: string, pageRevision: string, approval?: BrowserApprovalContext) =>
  approvedBrowserAction('browser_fill_draft', approval, { elementToken, value, pageRevision })
export const browserClick = (elementToken: string, pageRevision: string, approval?: BrowserApprovalContext) =>
  approvedBrowserAction('browser_click', approval, { elementToken, pageRevision })
export const browserDownload = (elementToken: string, pageRevision: string, directoryRootId?: string, approval?: BrowserApprovalContext) =>
  approvedBrowserAction('browser_download', approval, { elementToken, pageRevision, directoryRootId })
export const browserSubmit = (elementToken: string, pageRevision: string, approval?: BrowserApprovalContext) =>
  approvedBrowserAction('browser_submit', approval, { elementToken, pageRevision })

export const webExtract = (url: string) => call<WebExtractResult>('web_extract', { url })

export function deriveBrowserBridgeState(
  status: Pick<BrowserBridgeStatus, 'running' | 'paired' | 'sessionId' | 'error'>,
): BrowserBridgeConnectionState {
  if (status.error) {
    return /stale|expired|changed|过期|变化/i.test(status.error) ? 'stale' : 'error'
  }
  if (!status.running) return 'disabled'
  if (status.paired) return 'connected'
  if (status.sessionId) return 'pairing'
  return 'listening'
}
