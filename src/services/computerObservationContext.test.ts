import { describe, expect, it } from 'vitest'

import { createEphemeralComputerObservationContext } from './computerObservationContext'

describe('computer observation context', () => {
  it('returns a bounded semantic target summary without window titles or sensitive controls', () => {
    const context = createEphemeralComputerObservationContext({
      id: 'observation-1',
      expiresAt: 123,
      window: { appId: 'word', title: 'Private notes - Alice', fingerprint: 'window-1' },
      targets: [
        { id: 'target-save', role: 'Button', name: 'Save draft', fingerprint: 'save-1' },
        { id: 'target-password', role: 'Edit', name: 'Password', fingerprint: 'password-1' },
      ],
    })

    expect(context).toEqual({
      observationId: 'observation-1',
      windowFingerprint: 'window-1',
      expiresAt: 123,
      targets: [{ id: 'target-save', role: 'Button', name: 'Save draft', fingerprint: 'save-1' }],
    })
    expect(JSON.stringify(context)).not.toContain('Private notes')
    expect(JSON.stringify(context)).not.toContain('Password')
  })
})
