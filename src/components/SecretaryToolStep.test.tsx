import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AssistantApprovalRequest, AssistantToolCall } from '../services/workAssistantProtocol'
import { SecretaryToolStep } from './SecretaryToolStep'

const call = (patch: Partial<AssistantToolCall> = {}): AssistantToolCall => ({
  id: 'tool-1', runId: 'run-1', name: 'file_apply_batch', intent: '整理下载目录', arguments: { previewId: 'preview-1' }, status: 'running', startedAt: Date.now() - 1500, ...patch,
})

const approval = (patch: Partial<AssistantApprovalRequest> = {}): AssistantApprovalRequest => ({
  id: 'preview-1', revision: '1', risk: 'reversible', title: '整理 12 个文件', targetSummary: '下载目录', impactSummary: '移动 12 个文件到分类目录', reversible: true, expiresAt: Date.now() + 60_000, runId: 'run-1', toolCallId: 'tool-1', reason: '需要修改文件位置', allowedChoices: ['once', 'run', 'deny'], ...patch,
})

describe('SecretaryToolStep', () => {
  it('shows the running action, target, and elapsed state', () => {
    render(<SecretaryToolStep toolCall={call({ arguments: { path: 'inbox/a.pdf' } })} />)
    expect(screen.getByText('整理下载目录')).toBeInTheDocument()
    expect(screen.getByText('inbox/a.pdf')).toBeInTheDocument()
    expect(screen.getByText(/进行中/)).toBeInTheDocument()
  })

  it('renders only the approval choices allowed by risk', () => {
    const onApprove = vi.fn()
    render(<SecretaryToolStep toolCall={call({ status: 'awaiting_approval' })} approval={approval({ risk: 'high', allowedChoices: ['once', 'deny'] })} onApprove={onApprove} />)
    expect(screen.getByRole('button', { name: '执行一次' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '本轮允许' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(onApprove).toHaveBeenCalledWith('deny')
  })

  it('shows completed impact and recoverable retry guidance', () => {
    const { rerender } = render(<SecretaryToolStep toolCall={call({ status: 'completed', result: { ok: true, summary: '已移动 12 个文件。', data: { completed: Array.from({ length: 12 }) } } })} />)
    expect(screen.getByText('已移动 12 个文件。')).toBeInTheDocument()
    expect(screen.getByText('12 项')).toBeInTheDocument()

    rerender(<SecretaryToolStep toolCall={call({ status: 'failed', result: { ok: false, summary: '预览已过期，请重新生成。', errorCode: 'stale_preview', recoverable: true } })} onRetry={vi.fn()} />)
    expect(screen.getByText('预览已过期，请重新生成。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新生成预览' })).toBeInTheDocument()
  })

  it('expands preview detail without duplicating its title', () => {
    render(<SecretaryToolStep toolCall={call({ status: 'awaiting_approval' })} approval={approval()} />)
    fireEvent.click(screen.getByRole('button', { name: '展开详情' }))
    expect(screen.getAllByText('整理 12 个文件')).toHaveLength(1)
    expect(screen.getByText('移动 12 个文件到分类目录')).toBeInTheDocument()
  })
})
