import { invoke } from '@tauri-apps/api/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkBackendCommunication, checkSqliteStatus, clearGlobalMemory, getMemoryUsage } from '../services/maintenance'
import type { AgentMemoryRecord, AgentRunRecord } from '../stores/useAppStore'
import { useAppStore } from '../stores/useAppStore'
import { MaintenanceConsole } from './MaintenanceConsole'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('../services/maintenance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/maintenance')>()

  return {
    ...actual,
    checkDefaultModelLatency: vi.fn(async () => ({ status: 'ok', message: '模型正常。' })),
  }
})

vi.mock('../services/scallionAccountService', () => ({
  getScallionQuotaDisplay: vi.fn(() => ({ value: undefined, source: 'none' })),
  refreshScallionQuota: vi.fn(async () => undefined),
  refreshScallionRuntimeMetadata: vi.fn(async () => undefined),
}))

vi.mock('../services/scallionAuth', () => ({ startScallionLogin: vi.fn(async () => undefined) }))

const originalState = {
  maintenanceTab: useAppStore.getState().maintenanceTab,
  memoryUsageBytes: useAppStore.getState().memoryUsageBytes,
  agentMemoryRecords: useAppStore.getState().agentMemoryRecords,
  agentRuns: useAppStore.getState().agentRuns,
  activeAgentRunId: useAppStore.getState().activeAgentRunId,
}

const memory: AgentMemoryRecord = {
  id: 'fallback-memory',
  scope: 'global',
  kind: 'preference',
  content: '浏览器预览中的本地记忆。',
  tags: [],
  confidence: 0.9,
  source: 'test',
  createdAt: 1,
  updatedAt: 1,
  useCount: 0,
  status: 'active',
}

const run: AgentRunRecord = {
  id: 'fallback-run',
  mode: 'flow',
  status: 'completed',
  source: 'local',
  prompt: '浏览器预览中的运行记录。',
  startedAt: 1,
  stepCount: 1,
  traceCount: 1,
  memoryIds: [memory.id],
}

beforeEach(() => {
  vi.mocked(invoke).mockRejectedValue(new Error('desktop bridge unavailable'))
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: undefined })
  useAppStore.setState({
    maintenanceTab: 'memory',
    memoryUsageBytes: 1024,
    agentMemoryRecords: [memory],
    agentRuns: [run],
    activeAgentRunId: run.id,
  })
})

afterEach(() => {
  useAppStore.setState(originalState)
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('MaintenanceConsole browser clear fallback', () => {
  it('marks unavailable native core checks as not ready in browser preview', async () => {
    const [backend, sqlite] = await Promise.all([checkBackendCommunication(), checkSqliteStatus()])

    expect(backend.status).toBe('warning')
    expect(sqlite.status).toBe('warning')

    render(<MaintenanceConsole />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('health_check_backend'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('check_sqlite_status'))
    expect(screen.getByRole('button', { name: '进入 Papyrus' })).toBeDisabled()
  })

  it('returns a non-executed memory usage warning without a byte count', async () => {
    const result = await getMemoryUsage()

    expect(invoke).toHaveBeenCalledWith('get_memory_usage')
    expect(result).toMatchObject({ status: 'warning', message: '当前环境未执行本地记忆统计。' })
    expect(result.bytes).toBeUndefined()
  })

  it('keeps persisted usage and renders a safe warning when browser memory usage cannot be read', async () => {
    render(<MaintenanceConsole />)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_memory_usage'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('当前环境未执行本地记忆统计。')
    expect(useAppStore.getState().memoryUsageBytes).toBe(1024)
  })

  it('returns a non-executed warning without a usage byte count', async () => {
    const result = await clearGlobalMemory()

    expect(invoke).toHaveBeenCalledWith('clear_global_memory')
    expect(result).toMatchObject({ status: 'warning', message: '当前环境未执行本地记忆清理。' })
    expect(result.bytes).toBeUndefined()
  })

  it('does not clear local agent state when the native maintenance bridge is unavailable', async () => {
    const clearAgentMemory = vi.spyOn(useAppStore.getState(), 'clearAgentMemory')

    render(<MaintenanceConsole />)
    fireEvent.click(screen.getByRole('button', { name: /清空全局记忆/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('clear_global_memory'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('当前环境未执行本地记忆清理。')
    expect(clearAgentMemory).not.toHaveBeenCalled()
    expect(useAppStore.getState().agentMemoryRecords).toEqual([memory])
    expect(useAppStore.getState().agentRuns).toEqual([run])
    expect(useAppStore.getState().memoryUsageBytes).toBe(1024)
  })

  it('keeps a browser fallback rebuild warning visible and the confirmation open', async () => {
    render(<MaintenanceConsole />)
    fireEvent.click(screen.getByRole('button', { name: /重建项目索引/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('rebuild_project_index'))
    expect(await screen.findByText('项目索引任务已加入预留队列，真实向量库接入后会执行重建。')).toBeInTheDocument()
    expect(screen.getByText('重建项目索引？')).toBeInTheDocument()
    expect(useAppStore.getState().memoryUsageBytes).toBe(1024)
  })
})
