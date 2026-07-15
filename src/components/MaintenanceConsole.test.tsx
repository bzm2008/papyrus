import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as maintenance from '../services/maintenance'
import type { AgentMemoryRecord, AgentRunRecord } from '../stores/useAppStore'
import { useAppStore } from '../stores/useAppStore'
import { MaintenanceConsole } from './MaintenanceConsole'

vi.mock('../services/maintenance', () => ({
  checkBackendCommunication: vi.fn(async () => ({ status: 'ok', message: '桌面后端正常。' })),
  checkDefaultModelLatency: vi.fn(async () => ({ status: 'ok', message: '模型正常。' })),
  checkSqliteStatus: vi.fn(async () => ({ status: 'ok', message: '数据库正常。' })),
  clearGlobalMemory: vi.fn(),
  getMemoryUsage: vi.fn(async () => ({ status: 'ok', message: '占用已统计。', bytes: 0 })),
  rebuildProjectIndex: vi.fn(async () => ({ status: 'ok', message: '索引已重建。' })),
  testModelConnection: vi.fn(async () => ({ status: 'ok', message: '模型正常。' })),
}))

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
  id: 'memory-1',
  scope: 'global',
  kind: 'preference',
  content: '保留这条本地记忆。',
  tags: [],
  confidence: 0.9,
  source: 'test',
  createdAt: 1,
  updatedAt: 1,
  useCount: 0,
  status: 'active',
}

const run: AgentRunRecord = {
  id: 'run-1',
  mode: 'flow',
  status: 'completed',
  source: 'local',
  prompt: '保留这条运行记录。',
  startedAt: 1,
  stepCount: 1,
  traceCount: 1,
  memoryIds: [memory.id],
}

afterEach(() => {
  useAppStore.setState(originalState)
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function prepareMemoryState() {
  useAppStore.setState({
    maintenanceTab: 'memory',
    memoryUsageBytes: 1024,
    agentMemoryRecords: [memory],
    agentRuns: [run],
    activeAgentRunId: run.id,
  })
}

async function confirmMemoryClear() {
  fireEvent.click(screen.getByRole('button', { name: /清空全局记忆/ }))
  fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
  await waitFor(() => expect(maintenance.clearGlobalMemory).toHaveBeenCalledTimes(1))
}

describe('MaintenanceConsole global memory clearing', () => {
  it('clears local records only after the native clear succeeds and renders its success message', async () => {
    vi.mocked(maintenance.clearGlobalMemory).mockResolvedValue({
      status: 'ok',
      message: '全局记忆已清空。',
      bytes: 0,
    })
    prepareMemoryState()
    const clearAgentMemory = vi.spyOn(useAppStore.getState(), 'clearAgentMemory')

    render(<MaintenanceConsole />)
    await confirmMemoryClear()

    await waitFor(() => expect(clearAgentMemory).toHaveBeenCalledTimes(1))
    expect(useAppStore.getState().agentMemoryRecords).toEqual([])
    expect(useAppStore.getState().agentRuns).toEqual([])
    expect(screen.getByRole('alert')).toHaveTextContent('全局记忆已清空。')
  })

  it('keeps local records and renders a warning when native cleanup is incomplete', async () => {
    vi.mocked(maintenance.clearGlobalMemory).mockResolvedValue({
      status: 'warning',
      message: '秘书账本已清空，旧记忆已隔离但仍待清理。',
      bytes: 512,
    })
    prepareMemoryState()
    const clearAgentMemory = vi.spyOn(useAppStore.getState(), 'clearAgentMemory')

    render(<MaintenanceConsole />)
    await confirmMemoryClear()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('秘书账本已清空，旧记忆已隔离但仍待清理。'))
    expect(clearAgentMemory).not.toHaveBeenCalled()
    expect(useAppStore.getState().agentMemoryRecords).toEqual([memory])
    expect(useAppStore.getState().agentRuns).toEqual([run])
    expect(screen.getByRole('alert')).toHaveTextContent('清理未完成')
  })

  it('keeps local records and renders the native error message when cleanup fails', async () => {
    vi.mocked(maintenance.clearGlobalMemory).mockResolvedValue({
      status: 'error',
      message: '旧记忆仍在安全隔离区，未删除本地记录。',
      bytes: 1024,
    })
    prepareMemoryState()
    const clearAgentMemory = vi.spyOn(useAppStore.getState(), 'clearAgentMemory')

    render(<MaintenanceConsole />)
    await confirmMemoryClear()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('旧记忆仍在安全隔离区，未删除本地记录。'))
    expect(clearAgentMemory).not.toHaveBeenCalled()
    expect(useAppStore.getState().agentMemoryRecords).toEqual([memory])
    expect(useAppStore.getState().agentRuns).toEqual([run])
    expect(screen.getByRole('alert')).toHaveTextContent('清理失败')
  })

  it('replaces unsafe native error details with a generic recovery message', async () => {
    vi.mocked(maintenance.clearGlobalMemory).mockResolvedValue({
      status: 'error',
      message: 'Error: C:\\Users\\Administrator\\AppData\\Papyrus\\memory.db is locked',
    })
    prepareMemoryState()

    render(<MaintenanceConsole />)
    await confirmMemoryClear()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('清理未完成，当前本地记忆和运行记录已保留。')
    expect(alert).not.toHaveTextContent('C:\\Users\\Administrator')
  })
})
