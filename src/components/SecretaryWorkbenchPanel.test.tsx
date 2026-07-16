import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SecretaryWorkbenchPanel } from './SecretaryWorkbenchPanel'

const pendingRun = {
  id: 'run-approval',
  status: 'awaiting_approval' as const,
  messageText: '',
  stage: '等待确认文件整理预览',
  toolCalls: {
    'tool-1': {
      id: 'tool-1',
      runId: 'run-approval',
      name: 'file_apply_batch',
      intent: '整理资料',
      arguments: {},
      status: 'awaiting_approval' as const,
      startedAt: 1,
      preview: {
        id: 'approval-1',
        revision: '1',
        risk: 'reversible' as const,
        title: '受控工具：file_apply_batch',
        targetSummary: '已隐藏具体目标详情。',
        impactSummary: '此受控工具需要确认后执行。',
        reversible: true,
        expiresAt: Date.now() + 60_000,
        runId: 'run-approval',
        toolCallId: 'tool-1',
        reason: '文件操作需要确认。',
        allowedChoices: ['once', 'deny'] as const,
      },
    },
  },
  subagents: {},
  pendingApprovalId: 'approval-1',
  lastActivityAt: 1,
}

describe('SecretaryWorkbenchPanel', () => {
  it('keeps the active approval and latest checkpoint actionable in the right workbench', () => {
    const onApprove = vi.fn()
    render(
      <SecretaryWorkbenchPanel
        todos={[]}
        steps={[]}
        traces={[]}
        runState="running"
        pinned={false}
        activeView="run"
        onViewChange={vi.fn()}
        onPinnedChange={vi.fn()}
        onClose={vi.fn()}
        manuscript={<div />}
        files={<div />}
        workAssistantRun={pendingRun as never}
        checkpoints={[{
          id: 'checkpoint-1',
          goalId: 'goal-1',
          title: '整理材料',
          summary: '已完成资料归类。',
          judge: { verdict: 'continue', summary: '继续核对待确认项。', evidence: [], nextStep: '确认文件预览。', checkedAt: 1 },
          createdAt: 1,
        }]}
        onApprove={onApprove}
      />,
    )

    expect(screen.getByText('待确认操作')).toBeInTheDocument()
    expect(screen.getByText('最近检查点')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('本次确认'))
    expect(onApprove).toHaveBeenCalledWith('approval-1', 'once')
  })

  it('uses a right-side drawer before the persistent three-column breakpoint', () => {
    const { container } = render(
      <SecretaryWorkbenchPanel
        todos={[]}
        steps={[]}
        traces={[]}
        runState="idle"
        pinned={false}
        activeView="run"
        onViewChange={vi.fn()}
        onPinnedChange={vi.fn()}
        onClose={vi.fn()}
        manuscript={<div />}
        files={<div />}
      />,
    )

    const panel = container.querySelector('aside')
    expect(panel?.className).toContain('md:inset-y-3')
    expect(panel?.className).toContain('md:right-3')
    expect(panel?.className).toContain('md:w-[348px]')
  })
})
