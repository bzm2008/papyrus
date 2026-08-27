import { describe, expect, it } from 'vitest'

import { getMascotSnapshot } from './mascotRuntime'
import { parseMascotSnapshot, sanitizeMascotPayload } from './mascotProtocol'
import type { AssistantToolCall, WorkAssistantRun } from './workAssistantProtocol'

const toolCall = (overrides: Partial<AssistantToolCall> = {}): AssistantToolCall => ({
  id: 'tool-1',
  runId: 'run-1',
  name: 'file_apply_batch',
  intent: '整理文件',
  arguments: { rootId: 'downloads' },
  status: 'awaiting_approval',
  startedAt: 1,
  preview: {
    id: 'approval-1',
    revision: '1',
    risk: 'reversible',
    title: '整理文件',
    targetSummary: 'Downloads 文件夹',
    impactSummary: '移动 2 个文件',
    reversible: true,
    expiresAt: 1000,
  },
  ...overrides,
})

const run = (overrides: Partial<WorkAssistantRun> = {}): WorkAssistantRun => ({
  id: 'run-1',
  status: 'running',
  messageText: '',
  stage: '整理资料',
  toolCalls: {},
  subagents: {},
  lastActivityAt: 1,
  ...overrides,
})

describe('sanitizeMascotPayload', () => {
  it('drops sensitive keys while retaining bounded safe status data', () => {
    const safe = sanitizeMascotPayload({
      stage: '整理资料',
      progress: { completed: 2, total: 3 },
      token: 'should-not-appear',
      nested: { password: 'secret', summary: '已完成' },
    })

    expect(safe).toEqual({
      stage: '整理资料',
      progress: { completed: 2, total: 3 },
      nested: { summary: '已完成' },
    })
    expect(JSON.stringify(safe)).not.toContain('secret')
  })

  it('limits long text, depth, and entry count', () => {
    const safe = sanitizeMascotPayload(
      { long: 'x'.repeat(100), nested: { deep: { value: { tooDeep: true } } }, extra: 4 },
      { maxDepth: 2, maxEntries: 2, maxStringChars: 12 },
    ) as Record<string, unknown>

    expect(safe.long).toBe('x'.repeat(12))
    expect(safe.extra).toBeUndefined()
    expect(safe.nested).toEqual({ deep: {} })
  })
})

describe('getMascotSnapshot', () => {
  it('maps an idle state to a ready-for-work message', () => {
    expect(getMascotSnapshot({ llmRunState: 'idle' })).toMatchObject({
      mood: 'idle',
      status: 'idle',
      label: '随时待命',
      actions: [],
      activeToolCount: 0,
      activeSubagentCount: 0,
    })
  })

  it('exposes an approval action without leaking tool arguments', () => {
    const snapshot = getMascotSnapshot({
      llmRunState: 'running',
      run: run({ pendingApprovalId: 'approval-1', toolCalls: { 'tool-1': toolCall() } }),
      payload: { value: '银行卡 4111', token: 'secret' },
    })

    expect(snapshot).toMatchObject({
      mood: 'awaiting_approval',
      approval: {
        id: 'approval-1',
        toolCallId: 'tool-1',
        allowedChoices: ['once', 'deny'],
      },
      actions: [
        { type: 'approve_tool', choice: 'once', enabled: true },
        { type: 'deny_tool', choice: 'deny', enabled: true },
        { type: 'cancel_run', enabled: true },
      ],
    })
    expect(JSON.stringify(snapshot)).not.toContain('银行卡')
    expect(JSON.stringify(snapshot)).not.toContain('secret')
  })

  it('replaces sensitive approval summaries with a neutral target label', () => {
    const snapshot = getMascotSnapshot({
      llmRunState: 'running',
      run: run({
        pendingApprovalId: 'approval-1',
        toolCalls: {
          'tool-1': toolCall({
            preview: {
              ...toolCall().preview!,
              targetSummary: 'password=secret-token',
            },
          }),
        },
      }),
    })

    expect(snapshot.approval?.targetSummary).toBe('已授权目标')
    expect(JSON.stringify(snapshot)).not.toContain('secret-token')
  })

  it('reports collaboration and progress while subagents are active', () => {
    const snapshot = getMascotSnapshot({
      llmRunState: 'running',
      workAssistantRun: run({
        toolCalls: {
          one: toolCall({ id: 'one', status: 'completed', preview: undefined }),
          two: toolCall({ id: 'two', status: 'running', preview: undefined }),
        },
        subagents: {
          'agent-1': {
            id: 'agent-1',
            goal: '核查资料',
            status: 'running',
            progress: [],
            startedAt: 1,
          },
        },
      }),
    })

    expect(snapshot.mood).toBe('collaborating')
    expect(snapshot.activeSubagentCount).toBe(1)
    expect(snapshot.progress).toEqual({ completed: 1, total: 2, percent: 50 })
  })

  it('offers retry for failed runs and resume for paused goals', () => {
    const failed = getMascotSnapshot({
      llmRunState: 'error',
      run: run({ status: 'failed', error: '网络失败' }),
    })
    const paused = getMascotSnapshot({
      llmRunState: 'idle',
      goal: {
        id: 'goal-1',
        title: '完成报告',
        request: '完成报告',
        acceptanceCriteria: [],
        phasePlan: [],
        currentProgress: '等待资料',
        status: 'paused',
        createdAt: 1,
        updatedAt: 1,
      },
    })

    expect(failed.mood).toBe('error')
    expect(failed.actions.some((action) => action.type === 'retry_run' && action.runId === 'run-1')).toBe(true)
    expect(paused.mood).toBe('paused')
    expect(paused.goal).toMatchObject({ id: 'goal-1' })
    expect(paused.actions.some((action) => action.type === 'resume_goal')).toBe(true)
  })

  it('supports the stable action protocol and idle daze timing', () => {
    const dazed = getMascotSnapshot({ llmRunState: 'idle', now: 50_000, idleSince: 0 })
    expect(dazed).toMatchObject({ name: '铭荼', action: 'dazed', statusText: '我在这里，等你下一件想做的事。' })
    expect(parseMascotSnapshot({ status: 'working', label: '工作中', message: '整理资料', activeToolCount: 1, activeSubagentCount: 0 })).toMatchObject({ action: 'working', name: '铭荼' })
    expect(parseMascotSnapshot({ status: 'working', message: 'token=secret' })).toBeNull()
  })
})
