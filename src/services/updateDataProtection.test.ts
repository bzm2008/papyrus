import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isPersistedStoragePayload,
  prepareUpdateDataSnapshot,
  resetUpdateDataProtectionForTests,
  setUpdateDataProtectionInvokerForTests,
  UPDATE_STORAGE_KEY,
  verifyUpdateDataAfterStartup,
} from './updateDataProtection'
import { useAppStore } from '../stores/useAppStore'

function setTauriRuntime(value: unknown) {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value })
}

const persistedPayload = JSON.stringify({
  state: {
    activeChatId: 'chat-1',
    chatSessions: [{ id: 'chat-1', title: '保留的对话', messages: [] }],
  },
  version: 0,
})

beforeEach(() => {
  setTauriRuntime({})
  window.localStorage.clear()
  useAppStore.setState({ updateStatus: 'idle', updateMessage: '自动更新待命', updateProgress: 0, updateVersion: undefined })
})

afterEach(() => {
  resetUpdateDataProtectionForTests()
  setTauriRuntime(undefined)
  window.localStorage.clear()
})

describe('update data protection', () => {
  it('captures the current persisted workspace before installation', async () => {
    window.localStorage.setItem(UPDATE_STORAGE_KEY, persistedPayload)
    const invoke = vi.fn(async () => ({
      snapshotId: 'snapshot-1',
      targetVersion: '1.0.1',
      ledgerHealthy: true,
      storageBytes: persistedPayload.length,
      fileCount: 2,
      message: '已保存更新快照。',
    }))
    setUpdateDataProtectionInvokerForTests(invoke)

    await expect(prepareUpdateDataSnapshot('1.0.1')).resolves.toMatchObject({
      ok: true,
      snapshotId: 'snapshot-1',
      targetVersion: '1.0.1',
    })
    expect(invoke).toHaveBeenCalledWith('prepare_update_snapshot', {
      input: {
        targetVersion: '1.0.1',
        storageKey: UPDATE_STORAGE_KEY,
        storagePayload: persistedPayload,
      },
    })
  })

  it('restores missing persisted conversations and rehydrates the app after an update', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        pending: true,
        status: 'restore_required',
        targetVersion: '1.0.1',
        ledgerHealthy: true,
        storagePresent: false,
        snapshotAvailable: true,
        restoreStoragePayload: persistedPayload,
        message: '更新后发现对话存储缺失，可从本地快照恢复。',
      })
      .mockResolvedValueOnce({
        pending: true,
        status: 'verified',
        targetVersion: '1.0.1',
        ledgerHealthy: true,
        storagePresent: true,
        snapshotAvailable: true,
        message: '更新后数据保留检查通过。',
      })
    const rehydrate = vi.fn(async () => undefined)
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    setUpdateDataProtectionInvokerForTests(invoke)

    await expect(verifyUpdateDataAfterStartup({ storage, rehydrate })).resolves.toMatchObject({
      ok: true,
      pending: true,
      restored: true,
      status: 'verified',
    })
    expect(storage.getItem(UPDATE_STORAGE_KEY)).toBe(persistedPayload)
    expect(rehydrate).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenNthCalledWith(2, 'verify_update_snapshot', {
      input: {
        storageKey: UPDATE_STORAGE_KEY,
        storagePayload: persistedPayload,
      },
    })
    expect(useAppStore.getState().updateMessage).toContain('数据保留检查通过')
  })

  it('rejects malformed persisted payloads before trusting a snapshot', async () => {
    expect(isPersistedStoragePayload(persistedPayload)).toBe(true)
    expect(isPersistedStoragePayload('{"state":null,"version":0}')).toBe(false)
    expect(isPersistedStoragePayload('{not-json')).toBe(false)

    const rawPath = 'C:\\Users\\someone\\AppData\\secret.sqlite3'
    const storage = {
      getItem: () => null,
      setItem: vi.fn(),
    }
    setUpdateDataProtectionInvokerForTests(vi.fn(async () => ({
      pending: true,
      status: 'error',
      ledgerHealthy: false,
      storagePresent: false,
      snapshotAvailable: false,
      message: `native failed: ${rawPath}`,
    })))

    const result = await verifyUpdateDataAfterStartup({ storage })

    expect(result).toMatchObject({ ok: false, pending: true })
    expect(result.message).not.toContain(rawPath)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('blocks installation when the persisted conversation storage cannot be read', async () => {
    const invoke = vi.fn()
    setUpdateDataProtectionInvokerForTests(invoke)
    const storage = {
      getItem: () => {
        throw new Error('storage temporarily unavailable')
      },
      setItem: vi.fn(),
    }
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage temporarily unavailable')
    })

    await expect(prepareUpdateDataSnapshot('1.0.1')).resolves.toMatchObject({
      ok: false,
      code: 'storage_unavailable',
    })
    expect(invoke).not.toHaveBeenCalled()
    getItemSpy.mockRestore()

    setUpdateDataProtectionInvokerForTests(vi.fn(async () => ({
      pending: true,
      status: 'restore_required',
      targetVersion: '1.0.1',
      ledgerHealthy: true,
      storagePresent: false,
      snapshotAvailable: true,
      message: '更新后发现对话存储缺失，可从本地快照恢复。',
    })))
    const result = await verifyUpdateDataAfterStartup({ storage })
    expect(result).toMatchObject({
      ok: false,
      status: 'error',
      code: 'storage_unavailable',
    })
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})
