import { afterEach, describe, expect, it, vi } from 'vitest'

import * as workAssistantClient from './workAssistantClient'
import {
  registerApplicationFromPicker,
  removeWorkAssistantRoot,
  resetWorkAssistantInvokerForTests,
  scanWorkAssistantDownloads,
  runTerminalCommand,
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

  it('sends terminal diagnostics as fixed operations without a shell string', async () => {
    const invoke = vi.fn(async () => ({ program: 'git', exitCode: 0, stdout: '', stderr: '', truncated: false, durationMs: 2 }))
    setWorkAssistantInvokerForTests(invoke)

    await runTerminalCommand({ operation: 'git_status', rootId: 'project', cwd: 'src' })

    expect(invoke).toHaveBeenCalledWith('work_assistant_terminal_run', {
      operation: 'git_status',
      rootId: 'project',
      cwd: 'src',
    })
  })

  it('asks the native registration command to own application path selection', async () => {
    const invoke = vi.fn(async () => ({ id: 'app-1', label: 'Editor' }))
    setWorkAssistantInvokerForTests(invoke)

    await registerApplicationFromPicker('Editor')

    expect(invoke).toHaveBeenCalledWith('work_assistant_register_application_from_picker', {
      label: 'Editor',
    })
  })

  it('does not expose a caller-supplied application validation endpoint', () => {
    expect('validateApplicationSelection' in workAssistantClient).toBe(false)
  })
})
