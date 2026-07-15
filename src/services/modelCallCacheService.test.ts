import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./llmClient', () => ({
  callOpenAICompatible: vi.fn(),
}))

import { defaultProviderConfigs } from './modelCatalog'
import { useAppStore } from '../stores/useAppStore'
import { callOpenAICompatible } from './llmClient'
import { callCacheableModel, createModelCallCacheKey } from './modelCallCacheService'

beforeEach(() => {
  vi.mocked(callOpenAICompatible).mockReset()
  useAppStore.setState({ semanticTaskCache: [], modelCallCacheMetrics: [] })
})

describe('model call cache sampling isolation', () => {
  it('uses distinct cache keys for distinct sampling profiles', () => {
    const base = {
      stage: 'agent_output' as const,
      taskType: 'writing',
      prompt: '写一段克制的开场白',
      agentId: 'writer',
      providerRole: 'writer',
      thinkingEffort: 'medium' as const,
    }

    const sampling = {
      temperature: 0.28,
      frequencyPenalty: 0.12,
      presencePenalty: 0.12,
      maxTokens: 4096,
      rationale: '稳定',
    }
    const stable = createModelCallCacheKey({
      ...base,
      sampling,
    })

    for (const changedSampling of [
      { ...sampling, temperature: 0.72 },
      { ...sampling, frequencyPenalty: 0.48 },
      { ...sampling, presencePenalty: 0.22 },
      { ...sampling, maxTokens: 8192 },
    ]) {
      expect(createModelCallCacheKey({ ...base, sampling: changedSampling })).not.toBe(stable)
    }
  })

  it('does not reuse a fuzzy semantic result produced with different sampling', async () => {
    vi.mocked(callOpenAICompatible)
      .mockResolvedValueOnce('创作配置的结果')
      .mockResolvedValueOnce('稳定配置的结果')

    const base = {
      stage: 'agent_output' as const,
      taskType: 'writing',
      prompt: '为项目会议写一段克制而真诚的开场白，突出协作与后续安排。',
      agentId: 'writer',
      providerRole: 'writer',
      thinkingEffort: 'medium' as const,
    }

    await callCacheableModel(
      defaultProviderConfigs.openai,
      [{ role: 'user', content: base.prompt }],
      {
        ...base,
        sampling: { temperature: 0.78, frequencyPenalty: 0.2, presencePenalty: 0.2, maxTokens: 4096, rationale: '创作' },
      },
    )
    await callCacheableModel(
      defaultProviderConfigs.openai,
      [{ role: 'user', content: base.prompt }],
      {
        ...base,
        sampling: { temperature: 0.22, frequencyPenalty: 0, presencePenalty: 0, maxTokens: 2048, rationale: '稳定' },
      },
    )

    expect(callOpenAICompatible).toHaveBeenCalledTimes(2)
  })
})
