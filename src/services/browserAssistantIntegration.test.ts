import { afterEach, describe, expect, it, vi } from 'vitest'

import { setBrowserBridgeInvokerForTests, resetBrowserBridgeInvokerForTests } from './browserBridgeClient'
import {
  executeAssistantToolCall,
  resetWorkAssistantRuntimeForTests,
  resolveAssistantApproval,
} from './workAssistantRuntime'
import type { AssistantToolCall, WorkAssistantEvent } from './workAssistantProtocol'

const call = (name: string, argumentsValue: Record<string, unknown>, id = name): AssistantToolCall => ({
  id,
  runId: 'browser-run',
  name,
  intent: name,
  arguments: argumentsValue,
  status: 'queued',
  startedAt: 1,
})

afterEach(() => {
  resetWorkAssistantRuntimeForTests()
  resetBrowserBridgeInvokerForTests()
})

describe('browser assistant integration', () => {
  it('reads a snapshot and keeps draft fill behind one approval', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'browser_snapshot') return { url: 'https://example.com', title: 'Example', text: 'Public', elements: [], pageRevision: 'r1' }
      if (command === 'work_assistant_browser_preview_action') return { id: 'preview-fill', revision: 'r1', action: 'fillDraft', actionHash: 'hash-fill', risk: 'reversible', title: '填写草稿', targetSummary: 'Example · 标题', impactSummary: '填写普通文本草稿，不会提交', reversible: true, expiresAt: Date.now() + 60_000, origin: 'https://example.com', pageTitle: 'Example' }
      if (command === 'work_assistant_browser_approve_action') return { token: 'approval-fill', previewId: 'preview-fill', actionHash: 'hash-fill', expires: Date.now() + 60_000 }
      return { ok: true, summary: '已填写草稿，尚未提交。' }
    })
    setBrowserBridgeInvokerForTests(invoke)

    const snapshot = await executeAssistantToolCall({ runId: 'browser-run', toolCall: call('browser_snapshot', {}) })
    expect(snapshot.ok).toBe(true)
    expect(invoke).toHaveBeenCalledWith('browser_snapshot', { runId: 'browser-run' })
    const events: WorkAssistantEvent[] = []
    const pending = executeAssistantToolCall({
      runId: 'browser-run',
      toolCall: call('browser_fill_draft', { elementToken: 'e1', pageRevision: 'r1', value: 'draft' }, 'fill'),
      emit: (event) => events.push(event),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const approval = events.find((event): event is Extract<WorkAssistantEvent, { type: 'approval.required' }> => event.type === 'approval.required')
    expect(approval?.request.risk).toBe('reversible')
    expect(approval && resolveAssistantApproval(approval.request.id, 'once')).toBe(true)
    await expect(pending).resolves.toMatchObject({ ok: true })
    expect(invoke).toHaveBeenCalledWith('work_assistant_browser_execute_action', {
      previewId: 'preview-fill',
      approvalToken: 'approval-fill',
      actionHash: 'hash-fill',
    })
  })

  it('requires high-risk approval for submit and preserves a denied draft', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_browser_preview_action') return { id: 'preview-submit', revision: 'r1', action: 'submit', actionHash: 'hash-submit', risk: 'high', title: '提交表单', targetSummary: 'Example · 保存', impactSummary: '提交当前标签页中的普通表单', reversible: false, expiresAt: Date.now() + 60_000, origin: 'https://example.com', pageTitle: 'Example' }
      return { ok: true, summary: 'should not run' }
    })
    setBrowserBridgeInvokerForTests(invoke)
    const events: WorkAssistantEvent[] = []
    const pending = executeAssistantToolCall({
      runId: 'browser-run',
      toolCall: call('browser_submit', { elementToken: 'submit', pageRevision: 'r1' }, 'submit'),
      emit: (event) => events.push(event),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const approval = events.find((event): event is Extract<WorkAssistantEvent, { type: 'approval.required' }> => event.type === 'approval.required')
    expect(approval?.request.risk).toBe('high')
    expect(approval && resolveAssistantApproval(approval.request.id, 'deny')).toBe(true)
    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: 'cancelled' })
    expect(invoke).not.toHaveBeenCalledWith('browser_submit', expect.anything())
  })

  it('aborts at the browser approval boundary and never sends the action', async () => {
    const controller = new AbortController()
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_browser_preview_action') {
        return { id: 'preview-cancel', revision: 'r1', action: 'submit', actionHash: 'hash-cancel', risk: 'high', title: '提交表单', targetSummary: 'Example', impactSummary: '提交表单', reversible: false, expiresAt: Date.now() + 60_000, origin: 'https://example.com', pageTitle: 'Example' }
      }
      if (command === 'work_assistant_browser_approve_action') {
        // Resolve the native grant and abort before the runtime can cross the
        // final execute boundary. callWithAbort must turn this into a cancel.
        await Promise.resolve()
        controller.abort()
        return { token: 'approval-cancel', previewId: 'preview-cancel', actionHash: 'hash-cancel', expires: Date.now() + 60_000 }
      }
      if (command === 'work_assistant_browser_cancel_run' || command === 'work_assistant_cancel_run') return undefined
      if (command === 'work_assistant_browser_execute_action') throw new Error('execute must not be called after cancellation')
      return { ok: true, summary: 'unexpected browser action' }
    })
    setBrowserBridgeInvokerForTests(invoke)
    const events: WorkAssistantEvent[] = []
    const pending = executeAssistantToolCall({
      runId: 'browser-cancel-run',
      toolCall: call('browser_submit', { elementToken: 'submit', pageRevision: 'r1' }, 'cancel-submit'),
      emit: (event) => events.push(event),
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const approval = events.find((event): event is Extract<WorkAssistantEvent, { type: 'approval.required' }> => event.type === 'approval.required')
    expect(approval && resolveAssistantApproval(approval.request.id, 'once')).toBe(true)

    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: 'cancelled' })
    expect(invoke).not.toHaveBeenCalledWith('work_assistant_browser_execute_action', expect.anything())
    expect(invoke).toHaveBeenCalledWith('work_assistant_browser_cancel_run', { run: 'browser-cancel-run' })
  })

  it('marks an approved browser action as uncertain when cancellation races with execution', async () => {
    const controller = new AbortController()
    let releaseExecution: ((value: unknown) => void) | undefined
    const invoke = vi.fn((command: string) => {
      if (command === 'work_assistant_browser_preview_action') {
        return Promise.resolve({ id: 'preview-race', revision: 'r1', action: 'submit', actionHash: 'hash-race', risk: 'high', title: '提交表单', targetSummary: 'Example', impactSummary: '提交表单', reversible: false, expiresAt: Date.now() + 60_000, origin: 'https://example.com', pageTitle: 'Example' })
      }
      if (command === 'work_assistant_browser_approve_action') {
        return Promise.resolve({ token: 'approval-race', previewId: 'preview-race', actionHash: 'hash-race', expires: Date.now() + 60_000 })
      }
      if (command === 'work_assistant_browser_execute_action') {
        return new Promise((resolve) => { releaseExecution = resolve })
      }
      if (command === 'work_assistant_browser_cancel_run') return Promise.resolve(undefined)
      return Promise.resolve({ ok: true, summary: 'unexpected browser action' })
    })
    setBrowserBridgeInvokerForTests(invoke)
    const events: WorkAssistantEvent[] = []
    const pending = executeAssistantToolCall({
      runId: 'browser-race-run',
      toolCall: call('browser_submit', { elementToken: 'submit', pageRevision: 'r1' }, 'race-submit'),
      emit: (event) => events.push(event),
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const approval = events.find((event): event is Extract<WorkAssistantEvent, { type: 'approval.required' }> => event.type === 'approval.required')
    expect(approval && resolveAssistantApproval(approval.request.id, 'once')).toBe(true)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('work_assistant_browser_execute_action', expect.anything()))

    controller.abort()
    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: 'request_uncertain' })
    expect(invoke).toHaveBeenCalledWith('work_assistant_browser_cancel_run', { run: 'browser-race-run' })
    releaseExecution?.({ ok: true, summary: '已提交' })
  })

  it('does not invoke the browser bridge when the run is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_browser_cancel_run' || command === 'work_assistant_cancel_run') return undefined
      throw new Error(`browser command should not start: ${command}`)
    })
    setBrowserBridgeInvokerForTests(invoke)

    const pending = executeAssistantToolCall({
      runId: 'browser-pre-aborted',
      toolCall: call('browser_snapshot', {}, 'pre-aborted-snapshot'),
      signal: controller.signal,
    })

    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: 'cancelled' })
    expect(invoke).toHaveBeenCalledWith('work_assistant_browser_cancel_run', { run: 'browser-pre-aborted' })
    expect(invoke.mock.calls.some(([command]) => command === 'work_assistant_browser_snapshot')).toBe(false)
  })
})
