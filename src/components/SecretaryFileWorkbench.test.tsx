import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AssistantToolCall } from '../services/workAssistantProtocol'
import { SecretaryFileWorkbench } from './SecretaryFileWorkbench'

const plan: AssistantToolCall = {
  id: 'plan-1', runId: 'run-1', name: 'file_plan_batch', intent: '整理下载目录', status: 'completed', startedAt: 1,
  arguments: { rootId: 'downloads', conflictPolicy: 'rename', operations: [{ kind: 'move', source: 'inbox/a.pdf', destination: 'PDF/a.pdf' }, { kind: 'trash', source: 'inbox/old.tmp' }] },
  result: { ok: true, summary: '预览已生成', data: { previewId: 'preview-1' } },
}

describe('SecretaryFileWorkbench', () => {
  it('shows root, conflict policy, item count, and source-target rows', () => {
    render(<SecretaryFileWorkbench planCall={plan} />)
    expect(screen.getByText('downloads')).toBeInTheDocument()
    expect(screen.getByText('自动重命名')).toBeInTheDocument()
    expect(screen.getByText('2 项操作')).toBeInTheDocument()
    expect(screen.getByText('inbox/a.pdf')).toBeInTheDocument()
    expect(screen.getByText('PDF/a.pdf')).toBeInTheDocument()
  })

  it('shows stale preview and groups completed and failed execution items', () => {
    const apply: AssistantToolCall = { ...plan, id: 'apply-1', name: 'file_apply_batch', arguments: { previewId: 'preview-1' }, status: 'failed', result: { ok: false, summary: '预览已过期，请重新生成。', errorCode: 'stale_preview', recoverable: true, data: { completed: [{ source: 'a.pdf' }], failed: [{ source: 'b.png', message: '占用中' }] } } }
    render(<SecretaryFileWorkbench planCall={plan} applyCall={apply} />)
    expect(screen.getByText('预览已过期，请重新生成')).toBeInTheDocument()
    expect(screen.getByText('已完成 1')).toBeInTheDocument()
    expect(screen.getByText('失败 1')).toBeInTheDocument()
  })

  it('synchronizes selection with the inline tool row', () => {
    const onSelect = vi.fn()
    render(<SecretaryFileWorkbench planCall={plan} onSelectToolCall={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: '在对话中定位' }))
    expect(onSelect).toHaveBeenCalledWith('plan-1')
  })
})
