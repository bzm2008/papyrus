import { afterEach, describe, expect, it } from 'vitest'

import { useWorkAssistantStore } from './useWorkAssistantStore'

afterEach(() => {
  useWorkAssistantStore.getState().resetAllRuns()
  useWorkAssistantStore.setState({ capabilityStatus: [] })
})

describe('useWorkAssistantStore event ownership', () => {
  it('drops late events after a run is reset instead of recreating it', () => {
    const store = useWorkAssistantStore.getState()
    store.dispatch({ type: 'run.started', runId: 'run-reset', at: 1 })
    store.dispatch({ type: 'run.completed', runId: 'run-reset', response: '完成', at: 2 })
    store.resetRun('run-reset')

    store.dispatch({ type: 'run.started', runId: 'run-reset', at: 3 })
    store.dispatch({ type: 'message.delta', runId: 'run-reset', messageId: 'late', delta: '迟到', at: 4 })

    expect(useWorkAssistantStore.getState().runs['run-reset']).toBeUndefined()
    expect(useWorkAssistantStore.getState().activeRunId).toBeUndefined()
  })

  it('does not reactivate a terminal run when a late event arrives', () => {
    const store = useWorkAssistantStore.getState()
    store.dispatch({ type: 'run.started', runId: 'run-old', at: 1 })
    store.dispatch({ type: 'run.completed', runId: 'run-old', response: '完成', at: 2 })
    store.dispatch({ type: 'run.started', runId: 'run-new', at: 3 })

    store.dispatch({ type: 'message.delta', runId: 'run-old', messageId: 'late', delta: '迟到', at: 4 })

    expect(useWorkAssistantStore.getState().activeRunId).toBe('run-new')
    expect(useWorkAssistantStore.getState().runs['run-old']?.messageText).toBe('完成')
  })
})
