import type { WorkAssistantRun } from './workAssistantProtocol'
import type { LlmRunState, SecretaryGoal } from '../stores/useAppStore'
import {
  mascotApprovalFromToolCall,
  sanitizeMascotPayload,
  sanitizeMascotText,
  type MascotAction,
  type MascotCommand,
  type MascotGoalSummary,
  type MascotMood,
  type MascotProgress,
  type MascotSnapshot,
  type MascotSnapshotInput,
} from './mascotProtocol'

const runningToolStatuses = new Set(['queued', 'running', 'awaiting_approval'])
const runningSubagentStatuses = new Set(['queued', 'running'])

export function getMascotSnapshot(input: MascotSnapshotInput): MascotSnapshot {
  const run = input.workAssistantRun ?? input.run
  const goal = input.activeGoal ?? input.goal
  const approval = findApproval(run)
  const activeToolCount = run
    ? Object.values(run.toolCalls).filter((toolCall) => runningToolStatuses.has(toolCall.status)).length
    : 0
  const activeSubagentCount = run
    ? Object.values(run.subagents).filter((subagent) => runningSubagentStatuses.has(subagent.status)).length
    : 0
  const progress = getProgress(run)
  const goalSummary = toGoalSummary(goal)
  const actions = buildActions(input, run, approval, goal)
  const state = deriveState(input.llmRunState, input.llmStatusMessage, run, approval, goal, input.now, input.idleSince)
  const safePayload = sanitizeMascotPayload(input.payload)

  return {
    mood: state.mood,
    status: state.mood,
    label: state.label,
    message: state.message,
    ...(state.detail ? { detail: state.detail } : {}),
    ...(run?.id ? { runId: run.id } : {}),
    ...(run?.stage ? { stage: sanitizeMascotText(run.stage, '正在处理', 180) } : {}),
    ...(progress ? { progress } : {}),
    activeToolCount,
    activeSubagentCount,
    ...(approval ? { approval } : {}),
    ...(goalSummary ? { goal: goalSummary } : {}),
    actions,
    name: '铭荼',
    action: toMascotAction(state.mood),
    statusText: state.message,
    updatedAt: input.now ?? Date.now(),
    ...(isRecordPayload(safePayload) ? { payload: safePayload } : {}),
  }
}

function findApproval(run: WorkAssistantRun | undefined) {
  if (!run?.pendingApprovalId) return undefined
  return mascotApprovalFromToolCall(
    Object.values(run.toolCalls).find((toolCall) => toolCall.preview?.id === run.pendingApprovalId),
  )
}

function getProgress(run: WorkAssistantRun | undefined): MascotProgress | undefined {
  if (!run) return undefined
  const calls = Object.values(run.toolCalls)
  const total = calls.length
  if (!total) return undefined
  const completed = calls.filter((call) => ['completed', 'failed', 'cancelled'].includes(call.status)).length
  return { completed, total, percent: Math.round((completed / total) * 100) }
}

function toGoalSummary(goal: SecretaryGoal | undefined): MascotGoalSummary | undefined {
  if (!goal) return undefined
  return {
    id: sanitizeMascotText(goal.id, 'goal', 120),
    title: sanitizeMascotText(goal.title, '秘书目标', 160),
    status: goal.status,
    progress: sanitizeMascotText(goal.currentProgress, '目标已建立。', 180),
  }
}

function buildActions(
  input: MascotSnapshotInput,
  run: WorkAssistantRun | undefined,
  approval: ReturnType<typeof mascotApprovalFromToolCall>,
  goal: SecretaryGoal | undefined,
): MascotCommand[] {
  const actions: MascotCommand[] = []
  const runId = run?.id

  if (approval && runId) {
    const approvalId = approval.id
    if (approval.allowedChoices.includes('once')) {
      actions.push({
        id: `approve:${approvalId}`,
        type: 'approve_tool',
        label: '允许一次',
        description: '仅允许当前这一次受控操作。',
        enabled: true,
        runId,
        approvalId,
        choice: 'once',
      })
    }
    if (approval.allowedChoices.includes('run')) {
      actions.push({
        id: `approve-run:${approvalId}`,
        type: 'approve_tool',
        label: '本轮允许',
        description: '允许当前任务在同一授权范围内继续。',
        enabled: true,
        runId,
        approvalId,
        choice: 'run',
      })
    }
    actions.push({
      id: `deny:${approvalId}`,
      type: 'deny_tool',
      label: '拒绝',
      description: '阻止这次受控操作。',
      enabled: true,
      runId,
      approvalId,
      choice: 'deny',
    })
  }

  if (runId && (run?.status === 'running' || run?.status === 'awaiting_approval')) {
    actions.push({
      id: `cancel:${runId}`,
      type: 'cancel_run',
      label: '停止',
      description: '取消当前秘书运行并保存已有结果。',
      enabled: true,
      runId,
    })
  }

  if (runId && (run?.status === 'failed' || run?.status === 'cancelled')) {
    actions.push({
      id: `retry:${runId}`,
      type: 'retry_run',
      label: '重试',
      description: '保留原请求和上下文后重新运行。',
      enabled: true,
      runId,
    })
  }

  if (runId && (run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled')) {
    actions.push({
      id: `open-workbench:${runId}`,
      type: 'open_workbench',
      label: '查看工作台',
      description: '打开本轮工具、审批和检查点详情。',
      enabled: true,
      runId,
      view: 'run',
    })
  }

  if (goal?.status === 'active' && !runId && input.llmRunState !== 'running') {
    actions.push({
      id: `pause-goal:${goal.id}`,
      type: 'pause_goal',
      label: '暂停目标',
      description: '保存当前目标进度，稍后继续。',
      enabled: true,
    })
  } else if (goal?.status === 'paused') {
    actions.push({
      id: `resume-goal:${goal.id}`,
      type: 'resume_goal',
      label: '继续目标',
      description: '从最近检查点恢复目标。',
      enabled: true,
    })
  }

  return actions
}

function toMascotAction(mood: MascotMood): MascotAction {
  if (mood === 'collaborating' || mood === 'reconnecting') return 'thinking'
  if (mood === 'error' || mood === 'blocked') return mood === 'blocked' ? 'awaiting_approval' : 'failed'
  if (mood === 'cancelled') return 'paused'
  return mood
}

function deriveState(
  llmRunState: LlmRunState,
  llmStatusMessage: string | undefined,
  run: WorkAssistantRun | undefined,
  approval: ReturnType<typeof mascotApprovalFromToolCall>,
  goal: SecretaryGoal | undefined,
  now?: number,
  idleSince?: number,
): { mood: MascotMood; label: string; message: string; detail?: string } {
  if (approval && run) {
    return {
      mood: 'awaiting_approval',
      label: '等待确认',
      message: approval.title,
      detail: approval.reason,
    }
  }

  if (run?.status === 'failed' || llmRunState === 'error') {
    return {
      mood: 'error',
      label: '需要处理',
      message: '本轮没有完成，可以检查工作台后重试。',
      detail: sanitizeMascotText(llmStatusMessage, '请检查网络、模型或受控工具状态。', 180),
    }
  }

  if (run?.status === 'cancelled') {
    return { mood: 'cancelled', label: '已取消', message: '本轮已停止，已有结果已保留。' }
  }

  if (run?.status === 'completed' && (!now || now - run.lastActivityAt < 5000)) {
    return { mood: 'completed', label: '已完成', message: '本轮秘书任务已经完成。' }
  }

  if (llmRunState === 'reconnecting') {
    return { mood: 'reconnecting', label: '恢复连接', message: '连接暂时中断，正在保留当前进度。' }
  }

  if (run?.status === 'running') {
    if (Object.values(run.subagents).some((subagent) => subagent.status === 'running')) {
      return { mood: 'collaborating', label: '正在协作', message: '秘书长正在协调专长 Agent。' }
    }
    if (Object.values(run.toolCalls).some((toolCall) => toolCall.status === 'running')) {
      return { mood: 'working', label: '正在处理', message: '秘书长正在使用受控工具处理任务。' }
    }
    return { mood: 'thinking', label: '正在思考', message: '秘书长正在整理目标和下一步。' }
  }

  if (goal?.status === 'blocked') {
    return { mood: 'blocked', label: '需要决定', message: '长程目标遇到阻塞，请查看检查点。' }
  }

  if (goal?.status === 'paused') {
    return { mood: 'paused', label: '目标已暂停', message: '目标进度已保存，可以从检查点继续。' }
  }

  if (goal?.status === 'active') {
    return { mood: 'working', label: '目标进行中', message: sanitizeMascotText(goal.currentProgress, '长程目标已建立。', 180) }
  }

  if (llmRunState === 'running') {
    return { mood: 'thinking', label: '正在思考', message: '秘书长正在准备答复。' }
  }

  if (idleSince !== undefined && now !== undefined && now - idleSince >= 45_000) {
    return { mood: 'dazed', label: '发呆中', message: '我在这里，等你下一件想做的事。' }
  }

  return { mood: 'idle', label: '随时待命', message: '可以开始写作、研究、沟通或整理。' }
}

function isRecordPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
