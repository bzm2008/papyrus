import type { AssistantApprovalChoice, AssistantApprovalRequest, AssistantToolCall, AssistantToolResult } from './workAssistantProtocol'

type ToolResultEntry = {
  call: Pick<AssistantToolCall, 'name'>
  result: AssistantToolResult
}

export const MAX_TRANSIENT_MODEL_SOURCE_CHARS = 48_000
const MAX_SOURCE_ITEMS = 64
const MAX_SOURCE_DEPTH = 4

const sensitiveKeyPattern = /password|passwd|passcode|secret|token|authorization|cookie|session|credential|api[_-]?key|private[_-]?key|otp|verification|captcha|payment|card|cvv|cvc|bank|routing|account(?:number)?|\u5bc6\u7801|\u9a8c\u8bc1\u7801|\u652f\u4ed8|\u94f6\u884c/i
const receiptContentKeyPattern = /^(?:text|body|html|content|value|form|page|document|source|payload)$/i
const browserSensitiveElementPattern = /password|passwd|pwd|captcha|\u9a8c\u8bc1\u7801|payment|credit|card|bank|routing|account|otp|security|\u652f\u4ed8|\u94f6\u884c|\u5b89\u5168/i
const publicErrorCodes = new Set([
  'blocked',
  'browser_disconnected',
  'cancel_failed',
  'cancelled',
  'capability_unavailable',
  'loop_guard',
  'network',
  'page_restricted',
  'partial_transaction',
  'path_outside_workspace',
  'request_uncertain',
  'response_too_large',
  'run_ended',
  'stale_page',
  'stale_preview',
  'terminal_failed',
  'timeout',
  'tool_failed',
  'unsupported_content_type',
])
const publicErrorSummaries: Record<string, string> = {
  blocked: '该操作被安全策略阻止。',
  browser_disconnected: '浏览器未连接，请先配对当前标签页。',
  cancel_failed: '操作已取消，但停止状态尚未完全确认。',
  cancelled: '操作已取消。',
  capability_unavailable: '当前设备暂不支持此工具。',
  loop_guard: '相同工具请求连续失败，已停止自动重试。',
  network: '网络暂不可用，请检查连接后重试。',
  page_restricted: '当前页面受安全限制，无法继续操作。',
  partial_transaction: '部分操作未完成，请检查结果后重试。',
  path_outside_workspace: '请求目标不在已授权工作区内。',
  request_uncertain: '操作结果尚未确认，请检查后再决定是否重试。',
  response_too_large: '响应内容过大，已停止读取。',
  run_ended: '运行已结束，已忽略待处理操作。',
  stale_page: '页面已经变化，请重新获取快照。',
  stale_preview: '预览已过期，请重新生成。',
  terminal_failed: '受控文档工具未能完成。',
  timeout: '操作超时，请稍后重试。',
  tool_failed: '工具未完成，请检查后重试。',
  unsupported_content_type: '内容类型不受支持。',
}
const publicApprovalChoices = new Set<AssistantApprovalChoice>(['once', 'run', 'deny'])
const publicBrowserActions = new Set(['navigate', 'fillDraft', 'click', 'download', 'submit'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, limit: number) {
  return typeof value === 'string' ? value.split(String.fromCharCode(0)).join('').slice(0, limit) : undefined
}

function boundedNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safeOrigin(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

function hasOwnKeys(value: Record<string, unknown>) {
  return Object.keys(value).length > 0
}

function safeIdentifiers(value: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const key of ['previewId', 'snapshotId', 'pageRevision', 'extractId', 'rootId'] as const) {
    const item = boundedString(value[key], 160)
    if (item) result[key] = item
  }
  return result
}

function safePublicSummary(ok: boolean, errorCode?: string) {
  if (ok) return '受控工具已完成。'
  return errorCode ? publicErrorSummaries[errorCode] ?? '受控工具未完成。' : '受控工具未完成。'
}

function safePublicErrorCode(value: unknown) {
  const code = boundedString(value, 96)
  return code && publicErrorCodes.has(code) ? code : 'tool_failed'
}

function safeApprovalReason(toolName: string) {
  if (toolName === 'web_archive') return '归档研究资料前需要确认。'
  if (toolName === 'file_apply_batch') return '文件操作需要确认。'
  if (toolName === 'terminal_pdf_to_text' || toolName === 'terminal_document_to_text') {
    return '受控文档提取需要确认。'
  }
  if (toolName.startsWith('browser_')) return '浏览器操作需要确认。'
  return '该受控工具需要用户确认。'
}

function safeApprovalTarget(toolName: string, request: AssistantApprovalRequest) {
  const origin = safeOrigin(request.origin) ?? safeOrigin(request.targetSummary)
  if (toolName.startsWith('browser_')) return origin ?? '当前已配对页面'

  const target = boundedString(request.targetSummary, 240)?.trim()
  if (!target || sensitiveKeyPattern.test(target) || /bearer\s|authorization\s*[:=]|[?&](?:token|key|code)=/i.test(target)) {
    return '已授权目标'
  }
  return target
}

function safeModelDataHandling(value: unknown) {
  if (!isRecord(value)) return undefined
  const provider = boundedString(value.provider, 96)?.trim()
  const maxChars = boundedNumber(value.maxChars)
  if (
    !provider ||
    sensitiveKeyPattern.test(provider) ||
    maxChars === undefined ||
    !Number.isSafeInteger(maxChars) ||
    maxChars < 1 ||
    maxChars > MAX_TRANSIENT_MODEL_SOURCE_CHARS
  ) {
    return undefined
  }
  return { provider, maxChars }
}

function safeBrowserElements(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .filter((element) => !browserSensitiveElementPattern.test(`${element.inputType ?? ''} ${element.name ?? ''}`))
    .slice(0, MAX_SOURCE_ITEMS)
    .map((element) => {
      const item: Record<string, unknown> = {}
      for (const key of ['token', 'role', 'name', 'inputType'] as const) {
        const text = boundedString(element[key], key === 'name' ? 240 : 128)
        if (text) item[key] = text
      }
      if (typeof element.hasValue === 'boolean') item.hasValue = element.hasValue
      if (typeof element.disabled === 'boolean') item.disabled = element.disabled
      return item
    })
    .filter(hasOwnKeys)
}

function safeReceiptData(toolName: string, value: unknown): Record<string, unknown> | undefined {
  if (toolName === 'workspace_list' && Array.isArray(value)) {
    return {
      roots: value
        .filter(isRecord)
        .slice(0, MAX_SOURCE_ITEMS)
        .map((item) => ({
          id: boundedString(item.id, 160),
          label: boundedString(item.label, 240),
          kind: boundedString(item.kind, 64),
        }))
        .map((item) => Object.fromEntries(Object.entries(item).filter(([, field]) => field !== undefined))),
    }
  }

  if (!isRecord(value)) return undefined
  const identifiers = safeIdentifiers(value)

  if (toolName === 'desktop_status') {
    const disks = Array.isArray(value.disks)
      ? value.disks.filter(isRecord).slice(0, 16).map((disk) => ({
          totalBytes: boundedNumber(disk.totalBytes),
          availableBytes: boundedNumber(disk.availableBytes),
        }))
      : []
    const result = {
      platform: boundedString(value.platform, 32),
      cpuCount: boundedNumber(value.cpuCount),
      cpuUsagePercent: boundedNumber(value.cpuUsagePercent),
      memoryTotalBytes: boundedNumber(value.memoryTotalBytes),
      memoryUsedBytes: boundedNumber(value.memoryUsedBytes),
      disks,
    }
    return Object.fromEntries(Object.entries(result).filter(([, field]) => field !== undefined))
  }

  if (toolName === 'terminal_pdf_to_text' || toolName === 'terminal_document_to_text') {
    const result = {
      ...identifiers,
      command: toolName,
      outputChars: boundedNumber(value.outputChars),
      truncated: value.truncated === true,
      auditRecorded: value.auditRecorded === true,
    }
    return Object.fromEntries(Object.entries(result).filter(([, field]) => field !== undefined))
  }

  if (toolName === 'browser_snapshot') {
    const result = {
      ...identifiers,
      origin: safeOrigin(value.origin) ?? safeOrigin(value.url),
      sensitive: value.sensitive === true,
      restricted: value.restricted === true,
      elementCount: Array.isArray(value.elements) ? Math.min(value.elements.length, MAX_SOURCE_ITEMS) : 0,
    }
    return Object.fromEntries(Object.entries(result).filter(([, field]) => field !== undefined))
  }

  if (toolName === 'web_extract') {
    const result = {
      ...identifiers,
      origin: safeOrigin(value.url) ?? safeOrigin(value.canonicalUrl),
      truncated: value.truncated === true,
      linkCount: Array.isArray(value.links) ? Math.min(value.links.length, MAX_SOURCE_ITEMS) : 0,
    }
    return Object.fromEntries(Object.entries(result).filter(([, field]) => field !== undefined))
  }

  if (toolName === 'file_apply_batch') {
    const result = {
      ...identifiers,
      completedCount: Array.isArray(value.completed) ? value.completed.length : 0,
      skippedCount: Array.isArray(value.skipped) ? value.skipped.length : 0,
      failedCount: Array.isArray(value.failed) ? value.failed.length : 0,
      remainingCount: Array.isArray(value.remaining) ? value.remaining.length : 0,
      cancelled: value.cancelled === true,
    }
    return Object.fromEntries(Object.entries(result).filter(([, field]) => field !== undefined))
  }

  const result: Record<string, unknown> = { ...identifiers }
  for (const key of ['count', 'itemCount', 'outputChars'] as const) {
    const number = boundedNumber(value[key])
    if (number !== undefined) result[key] = number
  }
  for (const key of ['truncated', 'cancelled', 'degraded'] as const) {
    if (typeof value[key] === 'boolean') result[key] = value[key]
  }
  return hasOwnKeys(result) ? result : undefined
}

function isSensitiveSourceKey(key: string) {
  return sensitiveKeyPattern.test(key) || receiptContentKeyPattern.test(key) || /formAction/i.test(key)
}

function boundedSourceValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_SOURCE_DEPTH) return undefined
  if (typeof value === 'string') return boundedString(value, MAX_TRANSIENT_MODEL_SOURCE_CHARS)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_SOURCE_ITEMS)
      .map((item) => boundedSourceValue(item, depth + 1))
      .filter((item) => item !== undefined)
  }
  if (!isRecord(value)) return undefined

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, MAX_SOURCE_ITEMS)) {
    if (isSensitiveSourceKey(key)) continue
    const next = boundedSourceValue(item, depth + 1)
    if (next !== undefined) result[key] = next
  }
  return hasOwnKeys(result) ? result : undefined
}

export function createTransientToolSource(toolName: string, value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined

  if (toolName === 'terminal_pdf_to_text' || toolName === 'terminal_document_to_text') {
    const text = boundedString(value.text, MAX_TRANSIENT_MODEL_SOURCE_CHARS)
    if (!text) return undefined
    return {
      kind: 'terminal_document',
      command: toolName,
      outputChars: boundedNumber(value.outputChars),
      truncated: value.truncated === true,
      text,
    }
  }

  if (toolName === 'browser_snapshot') {
    if (value.sensitive === true || value.restricted === true) {
      return {
        kind: 'browser_snapshot',
        restricted: true,
        snapshotId: boundedString(value.snapshotId, 160),
        pageRevision: boundedString(value.pageRevision, 160),
      }
    }
    const result = {
      kind: 'browser_snapshot',
      snapshotId: boundedString(value.snapshotId, 160),
      pageRevision: boundedString(value.pageRevision, 160),
      origin: safeOrigin(value.origin) ?? safeOrigin(value.url),
      text: boundedString(value.textSummary ?? value.text, 12_000),
      elements: safeBrowserElements(value.elements),
    }
    return Object.fromEntries(Object.entries(result).filter(([, field]) => field !== undefined))
  }

  if (toolName === 'web_extract') {
    const text = boundedString(value.text, MAX_TRANSIENT_MODEL_SOURCE_CHARS)
    if (!text) return undefined
    const result = {
      kind: 'web_extract',
      extractId: boundedString(value.extractId, 160),
      origin: safeOrigin(value.url) ?? safeOrigin(value.canonicalUrl),
      title: boundedString(value.title, 320),
      truncated: value.truncated === true,
      text,
    }
    return Object.fromEntries(Object.entries(result).filter(([, field]) => field !== undefined))
  }

  if (['workspace_scan', 'file_search', 'file_inspect', 'downloads_scan'].includes(toolName)) {
    const source = boundedSourceValue(value)
    return isRecord(source) ? source : undefined
  }

  return undefined
}

export function toPublicAssistantToolResult(toolName: string, result: AssistantToolResult): AssistantToolResult {
  const data = safeReceiptData(toolName, result.data)
  const errorCode = result.errorCode ? safePublicErrorCode(result.errorCode) : undefined
  return {
    ok: result.ok,
    summary: safePublicSummary(result.ok, errorCode),
    ...(errorCode ? { errorCode } : {}),
    ...(typeof result.recoverable === 'boolean' ? { recoverable: result.recoverable } : {}),
    ...(data ? { data } : {}),
  }
}

export function toPublicAssistantToolCall(call: AssistantToolCall): AssistantToolCall {
  const argumentsValue: Record<string, unknown> = {}
  for (const key of ['rootId', 'previewId', 'snapshotId', 'pageRevision', 'elementToken', 'extractId', 'appId', 'directoryRootId', 'conflictPolicy'] as const) {
    const value = boundedString(call.arguments[key], 160)
    if (value) argumentsValue[key] = value
  }
  const endedAt = boundedNumber(call.endedAt)
  return {
    id: boundedString(call.id, 160) ?? 'tool-call',
    runId: boundedString(call.runId, 160) ?? 'run',
    name: boundedString(call.name, 128) ?? 'controlled_tool',
    // Intent is model-generated text. The public event carries only the
    // validated tool identifier, never the model's original note.
    intent: boundedString(call.name, 128) ?? 'controlled_tool',
    arguments: argumentsValue,
    status: call.status,
    startedAt: boundedNumber(call.startedAt) ?? 0,
    ...(endedAt !== undefined ? { endedAt } : {}),
  }
}

export function toPublicAssistantApprovalRequest(
  request: AssistantApprovalRequest,
  toolName: string,
): AssistantApprovalRequest {
  const allowedChoices = request.allowedChoices.filter((choice) => publicApprovalChoices.has(choice))
  const safeToolName = boundedString(toolName, 128) ?? 'controlled_tool'
  const action = boundedString(request.action, 32)
  const origin = safeOrigin(request.origin)
  const modelDataHandling = safeModelDataHandling(request.modelDataHandling)
  const result: AssistantApprovalRequest = {
    id: boundedString(request.id, 160) ?? 'approval',
    revision: boundedString(request.revision, 160) ?? 'revision',
    risk: request.risk,
    title: `受控工具：${safeToolName}`,
    targetSummary: safeApprovalTarget(safeToolName, request),
    impactSummary: '此受控工具需要确认后执行。',
    reversible: request.reversible === true,
    expiresAt: boundedNumber(request.expiresAt) ?? 0,
    runId: boundedString(request.runId, 160) ?? 'run',
    toolCallId: boundedString(request.toolCallId, 160) ?? 'tool-call',
    reason: safeApprovalReason(safeToolName),
    allowedChoices: allowedChoices.length ? allowedChoices : ['deny'],
  }
  if (action && publicBrowserActions.has(action)) result.action = action
  if (origin) result.origin = origin
  if (modelDataHandling) result.modelDataHandling = modelDataHandling
  return result
}

export function createToolReceipt(toolName: string, result: AssistantToolResult) {
  const publicResult = toPublicAssistantToolResult(toolName, result)
  return {
    tool: toolName,
    ok: publicResult.ok,
    summary: publicResult.summary,
    ...(publicResult.errorCode ? { errorCode: publicResult.errorCode } : {}),
    ...(typeof publicResult.recoverable === 'boolean' ? { recoverable: publicResult.recoverable } : {}),
    ...(publicResult.data ? { data: publicResult.data } : {}),
  }
}

export function serializeToolReceipts(results: ToolResultEntry[]) {
  return results.map(({ call, result }) => JSON.stringify(createToolReceipt(call.name, result))).join('\n')
}

export function createTransientToolContext(call: Pick<AssistantToolCall, 'name'>, result: AssistantToolResult) {
  const receipt = createToolReceipt(call.name, result)
  const source = createTransientToolSource(call.name, result.data)
  return source ? { ...receipt, source } : receipt
}

export function serializeTransientToolContexts(results: ToolResultEntry[]) {
  return results.map(({ call, result }) => JSON.stringify(createTransientToolContext(call, result))).join('\n')
}
