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

  it('accepts a single fenced JSON decision without executing surrounding text', async () => {
    const executeTool = vi.fn(async () => ({ ok: true, summary: 'status ok' }))
    const decisions = [
      '我会先检查状态：\n```json\n' + toolDecision('workspace_scan', { rootId: 'root-1' }) + '\n```',
      finalDecision('检查完成。'),
    ]
    const result = await runWorkAssistantAgentLoop({
      runId: 'fenced-json',
      prompt: '查看项目状态',
      toolNames: ['workspace_scan'],
      modelCall: async () => decisions.shift()!,
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(result.response).toBe('检查完成。')
  })

  it('repairs one malformed decision before executing a valid tool call', async () => {
    const executeTool = vi.fn(async () => ({ ok: true, summary: 'status ok' }))
    const modelCall = vi
      .fn()
      .mockResolvedValueOnce('工具决策：我先查看项目状态。')
      .mockResolvedValueOnce(toolDecision('workspace_scan', { rootId: 'root-1' }))
      .mockResolvedValueOnce(finalDecision('检查完成。'))

    const result = await runWorkAssistantAgentLoop({
      runId: 'repair-json',
      prompt: '查看项目状态',
      toolNames: ['workspace_scan'],
      modelCall,
      executeTool,
    })

    expect(modelCall).toHaveBeenCalledTimes(3)
    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(result.response).toBe('检查完成。')
  })

  it('repairs a decision with unknown protocol fields before executing anything', async () => {
    const executeTool = vi.fn(async () => ({ ok: true, summary: 'status ok' }))
    const modelCall = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({
        kind: 'tool_call',
        tool: { name: 'workspace_scan', arguments: { rootId: 'root-1' }, unsafe: true },
        note: '检查状态',
        unsafe: true,
      }))
      .mockResolvedValueOnce(toolDecision('workspace_scan', { rootId: 'root-1' }))
      .mockResolvedValueOnce(finalDecision('检查完成。'))

    const result = await runWorkAssistantAgentLoop({
      runId: 'strict-json',
      prompt: '查看项目状态',
      toolNames: ['workspace_scan'],
      modelCall,
      executeTool,
    })

    expect(modelCall).toHaveBeenCalledTimes(3)
    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(result.response).toBe('检查完成。')
  })

  it('does not execute a decision beyond the protocol size limit', async () => {
    const executeTool = vi.fn(async () => ({ ok: true, summary: 'should not run' }))
    const modelCall = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ kind: 'tool_call', tool: { name: 'workspace_scan', arguments: { rootId: 'root-1' } }, note: 'x'.repeat(40_000) }))
      .mockResolvedValueOnce('still not valid')

    await expect(runWorkAssistantAgentLoop({
      runId: 'oversized-json',
      prompt: '查看项目状态',
      toolNames: ['workspace_scan'],
      modelCall,
      executeTool,
    })).rejects.toThrow('未执行任何操作')
    expect(executeTool).not.toHaveBeenCalled()
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

  it('adds non-shell terminal safety guidance only when terminal is available', async () => {
    const messages: Array<{ role: string; content: string }> = []
    await runWorkAssistantAgentLoop({
      runId: 'terminal-guidance',
      prompt: '运行项目检查',
      toolNames: ['terminal_run'],
      modelCall: async (input) => {
        messages.push(...input)
        return finalDecision('检查完成。')
      },
      executeTool: vi.fn(),
    })
    expect(messages[0]?.content).toContain('never provide a shell command string')
    expect(messages[0]?.content).toContain('Never request powershell')
  })

  it('instructs the model to execute concrete computer requests through the matching tool', async () => {
    const messages: Array<{ role: string; content: string }> = []
    await runWorkAssistantAgentLoop({
      runId: 'routing-guidance',
      prompt: '帮我打开 Chrome',
      toolNames: ['desktop_list_apps', 'desktop_open_app', 'terminal_run', 'browser_snapshot'],
      modelCall: async (input) => {
        messages.push(...input)
        return finalDecision('已准备处理。')
      },
      executeTool: vi.fn(),
    })
    expect(messages[0]?.content).toContain('Concrete execution requests must use a tool')
    expect(messages[0]?.content).toContain('desktop_list_apps')
    expect(messages[0]?.content).toContain('terminal_run')
    expect(messages[0]?.content).toContain('Browser Bridge')
  })

  it('does not let a first-round refusal swallow concrete app, git, or browser requests', async () => {
    const cases = [
      {
        runId: 'force-app-tool',
        prompt: '帮我打开 Chrome',
        toolNames: ['desktop_list_apps', 'desktop_open_app'],
        decisions: [
          finalDecision('抱歉，我无法打开您的电脑应用。'),
          toolDecision('desktop_list_apps', {}),
          finalDecision('已列出可用浏览器。'),
          toolDecision('desktop_open_app', { appId: 'browser.chrome' }),
          finalDecision('已请求打开浏览器，正在等待确认。'),
        ],
        expectedTools: ['desktop_list_apps', 'desktop_open_app'],
        expectedDecisionCalls: 5,
      },
      {
        runId: 'force-git-tool',
        prompt: '帮我运行 git status',
        toolNames: ['terminal_run'],
        decisions: [
          finalDecision('抱歉，我无法运行 Git 命令。'),
          toolDecision('terminal_run', { operation: 'git_status', rootId: 'project' }),
          finalDecision('已读取 Git 状态。'),
        ],
        expectedTools: ['terminal_run'],
        expectedDecisionCalls: 3,
      },
      {
        runId: 'force-browser-tool',
        prompt: '帮我查看并控制当前浏览器页面',
        toolNames: ['browser_snapshot', 'browser_click'],
        decisions: [
          finalDecision('抱歉，我无法控制您的浏览器。'),
          toolDecision('browser_snapshot', {}),
          finalDecision('已读取当前页面。'),
        ],
        expectedTools: ['browser_snapshot'],
        expectedDecisionCalls: 3,
      },
    ] as const

    for (const testCase of cases) {
      const decisions = [...testCase.decisions]
      const executeTool = vi.fn(async (call: { name: string }) => ({
        ok: true,
        summary: call.name,
        data: call.name === 'desktop_list_apps' ? { applications: [{ id: 'browser.chrome', label: 'Google Chrome' }] } : undefined,
      }))
      const modelCall = vi.fn(async () => decisions.shift()!)

      const result = await runWorkAssistantAgentLoop({
        runId: testCase.runId,
        prompt: testCase.prompt,
        toolNames: testCase.toolNames,
        modelCall,
        executeTool,
      })

      expect(executeTool.mock.calls.map(([call]) => call.name)).toEqual(testCase.expectedTools)
      expect(modelCall).toHaveBeenCalledTimes(testCase.expectedDecisionCalls)
      expect(result.response).toMatch(/已/)
    }
  })

  it('requires an available requested browser to reach the launch approval step', async () => {
    const decisions = [
      toolDecision('desktop_list_apps', {}),
      finalDecision('已找到 Google Chrome。'),
      toolDecision('desktop_open_app', { appId: 'browser.chrome' }),
      finalDecision('已请求打开 Google Chrome，正在等待你的确认。'),
    ]
    const executeTool = vi.fn(async (call: { name: string; arguments: Record<string, unknown> }) => {
      if (call.name === 'desktop_list_apps') {
        return {
          ok: true,
          summary: '已列出可用应用。',
          data: { applications: [{ id: 'browser.chrome', label: 'Google Chrome', kind: 'browser' }] },
        }
      }
      return { ok: true, summary: '已请求打开应用。' }
    })

    const result = await runWorkAssistantAgentLoop({
      runId: 'open-browser-to-completion',
      prompt: '帮我打开 Chrome',
      toolNames: ['desktop_list_apps', 'desktop_open_app'],
      modelCall: async () => decisions.shift()!,
      executeTool,
    })

    expect(executeTool.mock.calls.map(([call]) => call.name)).toEqual([
      'desktop_list_apps',
      'desktop_open_app',
    ])
    expect(result.response).toContain('Google Chrome')
  })

  it('does not execute a browser launch until the model uses an id returned by application discovery', async () => {
    const decisions = [
      toolDecision('desktop_open_app', { appId: 'browser.not-real' }),
      toolDecision('desktop_list_apps', {}),
      toolDecision('desktop_open_app', { appId: 'browser.chrome' }),
      finalDecision('已请求打开 Google Chrome，正在等待你的确认。'),
    ]
    const executeTool = vi.fn(async (call: { name: string; arguments: Record<string, unknown> }) => {
      if (call.name === 'desktop_list_apps') {
        return {
          ok: true,
          summary: '已列出可用应用。',
          data: { applications: [{ id: 'browser.chrome', label: 'Google Chrome', kind: 'browser' }] },
        }
      }
      return { ok: true, summary: '已请求打开应用。' }
    })

    await runWorkAssistantAgentLoop({
      runId: 'open-browser-with-opaque-id',
      prompt: '帮我打开 Chrome',
      toolNames: ['desktop_list_apps', 'desktop_open_app'],
      modelCall: async () => decisions.shift()!,
      executeTool,
    })

    expect(executeTool.mock.calls.map(([call]) => call.name)).toEqual([
      'desktop_list_apps',
      'desktop_open_app',
    ])
    expect(executeTool.mock.calls[1]?.[0].arguments).toEqual({ appId: 'browser.chrome' })
  })

  it('keeps non-browser application launches on their existing controlled path', async () => {
    const decisions = [
      toolDecision('desktop_open_app', { appId: 'editor.vscode' }),
      finalDecision('已请求启动 VS Code，正在等待你的确认。'),
    ]
    const executeTool = vi.fn(async (call: { name: string }) => {
      void call
      return { ok: true, summary: '已请求启动应用。' }
    })

    await runWorkAssistantAgentLoop({
      runId: 'open-non-browser-app',
      prompt: '帮我打开 VS Code 应用',
      toolNames: ['desktop_open_app'],
      modelCall: async () => decisions.shift()!,
      executeTool,
    })

    expect(executeTool.mock.calls.map(([call]) => call.name)).toEqual(['desktop_open_app'])
  })

  it('corrects a Git execution request that also asks for the result', async () => {
    const decisions = [
      finalDecision('抱歉，我无法运行 Git 命令。'),
      toolDecision('terminal_run', { operation: 'git_status', rootId: 'project' }),
      finalDecision('Git 状态已读取。'),
    ]
    const executeTool = vi.fn(async (call: { name: string }) => {
      void call
      return { ok: true, summary: 'Git 状态已读取。' }
    })

    const result = await runWorkAssistantAgentLoop({
      runId: 'git-result-request',
      prompt: '帮我运行 git status 并告诉我结果',
      toolNames: ['terminal_run'],
      modelCall: async () => decisions.shift()!,
      executeTool,
    })

    expect(executeTool.mock.calls.map(([call]) => call.name)).toEqual(['terminal_run'])
    expect(result.response).toBe('Git 状态已读取。')
  })

  it('keeps capability questions and unpaired browser requests as explanations', async () => {
    const capabilityModel = vi.fn(async () => finalDecision('可以，在配对后我会按审批流程操作。'))
    await expect(runWorkAssistantAgentLoop({
      runId: 'capability-question',
      prompt: '你能不能控制浏览器？',
      toolNames: ['browser_snapshot'],
      modelCall: capabilityModel,
      executeTool: vi.fn(),
    })).resolves.toMatchObject({ response: '可以，在配对后我会按审批流程操作。' })
    expect(capabilityModel).toHaveBeenCalledTimes(1)

    const unpairedModel = vi.fn(async () => finalDecision('请先配对 Browser Bridge。'))
    const executeTool = vi.fn()
    await expect(runWorkAssistantAgentLoop({
      runId: 'unpaired-browser',
      prompt: '帮我控制浏览器',
      toolNames: ['web_extract'],
      capabilityNotes: ['Browser Bridge 当前未配对，请先确认浏览器扩展。'],
      modelCall: unpairedModel,
      executeTool,
    })).resolves.toMatchObject({ response: '请先配对 Browser Bridge。' })
    expect(unpairedModel).toHaveBeenCalledTimes(1)
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('passes a bounded runtime capability note to the planner without exposing unavailable tools', async () => {
    const messages: Array<{ role: string; content: string }> = []
    await runWorkAssistantAgentLoop({
      runId: 'capability-note',
      prompt: '查看当前标签页',
      toolNames: ['web_extract'],
      capabilityNotes: ['Browser Bridge 当前未配对：请用户在浏览器扩展中确认当前标签页。'],
      modelCall: async (input) => {
        messages.push(...input)
        return finalDecision('请先确认当前标签页。')
      },
      executeTool: vi.fn(),
    })

    expect(messages[0]?.content).toContain('Browser Bridge 当前未配对')
    expect(messages[0]?.content).not.toContain('browser_click')
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
