import { describe, expect, it } from 'vitest'

import { reduceWorkAssistantEvent, reduceWorkAssistantEvents } from './workAssistantEventReducer'
import {
  createEmptyWorkAssistantRun,
  type AssistantApprovalRequest,
  type AssistantSubagent,
  type AssistantToolCall,
  type AssistantToolResult,
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
})
