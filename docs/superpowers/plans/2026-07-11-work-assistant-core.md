# Papyrus Work Assistant Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cross-platform controlled capability runtime, file workflow, approval system, streaming event timeline, and secretary-mode integration for Windows, macOS, and Linux.

**Architecture:** Keep the existing writing orchestrator intact and add a separate work-assistant loop that can inspect a workspace, request validated tools, pause for native approval, and return structured results. Rust is the security boundary: it owns authorized roots, previews, approval tokens, path validation, file mutations, app aliases, audit records, and platform adapters; React owns planning, event ordering, approval UI, and previews.

**Tech Stack:** Tauri 2, Rust 2021, React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library, `trash`, `sysinfo`, `sha2`, `uuid`, `dunce`, `open`.

## Implementation Audit (2026-07-15)

`[x]` marks implementation, test, or locally completed commit steps. The consolidated local
commit is `d73b0d0` (`fix: harden entitlement sync and assistant cancellation`), following the earlier
desktop/runtime implementation commits. The current local evidence is 36 desktop unit-test
files/194 tests and 135 Rust tests through the portable MSVC gate. File run-scoped approvals now
use a canonical scope containing tool, root, target-parent digest, conflict policy, operation kind,
and an item-count bound; browser and workspace cancellation invalidate matching state and late
tool calls. A real-user-file smoke transaction and cross-platform device evidence remain pending
in the release report.

---

## Execution Prerequisite

Create a dedicated implementation worktree before Task 1:

```powershell
git worktree add '..\papyrus-work-assistant-core' -b 'feat/work-assistant-core'
Set-Location '..\papyrus-work-assistant-core'
```

Expected: the new worktree starts from commit `eb2c91c` or a later commit containing the approved design and plans.

### Task 1: Add the desktop unit-test harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/smoke.test.ts`

- [x] **Step 1: Add a passing smoke test**

```ts
// src/test/smoke.test.ts
import { describe, expect, it } from 'vitest'

describe('desktop test harness', () => {
  it('runs TypeScript tests in jsdom', () => {
    expect(document.createElement('div')).toBeInstanceOf(HTMLDivElement)
  })
})
```

- [x] **Step 2: Install the test dependencies and scripts**

Run:

```powershell
npm install --save-dev @testing-library/jest-dom @testing-library/react @testing-library/user-event jsdom
```

Add to `package.json`:

```json
"test:unit": "vitest run --config vitest.config.ts",
"test:unit:watch": "vitest --config vitest.config.ts"
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
```

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())
```

- [x] **Step 3: Run the smoke test**

Run: `npm run test:unit -- src/test/smoke.test.ts`

Expected: PASS.

- [x] **Step 4: Commit the harness only**

```powershell
git add package.json package-lock.json vitest.config.ts src/test/setup.ts src/test/smoke.test.ts
git commit -m "test: add desktop unit test harness"
```

### Task 2: Define the event protocol and reducer

**Files:**
- Create: `src/services/workAssistantProtocol.ts`
- Create: `src/services/workAssistantEventReducer.ts`
- Create: `src/services/workAssistantProtocol.test.ts`
- Create: `src/services/workAssistantEventReducer.test.ts`

- [x] **Step 1: Define stable public types**

Create `workAssistantProtocol.ts` with these exported types and constructor:

```ts
export type DesktopPlatform = 'windows' | 'macos' | 'linux'
export type AssistantRiskLevel = 'read' | 'reversible' | 'high' | 'blocked'
export type AssistantToolStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AssistantApprovalChoice = 'once' | 'run' | 'deny'

export type AssistantCapabilityStatus = {
  name: string
  toolset: 'workspace' | 'desktop' | 'browser' | 'project'
  available: boolean
  reason?: string
  platform: DesktopPlatform
}

export type NativePreviewRequest = {
  runId: string
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
}

export type AssistantToolCall = {
  id: string
  runId: string
  name: string
  intent: string
  arguments: Record<string, unknown>
  status: AssistantToolStatus
  startedAt: number
  endedAt?: number
  preview?: AssistantToolPreview
  progress?: { message: string; completed?: number; total?: number }
  result?: AssistantToolResult
}

export type AssistantToolPreview = {
  id: string
  revision: string
  risk: AssistantRiskLevel
  title: string
  targetSummary: string
  impactSummary: string
  reversible: boolean
  expiresAt: number
}

export type AssistantApprovalRequest = AssistantToolPreview & {
  runId: string
  toolCallId: string
  reason: string
  allowedChoices: AssistantApprovalChoice[]
}

export type AssistantToolResult = {
  ok: boolean
  summary: string
  data?: Record<string, unknown>
  errorCode?: string
  recoverable?: boolean
}

export type AssistantSubagent = {
  id: string
  parentId?: string
  goal: string
  model?: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  currentTool?: string
  progress: string[]
  startedAt: number
  endedAt?: number
  summary?: string
}

export type WorkAssistantRun = {
  id: string
  status: 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'
  messageText: string
  stage: string
  toolCalls: Record<string, AssistantToolCall>
  subagents: Record<string, AssistantSubagent>
  pendingApprovalId?: string
  lastActivityAt: number
  error?: string
}

export type WorkAssistantEvent =
  | { type: 'run.started'; runId: string; at: number }
  | { type: 'message.delta'; runId: string; messageId: string; delta: string; at: number }
  | { type: 'stage.changed'; runId: string; stage: string; detail?: string; at: number }
  | { type: 'tool.started'; runId: string; toolCall: AssistantToolCall; at: number }
  | { type: 'tool.progress'; runId: string; toolCallId: string; message: string; completed?: number; total?: number; at: number }
  | { type: 'approval.required'; runId: string; request: AssistantApprovalRequest; at: number }
  | { type: 'tool.completed'; runId: string; toolCallId: string; result: AssistantToolResult; at: number }
  | { type: 'subagent.started'; runId: string; subagent: AssistantSubagent; at: number }
  | { type: 'subagent.progress'; runId: string; subagentId: string; message: string; currentTool?: string; at: number }
  | { type: 'subagent.completed'; runId: string; subagentId: string; summary: string; failed?: boolean; at: number }
  | { type: 'run.completed'; runId: string; response: string; at: number }
  | { type: 'run.failed'; runId: string; code: string; message: string; recoverable: boolean; at: number }
  | { type: 'run.cancelled'; runId: string; at: number }

export function createEmptyWorkAssistantRun(id: string): WorkAssistantRun {
  return {
    id,
    status: 'idle',
    messageText: '',
    stage: '',
    toolCalls: {},
    subagents: {},
    lastActivityAt: Date.now(),
  }
}
```

- [x] **Step 2: Write reducer tests for ordering and terminal states**

Cover these cases in `workAssistantEventReducer.test.ts`:

```ts
const toolCall = (id: string): AssistantToolCall => ({
  id,
  runId: 'r1',
  name: 'workspace_scan',
  intent: '扫描工作区',
  arguments: { rootId: 'root-1' },
  status: 'running',
  startedAt: 3,
})

const runningRun = () => ({ ...createEmptyWorkAssistantRun('r1'), status: 'running' as const })

it('flushes text before inserting the next tool event', () => {
  const state = reduceWorkAssistantEvents(createEmptyWorkAssistantRun('r1'), [
    { type: 'run.started', runId: 'r1', at: 1 },
    { type: 'message.delta', runId: 'r1', messageId: 'm1', delta: '先搜索', at: 2 },
    { type: 'tool.started', runId: 'r1', toolCall: toolCall('t1'), at: 3 },
  ])
  expect(state.messageText).toBe('先搜索')
  expect(state.toolCalls.t1.status).toBe('running')
})

it('does not revive a cancelled run with late events', () => {
  const cancelled = reduceWorkAssistantEvent(runningRun(), { type: 'run.cancelled', runId: 'r1', at: 4 })
  const late = reduceWorkAssistantEvent(cancelled, {
    type: 'tool.completed',
    runId: 'r1',
    toolCallId: 't1',
    result: { ok: true, summary: 'late' },
    at: 5,
  })
  expect(late.status).toBe('cancelled')
  expect(late.toolCalls.t1.result).toBeUndefined()
})
```

- [x] **Step 3: Implement the reducer**

Create `workAssistantEventReducer.ts`. The reducer must:

```ts
export function reduceWorkAssistantEvent(
  state: WorkAssistantRun,
  event: WorkAssistantEvent,
): WorkAssistantRun {
  if (event.runId !== state.id || state.status === 'cancelled') return state

  switch (event.type) {
    case 'run.started':
      return { ...state, status: 'running', lastActivityAt: event.at }
    case 'message.delta':
      return { ...state, messageText: state.messageText + event.delta, lastActivityAt: event.at }
    case 'stage.changed':
      return { ...state, stage: event.stage, lastActivityAt: event.at }
    case 'tool.started':
      return {
        ...state,
        toolCalls: { ...state.toolCalls, [event.toolCall.id]: event.toolCall },
        lastActivityAt: event.at,
      }
    case 'approval.required':
      return {
        ...state,
        status: 'awaiting_approval',
        pendingApprovalId: event.request.id,
        toolCalls: {
          ...state.toolCalls,
          [event.request.toolCallId]: {
            ...state.toolCalls[event.request.toolCallId],
            status: 'awaiting_approval',
            preview: event.request,
          },
        },
        lastActivityAt: event.at,
      }
    case 'run.cancelled':
      return {
        ...state,
        status: 'cancelled',
        pendingApprovalId: undefined,
        toolCalls: Object.fromEntries(Object.entries(state.toolCalls).map(([id, call]) => [
          id,
          call.status === 'completed' || call.status === 'failed' ? call : { ...call, status: 'cancelled', endedAt: event.at },
        ])),
        subagents: Object.fromEntries(Object.entries(state.subagents).map(([id, subagent]) => [
          id,
          subagent.status === 'completed' || subagent.status === 'failed'
            ? subagent
            : { ...subagent, status: 'cancelled', endedAt: event.at },
        ])),
        lastActivityAt: event.at,
      }
    default:
      return reduceNonTerminalEvent(state, event)
  }
}
```

Implement `reduceNonTerminalEvent` as:

```ts
function reduceNonTerminalEvent(state: WorkAssistantRun, event: WorkAssistantEvent): WorkAssistantRun {
  switch (event.type) {
    case 'tool.progress': {
      const call = state.toolCalls[event.toolCallId]
      if (!call) return state
      return {
        ...state,
        status: 'running',
        pendingApprovalId: call.preview?.id === state.pendingApprovalId ? undefined : state.pendingApprovalId,
        toolCalls: {
          ...state.toolCalls,
          [event.toolCallId]: {
            ...call,
            status: 'running',
            progress: { message: event.message, completed: event.completed, total: event.total },
          },
        },
        lastActivityAt: event.at,
      }
    }
    case 'tool.completed': {
      const call = state.toolCalls[event.toolCallId]
      if (!call) return state
      return {
        ...state,
        status: state.status === 'awaiting_approval' ? 'running' : state.status,
        pendingApprovalId: call.preview?.id === state.pendingApprovalId ? undefined : state.pendingApprovalId,
        toolCalls: {
          ...state.toolCalls,
          [event.toolCallId]: {
            ...call,
            status: event.result.ok ? 'completed' : 'failed',
            result: event.result,
            endedAt: event.at,
          },
        },
        lastActivityAt: event.at,
      }
    }
    case 'subagent.started':
      return {
        ...state,
        subagents: { ...state.subagents, [event.subagent.id]: event.subagent },
        lastActivityAt: event.at,
      }
    case 'subagent.progress': {
      const subagent = state.subagents[event.subagentId]
      if (!subagent || ['completed', 'failed', 'cancelled'].includes(subagent.status)) return state
      return {
        ...state,
        subagents: {
          ...state.subagents,
          [event.subagentId]: {
            ...subagent,
            status: 'running',
            currentTool: event.currentTool ?? subagent.currentTool,
            progress: [...subagent.progress, event.message].slice(-24),
          },
        },
        lastActivityAt: event.at,
      }
    }
    case 'subagent.completed': {
      const subagent = state.subagents[event.subagentId]
      if (!subagent || ['completed', 'failed', 'cancelled'].includes(subagent.status)) return state
      return {
        ...state,
        subagents: {
          ...state.subagents,
          [event.subagentId]: {
            ...subagent,
            status: event.failed ? 'failed' : 'completed',
            summary: event.summary,
            currentTool: undefined,
            endedAt: event.at,
          },
        },
        lastActivityAt: event.at,
      }
    }
    case 'run.completed':
      return { ...state, status: 'completed', messageText: event.response, lastActivityAt: event.at }
    case 'run.failed':
      return { ...state, status: 'failed', error: event.message, lastActivityAt: event.at }
    default:
      return state
  }
}
```

Also export:

```ts
export const reduceWorkAssistantEvents = (state: WorkAssistantRun, events: WorkAssistantEvent[]) =>
  events.reduce(reduceWorkAssistantEvent, state)
```

- [x] **Step 4: Run protocol tests**

Run: `npm run test:unit -- src/services/workAssistantProtocol.test.ts src/services/workAssistantEventReducer.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/services/workAssistantProtocol.ts src/services/workAssistantProtocol.test.ts src/services/workAssistantEventReducer.ts src/services/workAssistantEventReducer.test.ts
git commit -m "feat: define work assistant event protocol"
```

### Task 3: Add the tool registry and local policy engine

**Files:**
- Create: `src/services/workAssistantRegistry.ts`
- Create: `src/services/workAssistantPolicy.ts`
- Create: `src/services/workAssistantRegistry.test.ts`
- Create: `src/services/workAssistantPolicy.test.ts`

- [x] **Step 1: Write registry filtering tests**

```ts
it('hides unavailable and disabled tools from the model schema', () => {
  const tools = enabledToolDefinitions({
    platform: 'linux',
    enabledToolsets: ['workspace'],
    availability: { workspace: true, desktop: true, browser: false, project: true },
  })
  expect(tools.map((tool) => tool.name)).toContain('workspace_scan')
  expect(tools.map((tool) => tool.name)).not.toContain('desktop_open_app')
  expect(tools.map((tool) => tool.name)).not.toContain('browser_snapshot')
})
```

- [x] **Step 2: Implement manifest registration**

Use one manifest per tool. The shape must be:

```ts
export type AssistantToolManifest = {
  name: string
  toolset: 'workspace' | 'desktop' | 'browser' | 'project'
  description: string
  defaultRisk: AssistantRiskLevel
  supportedPlatforms: DesktopPlatform[]
  previewRequired: boolean
  reversible: boolean
  inputSchema: Record<string, unknown>
}

const ALL_PLATFORMS: DesktopPlatform[] = ['windows', 'macos', 'linux']

function manifest(
  name: string,
  toolset: AssistantToolManifest['toolset'],
  description: string,
  defaultRisk: AssistantRiskLevel,
  previewRequired: boolean,
  reversible: boolean,
  inputSchema: Record<string, unknown>,
): AssistantToolManifest {
  return {
    name,
    toolset,
    description,
    defaultRisk,
    supportedPlatforms: ALL_PLATFORMS,
    previewRequired,
    reversible,
    inputSchema,
  }
}

export const WORK_ASSISTANT_TOOLS: AssistantToolManifest[] = [
  manifest('workspace_list', 'workspace', 'List authorized workspace roots', 'read', false, true, objectSchema({})),
  manifest('workspace_scan', 'workspace', 'Scan an authorized workspace', 'read', false, true, objectSchema({ rootId: stringField() }, ['rootId'])),
  manifest('file_search', 'workspace', 'Search files inside an authorized workspace', 'read', false, true, objectSchema({ rootId: stringField(), query: stringField() }, ['rootId', 'query'])),
  manifest('file_inspect', 'workspace', 'Read metadata and safe text excerpts', 'read', false, true, objectSchema({ rootId: stringField(), path: stringField() }, ['rootId', 'path'])),
  manifest('file_plan_batch', 'workspace', 'Build a validated file-operation preview', 'read', false, true, batchPlanSchema()),
  manifest('file_apply_batch', 'workspace', 'Execute an approved file preview', 'reversible', true, true, objectSchema({ previewId: stringField() }, ['previewId'])),
  manifest('file_open', 'workspace', 'Open a non-executable file or directory', 'reversible', true, true, objectSchema({ rootId: stringField(), path: stringField() }, ['rootId', 'path'])),
  manifest('downloads_scan', 'workspace', 'Inspect the authorized downloads directory', 'read', false, true, objectSchema({ rootId: stringField() }, ['rootId'])),
  manifest('desktop_status', 'desktop', 'Read CPU, memory, disk, and capability status', 'read', false, true, objectSchema({})),
  manifest('desktop_open_url', 'desktop', 'Open an HTTP(S) URL', 'reversible', true, true, objectSchema({ url: stringField() }, ['url'])),
  manifest('desktop_open_app', 'desktop', 'Launch a user-registered application alias', 'high', true, false, objectSchema({ applicationId: stringField() }, ['applicationId'])),
  manifest('desktop_reveal_file', 'desktop', 'Reveal a file in the system file manager', 'reversible', true, true, objectSchema({ rootId: stringField(), path: stringField() }, ['rootId', 'path'])),
]
```

Implement `stringField`, `objectSchema`, and `batchPlanSchema` in the same module. Every object schema sets `additionalProperties: false`; `batchPlanSchema` accepts `rootId`, `conflictPolicy`, and an array of operations whose kind is one of `copy`, `move`, `rename`, `create_directory`, or `trash`.

```ts
const stringField = () => ({ type: 'string', minLength: 1 })

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const batchPlanSchema = () => objectSchema({
  rootId: stringField(),
  conflictPolicy: { type: 'string', enum: ['skip', 'rename', 'overwrite'] },
  operations: {
    type: 'array',
    minItems: 1,
    maxItems: 200,
    items: objectSchema({
      kind: { type: 'string', enum: ['copy', 'move', 'rename', 'create_directory', 'trash'] },
      source: { type: 'string' },
      destination: { type: 'string' },
    }, ['kind']),
  },
}, ['rootId', 'conflictPolicy', 'operations'])
```

Do not register browser-enhanced tools in this plan; the browser plan adds them after the bridge exists.

- [x] **Step 3: Write policy tests**

Test these exact rules:

```ts
expect(approvalChoices('read')).toEqual([])
expect(approvalChoices('reversible')).toEqual(['once', 'run', 'deny'])
expect(approvalChoices('high')).toEqual(['once', 'deny'])
expect(approvalChoices('blocked')).toEqual(['deny'])

const previousFileScope: AssistantApprovalScope = {
  toolName: 'file_apply_batch',
  rootId: 'root-1',
  targetParent: 'archive',
  conflictPolicy: 'rename',
  operationKind: 'move',
  maxItemCount: 12,
}
const changedTargetDirectory = { ...previousFileScope, targetParent: 'other' }
const largerFileCount = { ...previousFileScope, maxItemCount: 13 }
const sameBoundedOperation = { ...previousFileScope, maxItemCount: 10 }

expect(scopeAllows(previousFileScope, changedTargetDirectory)).toBe(false)
expect(scopeAllows(previousFileScope, largerFileCount)).toBe(false)
expect(scopeAllows(previousFileScope, sameBoundedOperation)).toBe(true)
```

- [x] **Step 4: Implement fail-closed policy helpers**

```ts
export function effectiveRisk(
  manifest: AssistantToolManifest,
  previewRisk?: AssistantRiskLevel,
): AssistantRiskLevel {
  const rank = { read: 0, reversible: 1, high: 2, blocked: 3 } as const
  if (!previewRisk) return manifest.defaultRisk
  return rank[previewRisk] > rank[manifest.defaultRisk] ? previewRisk : manifest.defaultRisk
}

export function approvalChoices(risk: AssistantRiskLevel): AssistantApprovalChoice[] {
  if (risk === 'read') return []
  if (risk === 'reversible') return ['once', 'run', 'deny']
  if (risk === 'high') return ['once', 'deny']
  return ['deny']
}

export type AssistantApprovalScope = {
  toolName: string
  rootId?: string
  targetParent?: string
  conflictPolicy?: string
  operationKind?: string
  maxItemCount: number
}

const NEVER_RUN_SCOPED = new Set([
  'trash', 'overwrite', 'desktop_open_app', 'browser_download',
  'external_navigation', 'send', 'publish', 'submit',
])

export function scopeAllows(grant: AssistantApprovalScope, request: AssistantApprovalScope) {
  if (NEVER_RUN_SCOPED.has(request.operationKind ?? '')) return false
  return grant.toolName === request.toolName
    && grant.rootId === request.rootId
    && grant.targetParent === request.targetParent
    && grant.conflictPolicy === request.conflictPolicy
    && grant.operationKind === request.operationKind
    && request.maxItemCount <= grant.maxItemCount
}
```

`scopeAllows` must compare tool name, root ID, target parent, conflict policy, operation kind, and maximum item count. It must return `false` for delete, overwrite, app launch, download, external navigation, send, publish, and submit operations.

- [x] **Step 5: Run and commit**

Run: `npm run test:unit -- src/services/workAssistantRegistry.test.ts src/services/workAssistantPolicy.test.ts`

Expected: PASS.

```powershell
git add src/services/workAssistantRegistry.ts src/services/workAssistantRegistry.test.ts src/services/workAssistantPolicy.ts src/services/workAssistantPolicy.test.ts
git commit -m "feat: add controlled assistant tool policy"
```

### Task 4: Create the Rust capability broker foundation

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs:1-35`
- Create: `src-tauri/src/work_assistant/mod.rs`
- Create: `src-tauri/src/work_assistant/types.rs`
- Create: `src-tauri/src/work_assistant/registry.rs`
- Create: `src-tauri/src/work_assistant/audit.rs`

- [x] **Step 1: Add Rust dependencies**

Add:

```toml
sha2 = "0.10"
uuid = { version = "1", features = ["v4", "serde"] }
dunce = "1"
trash = "5"
sysinfo = "0.33"
open = "5"
```

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: dependency resolution succeeds on the declared Rust MSRV (`1.88.0`). The current lockfile contains edition-2024 dependencies that cannot be parsed by Cargo 1.77.2; CI therefore uses Rust 1.95.0 while the package MSRV records the dependency floor.

- [x] **Step 2: Define serializable command types**

In `types.rs`, define:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
  pub name: String,
  pub toolset: String,
  pub available: bool,
  pub reason: Option<String>,
  pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedRoot {
  pub id: String,
  pub label: String,
  pub path: PathBuf,
  pub kind: AuthorizedRootKind,
  pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorizedRootKind { Workspace, Downloads }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantErrorPayload {
  pub code: String,
  pub message: String,
  pub recoverable: bool,
}

#[derive(Debug, Clone)]
pub struct WorkAssistantError {
  pub code: String,
  pub message: String,
  pub recoverable: bool,
}

impl WorkAssistantError {
  pub fn blocked(message: impl Into<String>) -> Self {
    Self { code: "blocked".into(), message: message.into(), recoverable: false }
  }

  pub fn protocol(message: impl Into<String>) -> Self {
    Self { code: "protocol".into(), message: message.into(), recoverable: false }
  }
}

impl From<WorkAssistantError> for AssistantErrorPayload {
  fn from(value: WorkAssistantError) -> Self {
    Self { code: value.code, message: value.message, recoverable: value.recoverable }
  }
}
```

- [x] **Step 3: Create broker state and commands**

`mod.rs` must expose a managed state:

```rust
pub struct WorkAssistantState {
  pub roots: RwLock<Vec<AuthorizedRoot>>,
  pub previews: Mutex<HashMap<String, StoredPreview>>,
  pub approvals: Mutex<HashMap<String, StoredApproval>>,
  pub cancelled_runs: Mutex<HashSet<String>>,
  pub audit_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPreview {
  pub id: String,
  pub run_id: String,
  pub revision: String,
  pub risk: String,
  pub scope: serde_json::Value,
  pub payload: serde_json::Value,
  pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredApproval {
  pub token: String,
  pub preview_id: String,
  pub revision: String,
  pub run_id: String,
  pub scope: serde_json::Value,
  pub once: bool,
  pub expires_at: u64,
}

pub fn init_state(app: &tauri::AppHandle) -> Result<WorkAssistantState, String> {
  let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
  Ok(WorkAssistantState::load(data_dir.join("work-assistant.jsonl"), data_dir.join("work-assistant-roots.json"))?)
}
```

Register these commands in `lib.rs`:

```rust
work_assistant_capabilities,
work_assistant_list_roots,
work_assistant_add_root,
work_assistant_remove_root,
work_assistant_list_audit,
work_assistant_clear_audit,
work_assistant_cancel_run,
```

Manage state during `.setup()` with:

```rust
let state = work_assistant::init_state(app.handle())?;
app.manage(state);
```

- [x] **Step 4: Add audit append/read/clear tests**

Use a temporary directory created from `std::env::temp_dir().join(format!("papyrus-test-{}", Uuid::new_v4()))`. Test that append writes one JSON object per line, malformed trailing lines are skipped during reads, and clear truncates the file without deleting the directory.

- [x] **Step 5: Run and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml work_assistant`

Expected: PASS.

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/work_assistant
git commit -m "feat: add native work assistant broker"
```

### Task 5: Enforce authorized-root and path safety

**Files:**
- Create: `src-tauri/src/work_assistant/path_policy.rs`
- Create: `src-tauri/src/work_assistant/workspace.rs`
- Modify: `src-tauri/src/work_assistant/mod.rs`
- Modify: `src-tauri/src/work_assistant/types.rs`

- [x] **Step 1: Write path-policy tests first**

Cover:

```rust
#[test]
fn rejects_parent_escape() {
  let root = fixture_root();
  assert_eq!(resolve_existing(&root, Path::new("../secret.txt")).unwrap_err().code, "path_outside_workspace");
}

#[test]
fn rejects_symlink_escape() {
  let fixture = symlink_escape_fixture();
  assert_eq!(resolve_existing(&fixture.root, &fixture.link).unwrap_err().code, "path_outside_workspace");
}

#[test]
fn resolves_new_destination_by_canonical_parent() {
  let root = fixture_root();
  let path = resolve_destination(&root, Path::new("archive/new.txt")).unwrap();
  assert!(path.starts_with(dunce::canonicalize(root).unwrap()));
}
```

Use `#[cfg(unix)]` for symlink creation and add a Windows junction/temporary-directory case under `#[cfg(windows)]`.

- [x] **Step 2: Implement canonical boundary checks**

```rust
pub fn resolve_existing(root: &Path, candidate: &Path) -> Result<PathBuf, WorkAssistantError> {
  let canonical_root = dunce::canonicalize(root).map_err(io_error)?;
  let joined = if candidate.is_absolute() { candidate.to_path_buf() } else { canonical_root.join(candidate) };
  let canonical = dunce::canonicalize(joined).map_err(io_error)?;
  ensure_inside(&canonical_root, &canonical)?;
  Ok(canonical)
}

pub fn resolve_destination(root: &Path, candidate: &Path) -> Result<PathBuf, WorkAssistantError> {
  let parent = candidate.parent().ok_or_else(|| WorkAssistantError::protocol("destination has no parent"))?;
  let canonical_parent = resolve_existing(root, parent)?;
  let file_name = candidate.file_name().ok_or_else(|| WorkAssistantError::protocol("destination has no name"))?;
  Ok(canonical_parent.join(file_name))
}
```

On Windows, `ensure_inside` must compare normalized components case-insensitively and preserve UNC roots. On Unix, use component equality after canonicalization.

- [x] **Step 3: Implement root persistence commands**

`work_assistant_add_root` must:

1. Accept a path returned by the Tauri dialog.
2. Canonicalize it and require an existing directory.
3. Reject filesystem roots, home-directory root, app data root, `.ssh`, credential directories, and duplicate nested roots.
4. Persist roots atomically through `roots.json.tmp` followed by rename.
5. Return the created `AuthorizedRoot`.

`work_assistant_remove_root` must remove only the matching ID and invalidate previews referencing that root.

- [x] **Step 4: Implement read-only workspace commands**

Add `workspace_list`, `workspace_scan`, `file_search`, `file_inspect`, and `downloads_scan` handlers. Bound every scan by:

```rust
const MAX_SCAN_DEPTH: usize = 8;
const MAX_SCAN_ENTRIES: usize = 5_000;
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_EXCERPT_CHARS: usize = 8_000;
```

Skip hidden/system paths and extensions `exe`, `dll`, `msi`, `app`, `dmg`, `pkg`, `sh`, `bat`, `cmd`, `ps1`, `com`, `scr`, `lnk`, `desktop` from text inspection.

- [x] **Step 5: Run and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml path_policy workspace`

Expected: PASS on the current platform; platform-gated tests compile only on their target OS.

```powershell
git add src-tauri/src/work_assistant/path_policy.rs src-tauri/src/work_assistant/workspace.rs src-tauri/src/work_assistant/mod.rs src-tauri/src/work_assistant/types.rs
git commit -m "feat: enforce work assistant workspace boundaries"
```

### Task 6: Build file previews, approvals, and safe execution

**Files:**
- Create: `src-tauri/src/work_assistant/preview.rs`
- Create: `src-tauri/src/work_assistant/file_ops.rs`
- Modify: `src-tauri/src/work_assistant/mod.rs`
- Modify: `src-tauri/src/work_assistant/types.rs`

- [x] **Step 1: Write preview revision tests**

Test that the revision changes when source length, modified time, destination existence, conflict policy, or operation order changes. Test that execution fails with `stale_preview` after the source is modified.

```rust
let preview = build_preview(&state, request()).unwrap();
fs::write(source_path(), "changed").unwrap();
let error = execute_preview(&state, &preview.id, Some(valid_token())).unwrap_err();
assert_eq!(error.code, "stale_preview");
```

- [x] **Step 2: Define batch requests and results**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileOperationKind { Copy, Move, Rename, CreateDirectory, Trash }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictPolicy { Skip, Rename, Overwrite }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationRequest {
  pub kind: FileOperationKind,
  pub source: Option<PathBuf>,
  pub destination: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPreviewRequest {
  pub run_id: String,
  pub root_id: String,
  pub operations: Vec<FileOperationRequest>,
  pub conflict_policy: ConflictPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalChoice { Once, Run, Deny }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalGrant {
  pub token: String,
  pub preview_id: String,
  pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExecutionResult {
  pub completed: Vec<String>,
  pub skipped: Vec<String>,
  pub failed: Vec<AssistantErrorPayload>,
  pub remaining: Vec<String>,
  pub cancelled: bool,
}
```

Limit one preview to 200 items and 2 GiB total source bytes. `Overwrite` and `Trash` force risk `high`; copy/move/rename/create-directory use `reversible`.

- [x] **Step 3: Implement native approval tokens**

Commands:

```rust
#[tauri::command]
pub fn work_assistant_preview(
  state: State<WorkAssistantState>,
  request: BatchPreviewRequest,
) -> Result<AssistantToolPreview, AssistantErrorPayload>

#[tauri::command]
pub fn work_assistant_approve(
  state: State<WorkAssistantState>,
  preview_id: String,
  run_id: String,
  choice: ApprovalChoice,
) -> Result<ApprovalGrant, AssistantErrorPayload>

#[tauri::command]
pub fn work_assistant_execute(
  state: State<WorkAssistantState>,
  preview_id: String,
  approval_token: Option<String>,
) -> Result<BatchExecutionResult, AssistantErrorPayload>
```

Tokens are random UUIDs bound to preview ID, revision, run ID, scope, expiry, and maximum item count. Execution consumes `once` tokens. Run-scoped grants remain valid only while all scope fields match and the run is not cancelled.

- [x] **Step 4: Implement file execution**

Rules:

- `Copy`: `fs::copy`; reject directory sources in this phase.
- `Move`/`Rename`: use the platform no-replace primitive; if a regular file crosses volumes, copy and verify it before moving the original into the private recovery vault; reject cross-volume directories.
- `CreateDirectory`: `fs::create_dir` only; do not create missing ancestor chains supplied by the model.
- `Trash`: move the validated source into the same-volume `.papyrus-recovery` vault and persist a receipt; never `remove_file`/`remove_dir_all`.
- `Overwrite`: move the old destination into the private recovery vault before publishing the new destination.
- Check cancellation between items and return completed, skipped, failed, and remaining lists.
- Append one audit record per preview decision and one per executed item.

- [x] **Step 5: Run and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml preview file_ops approval`

Expected: PASS.

```powershell
git add src-tauri/src/work_assistant/preview.rs src-tauri/src/work_assistant/file_ops.rs src-tauri/src/work_assistant/mod.rs src-tauri/src/work_assistant/types.rs
git commit -m "feat: add approved file operation previews"
```

### Task 7: Add desktop status, opening, application aliases, and audit commands

**Files:**
- Create: `src-tauri/src/work_assistant/desktop.rs`
- Create: `src-tauri/src/work_assistant/platform/mod.rs`
- Create: `src-tauri/src/work_assistant/platform/windows.rs`
- Create: `src-tauri/src/work_assistant/platform/macos.rs`
- Create: `src-tauri/src/work_assistant/platform/linux.rs`
- Modify: `src-tauri/src/work_assistant/mod.rs`
- Modify: `src-tauri/src/work_assistant/types.rs`

- [x] **Step 1: Write target-validation tests**

```rust
assert!(validate_open_url("https://example.com/report").is_ok());
assert!(validate_open_url("file:///etc/passwd").is_err());
assert!(validate_open_url("javascript:alert(1)").is_err());
assert!(validate_open_file(Path::new("report.pdf")).is_ok());
assert_eq!(validate_open_file(Path::new("installer.exe")).unwrap_err().code, "blocked");
```

Test the full executable/script extension denylist from Task 5.

- [x] **Step 2: Implement platform-neutral status and open commands**

Use `sysinfo` for CPU, total/used memory, and disk summaries. Use `open::that` only after validating HTTP(S) URLs or ordinary files/directories inside an authorized root.

Implement `desktop_reveal_file` through fixed adapters:

```rust
#[cfg(target_os = "windows")]
Command::new("explorer.exe").arg(format!("/select,{}", path.display())).spawn()

#[cfg(target_os = "macos")]
Command::new("open").arg("-R").arg(path).spawn()

#[cfg(target_os = "linux")]
Command::new("xdg-open").arg(path.parent().unwrap_or(path)).spawn()
```

No adapter may accept an entire command string.

- [x] **Step 3: Persist user-registered application aliases**

Add `RegisteredApplication { id, label, executable_path, platform, created_at }` to the native config. Registration must originate from a system file picker, canonicalize the target, and reject shell/script files. Launch uses no model-supplied arguments:

```rust
pub fn launch_registered_app(app: &RegisteredApplication) -> Result<(), WorkAssistantError> {
  platform::launch_application(&app.executable_path)
}
```

macOS accepts `.app` bundles and launches them with fixed `open -a`; Windows/Linux accept executable files selected by the user.

- [x] **Step 4: Expose audit list and clear commands**

Return newest-first records with pagination `{ offset, limit }`, capped at 200. Clear requires a direct settings action and writes a final `audit_cleared` marker after truncation.

- [x] **Step 5: Run and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml desktop platform audit`

Expected: PASS.

```powershell
git add src-tauri/src/work_assistant/desktop.rs src-tauri/src/work_assistant/platform src-tauri/src/work_assistant/mod.rs src-tauri/src/work_assistant/types.rs
git commit -m "feat: add cross-platform desktop capabilities"
```

### Task 8: Add the frontend native client and approval runtime

**Files:**
- Create: `src/services/workAssistantClient.ts`
- Create: `src/services/workAssistantRuntime.ts`
- Create: `src/services/workAssistantRuntime.test.ts`
- Create: `src/stores/useWorkAssistantStore.ts`
- Modify: `src/hooks/useAgentStream.ts:1-45`

- [x] **Step 1: Create typed Tauri wrappers**

`workAssistantClient.ts` must expose typed functions for capabilities, roots, previews, approval, execution, cancellation, app aliases, and audit. Browser tests must be able to inject a mock invoker:

```ts
type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>
let invokeFn: InvokeFn = invoke

export function setWorkAssistantInvokerForTests(next: InvokeFn) {
  invokeFn = next
}

export const previewWorkAssistantAction = (request: NativePreviewRequest) =>
  invokeFn<AssistantToolPreview>('work_assistant_preview', { request })
```

- [x] **Step 2: Write approval-runtime tests**

Test:

1. Read tools execute without a prompt.
2. Reversible tools emit `approval.required` and wait.
3. Denial returns a recoverable cancelled result without invoking execute.
4. Approval invokes native approval before native execute.
5. Aborted signals reject pending approval and invoke native cancellation.
6. Two identical failures trip the loop guard on the third attempt.

- [x] **Step 3: Implement resolver-based approval waiting**

```ts
const pendingApprovals = new Map<string, {
  resolve: (choice: AssistantApprovalChoice) => void
  reject: (error: Error) => void
}>()

export function resolveAssistantApproval(id: string, choice: AssistantApprovalChoice) {
  const pending = pendingApprovals.get(id)
  if (!pending) return false
  pendingApprovals.delete(id)
  pending.resolve(choice)
  return true
}
```

`executeAssistantToolCall` must emit events in this order: `tool.started`, `tool.progress` for preview, optional `approval.required`, `tool.progress` for execution, then `tool.completed`.

`file_plan_batch` calls the native preview command and returns its opaque preview ID to the Agent. `file_apply_batch` loads that existing preview ID, emits `approval.required`, obtains the native approval grant, and executes it; it must not build a second preview from model arguments.

- [x] **Step 4: Coalesce text deltas and preserve event order**

Maintain one queued string per `{ runId, messageId }`. Flush at most once every 40ms using `requestAnimationFrame` plus a timeout floor. Before dispatching any non-`message.delta` event, synchronously flush that run's queued text so a tool row cannot appear before the sentence that introduced it.

```ts
const queuedDeltas = new Map<string, { runId: string; messageId: string; text: string }>()

export function queueWorkAssistantDelta(event: Extract<WorkAssistantEvent, { type: 'message.delta' }>) {
  const key = `${event.runId}:${event.messageId}`
  const queued = queuedDeltas.get(key) ?? { runId: event.runId, messageId: event.messageId, text: '' }
  queued.text += event.delta
  queuedDeltas.set(key, queued)
  scheduleDeltaFlush()
}

export function dispatchOrderedWorkAssistantEvent(event: WorkAssistantEvent) {
  if (event.type !== 'message.delta') flushRunDeltas(event.runId)
  if (event.type === 'message.delta') queueWorkAssistantDelta(event)
  else useWorkAssistantStore.getState().dispatch(event)
}
```

Add tests for two deltas becoming one reducer dispatch, tool-before-flush prevention, unmount flush, and cancelled-run late delta rejection.

- [x] **Step 5: Create a focused Zustand store**

Do not add more transient runtime state to `useAppStore.ts`. `useWorkAssistantStore.ts` owns:

```ts
type WorkAssistantStore = {
  runs: Record<string, WorkAssistantRun>
  activeRunId?: string
  selectedToolCallId?: string
  capabilityStatus: AssistantCapabilityStatus[]
  dispatch: (event: WorkAssistantEvent) => void
  selectToolCall: (id?: string) => void
  resetRun: (runId: string) => void
}
```

Limit retained runs to 20 and do not persist them. Durable history comes from native audit records.

- [x] **Step 6: Extend event binding and commit**

Update `useAgentStream` to listen for `work_assistant_event` and dispatch the payload to `useWorkAssistantStore`. Keep the existing three `agent_step_*` listeners.

Run: `npm run test:unit -- src/services/workAssistantRuntime.test.ts`

Expected: PASS.

```powershell
git add src/services/workAssistantClient.ts src/services/workAssistantRuntime.ts src/services/workAssistantRuntime.test.ts src/stores/useWorkAssistantStore.ts src/hooks/useAgentStream.ts
git commit -m "feat: add work assistant approval runtime"
```

### Task 9: Add the iterative secretary tool loop

**Files:**
- Create: `src/services/workAssistantAgentLoop.ts`
- Create: `src/services/workAssistantAgentLoop.test.ts`
- Create: `src/services/secretaryRunController.ts`
- Modify: `src/services/secretaryTaskClassifier.ts`
- Modify: `src/services/agentOrchestrator.ts:71-93`
- Modify: `src/services/agentOrchestrator.ts:120-215`
- Modify: `src/services/agentOrchestrator.ts:933-1020`

- [x] **Step 1: Extend task classification with a domain**

Add:

```ts
export type SecretaryTaskDomain = 'writing' | 'work_assistant' | 'mixed'

export type SecretaryTaskClassification = {
  complexity: SecretaryTaskComplexity
  confidence: number
  suggestedAgentCount: number
  expectedAgentCount: number
  hiveRecommended: boolean
  cacheability: 'low' | 'medium' | 'high'
  reasons: string[]
  taskType: string
  domain: SecretaryTaskDomain
}
```

Classify file organization, downloads, local app, folder, disk, browser-open, and system-status requests as `work_assistant`; classify requests that both gather local/web material and produce prose as `mixed`; preserve existing writing classifications.

- [x] **Step 2: Write agent-loop tests with a scripted model**

Use an injected `modelCall` and `executeTool`:

```ts
it('scans, previews, applies, then returns a final response', async () => {
  const model = scriptedModel([
    toolDecision('workspace_scan', { rootId: 'downloads' }),
    toolDecision('file_plan_batch', { rootId: 'downloads', operations: planOps }),
    toolDecision('file_apply_batch', { previewId: 'preview-1' }),
    finalDecision('已整理 12 个文件。'),
  ])
  const result = await runWorkAssistantAgentLoop(input({ modelCall: model, executeTool }))
  expect(executeTool.mock.calls.map(([call]) => call.name)).toEqual([
    'workspace_scan',
    'file_plan_batch',
    'file_apply_batch',
  ])
  expect(result.response).toBe('已整理 12 个文件。')
})
```

Also test unknown tools, malformed JSON, eight-round limit, duplicate failed arguments, cancellation, and simple-task no-subagent behavior.

Add a final-stream test where `finalDecision('整理完成')` is followed by streamed tokens `['已整理', ' 12 个文件。']`; assert two `message.delta` inputs coalesce into the canonical response `已整理 12 个文件。` and the chat contains one assistant message.

- [x] **Step 3: Implement a strict JSON decision protocol**

Intermediate model calls are buffered and never streamed into chat. Accept only:

```ts
type WorkAssistantDecision =
  | { kind: 'tool_call'; tool: { name: string; arguments: Record<string, unknown> }; note: string }
  | { kind: 'final'; response: string }
```

The loop maximum is eight tool calls. Tool results returned to the model contain user-safe summaries and opaque IDs, not complete local paths unless the user already supplied them.

When the model returns `kind: 'final'`, treat `response` as an outline and make one short final streaming call with the verified tool receipts. Stream only that final prose through `message.delta`; if the provider is unavailable, emit the outline as one delta. On completion, replace the streamed buffer with the canonical final text and deduplicate it.

- [x] **Step 4: Add cancellation ownership**

`secretaryRunController.ts` owns one `AbortController` per active flow run:

```ts
let active: { runId: string; controller: AbortController } | undefined

export function startSecretaryRun(runId: string) {
  active?.controller.abort()
  active = { runId, controller: new AbortController() }
  return active.controller.signal
}

export function cancelSecretaryRun() {
  active?.controller.abort()
}
```

Do not abort an older completed run when a new run starts; clear ownership in `finally` only when IDs match.

- [x] **Step 5: Route work-assistant and mixed tasks**

In `sendFlowMessage`:

1. Create the run and signal.
2. Plan as today.
3. If classification domain is `work_assistant`, run the new loop and use its final response.
4. If domain is `mixed`, run the work-assistant loop in collection mode, then pass its sanitized outputs into the existing writer/subagent pipeline.
5. Preserve current document-patch safety.

Expand planner tool names only from `enabledToolDefinitions`; never hard-code unavailable tools into the prompt.

- [x] **Step 6: Run and commit**

Run:

```powershell
npm run test:unit -- src/services/workAssistantAgentLoop.test.ts src/services/workAssistantRuntime.test.ts
npm run build
```

Expected: tests PASS and TypeScript build succeeds.

```powershell
git add src/services/workAssistantAgentLoop.ts src/services/workAssistantAgentLoop.test.ts src/services/secretaryRunController.ts src/services/secretaryTaskClassifier.ts src/services/agentOrchestrator.ts
git commit -m "feat: route secretary tasks through controlled tools"
```

### Task 10: Emit and present subagent and streaming status

**Files:**
- Create: `src/components/SecretaryToolStep.tsx`
- Create: `src/components/SecretaryToolStep.test.tsx`
- Create: `src/components/SecretaryRunStatusStack.tsx`
- Create: `src/components/SecretaryRunStatusStack.test.tsx`
- Create: `src/components/SecretarySubagentStatus.tsx`
- Modify: `src/services/agentOrchestrator.ts:590-730`
- Modify: `src/components/FlowWorkspace.tsx:447-555`

- [x] **Step 1: Emit subagent lifecycle events**

When existing subagents are queued, running, completed, failed, skipped, or cancelled, dispatch matching work-assistant events. Progress text must be a user-verifiable summary such as the task title, current tool, or structured handoff; do not expose model reasoning.

- [x] **Step 2: Add tool-row component tests**

Test that:

- running rows show action, target, and elapsed state;
- awaiting rows render the approval buttons supplied by `allowedChoices`;
- high-risk rows omit the run-level approval button;
- completed rows show summary and impact counts;
- failed rows show recoverable error and retry command;
- expanding a row reveals preview details without duplicating the title.

- [x] **Step 3: Implement stable inline tool rows**

`SecretaryToolStep` receives only one tool call and callbacks. It must not subscribe to streaming message text. Use icon buttons for disclosure, copy, retry, and dismiss; use text buttons only for `执行一次`, `本轮允许`, and `拒绝`.

```tsx
<SecretaryToolStep
  toolCall={toolCall}
  approval={approval}
  onApprove={(choice) => resolveAssistantApproval(approval.id, choice)}
  onSelect={() => selectToolCall(toolCall.id)}
/>
```

- [x] **Step 4: Add the composer status stack**

Render Todo, subagents, background tools, and queued prompts in a stable block immediately above the existing command bar. Default Todo open; subagents and background tools collapsed. Reserve measured height so it cannot cover the final message.

- [x] **Step 5: Add cancellation and stall behavior**

While a run is active, show a stop icon beside the send/queue control. A two-second no-activity indicator appears only when status is `running`, never while `awaiting_approval`. On cancellation, preserve partial assistant text and mark unfinished tools/subagents cancelled.

- [x] **Step 6: Run and commit**

Run:

```powershell
npm run test:unit -- src/components/SecretaryToolStep.test.tsx src/components/SecretaryRunStatusStack.test.tsx
npm run build
```

Expected: PASS.

```powershell
git add src/components/SecretaryToolStep.tsx src/components/SecretaryToolStep.test.tsx src/components/SecretaryRunStatusStack.tsx src/components/SecretaryRunStatusStack.test.tsx src/components/SecretarySubagentStatus.tsx src/components/FlowWorkspace.tsx src/services/agentOrchestrator.ts
git commit -m "feat: show secretary tools and subagents inline"
```

### Task 11: Add file workbench and computer-assistant settings

**Files:**
- Create: `src/components/SecretaryFileWorkbench.tsx`
- Create: `src/components/SecretaryFileWorkbench.test.tsx`
- Create: `src/components/ComputerAssistantSettings.tsx`
- Create: `src/components/ComputerAssistantSettings.test.tsx`
- Modify: `src/components/SecretaryWorkbenchPanel.tsx:18-180`
- Modify: `src/components/FlowWorkspace.tsx:55-165`
- Modify: `src/components/FlowWorkspace.tsx:393-575`
- Modify: `src/components/SettingsPanel.tsx:50-70`
- Modify: `src/components/SettingsPanel.tsx:458-515`

- [x] **Step 1: Rename and extend workbench views**

Use:

```ts
export type WorkbenchView = 'run' | 'files' | 'manuscript'
```

Map the previous `workbench` state to `run` locally; it is component state and requires no persistence migration. The browser plan later adds `browser`.

- [x] **Step 2: Build file-preview tests**

Test source/target rows, conflict policy, item counts, stale preview warning, completed/failed item grouping, and selection synchronization with an inline tool row.

- [x] **Step 3: Implement the unframed file workbench**

Use full-width sections for authorized root, batch summary, conflict policy, and operation list. Do not place cards inside cards. The view is read-only; approvals remain inline in chat.

- [x] **Step 4: Add computer-assistant settings**

Add `assistant` to `SettingsSectionId` and sidebar label `电脑助手`. The section provides:

- capability health for workspace and desktop toolsets;
- add/remove authorized roots through `@tauri-apps/plugin-dialog`;
- register/remove application aliases;
- newest 50 audit records and a clear-audit confirmation;
- explicit unavailable reasons.

Do not expose raw JSON configuration fields.

- [x] **Step 5: Test and commit**

Run:

```powershell
npm run test:unit -- src/components/SecretaryFileWorkbench.test.tsx src/components/ComputerAssistantSettings.test.tsx
npm run build
```

Expected: PASS.

```powershell
git add src/components/SecretaryFileWorkbench.tsx src/components/SecretaryFileWorkbench.test.tsx src/components/ComputerAssistantSettings.tsx src/components/ComputerAssistantSettings.test.tsx src/components/SecretaryWorkbenchPanel.tsx src/components/FlowWorkspace.tsx src/components/SettingsPanel.tsx
git commit -m "feat: add file workbench and assistant settings"
```

### Task 12: Complete core integration tests and documentation

**Files:**
- Create: `src/services/workAssistantIntegration.test.ts`
- Modify: `docs/FEATURES.md`
- Modify: `docs/AGENT_ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `package.json`

- [x] **Step 1: Add a full mocked integration test**

The test must execute this sequence with a mocked model and Tauri invoker:

```text
用户：整理下载目录中的 PDF 和图片
-> workspace_scan
-> file_plan_batch
-> approval.required
-> approve once
-> file_apply_batch
-> final response
```

Assert one user message, one assistant message, one tool row per tool-call ID, no duplicate final text, and a completed run receipt.

- [x] **Step 2: Add cancellation and stale-preview integration tests**

Cancel while approval is pending and assert native cancellation plus no execute call. Return `stale_preview` during execution and assert the UI keeps the original plan, marks the tool recoverable, and offers regenerate-preview rather than replaying the old approval.

- [x] **Step 3: Add aggregate scripts**

Add:

```json
"test:desktop": "npm run test:unit && cargo test --manifest-path src-tauri/Cargo.toml",
"check:desktop": "npm run lint && npm run test:desktop && npm run build && npm run tauri:check:portable"
```

- [x] **Step 4: Update documentation**

Document the controlled tool loop, approval levels, workspace authorization, file-operation limits, no-Shell boundary, audit location, and the fact that browser-enhanced controls arrive in the next plan.

- [x] **Step 5: Run the full core verification**

Run:

```powershell
npm run lint
npm run test:unit
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:check:portable
git diff --check
```

Expected: all commands exit 0. Existing unrelated lint failures must be recorded with exact file/line evidence; do not hide them by weakening lint rules.

- [x] **Step 6: Commit the verified core**

```powershell
git add package.json package-lock.json README.md docs/FEATURES.md docs/AGENT_ARCHITECTURE.md src src-tauri
git commit -m "feat: complete controlled desktop work assistant core"
```

## Core Completion Gate

Do not start the browser plan until all of these are true:

- A real file scan and approved batch operation work in the current OS build.
- Path escape, symlink escape, stale preview, overwrite, trash, cancellation, and duplicate execution tests pass.
- Simple file requests run with one secretary Agent.
- Inline tool and approval UI does not duplicate messages or shift the composer.
- `npm run check:desktop` passes or has a written, pre-existing-only exception list.
