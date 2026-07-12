import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyWorkAssistantRun } from '../services/workAssistantProtocol'
import { SecretaryRunStatusStack } from './SecretaryRunStatusStack'

describe('SecretaryRunStatusStack', () => {
  it('shows todos by default and keeps background tools summarized', () => {
    render(<SecretaryRunStatusStack run={{ ...createEmptyWorkAssistantRun('r1'), status: 'running', stage: '正在检查文件', toolCalls: { t1: { id: 't1', runId: 'r1', name: 'workspace_scan', intent: '扫描下载目录', arguments: {}, status: 'running', startedAt: Date.now() } } }} todos={[{ id: 'todo-1', title: '扫描资料', detail: '', status: 'running', agentId: 'writer', createdAt: 1, updatedAt: 1 }]} queuedCount={2} />)
    expect(screen.getByText('扫描资料')).toBeInTheDocument()
    expect(screen.getByText('后台工具 1')).toBeInTheDocument()
    expect(screen.getByText('排队指令 2')).toBeInTheDocument()
  })

  it('shows a stall hint after two seconds only while running', () => {
    vi.useFakeTimers()
    const running = { ...createEmptyWorkAssistantRun('r1'), status: 'running' as const, lastActivityAt: Date.now() }
    const { rerender } = render(<SecretaryRunStatusStack run={running} todos={[]} queuedCount={0} />)
    act(() => vi.advanceTimersByTime(2100))
    expect(screen.getByText('暂未收到新进展')).toBeInTheDocument()
    rerender(<SecretaryRunStatusStack run={{ ...running, status: 'awaiting_approval' }} todos={[]} queuedCount={0} />)
    expect(screen.queryByText('暂未收到新进展')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})
