import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  loadSecretaryTaskCenterSnapshot: vi.fn(),
  createSecretaryTaskCenterMemory: vi.fn(),
  deleteSecretaryTaskCenterMemory: vi.fn(),
  queueSecretaryLedgerTask: vi.fn(),
  rollbackSecretaryTaskCenterMemory: vi.fn(),
  updateSecretaryTaskCenterMemory: vi.fn(),
  updateSecretaryTaskCenterStatus: vi.fn(),
}))
const ledger = vi.hoisted(() => ({ searchSecretaryLedger: vi.fn() }))

vi.mock('../services/secretaryLedgerRuntime', () => runtime)
vi.mock('../services/secretaryLedgerClient', () => ledger)

import { SecretaryTaskCenter } from './SecretaryTaskCenter'
import { useAppStore } from '../stores/useAppStore'

const task = {
  id: 'task-1', projectId: 'story-a', title: '整理访谈摘要', request: '整理访谈摘要并起草邮件。', status: 'paused' as const,
  priority: 3, scheduleAt: null, nextStep: '从访谈资料中提取三项结论。', publicPlan: null, summary: '已整理一半。', createdAt: 1, updatedAt: 2,
}

beforeEach(() => {
  vi.resetAllMocks()
  runtime.loadSecretaryTaskCenterSnapshot.mockResolvedValue({
    state: { available: true, migrated: true },
    project: { id: 'story-a', title: '招商材料', kind: 'writing' },
    projects: [{ id: 'story-a', title: '招商材料', kind: 'writing' }],
    memories: [{ id: 'memory-1', scope: 'project', projectId: 'story-a', kind: 'fact', content: '对外表述避免夸张承诺。', source: 'user_confirmed', confidence: 1, status: 'verified', revision: 2, createdAt: 1, updatedAt: 2 }],
    tasks: [task],
    recovery: [{ task, checkpoint: { summary: '已整理一半。', nextStep: '从访谈资料中提取三项结论。', createdAt: 2 } }],
  })
})

const originalProjectNavigation = {
  activeChatId: useAppStore.getState().activeChatId,
  activeStoryProjectId: useAppStore.getState().activeStoryProjectId,
  switchChatSession: useAppStore.getState().switchChatSession,
  setActiveStoryProject: useAppStore.getState().setActiveStoryProject,
}

afterEach(() => {
  useAppStore.setState(originalProjectNavigation)
})

describe('SecretaryTaskCenter', () => {
  it('keeps project context visible and resumes the selected persisted task', async () => {
    const onStartTask = vi.fn()
    render(<SecretaryTaskCenter onStartTask={onStartTask} onOpenMaterials={vi.fn()} />)

    expect(await screen.findByText('招商材料')).toBeInTheDocument()
    expect(screen.getByText('对外表述避免夸张承诺。')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('开始或继续任务'))
    expect(onStartTask).toHaveBeenCalledWith(task, expect.objectContaining({ checkpoint: expect.any(Object) }))
  })

  it('creates an explicit queued task instead of launching it automatically', async () => {
    runtime.queueSecretaryLedgerTask.mockResolvedValue({ ok: true, value: task })
    render(<SecretaryTaskCenter onStartTask={vi.fn()} onOpenMaterials={vi.fn()} />)
    await screen.findByText('招商材料')

    fireEvent.click(screen.getByTitle('新增待办任务'))
    fireEvent.change(screen.getByLabelText('待办任务'), { target: { value: '下周整理会议纪要' } })
    fireEvent.click(screen.getByText('加入队列'))

    await waitFor(() => expect(runtime.queueSecretaryLedgerTask).toHaveBeenCalledWith(expect.objectContaining({
      request: '下周整理会议纪要', scheduleAt: null,
    })))
  })

  it('switches the actual chat and story project from the ledger project selector', async () => {
    const switchChatSession = vi.fn()
    const setActiveStoryProject = vi.fn()
    useAppStore.setState({
      activeChatId: 'chat-a',
      activeStoryProjectId: 'story-a',
      switchChatSession,
      setActiveStoryProject,
    })
    runtime.loadSecretaryTaskCenterSnapshot.mockResolvedValue({
      state: { available: true, migrated: true },
      project: { id: 'story-a', title: '招商材料', kind: 'writing' },
      projects: [
        { id: 'story-a', title: '招商材料', kind: 'writing', storyProjectId: 'story-a', chatId: 'chat-a' },
        { id: 'story-b', title: '客户访谈', kind: 'writing', storyProjectId: 'story-b', chatId: 'chat-b' },
      ],
      memories: [],
      tasks: [],
      recovery: [],
    })

    render(<SecretaryTaskCenter onStartTask={vi.fn()} onOpenMaterials={vi.fn()} />)

    await screen.findByText('招商材料')
    fireEvent.click(screen.getByTitle('切换项目'))
    fireEvent.click(screen.getByRole('menuitem', { name: /客户访谈/ }))

    expect(switchChatSession).toHaveBeenCalledWith('chat-b')
    expect(setActiveStoryProject).toHaveBeenCalledWith('story-b')
  })
})

