import { describe, expect, it } from 'vitest'

import {
  assessComputerAction,
  isComputerObservationFresh,
  validateComputerActionReference,
  type ComputerActionReference,
  type ComputerObservation,
} from './computerUsePolicy'

const observation = (patch: Partial<ComputerObservation> = {}): ComputerObservation => ({
  id: 'observe-1',
  window: { appId: 'org.gnome.TextEditor', title: 'Notes', fingerprint: 'window-v1' },
  targets: [{ id: 'target-1', role: 'button', name: '保存', fingerprint: 'target-v1' }],
  expiresAt: 10_000,
  ...patch,
})

const reference = (patch: Partial<ComputerActionReference> = {}): ComputerActionReference => ({
  observationId: 'observe-1',
  windowFingerprint: 'window-v1',
  targetId: 'target-1',
  targetFingerprint: 'target-v1',
  ...patch,
})

describe('computer use policy', () => {
  it('accepts only a fresh observation bound to its current window and target', () => {
    expect(validateComputerActionReference(observation(), reference(), 9_999)).toEqual({ ok: true })
    expect(validateComputerActionReference(observation(), reference({ windowFingerprint: 'window-v2' }), 9_999))
      .toMatchObject({ ok: false, code: 'window_changed' })
    expect(validateComputerActionReference(observation(), reference({ targetFingerprint: 'target-v2' }), 9_999))
      .toMatchObject({ ok: false, code: 'target_changed' })
  })

  it('rejects expired observations and missing targets before an action can run', () => {
    expect(isComputerObservationFresh(observation({ expiresAt: 1_000 }), 1_000)).toBe(false)
    expect(validateComputerActionReference(observation({ expiresAt: 1_000 }), reference(), 1_000))
      .toMatchObject({ ok: false, code: 'observation_expired' })
    expect(validateComputerActionReference(observation(), reference({ targetId: 'gone' }), 9_999))
      .toMatchObject({ ok: false, code: 'target_missing' })
  })

  it('forces one-time confirmation for high-risk or sensitive computer actions', () => {
    expect(assessComputerAction({ action: 'click', role: 'button', name: '发送邮件' }))
      .toMatchObject({ risk: 'high', requiresOneTimeApproval: true })
    expect(assessComputerAction({ action: 'type', role: 'textbox', name: '密码' }))
      .toMatchObject({ risk: 'blocked', requiresOneTimeApproval: false })
    expect(assessComputerAction({ action: 'scroll', role: 'document', name: '会议纪要' }))
      .toMatchObject({ risk: 'reversible', allowsTaskGrant: true })
  })
})
