import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeWorkAssistantAction,
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

  it('fails closed before invoking a native action when the run is already aborted', async () => {
    const invoke = vi.fn(async () => undefined)
    setWorkAssistantInvokerForTests(invoke)
    const controller = new AbortController()
    controller.abort()

    await expect(
      executeWorkAssistantAction('preview-1', 'approval-1', 'run-1', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).not.toHaveBeenCalledWith('work_assistant_execute', expect.anything())
    expect(invoke).toHaveBeenCalledWith('work_assistant_cancel_run', { run: 'run-1' })
  })

  it('keeps a completed native result authoritative over a late abort', async () => {
    let resolveExecute: ((value: Record<string, unknown>) => void) | undefined
    const invoke = vi.fn((command: string) => {
      if (command === 'work_assistant_execute') {
        return new Promise<Record<string, unknown>>((resolve) => { resolveExecute = resolve })
      }
      return Promise.resolve(undefined)
    })
    setWorkAssistantInvokerForTests(invoke)
    const controller = new AbortController()
    const pending = executeWorkAssistantAction('preview-1', 'approval-1', 'run-1', controller.signal)
    resolveExecute?.({ completed: [{ index: 0 }], skipped: [], failed: [], remaining: [], cancelled: false })
    const result = await pending
    controller.abort()

    expect(result).toMatchObject({ cancelled: false })
    expect(invoke).not.toHaveBeenCalledWith('work_assistant_cancel_run', { run: 'run-1' })
  })
})
