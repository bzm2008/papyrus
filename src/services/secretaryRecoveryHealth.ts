import type { SecretaryLedgerTask, SecretaryLedgerTaskStatus } from './secretaryLedgerClient'

/**
 * Native approvals expire after ten minutes. Treat an equally old checkpoint
 * as stale so a resumed task must re-observe the real world before acting.
 */
export const RECOVERY_CHECKPOINT_FRESHNESS_MS = 10 * 60 * 1_000

export type SecretaryRecoveryCheckpoint = {
  createdAt: number
  phase?: string
  projectId?: string
}

export type SecretaryRecoveryHealthState = 'ready' | 'requires_review' | 'blocked'

export type SecretaryRecoveryHealthCode =
  | 'ready'
  | 'interrupted_run'
  | 'approval_expired'
  | 'checkpoint_missing'
  | 'checkpoint_stale'
  | 'project_mismatch'
  | 'not_resumable'

export type SecretaryRecoveryHealth = {
  state: SecretaryRecoveryHealthState
  code: SecretaryRecoveryHealthCode
  message: string
}

export function assessSecretaryRecovery(input: {
  task: Pick<SecretaryLedgerTask, 'status'>
  checkpoint?: SecretaryRecoveryCheckpoint
  currentProjectId: string
  now?: number
}): SecretaryRecoveryHealth {
  const now = input.now ?? Date.now()
  const checkpoint = input.checkpoint

  if (checkpoint?.projectId && checkpoint.projectId !== input.currentProjectId) {
    return health('blocked', 'project_mismatch', '这份恢复记录不属于当前项目，已阻止继续。')
  }

  if (!isResumableStatus(input.task.status)) {
    return health('blocked', 'not_resumable', '该任务已经结束，不能作为恢复任务继续。')
  }

  if (input.task.status === 'awaiting_approval') {
    return health('requires_review', 'approval_expired', '上次等待的确认已失效，需要重新核对并生成新的预览。')
  }

  if (input.task.status === 'running') {
    return health('requires_review', 'interrupted_run', '上次任务未正常结束，恢复前需要核对当前状态。')
  }

  if (checkpoint?.phase === 'awaiting_approval') {
    return health('requires_review', 'approval_expired', '上次等待的确认已失效，需要重新核对并生成新的预览。')
  }

  if (checkpoint?.phase === 'recovery_review_required') {
    return health('requires_review', 'interrupted_run', '任务曾在应用退出或中断时暂停，恢复前需要重新核对当前状态。')
  }

  // A newly queued task has not executed yet. It remains user-started only,
  // but does not need a recovery checkpoint simply to begin.
  if (input.task.status === 'queued') {
    return health('ready', 'ready', '任务尚未开始，等待你确认开始。')
  }

  if (!checkpoint) {
    return health('requires_review', 'checkpoint_missing', '没有可验证的检查点，需要重新规划后继续。')
  }

  if (!isFreshCheckpoint(checkpoint.createdAt, now)) {
    return health('requires_review', 'checkpoint_stale', '保存时间较早，需要先重新核对项目资料和当前状态。')
  }

  return health('ready', 'ready', '检查点仍有效，等待你确认继续。')
}

export function buildSecretaryRecoveryInstruction(health: SecretaryRecoveryHealth) {
  if (health.state === 'blocked') {
    return '这条记录无法安全恢复。请保留原记录作为参考，并在需要时新建任务。'
  }

  if (health.state === 'requires_review') {
    return [
      '这是一次中断后的恢复，不得直接重放上次操作。',
      '旧审批、预览、授权和工具状态均已失效；先重新观察当前项目、文件、窗口或页面状态。',
      '请先重建公开计划。任何写入、启动应用、终端、浏览器提交或下载动作都必须重新生成预览并取得新的单次确认。',
    ].join('\n')
  }

  return '请先核对当前项目资料和已验证记忆，再从已保存的下一步继续。旧工具状态不得视为仍然有效。'
}

function health(
  state: SecretaryRecoveryHealthState,
  code: SecretaryRecoveryHealthCode,
  message: string,
): SecretaryRecoveryHealth {
  return { state, code, message }
}

function isResumableStatus(status: SecretaryLedgerTaskStatus) {
  return status === 'queued' || status === 'running' || status === 'awaiting_approval' || status === 'paused'
}

function isFreshCheckpoint(createdAt: number, now: number) {
  return Number.isSafeInteger(createdAt)
    && createdAt >= 0
    && createdAt <= now
    && now - createdAt <= RECOVERY_CHECKPOINT_FRESHNESS_MS
}
