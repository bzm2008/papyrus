# Native File Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Papyrus's approved file-operation capability on Windows, macOS, and Linux with platform-native, recoverable execution and a frontend-compatible preview contract.

**Architecture:** The native broker owns all previews, source snapshots, recovery receipts, and audit records. File write operations are restricted to regular files and pass through a platform adapter; the adapter resolves components without following links, opens the source before use, stages destination content, and uses native relative rename primitives. Destructive operations move data into a Papyrus-managed recovery vault on the same volume first; sending an object to the operating system recycle bin is a best-effort post-commit convenience, never the security primitive.

**Threat model:** This protects against untrusted model arguments, stale previews, traversal, symlink/junction/reparse traversal, and normal concurrent file changes. A same-identity hostile process that already holds destructive OS handles cannot be completely contained by an unprivileged desktop application; capability status and documentation must state this boundary. The broker fails closed when it observes an identity, sharing, or path-component mismatch.

**Tech Stack:** Rust 1.85, Tauri 2, `libc 0.2.186`, target-specific `windows-sys 0.59`, Linux `openat2`/`renameat2`, macOS `openat`/`renameatx_np`, Vitest protocol contracts.

---

### Task 1: Define the native preview and capability contract

**Files:**
- Modify: `src-tauri/src/work_assistant/types.rs`
- Modify: `src-tauri/src/work_assistant/preview.rs`
- Modify: `src-tauri/src/work_assistant/registry.rs`
- Test: `src-tauri/src/work_assistant/types.rs`
- Test: `src-tauri/src/work_assistant/preview.rs`

- [x] **Step 1: Write the contract tests**

Add serde tests for the frontend envelope and response. The command input is the protocol type already declared in `src/services/workAssistantProtocol.ts`; the result must not expose raw absolute paths.

```rust
let request = NativePreviewRequest {
    run_id: "run-1".into(), tool_call_id: "call-1".into(),
    tool_name: "file_plan_batch".into(), arguments: json!({
      "rootId": "root-1", "operations": [], "conflictPolicy": "skip"
    }),
};
let value = serde_json::to_value(request).unwrap();
assert_eq!(value["toolCallId"], "call-1");
assert_eq!(serde_json::to_value(preview).unwrap()["expiresAt"], 1);
```

- [ ] **Step 2: Run the tests and verify the missing types fail**

Run: `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml work_assistant::types`

Expected: FAIL before the types and mapping exist.

- [x] **Step 3: Add opaque preview mapping and per-operation capability status**

Add `NativePreviewRequest`, `AssistantToolPreview`, and an internal converter that accepts only `file_plan_batch`, parses its JSON into `BatchPreviewRequest`, and returns `{ id, revision: String, risk, title, targetSummary, impactSummary, reversible, expiresAt }`. Store `tool_call_id` with the native preview, but retain the internal batch request privately. Add separate capability names for `file_copy`, `file_move`, `file_rename`, `file_create_directory`, `file_trash`, and `file_overwrite`; each unavailable status includes the exact platform reason.

- [x] **Step 4: Run focused contract tests**

Run: `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml work_assistant::types work_assistant::preview work_assistant::registry`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/work_assistant/types.rs src-tauri/src/work_assistant/preview.rs src-tauri/src/work_assistant/registry.rs
git commit -m "feat: expose native file preview contract"
```

### Task 2: Build identity-bound source and recovery-vault primitives

**Files:**
- Create: `src-tauri/src/work_assistant/platform/mod.rs`
- Create: `src-tauri/src/work_assistant/platform/windows.rs`
- Create: `src-tauri/src/work_assistant/platform/macos.rs`
- Create: `src-tauri/src/work_assistant/platform/linux.rs`
- Modify: `src-tauri/src/work_assistant/path_policy.rs`
- Modify: `src-tauri/src/work_assistant/types.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Test: `src-tauri/src/work_assistant/path_policy.rs`

- [ ] **Step 1: Add failing identity and recovery-location tests**

Test that source snapshots reject a symlink/reparse final component, that a changed file identity returns `stale_preview`, and that a recovery name is a single opaque leaf under `.papyrus-recovery` rather than a model-controlled path.

```rust
let snapshot = snapshot_regular_source(&policy, "root", Path::new("inbox/a.txt")).unwrap();
fs::write(root.join("inbox/a.txt"), "replacement").unwrap();
assert_eq!(snapshot.verify().unwrap_err().code, "stale_preview");
assert!(recovery_leaf("preview-1", 0).components().count() == 1);
```

- [x] **Step 2: Implement platform source snapshots**

Define a private `PlatformSource` trait with `open_regular_source`, `verify_snapshot`, `copy_to_staging`, `move_to_recovery`, `publish_staging`, and `create_directory`. On Windows, component-walk directories with `FILE_FLAG_OPEN_REPARSE_POINT`, reject `FileAttributeTagInfo` reparse attributes, compare root and source `FILE_ID_INFO`, and deny sharing violations. On Linux, use `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS`; on macOS, component-walk using `openat` with `O_DIRECTORY | O_NOFOLLOW` and `fstatat(AT_SYMLINK_NOFOLLOW)`. All source reads use an already-open regular-file descriptor/handle rather than reopening its pathname.

- [x] **Step 3: Implement the private same-volume recovery vault**

Create `.papyrus-recovery` only through the platform adapter. Every recovery object gets a UUID leaf, a JSON receipt containing preview ID, operation index, original relative path, and file identity, and an audit record. The vault location is verified as a non-link child of the authorized root before each transaction. Do not call `trash::delete` as an execution primitive.

- [x] **Step 4: Run the platform-independent tests**

Run: `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml work_assistant::path_policy work_assistant::platform`

Expected: PASS on the current Windows build; Unix modules compile behind `cfg` without being selected.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/work_assistant/platform src-tauri/src/work_assistant/path_policy.rs src-tauri/src/work_assistant/types.rs
git commit -m "feat: add native file identity primitives"
```

### Task 3: Implement transactional operations with platform adapters

**Files:**
- Modify: `src-tauri/src/work_assistant/file_ops.rs`
- Modify: `src-tauri/src/work_assistant/preview.rs`
- Modify: `src-tauri/src/work_assistant/mod.rs`
- Test: `src-tauri/src/work_assistant/file_ops.rs`

- [ ] **Step 1: Write failing transaction tests**

Cover the exact operation sequences below. Assert no raw `remove_file`, `remove_dir_all`, `MoveFileW`, or ordinary `fs::rename` is used by the execution layer.

```rust
// overwrite: old destination is recoverable if publish fails
let result = execute_preview(&state, preview_id, token);
assert!(recovery_receipt_for(&state, preview_id, 0).is_some());

// stale source: no destination or recovery entry changes
replace_source_after_preview();
assert_eq!(execute_preview(&state, preview_id, token).unwrap_err().code, "stale_preview");
```

Also test Skip, Rename, Overwrite, Trash, same-volume Move/Rename, cross-volume Move (copy -> publish -> recovery source), cancellation between stages, 200 items, 2 GiB, and source/destination reparse rejection.

- [x] **Step 2: Implement copy and create-directory transactions**

Copy reads the snapped source handle into an opaque staging file in the destination parent, fsyncs it, then publishes with no-replace semantics. CreateDirectory creates only one leaf beneath a validated parent. `Skip` leaves state untouched; `Rename` reserves a non-model-generated suffix using the adapter and retries only on a collision.

- [x] **Step 3: Implement move, rename, trash, and overwrite transactions**

For same-volume Move/Rename, use the platform's relative no-replace rename primitive. For cross-volume Move, copy and publish first, verify the publication, then move the original to the recovery vault. Trash moves the snapped source to the vault. Overwrite moves the current snapped destination to the vault, publishes the staged replacement, and records both recovery receipts. If any source/destination identity check fails, return `stale_preview` and leave the unverified entry untouched. Report a recoverable `partial_transaction` only when the old object is safely in recovery and publication failed.

- [x] **Step 4: Map native execution result to safe frontend result**

Keep per-item native audit details, but return each failure as `{ code, message, recoverable }`; no absolute paths or recovery-vault paths are sent to the model. Consume the approval token only after all source snapshots and recovery locations validate; once tokens are consumed even on a post-consumption transaction error.

- [ ] **Step 5: Run and commit**

Run: `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml work_assistant::file_ops work_assistant::preview`

Expected: PASS.

```powershell
git add src-tauri/src/work_assistant/file_ops.rs src-tauri/src/work_assistant/preview.rs src-tauri/src/work_assistant/mod.rs src-tauri/src/work_assistant/types.rs
git commit -m "feat: execute recoverable native file transactions"
```

### Task 4: Wire the exact Tauri API and verify platform builds

**Files:**
- Modify: `src-tauri/src/work_assistant/file_ops.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/work_assistant/types.rs`
- Test: `src-tauri/src/lib.rs`

- [x] **Step 1: Add command contract tests**

Assert that `work_assistant_preview` accepts `NativePreviewRequest` and returns `AssistantToolPreview`, `work_assistant_approve` checks `{ previewId, runId, choice }`, and `work_assistant_execute` accepts `{ previewId, approvalToken }`. Assert handler registration contains exactly these three names.

- [ ] **Step 2: Keep the handler patch isolated**

Update only the three handler and allowlist entries in `src-tauri/src/lib.rs`. Because the user-owned file currently contains whole-file formatting drift, construct and apply an index-only patch; never stage the unrelated whitespace changes.

- [ ] **Step 3: Run Windows verification and cross-target checks**

Run the established Windows command:

```powershell
$env:CARGO_BUILD_JOBS='1'; $env:CARGO_TARGET_DIR=(Join-Path $env:TEMP 'papyrus-cargo-work-assistant'); $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER='C:\Program Files\Rust stable MSVC 1.96\lib\rustlib\x86_64-pc-windows-msvc\bin\rust-lld.exe'; rustup run 1.85.1-x86_64-pc-windows-msvc cargo test --locked --offline --manifest-path src-tauri/Cargo.toml work_assistant
```

Then run `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml --target x86_64-unknown-linux-gnu` and `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin` when the installed target standard libraries are available. Record an unavailable target as an environment limitation, not a passing build.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/work_assistant/file_ops.rs src-tauri/src/work_assistant/types.rs
git commit -m "fix: align native file operation API"
```

### Task 5: Security and quality review gate

**Files:**
- Modify: `docs/AGENT_ARCHITECTURE.md`
- Modify: `docs/FEATURES.md`

- [x] **Step 1: Document the recovery and concurrency boundary**

Document that Papyrus recovery is a private, user-restorable vault; native system recycle-bin dispatch is best effort after audit only. State the same-identity pre-held-handle boundary and the failure conditions exposed in capability status.

- [x] **Step 2: Run threat regression suite**

Run: `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml work_assistant`

Expected: PASS, including stale preview, source replacement, reparse/symlink rejection, recovery/overwrite, cancellation, token consumption, item/byte limits, and protocol serialization.

- [ ] **Step 3: Perform review gates**

Dispatch a fresh specification reviewer, then a fresh code-quality/security reviewer. Both must approve before Task 7 starts. The reviewers must distinguish the documented same-identity pre-held-handle operating-system limit from a path traversal or model-controlled-write bug.

- [ ] **Step 4: Commit documentation**

```powershell
git add docs/AGENT_ARCHITECTURE.md docs/FEATURES.md
git commit -m "docs: define native file operation security boundary"
```
