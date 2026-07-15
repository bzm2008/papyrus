import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AssistantApprovalRequest, AssistantToolCall } from '../services/workAssistantProtocol'
import { approvalChoices } from '../services/workAssistantPolicy'
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
    render(<SecretaryToolStep toolCall={call({ status: 'awaiting_approval' })} approval={approval({ risk: 'high', allowedChoices: approvalChoices('high') })} onApprove={onApprove} />)
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

  it('shows browser context while redacting sensitive values from copied tool info', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const browserApproval = approval({
      risk: 'high',
      action: 'submit',
      origin: 'https://example.com',
      pageTitle: '申请表',
      elementName: '提交申请',
      allowedChoices: approvalChoices('high'),
    })

    render(
      <SecretaryToolStep
        toolCall={call({
          name: 'browser_submit',
          status: 'awaiting_approval',
          arguments: { value: '银行卡 4111 1111 1111 1111', token: 'secret-token', content: 'sensitive body' },
        })}
        approval={browserApproval}
      />,
    )

    expect(screen.getByText('风险：高风险')).toBeInTheDocument()
    expect(screen.getByText('来源：https://example.com')).toBeInTheDocument()
    expect(screen.getByText('页面：申请表')).toBeInTheDocument()
    expect(screen.getByText('元素：提交申请')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开详情' }))
    fireEvent.click(screen.getByRole('button', { name: '复制工具信息' }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))

    const copied = JSON.parse(writeText.mock.calls[0][0] as string) as { arguments: Record<string, string> }
    expect(copied.arguments.value).toBe('[已隐藏]')
    expect(copied.arguments.token).toBe('[已隐藏]')
    expect(copied.arguments.content).toBe('[已隐藏]')
    expect(writeText.mock.calls[0][0]).not.toContain('4111 1111')
  })
})
