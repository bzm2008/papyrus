import { afterEach, describe, expect, it, vi } from 'vitest'

import { setWorkAssistantInvokerForTests } from './workAssistantClient'
import { resetBrowserBridgeInvokerForTests, setBrowserBridgeInvokerForTests } from './browserBridgeClient'
import {
  dispatchOrderedWorkAssistantEvent,
  executeAssistantToolCall,
  flushAllWorkAssistantDeltas,
  resetWorkAssistantRuntimeForTests,
  resolveAssistantApproval,
} from './workAssistantRuntime'
import type { AssistantToolCall, WorkAssistantEvent } from './workAssistantProtocol'
import { useWorkAssistantStore } from '../stores/useWorkAssistantStore'
import { useAppStore } from '../stores/useAppStore'

const call = (name: string, args: Record<string, unknown> = {}, id = `call-${name}`): AssistantToolCall => ({
  id, runId: 'run-1', name, intent: name, arguments: args, status: 'queued', startedAt: 1,
})

afterEach(() => {
  vi.useRealTimers()
  resetWorkAssistantRuntimeForTests()
  resetBrowserBridgeInvokerForTests()
  useAppStore.setState({ resources: [] })
})

describe('work assistant runtime', () => {
  it('executes read tools without approval', async () => {
    const invoke = vi.fn(async () => [{ id: 'root', label: 'Downloads', path: 'C:/Users/private', kind: 'downloads' }])
    setWorkAssistantInvokerForTests(invoke)
    const events: WorkAssistantEvent[] = []

    const result = await executeAssistantToolCall({ runId: 'run-1', toolCall: call('workspace_list'), emit: (event) => events.push(event) })

    expect(result.ok).toBe(true)
    expect(events.map((event) => event.type)).toEqual(['tool.started', 'tool.completed'])
    expect(invoke).toHaveBeenCalledWith('work_assistant_workspace_list', undefined)
    expect(JSON.stringify(result.data)).not.toContain('C:/Users/private')
  })

  it('previews, waits for approval, approves, then executes an existing file preview', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') return { id: 'preview-1', revision: '1', risk: 'reversible', title: '整理文件', targetSummary: 'Downloads', impactSummary: '移动 2 个文件', reversible: true, expiresAt: 999 }
      if (command === 'work_assistant_approve') return { token: 'token-1', previewId: 'preview-1', expires: 999 }
      if (command === 'work_assistant_execute') return { completed: [{ index: 0 }], skipped: [], failed: [], remaining: [], cancelled: false }
      return undefined
    })
    setWorkAssistantInvokerForTests(invoke)
    await executeAssistantToolCall({ runId: 'run-1', toolCall: call('file_plan_batch', { rootId: 'downloads', operations: [], conflictPolicy: 'skip' }) })

    const promise = executeAssistantToolCall({ runId: 'run-1', toolCall: call('file_apply_batch', { previewId: 'preview-1' }) })
    await Promise.resolve()
    expect(resolveAssistantApproval('preview-1', 'once')).toBe(true)
    const result = await promise

    expect(result.ok).toBe(true)
    expect(invoke.mock.calls.map(([command]) => command)).toContain('work_assistant_approve')
    expect(invoke.mock.calls.map(([command]) => command)).toContain('work_assistant_execute')
  })

  it('reuses a reversible run approval for the same file scope without prompting again', async () => {
    let previewNumber = 0
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') {
        previewNumber += 1
        return { id: `preview-${previewNumber}`, revision: '1', risk: 'reversible', title: '整理文件', targetSummary: 'Downloads', impactSummary: '移动文件', reversible: true, scope: ['downloads'], expiresAt: Date.now() + 60_000 }
      }
      if (command === 'work_assistant_approve') return { token: `token-${previewNumber}`, previewId: `preview-${previewNumber}`, expires: Date.now() + 60_000 }
      if (command === 'work_assistant_execute') return { completed: [{ index: 0 }], skipped: [], failed: [], remaining: [], cancelled: false }
      return undefined
    })
    setWorkAssistantInvokerForTests(invoke)
    const args = { rootId: 'downloads', conflictPolicy: 'rename', operations: [{ kind: 'move', source: 'inbox/a.pdf', destination: 'PDF/a.pdf' }] }

    await executeAssistantToolCall({ runId: 'run-scope', toolCall: call('file_plan_batch', args, 'plan-1') })
    const firstApply = executeAssistantToolCall({ runId: 'run-scope', toolCall: call('file_apply_batch', { previewId: 'preview-1' }, 'apply-1') })
    await Promise.resolve()
    expect(resolveAssistantApproval('preview-1', 'run')).toBe(true)
    await expect(firstApply).resolves.toMatchObject({ ok: true })

    await executeAssistantToolCall({ runId: 'run-scope', toolCall: call('file_plan_batch', args, 'plan-2') })
    const secondApply = executeAssistantToolCall({ runId: 'run-scope', toolCall: call('file_apply_batch', { previewId: 'preview-2' }, 'apply-2') })
    await Promise.resolve()

    expect(resolveAssistantApproval('preview-2', 'deny')).toBe(false)
    await expect(secondApply).resolves.toMatchObject({ ok: true })
    expect(invoke.mock.calls.filter(([command]) => command === 'work_assistant_approve')).toHaveLength(1)
  })

  it('clears a run approval after cancellation so the next scope needs confirmation', async () => {
    let previewNumber = 0
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') {
        previewNumber += 1
        return { id: `cancel-preview-${previewNumber}`, revision: '1', risk: 'reversible', title: '整理文件', targetSummary: 'Downloads', impactSummary: '移动文件', reversible: true, scope: ['downloads'], expiresAt: Date.now() + 60_000 }
      }
      if (command === 'work_assistant_approve') return { token: `cancel-token-${previewNumber}`, previewId: `cancel-preview-${previewNumber}`, expires: Date.now() + 60_000 }
      if (command === 'work_assistant_execute') return { completed: [{ index: 0 }], skipped: [], failed: [], remaining: [], cancelled: false }
      return undefined
    })
    setWorkAssistantInvokerForTests(invoke)
    const args = { rootId: 'downloads', conflictPolicy: 'rename', operations: [{ kind: 'move', source: 'inbox/a.pdf', destination: 'PDF/a.pdf' }] }

    await executeAssistantToolCall({ runId: 'run-cancel-scope', toolCall: call('file_plan_batch', args, 'cancel-plan-1') })
    const firstApply = executeAssistantToolCall({ runId: 'run-cancel-scope', toolCall: call('file_apply_batch', { previewId: 'cancel-preview-1' }, 'cancel-apply-1') })
    await Promise.resolve()
    expect(resolveAssistantApproval('cancel-preview-1', 'run')).toBe(true)
    await expect(firstApply).resolves.toMatchObject({ ok: true })

    dispatchOrderedWorkAssistantEvent({ type: 'run.cancelled', runId: 'run-cancel-scope', at: Date.now() })
    await executeAssistantToolCall({ runId: 'run-cancel-scope', toolCall: call('file_plan_batch', args, 'cancel-plan-2') })
    const secondApply = executeAssistantToolCall({ runId: 'run-cancel-scope', toolCall: call('file_apply_batch', { previewId: 'cancel-preview-2' }, 'cancel-apply-2') })
    await Promise.resolve()
    expect(resolveAssistantApproval('cancel-preview-2', 'deny')).toBe(true)
    await expect(secondApply).resolves.toMatchObject({ ok: false, errorCode: 'cancelled' })
  })

  it('denies an approval without invoking the action', async () => {
    const invoke = vi.fn(async () => undefined)
    setWorkAssistantInvokerForTests(invoke)
    const promise = executeAssistantToolCall({ runId: 'run-1', toolCall: call('desktop_open_url', { url: 'https://example.com' }) })
    await Promise.resolve()
    expect(resolveAssistantApproval('approval-call-desktop_open_url', 'deny')).toBe(true)
    const result = await promise

    expect(result).toMatchObject({ ok: false, errorCode: 'cancelled', recoverable: true })
    expect(invoke).not.toHaveBeenCalledWith('work_assistant_desktop_open_url', expect.anything())
  })

  it('derives high-risk approval choices without a run-scoped grant', async () => {
    const invoke = vi.fn(async () => undefined)
    setWorkAssistantInvokerForTests(invoke)
    const events: WorkAssistantEvent[] = []
    const promise = executeAssistantToolCall({
      runId: 'run-1',
      toolCall: call('desktop_open_app', { appId: 'editor' }),
      emit: (event) => events.push(event),
    })
    await Promise.resolve()
    const approval = events.find((event): event is Extract<WorkAssistantEvent, { type: 'approval.required' }> => event.type === 'approval.required')
    expect(approval?.request.allowedChoices).toEqual(['once', 'deny'])
    expect(resolveAssistantApproval(approval?.request.id ?? '', 'deny')).toBe(true)
    await expect(promise).resolves.toMatchObject({ ok: false, errorCode: 'cancelled' })
  })

  it('aborts pending approval and invokes native cancellation', async () => {
    const invoke = vi.fn(async () => undefined)
    setWorkAssistantInvokerForTests(invoke)
    const controller = new AbortController()
    const promise = executeAssistantToolCall({ runId: 'run-1', toolCall: call('desktop_open_app', { appId: 'editor' }), signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    const result = await promise

    expect(result.errorCode).toBe('cancelled')
    expect(invoke).toHaveBeenCalledWith('work_assistant_cancel_run', { run: 'run-1' })
  })

  it('trips the duplicate failure guard on the third attempt', async () => {
    const invoke = vi.fn(async () => { throw new Error('offline') })
    setWorkAssistantInvokerForTests(invoke)
    const tool = call('workspace_scan', { rootId: 'root' }, 'same')
    await executeAssistantToolCall({ runId: 'run-1', toolCall: tool })
    await executeAssistantToolCall({ runId: 'run-1', toolCall: tool })
    const third = await executeAssistantToolCall({ runId: 'run-1', toolCall: tool })

    expect(third.errorCode).toBe('loop_guard')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('routes web extraction and project archiving through the approval boundary', async () => {
    const extracted = {
      url: 'https://example.com/research?utm_source=mail',
      canonicalUrl: 'https://example.com/research',
      title: '研究页面',
      text: '这是经过提取的网页正文。',
      links: [],
      truncated: false,
    }
    setBrowserBridgeInvokerForTests(async (command) => {
      if (command === 'web_extract') return extracted
      throw new Error(`unexpected command: ${command}`)
    })

    const extraction = await executeAssistantToolCall({
      runId: 'run-archive',
      toolCall: call('web_extract', { url: extracted.url }),
    })
    const extractId = extraction.data?.extractId
    expect(typeof extractId).toBe('string')

    const events: WorkAssistantEvent[] = []
    const archive = executeAssistantToolCall({
      runId: 'run-archive',
      toolCall: call('web_archive', { extractId, resourceName: '归档研究' }, 'archive'),
      emit: (event) => events.push(event),
    })
    await Promise.resolve()
    const approval = events.find((event): event is Extract<WorkAssistantEvent, { type: 'approval.required' }> => event.type === 'approval.required')
    expect(approval?.request.reason).toContain('归档研究')
    expect(approval && resolveAssistantApproval(approval.request.id, 'once')).toBe(true)

    const result = await archive
    expect(result).toMatchObject({ ok: true })
    expect(useAppStore.getState().resources).toHaveLength(1)
    expect(useAppStore.getState().resources[0]).toMatchObject({ type: 'html', name: '归档研究', canonicalUrl: 'https://example.com/research' })
  })

  it('coalesces deltas and flushes text before a tool event', () => {
    vi.useFakeTimers()
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: 'run-1', at: 1 })
    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId: 'run-1', messageId: 'm1', delta: '先', at: 2 })
    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId: 'run-1', messageId: 'm1', delta: '搜索', at: 3 })
    dispatchOrderedWorkAssistantEvent({ type: 'stage.changed', runId: 'run-1', stage: 'tool', at: 4 })

    expect(useWorkAssistantStore.getState().runs['run-1']).toMatchObject({ messageText: '先搜索', stage: 'tool' })
    flushAllWorkAssistantDeltas()
  })
})
