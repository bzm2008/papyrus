import type {
  AssistantApprovalChoice,
  AssistantToolCall,
  WorkAssistantRun,
} from './workAssistantProtocol'
import type { LlmRunState, SecretaryGoal, SecretaryGoalStatus } from '../stores/useAppStore'

/** Stable action names exposed to the mascot window. */
export type MascotAction =
  | 'idle'
  | 'dazed'
  | 'thinking'
  | 'working'
  | 'awaiting_approval'
  | 'failed'
  | 'completed'
  | 'paused'

/** Internal presentation states retained for richer desktop feedback. */
export type MascotMood = MascotAction | 'collaborating' | 'reconnecting' | 'error' | 'cancelled' | 'blocked'

export type MascotActionType =
  | 'cancel_run'
  | 'pause_run'
  | 'retry_run'
  | 'approve_tool'
  | 'deny_tool'
  | 'open_workbench'
  | 'pause_goal'
  | 'resume_goal'

/** A declarative command. The UI executes it through the existing run controller. */
export type MascotCommand = {
  id: string
  type: MascotActionType
  label: string
  description?: string
  enabled: boolean
  runId?: string
  approvalId?: string
  choice?: AssistantApprovalChoice
  view?: string
}

export type MascotProgress = {
  completed: number
  total: number
  percent: number
}

export type MascotApprovalSummary = {
  id: string
  toolCallId: string
  title: string
  reason: string
  targetSummary: string
  risk: string
  allowedChoices: AssistantApprovalChoice[]
}

export type MascotGoalSummary = {
  id: string
  title: string
  status: SecretaryGoalStatus
  progress: string
}

export type MascotSnapshot = {
  name: '铭荼'
  action: MascotAction
  statusText: string
  updatedAt: number
  mood: MascotMood
  /** Alias for consumers that prefer a status field over a mood field. */
  status: MascotMood
  label: string
  message: string
  detail?: string
  runId?: string
  stage?: string
  progress?: MascotProgress
  activeToolCount: number
  activeSubagentCount: number
  approval?: MascotApprovalSummary
  goal?: MascotGoalSummary
  actions: MascotCommand[]
  payload?: Record<string, unknown>
}

export const MASCOT_EVENT_READY = 'mascot-ready'
export const MASCOT_EVENT_STATE = 'mascot-state'
export const MASCOT_EVENT_OPEN_MAIN = 'mascot-open-main'
export const MASCOT_EVENT_HIDE = 'mascot-hide'

export type MascotSnapshotInput = {
  llmRunState: LlmRunState
  llmStatusMessage?: string
  /** Either property is accepted so callers can pass their existing selector name. */
  workAssistantRun?: WorkAssistantRun
  run?: WorkAssistantRun
  activeGoal?: SecretaryGoal
  goal?: SecretaryGoal
  payload?: unknown
  now?: number
  idleSince?: number
}

export type MascotSanitizeOptions = {
  maxDepth?: number
  maxEntries?: number
  maxStringChars?: number
}

/**
 * Keys that must never be copied into a mascot payload. The payload is for a
 * small status bubble, not an audit log or a model context, so dropping a field
 * is safer than replacing it with a partially redacted value.
 */
export const MASCOT_SENSITIVE_KEY_PATTERN = /password|passwd|passcode|secret|token|authorization|cookie|session|credential|api[_-]?key|private[_-]?key|otp|verification|captcha|payment|card|cvv|cvc|bank|routing|account(?:number)?|bearer|密码|验证码|支付|银行卡|令牌|凭证|密钥/i
const MASCOT_CONTENT_KEY_PATTERN = /^(?:value|content|body|html|text|source|form|page)$/i
const MASCOT_SENSITIVE_VALUE_PATTERN = /银行卡|信用卡|密码|验证码|令牌|凭证|密钥|(?:password|passwd|secret|token|api[_-]?key)\s*[:=]|bearer\s|authorization\s*[:=]|(?:\d[ -]?){13,19}/i

const DEFAULT_MAX_DEPTH = 3
const DEFAULT_MAX_ENTRIES = 32
const DEFAULT_MAX_STRING_CHARS = 240

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown, maxStringChars: number) {
  if (typeof value !== 'string') return undefined
  return value
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
    .trim()
    .slice(0, maxStringChars)
}

export function sanitizeMascotText(value: unknown, fallback: string, maxChars = DEFAULT_MAX_STRING_CHARS) {
  const clean = cleanString(value, maxChars)
  return clean && !MASCOT_SENSITIVE_VALUE_PATTERN.test(clean) ? clean : fallback
}

/**
 * Bound and filter an arbitrary status payload before it reaches a UI surface.
 * Arrays and objects are capped independently at each level to keep this
 * helper deterministic even when a tool returns a very large structure.
 */
export function sanitizeMascotPayload(
  value: unknown,
  options: MascotSanitizeOptions = {},
): unknown {
  const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? DEFAULT_MAX_DEPTH))
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES))
  const maxStringChars = Math.max(1, Math.floor(options.maxStringChars ?? DEFAULT_MAX_STRING_CHARS))

  const visit = (current: unknown, depth: number): unknown => {
    if (depth > maxDepth) return undefined

    const text = cleanString(current, maxStringChars)
    if (text !== undefined) return MASCOT_SENSITIVE_VALUE_PATTERN.test(text) ? undefined : text
    if (typeof current === 'number') return Number.isFinite(current) ? current : undefined
    if (typeof current === 'boolean' || current === null) return current

    if (Array.isArray(current)) {
      return current
        .slice(0, maxEntries)
        .map((item) => visit(item, depth + 1))
        .filter((item) => item !== undefined)
    }

    if (!isRecord(current)) return undefined

    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(current).slice(0, maxEntries)) {
      if (MASCOT_SENSITIVE_KEY_PATTERN.test(key) || MASCOT_CONTENT_KEY_PATTERN.test(key)) continue
      const safeKey = cleanString(key, 96)
      if (!safeKey || MASCOT_SENSITIVE_KEY_PATTERN.test(safeKey)) continue
      const safeValue = visit(item, depth + 1)
      if (safeValue !== undefined) result[safeKey] = safeValue
    }
    return result
  }

  return visit(value, 0)
}

const MASCOT_MOODS: MascotMood[] = [
  'idle',
  'dazed',
  'thinking',
  'working',
  'collaborating',
  'awaiting_approval',
  'reconnecting',
  'completed',
  'failed',
  'error',
  'cancelled',
  'paused',
  'blocked',
]

/** Validate and bound event payloads before a secondary webview renders them. */
export function parseMascotSnapshot(value: unknown): MascotSnapshot | null {
  if (!isRecord(value) || typeof value.status !== 'string' || !MASCOT_MOODS.includes(value.status as MascotMood)) {
    return null
  }
  if (typeof value.message === 'string' && (MASCOT_SENSITIVE_VALUE_PATTERN.test(value.message) || /\b(?:token|secret|password|authorization)\b/i.test(value.message))) {
    return null
  }
  const safe = sanitizeMascotPayload(value, { maxDepth: 4, maxEntries: 24, maxStringChars: 240 })
  if (!isRecord(safe) || typeof safe.status !== 'string' || !MASCOT_MOODS.includes(safe.status as MascotMood)) return null
  const mood = safe.status as MascotMood
  const label = typeof safe.label === 'string' ? safe.label : '随时待命'
  const message = typeof safe.message === 'string' ? sanitizeMascotText(safe.message, '正在整理状态。', 240) : '可以开始写作、研究、沟通或整理。'
  const progress = isRecord(safe.progress) && typeof safe.progress.completed === 'number' && typeof safe.progress.total === 'number' && typeof safe.progress.percent === 'number'
    ? { completed: Math.max(0, Math.floor(safe.progress.completed)), total: Math.max(0, Math.floor(safe.progress.total)), percent: Math.max(0, Math.min(100, Math.floor(safe.progress.percent))) }
    : undefined
  return {
    name: '铭荼',
    action: mood === 'collaborating' || mood === 'reconnecting' ? 'thinking' : mood === 'error' ? 'failed' : mood === 'cancelled' ? 'paused' : mood === 'blocked' ? 'awaiting_approval' : mood as MascotAction,
    statusText: message,
    updatedAt: Date.now(),
    mood,
    status: mood,
    label: label.slice(0, 80),
    message: message.slice(0, 240),
    ...(typeof safe.detail === 'string' ? { detail: safe.detail.slice(0, 240) } : {}),
    ...(typeof safe.runId === 'string' ? { runId: safe.runId.slice(0, 100) } : {}),
    ...(typeof safe.stage === 'string' ? { stage: safe.stage.slice(0, 180) } : {}),
    ...(progress ? { progress } : {}),
    activeToolCount: typeof safe.activeToolCount === 'number' ? Math.max(0, Math.min(99, Math.floor(safe.activeToolCount))) : 0,
    activeSubagentCount: typeof safe.activeSubagentCount === 'number' ? Math.max(0, Math.min(99, Math.floor(safe.activeSubagentCount))) : 0,
    actions: [],
  }
}

export function toMascotEventSnapshot(snapshot: MascotSnapshot): MascotSnapshot {
  const safe = sanitizeMascotPayload(snapshot, { maxDepth: 4, maxEntries: 24, maxStringChars: 240 })
  return parseMascotSnapshot(safe) ?? {
    name: '铭荼',
    action: 'idle',
    statusText: '可以开始写作、研究、沟通或整理。',
    updatedAt: Date.now(),
    mood: 'idle',
    status: 'idle',
    label: '随时待命',
    message: '可以开始写作、研究、沟通或整理。',
    activeToolCount: 0,
    activeSubagentCount: 0,
    actions: [],
  }
}

/** Extract a safe, bounded summary from a reducer-owned tool call. */
export function mascotApprovalFromToolCall(
  toolCall: AssistantToolCall | undefined,
): MascotApprovalSummary | undefined {
  if (!toolCall?.preview) return undefined
  const preview = toolCall.preview as AssistantToolCall['preview'] & {
    allowedChoices?: unknown
    reason?: unknown
  }
  const allowedChoices = Array.isArray(preview.allowedChoices)
    ? preview.allowedChoices.filter((choice): choice is AssistantApprovalChoice =>
        choice === 'once' || choice === 'run' || choice === 'deny',
      )
    : ['once', 'deny'] as AssistantApprovalChoice[]

  return {
    id: preview.id,
    toolCallId: toolCall.id,
    title: sanitizeMascotText(preview.title, '受控操作需要确认', 120),
    reason: sanitizeMascotText(preview.reason, '该操作需要你的确认。', 180),
    targetSummary: sanitizeMascotText(preview.targetSummary, '已授权目标', 180),
    risk: sanitizeMascotText(preview.risk, 'reversible', 32),
    allowedChoices: allowedChoices.length ? allowedChoices : ['deny'],
  }
}
