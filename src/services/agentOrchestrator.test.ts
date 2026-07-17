import { afterEach, describe, expect, it } from 'vitest'

import { canUseSecretarySubAgents, sendFlowMessage, shouldContinueSecretaryGoalCycle } from './agentOrchestrator'
import { activeSecretaryRunId, cancelSecretaryRun, finishSecretaryRun } from './secretaryRunController'

afterEach(() => {
  cancelSecretaryRun()
  const runId = activeSecretaryRunId()
  if (runId) {
    finishSecretaryRun(runId)
  }
})

describe('secretary goal cycle cancellation', () => {
  it('keeps low effort in single-agent mode', () => {
    expect(canUseSecretarySubAgents('low')).toBe(false)
    expect(canUseSecretarySubAgents('medium')).toBe(true)
    expect(canUseSecretarySubAgents('high')).toBe(true)
  })

  it('does not advance the goal cycle after a cancelled run', () => {
    expect(shouldContinueSecretaryGoalCycle({ status: 'cancelled' })).toBe(false)
  })

  it('only advances after a completed run', () => {
    expect(shouldContinueSecretaryGoalCycle({ status: 'completed' })).toBe(true)
    expect(shouldContinueSecretaryGoalCycle({ status: 'failed' })).toBe(false)
    expect(shouldContinueSecretaryGoalCycle(undefined)).toBe(false)
  })

  it('returns a cancelled outcome when sendFlowMessage is cancelled before work starts', async () => {
    const pending = sendFlowMessage('写一段短文')

    cancelSecretaryRun()

    await expect(pending).resolves.toMatchObject({ status: 'cancelled' })
  })
})
