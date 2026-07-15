import { invoke } from '@tauri-apps/api/core'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '../stores/useAppStore'
import { MaintenanceConsole } from './MaintenanceConsole'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('../services/scallionAccountService', () => ({
  getScallionQuotaDisplay: vi.fn(() => ({ value: undefined, source: 'none' })),
  refreshScallionQuota: vi.fn(async () => undefined),
  refreshScallionRuntimeMetadata: vi.fn(async () => undefined),
}))

vi.mock('../services/scallionAuth', () => ({ startScallionLogin: vi.fn(async () => undefined) }))

const originalState = {
  maintenanceTab: useAppStore.getState().maintenanceTab,
  memoryUsageBytes: useAppStore.getState().memoryUsageBytes,
}

beforeEach(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
  useAppStore.setState({ maintenanceTab: 'memory', memoryUsageBytes: 1024 })
  vi.mocked(invoke).mockImplementation(async (command) => {
    switch (command) {
      case 'health_check_backend':
        return { status: 'ok', message: '桌面后端检测通过。', latency_ms: 3 }
      case 'check_sqlite_status':
        return { status: 'ok', message: '本地存储检测通过。' }
      case 'get_memory_usage':
        return { status: 'ok', message: '记忆占用统计完成。', bytes: 4096 }
      case 'test_model_connection':
        return { status: 'warning', message: '模型未配置。' }
      default:
        throw new Error(`unexpected command: ${command}`)
    }
  })
})

afterEach(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: undefined })
  useAppStore.setState(originalState)
  vi.clearAllMocks()
})

describe('MaintenanceConsole native maintenance integration', () => {
  it('uses actual native success responses to unlock readiness and refresh memory usage', async () => {
    render(<MaintenanceConsole />)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('health_check_backend'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('check_sqlite_status'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_memory_usage'))

    expect(screen.getByRole('button', { name: '进入 Papyrus' })).toBeEnabled()
    expect(useAppStore.getState().memoryUsageBytes).toBe(4096)
    expect(screen.getByText('4.0 KB')).toBeInTheDocument()
  })

  it('does not render a raw string rejected by the native bridge', async () => {
    useAppStore.setState({ maintenanceTab: 'connections' })
    vi.mocked(invoke).mockImplementation(async (command) => {
      switch (command) {
        case 'health_check_backend':
          throw 'tenant=workspace-42; retry later'
        case 'check_sqlite_status':
          return { status: 'ok', message: '本地存储检测通过。' }
        case 'get_memory_usage':
          return { status: 'ok', message: '记忆占用统计完成。', bytes: 4096 }
        default:
          return { status: 'warning', message: '模型未配置。' }
      }
    })

    render(<MaintenanceConsole />)

    expect(await screen.findByText('桌面后端检测未完成。')).toBeInTheDocument()
    expect(screen.queryByText('tenant=workspace-42; retry later')).not.toBeInTheDocument()
  })
})
