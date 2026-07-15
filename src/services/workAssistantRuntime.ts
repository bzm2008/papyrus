import {
  approveWorkAssistantAction,
  cancelWorkAssistantRun,
  executeWorkAssistantAction,
  getWorkAssistantDesktopStatus,
  inspectWorkAssistantFile,
  launchRegisteredApplication,
  listWorkAssistantRoots,
  openWorkAssistantFile,
  openWorkAssistantUrl,
  previewWorkAssistantAction,
  revealWorkAssistantFile,
  scanWorkAssistantDownloads,
  scanWorkAssistantRoot,
  searchWorkAssistantFiles,
} from './workAssistantClient'
import type { ApprovalGrant } from './workAssistantClient'
import {
  approveBrowserAction,
  browserSnapshot,
  cancelBrowserBridgeRun,
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
import { useWorkAssistantStore } from '../stores/useWorkAssistantStore'

type PendingApproval = {
  runId: string
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

type CachedRunApprovalGrant = {
  grant: ApprovalGrant
  scope: string[]
}

const pendingApprovals = new Map<string, PendingApproval>()
const previewCache = new Map<string, AssistantToolPreview>()
const previewRunIds = new Map<string, string>()
const runApprovalGrants = new Map<string, CachedRunApprovalGrant>()
const webExtractCache = new Map<string, { result: WebExtractResult; expiresAt: number }>()
const webArchivePreviewCache = new Map<string, { result: WebExtractResult; preview: WebArchivePreview }>()
const webArchivePreviewRunIds = new Map<string, string>()
const workspaceRunIds = new Set<string>()
const browserRunIds = new Set<string>()
const failureCounts = new Map<string, number>()
const MAX_CANCELLED_RUNS = 256
const cancelledRuns = new Set<string>()
const MAX_ENDED_RUNS = 256
const endedRuns = new Set<string>()
let runtimeEpoch = 0

const queuedDeltas = new Map<string, { runId: string; messageId: string; text: string; at: number }>()
let deltaTimer: ReturnType<typeof setTimeout> | undefined
let deltaFrame: number | undefined

const now = () => Date.now()
const dispatch = (event: WorkAssistantEvent) => useWorkAssistantStore.getState().dispatch(event)

function runApprovalKey(runId: string, preview: AssistantToolPreview) {
  const scope = Array.isArray(preview.scope) ? preview.scope.filter((value): value is string => typeof value === 'string' && value.length > 0) : []
  if (scope.length === 1) {
    try {
      const parsed = JSON.parse(scope[0]) as Record<string, unknown>
      if (
        parsed.version === 1
        && typeof parsed.toolName === 'string'
        && typeof parsed.rootId === 'string'
        && typeof parsed.targetParent === 'string'
        && typeof parsed.conflictPolicy === 'string'
        && typeof parsed.operationKind === 'string'
        && Number.isSafeInteger(parsed.maxItemCount)
      ) {
        return `${runId}:scope:${JSON.stringify({
          version: parsed.version,
          toolName: parsed.toolName,
          rootId: parsed.rootId,
          targetParent: parsed.targetParent,
          conflictPolicy: parsed.conflictPolicy,
          operationKind: parsed.operationKind,
        })}`
      }
    } catch {
      // Preserve the legacy opaque-array key below. Native execution still validates it.
    }
  }
  return `${runId}:opaque:${JSON.stringify(scope)}`
}

function runScopeAllows(grantScope: string[], requestScope: string[]) {
  if (grantScope.length !== 1 || requestScope.length !== 1) {
    return JSON.stringify(grantScope) === JSON.stringify(requestScope)
  }
  try {
    const grant = JSON.parse(grantScope[0]) as Record<string, unknown>
    const request = JSON.parse(requestScope[0]) as Record<string, unknown>
    const fields = ['version', 'toolName', 'rootId', 'targetParent', 'conflictPolicy', 'operationKind'] as const
    const structured = (value: Record<string, unknown>) => fields.every((field) => typeof value[field] === 'string' || field === 'version')
    if (!structured(grant) || !structured(request) || grant.version !== 1 || request.version !== 1) return JSON.stringify(grantScope) === JSON.stringify(requestScope)
    const dangerous = (value: Record<string, unknown>) =>
      value.conflictPolicy === 'overwrite'
      || ['trash', 'delete', 'desktop_open_app', 'browser_download', 'external_navigation', 'send', 'publish', 'submit'].some((kind) => String(value.operationKind).split(',').includes(kind))
    if (dangerous(grant) || dangerous(request)) return false
    return fields.every((field) => grant[field] === request[field])
      && Number.isSafeInteger(grant.maxItemCount)
      && Number.isSafeInteger(request.maxItemCount)
      && Number(request.maxItemCount) <= Number(grant.maxItemCount)
  } catch {
    return JSON.stringify(grantScope) === JSON.stringify(requestScope)
  }
}

function clearRunApprovalGrants(runId: string) {
  for (const key of runApprovalGrants.keys()) {
    if (key.startsWith(`${runId}:`)) runApprovalGrants.delete(key)
  }
}

class RunEndedError extends Error {
  constructor() {
    super('Run has already ended')
    this.name = 'RunEndedError'
  }
}

function clearRunLocalState(runId: string, reason: 'cancelled' | 'ended' = 'cancelled') {
  for (const [approvalId, pending] of pendingApprovals) {
    if (pending.runId !== runId) continue
    pendingApprovals.delete(approvalId)
    pending.abort?.()
    pending.reject(reason === 'cancelled' ? abortError() : new RunEndedError())
  }
  for (const [previewId, previewRunId] of previewRunIds) {
    if (previewRunId !== runId) continue
    previewRunIds.delete(previewId)
    previewCache.delete(previewId)
  }
  for (const [previewId, previewRunId] of webArchivePreviewRunIds) {
    if (previewRunId !== runId) continue
    webArchivePreviewRunIds.delete(previewId)
    webArchivePreviewCache.delete(previewId)
  }
  for (const key of webExtractCache.keys()) {
    if (key.startsWith(`${runId}:`)) webExtractCache.delete(key)
  }
  clearRunApprovalGrants(runId)
}

function abortError() {
  return new DOMException('Run cancelled', 'AbortError')
}

function throwIfRunCancelled(runId: string, signal?: AbortSignal) {
  if (signal?.aborted || cancelledRuns.has(runId)) throw abortError()
  if (endedRuns.has(runId)) throw new RunEndedError()
}

function markRunCancelled(runId: string) {
  if (!cancelledRuns.has(runId) && cancelledRuns.size >= MAX_CANCELLED_RUNS) {
    const oldest = cancelledRuns.values().next().value
    if (typeof oldest === 'string') cancelledRuns.delete(oldest)
  }
  cancelledRuns.add(runId)
}

function markRunEnded(runId: string) {
  if (!endedRuns.has(runId) && endedRuns.size >= MAX_ENDED_RUNS) {
    const oldest = endedRuns.values().next().value
    if (typeof oldest === 'string') endedRuns.delete(oldest)
  }
  endedRuns.add(runId)
}

async function cancelRunScopedState(runId: string): Promise<string[]> {
  const cancelWorkspace = workspaceRunIds.has(runId)
  const cancelBrowser = browserRunIds.has(runId)
  markRunCancelled(runId)
  clearRunLocalState(runId)
  const failures: string[] = []
  // Browser approval tokens live in a separate native state map. Keep this
  // cleanup independent from the workspace cancellation command so a browser
  // token cannot survive a cancelled run even when no file tool was involved.
  if (cancelBrowser) {
    await Promise.resolve().then(() => cancelBrowserBridgeRun(runId)).catch(() => { failures.push('browser') })
  }
  if (cancelWorkspace) {
    await Promise.resolve().then(() => cancelWorkAssistantRun(runId)).catch(() => { failures.push('workspace') })
  }
  workspaceRunIds.delete(runId)
  browserRunIds.delete(runId)
  return failures
}

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
      runId: request.runId,
      resolve,
      reject,
      abort: () => signal?.removeEventListener('abort', onAbort),
    })
  })
}

function stableArguments(value: Record<string, unknown>) {
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]))
}

function failureKey(call: AssistantToolCall) {
  return `${call.runId}:${call.name}:${stableArguments(call.arguments)}`
}

function resultSummary(value: unknown) {
  if (Array.isArray(value)) return `完成，返回 ${value.length} 项。`
  if (value && typeof value === 'object' && typeof (value as { summary?: unknown }).summary === 'string') {
    return String((value as { summary: string }).summary)
  }
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
    network: '网络暂不可用，请检查连接后重试。',
    timeout: '请求超时，请稍后重试。',
    unsupported_content_type: '网页内容类型不支持，仅允许 HTML 或纯文本。',
    response_too_large: '网页响应过大，已停止读取。',
  }
  const summary = summaries[code] ?? '工具执行失败，请检查能力状态后重试。'
  return { ok: false as const, summary, errorCode: code, recoverable }
}

async function executeNativeTool(call: AssistantToolCall, signal?: AbortSignal): Promise<unknown> {
  workspaceRunIds.add(call.runId)
  const args = call.arguments
  switch (call.name) {
    case 'workspace_list': return listWorkAssistantRoots()
    case 'workspace_scan': return scanWorkAssistantRoot(String(args.rootId ?? ''))
    case 'file_search': return searchWorkAssistantFiles(String(args.rootId ?? ''), String(args.query ?? ''))
    case 'file_inspect': return inspectWorkAssistantFile(String(args.rootId ?? ''), String(args.path ?? ''))
    case 'downloads_scan': return scanWorkAssistantDownloads(String(args.rootId ?? ''))
    case 'desktop_status': return getWorkAssistantDesktopStatus()
    case 'desktop_open_url': return openWorkAssistantUrl(String(args.url ?? ''))
    case 'file_open': return openWorkAssistantFile(String(args.rootId ?? ''), String(args.path ?? ''))
    case 'desktop_reveal_file': return revealWorkAssistantFile(String(args.rootId ?? ''), String(args.path ?? ''))
    case 'desktop_open_app': return launchRegisteredApplication(String(args.appId ?? ''))
    case 'web_extract': {
      const result = await extractPublicWebPage(String(args.url ?? ''), call.runId, signal)
      const extractId = `${call.runId}:${call.id}`
      webExtractCache.set(extractId, { result, expiresAt: now() + 10 * 60_000 })
      return { ...result, extractId }
    }
    default: throw new Error(`Unsupported native work-assistant tool: ${call.name}`)
  }
}

async function executeBrowserBridgeTool(call: AssistantToolCall, signal?: AbortSignal): Promise<unknown> {
  browserRunIds.add(call.runId)
  throwIfRunCancelled(call.runId, signal)
  const args = call.arguments
  switch (call.name) {
    case 'browser_snapshot': {
      const result = await browserSnapshot(
        typeof args.pageRevision === 'string' ? args.pageRevision : undefined,
        typeof args.snapshotId === 'string' ? args.snapshotId : undefined,
        signal,
        call.runId,
      )
      throwIfRunCancelled(call.runId, signal)
      return result
    }
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

async function previewBrowserBridgeAction(call: AssistantToolCall, signal?: AbortSignal): Promise<BrowserActionPreview> {
  throwIfRunCancelled(call.runId, signal)
  const args = call.arguments
  const action = browserActionKind(call.name)
  if (!action) throw new Error(`Unsupported browser bridge preview: ${call.name}`)
  const preview = await startBrowserActionPreview({
    action,
    runId: call.runId,
    toolCallId: call.id,
    elementToken: typeof args.elementToken === 'string' ? args.elementToken : undefined,
    value: typeof args.value === 'string' ? args.value : undefined,
    pageRevision: typeof args.pageRevision === 'string' ? args.pageRevision : '',
    snapshotId: typeof args.snapshotId === 'string' ? args.snapshotId : undefined,
    url: typeof args.url === 'string' ? args.url : undefined,
    directoryRootId: typeof args.directoryRootId === 'string' ? args.directoryRootId : undefined,
  }, signal)
  throwIfRunCancelled(call.runId, signal)
  return preview
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
  return {
    id: `approval-${call.id}`,
    revision: 'local',
    risk,
    title: call.intent || call.name,
    targetSummary: String(call.arguments.path ?? call.arguments.url ?? call.arguments.appId ?? '桌面操作'),
    impactSummary: '该操作将调用受控的本地系统能力。',
    reversible: risk === 'reversible',
    expiresAt: now() + 5 * 60_000,
  }
}

export async function executeAssistantToolCall(input: ExecuteToolInput): Promise<AssistantToolResult> {
  const emit = input.emit ?? dispatch
  const call = { ...input.toolCall, runId: input.runId }
  const initialManifest = ALL_WORK_ASSISTANT_TOOLS.find((item) => item.name === call.name)
  if (initialManifest?.executor === 'browser_bridge') browserRunIds.add(input.runId)
  if (initialManifest?.executor === 'native') workspaceRunIds.add(input.runId)
  const key = failureKey(call)
  emit({ type: 'tool.started', runId: input.runId, toolCall: call, at: now() })

  if ((failureCounts.get(key) ?? 0) >= 2) {
    const guarded = { ok: false, summary: '相同工具请求连续失败，已停止自动重试。', errorCode: 'loop_guard', recoverable: true }
    emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: guarded, at: now() })
    return guarded
  }

  let activeApprovalKey: string | undefined
  try {
    throwIfRunCancelled(input.runId, input.signal)
    let preview: AssistantToolPreview | undefined

    if (call.name === 'file_plan_batch') {
      workspaceRunIds.add(input.runId)
      emit({ type: 'tool.progress', runId: input.runId, toolCallId: call.id, message: '正在生成安全预览', at: now() })
      preview = await previewWorkAssistantAction({
        runId: input.runId,
        toolCallId: call.id,
        toolName: call.name,
        arguments: call.arguments,
      })
      throwIfRunCancelled(input.runId, input.signal)
      previewCache.set(preview.id, preview)
      previewRunIds.set(preview.id, input.runId)
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
      webArchivePreviewRunIds.set(archivePreview.id, input.runId)
    } else if (manifest.executor === 'browser_bridge' && manifest.defaultRisk !== 'read') {
      browserRunIds.add(input.runId)
      preview = await previewBrowserBridgeAction(call, input.signal)
    } else if (manifest.defaultRisk !== 'read') {
      preview = syntheticPreview(call, manifest.defaultRisk)
    }

    if (preview) {
      if (manifest.executor === 'browser_bridge') browserRunIds.add(input.runId)
      if (manifest.executor === 'native') workspaceRunIds.add(input.runId)
      const risk = effectiveRisk(manifest.defaultRisk, preview.risk)
      const approvalKey =
        call.name === 'file_apply_batch' && Array.isArray(preview.scope) && preview.scope.length
          ? runApprovalKey(input.runId, preview)
          : undefined
      activeApprovalKey = approvalKey
      const cachedGrant = approvalKey ? runApprovalGrants.get(approvalKey) : undefined
      const scopeMatches = cachedGrant ? runScopeAllows(cachedGrant.scope, preview.scope ?? []) : false
      const grantIsFresh = cachedGrant && scopeMatches && (cachedGrant.grant.expires > 10_000_000_000
        ? cachedGrant.grant.expires > now()
        : cachedGrant.grant.expires * 1000 > now())
      if (cachedGrant && !grantIsFresh && approvalKey && !scopeMatches) {
        // Keep a wider grant available for a later narrower request, but never reuse it for a
        // changed target, policy, operation kind, or larger item bound.
      } else if (cachedGrant && !grantIsFresh && approvalKey) {
        runApprovalGrants.delete(approvalKey)
      }

      let choice: AssistantApprovalChoice = 'run'
      let nativeGrant: ApprovalGrant | undefined = grantIsFresh ? cachedGrant.grant : undefined
      if (!nativeGrant) {
        const request: AssistantApprovalRequest = {
          ...preview,
          runId: input.runId,
          toolCallId: call.id,
          reason: preview.impactSummary,
          allowedChoices: approvalChoices(risk),
        }
        emit({ type: 'approval.required', runId: input.runId, request, at: now() })
        choice = await waitForApproval(request, input.signal)
      }
      if (choice === 'deny') {
        if (manifest.executor === 'browser_bridge') {
          await rejectBrowserAction(preview.id, input.runId).catch(() => undefined)
        }
        const denied = { ok: false, summary: '用户已拒绝该操作。', errorCode: 'cancelled', recoverable: true }
        emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: denied, at: now() })
        return denied
      }

      throwIfRunCancelled(input.runId, input.signal)
      emit({ type: 'tool.progress', runId: input.runId, toolCallId: call.id, message: '审批通过，正在执行', at: now() })
      if (call.name === 'file_apply_batch') {
        workspaceRunIds.add(input.runId)
        nativeGrant ??= await approveWorkAssistantAction(preview.id, input.runId, choice)
        throwIfRunCancelled(input.runId, input.signal)
        if (choice === 'run' && approvalKey) {
          runApprovalGrants.set(approvalKey, { grant: nativeGrant, scope: preview.scope ?? [] })
        }
        const data = await executeWorkAssistantAction(preview.id, nativeGrant.token, input.runId, input.signal)
        const cancellationRequested = input.signal?.aborted || cancelledRuns.has(input.runId)
        const failed = data.failed.length > 0
        const completedAfterCancellation = cancellationRequested && !data.cancelled
        const result = {
          ok: !failed && !data.cancelled && !completedAfterCancellation,
          summary: data.cancelled
            ? '文件操作已取消。'
            : completedAfterCancellation
              ? '文件操作已完成；取消请求到达时操作已提交。'
              : failed
                ? '部分文件操作未完成。'
                : '文件操作已完成。',
          data: data as unknown as Record<string, unknown>,
          errorCode: failed
            ? 'partial_transaction'
            : data.cancelled
              ? 'cancelled'
              : completedAfterCancellation
                ? 'request_uncertain'
                : undefined,
          recoverable: failed || data.cancelled,
        }
        if (!result.ok && approvalKey && (result.errorCode === 'stale_preview' || result.errorCode === 'blocked')) {
          runApprovalGrants.delete(approvalKey)
        }
        emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result, at: now() })
        return result
      }
      if (manifest.executor === 'project') {
        const pending = webArchivePreviewCache.get(preview.id)
        if (!pending) throw new Error('网页归档预览不可用，请重新提取。')
        const result = applyWebArchive(pending.result, pending.preview)
        webArchivePreviewCache.delete(preview.id)
        webArchivePreviewRunIds.delete(preview.id)
        emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result, at: now() })
        return result
      }
      if (manifest.executor === 'browser_bridge') {
        const grant = await approveBrowserAction(preview.id, input.runId, input.signal)
        throwIfRunCancelled(input.runId, input.signal)
        let data: unknown
        try {
          data = await executeApprovedBrowserAction({
            previewId: grant.previewId,
            approvalToken: grant.token,
            actionHash: grant.actionHash,
          }, input.signal)
        } catch (error) {
          if (input.signal?.aborted || cancelledRuns.has(input.runId)) {
            const cancellationFailures = await cancelRunScopedState(input.runId)
            const uncertain = {
              ok: false as const,
              summary: cancellationFailures.length > 0
                ? '浏览器动作可能已经发送，但取消清理未能确认；请检查浏览器后再决定是否重试。'
                : '浏览器动作可能已经发送，取消请求到达时结果未确认；请检查浏览器后再决定是否重试。',
              errorCode: 'request_uncertain' as const,
              recoverable: true,
            }
            emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: uncertain, at: now() })
            return uncertain
          }
          throw error
        }
        const actionPayload = data && typeof data === 'object' ? data as Record<string, unknown> : undefined
        const cancellationRequested = input.signal?.aborted || cancelledRuns.has(input.runId)
        const result = cancellationRequested
          ? {
              ok: false as const,
              summary: '浏览器动作可能已经发送，取消请求到达时结果未确认；请检查浏览器后再决定是否重试。',
              errorCode: 'request_uncertain' as const,
              recoverable: true,
              data: sanitizedToolData(call.name, data),
            }
          : actionPayload?.ok === false
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
    }

    const data = manifest.executor === 'browser_bridge'
      ? await executeBrowserBridgeTool(call, input.signal)
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
    if (activeApprovalKey) runApprovalGrants.delete(activeApprovalKey)
    if (error instanceof RunEndedError) {
      const ended = { ok: false, summary: '运行已结束，已忽略待处理审批。', errorCode: 'run_ended', recoverable: false }
      emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: ended, at: now() })
      return ended
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      const cancellationFailures = await cancelRunScopedState(input.runId)
      const cancelled = cancellationFailures.length > 0
        ? { ok: false, summary: '运行已取消，但部分本地操作未能确认停止，请检查工作助手状态。', errorCode: 'cancel_failed', recoverable: true }
        : { ok: false, summary: '运行已取消。', errorCode: 'cancelled', recoverable: true }
      emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: cancelled, at: now() })
      return cancelled
    }
    failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1)
    const failed = safeToolFailure(error)
    emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: failed, at: now() })
    return failed
  }
}

function flushQueuedItem(key: string) {
  const queued = queuedDeltas.get(key)
  if (!queued) return
  queuedDeltas.delete(key)
  dispatch({ type: 'message.delta', runId: queued.runId, messageId: queued.messageId, delta: queued.text, at: queued.at })
}

export function flushRunDeltas(runId: string) {
  for (const [key, queued] of queuedDeltas) if (queued.runId === runId) flushQueuedItem(key)
}

export function flushAllWorkAssistantDeltas() {
  for (const key of [...queuedDeltas.keys()]) flushQueuedItem(key)
  if (deltaTimer) clearTimeout(deltaTimer)
  if (deltaFrame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(deltaFrame)
  deltaTimer = undefined
  deltaFrame = undefined
}

function scheduleDeltaFlush() {
  if (deltaTimer || deltaFrame !== undefined) return
  const startedAt = now()
  const flushAfterFloor = () => {
    const remaining = Math.max(0, 40 - (now() - startedAt))
    deltaTimer = setTimeout(() => {
      deltaTimer = undefined
      deltaFrame = undefined
      flushAllWorkAssistantDeltas()
    }, remaining)
  }
  if (typeof requestAnimationFrame === 'function') deltaFrame = requestAnimationFrame(flushAfterFloor)
  else flushAfterFloor()
}

export function queueWorkAssistantDelta(event: Extract<WorkAssistantEvent, { type: 'message.delta' }>) {
  const key = `${event.runId}:${event.messageId}`
  const queued = queuedDeltas.get(key) ?? { runId: event.runId, messageId: event.messageId, text: '', at: event.at }
  queued.text += event.delta
  queued.at = event.at
  queuedDeltas.set(key, queued)
  scheduleDeltaFlush()
}

export function dispatchOrderedWorkAssistantEvent(event: WorkAssistantEvent) {
  if (event.type === 'message.delta') queueWorkAssistantDelta(event)
  else {
    flushRunDeltas(event.runId)
    if (event.type === 'run.cancelled') {
      markRunCancelled(event.runId)
      clearRunLocalState(event.runId)
      const epoch = runtimeEpoch
      void cancelRunScopedState(event.runId).then((failures) => {
        const run = useWorkAssistantStore.getState().runs[event.runId]
        if (epoch !== runtimeEpoch || run?.status !== 'cancelled') return
        if (failures.length > 0) {
          dispatch({
            type: 'run.failed',
            runId: event.runId,
            code: 'cancel_failed',
            message: '取消未能确认所有本地操作已停止，请检查工作助手状态。',
            recoverable: true,
            at: now(),
          })
        }
      })
    }
    if (event.type === 'run.completed' || event.type === 'run.failed') {
      markRunEnded(event.runId)
      clearRunLocalState(event.runId, 'ended')
      workspaceRunIds.delete(event.runId)
      browserRunIds.delete(event.runId)
      // Keep a cancelled run marked until bounded eviction; a late terminal
      // event must not reopen its browser capability window.
    }
    dispatch(event)
  }
}

export function resetWorkAssistantRuntimeForTests() {
  runtimeEpoch += 1
  flushAllWorkAssistantDeltas()
  pendingApprovals.clear()
  previewCache.clear()
  previewRunIds.clear()
  runApprovalGrants.clear()
  webExtractCache.clear()
  webArchivePreviewCache.clear()
  webArchivePreviewRunIds.clear()
  workspaceRunIds.clear()
  browserRunIds.clear()
  failureCounts.clear()
  cancelledRuns.clear()
  endedRuns.clear()
  useWorkAssistantStore.getState().resetAllRuns()
  useWorkAssistantStore.setState({ capabilityStatus: [] })
}
