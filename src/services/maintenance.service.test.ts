import { invoke } from '@tauri-apps/api/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkBackendCommunication, checkSqliteStatus, getMemoryUsage } from './maintenance'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

function setTauriRuntime(value: unknown) {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value })
}

beforeEach(() => {
  setTauriRuntime(undefined)
  vi.mocked(invoke).mockRejectedValue(new Error('bridge unavailable'))
})

afterEach(() => {
  setTauriRuntime(undefined)
  vi.clearAllMocks()
})

describe('maintenance service safety', () => {
  it('does not call a resolving bridge shim outside a Tauri runtime', async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: 'ok',
      message: '桌面后端检测通过。',
      bytes: 0,
    })

    const [backend, sqlite, memoryUsage] = await Promise.all([
      checkBackendCommunication(),
      checkSqliteStatus(),
      getMemoryUsage(),
    ])

    expect(invoke).not.toHaveBeenCalled()
    expect(backend).toMatchObject({ status: 'warning', message: '当前环境未执行桌面后端检测。' })
    expect(sqlite).toMatchObject({ status: 'warning', message: '当前环境未执行本地存储检测。' })
    expect(memoryUsage).toMatchObject({ status: 'warning', message: '当前环境未执行本地记忆统计。' })
    expect(memoryUsage.bytes).toBeUndefined()
  })

  it('does not fabricate native core readiness without a bridge', async () => {
    const [backend, sqlite] = await Promise.all([checkBackendCommunication(), checkSqliteStatus()])

    expect(backend).toMatchObject({ status: 'warning', message: '当前环境未执行桌面后端检测。' })
    expect(sqlite).toMatchObject({ status: 'warning', message: '当前环境未执行本地存储检测。' })
  })

  it.each([
    ['POSIX error', 'Error: /tmp/private.db is locked'],
    ['UNC error', 'Error: \\\\fileserver\\share\\maintenance.log'],
    ['file URL error', 'Error: file:///var/lib/papyrus/maintenance.log'],
    ['stack error', 'Stack trace: at health_check_backend (lib.rs:42)'],
  ])('redacts unsafe %s from rejected native calls', async (_kind, rawMessage) => {
    setTauriRuntime({})
    vi.mocked(invoke).mockRejectedValue(new Error(rawMessage))

    const result = await checkBackendCommunication()

    expect(result).toMatchObject({ status: 'error', message: '桌面后端检测未完成。' })
    expect(result.message).not.toContain(rawMessage)
  })

  it('does not forward otherwise clean upstream Error text', async () => {
    setTauriRuntime({})
    vi.mocked(invoke).mockRejectedValue(new Error('upstream temporarily unavailable'))

    const result = await checkBackendCommunication()

    expect(result).toMatchObject({ status: 'error', message: '桌面后端检测未完成。' })
  })

  it('does not forward a raw string rejected by the native bridge', async () => {
    setTauriRuntime({})
    vi.mocked(invoke).mockRejectedValue('tenant=workspace-42; retry later')

    const result = await checkBackendCommunication()

    expect(result).toMatchObject({ status: 'error', message: '桌面后端检测未完成。' })
    expect(result.message).not.toContain('tenant=workspace-42')
  })

  it('redacts unsafe text supplied in a native maintenance payload', async () => {
    setTauriRuntime({})
    vi.mocked(invoke).mockResolvedValue({
      status: 'error',
      message: 'details_/tmp/private.db',
    })

    const result = await checkSqliteStatus()

    expect(result).toMatchObject({ status: 'error', message: '本地存储检测未完成。' })
  })

  it.each([
    ['ok', 'tenant=workspace-42; retry later', '桌面后端检测通过。'],
    ['warning', '当前租户的上游维护窗口即将开始。', '桌面后端检测未完成。'],
  ] as const)('uses an owned message for clean-looking native %s payloads', async (status, rawMessage, expectedMessage) => {
    setTauriRuntime({})
    vi.mocked(invoke).mockResolvedValue({ status, message: rawMessage })

    const result = await checkBackendCommunication()

    expect(result).toMatchObject({ status, message: expectedMessage })
    expect(result.message).not.toContain(rawMessage)
  })

  it('accepts null optional fields from a native MaintenanceStatus payload', async () => {
    setTauriRuntime({})
    vi.mocked(invoke).mockResolvedValue({
      status: 'ok',
      message: 'Tauri 后端通信正常',
      latencyMs: 0,
      bytes: null,
    })

    const result = await checkBackendCommunication()

    expect(result).toEqual({
      status: 'ok',
      message: '桌面后端检测通过。',
      latencyMs: 0,
      bytes: undefined,
    })
  })

  it.each([
    ['no bytes field', {}],
    ['a null bytes field', { bytes: null }],
  ] as const)('treats a successful native memory usage result with %s as incomplete', async (_caseName, payload) => {
    setTauriRuntime({})
    vi.mocked(invoke).mockResolvedValue({
      status: 'ok',
      message: '记忆目录与秘书账本统计完成',
      ...payload,
    })

    const result = await getMemoryUsage()

    expect(result).toEqual({
      status: 'warning',
      message: '本地记忆统计未完成。',
      latencyMs: undefined,
      bytes: undefined,
    })
  })

  it('rejects a native payload with an unbounded numeric field', async () => {
    setTauriRuntime({})
    vi.mocked(invoke).mockResolvedValue({
      status: 'ok',
      message: '桌面后端检测通过。',
      latency_ms: Number.POSITIVE_INFINITY,
    })

    const result = await checkBackendCommunication()

    expect(result).toMatchObject({ status: 'error', message: '桌面后端检测未完成。' })
    expect(result.latencyMs).toBeUndefined()
  })
})
