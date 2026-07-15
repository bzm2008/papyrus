import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./llmClient', () => ({
  callOpenAICompatible: vi.fn(),
  canCallProvider: vi.fn(() => true),
}))

import { compressCurrentContext } from './contextCompression'
import { callOpenAICompatible } from './llmClient'
import { useAppStore } from '../stores/useAppStore'

const originalState = useAppStore.getState()

beforeEach(() => {
  vi.mocked(callOpenAICompatible).mockResolvedValue('压缩后的任务摘要')
  useAppStore.setState({
    isContextCompressing: false,
    flowThinkingEffort: 'medium',
    editorText: '一段需要压缩的长文稿。',
    flowMessages: [],
    compressedSummary: '',
  })
})

afterEach(() => {
  vi.clearAllMocks()
  useAppStore.setState(originalState)
})

describe('context compression sampling', () => {
  it('uses the stable compression sampling profile for model calls', async () => {
    await compressCurrentContext('manual')

    expect(callOpenAICompatible).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callOpenAICompatible).mock.calls[0]?.[3]).toMatchObject({
      temperature: 0.28,
      maxTokens: 1800,
    })
  })
})
