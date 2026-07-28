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

  it('denies an approval without invoking the action', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') {
        return {
          id: 'native-url-preview', revision: '1', risk: 'reversible', title: '打开链接',
          targetSummary: 'HTTP(S) 链接', impactSummary: '将在确认后打开链接。', reversible: true, expiresAt: 999,
        }
      }
      throw new Error(`unexpected command: ${command}`)
    })
    setWorkAssistantInvokerForTests(invoke)
    const promise = executeAssistantToolCall({ runId: 'run-1', toolCall: call('desktop_open_url', { url: 'https://example.com' }) })
    await Promise.resolve()
    expect(resolveAssistantApproval('native-url-preview', 'deny')).toBe(true)
    const result = await promise

    expect(result).toMatchObject({ ok: false, errorCode: 'cancelled', recoverable: true })
    expect(invoke).not.toHaveBeenCalledWith('work_assistant_desktop_open_url', expect.anything())
  })

  it('binds URL, file open, and file reveal to native preview tokens', async () => {
    const cases = [
      { name: 'desktop_open_url', arguments: { url: 'https://example.com' } },
      { name: 'file_open', arguments: { rootId: 'root-1', path: 'brief.docx' } },
      { name: 'desktop_reveal_file', arguments: { rootId: 'root-1', path: 'brief.docx' } },
    ] as const

    for (const testCase of cases) {
      const previewId = `native-${testCase.name}`
      const invoke = vi.fn(async (command: string) => {
        if (command === 'work_assistant_preview') {
          return {
            id: previewId, revision: '7', risk: 'reversible', title: '桌面操作',
            targetSummary: '已授权目标', impactSummary: '将按确认执行。', reversible: true, expiresAt: 999,
          }
        }
        if (command === 'work_assistant_approve') return { token: `token-${testCase.name}`, previewId, expires: 999 }
        if (command === 'work_assistant_execute_native_action') return { ok: true, summary: '已执行受控操作。' }
        throw new Error(`unexpected command: ${command}`)
      })
      setWorkAssistantInvokerForTests(invoke)
      const pending = executeAssistantToolCall({
        runId: 'run-1',
        toolCall: call(testCase.name, testCase.arguments),
      })
      await Promise.resolve()
      expect(resolveAssistantApproval(previewId, 'once')).toBe(true)
      await expect(pending).resolves.toMatchObject({ ok: true })
      expect(invoke.mock.calls.map(([command]) => command)).toEqual([
        'work_assistant_preview',
        'work_assistant_approve',
        'work_assistant_execute_native_action',
      ])
    }
  })

  it('derives high-risk approval choices without a run-scoped grant', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') {
        return {
          id: 'native-preview-deny', revision: '1', risk: 'high', title: '启动应用',
          targetSummary: '已识别应用', impactSummary: '将在确认后启动应用。', reversible: false, expiresAt: 999,
        }
      }
      return undefined
    })
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

  it('binds application launch to a native preview and one-time approval token', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') {
        return {
          id: 'native-preview-1', revision: '42', risk: 'high', title: '启动应用',
          targetSummary: '已识别应用', impactSummary: '将在确认后启动应用。', reversible: false, expiresAt: 999,
        }
      }
      if (command === 'work_assistant_approve') {
        return { token: 'native-token-1', previewId: 'native-preview-1', expires: 999 }
      }
      if (command === 'work_assistant_execute_native_action') {
        return { ok: true, summary: '应用已启动。', data: { launched: true } }
      }
      throw new Error(`unexpected command: ${command}`)
    })
    setWorkAssistantInvokerForTests(invoke)
    const events: WorkAssistantEvent[] = []
    const pending = executeAssistantToolCall({
      runId: 'run-1',
      toolCall: call('desktop_open_app', { appId: 'browser:chrome' }),
      emit: (event) => events.push(event),
    })
    await Promise.resolve()
    const approval = events.find((event): event is Extract<WorkAssistantEvent, { type: 'approval.required' }> => event.type === 'approval.required')
    expect(approval?.request.allowedChoices).toEqual(['once', 'deny'])
    expect(resolveAssistantApproval(approval?.request.id ?? '', 'once')).toBe(true)
    await expect(pending).resolves.toMatchObject({ ok: true, summary: '应用已启动。' })

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'work_assistant_preview',
      'work_assistant_approve',
      'work_assistant_execute_native_action',
    ])
    expect(invoke).not.toHaveBeenCalledWith('work_assistant_launch_application', expect.anything())
  })

  it('cancels a native action when the run is aborted immediately after approval resolves', async () => {
    const controller = new AbortController()
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') {
        return {
          id: 'native-preview-cancel-race', revision: '45', risk: 'high', title: '启动应用',
          targetSummary: '已识别应用', impactSummary: '将在确认后启动应用。', reversible: false, expiresAt: 999,
        }
      }
      if (command === 'work_assistant_cancel_run') return undefined
      if (command === 'work_assistant_approve' || command === 'work_assistant_execute_native_action') {
        throw new Error(`action must not execute after cancellation: ${command}`)
      }
      throw new Error(`unexpected command: ${command}`)
    })
    setWorkAssistantInvokerForTests(invoke)

    const pending = executeAssistantToolCall({
      runId: 'cancel-after-approval',
      toolCall: call('desktop_open_app', { appId: 'browser:chrome' }, 'cancel-after-approval-tool'),
      signal: controller.signal,
    })
    await Promise.resolve()
    expect(resolveAssistantApproval('native-preview-cancel-race', 'once')).toBe(true)
    controller.abort()

    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: 'cancelled' })
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'work_assistant_preview',
      'work_assistant_cancel_run',
    ])
  })

  it('binds structured terminal diagnostics to native approval instead of free-form execution', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') {
        return {
          id: 'native-terminal-preview', revision: '43', risk: 'high', title: '终端诊断',
          targetSummary: 'Git 状态', impactSummary: '只读 Git 诊断。', reversible: false, expiresAt: 999,
        }
      }
      if (command === 'work_assistant_approve') {
        return { token: 'native-terminal-token', previewId: 'native-terminal-preview', expires: 999 }
      }
      if (command === 'work_assistant_execute_native_action') {
        return { ok: true, summary: 'Git 状态已读取。', data: { program: 'git_status' } }
      }
      throw new Error(`unexpected command: ${command}`)
    })
    setWorkAssistantInvokerForTests(invoke)
    const pending = executeAssistantToolCall({
      runId: 'run-1',
      toolCall: call('terminal_run', { operation: 'git_status', rootId: 'root-1' }),
    })
    await Promise.resolve()
    expect(resolveAssistantApproval('native-terminal-preview', 'once')).toBe(true)
    await expect(pending).resolves.toMatchObject({ ok: true, summary: 'Git 状态已读取。' })
    expect(invoke).not.toHaveBeenCalledWith('work_assistant_terminal_run', expect.anything())
  })

  it('does not carry terminal output into the assistant event stream', async () => {
    const sentinel = 'PAPYRUS_LEAK_SENTINEL_7f312a'
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') {
        return {
          id: 'native-terminal-privacy', revision: '44', risk: 'high', title: '终端诊断',
          targetSummary: 'Git 状态', impactSummary: '只读 Git 诊断。', reversible: false, expiresAt: 999,
        }
      }
      if (command === 'work_assistant_approve') {
        return { token: 'native-terminal-privacy-token', previewId: 'native-terminal-privacy', expires: 999 }
      }
      if (command === 'work_assistant_execute_native_action') {
        return {
          ok: true,
          summary: 'Git 状态已读取。',
          data: {
            program: 'git_status',
            exitCode: 0,
            stdout: sentinel,
            stderr: sentinel,
            diagnostic: { kind: sentinel, version: sentinel },
            truncated: false,
            durationMs: 4,
          },
        }
      }
      throw new Error(`unexpected command: ${command}`)
    })
    setWorkAssistantInvokerForTests(invoke)

    const pending = executeAssistantToolCall({
      runId: 'run-1',
      toolCall: call('terminal_run', { operation: 'git_status', rootId: 'root-1' }, 'terminal-privacy'),
    })
    await Promise.resolve()
    expect(resolveAssistantApproval('native-terminal-privacy', 'once')).toBe(true)
    const result = await pending

    expect(JSON.stringify(result.data)).not.toContain(sentinel)
    expect(result.data).not.toHaveProperty('stdout')
    expect(result.data).not.toHaveProperty('stderr')
  })

  it('aborts pending approval and invokes native cancellation', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') {
        return {
          id: 'native-preview-abort', revision: '1', risk: 'high', title: '启动应用',
          targetSummary: '已识别应用', impactSummary: '将在确认后启动应用。', reversible: false, expiresAt: 999,
        }
      }
      return undefined
    })
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

  it('flushes merged deltas at about 30 FPS before tool and approval boundaries', () => {
    vi.useFakeTimers()
    const runId = 'buffer-boundary-run'
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId, at: 1 })
    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId, messageId: 'm1', delta: '正在', at: 2 })
    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId, messageId: 'm1', delta: '整理', at: 3 })

    expect(useWorkAssistantStore.getState().runs[runId]?.messageText).toBe('')
    vi.advanceTimersByTime(34)
    expect(useWorkAssistantStore.getState().runs[runId]?.messageText).toBe('正在整理')

    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId, messageId: 'm1', delta: '资料。', at: 35 })
    dispatchOrderedWorkAssistantEvent({
      type: 'tool.started',
      runId,
      toolCall: { ...call('workspace_list', {}, 'tool-boundary'), runId },
      at: 36,
    })

    expect(useWorkAssistantStore.getState().runs[runId]).toMatchObject({
      messageText: '正在整理资料。',
      toolCalls: {
        'tool-boundary': { status: 'running' },
      },
    })

    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId, messageId: 'm1', delta: '请确认。', at: 37 })
    dispatchOrderedWorkAssistantEvent({
      type: 'approval.required',
      runId,
      request: {
        id: 'approval-boundary',
        revision: '1',
        risk: 'reversible',
        title: '确认操作',
        targetSummary: '已授权目标',
        impactSummary: '将执行一项可撤销操作。',
        reversible: true,
        expiresAt: 60_000,
        runId,
        toolCallId: 'tool-boundary',
        reason: '需要确认',
        allowedChoices: ['once', 'deny'],
      },
      at: 38,
    })

    expect(useWorkAssistantStore.getState().runs[runId]).toMatchObject({
      status: 'awaiting_approval',
      messageText: '正在整理资料。请确认。',
      pendingApprovalId: 'approval-boundary',
    })
  })

  it('flushes queued text before completed, failed, and cancelled run boundaries', () => {
    vi.useFakeTimers()
    const cases: Array<{
      runId: string
      terminal: WorkAssistantEvent
      expectedStatus: 'completed' | 'failed' | 'cancelled'
      expectedText: string
    }> = [
      {
        runId: 'completed-run',
        terminal: { type: 'run.completed', runId: 'completed-run', response: '最终答复', at: 3 },
        expectedStatus: 'completed',
        expectedText: '最终答复',
      },
      {
        runId: 'failed-run',
        terminal: { type: 'run.failed', runId: 'failed-run', code: 'network', message: '网络中断', recoverable: true, at: 3 },
        expectedStatus: 'failed',
        expectedText: '保留的草稿',
      },
      {
        runId: 'cancelled-run',
        terminal: { type: 'run.cancelled', runId: 'cancelled-run', at: 3 },
        expectedStatus: 'cancelled',
        expectedText: '保留的草稿',
      },
    ]

    for (const testCase of cases) {
      const observedText: string[] = []
      const unsubscribe = useWorkAssistantStore.subscribe((state) => {
        const run = state.runs[testCase.runId]
        if (run) observedText.push(run.messageText)
      })

      dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: testCase.runId, at: 1 })
      dispatchOrderedWorkAssistantEvent({
        type: 'message.delta',
        runId: testCase.runId,
        messageId: 'm1',
        delta: '保留的草稿',
        at: 2,
      })
      dispatchOrderedWorkAssistantEvent(testCase.terminal)
      unsubscribe()

      expect(observedText).toContain('保留的草稿')
      expect(useWorkAssistantStore.getState().runs[testCase.runId]).toMatchObject({
        status: testCase.expectedStatus,
        messageText: testCase.expectedText,
      })
    }
  })

  it('keeps delta queues separate when run and message IDs contain colons', () => {
    vi.useFakeTimers()
    const firstRunId = 'run:a'
    const secondRunId = 'run'
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: firstRunId, at: 1 })
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: secondRunId, at: 1 })
    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId: firstRunId, messageId: 'b', delta: '第一段', at: 2 })
    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId: secondRunId, messageId: 'a:b', delta: '第二段', at: 3 })

    dispatchOrderedWorkAssistantEvent({
      type: 'tool.started',
      runId: firstRunId,
      toolCall: { ...call('workspace_list', {}, 'colon-boundary'), runId: firstRunId },
      at: 4,
    })

    expect(useWorkAssistantStore.getState().runs[firstRunId]?.messageText).toBe('第一段')
    expect(useWorkAssistantStore.getState().runs[secondRunId]?.messageText).toBe('')

    vi.advanceTimersByTime(34)
    expect(useWorkAssistantStore.getState().runs[secondRunId]?.messageText).toBe('第二段')
  })

  it('cancels an emptied run timer before scheduling deltas for the next run', () => {
    vi.useFakeTimers()
    const firstRunId = 'timer-first-run'
    const secondRunId = 'timer-second-run'
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: firstRunId, at: 1 })
    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId: firstRunId, messageId: 'm1', delta: '第一轮', at: 2 })
    dispatchOrderedWorkAssistantEvent({
      type: 'tool.started',
      runId: firstRunId,
      toolCall: { ...call('workspace_list', {}, 'timer-boundary'), runId: firstRunId },
      at: 3,
    })

    vi.advanceTimersByTime(20)
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: secondRunId, at: 21 })
    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId: secondRunId, messageId: 'm2', delta: '第二轮', at: 22 })

    vi.advanceTimersByTime(14)
    expect(useWorkAssistantStore.getState().runs[secondRunId]?.messageText).toBe('')
    vi.advanceTimersByTime(20)
    expect(useWorkAssistantStore.getState().runs[secondRunId]?.messageText).toBe('第二轮')

    flushAllWorkAssistantDeltas()
  })

  it('resets the global delta timer after an explicit flush', () => {
    vi.useFakeTimers()
    const firstRunId = 'flush-all-first-run'
    const secondRunId = 'flush-all-second-run'
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: firstRunId, at: 1 })
    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId: firstRunId, messageId: 'm1', delta: '已刷出', at: 2 })
    flushAllWorkAssistantDeltas()
    expect(useWorkAssistantStore.getState().runs[firstRunId]?.messageText).toBe('已刷出')

    vi.advanceTimersByTime(20)
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: secondRunId, at: 21 })
    dispatchOrderedWorkAssistantEvent({ type: 'message.delta', runId: secondRunId, messageId: 'm2', delta: '新的节拍', at: 22 })

    vi.advanceTimersByTime(14)
    expect(useWorkAssistantStore.getState().runs[secondRunId]?.messageText).toBe('')
    vi.advanceTimersByTime(20)
    expect(useWorkAssistantStore.getState().runs[secondRunId]?.messageText).toBe('新的节拍')
  })
})
