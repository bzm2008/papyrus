import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  approveComputerAction,
  computerObserve,
  executeApprovedComputerAction,
  previewComputerAction,
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
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_computer_approve') return { token: 'approval-1', previewId: 'preview-1', expires: 999 }
      return { id: 'observe-1' }
    })
    setWorkAssistantInvokerForTests(invoke)

    await computerObserve('run-1')
    await previewComputerAction({
      runId: 'run-1',
      action: 'computer_click',
      observationId: 'observe-1',
      windowFingerprint: 'window-v1',
      targetId: 'target-1',
      targetFingerprint: 'target-v1',
    })
    const grant = await approveComputerAction('preview-1', 'run-1', 'once')
    await executeApprovedComputerAction('preview-1', grant.token)

    expect(invoke).toHaveBeenNthCalledWith(1, 'work_assistant_computer_observe', { runId: 'run-1' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'work_assistant_computer_preview', {
      request: {
        runId: 'run-1',
        action: 'computer_click',
        observationId: 'observe-1',
        windowFingerprint: 'window-v1',
        targetId: 'target-1',
        targetFingerprint: 'target-v1',
      },
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'work_assistant_computer_approve', { previewId: 'preview-1', runId: 'run-1', choice: 'once' })
    expect(invoke).toHaveBeenNthCalledWith(4, 'work_assistant_computer_execute', { previewId: 'preview-1', approvalToken: 'approval-1' })
  })
})
