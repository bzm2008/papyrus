import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./llmClient', () => ({
  callOpenAICompatible: vi.fn(),
  canCallProvider: vi.fn(() => true),
}))

vi.mock('./projectContext', () => ({
  retrieveMentionContext: vi.fn(async () => ''),
}))

import { runCompanionRewrite } from './writingActions'
import { callOpenAICompatible } from './llmClient'
import { defaultProviderConfigs } from './modelCatalog'
import { useAppStore } from '../stores/useAppStore'

const originalState = useAppStore.getState()

beforeEach(() => {
  useAppStore.setState({ flowThinkingEffort: 'medium', mentionContextItems: [] })
  vi.mocked(callOpenAICompatible).mockResolvedValue(
    JSON.stringify({ kind: 'diagnostic', verdict: 'mixed', summary: '需要人工复核', confidence: 0.6 }),
  )
})

afterEach(() => {
  vi.clearAllMocks()
  useAppStore.setState(originalState)
})

describe('writing review sampling', () => {
  it.each(['查重', '审查', '纠错', '降噪'] as const)(
    'uses the stable judge profile for %s',
    async (action) => {
    await runCompanionRewrite({
      action,
      selectedText: '这是一段需要查重诊断的文字。',
      provider: { ...defaultProviderConfigs.openai, apiKey: 'test-key' },
    })

    expect(vi.mocked(callOpenAICompatible).mock.calls[0]?.[3]).toMatchObject({
      temperature: 0.28,
      maxTokens: 4096,
    })
    },
  )
})
