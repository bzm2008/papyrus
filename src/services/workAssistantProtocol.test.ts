import { describe, expect, it, vi } from 'vitest'

import { createEmptyWorkAssistantRun } from './workAssistantProtocol'

describe('createEmptyWorkAssistantRun', () => {
  it('creates an idle run with empty event collections', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)

    expect(createEmptyWorkAssistantRun('run-1')).toEqual({
      id: 'run-1',
      status: 'idle',
      messageText: '',
      stage: '',
      toolCalls: {},
      subagents: {},
      lastActivityAt: 1234,
    })

    vi.restoreAllMocks()
  })
})
