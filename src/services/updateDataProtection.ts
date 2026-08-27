import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../stores/useAppStore'

export const UPDATE_STORAGE_KEY = 'papyrus-workstation-settings-v1'

const MAX_STORAGE_PAYLOAD_CHARS = 8_000_000

export type UpdateDataProtectionInvoker = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>

export type UpdateSnapshotReceipt = {
  ok: true
  snapshotId: string
  targetVersion: string
  ledgerHealthy: boolean
  storageBytes: number
  fileCount: number
  message: string
}

export type UpdateDataHealth = {
  ok: boolean
  pending: boolean
  restored: boolean
  status: 'none' | 'verified' | 'restore_required' | 'error'
  targetVersion?: string
  ledgerHealthy: boolean
  storagePresent: boolean
  snapshotAvailable: boolean
  message: string
  code?: 'runtime_unavailable' | 'native_unavailable' | 'invalid_payload' | 'storage_unavailable'
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

type VerifyOptions = {
  storage?: StorageLike
  rehydrate?: () => void | Promise<void>
}

let invokeFn: UpdateDataProtectionInvoker = (command, args) => invoke(command, args)

export function setUpdateDataProtectionInvokerForTests(invoker: UpdateDataProtectionInvoker) {
  invokeFn = invoker
}

export function resetUpdateDataProtectionForTests() {
  invokeFn = (command, args) => invoke(command, args)
}

export async function prepareUpdateDataSnapshot(targetVersion: string): Promise<UpdateSnapshotReceipt | UpdateDataHealth> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      pending: false,
      restored: false,
      status: 'none',
      ledgerHealthy: false,
      storagePresent: false,
      snapshotAvailable: false,
      code: 'runtime_unavailable',
      message: '更新数据快照仅在桌面应用中可用。',
    }
  }

  const storageRead = readStoragePayload(window.localStorage)
  if (storageRead.failed) {
    return {
      ok: false,
      pending: false,
      restored: false,
      status: 'error',
      ledgerHealthy: false,
      storagePresent: false,
      snapshotAvailable: false,
      code: 'storage_unavailable',
      message: '当前对话存储暂时不可读，已阻止安装更新。',
    }
  }
  const storagePayload = storageRead.value
  if (storagePayload !== undefined && !isPersistedStoragePayload(storagePayload)) {
    return {
      ok: false,
      pending: false,
      restored: false,
      status: 'error',
      ledgerHealthy: false,
      storagePresent: false,
      snapshotAvailable: false,
      code: 'invalid_payload',
      message: '当前对话存储无法校验，已阻止安装更新以避免覆盖数据。',
    }
  }

  try {
    const payload = await invokeFn('prepare_update_snapshot', {
      input: {
        targetVersion: normalizeTargetVersion(targetVersion),
        storageKey: UPDATE_STORAGE_KEY,
        storagePayload,
      },
    })
    return parseSnapshotReceipt(payload)
  } catch {
    return {
      ok: false,
      pending: false,
      restored: false,
      status: 'error',
      ledgerHealthy: false,
      storagePresent: storagePayload !== undefined,
      snapshotAvailable: false,
      code: 'native_unavailable',
      message: '更新数据快照暂不可用，已阻止安装更新。',
    }
  }
}

export async function verifyUpdateDataAfterStartup(options: VerifyOptions = {}): Promise<UpdateDataHealth> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      pending: false,
      restored: false,
      status: 'none',
      ledgerHealthy: false,
      storagePresent: false,
      snapshotAvailable: false,
      code: 'runtime_unavailable',
      message: '更新数据校验仅在桌面应用中可用。',
    }
  }

  const storage = options.storage ?? window.localStorage
  const rehydrate = options.rehydrate ?? (() => useAppStore.persist.rehydrate())
  const storageRead = readStoragePayload(storage)
  let currentPayload = storageRead.value

  const first = await requestVerification(currentPayload)
  if (!first.ok) {
    useAppStore.getState().setUpdateState({
      status: 'error',
      message: first.message,
      progress: 0,
    })
    return first
  }

  if (storageRead.failed) {
    return {
      ...first,
      ok: false,
      status: 'error',
      code: 'storage_unavailable',
      message: '更新后对话存储暂时不可读，快照仍保留。',
    }
  }

  let result = first
  let restored = false
  if (first.pending && first.status === 'restore_required' && first.restoreStoragePayload) {
    if (!isPersistedStoragePayload(first.restoreStoragePayload)) {
      return {
        ...first,
        ok: false,
        status: 'error',
        code: 'invalid_payload',
        message: '更新快照中的对话存储无法校验，已保留快照并停止自动恢复。',
      }
    }

    try {
      storage.setItem(UPDATE_STORAGE_KEY, first.restoreStoragePayload)
      await rehydrate()
      currentPayload = first.restoreStoragePayload
      restored = true
      result = await requestVerification(currentPayload)
    } catch {
      return {
        ...first,
        ok: false,
        status: 'error',
        code: 'native_unavailable',
        message: '更新后对话恢复失败，快照仍保留，请勿清理应用数据。',
      }
    }
  }

  const finalResult: UpdateDataHealth = {
    ...result,
    restored,
  }
  if (finalResult.pending) {
    useAppStore.getState().setUpdateState({
      status: finalResult.ok ? 'not-available' : 'error',
      message: finalResult.message,
      progress: finalResult.ok ? 100 : 0,
      ...(finalResult.targetVersion ? { version: finalResult.targetVersion } : {}),
    })
  }
  return finalResult
}

export function isPersistedStoragePayload(value: string | null | undefined): value is string {
  if (!value || value.length > MAX_STORAGE_PAYLOAD_CHARS) return false
  try {
    const parsed = JSON.parse(value) as unknown
    if (!isRecord(parsed) || !isRecord(parsed.state)) return false
    if ('version' in parsed && typeof parsed.version !== 'number') return false
    return true
  } catch {
    return false
  }
}

async function requestVerification(currentPayload: string | undefined): Promise<UpdateDataHealth & { restoreStoragePayload?: string }> {
  try {
    const payload = await invokeFn('verify_update_snapshot', {
      input: {
        storageKey: UPDATE_STORAGE_KEY,
        storagePayload: currentPayload,
      },
    })
    return parseVerification(payload)
  } catch {
    return {
      ok: false,
      pending: false,
      restored: false,
      status: 'error',
      ledgerHealthy: false,
      storagePresent: currentPayload !== undefined,
      snapshotAvailable: false,
      code: 'native_unavailable',
      message: '更新后数据校验暂不可用，快照仍保留。',
    }
  }
}

function parseSnapshotReceipt(value: unknown): UpdateSnapshotReceipt | UpdateDataHealth {
  if (!isRecord(value)) return invalidNativePayload('更新快照返回异常，已阻止安装更新。')
  const snapshotId = safeText(value.snapshotId, 128)
  const targetVersion = safeText(value.targetVersion, 32)
  const storageBytes = safeNonNegativeInteger(value.storageBytes)
  const fileCount = safeNonNegativeInteger(value.fileCount)
  if (!snapshotId || !targetVersion || storageBytes === undefined || fileCount === undefined || typeof value.ledgerHealthy !== 'boolean') {
    return invalidNativePayload('更新快照返回异常，已阻止安装更新。')
  }
  return {
    ok: true,
    snapshotId,
    targetVersion,
    ledgerHealthy: value.ledgerHealthy,
    storageBytes,
    fileCount,
    message: safeNativeMessage(value.message, '已保存更新数据快照。'),
  }
}

function parseVerification(value: unknown): UpdateDataHealth & { restoreStoragePayload?: string } {
  if (!isRecord(value)) return invalidNativePayload('更新后数据校验返回异常，快照仍保留。')
  const status = value.status
  if (status !== 'none' && status !== 'verified' && status !== 'restore_required' && status !== 'error') {
    return invalidNativePayload('更新后数据校验返回异常，快照仍保留。')
  }
  if (typeof value.pending !== 'boolean' || typeof value.ledgerHealthy !== 'boolean' || typeof value.storagePresent !== 'boolean' || typeof value.snapshotAvailable !== 'boolean') {
    return invalidNativePayload('更新后数据校验返回异常，快照仍保留。')
  }
  const targetVersion = value.targetVersion === undefined ? undefined : safeText(value.targetVersion, 32)
  const restoreStoragePayload = typeof value.restoreStoragePayload === 'string' ? value.restoreStoragePayload : undefined
  return {
    ok: status !== 'error',
    pending: value.pending,
    restored: false,
    status,
    ...(targetVersion ? { targetVersion } : {}),
    ledgerHealthy: value.ledgerHealthy,
    storagePresent: value.storagePresent,
    snapshotAvailable: value.snapshotAvailable,
    message: safeNativeMessage(value.message, statusMessage(status)),
    ...(restoreStoragePayload ? { restoreStoragePayload } : {}),
  }
}

function invalidNativePayload(message: string): UpdateDataHealth {
  return {
    ok: false,
    pending: false,
    restored: false,
    status: 'error',
    ledgerHealthy: false,
    storagePresent: false,
    snapshotAvailable: false,
    code: 'invalid_payload',
    message,
  }
}

function statusMessage(status: UpdateDataHealth['status']) {
  if (status === 'verified') return '更新后数据保留检查通过。'
  if (status === 'restore_required') return '更新后发现本地对话存储缺失，准备从快照恢复。'
  if (status === 'error') return '更新后数据校验失败，快照仍保留，请勿清理应用数据。'
  return '本地数据目录健康。'
}

function safeNativeMessage(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback
  const message = value.trim()
  const containsPrivateReference =
    message.includes('\\')
    || /(?:token\s*=|bearer\s+)/i.test(message)
    || message.includes('/Users/')
    || message.includes('/home/')
  if (!message || message.length > 240 || containsPrivateReference) {
    return fallback
  }
  return message
}

function normalizeTargetVersion(value: string) {
  const normalized = value.trim()
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : 'unknown'
}

function readStoragePayload(storage: StorageLike): { value?: string; failed: boolean } {
  try {
    return { value: storage.getItem(UPDATE_STORAGE_KEY) ?? undefined, failed: false }
  } catch {
    return { failed: true }
  }
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === 'string' && value.trim() && value.length <= maxLength ? value.trim() : undefined
}

function safeNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
