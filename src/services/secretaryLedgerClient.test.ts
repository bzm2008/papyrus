import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bootstrapSecretaryLedger,
  createSecretaryLedgerMemory,
  createSecretaryLedgerProject,
  createSecretaryLedgerTask,
  deleteSecretaryLedgerMemory,
  getSecretaryLedgerHealth,
  importSecretaryLedgerLegacyBatch,
  listSecretaryLedgerMemories,
  listSecretaryLedgerProjects,
  loadLatestSecretaryLedgerCheckpoint,
  recordSecretaryLedgerEvent,
  resetSecretaryLedgerInvokerForTests,
  rollbackSecretaryLedgerMemory,
  saveSecretaryLedgerCheckpoint,
  searchSecretaryLedger,
  setSecretaryLedgerInvokerForTests,
  updateSecretaryLedgerMemory,
} from './secretaryLedgerClient'

function setTauriRuntime(value: unknown) {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value })
}

const project = {
  id: 'project-1',
  title: '年度传播计划',
  kind: 'writing',
  storyProjectId: null,
  chatId: null,
  createdAt: 1,
  updatedAt: 2,
  archived: false,
}

const memory = {
  id: 'memory-1',
  scope: 'project' as const,
  projectId: 'project-1',
  kind: 'preference',
  content: '优先使用简洁、克制的表达。',
  source: 'user',
  confidence: 0.9,
  status: 'verified',
  revision: 1,
  createdAt: 1,
  updatedAt: 2,
}

const task = {
  id: 'task-1',
  projectId: 'project-1',
  title: '整理调研摘要',
  request: '将材料整理为摘要。',
  status: 'queued' as const,
  priority: 3,
  scheduleAt: null,
  nextStep: null,
  publicPlan: null,
  summary: null,
  createdAt: 1,
  updatedAt: 2,
}

const access = { currentProjectId: 'project-1', includeCrossProject: true }

beforeEach(() => setTauriRuntime({}))

afterEach(() => {
  setTauriRuntime(undefined)
  resetSecretaryLedgerInvokerForTests()
})

describe('secretaryLedgerClient', () => {
  it('maps bootstrap and health calls to their native commands', async () => {
    const invoke = vi.fn(async () => ({ status: 'ok', schemaVersion: 5, ftsAvailable: true, bytes: 128 }))
    setSecretaryLedgerInvokerForTests(invoke)

    await expect(bootstrapSecretaryLedger()).resolves.toEqual({
      ok: true,
      value: { status: 'ok', schemaVersion: 5, ftsAvailable: true, bytes: 128 },
    })
    await expect(getSecretaryLedgerHealth()).resolves.toMatchObject({ ok: true })

    expect(invoke).toHaveBeenNthCalledWith(1, 'secretary_ledger_bootstrap', undefined)
    expect(invoke).toHaveBeenNthCalledWith(2, 'secretary_ledger_health', undefined)
  })

  it('maps project creation and listing arguments', async () => {
    const invoke = vi.fn(async (command: string) => command === 'secretary_ledger_create_project' ? project : [project])
    setSecretaryLedgerInvokerForTests(invoke)

    await expect(createSecretaryLedgerProject({ title: '年度传播计划', kind: 'writing' })).resolves.toMatchObject({ ok: true })
    await expect(listSecretaryLedgerProjects({ includeArchived: true, limit: 10 })).resolves.toMatchObject({ ok: true })

    expect(invoke).toHaveBeenNthCalledWith(1, 'secretary_ledger_create_project', {
      input: { title: '年度传播计划', kind: 'writing' },
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'secretary_ledger_list_projects', {
      includeArchived: true,
      limit: 10,
    })
  })

  it('preserves the access object for memory mutations and lists', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'secretary_ledger_list_memories') return [memory]
      if (command === 'secretary_ledger_delete_memory') return undefined
      return memory
    })
    setSecretaryLedgerInvokerForTests(invoke)

    await createSecretaryLedgerMemory(access, {
      scope: 'project',
      projectId: 'project-1',
      kind: 'preference',
      content: '优先使用简洁、克制的表达。',
      source: 'user',
      confidence: 0.9,
      status: 'verified',
    })
    await listSecretaryLedgerMemories(access, 20)
    await updateSecretaryLedgerMemory(access, 'memory-1', { content: '更新后的偏好。' })
    await rollbackSecretaryLedgerMemory(access, 'memory-1', 1)
    await deleteSecretaryLedgerMemory(access, 'memory-1')

    expect(invoke).toHaveBeenNthCalledWith(1, 'secretary_ledger_create_memory', {
      access,
      input: expect.objectContaining({ scope: 'project', projectId: 'project-1' }),
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'secretary_ledger_list_memories', { access, limit: 20 })
    expect(invoke).toHaveBeenNthCalledWith(3, 'secretary_ledger_update_memory', {
      access,
      id: 'memory-1',
      input: { content: '更新后的偏好。' },
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'secretary_ledger_rollback_memory', {
      access,
      id: 'memory-1',
      revision: 1,
    })
    expect(invoke).toHaveBeenNthCalledWith(5, 'secretary_ledger_delete_memory', { access, id: 'memory-1' })
  })

  it('maps current project and cross-project search access explicitly', async () => {
    const invoke = vi.fn(async () => [{
      id: 'memory-1',
      entityType: 'memory',
      projectId: 'project-1',
      projectTitle: '年度传播计划',
      title: 'preference',
      content: '优先使用简洁、克制的表达。',
    }])
    setSecretaryLedgerInvokerForTests(invoke)

    await expect(searchSecretaryLedger({
      query: '简洁表达',
      currentProjectId: 'project-1',
      includeCrossProject: true,
      limit: 8,
    })).resolves.toMatchObject({ ok: true })

    expect(invoke).toHaveBeenCalledWith('secretary_ledger_search', {
      input: {
        query: '简洁表达',
        currentProjectId: 'project-1',
        includeCrossProject: true,
        limit: 8,
      },
    })
  })

  it('maps task, event, and checkpoint commands with the current project access', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'secretary_ledger_record_event') {
        return { taskId: 'task-1', sequence: 1, eventType: 'plan', payload: { step: 'outline' }, createdAt: 3 }
      }
      if (command === 'secretary_ledger_save_checkpoint') {
        return { taskId: 'task-1', sequence: 1, contextSnapshot: { draft: '摘要' }, nextStep: '继续完善', createdAt: 4 }
      }
      if (command === 'secretary_ledger_load_latest_checkpoint') return null
      return task
    })
    setSecretaryLedgerInvokerForTests(invoke)

    await createSecretaryLedgerTask(access, { projectId: 'project-1', title: '整理调研摘要', request: '将材料整理为摘要。' })
    await recordSecretaryLedgerEvent(access, 'task-1', { eventType: 'plan', payload: { step: 'outline' } })
    await saveSecretaryLedgerCheckpoint(access, 'task-1', { contextSnapshot: { draft: '摘要' }, nextStep: '继续完善' })
    await loadLatestSecretaryLedgerCheckpoint(access, 'task-1')

    expect(invoke).toHaveBeenNthCalledWith(1, 'secretary_ledger_create_task', {
      access,
      input: { projectId: 'project-1', title: '整理调研摘要', request: '将材料整理为摘要。' },
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'secretary_ledger_record_event', {
      access,
      taskId: 'task-1',
      input: { eventType: 'plan', payload: { step: 'outline' } },
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'secretary_ledger_save_checkpoint', {
      access,
      taskId: 'task-1',
      input: { contextSnapshot: { draft: '摘要' }, nextStep: '继续完善' },
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'secretary_ledger_load_latest_checkpoint', { access, taskId: 'task-1' })
  })

  it('maps a one-time legacy batch without creating browser storage', async () => {
    const invoke = vi.fn(async () => ({ imported: true, projectsImported: 1, memoriesImported: 0, tasksImported: 0 }))
    setSecretaryLedgerInvokerForTests(invoke)
    const batch = { migrationKey: 'legacy-v1', projects: [{ id: 'old-project', title: '旧文稿', kind: 'writing' }], memories: [], tasks: [] }

    await expect(importSecretaryLedgerLegacyBatch(batch)).resolves.toMatchObject({ ok: true })
    expect(invoke).toHaveBeenCalledWith('secretary_ledger_import_legacy_batch', { batch })
  })

  it('returns a typed unavailable result without invoking a browser bridge shim', async () => {
    setTauriRuntime(undefined)
    const invoke = vi.fn(async () => ({ status: 'ok', schemaVersion: 5, ftsAvailable: true, bytes: 128 }))
    setSecretaryLedgerInvokerForTests(invoke)

    await expect(bootstrapSecretaryLedger()).resolves.toEqual({
      ok: false,
      code: 'runtime_unavailable',
      message: '秘书账本仅在桌面应用中可用。',
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects malformed native data without exposing it', async () => {
    const rawPayload = { status: 'ok', schemaVersion: 'five', ftsAvailable: true, bytes: 128, diagnostic: '/private/secret.sqlite' }
    setSecretaryLedgerInvokerForTests(vi.fn(async () => rawPayload))

    const result = await bootstrapSecretaryLedger()

    expect(result).toEqual({
      ok: false,
      code: 'invalid_payload',
      message: '秘书账本返回异常，无法确认操作结果。',
    })
    expect(result.message).not.toContain('/private/secret.sqlite')
  })

  it('rejects an oversized native checkpoint snapshot before exposing it', async () => {
    setSecretaryLedgerInvokerForTests(vi.fn(async () => ({
      taskId: 'task-1',
      sequence: 1,
      contextSnapshot: { entries: Array.from({ length: 100 }, () => 'x'.repeat(16_000)) },
      nextStep: '继续完善',
      createdAt: 4,
    })))

    await expect(saveSecretaryLedgerCheckpoint(access, 'task-1', {
      contextSnapshot: { draft: '摘要' },
      nextStep: '继续完善',
    })).resolves.toEqual({
      ok: false,
      code: 'invalid_payload',
      message: '秘书账本返回异常，无法确认操作结果。',
    })
  })

  it('rejects unbounded numbers in native checkpoint JSON', async () => {
    setSecretaryLedgerInvokerForTests(vi.fn(async () => ({
      taskId: 'task-1',
      sequence: 1,
      contextSnapshot: { unsafeNumber: 1e300 },
      nextStep: '继续完善',
      createdAt: 4,
    })))

    await expect(saveSecretaryLedgerCheckpoint(access, 'task-1', {
      contextSnapshot: { draft: '摘要' },
      nextStep: '继续完善',
    })).resolves.toMatchObject({ ok: false, code: 'invalid_payload' })
  })

  it('maps native errors to an owned message without forwarding native text', async () => {
    const rawMessage = 'Error: C:\\Users\\Administrator\\AppData\\secretary.sqlite is locked; token=abc123'
    setSecretaryLedgerInvokerForTests(async () => { throw new Error(rawMessage) })

    const result = await getSecretaryLedgerHealth()

    expect(result).toEqual({
      ok: false,
      code: 'native_unavailable',
      message: '秘书账本暂不可用，请稍后重试。',
    })
    expect(result.message).not.toContain(rawMessage)
  })
})
