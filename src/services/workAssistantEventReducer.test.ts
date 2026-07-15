import { describe, expect, it } from 'vitest'

import { reduceWorkAssistantEvent, reduceWorkAssistantEvents } from './workAssistantEventReducer'
import {
  createEmptyWorkAssistantRun,
  type AssistantApprovalRequest,
  type AssistantSubagent,
  type AssistantToolCall,
  type AssistantToolResult,
  type WorkAssistantRun,
} from './workAssistantProtocol'

const toolCall = (id = 'tool-1'): AssistantToolCall => ({
  id,
  runId: 'run-1',
  name: 'workspace.search',
  intent: 'Search the workspace',
  arguments: { query: 'papyrus' },
  status: 'queued',
  startedAt: 10,
})

const preview: AssistantApprovalRequest = {
  id: 'approval-1',
  revision: '1',
  risk: 'reversible',
  title: 'Apply a patch',
  targetSummary: 'src/example.ts',
  impactSummary: 'One file changes',
  reversible: true,
  expiresAt: 1000,
  runId: 'run-1',
  toolCallId: 'tool-1',
  reason: 'Writes a workspace file',
  allowedChoices: ['once', 'deny'],
}

const subagent = (id = 'agent-1'): AssistantSubagent => ({
  id,
  goal: 'Inspect the project',
  status: 'queued',
  progress: [],
  startedAt: 20,
})

const successfulResult: AssistantToolResult = { ok: true, summary: 'Found 3 files' }

describe('reduceWorkAssistantEvents', () => {
  it('keeps a text delta received before a tool event', () => {
    const run = reduceWorkAssistantEvents(createEmptyWorkAssistantRun('run-1'), [
      { type: 'run.started', runId: 'run-1', at: 1 },
      { type: 'message.delta', runId: 'run-1', messageId: 'message-1', delta: '先搜索', at: 2 },
      { type: 'tool.started', runId: 'run-1', toolCall: toolCall(), at: 3 },
    ])

    expect(run.messageText).toBe('先搜索')
    expect(run.toolCalls['tool-1'].status).toBe('running')
  })
})

describe('reduceWorkAssistantEvent', () => {
  it('records tool progress and a successful completion without mutating the prior state', () => {
    const initial = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall(), at: 10,
    })
    const progressed = reduceWorkAssistantEvent(initial, {
      type: 'tool.progress', runId: 'run-1', toolCallId: 'tool-1', message: 'Scanning', completed: 2, total: 3, at: 11,
    })
    const completed = reduceWorkAssistantEvent(progressed, {
      type: 'tool.completed', runId: 'run-1', toolCallId: 'tool-1', result: successfulResult, at: 12,
    })

    expect(initial.toolCalls['tool-1'].progress).toBeUndefined()
    expect(progressed.toolCalls['tool-1']).toMatchObject({
      status: 'running', progress: { message: 'Scanning', completed: 2, total: 3 },
    })
    expect(completed.toolCalls['tool-1']).toMatchObject({ status: 'completed', result: successfulResult, endedAt: 12 })
  })

  it('moves an existing tool into and out of approval state', () => {
    const started = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall(), at: 10,
    })
    const awaitingApproval = reduceWorkAssistantEvent(started, {
      type: 'approval.required', runId: 'run-1', request: preview, at: 11,
    })
    const resumed = reduceWorkAssistantEvent(awaitingApproval, {
      type: 'tool.progress', runId: 'run-1', toolCallId: 'tool-1', message: 'Approved', at: 12,
    })

    expect(awaitingApproval).toMatchObject({ status: 'awaiting_approval', pendingApprovalId: 'approval-1' })
    expect(awaitingApproval.toolCalls['tool-1']).toMatchObject({ status: 'awaiting_approval', preview })
    expect(resumed).toMatchObject({ status: 'running', pendingApprovalId: undefined })
  })

  it('preserves the current approval when another tool requests approval concurrently', () => {
    const firstStarted = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall('tool-1'), at: 1,
    })
    const secondStarted = reduceWorkAssistantEvent(firstStarted, {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall('tool-2'), at: 2,
    })
    const awaitingFirstApproval = reduceWorkAssistantEvent(secondStarted, {
      type: 'approval.required', runId: 'run-1', request: preview, at: 3,
    })
    const afterSecondApproval = reduceWorkAssistantEvent(awaitingFirstApproval, {
      type: 'approval.required', runId: 'run-1', request: { ...preview, id: 'approval-2', toolCallId: 'tool-2' }, at: 4,
    })

    expect(afterSecondApproval).toBe(awaitingFirstApproval)
    expect(afterSecondApproval).toMatchObject({ status: 'awaiting_approval', pendingApprovalId: 'approval-1' })
    expect(afterSecondApproval.toolCalls['tool-1']).toMatchObject({ status: 'awaiting_approval', preview })
    expect(afterSecondApproval.toolCalls['tool-2']).toMatchObject({ status: 'running' })
  })

  it('accepts another approval after the current approval is resolved', () => {
    const firstStarted = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall('tool-1'), at: 1,
    })
    const secondStarted = reduceWorkAssistantEvent(firstStarted, {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall('tool-2'), at: 2,
    })
    const awaitingFirstApproval = reduceWorkAssistantEvent(secondStarted, {
      type: 'approval.required', runId: 'run-1', request: preview, at: 3,
    })
    const firstResolved = reduceWorkAssistantEvent(awaitingFirstApproval, {
      type: 'tool.progress', runId: 'run-1', toolCallId: 'tool-1', message: 'Approved', at: 4,
    })
    const awaitingSecondApproval = reduceWorkAssistantEvent(firstResolved, {
      type: 'approval.required', runId: 'run-1', request: { ...preview, id: 'approval-2', toolCallId: 'tool-2' }, at: 5,
    })

    expect(firstResolved).toMatchObject({ status: 'running', pendingApprovalId: undefined })
    expect(awaitingSecondApproval).toMatchObject({ status: 'awaiting_approval', pendingApprovalId: 'approval-2' })
    expect(awaitingSecondApproval.toolCalls['tool-2']).toMatchObject({
      status: 'awaiting_approval',
      preview: { ...preview, id: 'approval-2', toolCallId: 'tool-2' },
    })
  })

  it('accepts another approval after the matching pending tool completes', () => {
    const firstStarted = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall('tool-1'), at: 1,
    })
    const secondStarted = reduceWorkAssistantEvent(firstStarted, {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall('tool-2'), at: 2,
    })
    const awaitingFirstApproval = reduceWorkAssistantEvent(secondStarted, {
      type: 'approval.required', runId: 'run-1', request: preview, at: 3,
    })
    const firstCompleted = reduceWorkAssistantEvent(awaitingFirstApproval, {
      type: 'tool.completed', runId: 'run-1', toolCallId: 'tool-1', result: successfulResult, at: 4,
    })
    const awaitingSecondApproval = reduceWorkAssistantEvent(firstCompleted, {
      type: 'approval.required', runId: 'run-1', request: { ...preview, id: 'approval-2', toolCallId: 'tool-2' }, at: 5,
    })

    expect(firstCompleted).toMatchObject({ status: 'running', pendingApprovalId: undefined })
    expect(firstCompleted.toolCalls['tool-1']).toMatchObject({ status: 'completed', endedAt: 4 })
    expect(awaitingSecondApproval).toMatchObject({ status: 'awaiting_approval', pendingApprovalId: 'approval-2' })
    expect(awaitingSecondApproval.toolCalls['tool-2']).toMatchObject({
      status: 'awaiting_approval',
      preview: { ...preview, id: 'approval-2', toolCallId: 'tool-2' },
    })
  })

  it('keeps a pending approval active until its tool reports progress or completion', () => {
    const firstStarted = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall('tool-1'), at: 1,
    })
    const secondStarted = reduceWorkAssistantEvent(firstStarted, {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall('tool-2'), at: 2,
    })
    const awaitingApproval = reduceWorkAssistantEvent(secondStarted, {
      type: 'approval.required', runId: 'run-1', request: { ...preview, id: 'approval-2', toolCallId: 'tool-2' }, at: 3,
    })
    const afterUnrelatedProgress = reduceWorkAssistantEvent(awaitingApproval, {
      type: 'tool.progress', runId: 'run-1', toolCallId: 'tool-1', message: 'Still searching', at: 4,
    })
    const afterUnrelatedCompletion = reduceWorkAssistantEvent(afterUnrelatedProgress, {
      type: 'tool.completed', runId: 'run-1', toolCallId: 'tool-1', result: successfulResult, at: 5,
    })
    const afterMatchingCompletion = reduceWorkAssistantEvent(afterUnrelatedCompletion, {
      type: 'tool.completed', runId: 'run-1', toolCallId: 'tool-2', result: successfulResult, at: 6,
    })

    expect(afterUnrelatedProgress).toMatchObject({ status: 'awaiting_approval', pendingApprovalId: 'approval-2' })
    expect(afterUnrelatedProgress.toolCalls['tool-1']).toMatchObject({ status: 'running', progress: { message: 'Still searching' } })
    expect(afterUnrelatedCompletion).toMatchObject({ status: 'awaiting_approval', pendingApprovalId: 'approval-2' })
    expect(afterMatchingCompletion).toMatchObject({ status: 'running', pendingApprovalId: undefined })
  })

  it('does not create calls for unknown tool events', () => {
    const initial = createEmptyWorkAssistantRun('run-1')

    const afterProgress = reduceWorkAssistantEvent(initial, {
      type: 'tool.progress', runId: 'run-1', toolCallId: 'missing', message: 'No-op', at: 1,
    })
    const afterCompletion = reduceWorkAssistantEvent(initial, {
      type: 'tool.completed', runId: 'run-1', toolCallId: 'missing', result: successfulResult, at: 2,
    })
    const afterApproval = reduceWorkAssistantEvent(initial, {
      type: 'approval.required', runId: 'run-1', request: { ...preview, toolCallId: 'missing' }, at: 3,
    })

    expect(afterProgress).toBe(initial)
    expect(afterCompletion).toBe(initial)
    expect(afterApproval).toBe(initial)
  })

  it('does not mutate terminal tool calls with progress, completion, or approval events', () => {
    const terminalCalls: AssistantToolCall[] = [
      { ...toolCall(), status: 'completed', endedAt: 10, result: successfulResult },
      { ...toolCall(), status: 'failed', endedAt: 11, result: { ok: false, summary: 'Failed' } },
      { ...toolCall(), status: 'cancelled', endedAt: 12 },
    ]
    const stateWith = (call: AssistantToolCall): WorkAssistantRun => ({
      ...createEmptyWorkAssistantRun('run-1'), status: 'running', toolCalls: { 'tool-1': call },
    })

    for (const call of terminalCalls) {
      for (const event of [
        { type: 'tool.progress' as const, runId: 'run-1', toolCallId: 'tool-1', message: 'Late progress', at: 13 },
        { type: 'tool.completed' as const, runId: 'run-1', toolCallId: 'tool-1', result: successfulResult, at: 14 },
        { type: 'approval.required' as const, runId: 'run-1', request: preview, at: 15 },
      ]) {
        const state = stateWith(call)
        expect(reduceWorkAssistantEvent(state, event)).toBe(state)
      }
    }
  })

  it('does not overwrite a tool call when a duplicate start arrives', () => {
    const started = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall(), at: 10,
    })
    const duplicate = reduceWorkAssistantEvent(started, {
      type: 'tool.started', runId: 'run-1', toolCall: { ...toolCall(), intent: 'Overwrite attempt', arguments: {} }, at: 11,
    })

    expect(duplicate).toBe(started)
    expect(duplicate.toolCalls['tool-1'].intent).toBe('Search the workspace')
  })

  it('keeps an outstanding approval when another tool starts', () => {
    const started = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall('tool-1'), at: 1,
    })
    const awaitingApproval = reduceWorkAssistantEvent(started, {
      type: 'approval.required', runId: 'run-1', request: preview, at: 2,
    })
    const afterOtherToolStarted = reduceWorkAssistantEvent(awaitingApproval, {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall('tool-2'), at: 3,
    })

    expect(afterOtherToolStarted).toMatchObject({ status: 'awaiting_approval', pendingApprovalId: 'approval-1' })
    expect(afterOtherToolStarted.toolCalls['tool-2']).toMatchObject({ status: 'running' })
  })

  it('tracks subagent progress and completion without reviving terminal subagents', () => {
    const started = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'subagent.started', runId: 'run-1', subagent: subagent(), at: 20,
    })
    const progressed = reduceWorkAssistantEvent(started, {
      type: 'subagent.progress', runId: 'run-1', subagentId: 'agent-1', message: 'Reading files', currentTool: 'workspace.read', at: 21,
    })
    const completed = reduceWorkAssistantEvent(progressed, {
      type: 'subagent.completed', runId: 'run-1', subagentId: 'agent-1', summary: 'Done', at: 22,
    })
    const lateProgress = reduceWorkAssistantEvent(completed, {
      type: 'subagent.progress', runId: 'run-1', subagentId: 'agent-1', message: 'Late update', at: 23,
    })

    expect(progressed.subagents['agent-1']).toMatchObject({ status: 'running', currentTool: 'workspace.read', progress: ['Reading files'] })
    expect(completed.subagents['agent-1']).toMatchObject({ status: 'completed', summary: 'Done', endedAt: 22 })
    expect(lateProgress).toBe(completed)
  })

  it('starts a new subagent as running and ignores duplicate starts', () => {
    const started = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'subagent.started', runId: 'run-1', subagent: subagent(), at: 20,
    })
    const duplicate = reduceWorkAssistantEvent(started, {
      type: 'subagent.started', runId: 'run-1', subagent: { ...subagent(), status: 'completed', summary: 'Overwrite attempt' }, at: 21,
    })

    expect(started.subagents['agent-1'].status).toBe('running')
    expect(duplicate).toBe(started)
  })

  it('retains the newest 24 subagent progress entries', () => {
    let run = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'subagent.started', runId: 'run-1', subagent: subagent(), at: 1,
    })

    for (let index = 0; index < 25; index += 1) {
      run = reduceWorkAssistantEvent(run, {
        type: 'subagent.progress', runId: 'run-1', subagentId: 'agent-1', message: `step-${index}`, at: index + 2,
      })
    }

    expect(run.subagents['agent-1'].progress).toEqual(Array.from({ length: 24 }, (_, index) => `step-${index + 1}`))
  })

  it('does not allow late events to change a cancelled run', () => {
    const running = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall(), at: 10,
    })
    const cancelled = reduceWorkAssistantEvent(running, { type: 'run.cancelled', runId: 'run-1', at: 11 })
    const afterLateCompletion = reduceWorkAssistantEvent(cancelled, {
      type: 'tool.completed', runId: 'run-1', toolCallId: 'tool-1', result: successfulResult, at: 12,
    })

    expect(cancelled).toMatchObject({ status: 'cancelled', pendingApprovalId: undefined })
    expect(cancelled.toolCalls['tool-1']).toMatchObject({ status: 'cancelled', endedAt: 11 })
    expect(afterLateCompletion).toBe(cancelled)
    expect(afterLateCompletion.toolCalls['tool-1'].result).toBeUndefined()
  })

  it('surfaces native cancellation failure without reviving the run', () => {
    const cancelled = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'run.cancelled', runId: 'run-1', at: 11,
    })
    const warned = reduceWorkAssistantEvent(cancelled, {
      type: 'run.failed', runId: 'run-1', code: 'cancel_failed',
      message: '取消未能确认所有本地操作已停止，请检查工作助手状态。', recoverable: true, at: 12,
    })

    expect(warned).toMatchObject({
      status: 'cancelled',
      error: '取消未能确认所有本地操作已停止，请检查工作助手状态。',
      lastActivityAt: 12,
    })
  })

  it('retains terminal tool receipts when a run is cancelled', () => {
    const cancelledTool = { ...toolCall('cancelled-tool'), status: 'cancelled' as const, endedAt: 7 }
    const running = {
      ...createEmptyWorkAssistantRun('run-1'),
      status: 'running' as const,
      toolCalls: {
        'cancelled-tool': cancelledTool,
        'running-tool': { ...toolCall('running-tool'), status: 'running' as const },
      },
    }

    const cancelled = reduceWorkAssistantEvent(running, { type: 'run.cancelled', runId: 'run-1', at: 11 })

    expect(cancelled.toolCalls['cancelled-tool']).toBe(cancelledTool)
    expect(cancelled.toolCalls['cancelled-tool']).toMatchObject({ status: 'cancelled', endedAt: 7 })
    expect(cancelled.toolCalls['running-tool']).toMatchObject({ status: 'cancelled', endedAt: 11 })
  })

  it('handles terminal run events and ignores events for another run', () => {
    const completed = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'run.completed', runId: 'run-1', response: 'Final answer', at: 40,
    })
    const failed = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'run.failed', runId: 'run-1', code: 'NETWORK', message: 'Connection lost', recoverable: true, at: 41,
    })
    const otherRunEvent = reduceWorkAssistantEvent(completed, {
      type: 'stage.changed', runId: 'run-2', stage: 'ignored', at: 42,
    })

    expect(completed).toMatchObject({ status: 'completed', messageText: 'Final answer', lastActivityAt: 40 })
    expect(failed).toMatchObject({ status: 'failed', error: 'Connection lost', lastActivityAt: 41 })
    expect(otherRunEvent).toBe(completed)
  })

  it('clears a pending approval when a run completes or fails', () => {
    const awaitingApproval = reduceWorkAssistantEvents(createEmptyWorkAssistantRun('run-1'), [
      { type: 'tool.started', runId: 'run-1', toolCall: toolCall(), at: 1 },
      { type: 'approval.required', runId: 'run-1', request: preview, at: 2 },
    ])
    const completed = reduceWorkAssistantEvent(awaitingApproval, {
      type: 'run.completed', runId: 'run-1', response: 'Final answer', at: 3,
    })
    const failed = reduceWorkAssistantEvent(awaitingApproval, {
      type: 'run.failed', runId: 'run-1', code: 'NETWORK', message: 'Connection lost', recoverable: true, at: 4,
    })

    expect(completed).toMatchObject({ status: 'completed', pendingApprovalId: undefined })
    expect(failed).toMatchObject({ status: 'failed', pendingApprovalId: undefined })
  })

  it('does not allow any later same-run event to alter terminal runs', () => {
    const started = reduceWorkAssistantEvent(createEmptyWorkAssistantRun('run-1'), {
      type: 'tool.started', runId: 'run-1', toolCall: toolCall(), at: 30,
    })
    const completed = reduceWorkAssistantEvent(started, {
      type: 'run.completed', runId: 'run-1', response: 'Final answer', at: 31,
    })
    const failed = reduceWorkAssistantEvent(started, {
      type: 'run.failed', runId: 'run-1', code: 'NETWORK', message: 'Connection lost', recoverable: true, at: 32,
    })
    const cancelled = reduceWorkAssistantEvent(started, { type: 'run.cancelled', runId: 'run-1', at: 33 })
    const lateEvents = [
      { type: 'run.started' as const, runId: 'run-1', at: 34 },
      { type: 'message.delta' as const, runId: 'run-1', messageId: 'late', delta: 'Late text', at: 35 },
      { type: 'stage.changed' as const, runId: 'run-1', stage: 'late', at: 36 },
      { type: 'tool.started' as const, runId: 'run-1', toolCall: toolCall('late-tool'), at: 37 },
      { type: 'tool.progress' as const, runId: 'run-1', toolCallId: 'tool-1', message: 'Late progress', at: 38 },
      { type: 'approval.required' as const, runId: 'run-1', request: preview, at: 39 },
      { type: 'tool.completed' as const, runId: 'run-1', toolCallId: 'tool-1', result: successfulResult, at: 40 },
      { type: 'subagent.started' as const, runId: 'run-1', subagent: subagent('late-agent'), at: 41 },
      { type: 'subagent.progress' as const, runId: 'run-1', subagentId: 'late-agent', message: 'Late progress', at: 42 },
      { type: 'subagent.completed' as const, runId: 'run-1', subagentId: 'late-agent', summary: 'Late completion', at: 43 },
      { type: 'run.completed' as const, runId: 'run-1', response: 'Late response', at: 44 },
      { type: 'run.failed' as const, runId: 'run-1', code: 'LATE', message: 'Late failure', recoverable: false, at: 45 },
      { type: 'run.cancelled' as const, runId: 'run-1', at: 46 },
    ]

    for (const terminalRun of [completed, failed, cancelled]) {
      for (const event of lateEvents) {
        expect(reduceWorkAssistantEvent(terminalRun, event)).toBe(terminalRun)
      }
    }
  })
})
