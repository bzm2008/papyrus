use crate::work_assistant::{
    append_audit_entry, platform::prepare_file_transaction, validate_preview_fresh, ApprovalChoice,
    AssistantErrorPayload, AssistantToolPreview, AuditEntry, BatchExecutionRequest,
    BatchExecutionResult, BatchItemResult, FileOperationRequest, NativePreviewRequest,
    StoredApproval, StoredPreview, WorkAssistantError, WorkAssistantState,
};
use tauri::State;

struct PreparedTransactions(Vec<crate::work_assistant::platform::PreparedFileTransaction>);

impl PreparedTransactions {
    fn new() -> Self {
        Self(Vec::new())
    }
    fn push(&mut self, transaction: crate::work_assistant::platform::PreparedFileTransaction) {
        self.0.push(transaction);
    }
    fn iter_mut(
        &mut self,
    ) -> std::slice::IterMut<'_, crate::work_assistant::platform::PreparedFileTransaction> {
        self.0.iter_mut()
    }
    fn cleanup(&mut self) -> Option<WorkAssistantError> {
        let slots = self.0.iter_mut()
            .flat_map(crate::work_assistant::platform::PreparedFileTransaction::take_recovery_slots_for_cleanup)
            .collect();
        crate::work_assistant::platform::cleanup_recovery_slots(slots).err()
    }
}

impl Drop for PreparedTransactions {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

#[tauri::command]
pub fn work_assistant_preview(
    state: State<'_, WorkAssistantState>,
    request: NativePreviewRequest,
) -> Result<AssistantToolPreview, AssistantErrorPayload> {
    crate::work_assistant::create_native_file_preview(&state, request).map_err(Into::into)
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
        .ok_or_else(|| WorkAssistantError::blocked("a native approval token is required"))
        .map_err(AssistantErrorPayload::from)?;
    let (preview, _) = crate::work_assistant::validate_preview_by_id_fresh(&state, &preview_id)
        .map_err(safe_command_error)?;
    execute_batch_file_operations(
        &state,
        BatchExecutionRequest {
            preview_id: preview.id,
            revision: preview.revision,
            token,
        },
    )
    .map_err(safe_command_error)
}

/// Executes only the opaque, approval-bound preview.  No model path is accepted here: the
/// platform adapter snapshots every source, binds every destination parent, and prepares recovery
/// before this function consumes the approval token.
pub fn execute_batch_file_operations(
    state: &WorkAssistantState,
    execution: BatchExecutionRequest,
) -> Result<BatchExecutionResult, WorkAssistantError> {
    let (preview, request) =
        validate_preview_fresh(state, &execution.preview_id, execution.revision)?;
    let required_count = u32::try_from(request.operations.len())
        .map_err(|_| WorkAssistantError::blocked("preview has too many operations"))?;
    let approval = validate_approval(state, &execution, required_count)?;
    if is_run_cancelled(state, &request.run_id)? {
        append_cancellation_audit_once(state, &request.run_id, &preview.id)?;
        return Ok(cancelled_result(&request.operations, 0));
    }
    let root = state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))?
        .iter()
        .find(|root| root.id == request.root_id)
        .map(|root| root.path.clone())
        .ok_or_else(|| WorkAssistantError::blocked("authorized root was not found"))?;

    // Preflight is deliberately all-or-nothing.  A bad source, reparse point, stale destination,
    // or unavailable same-device vault must not charge an approval or mutate a file.
    let mut prepared = PreparedTransactions::new();
    for (index, operation) in request.operations.iter().enumerate() {
        if is_run_cancelled(state, &request.run_id)? {
            let mut result = cancelled_result(&request.operations, index);
            record_cleanup_warnings(state, &mut result, &mut prepared);
            append_cancellation_audit_once(state, &request.run_id, &preview.id)?;
            return Ok(result);
        }
        match prepare_file_transaction(
            &root,
            &preview.id,
            index,
            operation,
            &request.conflict_policy,
        ) {
            Ok(transaction) => prepared.push(transaction),
            Err(error) => {
                // Every earlier preflight slot belongs to this batch until its transaction commits.
                // Reclaim them before propagating the preflight error.
                let cleanup = cleanup_prepared(&mut prepared);
                if let Some(cleanup) = cleanup {
                    let _ = append_audit_entry(
                        state,
                        &AuditEntry::new("file_operation_cleanup_warning", cleanup.message),
                    );
                }
                return Err(error);
            }
        }
    }
    if let Err(error) = consume_approval(state, &execution, &preview, &approval, required_count) {
        if let Some(cleanup) = cleanup_prepared(&mut prepared) {
            let _ = append_audit_entry(
                state,
                &AuditEntry::new("file_operation_cleanup_warning", cleanup.message),
            );
        }
        return Err(error);
    }

    let mut result = BatchExecutionResult {
        completed: Vec::new(),
        skipped: Vec::new(),
        failed: Vec::new(),
        remaining: Vec::new(),
        cancelled: false,
        warnings: Vec::new(),
    };
    let mut needs_cleanup = false;
    let mut early_error = None;
    for (index, transaction) in prepared.iter_mut().enumerate() {
        if is_run_cancelled(state, &request.run_id)? {
            if let Err(error) = append_cancellation_audit_once(state, &request.run_id, &preview.id)
            {
                early_error = Some(error);
            }
            result.cancelled = true;
            result
                .remaining
                .extend(remaining_items(&request.operations, index));
            needs_cleanup = true;
            break;
        }
        match transaction.execute(|| is_run_cancelled(state, &request.run_id)) {
            Ok(executed) if executed.detail == "destination already exists" => {
                let skipped_item = item(index, executed.detail, None, executed.receipts.clone());
                append_item_audit(state, "skipped", &skipped_item)?;
                result.skipped.push(skipped_item);
            }
            Ok(executed) => {
                let completed_item = item(index, executed.detail, None, executed.receipts.clone());
                let mut audit_failed = false;
                for receipt in &executed.receipts {
                    if append_audit_entry(
                        state,
                        &AuditEntry::new(
                            "file_operation_recovery",
                            format!(
                                "preview={};index={};vault={};leaf={}",
                                receipt.preview_id,
                                receipt.index,
                                receipt.vault_scope,
                                receipt.recovery_leaf
                            ),
                        ),
                    )
                    .is_err()
                    {
                        audit_failed = true;
                    }
                }
                if append_item_audit(state, "completed", &completed_item).is_err() {
                    audit_failed = true;
                }
                result.completed.push(completed_item);
                if audit_failed {
                    result.warnings.push(item(
                        index,
                        "operation completed; audit persistence is unavailable".into(),
                        Some(&WorkAssistantError {
                            code: "audit_unavailable".into(),
                            message: String::new(),
                            recoverable: true,
                        }),
                        Vec::new(),
                    ));
                }
            }
            Err(error) => {
                if error.code == "cancelled" {
                    if let Err(cancel_error) = record_cancelled_transaction(
                        state,
                        &mut result,
                        &request.operations,
                        index,
                        &error,
                    ) {
                        early_error = Some(cancel_error);
                    } else if let Err(audit_error) =
                        append_cancellation_audit_once(state, &request.run_id, &preview.id)
                    {
                        early_error = Some(audit_error);
                    }
                    needs_cleanup = true;
                    break;
                }
                let item = item(index, safe_error_detail(&error), Some(&error), Vec::new());
                append_item_audit(state, "failed", &item)?;
                result.failed.push(item);
                // This transaction may own an empty recovery slot after a publish race or a
                // failed staging step. Do not execute later prepared work after that failure;
                // reclaim its disposable slots once the loop releases its mutable borrow.
                result
                    .remaining
                    .extend(remaining_items(&request.operations, index + 1));
                needs_cleanup = true;
                break;
            }
        }
    }
    if needs_cleanup {
        record_cleanup_warnings(state, &mut result, &mut prepared);
    }
    if let Some(error) = early_error {
        return Err(error);
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
    let item = item(index, "operation cancelled".into(), Some(error), Vec::new());
    append_item_audit(state, "cancelled", &item)?;
    result.cancelled = true;
    // The active operation did not publish a mutation: include it alongside later work so the UI
    // can offer a deliberate retry without manufacturing a failure item.
    result.remaining.extend(remaining_items(operations, index));
    Ok(())
}

fn append_cancellation_audit_once(
    state: &WorkAssistantState,
    run_id: &str,
    preview_id: &str,
) -> Result<(), WorkAssistantError> {
    // These are opaque application identifiers, never filesystem paths.  Insert before append so
    // repeated cancellation observations cannot produce duplicate receipts; if persistence fails,
    // remove the marker so a later retry can record the audit event.
    let key = format!("{run_id}\u{0}{preview_id}");
    {
        let mut recorded = state
            .cancelled_execution_audits
            .lock()
            .map_err(|_| WorkAssistantError::protocol("cancellation audit lock is unavailable"))?;
        if !recorded.insert(key.clone()) {
            return Ok(());
        }
    }
    if let Err(error) = append_audit_entry(
        state,
        &AuditEntry::new(
            "file_operation_cancelled",
            format!("run={run_id};preview={preview_id}"),
        ),
    ) {
        if let Ok(mut recorded) = state.cancelled_execution_audits.lock() {
            recorded.remove(&key);
        }
        return Err(error);
    }
    Ok(())
}

fn item(
    index: usize,
    detail: String,
    error: Option<&WorkAssistantError>,
    recovery_receipts: Vec<crate::work_assistant::platform::RecoveryReceipt>,
) -> BatchItemResult {
    BatchItemResult {
        index,
        detail,
        code: error.map(|value| value.code.clone()),
        recoverable: error.map(|value| value.recoverable),
        recovery_receipts,
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

fn safe_command_error(error: WorkAssistantError) -> AssistantErrorPayload {
    AssistantErrorPayload {
        code: error.code.clone(),
        message: safe_error_detail(&error),
        recoverable: error.recoverable,
    }
}

fn validate_approval(
    state: &WorkAssistantState,
    execution: &BatchExecutionRequest,
    required_count: u32,
) -> Result<StoredApproval, WorkAssistantError> {
    let approval = state
        .approvals
        .lock()
        .map_err(|_| WorkAssistantError::protocol("workspace approvals lock is unavailable"))?
        .get(&execution.token)
        .cloned()
        .ok_or_else(|| WorkAssistantError::blocked("a valid native approval token is required"))?;
    if approval.token != execution.token
        || approval.preview != execution.preview_id
        || approval.revision != execution.revision
        || approval.expires <= unix_seconds()
        || approval
            .used_count
            .checked_add(required_count)
            .is_none_or(|count| count > approval.max_count)
    {
        return Err(WorkAssistantError::blocked(
            "approval token is invalid or has expired",
        ));
    }
    Ok(approval)
}

fn consume_approval(
    state: &WorkAssistantState,
    execution: &BatchExecutionRequest,
    preview: &StoredPreview,
    expected: &StoredApproval,
    required_count: u32,
) -> Result<(), WorkAssistantError> {
    let mut approvals = state
        .approvals
        .lock()
        .map_err(|_| WorkAssistantError::protocol("workspace approvals lock is unavailable"))?;
    let approval = approvals
        .get_mut(&execution.token)
        .ok_or_else(|| WorkAssistantError::blocked("approval token is no longer valid"))?;
    if approval.preview != preview.id
        || approval.revision != preview.revision
        || approval.run != preview.run
        || approval.scope != preview.scope
        || approval.expires <= unix_seconds()
        || approval.used_count != expected.used_count
        || approval
            .used_count
            .checked_add(required_count)
            .is_none_or(|count| count > approval.max_count)
    {
        return Err(WorkAssistantError::blocked(
            "approval token is no longer valid",
        ));
    }
    approval.used_count = approval
        .used_count
        .checked_add(required_count)
        .ok_or_else(|| WorkAssistantError::blocked("approval item count overflow"))?;
    if approval.once {
        approvals.remove(&execution.token);
    }
    Ok(())
}

fn is_run_cancelled(state: &WorkAssistantState, run_id: &str) -> Result<bool, WorkAssistantError> {
    state
        .cancelled_runs
        .lock()
        .map_err(|_| WorkAssistantError::protocol("cancelled runs lock is unavailable"))
        .map(|runs| runs.contains(run_id))
}

fn cancelled_result(operations: &[FileOperationRequest], start: usize) -> BatchExecutionResult {
    BatchExecutionResult {
        completed: Vec::new(),
        skipped: Vec::new(),
        failed: Vec::new(),
        remaining: remaining_items(operations, start),
        cancelled: true,
        warnings: Vec::new(),
    }
}

fn remaining_items(operations: &[FileOperationRequest], start: usize) -> Vec<BatchItemResult> {
    operations
        .iter()
        .enumerate()
        .skip(start)
        .map(|(index, _)| item(index, "operation pending".into(), None, Vec::new()))
        .collect()
}

fn cleanup_prepared(prepared: &mut PreparedTransactions) -> Option<WorkAssistantError> {
    prepared.cleanup()
}

fn record_cleanup_warnings(
    state: &WorkAssistantState,
    result: &mut BatchExecutionResult,
    prepared: &mut PreparedTransactions,
) {
    if let Some(error) = cleanup_prepared(prepared) {
        let warning = item(
            usize::MAX,
            "uncommitted recovery cleanup needs attention".into(),
            Some(&WorkAssistantError {
                code: "recovery_cleanup_unavailable".into(),
                message: String::new(),
                recoverable: true,
            }),
            Vec::new(),
        );
        let _ = append_audit_entry(
            state,
            &AuditEntry::new("file_operation_cleanup_warning", error.message),
        );
        result.warnings.push(warning);
    }
}

fn append_item_audit(
    state: &WorkAssistantState,
    status: &str,
    item: &BatchItemResult,
) -> Result<(), WorkAssistantError> {
    append_audit_entry(
        state,
        &AuditEntry::new(
            "file_operation_item",
            format!("index={};status={status};{}", item.index, item.detail),
        ),
    )
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_assistant::{
        approve_batch_preview, create_batch_preview, AuthorizedRoot, AuthorizedRootKind,
        BatchPreviewRequest, ConflictPolicy, FileOperationKind, WorkAssistantState,
    };
    use std::{
        collections::{HashMap, HashSet},
        fs,
        path::{Path, PathBuf},
        sync::{Mutex, RwLock},
    };
    use uuid::Uuid;

    fn directory() -> PathBuf {
        std::env::temp_dir().join(format!("papyrus-transaction-{}", Uuid::new_v4()))
    }
    fn root(path: &Path) -> AuthorizedRoot {
        AuthorizedRoot {
            id: "root".into(),
            label: "test".into(),
            path: fs::canonicalize(path).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        }
    }
    fn state(path: &Path) -> WorkAssistantState {
        WorkAssistantState {
            roots: RwLock::new(vec![root(path)]),
            previews: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            cancelled_runs: Mutex::new(HashSet::new()),
            cancelled_execution_audits: Mutex::new(HashSet::new()),
            audit_path: path.join("audit.jsonl"),
            audit_guard: Mutex::new(()),
        }
    }
    fn operation(
        kind: FileOperationKind,
        source: Option<&str>,
        destination: Option<&str>,
    ) -> FileOperationRequest {
        FileOperationRequest {
            kind,
            source: source.map(str::to_string),
            destination: destination.map(str::to_string),
        }
    }
    fn run(
        state: &WorkAssistantState,
        operations: Vec<FileOperationRequest>,
        policy: ConflictPolicy,
    ) -> BatchExecutionResult {
        let preview = create_batch_preview(
            state,
            BatchPreviewRequest {
                run_id: "run".into(),
                root_id: "root".into(),
                operations,
                conflict_policy: policy,
            },
        )
        .unwrap();
        let grant =
            approve_batch_preview(state, &preview.preview_id, "run", ApprovalChoice::Once).unwrap();
        execute_batch_file_operations(
            state,
            BatchExecutionRequest {
                preview_id: preview.preview_id,
                revision: preview.revision,
                token: grant.token,
            },
        )
        .unwrap()
    }

    #[test]
    fn approved_trash_moves_regular_file_to_private_recovery() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "source").unwrap();
        fs::write(path.join("second.txt"), "before").unwrap();
        let state = state(&path);
        let preview = create_batch_preview(
            &state,
            BatchPreviewRequest {
                run_id: "run".into(),
                root_id: "root".into(),
                operations: vec![operation(
                    FileOperationKind::Trash,
                    Some("source.txt"),
                    None,
                )],
                conflict_policy: ConflictPolicy::Skip,
            },
        )
        .unwrap();
        let grant = approve_batch_preview(&state, &preview.preview_id, "run", ApprovalChoice::Once)
            .unwrap();
        let result = execute_batch_file_operations(
            &state,
            BatchExecutionRequest {
                preview_id: preview.preview_id,
                revision: preview.revision,
                token: grant.token,
            },
        )
        .unwrap();
        assert_eq!(result.completed.len(), 1);
        assert!(!path.join("source.txt").exists());
        assert!(path.join(".papyrus-recovery").exists());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn once_approval_cannot_execute_the_same_preview_twice() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "source").unwrap();
        let state = state(&path);
        let preview = create_batch_preview(
            &state,
            BatchPreviewRequest {
                run_id: "run-once".into(),
                root_id: "root".into(),
                operations: vec![operation(
                    FileOperationKind::Copy,
                    Some("source.txt"),
                    Some("destination.txt"),
                )],
                conflict_policy: ConflictPolicy::Skip,
            },
        )
        .unwrap();
        let grant = approve_batch_preview(
            &state,
            &preview.preview_id,
            "run-once",
            ApprovalChoice::Once,
        )
        .unwrap();
        let request = BatchExecutionRequest {
            preview_id: preview.preview_id.clone(),
            revision: preview.revision,
            token: grant.token.clone(),
        };

        let first = execute_batch_file_operations(&state, request.clone()).unwrap();
        assert_eq!(first.completed.len(), 1);
        assert!(path.join("destination.txt").exists());

        let second = execute_batch_file_operations(&state, request).unwrap_err();
        // The opaque preview is consumed with the first execution, so the replay fails
        // closed at the freshness boundary before any second mutation can be prepared.
        assert_eq!(second.code, "stale_preview");
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn audit_failure_after_recovery_keeps_completed_state_and_receipt() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "source").unwrap();
        fs::write(path.join("second.txt"), "before").unwrap();
        let state = state(&path);
        let preview = create_batch_preview(
            &state,
            BatchPreviewRequest {
                run_id: "run".into(),
                root_id: "root".into(),
                operations: vec![operation(
                    FileOperationKind::Trash,
                    Some("source.txt"),
                    None,
                )],
                conflict_policy: ConflictPolicy::Skip,
            },
        )
        .unwrap();
        let grant = approve_batch_preview(&state, &preview.preview_id, "run", ApprovalChoice::Once)
            .unwrap();
        crate::work_assistant::inject_audit_append_failure_once();
        let result = execute_batch_file_operations(
            &state,
            BatchExecutionRequest {
                preview_id: preview.preview_id,
                revision: preview.revision,
                token: grant.token,
            },
        )
        .unwrap();
        assert!(!path.join("source.txt").exists());
        assert_eq!(result.completed.len(), 1);
        assert_eq!(result.completed[0].recovery_receipts.len(), 1);
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(
            result.warnings[0].code.as_deref(),
            Some("audit_unavailable")
        );
        assert_eq!(result.warnings[0].recoverable, Some(true));
        assert!(result.failed.is_empty());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn command_errors_redact_native_paths() {
        let payload = safe_command_error(WorkAssistantError::blocked(
            r"could not open approved file: C:\Users\Administrator\secret.txt",
        ));

        assert_eq!(payload.code, "blocked");
        assert_eq!(
            payload.message,
            "approved file operation could not be completed"
        );
        assert!(!payload.message.contains(r"C:\Users\Administrator"));
    }

    #[test]
    fn command_error_summaries_preserve_recovery_codes_and_flags() {
        for (code, message) in [
            (
                "stale_preview",
                "preview is no longer current; create a new preview",
            ),
            (
                "partial_transaction",
                "a recoverable transaction step needs attention",
            ),
            ("cancelled", "operation cancelled"),
        ] {
            let payload = safe_command_error(WorkAssistantError {
                code: code.into(),
                message: "adapter detail: C:\\Users\\Administrator\\secret.txt".into(),
                recoverable: true,
            });
            assert_eq!(payload.code, code);
            assert_eq!(payload.message, message);
            assert!(payload.recoverable);
        }
    }

    #[test]
    fn overwrite_recovers_old_destination_before_publishing_new_content() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "new").unwrap();
        fs::write(path.join("destination.txt"), "old").unwrap();
        let result = run(
            &state(&path),
            vec![operation(
                FileOperationKind::Copy,
                Some("source.txt"),
                Some("destination.txt"),
            )],
            ConflictPolicy::Overwrite,
        );
        assert_eq!(result.completed.len(), 1);
        assert_eq!(
            fs::read_to_string(path.join("destination.txt")).unwrap(),
            "new"
        );
        assert!(path.join(".papyrus-recovery").exists());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn stale_source_preflight_does_not_consume_approval_or_write_destination() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "old").unwrap();
        let state = state(&path);
        let preview = create_batch_preview(
            &state,
            BatchPreviewRequest {
                run_id: "run".into(),
                root_id: "root".into(),
                operations: vec![operation(
                    FileOperationKind::Copy,
                    Some("source.txt"),
                    Some("destination.txt"),
                )],
                conflict_policy: ConflictPolicy::Skip,
            },
        )
        .unwrap();
        let grant = approve_batch_preview(&state, &preview.preview_id, "run", ApprovalChoice::Once)
            .unwrap();
        fs::write(path.join("source.txt"), "changed").unwrap();
        assert_eq!(
            execute_batch_file_operations(
                &state,
                BatchExecutionRequest {
                    preview_id: preview.preview_id,
                    revision: preview.revision,
                    token: grant.token.clone()
                }
            )
            .unwrap_err()
            .code,
            "stale_preview"
        );
        assert!(state.approvals.lock().unwrap().contains_key(&grant.token));
        assert!(!path.join("destination.txt").exists());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn later_preflight_failure_reclaims_earlier_uncommitted_recovery_slot() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "source").unwrap();
        fs::write(path.join("second.txt"), "before").unwrap();
        let state = state(&path);
        let preview = create_batch_preview(
            &state,
            BatchPreviewRequest {
                run_id: "run".into(),
                root_id: "root".into(),
                operations: vec![
                    operation(FileOperationKind::Trash, Some("source.txt"), None),
                    operation(FileOperationKind::Trash, Some("second.txt"), None),
                ],
                conflict_policy: ConflictPolicy::Skip,
            },
        )
        .unwrap();
        fs::write(path.join("second.txt"), "changed").unwrap();
        let grant = approve_batch_preview(&state, &preview.preview_id, "run", ApprovalChoice::Once)
            .unwrap();
        assert_eq!(
            execute_batch_file_operations(
                &state,
                BatchExecutionRequest {
                    preview_id: preview.preview_id,
                    revision: preview.revision,
                    token: grant.token
                }
            )
            .unwrap_err()
            .code,
            "stale_preview"
        );
        assert!(path.join("source.txt").exists());
        let vault = path.join(".papyrus-recovery");
        assert!(!vault.exists() || fs::read_dir(vault).unwrap().next().is_none());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn cancellation_before_execution_reclaims_prepared_recovery_slot() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "source").unwrap();
        let operation = operation(FileOperationKind::Trash, Some("source.txt"), None);
        let mut transaction =
            prepare_file_transaction(&path, "preview", 0, &operation, &ConflictPolicy::Skip)
                .unwrap();
        let error = match transaction.execute(|| Ok(true)) {
            Err(error) => error,
            Ok(_) => panic!("cancelled transaction must not execute"),
        };
        assert_eq!(error.code, "cancelled");
        transaction.cleanup_uncommitted().unwrap();
        assert!(path.join("source.txt").exists());
        let vault = path.join(".papyrus-recovery");
        assert!(!vault.exists() || fs::read_dir(vault).unwrap().next().is_none());
        drop(transaction);
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn unexecuted_recovery_slot_is_reclaimed_but_committed_slot_is_retained() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("unexecuted.txt"), "one").unwrap();
        fs::write(path.join("committed.txt"), "two").unwrap();
        let first = operation(FileOperationKind::Trash, Some("unexecuted.txt"), None);
        let mut unexecuted =
            prepare_file_transaction(&path, "preview", 0, &first, &ConflictPolicy::Skip).unwrap();
        unexecuted.cleanup_uncommitted().unwrap();
        drop(unexecuted);
        let second = operation(FileOperationKind::Trash, Some("committed.txt"), None);
        let mut committed =
            prepare_file_transaction(&path, "preview", 1, &second, &ConflictPolicy::Skip).unwrap();
        let execution = committed.execute(|| Ok(false)).unwrap();
        assert_eq!(execution.receipts.len(), 1);
        // A committed slot must not be reclaimed by the generic preflight cleanup path.
        committed.cleanup_uncommitted().unwrap();
        let slot = path
            .join(".papyrus-recovery")
            .join(&execution.receipts[0].recovery_leaf);
        assert!(slot.join("content").exists());
        drop(committed);
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn batch_guard_releases_multiple_prepared_transactions_before_cleanup() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("first.txt"), "one").unwrap();
        fs::write(path.join("second.txt"), "two").unwrap();
        let mut prepared = PreparedTransactions::new();
        prepared.push(
            prepare_file_transaction(
                &path,
                "preview",
                0,
                &operation(FileOperationKind::Trash, Some("first.txt"), None),
                &ConflictPolicy::Skip,
            )
            .unwrap(),
        );
        prepared.push(
            prepare_file_transaction(
                &path,
                "preview",
                1,
                &operation(FileOperationKind::Trash, Some("second.txt"), None),
                &ConflictPolicy::Skip,
            )
            .unwrap(),
        );
        drop(prepared);
        let vault = path.join(".papyrus-recovery");
        assert!(!vault.exists() || fs::read_dir(vault).unwrap().next().is_none());
        assert!(path.join("first.txt").exists() && path.join("second.txt").exists());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn same_volume_move_uses_the_native_relative_rename_primitive() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "source").unwrap();
        let result = run(
            &state(&path),
            vec![operation(
                FileOperationKind::Move,
                Some("source.txt"),
                Some("moved.txt"),
            )],
            ConflictPolicy::Skip,
        );
        assert_eq!(result.completed.len(), 1);
        assert!(!path.join("source.txt").exists());
        assert_eq!(
            fs::read_to_string(path.join("moved.txt")).unwrap(),
            "source"
        );
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn cancellation_after_staging_is_cancelled_not_failed_and_leaves_no_staging_file() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "source").unwrap();
        let operation = operation(
            FileOperationKind::Copy,
            Some("source.txt"),
            Some("destination.txt"),
        );
        let mut transaction =
            prepare_file_transaction(&path, "preview", 0, &operation, &ConflictPolicy::Skip)
                .unwrap();
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
        assert!(!fs::read_dir(&path).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".papyrus-stage-")));

        let state = state(&path);
        let mut result = BatchExecutionResult {
            completed: Vec::new(),
            skipped: Vec::new(),
            failed: Vec::new(),
            remaining: Vec::new(),
            cancelled: false,
            warnings: Vec::new(),
        };
        record_cancelled_transaction(&state, &mut result, &[operation], 0, &error).unwrap();
        assert!(result.cancelled);
        assert!(result.failed.is_empty());
        assert_eq!(result.remaining.len(), 1);
        drop(transaction);
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn preflight_cancellation_is_audited_once_without_a_failed_item() {
        let path = directory();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("source.txt"), "source").unwrap();
        let state = state(&path);
        let preview = create_batch_preview(
            &state,
            BatchPreviewRequest {
                run_id: "cancelled-run".into(),
                root_id: "root".into(),
                operations: vec![operation(
                    FileOperationKind::Copy,
                    Some("source.txt"),
                    Some("destination.txt"),
                )],
                conflict_policy: ConflictPolicy::Skip,
            },
        )
        .unwrap();
        let grant = approve_batch_preview(
            &state,
            &preview.preview_id,
            "cancelled-run",
            ApprovalChoice::Once,
        )
        .unwrap();
        state
            .cancelled_runs
            .lock()
            .unwrap()
            .insert("cancelled-run".into());
        let request = BatchExecutionRequest {
            preview_id: preview.preview_id.clone(),
            revision: preview.revision,
            token: grant.token.clone(),
        };

        let first = execute_batch_file_operations(&state, request.clone()).unwrap();
        let second = execute_batch_file_operations(&state, request).unwrap();
        assert!(first.cancelled && second.cancelled);
        assert!(first.failed.is_empty() && second.failed.is_empty());
        assert_eq!(first.remaining.len(), 1);
        let audit = crate::work_assistant::read_audit_entries(&state.audit_path).unwrap();
        assert_eq!(
            audit
                .iter()
                .filter(|entry| entry.event == "file_operation_cancelled")
                .count(),
            1
        );
        assert!(audit.iter().any(
            |entry| entry.detail == format!("run=cancelled-run;preview={}", preview.preview_id)
        ));
        fs::remove_dir_all(path).unwrap();
    }
}
