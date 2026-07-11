#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_assistant::{
        approve_batch_preview, create_batch_preview, ApprovalChoice, AuthorizedRoot,
        AuthorizedRootKind, BatchExecutionRequest, BatchPreviewRequest, ConflictPolicy,
        FileOperationKind, FileOperationRequest, WorkAssistantState,
    };
    use std::{
        collections::{HashMap, HashSet},
        fs,
        path::{Path, PathBuf},
        sync::{Mutex, RwLock},
    };
    use uuid::Uuid;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("papyrus-file-ops-{}", Uuid::new_v4()))
    }

    fn root(path: &Path) -> AuthorizedRoot {
        AuthorizedRoot {
            id: "root".into(),
            label: "Test".into(),
            path: fs::canonicalize(path).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        }
    }

    fn state(root: AuthorizedRoot, directory: &Path) -> WorkAssistantState {
        WorkAssistantState {
            roots: RwLock::new(vec![root]),
            previews: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            cancelled_runs: Mutex::new(HashSet::new()),
            audit_path: directory.join("audit.jsonl"),
            audit_guard: Mutex::new(()),
        }
    }

    fn copy_request(policy: ConflictPolicy) -> BatchPreviewRequest {
        BatchPreviewRequest {
            run_id: "run".into(),
            root_id: "root".into(),
            operations: vec![FileOperationRequest {
                kind: FileOperationKind::Copy,
                source: Some("source.txt".into()),
                destination: Some("destination.txt".into()),
            }],
            conflict_policy: policy,
        }
    }

    fn approved_execution(
        state: &WorkAssistantState,
        request: BatchPreviewRequest,
    ) -> BatchExecutionRequest {
        let preview = create_batch_preview(state, request).unwrap();
        let grant = approve_batch_preview(
            state,
            &preview.preview_id,
            preview.revision,
            ApprovalChoice::Once,
        )
        .unwrap()
        .unwrap();
        BatchExecutionRequest {
            preview_id: preview.preview_id,
            revision: preview.revision,
            token: grant.token,
        }
    }

    #[test]
    fn execution_without_a_token_does_not_change_files() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "source").unwrap();
        let state = state(root(&directory), &directory);
        let preview = create_batch_preview(&state, copy_request(ConflictPolicy::Skip)).unwrap();

        let error = execute_batch_file_operations(
            &state,
            BatchExecutionRequest {
                preview_id: preview.preview_id,
                revision: preview.revision,
                token: "not-a-native-token".into(),
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "blocked");
        assert_eq!(
            fs::read_to_string(directory.join("source.txt")).unwrap(),
            "source"
        );
        assert!(!directory.join("destination.txt").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn stale_preview_does_not_start_file_execution() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "source").unwrap();
        let state = state(root(&directory), &directory);
        let execution = approved_execution(&state, copy_request(ConflictPolicy::Skip));
        fs::write(directory.join("source.txt"), "source changed after preview").unwrap();

        let error = execute_batch_file_operations(&state, execution).unwrap_err();

        assert_eq!(error.code, "stale_preview");
        assert!(!directory.join("destination.txt").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn expired_or_scope_mismatched_tokens_do_not_start_file_execution() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "source").unwrap();
        let state = state(root(&directory), &directory);
        let expired = approved_execution(&state, copy_request(ConflictPolicy::Skip));
        state
            .approvals
            .lock()
            .unwrap()
            .get_mut(&expired.token)
            .unwrap()
            .expires = 0;
        assert_eq!(
            execute_batch_file_operations(&state, expired)
                .unwrap_err()
                .code,
            "blocked"
        );

        let scope_mismatch = approved_execution(&state, copy_request(ConflictPolicy::Skip));
        state
            .approvals
            .lock()
            .unwrap()
            .get_mut(&scope_mismatch.token)
            .unwrap()
            .scope = vec!["other-root".into()];
        assert_eq!(
            execute_batch_file_operations(&state, scope_mismatch)
                .unwrap_err()
                .code,
            "blocked"
        );
        assert!(!directory.join("destination.txt").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn cancellation_returns_remaining_items_without_writing_them() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "source").unwrap();
        let state = state(root(&directory), &directory);
        let execution = approved_execution(&state, copy_request(ConflictPolicy::Skip));
        state.cancelled_runs.lock().unwrap().insert("run".into());

        let result = execute_batch_file_operations(&state, execution).unwrap();

        assert!(result.cancelled);
        assert_eq!(result.remaining.len(), 1);
        assert!(!directory.join("destination.txt").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn overwrite_trashes_the_previous_destination_before_copying() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "new content").unwrap();
        fs::write(directory.join("destination.txt"), "old content").unwrap();
        let state = state(root(&directory), &directory);
        let execution = approved_execution(&state, copy_request(ConflictPolicy::Overwrite));

        let result = execute_batch_file_operations(&state, execution).unwrap();

        assert_eq!(result.completed.len(), 1);
        assert_eq!(
            fs::read_to_string(directory.join("destination.txt")).unwrap(),
            "new content"
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
use crate::work_assistant::{
    append_audit_entry, validate_preview_fresh, ApprovalChoice, AssistantErrorPayload, AuditEntry,
    BatchExecutionRequest, BatchExecutionResult, BatchItemResult, BatchPreview,
    BatchPreviewRequest, ConflictPolicy, FileOperationKind, FileOperationRequest, PathPolicy,
    StoredApproval, StoredPreview, WorkAssistantError, WorkAssistantState,
};
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use tauri::State;

#[tauri::command]
pub fn work_assistant_preview_file_operations(
    state: State<'_, WorkAssistantState>,
    request: BatchPreviewRequest,
) -> Result<BatchPreview, AssistantErrorPayload> {
    crate::work_assistant::create_batch_preview(&state, request).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_approve_file_operations(
    state: State<'_, WorkAssistantState>,
    preview_id: String,
    revision: u64,
    choice: ApprovalChoice,
) -> Result<Option<crate::work_assistant::ApprovalGrant>, AssistantErrorPayload> {
    crate::work_assistant::approve_batch_preview(&state, &preview_id, revision, choice)
        .map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_execute_file_operations(
    state: State<'_, WorkAssistantState>,
    request: BatchExecutionRequest,
) -> Result<BatchExecutionResult, AssistantErrorPayload> {
    execute_batch_file_operations(&state, request).map_err(Into::into)
}

pub fn execute_batch_file_operations(
    state: &WorkAssistantState,
    execution: BatchExecutionRequest,
) -> Result<BatchExecutionResult, WorkAssistantError> {
    let approval = validate_approval(state, &execution)?;
    let (preview, request) =
        validate_preview_fresh(state, &execution.preview_id, execution.revision)?;
    if is_run_cancelled(state, &request.run_id)? {
        return Ok(cancelled_result(&request.operations, 0));
    }
    consume_approval(state, &execution, &preview, &approval)?;

    let roots = state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))?
        .clone();
    let policy = PathPolicy::new(&roots);
    let mut result = BatchExecutionResult {
        completed: Vec::new(),
        skipped: Vec::new(),
        failed: Vec::new(),
        remaining: Vec::new(),
        cancelled: false,
    };

    for (index, operation) in request.operations.iter().enumerate() {
        if is_run_cancelled(state, &request.run_id)? {
            result.cancelled = true;
            result
                .remaining
                .extend(remaining_items(&request.operations, index));
            break;
        }
        let item = match execute_one(
            &policy,
            &request.root_id,
            operation,
            &request.conflict_policy,
        ) {
            Ok(OneOperationResult::Completed(detail)) => {
                let item = BatchItemResult { index, detail };
                append_item_audit(state, "completed", &item)?;
                result.completed.push(item);
                continue;
            }
            Ok(OneOperationResult::Skipped(detail)) => {
                let item = BatchItemResult { index, detail };
                append_item_audit(state, "skipped", &item)?;
                result.skipped.push(item);
                continue;
            }
            Err(error) => BatchItemResult {
                index,
                detail: error.to_string(),
            },
        };
        append_item_audit(state, "failed", &item)?;
        result.failed.push(item);
    }
    Ok(result)
}

enum OneOperationResult {
    Completed(String),
    Skipped(String),
}

fn execute_one(
    policy: &PathPolicy<'_>,
    root_id: &str,
    operation: &FileOperationRequest,
    conflict_policy: &ConflictPolicy,
) -> Result<OneOperationResult, WorkAssistantError> {
    let source = match operation.kind {
        FileOperationKind::Copy
        | FileOperationKind::Move
        | FileOperationKind::Rename
        | FileOperationKind::Trash => {
            let path = operation.source.as_deref().ok_or_else(|| {
                WorkAssistantError::blocked("source is required for this operation")
            })?;
            Some(policy.resolve_existing(root_id, path)?)
        }
        FileOperationKind::CreateDirectory => None,
    };
    let mut destination = match operation.kind {
        FileOperationKind::Copy
        | FileOperationKind::Move
        | FileOperationKind::Rename
        | FileOperationKind::CreateDirectory => {
            let path = operation.destination.as_deref().ok_or_else(|| {
                WorkAssistantError::blocked("destination is required for this operation")
            })?;
            Some(policy.resolve_destination(root_id, path)?)
        }
        FileOperationKind::Trash => None,
    };

    if operation.kind == FileOperationKind::Trash {
        trash_path(source.as_ref().expect("trash requires source"))?;
        return Ok(OneOperationResult::Completed(
            "moved source to trash".into(),
        ));
    }
    let destination_path = destination.as_mut().expect("non-trash needs destination");
    if source
        .as_ref()
        .is_some_and(|source_path| source_path == destination_path)
    {
        return Err(WorkAssistantError::blocked(
            "source and destination must be different paths",
        ));
    }
    if destination_path.exists() {
        match conflict_policy {
            ConflictPolicy::Skip => {
                return Ok(OneOperationResult::Skipped(
                    "destination already exists".into(),
                ))
            }
            ConflictPolicy::Rename => *destination_path = renamed_destination(&*destination_path)?,
            ConflictPolicy::Overwrite => trash_path(&*destination_path)?,
        }
    }
    match operation.kind {
        FileOperationKind::Copy => {
            let source = source.expect("copy requires source");
            if !fs::metadata(&source).map_err(file_error)?.is_file() {
                return Err(WorkAssistantError::blocked(
                    "copy supports regular files only",
                ));
            }
            fs::copy(&source, &*destination_path).map_err(file_error)?;
            Ok(OneOperationResult::Completed("copied regular file".into()))
        }
        FileOperationKind::Move | FileOperationKind::Rename => {
            let source = source.expect("move requires source");
            match fs::rename(&source, &*destination_path) {
                Ok(()) => Ok(OneOperationResult::Completed("renamed source".into())),
                Err(error) if is_cross_device_error(&error) => {
                    if !fs::metadata(&source).map_err(file_error)?.is_file() {
                        return Err(WorkAssistantError::blocked(
                            "cross-volume directory moves are not allowed",
                        ));
                    }
                    fs::copy(&source, &*destination_path).map_err(file_error)?;
                    trash_path(&source)?;
                    Ok(OneOperationResult::Completed(
                        "copied file then moved source to trash".into(),
                    ))
                }
                Err(error) => Err(file_error(error)),
            }
        }
        FileOperationKind::CreateDirectory => {
            let parent = destination_path.parent().ok_or_else(|| {
                WorkAssistantError::blocked("destination has no parent directory")
            })?;
            if !parent.is_dir() {
                return Err(WorkAssistantError::blocked(
                    "create directory requires an existing parent",
                ));
            }
            fs::create_dir(&*destination_path).map_err(file_error)?;
            Ok(OneOperationResult::Completed("created directory".into()))
        }
        FileOperationKind::Trash => unreachable!("trash returned above"),
    }
}

fn validate_approval(
    state: &WorkAssistantState,
    execution: &BatchExecutionRequest,
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
        || approval.used_count >= approval.max_count
    {
        return Err(WorkAssistantError::blocked(
            "approval token is invalid or has expired",
        ));
    }
    let preview = state
        .previews
        .lock()
        .map_err(|_| WorkAssistantError::protocol("workspace previews lock is unavailable"))?
        .get(&execution.preview_id)
        .cloned()
        .ok_or_else(|| WorkAssistantError::blocked("preview was not found"))?;
    if approval.run != preview.run || approval.scope != preview.scope {
        return Err(WorkAssistantError::blocked(
            "approval token scope does not match preview",
        ));
    }
    Ok(approval)
}

fn consume_approval(
    state: &WorkAssistantState,
    execution: &BatchExecutionRequest,
    preview: &StoredPreview,
    expected: &StoredApproval,
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
        || approval.used_count >= approval.max_count
    {
        return Err(WorkAssistantError::blocked(
            "approval token is no longer valid",
        ));
    }
    approval.used_count += 1;
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
    }
}

fn remaining_items(operations: &[FileOperationRequest], start: usize) -> Vec<BatchItemResult> {
    operations
        .iter()
        .enumerate()
        .skip(start)
        .map(|(index, operation)| BatchItemResult {
            index,
            detail: format!("{} pending", operation_name(&operation.kind)),
        })
        .collect()
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

fn renamed_destination(destination: &Path) -> Result<PathBuf, WorkAssistantError> {
    let parent = destination
        .parent()
        .ok_or_else(|| WorkAssistantError::blocked("destination has no parent directory"))?;
    let stem = destination
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| WorkAssistantError::blocked("destination has no valid file name"))?;
    let extension = destination.extension().and_then(|value| value.to_str());
    for number in 1..=10_000 {
        let name = match extension {
            Some(extension) => format!("{stem} ({number}).{extension}"),
            None => format!("{stem} ({number})"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(WorkAssistantError::blocked(
        "could not find an available destination name",
    ))
}

fn trash_path(path: &Path) -> Result<(), WorkAssistantError> {
    trash::delete(path).map_err(|error| {
        WorkAssistantError::blocked(format!("could not move path to trash: {error}"))
    })
}

fn file_error(error: io::Error) -> WorkAssistantError {
    WorkAssistantError::blocked(format!("file operation failed: {error}"))
}

fn is_cross_device_error(error: &io::Error) -> bool {
    #[cfg(windows)]
    {
        error.raw_os_error() == Some(17)
    }
    #[cfg(not(windows))]
    {
        error.raw_os_error() == Some(18)
    }
}

fn operation_name(kind: &FileOperationKind) -> &'static str {
    match kind {
        FileOperationKind::Copy => "copy",
        FileOperationKind::Move => "move",
        FileOperationKind::Rename => "rename",
        FileOperationKind::CreateDirectory => "create directory",
        FileOperationKind::Trash => "trash",
    }
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
