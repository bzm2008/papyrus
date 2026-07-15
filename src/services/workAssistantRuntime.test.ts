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

  it('blocks later work after cancellation and clears the run approval', async () => {
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
    expect(resolveAssistantApproval('cancel-preview-2', 'deny')).toBe(false)
    await expect(secondApply).resolves.toMatchObject({ ok: false, errorCode: 'cancelled' })
  })

  it('does not start a native preview after the run is already cancelled', async () => {
    const invoke = vi.fn(async () => ({ id: 'late-preview', revision: '1', risk: 'reversible', title: '整理文件', targetSummary: 'Downloads', impactSummary: '移动文件', reversible: true, expiresAt: Date.now() + 60_000 }))
    setWorkAssistantInvokerForTests(invoke)
    dispatchOrderedWorkAssistantEvent({ type: 'run.cancelled', runId: 'run-pre-cancelled', at: Date.now() })

    const result = await executeAssistantToolCall({
      runId: 'run-pre-cancelled',
      toolCall: call('file_plan_batch', {
        rootId: 'downloads',
        conflictPolicy: 'rename',
        operations: [{ kind: 'move', source: 'inbox/a.pdf', destination: 'PDF/a.pdf' }],
      }),
    })

    expect(result).toMatchObject({ ok: false, errorCode: 'cancelled' })
    expect(invoke).not.toHaveBeenCalledWith('work_assistant_preview', expect.anything())
  })

  it('cancels an in-flight native file execution before it can finish', async () => {
    let resolveExecute: ((value: Record<string, unknown>) => void) | undefined
    let resolveExecuteStarted: (() => void) | undefined
    let cancelCalled = false
    const executeStarted = new Promise<void>((resolve) => { resolveExecuteStarted = resolve })
    const invoke = vi.fn((command: string) => {
      if (command === 'work_assistant_preview') {
        return Promise.resolve({ id: 'in-flight-preview', revision: '1', risk: 'reversible', title: '整理文件', targetSummary: 'Downloads', impactSummary: '移动文件', reversible: true, scope: ['downloads'], expiresAt: Date.now() + 60_000 })
      }
      if (command === 'work_assistant_approve') {
        return Promise.resolve({ token: 'in-flight-token', previewId: 'in-flight-preview', expires: Date.now() + 60_000 })
      }
      if (command === 'work_assistant_execute') {
        resolveExecuteStarted?.()
        return new Promise<Record<string, unknown>>((resolve) => { resolveExecute = resolve })
      }
      if (command === 'work_assistant_cancel_run') {
        cancelCalled = true
        return Promise.resolve(undefined)
      }
      return Promise.resolve(undefined)
    })
    setWorkAssistantInvokerForTests(invoke)
    const controller = new AbortController()
    const args = { rootId: 'downloads', conflictPolicy: 'rename', operations: [{ kind: 'move', source: 'inbox/a.pdf', destination: 'PDF/a.pdf' }] }

    await executeAssistantToolCall({ runId: 'run-in-flight', toolCall: call('file_plan_batch', args, 'in-flight-plan') })
    const pending = executeAssistantToolCall({ runId: 'run-in-flight', toolCall: call('file_apply_batch', { previewId: 'in-flight-preview' }, 'in-flight-apply'), signal: controller.signal })
    await Promise.resolve()
    expect(resolveAssistantApproval('in-flight-preview', 'once')).toBe(true)
    await executeStarted

    controller.abort()
    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: 'cancelled' })
    expect(cancelCalled).toBe(true)
    resolveExecute?.({ completed: [], skipped: [], failed: [], remaining: [], cancelled: true })
  })

  it('cancels a native execution when the run event arrives without a signal', async () => {
    let resolveExecute: ((value: Record<string, unknown>) => void) | undefined
    const invoke = vi.fn((command: string) => {
      if (command === 'work_assistant_preview') {
        return Promise.resolve({ id: 'event-preview', revision: '1', risk: 'reversible', title: '整理文件', targetSummary: 'Downloads', impactSummary: '移动文件', reversible: true, expiresAt: Date.now() + 60_000 })
      }
      if (command === 'work_assistant_approve') {
        return Promise.resolve({ token: 'event-token', previewId: 'event-preview', expires: Date.now() + 60_000 })
      }
      if (command === 'work_assistant_execute') {
        return new Promise<Record<string, unknown>>((resolve) => { resolveExecute = resolve })
      }
      return Promise.resolve(undefined)
    })
    setWorkAssistantInvokerForTests(invoke)
    const args = { rootId: 'downloads', conflictPolicy: 'rename', operations: [{ kind: 'move', source: 'inbox/a.pdf', destination: 'PDF/a.pdf' }] }

    await executeAssistantToolCall({ runId: 'run-event-cancel', toolCall: call('file_plan_batch', args, 'event-plan') })
    const pending = executeAssistantToolCall({ runId: 'run-event-cancel', toolCall: call('file_apply_batch', { previewId: 'event-preview' }, 'event-apply') })
    await Promise.resolve()
    expect(resolveAssistantApproval('event-preview', 'once')).toBe(true)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('work_assistant_execute', expect.anything()))

    dispatchOrderedWorkAssistantEvent({ type: 'run.cancelled', runId: 'run-event-cancel', at: Date.now() })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('work_assistant_cancel_run', { run: 'run-event-cancel' }))
    resolveExecute?.({ completed: [], skipped: [], failed: [], remaining: [], cancelled: true })

    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: 'cancelled' })
  })

  it('does not start a native tool after a terminal run event', async () => {
    const invoke = vi.fn(async () => undefined)
    setWorkAssistantInvokerForTests(invoke)
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: 'run-ended', at: Date.now() })
    dispatchOrderedWorkAssistantEvent({ type: 'run.completed', runId: 'run-ended', response: 'done', at: Date.now() })

    const result = await executeAssistantToolCall({
      runId: 'run-ended',
      toolCall: call('file_plan_batch', {
        rootId: 'downloads',
        conflictPolicy: 'rename',
        operations: [{ kind: 'move', source: 'inbox/a.pdf', destination: 'PDF/a.pdf' }],
      }),
    })

    expect(result).toMatchObject({ ok: false, errorCode: 'run_ended' })
    expect(invoke).not.toHaveBeenCalledWith('work_assistant_preview', expect.anything())
  })

  it('reuses a structured run grant only for a narrower item bound', async () => {
    let previewNumber = 0
    const scope = (maxItemCount: number) => JSON.stringify({
      version: 1,
      toolName: 'file_apply_batch',
      rootId: 'downloads',
      targetParent: 'sha256:archive',
      conflictPolicy: 'rename',
      operationKind: 'move',
      maxItemCount,
    })
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') {
        previewNumber += 1
        const maxItemCount = previewNumber === 1 ? 2 : previewNumber === 2 ? 1 : 3
        return { id: `bounded-preview-${previewNumber}`, revision: '1', risk: 'reversible', title: '整理文件', targetSummary: 'Downloads', impactSummary: '移动文件', reversible: true, scope: [scope(maxItemCount)], expiresAt: Date.now() + 60_000 }
      }
      if (command === 'work_assistant_approve') return { token: `bounded-token-${previewNumber}`, previewId: `bounded-preview-${previewNumber}`, expires: Date.now() + 60_000 }
      if (command === 'work_assistant_execute') return { completed: [{ index: 0 }], skipped: [], failed: [], remaining: [], cancelled: false }
      return undefined
    })
    setWorkAssistantInvokerForTests(invoke)
    const args = { rootId: 'downloads', conflictPolicy: 'rename', operations: [{ kind: 'move', source: 'inbox/a.pdf', destination: 'archive/a.pdf' }] }

    await executeAssistantToolCall({ runId: 'run-bounded-scope', toolCall: call('file_plan_batch', args, 'bounded-plan-1') })
    const firstApply = executeAssistantToolCall({ runId: 'run-bounded-scope', toolCall: call('file_apply_batch', { previewId: 'bounded-preview-1' }, 'bounded-apply-1') })
    await Promise.resolve()
    expect(resolveAssistantApproval('bounded-preview-1', 'run')).toBe(true)
    await expect(firstApply).resolves.toMatchObject({ ok: true })

    await executeAssistantToolCall({ runId: 'run-bounded-scope', toolCall: call('file_plan_batch', args, 'bounded-plan-2') })
    const narrowerApply = executeAssistantToolCall({ runId: 'run-bounded-scope', toolCall: call('file_apply_batch', { previewId: 'bounded-preview-2' }, 'bounded-apply-2') })
    await Promise.resolve()
    expect(resolveAssistantApproval('bounded-preview-2', 'deny')).toBe(false)
    await expect(narrowerApply).resolves.toMatchObject({ ok: true })

    await executeAssistantToolCall({ runId: 'run-bounded-scope', toolCall: call('file_plan_batch', args, 'bounded-plan-3') })
    const largerApply = executeAssistantToolCall({ runId: 'run-bounded-scope', toolCall: call('file_apply_batch', { previewId: 'bounded-preview-3' }, 'bounded-apply-3') })
    await Promise.resolve()
    expect(resolveAssistantApproval('bounded-preview-3', 'once')).toBe(true)
    await expect(largerApply).resolves.toMatchObject({ ok: true })
    expect(invoke.mock.calls.filter(([command]) => command === 'work_assistant_approve')).toHaveLength(2)
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
