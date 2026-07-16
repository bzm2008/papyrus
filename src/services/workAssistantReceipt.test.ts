import { describe, expect, it } from 'vitest'

import {
  toPublicAssistantApprovalRequest,
  createToolReceipt,
  createTransientToolContext,
  toPublicAssistantToolCall,
  toPublicAssistantToolResult,
} from './workAssistantReceipt'

describe('work assistant receipt boundary', () => {
  it('keeps browser form values and page content out of public records', () => {
    const result = {
      ok: true,
      summary: 'Browser snapshot is available.',
      data: {
        snapshotId: 'snapshot-1',
        pageRevision: 'r1',
        url: 'https://example.com/path?access_token=hidden',
        text: 'Private page body',
        body: 'Raw body',
        value: 'Draft field value',
        authorization: 'Bearer hidden-token',
        elements: [{ token: 'element-1', name: 'Email', value: 'person@example.com' }],
      },
    }

    const receipt = createToolReceipt('browser_snapshot', result)
    const serialized = JSON.stringify(receipt)

    expect(receipt).toMatchObject({ tool: 'browser_snapshot', data: { snapshotId: 'snapshot-1', pageRevision: 'r1', origin: 'https://example.com' } })
    expect(serialized).not.toContain('Private page body')
    expect(serialized).not.toContain('Raw body')
    expect(serialized).not.toContain('Draft field value')
    expect(serialized).not.toContain('hidden-token')
  })

  it('keeps terminal text transient while public result and tool-call events stay bounded', () => {
    const result = {
      ok: true,
      summary: 'Document text extracted.',
      data: {
        command: 'terminal_pdf_to_text',
        outputChars: 24,
        truncated: false,
        text: 'Meeting notes that must not enter a receipt.',
        accessToken: 'hidden-token',
      },
    }

    const publicResult = toPublicAssistantToolResult('terminal_pdf_to_text', result)
    const unknownError = toPublicAssistantToolResult('terminal_pdf_to_text', {
      ok: false,
      summary: 'The operation failed.',
      errorCode: 'authorization=hidden-token',
    })
    const unsafeSummary = toPublicAssistantToolResult('browser_snapshot', {
      ok: true,
      summary: 'Private page body with Private draft value',
    })
    const stalePreview = toPublicAssistantToolResult('file_apply_batch', {
      ok: false,
      summary: 'Private path C:/Users/private should not be exposed.',
      errorCode: 'stale_preview',
    })
    const transient = createTransientToolContext({ name: 'terminal_pdf_to_text' }, result)
    const publicCall = toPublicAssistantToolCall({
      id: 'call-1',
      runId: 'run-1',
      name: 'browser_fill_draft',
      intent: 'Fill a draft with Private draft value',
      arguments: { elementToken: 'element-1', pageRevision: 'r1', value: 'Private draft value', authorization: 'Bearer hidden-token' },
      status: 'queued',
      startedAt: 1,
    })

    expect(JSON.stringify(publicResult)).not.toContain('Meeting notes')
    expect(JSON.stringify(publicResult)).not.toContain('hidden-token')
    expect(unknownError.errorCode).toBe('tool_failed')
    expect(unsafeSummary.summary).toBe('受控工具已完成。')
    expect(stalePreview.summary).toBe('预览已过期，请重新生成。')
    expect(stalePreview.summary).not.toContain('C:/Users/private')
    expect(transient).toMatchObject({ source: { kind: 'terminal_document', text: 'Meeting notes that must not enter a receipt.' } })
    expect(publicCall.intent).toBe('browser_fill_draft')
    expect(publicCall.arguments).toEqual({ elementToken: 'element-1', pageRevision: 'r1' })
    expect(JSON.stringify(publicCall)).not.toContain('Private draft value')
  })

  it('removes model notes and sensitive preview text from public approval events', () => {
    const request = toPublicAssistantApprovalRequest({
      id: 'approval-1',
      revision: 'revision-1',
      risk: 'reversible',
      title: 'Fill Private draft value',
      targetSummary: 'https://example.com/private?access_token=hidden',
      impactSummary: 'Send Private draft value to the form.',
      reversible: true,
      expiresAt: 123,
      runId: 'run-1',
      toolCallId: 'call-1',
      reason: 'The form value is Private draft value.',
      allowedChoices: ['once', 'deny'],
      action: 'fillDraft',
      origin: 'https://example.com/private?access_token=hidden',
      pageTitle: 'Private page body',
      elementName: 'Email value person@example.com',
    }, 'browser_fill_draft')

    expect(request).toMatchObject({
      title: '受控工具：browser_fill_draft',
      targetSummary: 'https://example.com',
      origin: 'https://example.com',
      allowedChoices: ['once', 'deny'],
    })
    expect(JSON.stringify(request)).not.toContain('Private draft value')
    expect(JSON.stringify(request)).not.toContain('access_token')
    expect(JSON.stringify(request)).not.toContain('Private page body')
    expect(JSON.stringify(request)).not.toContain('person@example.com')
  })

  it('shows a bounded terminal target and explicit temporary model-export consent', () => {
    const request = toPublicAssistantApprovalRequest({
      id: 'terminal-approval-1',
      revision: 'terminal:1',
      risk: 'read',
      title: '提取 PDF 正文',
      targetSummary: 'sources/meeting-brief.pdf',
      impactSummary: '将以固定的只读文档工具提取有限正文；不会写入文件或启动 shell。',
      reversible: true,
      expiresAt: 123,
      runId: 'run-1',
      toolCallId: 'terminal-call',
      reason: '受控文档提取需要确认。',
      allowedChoices: ['once', 'deny'],
      modelDataHandling: { provider: 'scallion-agnes', maxChars: 48_000 },
    } as never, 'terminal_pdf_to_text')

    expect(request).toMatchObject({
      targetSummary: 'sources/meeting-brief.pdf',
      modelDataHandling: { provider: 'scallion-agnes', maxChars: 48_000 },
    })
  })
})
