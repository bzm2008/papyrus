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
        let grant =
            approve_batch_preview(state, &preview.preview_id, "run", ApprovalChoice::Once).unwrap();
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
    fn stored_preview_execution_requires_an_explicit_approval_token() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "source").unwrap();
        let state = state(root(&directory), &directory);
        let preview = create_batch_preview(&state, copy_request(ConflictPolicy::Skip)).unwrap();

        let error = execute_stored_preview(&state, &preview.preview_id, None).unwrap_err();

        assert_eq!(error.code, "blocked");
        assert!(!directory.join("destination.txt").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn executor_refuses_trash_even_when_called_without_the_preview_gate() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "source").unwrap();
        let root = root(&directory);
        let policy = PathPolicy::new(std::slice::from_ref(&root));
        let operation = FileOperationRequest {
            kind: FileOperationKind::Trash,
            source: Some("source.txt".into()),
            destination: None,
        };

        let error = execute_one(&policy, "root", &operation, &ConflictPolicy::Skip).unwrap_err();

        assert_eq!(error.code, "blocked");
        assert_eq!(
            fs::read_to_string(directory.join("source.txt")).unwrap(),
            "source"
        );
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
    fn overwrite_is_blocked_until_trashing_can_be_bound_to_the_destination_handle() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "new content").unwrap();
        fs::write(directory.join("destination.txt"), "old content").unwrap();
        let state = state(root(&directory), &directory);
        let execution = approved_execution(&state, copy_request(ConflictPolicy::Overwrite));

        let result = execute_batch_file_operations(&state, execution).unwrap();

        assert_eq!(result.failed.len(), 1);
        assert_eq!(
            fs::read_to_string(directory.join("destination.txt")).unwrap(),
            "old content"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn directory_copy_is_rejected_before_an_overwrite_can_trash_the_destination() {
        let directory = test_dir();
        fs::create_dir_all(directory.join("source-directory")).unwrap();
        fs::write(directory.join("source-directory/file.txt"), "source").unwrap();
        fs::write(directory.join("destination.txt"), "keep me").unwrap();
        let state = state(root(&directory), &directory);
        let request = BatchPreviewRequest {
            run_id: "run".into(),
            root_id: "root".into(),
            operations: vec![FileOperationRequest {
                kind: FileOperationKind::Copy,
                source: Some("source-directory".into()),
                destination: Some("destination.txt".into()),
            }],
            conflict_policy: ConflictPolicy::Overwrite,
        };
        let error = create_batch_preview(&state, request).unwrap_err();

        assert_eq!(error.code, "blocked");
        assert_eq!(
            fs::read_to_string(directory.join("destination.txt")).unwrap(),
            "keep me"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn one_time_approval_covers_every_item_in_its_preview_batch() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "source").unwrap();
        fs::write(directory.join("second.txt"), "second").unwrap();
        let state = state(root(&directory), &directory);
        let mut request = copy_request(ConflictPolicy::Skip);
        request.operations.push(FileOperationRequest {
            kind: FileOperationKind::Copy,
            source: Some("second.txt".into()),
            destination: Some("second-destination.txt".into()),
        });
        let execution = approved_execution(&state, request);

        let result = execute_batch_file_operations(&state, execution).unwrap();

        assert_eq!(result.completed.len(), 2);
        assert_eq!(
            fs::read_to_string(directory.join("destination.txt")).unwrap(),
            "source"
        );
        assert_eq!(
            fs::read_to_string(directory.join("second-destination.txt")).unwrap(),
            "second"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn run_approval_is_charged_by_operation_count_atomically() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "source").unwrap();
        fs::write(directory.join("second.txt"), "second").unwrap();
        let state = state(root(&directory), &directory);
        let mut request = copy_request(ConflictPolicy::Skip);
        request.operations.push(FileOperationRequest {
            kind: FileOperationKind::Copy,
            source: Some("second.txt".into()),
            destination: Some("second-destination.txt".into()),
        });
        let preview = create_batch_preview(&state, request).unwrap();
        let grant =
            approve_batch_preview(&state, &preview.preview_id, "run", ApprovalChoice::Run).unwrap();
        let execution = BatchExecutionRequest {
            preview_id: preview.preview_id,
            revision: preview.revision,
            token: grant.token.clone(),
        };

        let result = execute_batch_file_operations(&state, execution).unwrap();

        assert_eq!(result.completed.len(), 2);
        assert_eq!(state.approvals.lock().unwrap()[&grant.token].used_count, 2);
        fs::remove_dir_all(directory).unwrap();
    }
}
use crate::work_assistant::{
    append_audit_entry, validate_preview_fresh, ApprovalChoice, AssistantErrorPayload, AuditEntry,
    BatchExecutionRequest, BatchExecutionResult, BatchItemResult, BatchPreview,
    BatchPreviewRequest, ConflictPolicy, DestinationMutationGuard, FileOperationKind,
    FileOperationRequest, PathPolicy, StoredApproval, StoredPreview, WorkAssistantError,
    WorkAssistantState,
};
use std::{
    fs, io,
    path::{Path, PathBuf},
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
    execute_stored_preview(&state, &preview_id, approval_token).map_err(Into::into)
}

fn execute_stored_preview(
    state: &WorkAssistantState,
    preview_id: &str,
    approval_token: Option<String>,
) -> Result<BatchExecutionResult, WorkAssistantError> {
    let token = approval_token
        .ok_or_else(|| WorkAssistantError::blocked("a native approval token is required"))?;
    let (preview, _) = crate::work_assistant::validate_preview_by_id_fresh(state, preview_id)?;
    execute_batch_file_operations(
        state,
        BatchExecutionRequest {
            preview_id: preview.id,
            revision: preview.revision,
            token,
        },
    )
}

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
        return Ok(cancelled_result(&request.operations, 0));
    }
    consume_approval(state, &execution, &preview, &approval, required_count)?;

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

#[derive(Debug)]
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
            Some(policy.resolve_safe_destination(root_id, path)?)
        }
        FileOperationKind::Trash => None,
    };

    if operation.kind == FileOperationKind::Trash {
        return Err(WorkAssistantError::blocked(
            "trash is unavailable until it supports handle-bound deletion",
        ));
    }
    let destination_path = destination.as_mut().expect("non-trash needs destination");
    let mut destination_guard = policy.bind_destination_mutation(root_id, destination_path)?;
    if source
        .as_ref()
        .is_some_and(|source_path| source_path == destination_path)
    {
        return Err(WorkAssistantError::blocked(
            "source and destination must be different paths",
        ));
    }

    if let Some(source) = source.as_ref() {
        let metadata = fs::metadata(source).map_err(file_error)?;
        if !metadata.is_file() {
            return Err(WorkAssistantError::blocked(
                "file operations support regular files only in this phase",
            ));
        }
    }
    if destination_entry_exists(&destination_guard)? {
        match conflict_policy {
            ConflictPolicy::Skip => {
                return Ok(OneOperationResult::Skipped(
                    "destination already exists".into(),
                ))
            }
            ConflictPolicy::Rename => {
                *destination_path = renamed_destination(&*destination_path)?;
                destination_guard = policy.bind_destination_mutation(root_id, destination_path)?;
            }
            ConflictPolicy::Overwrite => {
                return Err(WorkAssistantError::blocked(
                    "overwrite is unavailable until it supports handle-bound trashing",
                ))
            }
        }
    }
    match operation.kind {
        FileOperationKind::Copy => {
            let source = source.expect("copy requires source");
            copy_to_new_destination(&source, &destination_guard)?;
            Ok(OneOperationResult::Completed("copied regular file".into()))
        }
        FileOperationKind::Move | FileOperationKind::Rename => {
            let source = source.expect("move requires source");
            match move_to_new_destination(&source, &destination_guard) {
                Ok(()) => Ok(OneOperationResult::Completed("renamed source".into())),
                Err(error) if is_cross_device_error(&error) => Err(WorkAssistantError::blocked(
                    "cross-volume moves are unavailable without handle-bound trashing",
                )),
                Err(error) => Err(file_error(error)),
            }
        }
        FileOperationKind::CreateDirectory => {
            create_new_destination_directory(&destination_guard)?;
            Ok(OneOperationResult::Completed("created directory".into()))
        }
        FileOperationKind::Trash => unreachable!("trash returned above"),
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

fn destination_entry_exists(
    destination: &DestinationMutationGuard,
) -> Result<bool, WorkAssistantError> {
    #[cfg(unix)]
    {
        let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
        let result = unsafe {
            libc::fstatat(
                destination.parent_fd(),
                destination.name().as_ptr(),
                metadata.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result == 0 {
            let metadata = unsafe { metadata.assume_init() };
            if metadata.st_mode & libc::S_IFMT == libc::S_IFLNK {
                return Err(WorkAssistantError::blocked(
                    "destination may not be a symbolic link",
                ));
            }
            return Ok(true);
        }
        let error = io::Error::last_os_error();
        return match error.kind() {
            io::ErrorKind::NotFound => Ok(false),
            _ => Err(file_error(error)),
        };
    }

    #[cfg(windows)]
    {
        match fs::symlink_metadata(destination.candidate()) {
            Ok(metadata) if metadata.file_type().is_symlink() => Err(WorkAssistantError::blocked(
                "destination may not be a symbolic link",
            )),
            Ok(_) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(file_error(error)),
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = destination;
        Err(WorkAssistantError::blocked(
            "secure destination operations are not available on this platform",
        ))
    }
}

fn copy_to_new_destination(
    source: &Path,
    destination: &DestinationMutationGuard,
) -> Result<(), WorkAssistantError> {
    let mut input = fs::File::open(source).map_err(file_error)?;

    #[cfg(unix)]
    let mut output = {
        use std::os::fd::FromRawFd;

        let descriptor = unsafe {
            libc::openat(
                destination.parent_fd(),
                destination.name().as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if descriptor < 0 {
            return Err(file_error(io::Error::last_os_error()));
        }
        unsafe { fs::File::from_raw_fd(descriptor) }
    };

    #[cfg(windows)]
    let mut output = create_new_windows_file(destination.candidate()).map_err(file_error)?;

    #[cfg(not(any(unix, windows)))]
    {
        let _ = destination;
        return Err(WorkAssistantError::blocked(
            "secure destination operations are not available on this platform",
        ));
    }

    io::copy(&mut input, &mut output).map_err(file_error)?;
    output.sync_all().map_err(file_error)
}

fn move_to_new_destination(
    source: &Path,
    destination: &DestinationMutationGuard,
) -> io::Result<()> {
    #[cfg(windows)]
    {
        return move_file_without_replace_windows(source, destination.candidate());
    }

    #[cfg(unix)]
    {
        let _ = (source, destination);
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "POSIX move and rename require an unavailable no-replace primitive",
        ));
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = (source, destination);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "secure destination operations are not available on this platform",
        ))
    }
}

fn create_new_destination_directory(
    destination: &DestinationMutationGuard,
) -> Result<(), WorkAssistantError> {
    #[cfg(unix)]
    {
        let result =
            unsafe { libc::mkdirat(destination.parent_fd(), destination.name().as_ptr(), 0o700) };
        if result == 0 {
            return Ok(());
        }
        return Err(file_error(io::Error::last_os_error()));
    }

    #[cfg(windows)]
    {
        return create_directory_windows(destination.candidate()).map_err(file_error);
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = destination;
        Err(WorkAssistantError::blocked(
            "secure destination operations are not available on this platform",
        ))
    }
}

#[cfg(windows)]
fn create_new_windows_file(path: &Path) -> io::Result<fs::File> {
    use std::{
        iter,
        os::windows::{ffi::OsStrExt, io::FromRawHandle},
        ptr,
    };

    const GENERIC_WRITE: u32 = 0x4000_0000;
    const CREATE_NEW: u32 = 1;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x0000_0080;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const INVALID_HANDLE_VALUE: isize = -1;
    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_WRITE,
            0,
            ptr::null(),
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { fs::File::from_raw_handle(handle as *mut std::ffi::c_void) })
}

#[cfg(windows)]
fn move_file_without_replace_windows(source: &Path, destination: &Path) -> io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt};

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    if unsafe { MoveFileW(source.as_ptr(), destination.as_ptr()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(windows)]
fn create_directory_windows(path: &Path) -> io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt, ptr};

    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    if unsafe { CreateDirectoryW(wide.as_ptr(), ptr::null()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn CreateFileW(
        file_name: *const u16,
        desired_access: u32,
        share_mode: u32,
        security_attributes: *const std::ffi::c_void,
        creation_disposition: u32,
        flags_and_attributes: u32,
        template_file: *mut std::ffi::c_void,
    ) -> isize;
    fn MoveFileW(existing_file_name: *const u16, new_file_name: *const u16) -> i32;
    fn CreateDirectoryW(path_name: *const u16, security_attributes: *const std::ffi::c_void)
        -> i32;
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
