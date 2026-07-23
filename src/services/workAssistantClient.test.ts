import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  computerObserve,
  executeComputerAction,
  removeWorkAssistantRoot,
  resetWorkAssistantInvokerForTests,
  scanWorkAssistantDownloads,
  setWorkAssistantInvokerForTests,
} from './workAssistantClient'

describe('workAssistantClient', () => {
  afterEach(() => resetWorkAssistantInvokerForTests())

  it('uses the native id field when removing an authorized root', async () => {
    const invoke = vi.fn(async () => undefined)
    setWorkAssistantInvokerForTests(invoke)

    await removeWorkAssistantRoot('root-1')

    expect(invoke).toHaveBeenCalledWith('work_assistant_remove_root', { id: 'root-1' })
  })

  it('scans an explicitly selected Downloads root', async () => {
    const invoke = vi.fn(async () => ({ rootId: 'downloads', entries: [], truncated: false }))
    setWorkAssistantInvokerForTests(invoke)

    await scanWorkAssistantDownloads('downloads')

    expect(invoke).toHaveBeenCalledWith('work_assistant_downloads_scan', { rootId: 'downloads' })
  })

  it('uses dedicated native commands for short-lived computer observations and actions', async () => {
    const invoke = vi.fn(async () => ({ id: 'observe-1' }))
    setWorkAssistantInvokerForTests(invoke)

    await computerObserve()
    await executeComputerAction({
      action: 'computer_click',
      observationId: 'observe-1',
      windowFingerprint: 'window-v1',
      targetId: 'target-1',
      targetFingerprint: 'target-v1',
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'work_assistant_computer_observe', undefined)
    expect(invoke).toHaveBeenNthCalledWith(2, 'work_assistant_computer_execute', {
      request: {
        action: 'computer_click',
        observationId: 'observe-1',
        windowFingerprint: 'window-v1',
        targetId: 'target-1',
        targetFingerprint: 'target-v1',
      },
    })
  })
})
