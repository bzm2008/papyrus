import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as maintenance from '../services/maintenance'
import type { AgentMemoryRecord, AgentRunRecord } from '../stores/useAppStore'
import { useAppStore } from '../stores/useAppStore'
import { MaintenanceConsole } from './MaintenanceConsole'

vi.mock('../services/maintenance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/maintenance')>()

  return {
    ...actual,
    checkBackendCommunication: vi.fn(async () => ({ status: 'ok', message: '桌面后端正常。' })),
    checkDefaultModelLatency: vi.fn(async () => ({ status: 'ok', message: '模型正常。' })),
    checkSqliteStatus: vi.fn(async () => ({ status: 'ok', message: '数据库正常。' })),
    clearGlobalMemory: vi.fn(),
    getMemoryUsage: vi.fn(async () => ({ status: 'ok', message: '占用已统计。', bytes: 0 })),
    rebuildProjectIndex: vi.fn(async () => ({ status: 'ok', message: '索引已重建。' })),
    testModelConnection: vi.fn(async () => ({ status: 'ok', message: '模型正常。' })),
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
  maintenanceChecks: useAppStore.getState().maintenanceChecks,
  isEnvReady: useAppStore.getState().isEnvReady,
  memoryUsageBytes: useAppStore.getState().memoryUsageBytes,
  agentMemoryRecords: useAppStore.getState().agentMemoryRecords,
  agentRuns: useAppStore.getState().agentRuns,
  activeAgentRunId: useAppStore.getState().activeAgentRunId,
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
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

async function confirmIndexRebuild() {
  fireEvent.click(screen.getByRole('button', { name: /重建项目索引/ }))
  fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
  await waitFor(() => expect(maintenance.rebuildProjectIndex).toHaveBeenCalledTimes(1))
}

describe('MaintenanceConsole global memory clearing', () => {
  it.each([
    ['ok', 'tenant=workspace-42; ready', '桌面后端检测通过。'],
    ['warning', '当前租户将在稍后重新尝试。', '桌面后端检测未完成。'],
  ] as const)('uses an owned status message for a clean-looking %s probe result', async (status, rawMessage, expectedMessage) => {
    vi.mocked(maintenance.checkBackendCommunication).mockResolvedValue({ status, message: rawMessage })
    useAppStore.setState({ maintenanceTab: 'connections' })

    render(<MaintenanceConsole />)

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument()
    expect(screen.queryByText(rawMessage)).not.toBeInTheDocument()
  })

  it('issues only one destructive clear while the confirmation is active', async () => {
    const pendingClear = createDeferred<{
      status: 'warning'
      message: string
    }>()
    vi.mocked(maintenance.clearGlobalMemory).mockReturnValue(pendingClear.promise)
    prepareMemoryState()

    render(<MaintenanceConsole />)
    fireEvent.click(screen.getByRole('button', { name: /清空全局记忆/ }))
    const confirmButton = screen.getByRole('button', { name: '确认执行' })
    fireEvent.click(confirmButton)

    expect(confirmButton).toBeDisabled()
    fireEvent.click(confirmButton)
    expect(maintenance.clearGlobalMemory).toHaveBeenCalledTimes(1)

    await act(async () => {
      pendingClear.resolve({ status: 'warning', message: '清理尚未完成。' })
      await pendingClear.promise
    })
  })

  it('ignores a stale clear completion after its dialog closes and a rebuild dialog opens', async () => {
    const pendingClear = createDeferred<{
      status: 'ok'
      message: string
      bytes: number
    }>()
    vi.mocked(maintenance.clearGlobalMemory).mockReturnValue(pendingClear.promise)
    prepareMemoryState()

    render(<MaintenanceConsole />)
    fireEvent.click(screen.getByRole('button', { name: /清空全局记忆/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    await waitFor(() => expect(maintenance.clearGlobalMemory).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: /重建项目索引/ }))
    expect(screen.getByText('重建项目索引？')).toBeInTheDocument()

    await act(async () => {
      pendingClear.resolve({ status: 'ok', message: '全局记忆已清空。', bytes: 0 })
      await pendingClear.promise
    })

    expect(screen.getByText('重建项目索引？')).toBeInTheDocument()
    expect(screen.queryByText('全局记忆已清空。')).not.toBeInTheDocument()
    expect(useAppStore.getState().agentMemoryRecords).toEqual([memory])
    expect(useAppStore.getState().agentRuns).toEqual([run])
  })

  it.each(['clear', 'rebuild'] as const)('does not commit a stale %s completion after unmount', async (action) => {
    const pendingOperation = createDeferred<{
      status: 'ok'
      message: string
      bytes: number
    }>()
    vi.mocked(maintenance.getMemoryUsage).mockImplementation(() => new Promise<never>(() => undefined))
    if (action === 'clear') {
      vi.mocked(maintenance.clearGlobalMemory).mockReturnValue(pendingOperation.promise)
    } else {
      vi.mocked(maintenance.rebuildProjectIndex).mockReturnValue(pendingOperation.promise)
    }
    prepareMemoryState()
    const clearAgentMemory = vi.spyOn(useAppStore.getState(), 'clearAgentMemory')
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')

    const view = render(<MaintenanceConsole />)
    if (action === 'clear') {
      await confirmMemoryClear()
    } else {
      await confirmIndexRebuild()
    }

    focusSpy.mockClear()
    view.unmount()

    await act(async () => {
      pendingOperation.resolve({ status: 'ok', message: '操作完成。', bytes: 0 })
      await pendingOperation.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(useAppStore.getState().memoryUsageBytes).toBe(1024)
    expect(useAppStore.getState().agentMemoryRecords).toEqual([memory])
    expect(useAppStore.getState().agentRuns).toEqual([run])
    expect(clearAgentMemory).not.toHaveBeenCalled()
    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('traps confirmation focus and restores it to the trigger after closing', async () => {
    prepareMemoryState()
    render(<MaintenanceConsole />)
    const trigger = screen.getByRole('button', { name: /清空全局记忆/ })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: '清空全局记忆？' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-describedby')

    const cancelButton = within(dialog).getByRole('button', { name: '取消' })
    const confirmButton = within(dialog).getByRole('button', { name: '确认执行' })
    await waitFor(() => expect(cancelButton).toHaveFocus())

    fireEvent.keyDown(cancelButton, { key: 'Tab' })
    expect(confirmButton).toHaveFocus()
    fireEvent.keyDown(confirmButton, { key: 'Tab' })
    expect(cancelButton).toHaveFocus()
    fireEvent.keyDown(cancelButton, { key: 'Tab', shiftKey: true })
    expect(confirmButton).toHaveFocus()

    fireEvent.click(cancelButton)
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('does not let an older core success overwrite a newer warning or restore readiness', async () => {
    const firstBackendCheck = createDeferred<{
      status: 'ok'
      message: string
    }>()
    vi.mocked(maintenance.checkBackendCommunication)
      .mockReturnValueOnce(firstBackendCheck.promise)
      .mockResolvedValueOnce({ status: 'warning', message: '桌面后端暂未就绪。' })
    vi.mocked(maintenance.checkSqliteStatus).mockResolvedValue({ status: 'ok', message: '数据库正常。' })
    vi.mocked(maintenance.checkDefaultModelLatency).mockResolvedValue({ status: 'ok', message: '模型正常。' })
    useAppStore.setState({ maintenanceTab: 'connections', isEnvReady: false })

    const view = render(<MaintenanceConsole />)

    await waitFor(() => expect(maintenance.checkBackendCommunication).toHaveBeenCalledTimes(1))
    const retestButton = view.getAllByRole('button', { name: '重新检测' })[0]
    expect(retestButton).toBeEnabled()
    fireEvent.click(retestButton)

    await waitFor(() => expect(maintenance.checkBackendCommunication).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(useAppStore.getState().maintenanceChecks.find((check) => check.id === 'tauri')?.status).toBe('warning')
    })
    expect(view.getByRole('button', { name: '进入 Papyrus' })).toBeDisabled()

    await act(async () => {
      firstBackendCheck.resolve({ status: 'ok', message: '旧检测已通过。' })
      await firstBackendCheck.promise
    })

    expect(useAppStore.getState().maintenanceChecks.find((check) => check.id === 'tauri')?.status).toBe('warning')
    expect(view.getByRole('button', { name: '进入 Papyrus' })).toBeDisabled()
  })

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

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('清理未完整完成，当前本地记忆和运行记录已保留。'))
    expect(clearAgentMemory).not.toHaveBeenCalled()
    expect(useAppStore.getState().agentMemoryRecords).toEqual([memory])
    expect(useAppStore.getState().agentRuns).toEqual([run])
    expect(screen.getByRole('alert')).toHaveTextContent('清理未完成')
  })

  it('keeps the prior usage when index rebuilding is only a recoverable warning', async () => {
    vi.mocked(maintenance.getMemoryUsage).mockImplementation(() => new Promise<never>(() => undefined))
    vi.mocked(maintenance.rebuildProjectIndex).mockResolvedValue({
      status: 'warning',
      message: '索引重建尚未完成。',
      bytes: 512,
    })
    prepareMemoryState()

    render(<MaintenanceConsole />)
    await confirmIndexRebuild()

    expect(useAppStore.getState().memoryUsageBytes).toBe(1024)
  })

  it('replaces a completed clear notice with a later memory usage warning', async () => {
    vi.mocked(maintenance.clearGlobalMemory).mockResolvedValue({
      status: 'ok',
      message: '全局记忆已清空。',
      bytes: 0,
    })
    vi.mocked(maintenance.getMemoryUsage)
      .mockResolvedValueOnce({ status: 'ok', message: '占用已统计。', bytes: 1024 })
      .mockResolvedValueOnce({ status: 'warning', message: '最新统计暂不可用。' })
    prepareMemoryState()

    render(<MaintenanceConsole />)
    await waitFor(() => expect(maintenance.getMemoryUsage).toHaveBeenCalledTimes(1))
    await confirmMemoryClear()
    expect(screen.getByRole('alert')).toHaveTextContent('全局记忆已清空。')

    fireEvent.click(screen.getByRole('button', { name: '重新检测' }))
    await waitFor(() => expect(maintenance.getMemoryUsage).toHaveBeenCalledTimes(2))

    expect(screen.getByRole('alert')).toHaveTextContent('本地记忆统计未完成，已保留当前显示。')
    expect(screen.queryByText('全局记忆已清空。')).not.toBeInTheDocument()
  })

  it.each([
    ['maintenance', 'Error: /tmp/private.db is locked'],
    ['model', '\\\\fileserver\\share\\model.log'],
    ['maintenance file URL', 'file:///var/lib/papyrus/maintenance.log'],
    ['model stack', 'Stack trace: at upstream_model (client.ts:42)'],
  ])('redacts unsafe %s check messages before they reach StatusRow', async (kind, message) => {
    if (kind.startsWith('model')) {
      vi.mocked(maintenance.checkDefaultModelLatency).mockResolvedValue({ status: 'error', message })
    } else {
      vi.mocked(maintenance.checkBackendCommunication).mockResolvedValue({ status: 'error', message })
    }
    useAppStore.setState({ maintenanceTab: 'connections' })

    render(<MaintenanceConsole />)

    const expectedMessage = kind.startsWith('model') ? '模型连通性测试未完成。' : '桌面后端检测未完成。'
    expect(await screen.findByText(expectedMessage)).toBeInTheDocument()
    expect(screen.queryByText(message)).not.toBeInTheDocument()
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

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('清理未完成，当前本地记忆和运行记录已保留。'))
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

  it.each([
    ['Debian absolute path', '/usr/local/share/papyrus/memory.db is locked'],
    ['single-component /tmp path', '/tmp is locked'],
    ['single-component /var path', '/var is locked'],
    ['colon-adjacent /tmp path', 'failed:/tmp'],
    ['colon-adjacent nested POSIX path', 'failed:/usr/local/share/papyrus/memory.db'],
    ['equals-adjacent POSIX path', 'details=/tmp/private.db'],
    ['comma-adjacent POSIX path', 'failed,/usr/local/share/papyrus/memory.db'],
    ['bracket-adjacent POSIX path', 'failed[/tmp]'],
    ['underscore-adjacent POSIX path', 'details_/tmp/private.db'],
    ['UNC path', '\\\\fileserver\\team-share\\papyrus\\memory.db is locked'],
    ['file URL', 'file:///usr/local/share/papyrus/memory.db is locked'],
    ['stack trace marker', 'Stack trace: at clear_memory (maintenance.rs:42)'],
  ])('redacts unsafe %s details', async (_kind, message) => {
    vi.mocked(maintenance.clearGlobalMemory).mockResolvedValue({
      status: 'error',
      message,
    })
    prepareMemoryState()

    render(<MaintenanceConsole />)
    await confirmMemoryClear()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('清理未完成，当前本地记忆和运行记录已保留。')
    expect(alert).not.toHaveTextContent(message)
  })
})
