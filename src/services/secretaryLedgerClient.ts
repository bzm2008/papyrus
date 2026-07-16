import { invoke } from '@tauri-apps/api/core'

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_RESULTS = 100
const MAX_IDENTIFIER_CHARS = 128
const MAX_PROJECT_TITLE_CHARS = 240
const MAX_KIND_CHARS = 64
const MAX_MEMORY_CONTENT_CHARS = 16_000
const MAX_SOURCE_CHARS = 96
const MAX_STATUS_CHARS = 32
const MAX_NEXT_STEP_CHARS = 4_000
const MAX_SEARCH_CONTENT_CHARS = 24_000
const MAX_TASK_SEARCH_CONTENT_CHARS = 16_000 + 4_000 + 16_000 + 4_000 + 3
const MAX_FTS_RECORD_ID_CHARS = MAX_IDENTIFIER_CHARS + 32
const MAX_LEGACY_IMPORT_RECORDS = 100
const MAX_SCHEMA_VERSION = 100_000
const MAX_JSON_DEPTH = 12
const MAX_JSON_KEYS = 100
const MAX_JSON_NODES = 1_000

export type SecretaryLedgerInvoker = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export type SecretaryLedgerFailureCode =
  | 'runtime_unavailable'
  | 'native_unavailable'
  | 'invalid_payload'
  | 'invalid_input'

export type SecretaryLedgerSuccess<T> = {
  ok: true
  value: T
  code?: never
  message?: never
}

export type SecretaryLedgerFailure = {
  ok: false
  code: SecretaryLedgerFailureCode
  message: string
  value?: never
}

export type SecretaryLedgerResult<T> = SecretaryLedgerSuccess<T> | SecretaryLedgerFailure

export type SecretaryLedgerRuntime =
  | { available: true; kind: 'tauri' }
  | { available: false; kind: 'browser'; message: '秘书账本仅在桌面应用中可用。' }

export type SecretaryLedgerHealth = {
  status: 'ok'
  schemaVersion: number
  ftsAvailable: boolean
  bytes: number
}

export type SecretaryLedgerProject = {
  id: string
  title: string
  kind: string
  storyProjectId: string | null
  chatId: string | null
  createdAt: number
  updatedAt: number
  archived: boolean
}

export type CreateSecretaryLedgerProjectInput = {
  id?: string
  title: string
  kind: string
  storyProjectId?: string | null
  chatId?: string | null
}

export type SecretaryLedgerProjectAccess = {
  currentProjectId: string
  includeCrossProject?: boolean
}

export type SecretaryLedgerMemoryScope = 'personal' | 'project'

export type SecretaryLedgerMemory = {
  id: string
  scope: SecretaryLedgerMemoryScope
  projectId: string | null
  kind: string
  content: string
  source: string
  confidence: number
  status: string
  revision: number
  createdAt: number
  updatedAt: number
}

export type CreateSecretaryLedgerMemoryInput = {
  id?: string
  scope: SecretaryLedgerMemoryScope
  projectId?: string | null
  kind: string
  content: string
  source: string
  confidence: number
  status: string
}

export type UpdateSecretaryLedgerMemoryInput = {
  kind?: string
  content?: string
  source?: string
  confidence?: number
  status?: string
}

export type SecretaryLedgerSearchEntityType = 'memory' | 'task' | 'event' | 'checkpoint'

export type SecretaryLedgerSearchResult = {
  id: string
  entityType: SecretaryLedgerSearchEntityType
  projectId: string | null
  projectTitle: string | null
  title: string
  content: string
}

export type SecretaryLedgerSearchInput = {
  query: string
  currentProjectId: string
  includeCrossProject?: boolean
  limit?: number
}

export type SecretaryLedgerTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type SecretaryLedgerTask = {
  id: string
  projectId: string
  title: string
  request: string
  status: SecretaryLedgerTaskStatus
  priority: number
  scheduleAt: number | null
  nextStep: string | null
  publicPlan: string | null
  summary: string | null
  createdAt: number
  updatedAt: number
}

export type CreateSecretaryLedgerTaskInput = {
  id?: string
  projectId: string
  title: string
  request: string
  status?: SecretaryLedgerTaskStatus
  priority?: number
  scheduleAt?: number | null
  nextStep?: string | null
  publicPlan?: string | null
  summary?: string | null
}

export type UpdateSecretaryLedgerTaskInput = {
  title?: string
  request?: string
  status?: SecretaryLedgerTaskStatus
  priority?: number
  scheduleAt?: number | null
  nextStep?: string | null
  publicPlan?: string | null
  summary?: string | null
}

export type SecretaryLedgerJson =
  | null
  | boolean
  | number
  | string
  | SecretaryLedgerJson[]
  | { [key: string]: SecretaryLedgerJson }

export type SecretaryLedgerTaskEvent = {
  taskId: string
  sequence: number
  eventType: string
  payload: SecretaryLedgerJson
  createdAt: number
}

export type RecordSecretaryLedgerEventInput = {
  eventType: string
  payload: SecretaryLedgerJson
}

export type SecretaryLedgerCheckpoint = {
  taskId: string
  sequence: number
  contextSnapshot: SecretaryLedgerJson
  nextStep: string
  createdAt: number
}

export type SaveSecretaryLedgerCheckpointInput = {
  contextSnapshot: SecretaryLedgerJson
  nextStep: string
}

export type PersistSecretaryLedgerTaskProgressInput = {
  task: UpdateSecretaryLedgerTaskInput
  events: RecordSecretaryLedgerEventInput[]
  checkpoint: SaveSecretaryLedgerCheckpointInput
}

export type StartSecretaryLedgerTaskInput = {
  task: CreateSecretaryLedgerTaskInput
  events: RecordSecretaryLedgerEventInput[]
  checkpoint: SaveSecretaryLedgerCheckpointInput
}

export type SecretaryLedgerTaskProgress = {
  task: SecretaryLedgerTask
  events: SecretaryLedgerTaskEvent[]
  checkpoint: SecretaryLedgerCheckpoint
}

export type SecretaryLedgerLegacyProjectInput = {
  id: string
  title: string
  kind: string
  storyProjectId?: string | null
  chatId?: string | null
}

export type SecretaryLedgerLegacyMemoryInput = CreateSecretaryLedgerMemoryInput

export type SecretaryLedgerLegacyTaskInput = Omit<CreateSecretaryLedgerTaskInput, 'projectId'> & {
  projectId?: string | null
}

export type SecretaryLedgerLegacyImportBatch = {
  migrationKey: string
  projects: SecretaryLedgerLegacyProjectInput[]
  memories: SecretaryLedgerLegacyMemoryInput[]
  tasks: SecretaryLedgerLegacyTaskInput[]
}

export type SecretaryLedgerLegacyImportResult = {
  imported: boolean
  projectsImported: number
  memoriesImported: number
  tasksImported: number
}

type SecretaryLedgerCommand =
  | 'secretary_ledger_bootstrap'
  | 'secretary_ledger_health'
  | 'secretary_ledger_create_project'
  | 'secretary_ledger_list_projects'
  | 'secretary_ledger_create_memory'
  | 'secretary_ledger_get_memory'
  | 'secretary_ledger_list_memories'
  | 'secretary_ledger_update_memory'
  | 'secretary_ledger_rollback_memory'
  | 'secretary_ledger_delete_memory'
  | 'secretary_ledger_search'
  | 'secretary_ledger_create_task'
  | 'secretary_ledger_start_task'
  | 'secretary_ledger_claim_task'
  | 'secretary_ledger_persist_task_progress'
  | 'secretary_ledger_get_task'
  | 'secretary_ledger_list_tasks'
  | 'secretary_ledger_update_task'
  | 'secretary_ledger_delete_task'
  | 'secretary_ledger_record_event'
  | 'secretary_ledger_list_events'
  | 'secretary_ledger_save_checkpoint'
  | 'secretary_ledger_load_latest_checkpoint'
  | 'secretary_ledger_import_legacy_batch'

const invalidPayload = Symbol('invalidPayload')

let invokeFn: SecretaryLedgerInvoker = (command, args) => invoke(command, args)

export function setSecretaryLedgerInvokerForTests(next: SecretaryLedgerInvoker) {
  invokeFn = next
}

export function resetSecretaryLedgerInvokerForTests() {
  invokeFn = (command, args) => invoke(command, args)
}

export function getSecretaryLedgerRuntime(): SecretaryLedgerRuntime {
  if (
    typeof window !== 'undefined' &&
    Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  ) {
    return { available: true, kind: 'tauri' }
  }

  return {
    available: false,
    kind: 'browser',
    message: '秘书账本仅在桌面应用中可用。',
  }
}

export function isSecretaryLedgerRuntimeAvailable() {
  return getSecretaryLedgerRuntime().available
}

export function bootstrapSecretaryLedger() {
  return callLedger('secretary_ledger_bootstrap', undefined, parseHealth)
}

export function getSecretaryLedgerHealth() {
  return callLedger('secretary_ledger_health', undefined, parseHealth)
}

export function createSecretaryLedgerProject(input: CreateSecretaryLedgerProjectInput) {
  return callLedger('secretary_ledger_create_project', { input }, parseProject)
}

export function listSecretaryLedgerProjects(options: { includeArchived?: boolean; limit?: number } = {}) {
  if (!isRecord(options)) return invalidInputResult<SecretaryLedgerProject[]>()
  const limit = resolveLimit(options.limit)
  if (limit === null || (options.includeArchived !== undefined && typeof options.includeArchived !== 'boolean')) {
    return invalidInputResult<SecretaryLedgerProject[]>()
  }

  return callLedger('secretary_ledger_list_projects', {
    includeArchived: options.includeArchived === true,
    limit,
  }, parseProjectList)
}

export function createSecretaryLedgerMemory(
  access: SecretaryLedgerProjectAccess,
  input: CreateSecretaryLedgerMemoryInput,
) {
  return callWithAccess('secretary_ledger_create_memory', access, { input }, parseMemory)
}

export function getSecretaryLedgerMemory(access: SecretaryLedgerProjectAccess, id: string) {
  return callWithAccess('secretary_ledger_get_memory', access, { id }, parseOptionalMemory)
}

export function listSecretaryLedgerMemories(access: SecretaryLedgerProjectAccess, requestedLimit?: number) {
  const limit = resolveLimit(requestedLimit)
  if (limit === null) return invalidInputResult<SecretaryLedgerMemory[]>()
  return callWithAccess('secretary_ledger_list_memories', access, { limit }, parseMemoryList)
}

export function updateSecretaryLedgerMemory(
  access: SecretaryLedgerProjectAccess,
  id: string,
  input: UpdateSecretaryLedgerMemoryInput,
) {
  return callWithAccess('secretary_ledger_update_memory', access, { id, input }, parseMemory)
}

export function rollbackSecretaryLedgerMemory(access: SecretaryLedgerProjectAccess, id: string, revision: number) {
  if (!isPositiveSafeInteger(revision)) return invalidInputResult<SecretaryLedgerMemory>()
  return callWithAccess('secretary_ledger_rollback_memory', access, { id, revision }, parseMemory)
}

export function deleteSecretaryLedgerMemory(access: SecretaryLedgerProjectAccess, id: string) {
  return callWithAccess('secretary_ledger_delete_memory', access, { id }, parseVoid)
}

export function searchSecretaryLedger(input: SecretaryLedgerSearchInput) {
  if (!isRecord(input)) return invalidInputResult<SecretaryLedgerSearchResult[]>()
  const limit = resolveLimit(input.limit)
  const access = normalizeProjectAccess({
    currentProjectId: input.currentProjectId,
    includeCrossProject: input.includeCrossProject,
  })
  if (limit === null || access === null || !isBoundedText(input.query, MAX_PROJECT_TITLE_CHARS)) {
    return invalidInputResult<SecretaryLedgerSearchResult[]>()
  }

  return callLedger('secretary_ledger_search', {
    input: {
      query: input.query,
      currentProjectId: access.currentProjectId,
      includeCrossProject: access.includeCrossProject,
      limit,
    },
  }, parseSearchResultList)
}

export function createSecretaryLedgerTask(access: SecretaryLedgerProjectAccess, input: CreateSecretaryLedgerTaskInput) {
  if (!hasSafeOptionalScheduleAt(input)) return invalidInputResult<SecretaryLedgerTask>()
  return callWithAccess('secretary_ledger_create_task', access, { input }, parseTask)
}

export function startSecretaryLedgerTask(
  access: SecretaryLedgerProjectAccess,
  input: StartSecretaryLedgerTaskInput,
) {
  const normalizedInput = normalizeStartTaskInput(input)
  if (normalizedInput === null) return invalidInputResult<SecretaryLedgerTaskProgress>()
  return callWithAccess('secretary_ledger_start_task', access, { input: normalizedInput }, parseTaskProgress)
}

export function claimSecretaryLedgerTask(
  access: SecretaryLedgerProjectAccess,
  id: string,
  input: PersistSecretaryLedgerTaskProgressInput,
) {
  const normalizedInput = normalizeTaskProgressInput(input)
  if (normalizedInput === null) return invalidInputResult<SecretaryLedgerTaskProgress | null>()
  return callWithAccess('secretary_ledger_claim_task', access, { id, input: normalizedInput }, parseOptionalTaskProgress)
}

export function persistSecretaryLedgerTaskProgress(
  access: SecretaryLedgerProjectAccess,
  id: string,
  input: PersistSecretaryLedgerTaskProgressInput,
) {
  const normalizedInput = normalizeTaskProgressInput(input)
  if (normalizedInput === null) return invalidInputResult<SecretaryLedgerTaskProgress>()
  return callWithAccess('secretary_ledger_persist_task_progress', access, { id, input: normalizedInput }, parseTaskProgress)
}

export function getSecretaryLedgerTask(access: SecretaryLedgerProjectAccess, id: string) {
  return callWithAccess('secretary_ledger_get_task', access, { id }, parseOptionalTask)
}

export function listSecretaryLedgerTasks(access: SecretaryLedgerProjectAccess, requestedLimit?: number) {
  const limit = resolveLimit(requestedLimit)
  if (limit === null) return invalidInputResult<SecretaryLedgerTask[]>()
  return callWithAccess('secretary_ledger_list_tasks', access, { limit }, parseTaskList)
}

export function updateSecretaryLedgerTask(
  access: SecretaryLedgerProjectAccess,
  id: string,
  input: UpdateSecretaryLedgerTaskInput,
) {
  if (!hasSafeOptionalScheduleAt(input)) return invalidInputResult<SecretaryLedgerTask>()
  return callWithAccess('secretary_ledger_update_task', access, { id, input }, parseTask)
}

export function deleteSecretaryLedgerTask(access: SecretaryLedgerProjectAccess, id: string) {
  return callWithAccess('secretary_ledger_delete_task', access, { id }, parseVoid)
}

export function recordSecretaryLedgerEvent(
  access: SecretaryLedgerProjectAccess,
  taskId: string,
  input: RecordSecretaryLedgerEventInput,
) {
  const normalizedInput = normalizeEventInput(input)
  if (normalizedInput === null) return invalidInputResult<SecretaryLedgerTaskEvent>()
  return callWithAccess('secretary_ledger_record_event', access, { taskId, input: normalizedInput }, parseTaskEvent)
}

export function listSecretaryLedgerEvents(
  access: SecretaryLedgerProjectAccess,
  taskId: string,
  requestedLimit?: number,
) {
  const limit = resolveLimit(requestedLimit)
  if (limit === null) return invalidInputResult<SecretaryLedgerTaskEvent[]>()
  return callWithAccess('secretary_ledger_list_events', access, { taskId, limit }, parseTaskEventList)
}

export function saveSecretaryLedgerCheckpoint(
  access: SecretaryLedgerProjectAccess,
  taskId: string,
  input: SaveSecretaryLedgerCheckpointInput,
) {
  const normalizedInput = normalizeCheckpointInput(input)
  if (normalizedInput === null) return invalidInputResult<SecretaryLedgerCheckpoint>()
  return callWithAccess('secretary_ledger_save_checkpoint', access, { taskId, input: normalizedInput }, parseCheckpoint)
}

export function loadLatestSecretaryLedgerCheckpoint(access: SecretaryLedgerProjectAccess, taskId: string) {
  return callWithAccess('secretary_ledger_load_latest_checkpoint', access, { taskId }, parseOptionalCheckpoint)
}

export function importSecretaryLedgerLegacyBatch(batch: SecretaryLedgerLegacyImportBatch) {
  if (!isLegacyBatchBounded(batch)) return invalidInputResult<SecretaryLedgerLegacyImportResult>()
  return callLedger('secretary_ledger_import_legacy_batch', { batch }, parseLegacyImportResult)
}

async function callWithAccess<T>(
  command: SecretaryLedgerCommand,
  rawAccess: SecretaryLedgerProjectAccess,
  args: Record<string, unknown>,
  parser: (payload: unknown) => T | typeof invalidPayload,
): Promise<SecretaryLedgerResult<T>> {
  const access = normalizeProjectAccess(rawAccess)
  if (access === null) return invalidInputResult<T>()
  return callLedger(command, { access, ...args }, parser)
}

async function callLedger<T>(
  command: SecretaryLedgerCommand,
  args: Record<string, unknown> | undefined,
  parser: (payload: unknown) => T | typeof invalidPayload,
): Promise<SecretaryLedgerResult<T>> {
  if (!getSecretaryLedgerRuntime().available) {
    return runtimeUnavailableResult()
  }

  try {
    const payload = await invokeFn(command, args)
    const value = parser(payload)
    if (value === invalidPayload) return invalidPayloadResult()
    return { ok: true, value }
  } catch {
    return nativeUnavailableResult()
  }
}

function normalizeProjectAccess(access: SecretaryLedgerProjectAccess) {
  if (!isRecord(access) || !isIdentifier(access.currentProjectId)) return null
  if (access.includeCrossProject !== undefined && typeof access.includeCrossProject !== 'boolean') return null
  return {
    currentProjectId: access.currentProjectId,
    includeCrossProject: access.includeCrossProject === true,
  }
}

function resolveLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_LIST_LIMIT
  return isSafeIntegerInRange(value, 1, MAX_LIST_RESULTS) ? value : null
}

function hasSafeOptionalScheduleAt(input: unknown) {
  if (!isRecord(input)) return false
  if (!Object.prototype.hasOwnProperty.call(input, 'scheduleAt')) return true
  const value = input.scheduleAt
  return value === null || isSafeIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER)
}

function normalizeStartTaskInput(input: unknown): StartSecretaryLedgerTaskInput | null {
  if (!isRecord(input) || !isRecord(input.task) || !hasSafeOptionalScheduleAt(input.task)) return null
  const events = normalizeTaskProgressEvents(input.events)
  const checkpoint = normalizeCheckpointInput(input.checkpoint)
  if (events === null || checkpoint === null) return null
  return {
    task: input.task as CreateSecretaryLedgerTaskInput,
    events,
    checkpoint,
  }
}

function normalizeTaskProgressInput(input: unknown): PersistSecretaryLedgerTaskProgressInput | null {
  if (!isRecord(input) || !isRecord(input.task) || !hasSafeOptionalScheduleAt(input.task)) return null
  const events = normalizeTaskProgressEvents(input.events)
  const checkpoint = normalizeCheckpointInput(input.checkpoint)
  if (events === null || checkpoint === null) return null
  return {
    task: input.task as UpdateSecretaryLedgerTaskInput,
    events,
    checkpoint,
  }
}

function normalizeTaskProgressEvents(input: unknown): RecordSecretaryLedgerEventInput[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 8) return null
  const events = input.map(normalizeEventInput)
  if (events.some((event) => event === null)) return null
  return events as RecordSecretaryLedgerEventInput[]
}

function normalizeEventInput(input: unknown): RecordSecretaryLedgerEventInput | null {
  if (!isRecord(input) || typeof input.eventType !== 'string') return null
  const payload = normalizeJsonInput(input.payload)
  return payload === null ? null : { eventType: input.eventType, payload }
}

function normalizeCheckpointInput(input: unknown): SaveSecretaryLedgerCheckpointInput | null {
  if (!isRecord(input) || typeof input.nextStep !== 'string') return null
  const contextSnapshot = normalizeJsonInput(input.contextSnapshot)
  return contextSnapshot === null ? null : { contextSnapshot, nextStep: input.nextStep }
}

function normalizeJsonInput(value: unknown): SecretaryLedgerJson | null {
  const parsed = parseJson(value)
  if (parsed === invalidPayload) return null

  try {
    return Array.from(JSON.stringify(parsed)).length <= MAX_MEMORY_CONTENT_CHARS ? parsed : null
  } catch {
    return null
  }
}

function isLegacyBatchBounded(batch: SecretaryLedgerLegacyImportBatch) {
  if (!isRecord(batch) || !isBoundedText(batch.migrationKey, MAX_IDENTIFIER_CHARS)) return false
  if (!Array.isArray(batch.projects) || !Array.isArray(batch.memories) || !Array.isArray(batch.tasks)) return false
  const total = batch.projects.length + batch.memories.length + batch.tasks.length
  return (
    batch.projects.length <= MAX_LIST_RESULTS &&
    batch.memories.length <= MAX_LIST_RESULTS &&
    batch.tasks.length <= MAX_LIST_RESULTS &&
    total <= MAX_LIST_RESULTS
  )
}

function parseHealth(payload: unknown): SecretaryLedgerHealth | typeof invalidPayload {
  if (!isRecord(payload) || payload.status !== 'ok') return invalidPayload
  const schemaVersion = readSafeInteger(payload, 'schemaVersion', 1, MAX_SCHEMA_VERSION)
  const bytes = readSafeInteger(payload, 'bytes', 0, Number.MAX_SAFE_INTEGER)
  if (schemaVersion === invalidPayload || bytes === invalidPayload || typeof payload.ftsAvailable !== 'boolean') {
    return invalidPayload
  }
  return { status: 'ok', schemaVersion, ftsAvailable: payload.ftsAvailable, bytes }
}

function parseProject(payload: unknown): SecretaryLedgerProject | typeof invalidPayload {
  if (!isRecord(payload)) return invalidPayload
  const id = readIdentifier(payload, 'id')
  const title = readText(payload, 'title', MAX_PROJECT_TITLE_CHARS)
  const kind = readText(payload, 'kind', MAX_KIND_CHARS)
  const storyProjectId = readNullableIdentifier(payload, 'storyProjectId')
  const chatId = readNullableIdentifier(payload, 'chatId')
  const createdAt = readTimestamp(payload, 'createdAt')
  const updatedAt = readTimestamp(payload, 'updatedAt')
  if (
    id === invalidPayload ||
    title === invalidPayload ||
    kind === invalidPayload ||
    storyProjectId === invalidPayload ||
    chatId === invalidPayload ||
    createdAt === invalidPayload ||
    updatedAt === invalidPayload ||
    typeof payload.archived !== 'boolean'
  ) {
    return invalidPayload
  }
  return { id, title, kind, storyProjectId, chatId, createdAt, updatedAt, archived: payload.archived }
}

function parseProjectList(payload: unknown) {
  return parseBoundedArray(payload, parseProject)
}

function parseMemory(payload: unknown): SecretaryLedgerMemory | typeof invalidPayload {
  if (!isRecord(payload)) return invalidPayload
  const id = readIdentifier(payload, 'id')
  const scope = readEnum(payload, 'scope', ['personal', 'project'] as const)
  const projectId = readNullableIdentifier(payload, 'projectId')
  const kind = readText(payload, 'kind', MAX_KIND_CHARS)
  const content = readText(payload, 'content', MAX_MEMORY_CONTENT_CHARS)
  const source = readText(payload, 'source', MAX_SOURCE_CHARS)
  const confidence = readFiniteNumber(payload, 'confidence', 0, 1)
  const status = readText(payload, 'status', MAX_STATUS_CHARS)
  const revision = readSafeInteger(payload, 'revision', 1, Number.MAX_SAFE_INTEGER)
  const createdAt = readTimestamp(payload, 'createdAt')
  const updatedAt = readTimestamp(payload, 'updatedAt')
  if (
    id === invalidPayload ||
    scope === invalidPayload ||
    projectId === invalidPayload ||
    kind === invalidPayload ||
    content === invalidPayload ||
    source === invalidPayload ||
    confidence === invalidPayload ||
    status === invalidPayload ||
    revision === invalidPayload ||
    createdAt === invalidPayload ||
    updatedAt === invalidPayload ||
    (scope === 'personal' && projectId !== null) ||
    (scope === 'project' && projectId === null)
  ) {
    return invalidPayload
  }
  return { id, scope, projectId, kind, content, source, confidence, status, revision, createdAt, updatedAt }
}

function parseOptionalMemory(payload: unknown) {
  return payload === null ? null : parseMemory(payload)
}

function parseMemoryList(payload: unknown) {
  return parseBoundedArray(payload, parseMemory)
}

function parseSearchResult(payload: unknown): SecretaryLedgerSearchResult | typeof invalidPayload {
  if (!isRecord(payload)) return invalidPayload
  const entityType = readEnum(payload, 'entityType', ['memory', 'task', 'event', 'checkpoint'] as const)
  const id = entityType === 'event' || entityType === 'checkpoint'
    ? readFtsRecordId(payload, 'id', entityType)
    : readIdentifier(payload, 'id')
  const projectId = readNullableIdentifier(payload, 'projectId')
  const projectTitle = readNullableText(payload, 'projectTitle', MAX_PROJECT_TITLE_CHARS)
  const title = readText(payload, 'title', MAX_PROJECT_TITLE_CHARS)
  const content = readText(
    payload,
    'content',
    entityType === 'task' ? MAX_TASK_SEARCH_CONTENT_CHARS : MAX_SEARCH_CONTENT_CHARS,
  )
  if (
    id === invalidPayload ||
    entityType === invalidPayload ||
    projectId === invalidPayload ||
    projectTitle === invalidPayload ||
    title === invalidPayload ||
    content === invalidPayload
  ) {
    return invalidPayload
  }
  return { id, entityType, projectId, projectTitle, title, content }
}

function parseSearchResultList(payload: unknown) {
  return parseBoundedArray(payload, parseSearchResult)
}

function parseTask(payload: unknown): SecretaryLedgerTask | typeof invalidPayload {
  if (!isRecord(payload)) return invalidPayload
  const id = readIdentifier(payload, 'id')
  const projectId = readIdentifier(payload, 'projectId')
  const title = readText(payload, 'title', MAX_PROJECT_TITLE_CHARS)
  const request = readText(payload, 'request', MAX_MEMORY_CONTENT_CHARS)
  const status = readEnum(payload, 'status', [
    'queued',
    'running',
    'awaiting_approval',
    'paused',
    'completed',
    'failed',
    'cancelled',
  ] as const)
  const priority = readSafeInteger(payload, 'priority', 1, 5)
  const scheduleAt = readNullableTimestamp(payload, 'scheduleAt')
  const nextStep = readNullableText(payload, 'nextStep', MAX_NEXT_STEP_CHARS)
  const publicPlan = readNullableText(payload, 'publicPlan', MAX_MEMORY_CONTENT_CHARS)
  const summary = readNullableText(payload, 'summary', MAX_NEXT_STEP_CHARS)
  const createdAt = readTimestamp(payload, 'createdAt')
  const updatedAt = readTimestamp(payload, 'updatedAt')
  if (
    id === invalidPayload ||
    projectId === invalidPayload ||
    title === invalidPayload ||
    request === invalidPayload ||
    status === invalidPayload ||
    priority === invalidPayload ||
    scheduleAt === invalidPayload ||
    nextStep === invalidPayload ||
    publicPlan === invalidPayload ||
    summary === invalidPayload ||
    createdAt === invalidPayload ||
    updatedAt === invalidPayload
  ) {
    return invalidPayload
  }
  return {
    id,
    projectId,
    title,
    request,
    status,
    priority,
    scheduleAt,
    nextStep,
    publicPlan,
    summary,
    createdAt,
    updatedAt,
  }
}

function parseOptionalTask(payload: unknown) {
  return payload === null ? null : parseTask(payload)
}

function parseTaskList(payload: unknown) {
  return parseBoundedArray(payload, parseTask)
}

function parseTaskEvent(payload: unknown): SecretaryLedgerTaskEvent | typeof invalidPayload {
  if (!isRecord(payload)) return invalidPayload
  const taskId = readIdentifier(payload, 'taskId')
  const sequence = readSafeInteger(payload, 'sequence', 1, Number.MAX_SAFE_INTEGER)
  const eventType = readText(payload, 'eventType', MAX_KIND_CHARS)
  const eventPayload = parseJson(payload.payload)
  const createdAt = readTimestamp(payload, 'createdAt')
  if (
    taskId === invalidPayload ||
    sequence === invalidPayload ||
    eventType === invalidPayload ||
    eventPayload === invalidPayload ||
    createdAt === invalidPayload
  ) {
    return invalidPayload
  }
  return { taskId, sequence, eventType, payload: eventPayload, createdAt }
}

function parseTaskEventList(payload: unknown) {
  return parseBoundedArray(payload, parseTaskEvent)
}

function parseCheckpoint(payload: unknown): SecretaryLedgerCheckpoint | typeof invalidPayload {
  if (!isRecord(payload)) return invalidPayload
  const taskId = readIdentifier(payload, 'taskId')
  const sequence = readSafeInteger(payload, 'sequence', 1, Number.MAX_SAFE_INTEGER)
  const contextSnapshot = parseJson(payload.contextSnapshot)
  const nextStep = readText(payload, 'nextStep', MAX_NEXT_STEP_CHARS)
  const createdAt = readTimestamp(payload, 'createdAt')
  if (
    taskId === invalidPayload ||
    sequence === invalidPayload ||
    contextSnapshot === invalidPayload ||
    nextStep === invalidPayload ||
    createdAt === invalidPayload
  ) {
    return invalidPayload
  }
  return { taskId, sequence, contextSnapshot, nextStep, createdAt }
}

function parseOptionalCheckpoint(payload: unknown) {
  return payload === null ? null : parseCheckpoint(payload)
}

function parseTaskProgress(payload: unknown): SecretaryLedgerTaskProgress | typeof invalidPayload {
  if (!isRecord(payload) || !Array.isArray(payload.events) || payload.events.length === 0 || payload.events.length > 8) {
    return invalidPayload
  }
  const task = parseTask(payload.task)
  const events = payload.events.map(parseTaskEvent)
  const checkpoint = parseCheckpoint(payload.checkpoint)
  if (
    task === invalidPayload ||
    events.some((event) => event === invalidPayload) ||
    checkpoint === invalidPayload
  ) {
    return invalidPayload
  }
  const parsedEvents = events as SecretaryLedgerTaskEvent[]
  if (parsedEvents.some((event) => event.taskId !== task.id) || checkpoint.taskId !== task.id) {
    return invalidPayload
  }
  return { task, events: parsedEvents, checkpoint }
}

function parseOptionalTaskProgress(payload: unknown) {
  return payload === null ? null : parseTaskProgress(payload)
}

function parseLegacyImportResult(payload: unknown): SecretaryLedgerLegacyImportResult | typeof invalidPayload {
  if (!isRecord(payload) || typeof payload.imported !== 'boolean') return invalidPayload
  const projectsImported = readSafeInteger(payload, 'projectsImported', 0, MAX_LEGACY_IMPORT_RECORDS)
  const memoriesImported = readSafeInteger(payload, 'memoriesImported', 0, MAX_LEGACY_IMPORT_RECORDS)
  const tasksImported = readSafeInteger(payload, 'tasksImported', 0, MAX_LEGACY_IMPORT_RECORDS)
  if (
    projectsImported === invalidPayload ||
    memoriesImported === invalidPayload ||
    tasksImported === invalidPayload
  ) {
    return invalidPayload
  }
  return { imported: payload.imported, projectsImported, memoriesImported, tasksImported }
}

function parseVoid(payload: unknown) {
  return payload === null || payload === undefined ? undefined : invalidPayload
}

function parseBoundedArray<T>(
  payload: unknown,
  parser: (value: unknown) => T | typeof invalidPayload,
): T[] | typeof invalidPayload {
  if (!Array.isArray(payload) || payload.length > MAX_LIST_RESULTS) return invalidPayload
  const values: T[] = []
  for (const item of payload) {
    const value = parser(item)
    if (value === invalidPayload) return invalidPayload
    values.push(value)
  }
  return values
}

function parseJson(
  value: unknown,
  depth = 0,
  budget: { remainingChars: number; remainingNodes: number } = {
    remainingChars: MAX_MEMORY_CONTENT_CHARS,
    remainingNodes: MAX_JSON_NODES,
  },
): SecretaryLedgerJson | typeof invalidPayload {
  if (depth > MAX_JSON_DEPTH || budget.remainingNodes-- <= 0) return invalidPayload
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : invalidPayload
  }
  if (typeof value === 'string') {
    const length = Array.from(value).length
    if (length > budget.remainingChars) return invalidPayload
    budget.remainingChars -= length
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_LIST_RESULTS) return invalidPayload
    const items: SecretaryLedgerJson[] = []
    for (const item of value) {
      const parsed = parseJson(item, depth + 1, budget)
      if (parsed === invalidPayload) return invalidPayload
      items.push(parsed)
    }
    return items
  }
  if (!isRecord(value) || Object.keys(value).length > MAX_JSON_KEYS) return invalidPayload
  const output = Object.create(null) as Record<string, SecretaryLedgerJson>
  for (const [key, item] of Object.entries(value)) {
    const keyLength = Array.from(key).length
    if (
      keyLength > MAX_IDENTIFIER_CHARS ||
      keyLength > budget.remainingChars ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    ) {
      return invalidPayload
    }
    budget.remainingChars -= keyLength
    const parsed = parseJson(item, depth + 1, budget)
    if (parsed === invalidPayload) return invalidPayload
    output[key] = parsed
  }
  return output
}

function readIdentifier(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return isIdentifier(value) ? value : invalidPayload
}

function readFtsRecordId(
  record: Record<string, unknown>,
  key: string,
  entityType: 'event' | 'checkpoint',
) {
  const value = record[key]
  const pattern = new RegExp(`^${entityType}:[A-Za-z0-9._-]{1,${MAX_IDENTIFIER_CHARS}}:[1-9]\\d{0,18}$`)
  return typeof value === 'string' && value.length <= MAX_FTS_RECORD_ID_CHARS && pattern.test(value)
    ? value
    : invalidPayload
}

function readNullableIdentifier(record: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return invalidPayload
  const value = record[key]
  return value === null ? null : isIdentifier(value) ? value : invalidPayload
}

function readText(record: Record<string, unknown>, key: string, maximumChars: number) {
  const value = record[key]
  return isBoundedText(value, maximumChars) ? value : invalidPayload
}

function readNullableText(record: Record<string, unknown>, key: string, maximumChars: number) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return invalidPayload
  const value = record[key]
  return value === null ? null : isBoundedText(value, maximumChars) ? value : invalidPayload
}

function readFiniteNumber(record: Record<string, unknown>, key: string, minimum: number, maximum: number) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : invalidPayload
}

function readSafeInteger(record: Record<string, unknown>, key: string, minimum: number, maximum: number) {
  const value = record[key]
  return isSafeIntegerInRange(value, minimum, maximum) ? value : invalidPayload
}

function readTimestamp(record: Record<string, unknown>, key: string) {
  return readSafeInteger(record, key, 0, Number.MAX_SAFE_INTEGER)
}

function readNullableTimestamp(record: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return invalidPayload
  const value = record[key]
  return value === null ? null : isSafeIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER) ? value : invalidPayload
}

function readEnum<const T extends readonly string[]>(record: Record<string, unknown>, key: string, values: T) {
  const value = record[key]
  return typeof value === 'string' && values.includes(value) ? value as T[number] : invalidPayload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_CHARS &&
    /^[A-Za-z0-9._-]+$/.test(value)
  )
}

function isBoundedText(value: unknown, maximumChars: number, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.trim().length > 0) &&
    Array.from(value).length <= maximumChars
  )
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isSafeIntegerInRange(value, 1, Number.MAX_SAFE_INTEGER)
}

function runtimeUnavailableResult(): SecretaryLedgerFailure {
  return {
    ok: false,
    code: 'runtime_unavailable',
    message: '秘书账本仅在桌面应用中可用。',
  }
}

function nativeUnavailableResult(): SecretaryLedgerFailure {
  return {
    ok: false,
    code: 'native_unavailable',
    message: '秘书账本暂不可用，请稍后重试。',
  }
}

function invalidPayloadResult(): SecretaryLedgerFailure {
  return {
    ok: false,
    code: 'invalid_payload',
    message: '秘书账本返回异常，无法确认操作结果。',
  }
}

function invalidInputResult<T>(): Promise<SecretaryLedgerResult<T>> {
  return Promise.resolve({
    ok: false,
    code: 'invalid_input',
    message: '秘书账本请求无效，未执行操作。',
  })
}
