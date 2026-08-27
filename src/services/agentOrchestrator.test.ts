import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./llmClient', () => ({
  callOpenAICompatible: vi.fn(),
  callOpenAICompatibleStream: vi.fn(),
  canCallProvider: vi.fn(() => true),
}))

import { callOpenAICompatible, callOpenAICompatibleStream, canCallProvider } from './llmClient'
import { defaultProviderConfigs } from './modelCatalog'
import {
  executeAgentRun,
  planAgentRun,
  sendFlowMessage,
  shouldContinueSecretaryGoalCycle,
  streamOrCall,
} from './agentOrchestrator'
import { activeSecretaryRunId, cancelSecretaryRun, finishSecretaryRun } from './secretaryRunController'

beforeEach(() => {
  vi.mocked(callOpenAICompatible).mockReset()
  vi.mocked(callOpenAICompatibleStream).mockReset()
  vi.mocked(canCallProvider).mockReturnValue(true)
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
        { ...defaultProviderConfigs.openai, apiKey: 'test-key' },
        [{ role: 'user', content: '测试' }],
        vi.fn(),
      ),
    ).rejects.toThrow('流式回退已经失败')

    expect(callOpenAICompatible).not.toHaveBeenCalled()
  })
})

describe('low thinking effort dispatch guard', () => {
  it('returns a local low-effort plan without sub agents or Hive topology', async () => {
    vi.mocked(canCallProvider).mockReturnValue(false)

    const plan = await planAgentRun('请续写一个长篇小说章节并检查人物设定', 'low')

    expect(plan.subAgents).toEqual([])
    expect(plan.maxAgentCount).toBe(0)
    expect(plan.hiveTopology).toBeUndefined()
  })

  it('sanitizes planner-provided sub agents before returning a low-effort plan', async () => {
    vi.mocked(callOpenAICompatible).mockResolvedValueOnce(
      JSON.stringify({
        needsWebSearch: false,
        subAgents: ['draft-writer', 'proofreader'],
        toolCalls: [],
        writeIntent: false,
        replyMode: 'conversation_only',
        conversationGoal: '回答用户问题',
      }),
    )

    const plan = await planAgentRun('请解释这个研究主题', 'low')

    expect(plan.subAgents).toEqual([])
    expect(plan.maxAgentCount).toBe(0)
    expect(plan.hiveTopology).toBeUndefined()
  })

  it('does not execute sub agents when an older plan is passed directly to execution', async () => {
    vi.mocked(callOpenAICompatibleStream).mockResolvedValue('秘书长直接答复')

    const legacyPlan = {
      needsWebSearch: false,
      subAgents: ['draft-writer'],
      toolCalls: [],
      writeIntent: false,
      replyMode: 'conversation_only',
      conversationGoal: '直接回答',
      hiveTopology: {
        id: 'hive-legacy',
        enabled: true,
        rationale: 'legacy',
        flow: 'legacy',
        nodes: [],
        plannedAgents: 1,
      },
    } as Parameters<typeof executeAgentRun>[1]

    await executeAgentRun('解释一个简单问题', legacyPlan, 'low')

    expect(callOpenAICompatible).not.toHaveBeenCalled()
    expect(callOpenAICompatibleStream).toHaveBeenCalledTimes(1)
  })
})
