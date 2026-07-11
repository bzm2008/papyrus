import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTHORIZED_WORKSPACE_IMPORT_MESSAGE,
  importResourceFiles,
  openProjectFolder,
} from './resourceImportService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

describe('legacy resource imports', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(open).mockReset()
  })

  it('rejects file imports without invoking an arbitrary-path command', async () => {
    await expect(importResourceFiles()).rejects.toThrow(AUTHORIZED_WORKSPACE_IMPORT_MESSAGE)

    expect(open).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects folder imports without invoking an arbitrary-path command', async () => {
    await expect(openProjectFolder()).rejects.toThrow(AUTHORIZED_WORKSPACE_IMPORT_MESSAGE)

    expect(open).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})
