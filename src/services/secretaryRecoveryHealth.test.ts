import { describe, expect, it } from 'vitest'
import type { SecretaryLedgerTask } from './secretaryLedgerClient'
import {
  RECOVERY_CHECKPOINT_FRESHNESS_MS,
  assessSecretaryRecovery,
  buildSecretaryRecoveryInstruction,
  type SecretaryRecoveryCheckpoint,
} from './secretaryRecoveryHealth'

const now = 1_780_000_000_000

function task(patch: Partial<SecretaryLedgerTask> = {}): SecretaryLedgerTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    title: '整理访谈摘要',
    request: '整理访谈摘要并起草邮件。',
    status: 'queued',
    priority: 3,
    scheduleAt: null,
    nextStep: '先整理访谈资料。',
    publicPlan: null,
    summary: null,
    createdAt: now - 1_000,
    updatedAt: now - 1_000,
    ...patch,
  }
}

function checkpoint(patch: Partial<SecretaryRecoveryCheckpoint> = {}): SecretaryRecoveryCheckpoint {
  return {
    createdAt: now - 1_000,
    phase: 'planning',
    projectId: 'project-1',
    ...patch,
  }
}

describe('secretary recovery health', () => {
  it('allows an explicitly queued task to start only after the user clicks continue', () => {
    expect(assessSecretaryRecovery({ task: task(), checkpoint: undefined, currentProjectId: 'project-1', now })).toMatchObject({
      state: 'ready',
      code: 'ready',
    })
  })

  it('requires review for an interrupted running task even with a fresh checkpoint', () => {
    expect(assessSecretaryRecovery({ task: task({ status: 'running' }), checkpoint: checkpoint(), currentProjectId: 'project-1', now })).toMatchObject({
      state: 'requires_review',
      code: 'interrupted_run',
    })
  })

  it('expires an old approval instead of offering to replay it', () => {
    const health = assessSecretaryRecovery({
      task: task({ status: 'awaiting_approval' }),
      checkpoint: checkpoint({ phase: 'awaiting_approval' }),
      currentProjectId: 'project-1',
      now,
    })

    expect(health).toMatchObject({ state: 'requires_review', code: 'approval_expired' })
    expect(buildSecretaryRecoveryInstruction(health)).toContain('旧审批、预览、授权和工具状态均已失效')
  })

  it('expires an approval checkpoint even when an interrupted task was later marked paused', () => {
    expect(assessSecretaryRecovery({
      task: task({ status: 'paused' }),
      checkpoint: checkpoint({ phase: 'awaiting_approval' }),
      currentProjectId: 'project-1',
      now,
    })).toMatchObject({
      state: 'requires_review',
      code: 'approval_expired',
    })
  })

  it('keeps a reconciled recovery checkpoint behind review after an app restart', () => {
    expect(assessSecretaryRecovery({
      task: task({ status: 'paused' }),
      checkpoint: checkpoint({ phase: 'recovery_review_required' }),
      currentProjectId: 'project-1',
      now,
    })).toMatchObject({
      state: 'requires_review',
      code: 'interrupted_run',
    })
  })

  it('requires re-planning for a paused task without a checkpoint or with a stale one', () => {
    expect(assessSecretaryRecovery({ task: task({ status: 'paused' }), checkpoint: undefined, currentProjectId: 'project-1', now })).toMatchObject({
      state: 'requires_review',
      code: 'checkpoint_missing',
    })
    expect(assessSecretaryRecovery({
      task: task({ status: 'paused' }),
      checkpoint: checkpoint({ createdAt: now - RECOVERY_CHECKPOINT_FRESHNESS_MS - 1 }),
      currentProjectId: 'project-1',
      now,
    })).toMatchObject({ state: 'requires_review', code: 'checkpoint_stale' })
  })

  it('blocks a record whose checkpoint belongs to another project', () => {
    expect(assessSecretaryRecovery({
      task: task({ status: 'paused' }),
      checkpoint: checkpoint({ projectId: 'project-2' }),
      currentProjectId: 'project-1',
      now,
    })).toMatchObject({ state: 'blocked', code: 'project_mismatch' })
  })

  it('marks terminal records as not resumable', () => {
    expect(assessSecretaryRecovery({ task: task({ status: 'completed' }), checkpoint: checkpoint(), currentProjectId: 'project-1', now })).toMatchObject({
      state: 'blocked',
      code: 'not_resumable',
    })
  })
})
