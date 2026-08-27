import { afterEach, describe, expect, it, vi } from 'vitest'

import { setWorkAssistantInvokerForTests, resetWorkAssistantInvokerForTests } from './workAssistantClient'
import { runWorkAssistantAgentLoop } from './workAssistantAgentLoop'
import { dispatchOrderedWorkAssistantEvent, executeAssistantToolCall, flushAllWorkAssistantDeltas, resetWorkAssistantRuntimeForTests, resolveAssistantApproval } from './workAssistantRuntime'
import type { WorkAssistantEvent } from './workAssistantProtocol'
import { useWorkAssistantStore } from '../stores/useWorkAssistantStore'

const decision = (value: unknown) => JSON.stringify(value)
const tool = (name: string, args: Record<string, unknown>) => decision({ kind: 'tool_call', tool: { name, arguments: args }, note: name })
const final = (response: string) => decision({ kind: 'final', response })

async function waitForApproval(runId: string) {
  for (let index = 0; index < 50; index += 1) {
    const run = useWorkAssistantStore.getState().runs[runId]
    if (run?.pendingApprovalId) return run.pendingApprovalId
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('approval was not requested')
}

afterEach(() => {
  flushAllWorkAssistantDeltas()
  resetWorkAssistantRuntimeForTests()
  resetWorkAssistantInvokerForTests()
})

describe('controlled work assistant integration', () => {
  it('scans, previews, approves, applies, and completes one canonical run', async () => {
    const commands: string[] = []
    const events: WorkAssistantEvent[] = []
    setWorkAssistantInvokerForTests(async (command) => {
      commands.push(command)
      if (command === 'work_assistant_workspace_scan') return { entries: [{ name: 'a.pdf' }] }
      if (command === 'work_assistant_preview') return { id: 'preview-1', revision: '1', risk: 'reversible', title: '整理文件', targetSummary: '下载目录', impactSummary: '移动 1 个文件', reversible: true, expiresAt: Date.now() + 60_000 }
      if (command === 'work_assistant_approve') return { token: 'token-1', previewId: 'preview-1', expires: Date.now() + 60_000 }
      if (command === 'work_assistant_execute') return { completed: [{}], skipped: [], failed: [], remaining: [], cancelled: false }
      return undefined
    })
    const scripted = [tool('workspace_scan', { rootId: 'downloads' }), tool('file_plan_batch', { rootId: 'downloads', conflictPolicy: 'rename', operations: [{ kind: 'move', source: 'a.pdf', destination: 'PDF/a.pdf' }] }), tool('file_apply_batch', { previewId: 'preview-1' }), final('整理完成。')]
    const emit = (event: WorkAssistantEvent) => {
      events.push(event)
      dispatchOrderedWorkAssistantEvent(event)
    }
    const promise = runWorkAssistantAgentLoop({
      runId: 'run-1',
      prompt: '整理下载目录',
      toolNames: ['workspace_scan', 'file_plan_batch', 'file_apply_batch'],
      modelCall: async () => scripted.shift()!,
      executeTool: (toolCall, signal) => executeAssistantToolCall({ runId: 'run-1', toolCall, signal, emit }),
      emit,
    })
    expect(resolveAssistantApproval(await waitForApproval('run-1'), 'once')).toBe(true)
    const result = await promise
    flushAllWorkAssistantDeltas()
    const run = useWorkAssistantStore.getState().runs['run-1']
    expect(result.response).toBe('整理完成。')
    expect(Object.keys(run.toolCalls)).toHaveLength(3)
    expect(run.status).toBe('completed')
    expect(events.filter((event) => event.type === 'tool.started').map((event) => event.type === 'tool.started' ? event.toolCall.id : '')).toHaveLength(3)
    expect(new Set(events.filter((event) => event.type === 'tool.started').map((event) => event.type === 'tool.started' ? event.toolCall.id : '')).size).toBe(3)
    expect(events.filter((event) => event.type === 'message.delta')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'run.completed')).toHaveLength(1)
    expect(run.messageText).toBe('整理完成。')
    expect(commands).toContain('work_assistant_execute')
  })

  it('cancels while approval is pending without executing', async () => {
    const controller = new AbortController()
    const invoke = vi.fn(async (command: string) => command === 'work_assistant_preview' ? { id: 'preview-1', revision: '1', risk: 'reversible', title: '整理', targetSummary: '下载目录', impactSummary: '移动文件', reversible: true, expiresAt: Date.now() + 60_000 } : undefined)
    setWorkAssistantInvokerForTests(invoke)
    const scripted = [tool('file_plan_batch', { rootId: 'downloads', conflictPolicy: 'skip', operations: [{ kind: 'trash', source: 'a.tmp' }] }), tool('file_apply_batch', { previewId: 'preview-1' })]
    const promise = runWorkAssistantAgentLoop({ runId: 'run-2', prompt: '整理', toolNames: ['file_plan_batch', 'file_apply_batch'], modelCall: async () => scripted.shift()!, executeTool: (toolCall, signal) => executeAssistantToolCall({ runId: 'run-2', toolCall, signal }), emit: dispatchOrderedWorkAssistantEvent, signal: controller.signal })
    await waitForApproval('run-2')
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke.mock.calls.some(([command]) => command === 'work_assistant_execute')).toBe(false)
    expect(useWorkAssistantStore.getState().runs['run-2'].status).toBe('cancelled')
  })

  it('runs an allowlisted terminal request only after one approval', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'work_assistant_preview') return { id: 'terminal-preview', revision: '1', risk: 'high', title: '终端诊断', targetSummary: 'Git 状态', impactSummary: '只读诊断', reversible: false, expiresAt: Date.now() + 60_000 }
      if (command === 'work_assistant_approve') return { token: 'terminal-token', previewId: 'terminal-preview', expires: Date.now() + 60_000 }
      if (command === 'work_assistant_execute_native_action') return { ok: true, summary: '只读诊断已完成。', data: { program: 'git_status', exitCode: 0, stdout: 'clean', stderr: '', truncated: false, durationMs: 4 } }
      return undefined
    })
    setWorkAssistantInvokerForTests(invoke)
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: 'terminal-run', at: 1 })
    const promise = executeAssistantToolCall({
      runId: 'terminal-run',
      toolCall: {
        id: 'terminal-tool',
        runId: 'terminal-run',
        name: 'terminal_run',
        intent: '检查项目状态',
        arguments: { operation: 'git_status', rootId: 'project', cwd: '' },
        status: 'queued',
        startedAt: 1,
      },
    })
    expect(resolveAssistantApproval(await waitForApproval('terminal-run'), 'once')).toBe(true)
    await expect(promise).resolves.toMatchObject({ ok: true })
    expect(invoke).toHaveBeenCalledWith('work_assistant_preview', expect.objectContaining({
      request: expect.objectContaining({ toolName: 'terminal_run', arguments: { operation: 'git_status', rootId: 'project', cwd: '' } }),
    }))
    expect(invoke).toHaveBeenCalledWith('work_assistant_execute_native_action', { previewId: 'terminal-preview', approvalToken: 'terminal-token' })
    expect(invoke).not.toHaveBeenCalledWith('work_assistant_terminal_run', expect.anything())
  })

  it('keeps a stale preview recoverable instead of replaying approval', async () => {
    dispatchOrderedWorkAssistantEvent({ type: 'run.started', runId: 'run-3', at: 1 })
    setWorkAssistantInvokerForTests(async (command) => {
      if (command === 'work_assistant_preview') return { id: 'preview-stale', revision: '1', risk: 'reversible', title: '整理', targetSummary: '下载目录', impactSummary: '移动文件', reversible: true, expiresAt: Date.now() + 60_000 }
      if (command === 'work_assistant_approve') return { token: 'token-stale', previewId: 'preview-stale', expires: Date.now() + 60_000 }
      if (command === 'work_assistant_execute') throw { code: 'stale_preview', recoverable: true }
      return undefined
    })
    await executeAssistantToolCall({ runId: 'run-3', toolCall: { id: 'plan', runId: 'run-3', name: 'file_plan_batch', intent: '预览', arguments: { rootId: 'downloads', conflictPolicy: 'skip', operations: [{ kind: 'trash', source: 'a.tmp' }] }, status: 'queued', startedAt: 1 } })
    const apply = executeAssistantToolCall({ runId: 'run-3', toolCall: { id: 'apply', runId: 'run-3', name: 'file_apply_batch', intent: '执行', arguments: { previewId: 'preview-stale' }, status: 'queued', startedAt: 2 } })
    expect(resolveAssistantApproval(await waitForApproval('run-3'), 'once')).toBe(true)
    await expect(apply).resolves.toMatchObject({ ok: false, errorCode: 'stale_preview', recoverable: true })
    expect(useWorkAssistantStore.getState().runs['run-3'].toolCalls.plan.result?.data?.previewId).toBe('preview-stale')
  })
})
