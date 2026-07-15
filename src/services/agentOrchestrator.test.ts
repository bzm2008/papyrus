import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./llmClient', () => ({
  callOpenAICompatible: vi.fn(),
  callOpenAICompatibleStream: vi.fn(),
  canCallProvider: vi.fn(() => true),
}))

import { callOpenAICompatible, callOpenAICompatibleStream } from './llmClient'
import { sendFlowMessage, shouldContinueSecretaryGoalCycle, streamOrCall } from './agentOrchestrator'
import { activeSecretaryRunId, cancelSecretaryRun, finishSecretaryRun } from './secretaryRunController'

beforeEach(() => {
  vi.mocked(callOpenAICompatible).mockReset()
  vi.mocked(callOpenAICompatibleStream).mockReset()
})

afterEach(() => {
  cancelSecretaryRun()
  const runId = activeSecretaryRunId()
  if (runId) {
    finishSecretaryRun(runId)
  }
})

describe('secretary goal cycle cancellation', () => {
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

describe('stream fallback ownership', () => {
  it('does not begin another regular request after the streaming client exhausted its fallback', async () => {
    vi.mocked(callOpenAICompatibleStream).mockRejectedValueOnce(new Error('流式回退已经失败'))

    await expect(
      streamOrCall(
        { id: 'test', label: 'Test', type: 'openai_compatible', baseUrl: 'https://example.invalid', modelName: 'test' },
        [{ role: 'user', content: '测试' }],
        vi.fn(),
      ),
    ).rejects.toThrow('流式回退已经失败')

    expect(callOpenAICompatible).not.toHaveBeenCalled()
  })
})
