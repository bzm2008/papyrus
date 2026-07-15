import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./llmClient', () => ({
  callOpenAICompatible: vi.fn(),
  canCallProvider: vi.fn(() => true),
}))

vi.mock('./modelRouterService', () => ({
  describeModelRouting: vi.fn(() => '裁判模型'),
  selectModelForRole: vi.fn(() => ({ provider: { id: 'judge' }, role: 'judge' })),
}))

vi.mock('./agentPromptContext', () => ({
  composeSystemPrompt: (value: string) => value,
}))

import { judgeSecretaryGoal } from './secretaryGoalService'
import { callOpenAICompatible } from './llmClient'
import type { SecretaryGoal } from '../stores/useAppStore'

const goal: SecretaryGoal = {
  id: 'goal-sampling',
  title: '完成项目报告',
  request: '整理并完成项目报告',
  acceptanceCriteria: ['结构完整'],
  phasePlan: ['梳理材料'],
  currentProgress: '已完成初稿',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(() => {
  vi.mocked(callOpenAICompatible).mockResolvedValue(
    JSON.stringify({ verdict: 'continue', summary: '继续核对', evidence: [], nextStep: '审校' }),
  )
})

afterEach(() => vi.clearAllMocks())

describe('long-task judge sampling', () => {
  it('uses the stable judge profile instead of the default model temperature', async () => {
    await judgeSecretaryGoal(goal, '已经完成初步梳理。', 'high')

    expect(callOpenAICompatible).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callOpenAICompatible).mock.calls[0]?.[3]).toMatchObject({
      temperature: 0.3,
      maxTokens: 5000,
    })
  })
})
