import {
  approveWorkAssistantAction,
  cancelWorkAssistantRun,
  approveNativeAssistantAction,
  executeNativeAssistantAction,
  executeWorkAssistantAction,
  getWorkAssistantDesktopStatus,
  inspectWorkAssistantFile,
  listAvailableApplications,
  launchRegisteredApplication,
  listWorkAssistantRoots,
  openWorkAssistantFile,
  openWorkAssistantUrl,
  previewNativeAssistantAction,
  previewWorkAssistantAction,
  revealWorkAssistantFile,
  scanWorkAssistantDownloads,
  scanWorkAssistantRoot,
  searchWorkAssistantFiles,
  runTerminalCommand,
  type TerminalRunRequest,
} from './workAssistantClient'
import {
  approveBrowserAction,
  browserSnapshot,
  executeApprovedBrowserAction,
  rejectBrowserAction,
  startBrowserActionPreview,
} from './browserBridgeClient'
import type { BrowserActionPreview, WebExtractResult } from './browserBridgeClient'
import { applyWebArchive, createWebArchivePreview, type WebArchivePreview } from './webArchiveService'
import { extractPublicWebPage } from './webExtractService'
import { approvalChoices, effectiveRisk } from './workAssistantPolicy'
import { ALL_WORK_ASSISTANT_TOOLS } from './workAssistantRegistry'
import type {
  AssistantApprovalChoice,
  AssistantApprovalRequest,
  AssistantToolCall,
  AssistantToolPreview,
  AssistantToolResult,
  WorkAssistantEvent,
} from './workAssistantProtocol'
import { WorkAssistantDeltaBuffer } from './workAssistantEventBuffer'
import { useWorkAssistantStore } from '../stores/useWorkAssistantStore'

type PendingApproval = {
  resolve: (choice: AssistantApprovalChoice) => void
  reject: (error: Error) => void
  abort?: () => void
}

type ExecuteToolInput = {
  runId: string
  toolCall: AssistantToolCall
  signal?: AbortSignal
  emit?: (event: WorkAssistantEvent) => void
}

const pendingApprovals = new Map<string, PendingApproval>()
const previewCache = new Map<string, AssistantToolPreview>()
const webExtractCache = new Map<string, { result: WebExtractResult; expiresAt: number }>()
const webArchivePreviewCache = new Map<string, { result: WebExtractResult; preview: WebArchivePreview }>()
const failureCounts = new Map<string, number>()

const now = () => Date.now()
const dispatch = (event: WorkAssistantEvent) => useWorkAssistantStore.getState().dispatch(event)
const deltaBuffer = new WorkAssistantDeltaBuffer(dispatch)

export function resolveAssistantApproval(id: string, choice: AssistantApprovalChoice) {
  const pending = pendingApprovals.get(id)
  if (!pending) return false
  pendingApprovals.delete(id)
  pending.abort?.()
  pending.resolve(choice)
  return true
}

function waitForApproval(request: AssistantApprovalRequest, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new DOMException('Run cancelled', 'AbortError'))
  return new Promise<AssistantApprovalChoice>((resolve, reject) => {
    const onAbort = () => {
      pendingApprovals.delete(request.id)
      reject(new DOMException('Run cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pendingApprovals.set(request.id, {
      resolve,
      reject,
      abort: () => signal?.removeEventListener('abort', onAbort),
    })
  })
}

function throwIfRunAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Run cancelled', 'AbortError')
}

/**
 * Keep the native cancellation state alive after an approval promise resolves.
 * The approval listener is intentionally removed on resolve, so it cannot be
 * the only cancellation boundary between approval and execution.
 */
function bindNativeRunCancellation(runId: string, signal?: AbortSignal) {
  let cancellationRequested = false
  const requestCancellation = () => {
    if (cancellationRequested) return
    cancellationRequested = true
    void cancelWorkAssistantRun(runId).catch(() => undefined)
  }
  const onAbort = () => requestCancellation()

  if (signal?.aborted) requestCancellation()
  else signal?.addEventListener('abort', onAbort, { once: true })

  return {
    requestCancellation,
    dispose: () => signal?.removeEventListener('abort', onAbort),
  }
}

function stableArguments(value: Record<string, unknown>) {
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]))
}

function failureKey(call: AssistantToolCall) {
  return `${call.runId}:${call.name}:${stableArguments(call.arguments)}`
}

function resultSummary(value: unknown) {
  if (Array.isArray(value)) return `完成，返回 ${value.length} 项。`
  if (value && typeof value === 'object') return '操作已完成。'
  return '操作已完成。'
}

function sanitizedToolData(toolName: string, value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (toolName === 'workspace_list' && Array.isArray(value)) {
    return {
      roots: value.map((root) => {
        const item = root && typeof root === 'object' ? root as Record<string, unknown> : {}
        return { id: item.id, label: item.label, kind: item.kind }
      }),
    }
  }
  if (toolName === 'desktop_status') {
    const status = value as Record<string, unknown>
    const disks = Array.isArray(status.disks)
      ? status.disks.map((disk) => {
          const item = disk && typeof disk === 'object' ? disk as Record<string, unknown> : {}
          return { totalBytes: item.totalBytes, availableBytes: item.availableBytes }
        })
      : []
    return {
      platform: status.platform,
      cpuCount: status.cpuCount,
      cpuUsagePercent: status.cpuUsagePercent,
      memoryTotalBytes: status.memoryTotalBytes,
      memoryUsedBytes: status.memoryUsedBytes,
      disks,
      capabilities: status.capabilities,
    }
  }
  if (toolName === 'desktop_list_apps' && Array.isArray(value)) {
    return {
      applications: value.map((application) => {
        const item = application && typeof application === 'object' ? application as Record<string, unknown> : {}
        return { id: item.id, label: item.label, platform: item.platform, kind: item.kind }
      }),
    }
  }
  if (toolName === 'terminal_run') {
    const terminal = value as Record<string, unknown>
    const allowedOperations = new Set([
      'git_status',
      'git_diff_stat',
      'git_branch',
      'git_log',
      'git_version',
      'system_info',
      'whoami',
    ])
    const program = typeof terminal.program === 'string' && allowedOperations.has(terminal.program)
      ? terminal.program
      : undefined
    const diagnostic = terminal.diagnostic && typeof terminal.diagnostic === 'object'
      ? terminal.diagnostic as Record<string, unknown>
      : undefined
    const safeDiagnostic: Record<string, unknown> = {}
    for (const key of [
      'kind',
      'hasChanges',
      'stagedFiles',
      'unstagedFiles',
      'untrackedFiles',
      'filesChanged',
      'linesAdded',
      'linesDeleted',
      'binaryFiles',
      'recentCommitCount',
      'historyLimitReached',
      'attachedBranch',
      'version',
      'stderrPresent',
    ]) {
      const field = diagnostic?.[key]
      if (typeof field === 'boolean' || typeof field === 'number') safeDiagnostic[key] = field
      if (key === 'kind' && typeof field === 'string' && allowedOperations.has(field)) {
        safeDiagnostic[key] = field
      }
      if (key === 'version' && typeof field === 'string' && /^\d+(?:\.\d+){0,3}$/.test(field)) {
        safeDiagnostic[key] = field
      }
    }
    return {
      ...(program ? { program } : {}),
      ...(typeof terminal.exitCode === 'number' ? { exitCode: terminal.exitCode } : {}),
      ...(typeof terminal.truncated === 'boolean' ? { truncated: terminal.truncated } : {}),
      ...(typeof terminal.durationMs === 'number' ? { durationMs: terminal.durationMs } : {}),
      ...(Object.keys(safeDiagnostic).length > 0 ? { diagnostic: safeDiagnostic } : {}),
    }
  }
  return Array.isArray(value) ? { items: value } : value as Record<string, unknown>
}

function safeToolFailure(error: unknown) {
  const payload = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = typeof payload.code === 'string' ? payload.code : 'tool_failed'
  const recoverable = payload.recoverable !== false
  const summaries: Record<string, string> = {
    stale_preview: '预览已过期，请重新生成。',
    cancelled: '运行已取消。',
    path_outside_workspace: '请求路径不在已授权工作区内。',
    blocked: '该本地操作已被安全策略阻止。',
    page_restricted: '当前页面包含密码、验证码、支付或账号安全内容，已阻止操作。',
    stale_page: '页面已经变化，请重新获取快照后再操作。',
    browser_disconnected: '浏览器未连接，请先配对当前标签页。',
    terminal_program_not_allowed: '该终端程序或参数不在 Papyrus 的安全白名单中。',
    terminal_timeout: '终端命令超时，已停止等待。',
    terminal_output_limit: '终端输出超过安全上限，已截断。',
    terminal_cwd_invalid: '终端工作目录必须位于已授权工作区内。',
    terminal_exit: '终端命令已执行，但退出码表示失败。',
    network: '网络暂不可用，请检查连接后重试。',
    timeout: '请求超时，请稍后重试。',
    unsupported_content_type: '网页内容类型不支持，仅允许 HTML 或纯文本。',
    response_too_large: '网页响应过大，已停止读取。',
  }
  const summary = summaries[code] ?? '工具执行失败，请检查能力状态后重试。'
  return { ok: false as const, summary, errorCode: code, recoverable }
}

async function executeNativeTool(call: AssistantToolCall, signal?: AbortSignal): Promise<unknown> {
  const args = call.arguments
  switch (call.name) {
    case 'workspace_list': return listWorkAssistantRoots()
    case 'workspace_scan': return scanWorkAssistantRoot(String(args.rootId ?? ''))
    case 'file_search': return searchWorkAssistantFiles(String(args.rootId ?? ''), String(args.query ?? ''))
    case 'file_inspect': return inspectWorkAssistantFile(String(args.rootId ?? ''), String(args.path ?? ''))
    case 'downloads_scan': return scanWorkAssistantDownloads(String(args.rootId ?? ''))
    case 'desktop_status': return getWorkAssistantDesktopStatus()
    case 'desktop_list_apps': return listAvailableApplications()
    case 'desktop_open_url': return openWorkAssistantUrl(String(args.url ?? ''))
    case 'file_open': return openWorkAssistantFile(String(args.rootId ?? ''), String(args.path ?? ''))
    case 'desktop_reveal_file': return revealWorkAssistantFile(String(args.rootId ?? ''), String(args.path ?? ''))
    case 'desktop_open_app': return launchRegisteredApplication(String(args.appId ?? ''))
    case 'terminal_run': {
      const operation = typeof args.operation === 'string' ? args.operation as TerminalRunRequest['operation'] : undefined
      if (!operation) {
        throw Object.assign(new Error('终端只接受固定的诊断操作。'), {
          code: 'terminal_program_not_allowed',
          recoverable: true,
        })
      }
      const result = await runTerminalCommand({
        operation,
        rootId: String(args.rootId ?? ''),
        cwd: typeof args.cwd === 'string' ? args.cwd : '',
      })
      const exitCode = typeof result.exitCode === 'number' ? result.exitCode : undefined
      if (exitCode !== undefined && exitCode !== 0) {
        return {
          ok: false,
          summary: `终端命令退出码为 ${exitCode}。`,
          errorCode: 'terminal_exit',
          recoverable: true,
          data: result,
        }
      }
      return result
    }
    case 'web_extract': {
      const result = await extractPublicWebPage(String(args.url ?? ''), call.runId, signal)
      const extractId = `${call.runId}:${call.id}`
      webExtractCache.set(extractId, { result, expiresAt: now() + 10 * 60_000 })
      return { ...result, extractId }
    }
    default: throw new Error(`Unsupported native work-assistant tool: ${call.name}`)
  }
}

async function executeBrowserBridgeTool(call: AssistantToolCall): Promise<unknown> {
  const args = call.arguments
  switch (call.name) {
    case 'browser_snapshot': return browserSnapshot(typeof args.pageRevision === 'string' ? args.pageRevision : undefined, typeof args.snapshotId === 'string' ? args.snapshotId : undefined)
    default: throw new Error(`Unsupported browser bridge tool: ${call.name}`)
  }
}

function browserActionKind(name: AssistantToolCall['name']) {
  const actions = {
    browser_open: 'navigate',
    browser_fill_draft: 'fillDraft',
    browser_click: 'click',
    browser_download: 'download',
    browser_submit: 'submit',
  } as const
  return actions[name as keyof typeof actions]
}

async function previewBrowserBridgeAction(call: AssistantToolCall): Promise<BrowserActionPreview> {
  const args = call.arguments
  const action = browserActionKind(call.name)
  if (!action) throw new Error(`Unsupported browser bridge preview: ${call.name}`)
  return startBrowserActionPreview({
    action,
    runId: call.runId,
    toolCallId: call.id,
    elementToken: typeof args.elementToken === 'string' ? args.elementToken : undefined,
    value: typeof args.value === 'string' ? args.value : undefined,
    pageRevision: typeof args.pageRevision === 'string' ? args.pageRevision : '',
    snapshotId: typeof args.snapshotId === 'string' ? args.snapshotId : undefined,
    url: typeof args.url === 'string' ? args.url : undefined,
    directoryRootId: typeof args.directoryRootId === 'string' ? args.directoryRootId : undefined,
  })
}

function resolveWebArchiveInput(call: AssistantToolCall): { result: WebExtractResult; resourceName?: string } {
  const args = call.arguments
  const extractId = typeof args.extractId === 'string' ? args.extractId : ''
  if (extractId) {
    const cached = webExtractCache.get(extractId)
    if (!cached || cached.expiresAt <= now()) {
      webExtractCache.delete(extractId)
      throw Object.assign(new Error('网页提取结果已过期，请重新提取。'), { code: 'stale_preview', recoverable: true })
    }
    return { result: cached.result, resourceName: typeof args.resourceName === 'string' ? args.resourceName : undefined }
  }

  // Keep accepting the pre-bridge shape for existing clients, but it is still
  // converted to the same project resource and approval path.
  const url = typeof args.url === 'string' ? args.url : ''
  const text = typeof args.text === 'string' ? args.text : ''
  if (!url || !text) throw new Error('网页归档需要提取 ID 或完整 URL 与正文。')
  return {
    result: {
      url,
      canonicalUrl: typeof args.canonicalUrl === 'string' ? args.canonicalUrl : undefined,
      title: typeof args.title === 'string' ? args.title : '',
      text,
      links: [],
      truncated: false,
    },
    resourceName: typeof args.resourceName === 'string'
      ? args.resourceName
      : typeof args.title === 'string'
        ? args.title
        : undefined,
  }
}

function syntheticPreview(call: AssistantToolCall, risk: AssistantToolPreview['risk']): AssistantToolPreview {
  const terminalCommand = call.name === 'terminal_run'
    ? (typeof call.arguments.operation === 'string'
      ? call.arguments.operation
      : [String(call.arguments.program ?? ''), ...(Array.isArray(call.arguments.args) ? call.arguments.args.map(String) : [])]
        .join(' '))
        .slice(0, 220)
    : ''
  return {
    id: `approval-${call.id}`,
    revision: 'local',
    risk,
    title: call.intent || call.name,
    targetSummary: terminalCommand || String(call.arguments.path ?? call.arguments.url ?? call.arguments.appId ?? '桌面操作'),
    impactSummary: terminalCommand
      ? '将在已授权工作区内执行固定程序和结构化参数，不经过 shell；命令输出会被限制并摘要化。'
      : '该操作将调用受控的本地系统能力。',
    reversible: risk === 'reversible',
    expiresAt: now() + 5 * 60_000,
  }
}

function requiresNativeApprovalToken(call: AssistantToolCall) {
  return call.name === 'desktop_open_app'
    || call.name === 'desktop_open_url'
    || call.name === 'file_open'
    || call.name === 'desktop_reveal_file'
    || call.name === 'terminal_run'
}

export async function executeAssistantToolCall(input: ExecuteToolInput): Promise<AssistantToolResult> {
  const emit = input.emit ?? dispatch
  const call = { ...input.toolCall, runId: input.runId }
  const key = failureKey(call)
  emit({ type: 'tool.started', runId: input.runId, toolCall: call, at: now() })

  if ((failureCounts.get(key) ?? 0) >= 2) {
    const guarded = { ok: false, summary: '相同工具请求连续失败，已停止自动重试。', errorCode: 'loop_guard', recoverable: true }
    emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: guarded, at: now() })
    return guarded
  }

  const nativeCancellation = bindNativeRunCancellation(input.runId, input.signal)
  try {
    throwIfRunAborted(input.signal)
    let preview: AssistantToolPreview | undefined

    if (call.name === 'file_plan_batch') {
      emit({ type: 'tool.progress', runId: input.runId, toolCallId: call.id, message: '正在生成安全预览', at: now() })
      preview = await previewWorkAssistantAction({
        runId: input.runId,
        toolCallId: call.id,
        toolName: call.name,
        arguments: call.arguments,
      })
      previewCache.set(preview.id, preview)
      const result = { ok: true, summary: '文件操作预览已生成。', data: { previewId: preview.id, preview } }
      emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result, at: now() })
      return result
    }

    const manifest = ALL_WORK_ASSISTANT_TOOLS.find((item) => item.name === call.name)
    if (!manifest) throw new Error(`Unsupported work-assistant tool: ${call.name}`)

    if (call.name === 'file_apply_batch') {
      const previewId = String(call.arguments.previewId ?? '')
      preview = previewCache.get(previewId)
      if (!preview) throw new Error('The approved preview is unavailable; regenerate it first.')
    } else if (manifest.executor === 'project') {
      if (call.name !== 'web_archive') throw new Error(`Unsupported project tool: ${call.name}`)
      const archiveInput = resolveWebArchiveInput(call)
      const archivePreview = createWebArchivePreview(archiveInput.result, archiveInput.resourceName)
      preview = archivePreview
      webArchivePreviewCache.set(archivePreview.id, { result: archiveInput.result, preview: archivePreview })
    } else if (manifest.executor === 'browser_bridge' && manifest.defaultRisk !== 'read') {
      preview = await previewBrowserBridgeAction(call)
    } else if (manifest.executor === 'native' && requiresNativeApprovalToken(call)) {
      // Do not let a frontend-only preview stand in for an external process
      // launch. The native layer stores the validated action and later accepts
      // only its opaque id plus a one-time approval token.
      preview = await previewNativeAssistantAction({
        runId: input.runId,
        toolCallId: call.id,
        toolName: call.name,
        arguments: call.arguments,
      })
    } else if (manifest.defaultRisk !== 'read') {
      preview = syntheticPreview(call, manifest.defaultRisk)
    }

    if (preview) {
      throwIfRunAborted(input.signal)
      const risk = effectiveRisk(manifest.defaultRisk, preview.risk)
      const request: AssistantApprovalRequest = {
        ...preview,
        runId: input.runId,
        toolCallId: call.id,
        reason: preview.impactSummary,
        allowedChoices: approvalChoices(risk),
      }
      emit({ type: 'approval.required', runId: input.runId, request, at: now() })
      const choice = await waitForApproval(request, input.signal)
      throwIfRunAborted(input.signal)
      if (choice === 'deny') {
        if (manifest.executor === 'browser_bridge') {
          await rejectBrowserAction(preview.id, input.runId).catch(() => undefined)
        }
        const denied = { ok: false, summary: '用户已拒绝该操作。', errorCode: 'cancelled', recoverable: true }
        emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: denied, at: now() })
        return denied
      }

      emit({ type: 'tool.progress', runId: input.runId, toolCallId: call.id, message: '审批通过，正在执行', at: now() })
      if (call.name === 'file_apply_batch') {
        throwIfRunAborted(input.signal)
        const grant = await approveWorkAssistantAction(preview.id, input.runId, choice)
        throwIfRunAborted(input.signal)
        const data = await executeWorkAssistantAction(preview.id, grant.token)
        const failed = data.failed.length > 0
        const result = {
          ok: !failed && !data.cancelled,
          summary: data.cancelled ? '文件操作已取消。' : failed ? '部分文件操作未完成。' : '文件操作已完成。',
          data: data as unknown as Record<string, unknown>,
          errorCode: failed ? 'partial_transaction' : data.cancelled ? 'cancelled' : undefined,
          recoverable: failed || data.cancelled,
        }
        emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result, at: now() })
        return result
      }
      if (manifest.executor === 'project') {
        throwIfRunAborted(input.signal)
        const pending = webArchivePreviewCache.get(preview.id)
        if (!pending) throw new Error('网页归档预览不可用，请重新提取。')
        const result = applyWebArchive(pending.result, pending.preview)
        webArchivePreviewCache.delete(preview.id)
        emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result, at: now() })
        return result
      }
      if (manifest.executor === 'browser_bridge') {
        throwIfRunAborted(input.signal)
        const grant = await approveBrowserAction(preview.id, input.runId)
        throwIfRunAborted(input.signal)
        const data = await executeApprovedBrowserAction({
          previewId: grant.previewId,
          approvalToken: grant.token,
          actionHash: grant.actionHash,
        })
        const actionPayload = data && typeof data === 'object' ? data as Record<string, unknown> : undefined
        const result = actionPayload?.ok === false
          ? {
              ok: false as const,
              summary: typeof actionPayload.summary === 'string' ? actionPayload.summary : '浏览器动作被安全策略阻止。',
              errorCode: typeof actionPayload.errorCode === 'string' ? actionPayload.errorCode : 'blocked',
              recoverable: actionPayload.recoverable !== false,
              data: sanitizedToolData(call.name, data),
            }
          : { ok: true as const, summary: resultSummary(data), data: sanitizedToolData(call.name, data) }
        emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result, at: now() })
        return result
      }
      if (manifest.executor === 'native' && requiresNativeApprovalToken(call)) {
        throwIfRunAborted(input.signal)
        const grant = await approveNativeAssistantAction(preview.id, input.runId, choice)
        throwIfRunAborted(input.signal)
        const data = await executeNativeAssistantAction(grant.previewId, grant.token)
        const result = data?.ok === false
          ? {
              ok: false as const,
              summary: data.summary || '本地操作被安全策略阻止。',
              errorCode: data.errorCode || 'blocked',
              recoverable: data.recoverable !== false,
              data: sanitizedToolData(call.name, data.data),
            }
          : {
              ok: true as const,
              summary: data.summary || resultSummary(data.data),
              data: sanitizedToolData(call.name, data.data),
            }
        emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result, at: now() })
        return result
      }
    }

    throwIfRunAborted(input.signal)
    const data = manifest.executor === 'browser_bridge'
      ? await executeBrowserBridgeTool(call)
      : await executeNativeTool(call, input.signal)
    const actionPayload = data && typeof data === 'object' ? data as Record<string, unknown> : undefined
    const actionFailure = actionPayload?.ok === false
    const result = actionFailure
      ? {
          ok: false as const,
          summary: typeof actionPayload?.summary === 'string' ? actionPayload.summary : '浏览器动作被安全策略阻止。',
          errorCode: typeof actionPayload?.errorCode === 'string' ? actionPayload.errorCode : 'blocked',
          recoverable: actionPayload?.recoverable !== false,
          data: sanitizedToolData(call.name, data),
        }
      : { ok: true as const, summary: resultSummary(data), data: sanitizedToolData(call.name, data) }
    failureCounts.delete(key)
    emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result, at: now() })
    return result
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      nativeCancellation.requestCancellation()
      const cancelled = { ok: false, summary: '运行已取消。', errorCode: 'cancelled', recoverable: true }
      emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: cancelled, at: now() })
      return cancelled
    }
    failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1)
    const failed = safeToolFailure(error)
    emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: failed, at: now() })
    return failed
  } finally {
    nativeCancellation.dispose()
  }
}

export function flushRunDeltas(runId: string) {
  deltaBuffer.flushRun(runId)
}

export function flushAllWorkAssistantDeltas() {
  deltaBuffer.flushAll()
}

export function queueWorkAssistantDelta(event: Extract<WorkAssistantEvent, { type: 'message.delta' }>) {
  deltaBuffer.queue(event)
}

export function dispatchOrderedWorkAssistantEvent(event: WorkAssistantEvent) {
  if (event.type === 'message.delta') queueWorkAssistantDelta(event)
  else {
    // Status, tool, approval, and terminal transitions must never overtake
    // already-visible assistant text for the same run.
    flushRunDeltas(event.runId)
    dispatch(event)
  }
}

export function resetWorkAssistantRuntimeForTests() {
  flushAllWorkAssistantDeltas()
  pendingApprovals.clear()
  previewCache.clear()
  webExtractCache.clear()
  webArchivePreviewCache.clear()
  failureCounts.clear()
  useWorkAssistantStore.getState().resetAllRuns()
  useWorkAssistantStore.setState({ capabilityStatus: [] })
}
