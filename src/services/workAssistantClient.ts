import { invoke } from '@tauri-apps/api/core'

import type {
  AssistantApprovalChoice,
  AssistantCapabilityStatus,
  AssistantToolPreview,
  NativePreviewRequest,
} from './workAssistantProtocol'

export type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export type AuthorizedRoot = {
  id: string
  label: string
  path: string
  kind: 'workspace' | 'downloads'
  createdAt: number
}

export type ApprovalGrant = { token: string; previewId: string; expires: number }
export type NativeBatchExecutionResult = {
  completed: Array<Record<string, unknown>>
  skipped: Array<Record<string, unknown>>
  failed: Array<Record<string, unknown>>
  remaining: Array<Record<string, unknown>>
  cancelled: boolean
  warnings?: Array<Record<string, unknown>>
}
export type RegisteredApplication = {
  id: string
  label: string
  executablePath: string
  platform: string
  createdAt: number
}
export type AuditEntry = { id: string; event: string; detail: string; at: number }

let invokeFn: InvokeFn = (command, args) => invoke(command, args)

const invokeTyped = <T>(command: string, args?: Record<string, unknown>) =>
  invokeFn(command, args) as Promise<T>

function abortError() {
  return new DOMException('Run cancelled', 'AbortError')
}

export type DesktopRevealResult = {
  degraded: boolean
  warning?: string
}

export function setWorkAssistantInvokerForTests(next: InvokeFn) {
  invokeFn = next
}

export function resetWorkAssistantInvokerForTests() {
  invokeFn = (command, args) => invoke(command, args)
}

export const getWorkAssistantCapabilities = () =>
  invokeTyped<AssistantCapabilityStatus[]>('work_assistant_capabilities')

export const listWorkAssistantRoots = () =>
  invokeTyped<AuthorizedRoot[]>('work_assistant_workspace_list')

export const addWorkAssistantRoot = (label: string, path: string, kind: AuthorizedRoot['kind']) =>
  invokeTyped<AuthorizedRoot>('work_assistant_add_root', { label, path, kind })

export const removeWorkAssistantRoot = (rootId: string) =>
  invokeTyped<void>('work_assistant_remove_root', { id: rootId })

export const scanWorkAssistantRoot = (rootId: string) =>
  invokeTyped<Record<string, unknown>>('work_assistant_workspace_scan', { rootId })

export const searchWorkAssistantFiles = (rootId: string, query: string) =>
  invokeTyped<Record<string, unknown>>('work_assistant_file_search', { rootId, query })

export const inspectWorkAssistantFile = (rootId: string, path: string) =>
  invokeTyped<Record<string, unknown>>('work_assistant_file_inspect', { rootId, path })

export const scanWorkAssistantDownloads = (rootId: string) =>
  invokeTyped<Record<string, unknown>>('work_assistant_downloads_scan', { rootId })

export const previewWorkAssistantAction = (request: NativePreviewRequest) =>
  invokeTyped<AssistantToolPreview>('work_assistant_preview', { request })

export const approveWorkAssistantAction = (
  previewId: string,
  runId: string,
  choice: AssistantApprovalChoice,
) => invokeTyped<ApprovalGrant>('work_assistant_approve', { previewId, runId, choice })

export const cancelWorkAssistantRun = (runId: string) =>
  invokeTyped<void>('work_assistant_cancel_run', { run: runId })

export function executeWorkAssistantAction(
  previewId: string,
  approvalToken: string,
  runId?: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    try {
      if (runId) void cancelWorkAssistantRun(runId).catch(() => undefined)
    } catch {
      // A disposed bridge cannot acknowledge cancellation, but the caller
      // still receives the deterministic AbortError below.
    }
    return Promise.reject<NativeBatchExecutionResult>(abortError())
  }

  let pending: Promise<NativeBatchExecutionResult>
  try {
    pending = invokeTyped<NativeBatchExecutionResult>('work_assistant_execute', { previewId, approvalToken })
  } catch (error) {
    return Promise.reject<NativeBatchExecutionResult>(error)
  }
  if (!signal) return pending

  const requestCancel = () => {
    if (!runId) return
    try {
      void cancelWorkAssistantRun(runId).catch(() => undefined)
    } catch {
      // Cancellation is best effort after the native request has started.
    }
  }

  return new Promise<NativeBatchExecutionResult>((resolve, reject) => {
    let settled = false
    let nativeFinished = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled || nativeFinished) return
      settled = true
      cleanup()
      requestCancel()
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => {
        nativeFinished = true
        if (settled) return
        settled = true
        cleanup()
        // Once the native promise has completed, its result is authoritative.
        // A late abort must not turn a completed file operation into a retryable
        // cancellation that could duplicate side effects.
        resolve(value)
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

export const getWorkAssistantDesktopStatus = () =>
  invokeTyped<Record<string, unknown>>('work_assistant_desktop_status')

export const openWorkAssistantUrl = (url: string) =>
  invokeTyped<void>('work_assistant_desktop_open_url', { url })

export const openWorkAssistantFile = (rootId: string, path: string) =>
  invokeTyped<void>('work_assistant_desktop_open_file', { rootId, path })

export const revealWorkAssistantFile = (rootId: string, path: string) =>
  invokeTyped<DesktopRevealResult>('work_assistant_desktop_reveal_file', { rootId, path })

export const listRegisteredApplications = () =>
  invokeTyped<RegisteredApplication[]>('work_assistant_list_applications')

export const validateApplicationSelection = (path: string) =>
  invokeTyped<string>('work_assistant_validate_application_selection', { path })

export const registerApplicationFromPicker = (label: string, path: string) =>
  invokeTyped<RegisteredApplication>('work_assistant_register_application_from_picker', { label, path })

export const removeRegisteredApplication = (applicationId: string) =>
  invokeTyped<void>('work_assistant_remove_application', { applicationId })

export const launchRegisteredApplication = (applicationId: string) =>
  invokeTyped<void>('work_assistant_launch_application', { applicationId })

export const listWorkAssistantAudit = (offset = 0, limit = 50) =>
  invokeTyped<AuditEntry[]>('work_assistant_list_audit', { offset, limit })

export const clearWorkAssistantAudit = () => invokeTyped<void>('work_assistant_clear_audit')
