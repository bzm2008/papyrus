import { describe, expect, it } from 'vitest'
import type { AssistantToolCall, WorkAssistantRun } from './workAssistantProtocol'
import { partitionSecretaryToolTimeline } from './secretaryTimelinePresentation'

function tool(id: string, status: AssistantToolCall['status']): AssistantToolCall {
  return {
    id,
    runId: 'run-1',
    name: 'browser_snapshot',
    intent: `工具 ${id}`,
    arguments: {},
    status,
    startedAt: 1,
    ...(status === 'completed' ? { result: { ok: true, summary: '完成。' } } : {}),
    ...(status === 'failed' ? { result: { ok: false, summary: '失败。', recoverable: true } } : {}),
  }
}

function run(status: WorkAssistantRun['status'], tools: AssistantToolCall[]): WorkAssistantRun {
  return {
    id: 'run-1',
    status,
    messageText: '',
    stage: '',
    toolCalls: Object.fromEntries(tools.map((item) => [item.id, item])),
    subagents: {},
    lastActivityAt: 1,
  }
}

describe('secretary timeline presentation', () => {
  it('folds completed tool steps after a completed run', () => {
    const presentation = partitionSecretaryToolTimeline(run('completed', [
      tool('read', 'completed'),
      tool('write', 'completed'),
    ]))

    expect(presentation.visible).toEqual([])
    expect(presentation.folded.map((item) => item.id)).toEqual(['read', 'write'])
  })

  it('keeps a failed tool visible while folding earlier completed steps', () => {
    const presentation = partitionSecretaryToolTimeline(run('failed', [
      tool('read', 'completed'),
      tool('submit', 'failed'),
    ]))

    expect(presentation.visible.map((item) => item.id)).toEqual(['submit'])
    expect(presentation.folded.map((item) => item.id)).toEqual(['read'])
  })

  it('never folds a live or approval-waiting action', () => {
    const presentation = partitionSecretaryToolTimeline(run('awaiting_approval', [
      tool('read', 'completed'),
      tool('send', 'awaiting_approval'),
    ]))

    expect(presentation.visible.map((item) => item.id)).toEqual(['read', 'send'])
    expect(presentation.folded).toEqual([])
  })
})
