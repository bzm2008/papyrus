use crate::work_assistant::{
    append_audit_entry, platform::prepare_file_transaction, validate_preview_fresh, ApprovalChoice,
    AssistantErrorPayload, AuditEntry, BatchExecutionRequest, BatchExecutionResult, BatchItemResult,
    BatchPreview, BatchPreviewRequest, FileOperationRequest, StoredApproval, StoredPreview,
    WorkAssistantError, WorkAssistantState,
};
use tauri::State;

#[tauri::command]
pub fn work_assistant_preview(
    state: State<'_, WorkAssistantState>,
    request: BatchPreviewRequest,
) -> Result<BatchPreview, AssistantErrorPayload> {
    crate::work_assistant::create_batch_preview(&state, request).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_approve(
    state: State<'_, WorkAssistantState>,
    preview_id: String,
    run_id: String,
    choice: ApprovalChoice,
) -> Result<crate::work_assistant::ApprovalGrant, AssistantErrorPayload> {
    crate::work_assistant::approve_batch_preview(&state, &preview_id, &run_id, choice)
        .map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_execute(
    state: State<'_, WorkAssistantState>,
    preview_id: String,
    approval_token: Option<String>,
) -> Result<BatchExecutionResult, AssistantErrorPayload> {
    let token = approval_token
        .ok_or_else(|| WorkAssistantError::blocked("a native approval token is required"))?;
    let (preview, _) = crate::work_assistant::validate_preview_by_id_fresh(&state, &preview_id)?;
    execute_batch_file_operations(
        &state,
        BatchExecutionRequest { preview_id: preview.id, revision: preview.revision, token },
    )
    .map_err(Into::into)
}

/// Executes only the opaque, approval-bound preview.  No model path is accepted here: the
/// platform adapter snapshots every source, binds every destination parent, and prepares recovery
/// before this function consumes the approval token.
pub fn execute_batch_file_operations(
    state: &WorkAssistantState,
    execution: BatchExecutionRequest,
) -> Result<BatchExecutionResult, WorkAssistantError> {
    let (preview, request) = validate_preview_fresh(state, &execution.preview_id, execution.revision)?;
    let required_count = u32::try_from(request.operations.len())
        .map_err(|_| WorkAssistantError::blocked("preview has too many operations"))?;
    let approval = validate_approval(state, &execution, required_count)?;
    if is_run_cancelled(state, &request.run_id)? {
        return Ok(cancelled_result(&request.operations, 0));
    }
    let root = state.roots.read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))?
        .iter().find(|root| root.id == request.root_id)
        .map(|root| root.path.clone())
        .ok_or_else(|| WorkAssistantError::blocked("authorized root was not found"))?;

    // Preflight is deliberately all-or-nothing.  A bad source, reparse point, stale destination,
    // or unavailable same-device vault must not charge an approval or mutate a file.
    let mut prepared = Vec::with_capacity(request.operations.len());
    for (index, operation) in request.operations.iter().enumerate() {
        if is_run_cancelled(state, &request.run_id)? { return Ok(cancelled_result(&request.operations, index)); }
        prepared.push(prepare_file_transaction(
            &root, &preview.id, index, operation, &request.conflict_policy,
        )?);
    }
    consume_approval(state, &execution, &preview, &approval, required_count)?;

    let mut result = BatchExecutionResult { completed: Vec::new(), skipped: Vec::new(), failed: Vec::new(), remaining: Vec::new(), cancelled: false };
    for (index, transaction) in prepared.into_iter().enumerate() {
        if is_run_cancelled(state, &request.run_id)? {
            result.cancelled = true;
            result.remaining.extend(remaining_items(&request.operations, index));
            break;
        }
        match transaction.execute(|| is_run_cancelled(state, &request.run_id)) {
            Ok(executed) if executed.detail == "destination already exists" => {
                let item = item(index, executed.detail, None);
                append_item_audit(state, "skipped", &item)?;
                result.skipped.push(item);
            }
            Ok(executed) => {
                let item = item(index, executed.detail, None);
                for receipt in executed.receipts {
                    append_audit_entry(state, &AuditEntry::new(
                        "file_operation_recovery",
                        format!("preview={};index={};vault={};leaf={}", receipt.preview_id, receipt.index, receipt.vault_scope, receipt.recovery_leaf),
                    ))?;
                }
                append_item_audit(state, "completed", &item)?;
                result.completed.push(item);
            }
            Err(error) => {
                if error.code == "cancelled" {
                    record_cancelled_transaction(state, &mut result, &request.operations, index, &error)?;
                    break;
                }
                let item = item(index, safe_error_detail(&error), Some(&error));
                append_item_audit(state, "failed", &item)?;
                result.failed.push(item);
            }
        }
    }
    Ok(result)
}

fn record_cancelled_transaction(
    state: &WorkAssistantState,
    result: &mut BatchExecutionResult,
    operations: &[FileOperationRequest],
    index: usize,
    error: &WorkAssistantError,
) -> Result<(), WorkAssistantError> {
    let item = item(index, "operation cancelled".into(), Some(error));
    append_item_audit(state, "cancelled", &item)?;
    result.cancelled = true;
    // The active operation did not publish a mutation: include it alongside later work so the UI
    // can offer a deliberate retry without manufacturing a failure item.
    result.remaining.extend(remaining_items(operations, index));
    Ok(())
}

fn item(index: usize, detail: String, error: Option<&WorkAssistantError>) -> BatchItemResult {
    BatchItemResult {
        index,
        detail,
        code: error.map(|value| value.code.clone()),
        recoverable: error.map(|value| value.recoverable),
    }
}

fn safe_error_detail(error: &WorkAssistantError) -> String {
    // Error strings are adapter-authored; never serialize a raw path from an OS diagnostic.
    match error.code.as_str() {
        "stale_preview" => "preview is no longer current; create a new preview".into(),
        "partial_transaction" => "a recoverable transaction step needs attention".into(),
        "recovery_unavailable" => "private recovery storage is unavailable on this volume".into(),
        "cancelled" => "operation cancelled".into(),
        _ => "approved file operation could not be completed".into(),
    }
}

fn validate_approval(state: &WorkAssistantState, execution: &BatchExecutionRequest, required_count: u32) -> Result<StoredApproval, WorkAssistantError> {
    let approval = state.approvals.lock().map_err(|_| WorkAssistantError::protocol("workspace approvals lock is unavailable"))?
        .get(&execution.token).cloned().ok_or_else(|| WorkAssistantError::blocked("a valid native approval token is required"))?;
    if approval.token != execution.token || approval.preview != execution.preview_id || approval.revision != execution.revision
        || approval.expires <= unix_seconds() || approval.used_count.checked_add(required_count).is_none_or(|count| count > approval.max_count) {
        return Err(WorkAssistantError::blocked("approval token is invalid or has expired"));
    }
    Ok(approval)
}

fn consume_approval(state: &WorkAssistantState, execution: &BatchExecutionRequest, preview: &StoredPreview, expected: &StoredApproval, required_count: u32) -> Result<(), WorkAssistantError> {
    let mut approvals = state.approvals.lock().map_err(|_| WorkAssistantError::protocol("workspace approvals lock is unavailable"))?;
    let approval = approvals.get_mut(&execution.token).ok_or_else(|| WorkAssistantError::blocked("approval token is no longer valid"))?;
    if approval.preview != preview.id || approval.revision != preview.revision || approval.run != preview.run
        || approval.scope != preview.scope || approval.expires <= unix_seconds() || approval.used_count != expected.used_count
        || approval.used_count.checked_add(required_count).is_none_or(|count| count > approval.max_count) {
        return Err(WorkAssistantError::blocked("approval token is no longer valid"));
    }
    approval.used_count = approval.used_count.checked_add(required_count).ok_or_else(|| WorkAssistantError::blocked("approval item count overflow"))?;
    if approval.once { approvals.remove(&execution.token); }
    Ok(())
}

fn is_run_cancelled(state: &WorkAssistantState, run_id: &str) -> Result<bool, WorkAssistantError> {
    state.cancelled_runs.lock().map_err(|_| WorkAssistantError::protocol("cancelled runs lock is unavailable"))
        .map(|runs| runs.contains(run_id))
}

fn cancelled_result(operations: &[FileOperationRequest], start: usize) -> BatchExecutionResult {
    BatchExecutionResult { completed: Vec::new(), skipped: Vec::new(), failed: Vec::new(), remaining: remaining_items(operations, start), cancelled: true }
}

fn remaining_items(operations: &[FileOperationRequest], start: usize) -> Vec<BatchItemResult> {
    operations.iter().enumerate().skip(start).map(|(index, _)| item(index, "operation pending".into(), None)).collect()
}

fn append_item_audit(state: &WorkAssistantState, status: &str, item: &BatchItemResult) -> Result<(), WorkAssistantError> {
    append_audit_entry(state, &AuditEntry::new("file_operation_item", format!("index={};status={status};{}", item.index, item.detail)))
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_assistant::{approve_batch_preview, create_batch_preview, AuthorizedRoot, AuthorizedRootKind, ConflictPolicy, FileOperationKind, WorkAssistantState};
    use std::{collections::{HashMap, HashSet}, fs, path::{Path, PathBuf}, sync::{Mutex, RwLock}};
    use uuid::Uuid;

    fn directory() -> PathBuf { std::env::temp_dir().join(format!("papyrus-transaction-{}", Uuid::new_v4())) }
    fn root(path: &Path) -> AuthorizedRoot { AuthorizedRoot { id: "root".into(), label: "test".into(), path: fs::canonicalize(path).unwrap(), kind: AuthorizedRootKind::Workspace, created_at: 1 } }
    fn state(path: &Path) -> WorkAssistantState { WorkAssistantState { roots: RwLock::new(vec![root(path)]), previews: Mutex::new(HashMap::new()), approvals: Mutex::new(HashMap::new()), cancelled_runs: Mutex::new(HashSet::new()), audit_path: path.join("audit.jsonl"), audit_guard: Mutex::new(()) } }
    fn operation(kind: FileOperationKind, source: Option<&str>, destination: Option<&str>) -> FileOperationRequest { FileOperationRequest { kind, source: source.map(str::to_string), destination: destination.map(str::to_string) } }
    fn run(state: &WorkAssistantState, operations: Vec<FileOperationRequest>, policy: ConflictPolicy) -> BatchExecutionResult {
        let preview = create_batch_preview(state, BatchPreviewRequest { run_id: "run".into(), root_id: "root".into(), operations, conflict_policy: policy }).unwrap();
        let grant = approve_batch_preview(state, &preview.preview_id, "run", ApprovalChoice::Once).unwrap();
        execute_batch_file_operations(state, BatchExecutionRequest { preview_id: preview.preview_id, revision: preview.revision, token: grant.token }).unwrap()
    }

    #[test]
    fn approved_trash_moves_regular_file_to_private_recovery() {
        let path = directory(); fs::create_dir_all(&path).unwrap(); fs::write(path.join("source.txt"), "source").unwrap();
        let state = state(&path);
        let preview = create_batch_preview(&state, BatchPreviewRequest { run_id: "run".into(), root_id: "root".into(), operations: vec![operation(FileOperationKind::Trash, Some("source.txt"), None)], conflict_policy: ConflictPolicy::Skip }).unwrap();
        let grant = approve_batch_preview(&state, &preview.preview_id, "run", ApprovalChoice::Once).unwrap();
        let result = execute_batch_file_operations(&state, BatchExecutionRequest { preview_id: preview.preview_id, revision: preview.revision, token: grant.token }).unwrap();
        assert_eq!(result.completed.len(), 1); assert!(!path.join("source.txt").exists()); assert!(path.join(".papyrus-recovery").exists());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn overwrite_recovers_old_destination_before_publishing_new_content() {
        let path = directory(); fs::create_dir_all(&path).unwrap(); fs::write(path.join("source.txt"), "new").unwrap(); fs::write(path.join("destination.txt"), "old").unwrap();
        let result = run(&state(&path), vec![operation(FileOperationKind::Copy, Some("source.txt"), Some("destination.txt"))], ConflictPolicy::Overwrite);
        assert_eq!(result.completed.len(), 1); assert_eq!(fs::read_to_string(path.join("destination.txt")).unwrap(), "new"); assert!(path.join(".papyrus-recovery").exists());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn stale_source_preflight_does_not_consume_approval_or_write_destination() {
        let path = directory(); fs::create_dir_all(&path).unwrap(); fs::write(path.join("source.txt"), "old").unwrap(); let state = state(&path);
        let preview = create_batch_preview(&state, BatchPreviewRequest { run_id: "run".into(), root_id: "root".into(), operations: vec![operation(FileOperationKind::Copy, Some("source.txt"), Some("destination.txt"))], conflict_policy: ConflictPolicy::Skip }).unwrap();
        let grant = approve_batch_preview(&state, &preview.preview_id, "run", ApprovalChoice::Once).unwrap(); fs::write(path.join("source.txt"), "changed").unwrap();
        assert_eq!(execute_batch_file_operations(&state, BatchExecutionRequest { preview_id: preview.preview_id, revision: preview.revision, token: grant.token.clone() }).unwrap_err().code, "stale_preview");
        assert!(state.approvals.lock().unwrap().contains_key(&grant.token)); assert!(!path.join("destination.txt").exists()); fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn same_volume_move_uses_the_native_relative_rename_primitive() {
        let path = directory(); fs::create_dir_all(&path).unwrap(); fs::write(path.join("source.txt"), "source").unwrap();
        let result = run(&state(&path), vec![operation(FileOperationKind::Move, Some("source.txt"), Some("moved.txt"))], ConflictPolicy::Skip);
        assert_eq!(result.completed.len(), 1); assert!(!path.join("source.txt").exists()); assert_eq!(fs::read_to_string(path.join("moved.txt")).unwrap(), "source");
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn cancellation_after_staging_is_cancelled_not_failed_and_leaves_no_staging_file() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "source").unwrap();
        let operation = operation(FileOperationKind::Copy, Some("source.txt"), Some("destination.txt"));
        let transaction = prepare_file_transaction(&path, "preview", 0, &operation, &ConflictPolicy::Skip).unwrap();
        let calls = std::cell::Cell::new(0u8);
        let error = match transaction.execute(|| {
            calls.set(calls.get() + 1);
            Ok(calls.get() >= 3)
        }) {
            Err(error) => error,
            Ok(_) => panic!("cancellation after staging must not complete the operation"),
        };
        assert_eq!(error.code, "cancelled");
        assert!(!path.join("destination.txt").exists());
        assert!(!fs::read_dir(&path).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().starts_with(".papyrus-stage-")));

        let state = state(&path);
        let mut result = BatchExecutionResult { completed: Vec::new(), skipped: Vec::new(), failed: Vec::new(), remaining: Vec::new(), cancelled: false };
        record_cancelled_transaction(&state, &mut result, &[operation], 0, &error).unwrap();
        assert!(result.cancelled);
        assert!(result.failed.is_empty());
        assert_eq!(result.remaining.len(), 1);
        fs::remove_dir_all(path).unwrap();
    }
}
