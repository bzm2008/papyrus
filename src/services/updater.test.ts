import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nativeUpdater = vi.hoisted(() => ({ check: vi.fn() }))
const processApi = vi.hoisted(() => ({ relaunch: vi.fn() }))
const ledger = vi.hoisted(() => ({ pauseActiveSecretaryLedgerRuns: vi.fn() }))
const runs = vi.hoisted(() => ({ cancelSecretaryRun: vi.fn() }))
const protection = vi.hoisted(() => ({ prepareUpdateDataSnapshot: vi.fn() }))

vi.mock('@tauri-apps/plugin-updater', () => nativeUpdater)
vi.mock('@tauri-apps/plugin-process', () => processApi)
vi.mock('./secretaryLedgerRuntime', () => ledger)
vi.mock('./secretaryRunController', () => runs)
vi.mock('./updateDataProtection', () => protection)

import { relaunchToInstallUpdate, checkAndDownloadUpdate } from './updater'

function setTauriRuntime(value: unknown) {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value })
}

function fakeUpdate() {
  return {
    version: '1.0.1',
    download: vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 3 } })
      onEvent({ event: 'Progress', data: { chunkLength: 3 } })
      onEvent({ event: 'Finished' })
    }),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
}

beforeEach(() => {
  setTauriRuntime({})
  vi.resetAllMocks()
  ledger.pauseActiveSecretaryLedgerRuns.mockResolvedValue(1)
  processApi.relaunch.mockResolvedValue(undefined)
  protection.prepareUpdateDataSnapshot.mockResolvedValue({
    ok: true,
    snapshotId: 'snapshot-1',
    targetVersion: '1.0.1',
    ledgerHealthy: true,
    storageBytes: 100,
    fileCount: 3,
    message: '已保存更新数据快照。',
  })
})

afterEach(() => setTauriRuntime(undefined))

describe('updater data protection boundary', () => {
  it('captures a data snapshot after pausing work and before installing', async () => {
    const update = fakeUpdate()
    nativeUpdater.check.mockResolvedValue(update)

    await checkAndDownloadUpdate()
    await relaunchToInstallUpdate()

    expect(ledger.pauseActiveSecretaryLedgerRuns).toHaveBeenCalledTimes(1)
    expect(runs.cancelSecretaryRun).toHaveBeenCalledWith()
    expect(protection.prepareUpdateDataSnapshot).toHaveBeenCalledWith('1.0.1')
    expect(update.install).toHaveBeenCalledTimes(1)
    expect(processApi.relaunch).toHaveBeenCalledTimes(1)
  })

  it('blocks installation when the data snapshot cannot be prepared', async () => {
    const update = fakeUpdate()
    nativeUpdater.check.mockResolvedValue(update)
    protection.prepareUpdateDataSnapshot.mockResolvedValue({
      ok: false,
      pending: false,
      restored: false,
      status: 'error',
      ledgerHealthy: false,
      storagePresent: false,
      snapshotAvailable: false,
      message: '更新数据快照暂不可用，已阻止安装更新。',
    })

    await checkAndDownloadUpdate()
    await relaunchToInstallUpdate()

    expect(update.install).not.toHaveBeenCalled()
    expect(processApi.relaunch).not.toHaveBeenCalled()
  })
})
