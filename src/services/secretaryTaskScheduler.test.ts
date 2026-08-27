import { describe, expect, it } from 'vitest'
import { isAutoStartEligibleSecretaryTask, selectNextAutoStartSecretaryTask } from './secretaryTaskScheduler'
import type { SecretaryLedgerTask } from './secretaryLedgerClient'

const task = (patch: Partial<SecretaryLedgerTask> = {}): SecretaryLedgerTask => ({
  id: 'task-1',
  projectId: 'project-1',
  title: '任务',
  request: '写一份项目周报',
  status: 'queued',
  priority: 3,
  scheduleAt: 1_000,
  nextStep: null,
  publicPlan: null,
  summary: null,
  createdAt: 10,
  updatedAt: 10,
  ...patch,
})

describe('secretary task scheduler', () => {
  it('auto-starts only due, queued writing tasks', () => {
    expect(isAutoStartEligibleSecretaryTask(task(), 1_000)).toBe(true)
    expect(isAutoStartEligibleSecretaryTask(task({ scheduleAt: 1_001 }), 1_000)).toBe(false)
    expect(isAutoStartEligibleSecretaryTask(task({ status: 'paused' }), 1_000)).toBe(false)
  })

  it('keeps local computer and browser actions at a manual approval boundary', () => {
    expect(isAutoStartEligibleSecretaryTask(task({ request: '打开桌面上的合同文件' }), 1_000)).toBe(false)
    expect(isAutoStartEligibleSecretaryTask(task({ request: '打开网页并提交表单' }), 1_000)).toBe(false)
  })

  it('selects one due task by schedule time, then priority', () => {
    const selected = selectNextAutoStartSecretaryTask([
      task({ id: 'later', scheduleAt: 900, priority: 1 }),
      task({ id: 'first-low', scheduleAt: 800, priority: 1 }),
      task({ id: 'first-high', scheduleAt: 800, priority: 5 }),
      task({ id: 'computer', request: '整理下载文件夹', scheduleAt: 700 }),
    ], 1_000)

    expect(selected?.id).toBe('first-high')
  })
})

