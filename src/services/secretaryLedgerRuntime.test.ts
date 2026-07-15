import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ledger = vi.hoisted(() => ({
  bootstrapSecretaryLedger: vi.fn(),
  createSecretaryLedgerProject: vi.fn(),
  createSecretaryLedgerTask: vi.fn(),
  importSecretaryLedgerLegacyBatch: vi.fn(),
  isSecretaryLedgerRuntimeAvailable: vi.fn(),
  listSecretaryLedgerMemories: vi.fn(),
  listSecretaryLedgerProjects: vi.fn(),
  listSecretaryLedgerTasks: vi.fn(),
  loadLatestSecretaryLedgerCheckpoint: vi.fn(),
  recordSecretaryLedgerEvent: vi.fn(),
  saveSecretaryLedgerCheckpoint: vi.fn(),
  updateSecretaryLedgerTask: vi.fn(),
}))

vi.mock('./secretaryLedgerClient', () => ledger)

import {
  beginSecretaryLedgerRun,
  checkpointSecretaryLedgerRun,
  loadSecretaryLedgerRecovery,
  initializeSecretaryLedgerRuntime,
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
  ledger.listSecretaryLedgerMemories.mockResolvedValue({
    ok: true,
    value: [
      {
        id: 'memory-1', scope: 'project', projectId: 'story-story-a', kind: 'fact',
        content: '项目材料要使用克制、具体的表达。', source: 'user', confidence: 0.9,
        status: 'verified', revision: 1, createdAt: 1, updatedAt: 1,
      },
    ],
  })
  ledger.listSecretaryLedgerTasks.mockResolvedValue({ ok: true, value: [] })
  ledger.loadLatestSecretaryLedgerCheckpoint.mockResolvedValue({ ok: true, value: null })
  ledger.updateSecretaryLedgerTask.mockResolvedValue({ ok: true, value: task })
  ledger.recordSecretaryLedgerEvent.mockResolvedValue({ ok: true, value: { taskId: task.id, sequence: 1, eventType: 'started', payload: {}, createdAt: 1 } })
  ledger.saveSecretaryLedgerCheckpoint.mockResolvedValue({ ok: true, value: { taskId: task.id, sequence: 1, contextSnapshot: {}, nextStep: '继续', createdAt: 1 } })
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
    expect(ledger.createSecretaryLedgerProject).toHaveBeenCalledWith(expect.objectContaining({
      id: 'story-story-a', title: '招商材料', kind: 'writing', storyProjectId: 'story-a', chatId: 'chat-a',
    }))
    expect(ledger.createSecretaryLedgerTask).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      expect.objectContaining({ projectId: 'story-story-a', status: 'queued' }),
    )
    expect(ledger.updateSecretaryLedgerTask).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      'ledger-task-1',
      expect.objectContaining({ status: 'running' }),
    )
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
    expect(ledger.saveSecretaryLedgerCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ currentProjectId: 'story-story-a' }),
      'ledger-task-1',
      expect.objectContaining({ nextStep: '等待用户确认摘要。' }),
    )
  })
})
