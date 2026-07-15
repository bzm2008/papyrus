import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  approveBrowserAction,
  browserFillDraft,
  browserClick,
  browserDownload,
  browserSubmit,
  browserSnapshot,
  executeApprovedBrowserAction,
  getBrowserBridgeStatus,
  openBrowserBridgeTab,
  resetBrowserBridgeInvokerForTests,
  setBrowserBridgeInvokerForTests,
  startBrowserActionPreview,
  startBrowserBridgePairing,
} from './browserBridgeClient'

afterEach(() => resetBrowserBridgeInvokerForTests())

describe('browser bridge client contract', () => {
  it('uses typed pairing/status commands and keeps secrets out of status calls', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'browser_bridge_start_pairing') return { sessionId: 's1', token: 't1', nonce: 'n1', wsUrl: 'ws://127.0.0.1:1/bridge', expiresAt: 10 }
      return { running: true, paired: false }
    })
    setBrowserBridgeInvokerForTests(invoke)

    await expect(startBrowserBridgePairing()).resolves.toMatchObject({ sessionId: 's1' })
    await expect(getBrowserBridgeStatus()).resolves.toMatchObject({ running: true, paired: false })
    expect(invoke).toHaveBeenNthCalledWith(1, 'browser_bridge_start_pairing', undefined)
    expect(invoke).toHaveBeenNthCalledWith(2, 'browser_bridge_status', undefined)
  })

  it('binds browser actions to a preview, approval, and one-time execution grant', async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'browser_snapshot') return { url: 'https://example.com', title: 'Example', text: '', elements: [], pageRevision: 'r1' }
      if (command === 'work_assistant_browser_preview_action') return { id: 'preview-1', revision: 'r1', action: 'fillDraft', actionHash: 'hash-1', risk: 'reversible', title: '填写草稿', targetSummary: 'Example', impactSummary: '仅填写草稿', reversible: true, expiresAt: 10, origin: 'https://example.com', pageTitle: 'Example' }
      if (command === 'work_assistant_browser_approve_action') return { token: 'grant-1', previewId: 'preview-1', actionHash: 'hash-1', expires: 10 }
      return { ok: true, summary: '已填写草稿，尚未提交。', data: args }
    })
    setBrowserBridgeInvokerForTests(invoke)

    await browserSnapshot('r0')
    const preview = await startBrowserActionPreview({
      action: 'fillDraft',
      runId: 'run-1',
      toolCallId: 'tool-1',
      elementToken: 'element-1',
      value: 'draft',
      pageRevision: 'r1',
      snapshotId: 'snapshot-1',
    })
    const grant = await approveBrowserAction(preview.id, 'run-1')
    await executeApprovedBrowserAction({ previewId: grant.previewId, approvalToken: grant.token, actionHash: grant.actionHash })
    expect(invoke).toHaveBeenNthCalledWith(1, 'browser_snapshot', { pageRevision: 'r0' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'work_assistant_browser_preview_action', {
      action: 'fillDraft',
      runId: 'run-1',
      toolCallId: 'tool-1',
      elementToken: 'element-1',
      value: 'draft',
      pageRevision: 'r1',
      snapshotId: 'snapshot-1',
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'work_assistant_browser_approve_action', {
      previewId: 'preview-1',
      runId: 'run-1',
      choice: 'once',
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'work_assistant_browser_execute_action', {
      previewId: 'preview-1',
      approvalToken: 'grant-1',
      actionHash: 'hash-1',
    })
  })

  it('never sends a legacy browser action without an approval grant', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    setBrowserBridgeInvokerForTests(invoke)

    await expect(browserFillDraft('element-1', 'draft', 'r1')).rejects.toThrow('必须先经过预览和用户批准')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('forwards the typed target arguments together with the approval grant', async () => {
    const invoke = vi.fn(async () => ({ ok: true, summary: 'ok' }))
    setBrowserBridgeInvokerForTests(invoke)
    const approval = { previewId: 'preview-1', approvalToken: 'grant-1', actionHash: 'hash-1' }

    await browserFillDraft('element-1', 'draft', 'revision-1', approval)
    await browserClick('element-2', 'revision-2', approval)
    await browserDownload('element-3', 'revision-3', 'root-1', approval)
    await browserSubmit('element-4', 'revision-4', approval)
    await openBrowserBridgeTab('https://example.com/article', approval)

    expect(invoke).toHaveBeenNthCalledWith(1, 'browser_fill_draft', {
      elementToken: 'element-1', value: 'draft', pageRevision: 'revision-1', ...approval,
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'browser_click', {
      elementToken: 'element-2', pageRevision: 'revision-2', ...approval,
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'browser_download', {
      elementToken: 'element-3', pageRevision: 'revision-3', directoryRootId: 'root-1', ...approval,
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'browser_submit', {
      elementToken: 'element-4', pageRevision: 'revision-4', ...approval,
    })
    expect(invoke).toHaveBeenNthCalledWith(5, 'browser_open', {
      url: 'https://example.com/article', ...approval,
    })
  })
})
