# Papyrus Agent Memory and Harness

This note records the current Papyrus memory architecture and the ideas borrowed from `agentmemory`, `beads`, and `cognee`.

## Current Shape

Papyrus now has a lightweight local memory layer before a full SQLite/vector/graph backend is introduced.

- `src/services/memoryEngine.ts`
  - `rememberMemory(input)`
  - `recallMemories(query, options)`
  - `composeMemoryContext(query, options)`
  - `observeAgentRun(observation)`
  - `forgetMemory(id)`
- `src/services/agentHarness.ts`
  - `startAgentRun(input)`
  - `finishAgentRun(run, input)`
  - `failAgentRun(run, error)`
- `src/stores/useAppStore.ts`
  - persists `agentMemoryRecords`
  - persists `agentRuns`
  - correlates `AgentTodo`, `FlowTrace`, and `AgentStep` with `agentRunId`

The first implementation stores records in the existing Zustand persisted state. This keeps the desktop app useful immediately while leaving a clean migration path to SQLite, a vector index, or a graph backend.

## Borrowed Ideas

From `agentmemory`:

- Minimal memory API: remember, recall, forget, observe.
- Lifecycle hooks around runs and prompts.
- Per-agent and per-session memory scope.
- Confidence scores and use counts for future decay/consolidation.

From `beads`:

- Memory should be operational, not only text snippets.
- Runs and tasks need traceable IDs.
- Ready-to-inspect JSON-like records make automation easier.

From `cognee`:

- Session memory first, graph memory later.
- Traceable memory sources.
- Tenant/user/session isolation through scope fields.
- Retrieval context should be injected into agent prompts, not only stored.

## Memory Record

`AgentMemoryRecord` stores:

- `scope`: `global`, `chat`, `project`, or `remote`
- `kind`: preference, fact, style, resource, run summary, remote contact, task pattern, decision
- `confidence`, `status`, `useCount`, `lastUsedAt`
- `sourceRunId` for auditability
- chat/project/remote sender metadata

`composeWritingContext` now injects recalled memories into the shared writing context under `Agent Memory`.

## Harness Run

`AgentRunRecord` stores:

- mode: Companion or Flow
- source: local, remote, or system
- status, prompt, summary, error
- remote job/platform/sender metadata
- step and trace counts
- memory IDs written by observation

Flow, Companion, and Remote Relay jobs all go through the same harness path.

## Remote Relay

Remote jobs are normalized through `normalizeRemoteRelayJob`.

Supported platform labels:

- `clawbot`
- `wechat`
- `qq`
- `feishu`
- `wecom`
- `custom`

Papyrus does not automate private WeChat or QQ protocols. WeChat/QQ should arrive through Clawbot or another user-owned adapter. Feishu and WeCom should use official bot callbacks.

The settings UI can generate:

- adapter payload example
- curl test command
- webhook URL

## Next Migration Steps

1. Move `agentMemoryRecords` and `agentRuns` from Zustand into SQLite.
2. Add an inverted index or BM25 table for local keyword retrieval.
3. Add vector embeddings for semantic recall.
4. Add graph edges:
   - memory mentions resource
   - run produced memory
   - remote sender requested task pattern
   - chapter commit updated story fact
5. Add consolidation:
   - merge repeated run summaries
   - decay low-confidence stale records
   - keep explicit user preferences longer than transient summaries
6. Add export/import for memory audit and backup.
