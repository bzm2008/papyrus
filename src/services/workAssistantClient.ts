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
export type NativeActionExecutionResult = {
  ok?: boolean
  summary?: string
  data?: Record<string, unknown>
  errorCode?: string
  recoverable?: boolean
}
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
  platform: string
  createdAt: number
}
export type AvailableApplication = {
  id: string
  label: string
  platform: string
  kind: 'registered' | 'browser'
}
export type AuditEntry = { id: string; event: string; detail: string; at: number }
export type TerminalRunRequest = {
  operation: 'git_status' | 'git_diff_stat' | 'git_branch' | 'git_log' | 'git_version' | 'system_info' | 'whoami'
  rootId: string
  cwd?: string
}

let invokeFn: InvokeFn = (command, args) => invoke(command, args)

const invokeTyped = <T>(command: string, args?: Record<string, unknown>) =>
  invokeFn(command, args) as Promise<T>

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

export const executeWorkAssistantAction = (previewId: string, approvalToken: string) =>
  invokeTyped<NativeBatchExecutionResult>('work_assistant_execute', { previewId, approvalToken })

/**
 * Native actions with an external side effect (currently application launch
 * and the structured terminal diagnostics) use a separate opaque preview.
 * The execute call accepts only its preview id and one-time token, never the
 * model-provided arguments again.
 */
export const previewNativeAssistantAction = (request: NativePreviewRequest) =>
  previewWorkAssistantAction(request)

export const approveNativeAssistantAction = (
  previewId: string,
  runId: string,
  choice: AssistantApprovalChoice,
) => approveWorkAssistantAction(previewId, runId, choice)

export const executeNativeAssistantAction = (previewId: string, approvalToken: string) =>
  invokeTyped<NativeActionExecutionResult>('work_assistant_execute_native_action', { previewId, approvalToken })

export const cancelWorkAssistantRun = (runId: string) =>
  invokeTyped<void>('work_assistant_cancel_run', { run: runId })

export const getWorkAssistantDesktopStatus = () =>
  invokeTyped<Record<string, unknown>>('work_assistant_desktop_status')

export const openWorkAssistantUrl = (url: string) =>
  invokeTyped<void>('work_assistant_desktop_open_url', { url })

export const openWorkAssistantFile = (rootId: string, path: string) =>
  invokeTyped<void>('work_assistant_desktop_open_file', { rootId, path })

export const revealWorkAssistantFile = (rootId: string, path: string) =>
  invokeTyped<void>('work_assistant_desktop_reveal_file', { rootId, path })

export const listRegisteredApplications = () =>
  invokeTyped<RegisteredApplication[]>('work_assistant_list_applications')

export const listAvailableApplications = () =>
  invokeTyped<AvailableApplication[]>('work_assistant_list_available_applications')

export const registerApplicationFromPicker = (label: string) =>
  invokeTyped<RegisteredApplication | null>('work_assistant_register_application_from_picker', { label })

export const removeRegisteredApplication = (applicationId: string) =>
  invokeTyped<void>('work_assistant_remove_application', { applicationId })

export const launchRegisteredApplication = (applicationId: string) =>
  invokeTyped<void>('work_assistant_launch_application', { applicationId })

export const runTerminalCommand = (request: TerminalRunRequest) =>
  invokeTyped<Record<string, unknown>>('work_assistant_terminal_run', request as unknown as Record<string, unknown>)

export const listWorkAssistantAudit = (offset = 0, limit = 50) =>
  invokeTyped<AuditEntry[]>('work_assistant_list_audit', { offset, limit })

export const clearWorkAssistantAudit = () => invokeTyped<void>('work_assistant_clear_audit')
