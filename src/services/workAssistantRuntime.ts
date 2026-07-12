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
import { approvalChoices, effectiveRisk } from './workAssistantPolicy'
import { WORK_ASSISTANT_TOOLS } from './workAssistantRegistry'
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
const failureCounts = new Map<string, number>()

const queuedDeltas = new Map<string, { runId: string; messageId: string; text: string; at: number }>()
let deltaTimer: ReturnType<typeof setTimeout> | undefined
let deltaFrame: number | undefined

const now = () => Date.now()
const dispatch = (event: WorkAssistantEvent) => useWorkAssistantStore.getState().dispatch(event)

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

async function executeReadOrDesktopTool(call: AssistantToolCall): Promise<unknown> {
  const args = call.arguments
  switch (call.name) {
    case 'workspace_list': return listWorkAssistantRoots()
    case 'workspace_scan': return scanWorkAssistantRoot(String(args.rootId ?? ''))
    case 'file_search': return searchWorkAssistantFiles(String(args.rootId ?? ''), String(args.query ?? ''))
    case 'file_inspect': return inspectWorkAssistantFile(String(args.rootId ?? ''), String(args.path ?? ''))
    case 'downloads_scan': return scanWorkAssistantDownloads()
    case 'desktop_status': return getWorkAssistantDesktopStatus()
    case 'desktop_open_url': return openWorkAssistantUrl(String(args.url ?? ''))
    case 'file_open': return openWorkAssistantFile(String(args.rootId ?? ''), String(args.path ?? ''))
    case 'desktop_reveal_file': return revealWorkAssistantFile(String(args.rootId ?? ''), String(args.path ?? ''))
    case 'desktop_open_app': return launchRegisteredApplication(String(args.appId ?? ''))
    default: throw new Error(`Unsupported work-assistant tool: ${call.name}`)
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
  const key = failureKey(call)
  emit({ type: 'tool.started', runId: input.runId, toolCall: call, at: now() })

  if ((failureCounts.get(key) ?? 0) >= 2) {
    const guarded = { ok: false, summary: '相同工具请求连续失败，已停止自动重试。', errorCode: 'loop_guard', recoverable: true }
    emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: guarded, at: now() })
    return guarded
  }

  try {
    if (input.signal?.aborted) throw new DOMException('Run cancelled', 'AbortError')
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

    const manifest = WORK_ASSISTANT_TOOLS.find((item) => item.name === call.name)
    if (!manifest) throw new Error(`Unsupported work-assistant tool: ${call.name}`)

    if (call.name === 'file_apply_batch') {
      const previewId = String(call.arguments.previewId ?? '')
      preview = previewCache.get(previewId)
      if (!preview) throw new Error('The approved preview is unavailable; regenerate it first.')
    } else if (manifest.defaultRisk !== 'read') {
      preview = syntheticPreview(call, manifest.defaultRisk)
    }

    if (preview) {
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
      if (choice === 'deny') {
        const denied = { ok: false, summary: '用户已拒绝该操作。', errorCode: 'cancelled', recoverable: true }
        emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: denied, at: now() })
        return denied
      }

      emit({ type: 'tool.progress', runId: input.runId, toolCallId: call.id, message: '审批通过，正在执行', at: now() })
      if (call.name === 'file_apply_batch') {
        const grant = await approveWorkAssistantAction(preview.id, input.runId, choice)
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
    }

    const data = await executeReadOrDesktopTool(call)
    const result = { ok: true, summary: resultSummary(data), data: data && typeof data === 'object' ? data as Record<string, unknown> : undefined }
    failureCounts.delete(key)
    emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result, at: now() })
    return result
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      await cancelWorkAssistantRun(input.runId).catch(() => undefined)
      const cancelled = { ok: false, summary: '运行已取消。', errorCode: 'cancelled', recoverable: true }
      emit({ type: 'tool.completed', runId: input.runId, toolCallId: call.id, result: cancelled, at: now() })
      return cancelled
    }
    failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1)
    const failed = { ok: false, summary: error instanceof Error ? error.message : '工具执行失败。', errorCode: 'tool_failed', recoverable: true }
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
    dispatch(event)
  }
}

export function resetWorkAssistantRuntimeForTests() {
  flushAllWorkAssistantDeltas()
  pendingApprovals.clear()
  previewCache.clear()
  failureCounts.clear()
  useWorkAssistantStore.setState({ runs: {}, activeRunId: undefined, selectedToolCallId: undefined, capabilityStatus: [] })
}

