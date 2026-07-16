import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ledger = vi.hoisted(() => ({
  bootstrapSecretaryLedger: vi.fn(),
  claimSecretaryLedgerTask: vi.fn(),
  createSecretaryLedgerProject: vi.fn(),
  createSecretaryLedgerTask: vi.fn(),
  getSecretaryLedgerTask: vi.fn(),
  importSecretaryLedgerLegacyBatch: vi.fn(),
  isSecretaryLedgerRuntimeAvailable: vi.fn(),
  listSecretaryLedgerMemories: vi.fn(),
  listSecretaryLedgerProjects: vi.fn(),
  listSecretaryLedgerTasks: vi.fn(),
  loadLatestSecretaryLedgerCheckpoint: vi.fn(),
  recordSecretaryLedgerEvent: vi.fn(),
  saveSecretaryLedgerCheckpoint: vi.fn(),
  startSecretaryLedgerTask: vi.fn(),
  persistSecretaryLedgerTaskProgress: vi.fn(),
  updateSecretaryLedgerTask: vi.fn(),
}))

vi.mock('./secretaryLedgerClient', () => ledger)

import {
  beginSecretaryLedgerRun,
  checkpointSecretaryLedgerAwaitingApproval,
  checkpointSecretaryLedgerRun,
  createSecretaryLedgerToolEventHandler,
  finishSecretaryLedgerRun,
  loadSecretaryTaskCenterSnapshot,
  loadSecretaryLedgerRecovery,
  pauseActiveSecretaryLedgerRuns,
  initializeSecretaryLedgerRuntime,
  recordSecretaryLedgerToolReceipt,
  resetSecretaryLedgerRuntimeForTests,
} from './secretaryLedgerRuntime'
import { useAppStore } from '../stores/useAppStore'

const project = {
  id: 'story-a',
  chatId: 'chat-a',
  title: '招商材料',
  genre: 'nonfiction',
  targetScale: 'short',
  premise: '年度招商',
  protagonist: '',
  coreConflict: '',
  createdAt: 1,
  updatedAt: 2,
}

const chat = {
  id: 'chat-a',
  title: '招商对话',
  messages: [],
  articleIds: [],
  createdAt: 1,
  updatedAt: 2,
}

const task = {
  id: 'ledger-task-1',
  projectId: 'story-story-a',
  title: '整理招商材料',
  request: '整理招商材料并起草摘要。',
  status: 'queued' as const,
  priority: 3,
  scheduleAt: null,
  nextStep: null,
  publicPlan: null,
  summary: null,
  createdAt: 1,
  updatedAt: 2,
}

const taskProgress = {
  task,
  events: [{ taskId: task.id, sequence: 1, eventType: 'started', payload: {}, createdAt: 1 }],
  checkpoint: { taskId: task.id, sequence: 1, contextSnapshot: {}, nextStep: '继续', createdAt: 1 },
}

const initialState = useAppStore.getState()

beforeEach(() => {
  resetSecretaryLedgerRuntimeForTests()
  vi.resetAllMocks()
  ledger.isSecretaryLedgerRuntimeAvailable.mockReturnValue(true)
  ledger.bootstrapSecretaryLedger.mockResolvedValue({ ok: true, value: { status: 'ok', schemaVersion: 6, ftsAvailable: true, bytes: 1 } })
  ledger.importSecretaryLedgerLegacyBatch.mockResolvedValue({ ok: true, value: { imported: true, projectsImported: 2, memoriesImported: 2, tasksImported: 0 } })
  ledger.listSecretaryLedgerProjects.mockResolvedValue({ ok: true, value: [] })
  ledger.createSecretaryLedgerProject.mockImplementation(async (input: { id: string; title: string; kind: string }) => ({
    ok: true,
    value: { ...input, storyProjectId: null, chatId: null, createdAt: 1, updatedAt: 1, archived: false },
  }))
  ledger.createSecretaryLedgerTask.mockResolvedValue({ ok: true, value: task })
  ledger.claimSecretaryLedgerTask.mockResolvedValue({ ok: true, value: taskProgress })
  ledger.getSecretaryLedgerTask.mockResolvedValue({ ok: true, value: task })
  ledger.listSecretaryLedgerMemories.mockResolvedValue({
    ok: true,
    value: [
      {
        id: 'memory-1', scope: 'project', projectId: 'story-story-a', kind: 'fact',
        content: '项目材料要使用克制、具体的表达。', source: 'user', confidence: 0.9,
        status: 'verified', revision: 1, createdAt: 1, updatedAt: 1,
      },
      {
        id: 'memory-pending', scope: 'project', projectId: 'story-story-a', kind: 'fact',
        content: '未经确认的推测不应进入本轮上下文。', source: 'agent', confidence: 0.8,
        status: 'tentative', revision: 1, createdAt: 1, updatedAt: 1,
      },
    ],
  })
  ledger.listSecretaryLedgerTasks.mockResolvedValue({ ok: true, value: [] })
  ledger.loadLatestSecretaryLedgerCheckpoint.mockResolvedValue({ ok: true, value: null })
  ledger.updateSecretaryLedgerTask.mockResolvedValue({ ok: true, value: task })
  ledger.recordSecretaryLedgerEvent.mockResolvedValue({ ok: true, value: { taskId: task.id, sequence: 1, eventType: 'started', payload: {}, createdAt: 1 } })
  ledger.saveSecretaryLedgerCheckpoint.mockResolvedValue({ ok: true, value: { taskId: task.id, sequence: 1, contextSnapshot: {}, nextStep: '继续', createdAt: 1 } })
  ledger.startSecretaryLedgerTask.mockResolvedValue({ ok: true, value: taskProgress })
  ledger.persistSecretaryLedgerTaskProgress.mockResolvedValue({ ok: true, value: taskProgress })
  useAppStore.setState({
    activeStoryProjectId: 'story-a',
    storyProjects: [project],
    activeChatId: 'chat-a',
    chatSessions: [chat],
    userMemoryRecords: [
      {
        id: 'preference-1', category: 'preference', content: '偏好使用克制、清楚的中文。',
        source: 'manual', enabled: true, confidence: 0.92, createdAt: 1, updatedAt: 2,
      },
      {
        id: 'secret-1', category: 'other', content: '密码是 should-not-migrate。',
        source: 'manual', enabled: true, confidence: 1, createdAt: 1, updatedAt: 2,
      },
    ],
    projectWritingMemories: [
      {
        id: 'project-memory-1', projectId: 'story-a', title: '语气', content: '客户材料避免夸张承诺。',
        tags: [], enabled: true, source: 'manual', createdAt: 1, updatedAt: 2,
      },
    ],
    agentRuns: [],
  })
})

afterEach(() => {
  resetSecretaryLedgerRuntimeForTests()
  useAppStore.setState(initialState)
})

describe('secretary ledger runtime', () => {
  it('migrates only safe, explicitly scoped legacy data after SQLite bootstrap', async () => {
    await expect(initializeSecretaryLedgerRuntime()).resolves.toMatchObject({ available: true, migrated: true })

    expect(ledger.importSecretaryLedgerLegacyBatch).toHaveBeenCalledWith(expect.objectContaining({
      migrationKey: 'secretary-ledger-v1',
      projects: expect.arrayContaining([
        expect.objectContaining({ id: 'story-story-a', title: '招商材料', kind: 'writing' }),
        expect.objectContaining({ id: 'chat-chat-a', title: '招商对话', kind: 'conversation' }),
      ]),
      memories: expect.arrayContaining([
        expect.objectContaining({ scope: 'personal', content: '偏好使用克制、清楚的中文。' }),
        expect.objectContaining({ scope: 'project', projectId: 'story-story-a', content: '客户材料避免夸张承诺。' }),
      ]),
    }))

    const migrated = ledger.importSecretaryLedgerLegacyBatch.mock.calls[0]?.[0]
    expect(JSON.stringify(migrated)).not.toContain('should-not-migrate')
  })

  it('binds a new secretary run to its active writing project and hydrates verified project memory', async () => {
    const run = await beginSecretaryLedgerRun({
      runId: 'run-1',
      prompt: '整理招商材料并起草摘要。',
      title: '整理招商材料',
    })

    expect(run).toMatchObject({ projectId: 'story-story-a', taskId: 'ledger-task-1' })
    expect(run?.memoryContext).toContain('项目材料要使用克制、具体的表达。')
    expect(run?.memoryContext).not.toContain('未经确认的推测')
    expect(ledger.createSecretaryLedgerProject).toHaveBeenCalledWith(expect.objectContaining({
      id: 'story-story-a', title: '招商材料', kind: 'writing', storyProjectId: 'story-a', chatId: 'chat-a',
    }))
    expect(ledger.startSecretaryLedgerTask).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      expect.objectContaining({
        task: expect.objectContaining({ projectId: 'story-story-a', status: 'queued' }),
        events: [expect.objectContaining({ eventType: 'started' })],
      }),
    )
    expect(ledger.createSecretaryLedgerTask).not.toHaveBeenCalled()
    expect(ledger.persistSecretaryLedgerTaskProgress).not.toHaveBeenCalled()
  })

  it('claims an existing queued task atomically instead of creating a duplicate during recovery', async () => {
    const run = await beginSecretaryLedgerRun({
      runId: 'run-existing',
      prompt: '继续处理招商材料。',
      title: '继续招商材料',
      taskId: task.id,
    })

    expect(run).toMatchObject({ taskId: task.id, projectId: 'story-story-a' })
    expect(ledger.claimSecretaryLedgerTask).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      task.id,
      expect.objectContaining({ events: [expect.objectContaining({ eventType: 'started' })] }),
    )
    expect(ledger.createSecretaryLedgerTask).not.toHaveBeenCalled()
  })

  it('fails visibly when an atomic recovery claim loses contention instead of launching a second run', async () => {
    ledger.claimSecretaryLedgerTask.mockResolvedValueOnce({ ok: true, value: null })

    await expect(beginSecretaryLedgerRun({
      runId: 'run-claim-conflict',
      prompt: '继续处理招商材料。',
      title: '继续招商材料',
      taskId: task.id,
    })).rejects.toThrow('已由其他调度器开始')

    expect(ledger.claimSecretaryLedgerTask).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      task.id,
      expect.objectContaining({ events: [expect.objectContaining({ eventType: 'started' })] }),
    )
    expect(ledger.updateSecretaryLedgerTask).not.toHaveBeenCalled()
  })

  it('keeps an active runtime run when its final durable checkpoint cannot be confirmed', async () => {
    const run = await beginSecretaryLedgerRun({
      runId: 'run-durability-failure',
      prompt: '整理招商材料并起草摘要。',
      title: '整理招商材料',
    })
    vi.clearAllMocks()
    ledger.persistSecretaryLedgerTaskProgress.mockResolvedValueOnce({
      ok: false,
      code: 'native_unavailable',
      message: '秘书账本暂不可用，请稍后重试。',
    })

    await expect(finishSecretaryLedgerRun(run, {
      status: 'completed',
      summary: '交付物已经生成。',
    })).rejects.toThrow('秘书账本暂不可用')

    ledger.persistSecretaryLedgerTaskProgress.mockResolvedValueOnce({ ok: true, value: taskProgress })
    await pauseActiveSecretaryLedgerRuns()
    expect(ledger.persistSecretaryLedgerTaskProgress).toHaveBeenCalledTimes(2)
  })

  it('projects only public story and chat identifiers for the task-center project selector', async () => {
    ledger.listSecretaryLedgerProjects.mockResolvedValue({
      ok: true,
      value: [{
        id: 'story-story-a', title: '招商材料', kind: 'writing', storyProjectId: 'story-a', chatId: 'chat-a',
        createdAt: 1, updatedAt: 2, archived: false,
      }],
    })

    await expect(loadSecretaryTaskCenterSnapshot()).resolves.toMatchObject({
      projects: [{ id: 'story-story-a', storyProjectId: 'story-a', chatId: 'chat-a' }],
    })
  })

  it('disables new ledger persistence when the desktop runtime is unavailable', async () => {
    ledger.isSecretaryLedgerRuntimeAvailable.mockReturnValue(false)

    await expect(initializeSecretaryLedgerRuntime()).resolves.toMatchObject({ available: false })
    await expect(beginSecretaryLedgerRun({ runId: 'run-2', prompt: '整理资料', title: '整理资料' })).resolves.toBeUndefined()
    expect(ledger.bootstrapSecretaryLedger).not.toHaveBeenCalled()
    expect(ledger.createSecretaryLedgerTask).not.toHaveBeenCalled()
  })

  it('persists a bounded checkpoint and reloads only resumable tasks for the active project', async () => {
    const run = await beginSecretaryLedgerRun({
      runId: 'run-3',
      prompt: '整理招商材料并起草摘要。',
      title: '整理招商材料',
    })
    await checkpointSecretaryLedgerRun(run, {
      phase: 'review',
      summary: '已整理两份材料。',
      nextStep: '等待用户确认摘要。',
      status: 'awaiting_approval',
    })
    ledger.listSecretaryLedgerTasks.mockResolvedValue({
      ok: true,
      value: [{ ...task, status: 'awaiting_approval' }],
    })
    ledger.loadLatestSecretaryLedgerCheckpoint.mockResolvedValue({
      ok: true,
      value: {
        taskId: task.id,
        sequence: 2,
        contextSnapshot: { summary: '已整理两份材料。' },
        nextStep: '等待用户确认摘要。',
        createdAt: 4,
      },
    })

    await expect(loadSecretaryLedgerRecovery()).resolves.toEqual([
      expect.objectContaining({
        task: expect.objectContaining({ id: 'ledger-task-1' }),
        checkpoint: { summary: '已整理两份材料。', nextStep: '等待用户确认摘要。', createdAt: 4 },
      }),
    ])
    expect(ledger.persistSecretaryLedgerTaskProgress).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      'ledger-task-1',
      expect.objectContaining({ checkpoint: expect.objectContaining({ nextStep: '等待用户确认摘要。' }) }),
    )
  })

  it('persists an awaiting-approval status, event, and resumable checkpoint for an active run', async () => {
    const run = await beginSecretaryLedgerRun({
      runId: 'run-approval',
      prompt: '整理招商材料并起草摘要。',
      title: '整理招商材料',
    })
    vi.clearAllMocks()

    await checkpointSecretaryLedgerAwaitingApproval(run)

    expect(ledger.persistSecretaryLedgerTaskProgress).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      task.id,
      expect.objectContaining({
        task: {
          status: 'awaiting_approval',
          summary: '操作已暂停，等待用户确认。',
          nextStep: '等待用户确认后继续。',
        },
        events: [{
          eventType: 'awaiting_approval',
          payload: {
            phase: 'awaiting_approval',
            summary: '操作已暂停，等待用户确认。',
          },
        }],
        checkpoint: {
          contextSnapshot: {
            phase: 'awaiting_approval',
            summary: '操作已暂停，等待用户确认。',
            projectId: 'story-story-a',
          },
          nextStep: '等待用户确认后继续。',
        },
      }),
    )
  })

  it('records only normalized tool receipt metadata that remains searchable', async () => {
    const run = await beginSecretaryLedgerRun({
      runId: 'run-receipt',
      prompt: '整理招商材料并起草摘要。',
      title: '整理招商材料',
    })
    vi.clearAllMocks()

    await recordSecretaryLedgerToolReceipt(run, {
      toolName: 'browser.navigate',
      ok: false,
      errorCode: 'permission-denied',
    })

    expect(ledger.recordSecretaryLedgerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      task.id,
      {
        eventType: 'tool_receipt',
        payload: {
          tool: 'browser',
          ok: false,
          outcome: 'failed',
          errorCode: 'permission_denied',
        },
      },
    )
  })

  it('reduces unrecognized tool error text to a fixed generic error class', async () => {
    const run = await beginSecretaryLedgerRun({
      runId: 'run-unknown-error',
      prompt: '整理招商材料并起草摘要。',
      title: '整理招商材料',
    })
    vi.clearAllMocks()
    const rawError = 'Error: C:\\Users\\Administrator\\secret.txt token=abc123'

    await recordSecretaryLedgerToolReceipt(run, {
      toolName: 'terminal.execute --target C:\\Users\\Administrator\\secret.txt',
      ok: false,
      errorCode: rawError,
    })

    expect(ledger.recordSecretaryLedgerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      task.id,
      {
        eventType: 'tool_receipt',
        payload: {
          tool: 'terminal',
          ok: false,
          outcome: 'failed',
          errorCode: 'unknown',
        },
      },
    )
    expect(JSON.stringify(ledger.recordSecretaryLedgerEvent.mock.calls)).not.toContain(rawError)
  })

  it('rejects terminal and browser receipt payloads with raw execution data or errors', async () => {
    const run = await beginSecretaryLedgerRun({
      runId: 'run-unsafe-receipt',
      prompt: '整理招商材料并起草摘要。',
      title: '整理招商材料',
    })
    vi.clearAllMocks()
    const rawPayload = {
      toolName: 'terminal.execute',
      ok: false,
      errorCode: 'Error: C:\\Users\\Administrator\\secret.txt token=abc123',
      args: ['type', 'C:\\Users\\Administrator\\secret.txt'],
      target: 'C:\\Users\\Administrator\\secret.txt',
      result: { data: 'Bearer abc123 and browser page content' },
    }

    await recordSecretaryLedgerToolReceipt(run, rawPayload as never)

    expect(ledger.recordSecretaryLedgerEvent).not.toHaveBeenCalled()
    expect(JSON.stringify(ledger.recordSecretaryLedgerEvent.mock.calls)).not.toContain('abc123')
    expect(JSON.stringify(ledger.recordSecretaryLedgerEvent.mock.calls)).not.toContain('browser page content')
  })

  it('persists the approval boundary and a safe tool receipt before dispatching a work-assistant event', async () => {
    const run = await beginSecretaryLedgerRun({
      runId: 'run-ledger-event',
      prompt: '整理招商材料并起草摘要。',
      title: '整理招商材料',
    })
    const dispatchOrder: string[] = []
    vi.clearAllMocks()
    ledger.persistSecretaryLedgerTaskProgress.mockImplementation(async () => {
      dispatchOrder.push('persist')
      return { ok: true, value: taskProgress }
    })
    const emit = createSecretaryLedgerToolEventHandler(run, 'terminal_pdf_to_text', () => dispatchOrder.push('dispatch'))
    await emit({
      type: 'approval.required',
      runId: 'run-ledger-event',
      request: {
        id: 'preview-1',
        revision: '1',
        risk: 'read',
        title: '受控工具：terminal_pdf_to_text',
        targetSummary: '已隐藏具体目标详情。',
        impactSummary: '此受控工具需要确认后执行。',
        reversible: true,
        expiresAt: 1,
        runId: 'run-ledger-event',
        toolCallId: 'terminal-call',
        reason: '受控文档提取需要确认。',
        allowedChoices: ['once', 'deny'],
      },
      at: 1,
    })

    expect(dispatchOrder).toEqual(['persist', 'dispatch'])
    expect(ledger.persistSecretaryLedgerTaskProgress).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      task.id,
      expect.objectContaining({ task: expect.objectContaining({ status: 'awaiting_approval' }) }),
    )

    dispatchOrder.length = 0
    ledger.persistSecretaryLedgerTaskProgress.mockClear()

    await emit({
      type: 'tool.progress',
      runId: 'run-ledger-event',
      toolCallId: 'terminal-call',
      message: '审批通过，正在执行',
      at: 2,
    })

    expect(dispatchOrder).toEqual(['persist', 'dispatch'])
    expect(ledger.persistSecretaryLedgerTaskProgress).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      task.id,
      expect.objectContaining({ task: expect.objectContaining({ status: 'running', summary: '受控工具正在执行。' }) }),
    )

    dispatchOrder.length = 0
    ledger.persistSecretaryLedgerTaskProgress.mockClear()

    await emit({
      type: 'tool.completed',
      runId: 'run-ledger-event',
      toolCallId: 'terminal-call',
      result: {
        ok: false,
        summary: 'C:/private/meeting.pdf token=secret must never persist',
        errorCode: 'Error: C:/private/meeting.pdf token=secret',
        data: { text: 'private document body' },
      },
      at: 2,
    })

    expect(dispatchOrder).toEqual(['persist', 'dispatch'])
    expect(ledger.persistSecretaryLedgerTaskProgress).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      task.id,
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            eventType: 'tool_receipt',
            payload: { tool: 'terminal', ok: false, outcome: 'failed', errorCode: 'unknown' },
          }),
        ]),
        task: expect.objectContaining({ status: 'running', summary: '受控工具结果已记录。' }),
      }),
    )
    expect(JSON.stringify(ledger.persistSecretaryLedgerTaskProgress.mock.calls)).not.toContain('private document body')
    expect(JSON.stringify(ledger.persistSecretaryLedgerTaskProgress.mock.calls)).not.toContain('token=secret')
  })

  it('leaves the ledger untouched when no persistent run is available', async () => {
    await checkpointSecretaryLedgerAwaitingApproval(undefined)
    await recordSecretaryLedgerToolReceipt(undefined, {
      toolName: 'terminal.execute',
      ok: true,
    })

    expect(ledger.updateSecretaryLedgerTask).not.toHaveBeenCalled()
    expect(ledger.recordSecretaryLedgerEvent).not.toHaveBeenCalled()
    expect(ledger.saveSecretaryLedgerCheckpoint).not.toHaveBeenCalled()
  })
})
