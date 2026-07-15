import { describe, expect, it, vi } from 'vitest'

import { runWorkAssistantAgentLoop } from './workAssistantAgentLoop'

const toolDecision = (name: string, args: Record<string, unknown>) => JSON.stringify({ kind: 'tool_call', tool: { name, arguments: args }, note: name })
const finalDecision = (response: string) => JSON.stringify({ kind: 'final', response })

describe('runWorkAssistantAgentLoop', () => {
  it('scans, previews, applies, and returns one canonical final response', async () => {
    const decisions = [
      toolDecision('workspace_scan', { rootId: 'downloads' }),
      toolDecision('file_plan_batch', { rootId: 'downloads', operations: [{ kind: 'move', source: 'a.pdf', destination: 'PDF/a.pdf' }], conflictPolicy: 'skip' }),
      toolDecision('file_apply_batch', { previewId: 'preview-1' }),
      finalDecision('已整理 12 个文件。'),
    ]
    const modelCall = vi.fn(async () => decisions.shift()!)
    const executeTool = vi.fn(async (call: { name: string }) => ({ ok: true, summary: call.name, data: call.name === 'file_plan_batch' ? { previewId: 'preview-1' } : undefined }))
    const result = await runWorkAssistantAgentLoop({ runId: 'r1', prompt: '整理下载目录', toolNames: ['workspace_scan', 'file_plan_batch', 'file_apply_batch'], modelCall, executeTool })

    expect(executeTool.mock.calls.map(([call]) => call.name)).toEqual(['workspace_scan', 'file_plan_batch', 'file_apply_batch'])
    expect(result.response).toBe('已整理 12 个文件。')
  })

  it('rejects malformed decisions and unavailable tools', async () => {
    await expect(runWorkAssistantAgentLoop({ runId: 'r1', prompt: 'x', toolNames: [], modelCall: async () => 'not json', executeTool: vi.fn() })).rejects.toThrow('有效 JSON')
    await expect(runWorkAssistantAgentLoop({ runId: 'r2', prompt: 'x', toolNames: [], modelCall: async () => toolDecision('shell', {}), executeTool: vi.fn() })).rejects.toThrow('不可用工具')
  })

  it('adds browser safety guidance only when browser tools are available', async () => {
    const browserMessages: Array<{ role: string; content: string }> = []
    await runWorkAssistantAgentLoop({
      runId: 'browser-guidance',
      prompt: '读取当前页面',
      toolNames: ['browser_snapshot'],
      modelCall: async (messages) => {
        browserMessages.push(...messages)
        return finalDecision('已读取。')
      },
      executeTool: vi.fn(),
    })
    expect(browserMessages[0]?.content).toContain('Never request passwords')
    expect(browserMessages[0]?.content).toContain('latest browser snapshot')

    const normalMessages: Array<{ role: string; content: string }> = []
    await runWorkAssistantAgentLoop({
      runId: 'normal-guidance',
      prompt: '扫描文件',
      toolNames: ['workspace_scan'],
      modelCall: async (messages) => {
        normalMessages.push(...messages)
        return finalDecision('已扫描。')
      },
      executeTool: vi.fn(),
    })
    expect(normalMessages[0]?.content).not.toContain('Never request passwords')
  })

  it('stops duplicate failed arguments before a third execution', async () => {
    const modelCall = vi.fn(async () => toolDecision('workspace_scan', { rootId: 'bad' }))
    const executeTool = vi.fn(async () => ({ ok: false, summary: 'failed', recoverable: true }))
    await expect(runWorkAssistantAgentLoop({ runId: 'r1', prompt: 'x', toolNames: ['workspace_scan'], modelCall, executeTool })).rejects.toThrow('连续失败')
    expect(executeTool).toHaveBeenCalledTimes(2)
  })

  it('honors cancellation and the eight-tool limit', async () => {
    const controller = new AbortController()
    controller.abort()
    const events: Array<{ type: string }> = []
    await expect(runWorkAssistantAgentLoop({ runId: 'r1', prompt: 'x', toolNames: [], modelCall: vi.fn(), executeTool: vi.fn(), signal: controller.signal, emit: (event) => events.push(event) })).rejects.toMatchObject({ name: 'AbortError' })
    expect(events.at(-1)?.type).toBe('run.cancelled')

    const executeTool = vi.fn(async () => ({ ok: true, summary: 'ok' }))
    await expect(runWorkAssistantAgentLoop({ runId: 'r2', prompt: 'x', toolNames: ['workspace_scan'], modelCall: async () => toolDecision('workspace_scan', { rootId: Math.random() }), executeTool })).rejects.toThrow('8 次')
    expect(executeTool).toHaveBeenCalledTimes(8)
  })

  it('emits a recoverable terminal failure when the model protocol is invalid', async () => {
    const events: Array<{ type: string; recoverable?: boolean }> = []
    await expect(runWorkAssistantAgentLoop({
      runId: 'r1', prompt: 'x', toolNames: [], modelCall: async () => 'not json', executeTool: vi.fn(), emit: (event) => events.push(event),
    })).rejects.toThrow('有效 JSON')
    expect(events.at(-1)).toMatchObject({ type: 'run.failed', recoverable: true })
  })

  it('streams final tokens and returns the canonical final text', async () => {
    const events: Array<{ type: string; delta?: string }> = []
    const result = await runWorkAssistantAgentLoop({
      runId: 'r1', prompt: 'x', toolNames: [], modelCall: async () => finalDecision('整理完成'), executeTool: vi.fn(),
      finalStream: async (_outline, _receipts, onToken) => { onToken('已整理'); onToken(' 12 个文件。'); return '已整理 12 个文件。' },
      emit: (event) => events.push(event),
    })
    expect(events.filter((event) => event.type === 'message.delta').map((event) => event.delta).join('')).toBe('已整理 12 个文件。')
    expect(result.response).toBe('已整理 12 个文件。')
  })

  it('falls back to the verified outline when final streaming is unavailable before any token', async () => {
    const events: Array<{ type: string; delta?: string; response?: string }> = []
    const result = await runWorkAssistantAgentLoop({
      runId: 'r-fallback',
      prompt: '整理下载目录',
      toolNames: [],
      modelCall: async () => finalDecision('已核对 3 个文件，未执行写入。'),
      executeTool: vi.fn(),
      finalStream: async () => {
        throw new Error('provider unavailable')
      },
      emit: (event) => events.push(event),
    })

    expect(result.response).toBe('已核对 3 个文件，未执行写入。')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.delta',
      runId: 'r-fallback',
      messageId: 'final-r-fallback',
      delta: '已核对 3 个文件，未执行写入。',
    }))
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', response: '已核对 3 个文件，未执行写入。' })
    expect(events.some((event) => event.type === 'run.failed')).toBe(false)
  })

  it('keeps a mixed collection run open for the writing pipeline', async () => {
    const events: Array<{ type: string }> = []
    const result = await runWorkAssistantAgentLoop({
      runId: 'r1', prompt: '扫描资料并写报告', toolNames: [], modelCall: async () => finalDecision('资料收集完毕'), executeTool: vi.fn(), collectionOnly: true, emit: (event) => events.push(event),
    })
    expect(result.response).toBe('资料收集完毕')
    expect(events.map((event) => event.type)).toEqual(['run.started'])
  })
})
