import { describe, expect, it } from 'vitest'

import { getSecretaryGoalCyclePolicy } from './secretaryGoalService'

describe('secretary goal cycle policy', () => {
  it('preserves the user-selected low sampling effort for every goal round', () => {
    expect(getSecretaryGoalCyclePolicy('low')).toMatchObject({
      executionEffort: 'low',
      allowsSubAgents: false,
      maxRounds: 4,
    })
  })
})
