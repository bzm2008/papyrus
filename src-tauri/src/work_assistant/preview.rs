#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_assistant::{
        AuthorizedRoot, AuthorizedRootKind, BatchPreviewRequest, ConflictPolicy, FileOperationKind,
        FileOperationRequest, NativePreviewRequest, WorkAssistantState,
    };
    use std::{
        collections::{HashMap, HashSet},
        fs,
        path::{Path, PathBuf},
        sync::{Mutex, RwLock},
    };
    use uuid::Uuid;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("papyrus-preview-{}", Uuid::new_v4()))
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
            cancelled_execution_audits: Mutex::new(HashSet::new()),
            audit_path: directory.join("audit.jsonl"),
            audit_guard: Mutex::new(()),
        }
    }

    fn request(policy: ConflictPolicy) -> BatchPreviewRequest {
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

    #[test]
    fn native_preview_converter_only_accepts_the_batch_plan_protocol() {
        let request = NativePreviewRequest {
            run_id: "run-1".into(),
            tool_call_id: "call-1".into(),
            tool_name: "file_plan_batch".into(),
            arguments: serde_json::json!({
                "rootId": "root-1",
                "operations": [{
                    "kind": "copy",
                    "source": "inbox/a.txt",
                    "destination": "archive/a.txt",
                }],
                "conflictPolicy": "rename",
            }),
        };

        let batch = batch_preview_request_from_native(&request).unwrap();
        assert_eq!(batch.run_id, "run-1");
        assert_eq!(batch.root_id, "root-1");
        assert_eq!(batch.conflict_policy, ConflictPolicy::Rename);

        let unknown = NativePreviewRequest {
            tool_name: "workspace_scan".into(),
            ..request.clone()
        };
        assert_eq!(
            batch_preview_request_from_native(&unknown)
                .unwrap_err()
                .code,
            "blocked"
        );

        let malformed = NativePreviewRequest {
            arguments: serde_json::json!({ "operations": [] }),
            ..request.clone()
        };
        assert_eq!(
            batch_preview_request_from_native(&malformed)
                .unwrap_err()
                .code,
            "protocol"
        );

        let sensitive_value = r"C:\Users\Administrator\secret";
        let invalid_policy = NativePreviewRequest {
            arguments: serde_json::json!({
                "rootId": "root-1",
                "operations": [],
                "conflictPolicy": sensitive_value,
            }),
            ..request
        };
        let error = batch_preview_request_from_native(&invalid_policy).unwrap_err();
        assert_eq!(error.message, "file_plan_batch arguments are invalid");
        assert!(!error.message.contains(sensitive_value));
    }

    #[test]
    fn native_preview_response_redacts_absolute_workspace_paths() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "source").unwrap();
        let state = state(root(&directory), &directory);
        let request = NativePreviewRequest {
            run_id: "run-1".into(),
            tool_call_id: "call-1".into(),
            tool_name: "file_plan_batch".into(),
            arguments: serde_json::json!({
                "rootId": "root",
                "operations": [{
                    "kind": "copy",
                    "source": "source.txt",
                    "destination": "archive/source.txt",
                }],
                "conflictPolicy": "skip",
            }),
        };

        let preview = create_native_file_preview(&state, request).unwrap();
        let encoded = serde_json::to_string(&preview).unwrap();
        assert!(!encoded.contains(&*directory.to_string_lossy()));
        assert_eq!(preview.id.len(), 36);
        assert_eq!(preview.target_summary, "已授权的工作区");
        assert_eq!(
            state.previews.lock().unwrap()[&preview.id].tool_call_id,
            "call-1"
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn revision_includes_source_metadata_destination_conflict_policy_and_operation_order() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "one").unwrap();
        fs::write(directory.join("second.txt"), "two").unwrap();
        let root = root(&directory);
        let base = build_batch_preview(&[root.clone()], &request(ConflictPolicy::Skip)).unwrap();

        fs::write(directory.join("source.txt"), "source metadata changed").unwrap();
        assert_ne!(
            base.revision,
            build_batch_preview(&[root.clone()], &request(ConflictPolicy::Skip))
                .unwrap()
                .revision
        );

        fs::write(directory.join("destination.txt"), "exists").unwrap();
        assert_ne!(
            base.revision,
            build_batch_preview(&[root.clone()], &request(ConflictPolicy::Skip))
                .unwrap()
                .revision
        );
        assert_ne!(
            base.revision,
            build_batch_preview(&[root.clone()], &request(ConflictPolicy::Rename))
                .unwrap()
                .revision
        );

        let mut reversed = request(ConflictPolicy::Skip);
        reversed.operations.push(FileOperationRequest {
            kind: FileOperationKind::Copy,
            source: Some("second.txt".into()),
            destination: Some("second-copy.txt".into()),
        });
        reversed.operations.reverse();
        assert_ne!(
            build_batch_preview(&[root.clone()], &request(ConflictPolicy::Skip))
                .unwrap()
                .revision,
            build_batch_preview(&[root], &reversed).unwrap().revision
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn source_change_makes_a_stored_preview_stale() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "before").unwrap();
        let state = state(root(&directory), &directory);
        let preview = create_batch_preview(&state, request(ConflictPolicy::Skip)).unwrap();

        fs::write(
            directory.join("source.txt"),
            "after with a different length",
        )
        .unwrap();
        let error =
            validate_preview_fresh(&state, &preview.preview_id, preview.revision).unwrap_err();

        assert_eq!(error.code, "stale_preview");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn high_risk_preview_rejects_run_scoped_approval() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.txt"), "before").unwrap();
        let state = state(root(&directory), &directory);
        let request = BatchPreviewRequest {
            run_id: "run".into(),
            root_id: "root".into(),
            operations: vec![FileOperationRequest {
                kind: FileOperationKind::Trash,
                source: Some("source.txt".into()),
                destination: None,
            }],
            conflict_policy: ConflictPolicy::Skip,
        };
        let preview = create_batch_preview(&state, request).unwrap();
        assert_eq!(preview.risk, "high");

        let error = approve_batch_preview(&state, &preview.preview_id, "run", ApprovalChoice::Run)
            .unwrap_err();
        assert_eq!(error.code, "blocked");
        assert!(state.approvals.lock().unwrap().is_empty());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn preview_rejects_directory_move_before_it_can_prepare_an_overwrite() {
        let directory = test_dir();
        fs::create_dir_all(directory.join("source-directory")).unwrap();
        fs::write(directory.join("source-directory/file.txt"), "source").unwrap();
        fs::write(directory.join("destination.txt"), "keep me").unwrap();
        let request = BatchPreviewRequest {
            run_id: "run".into(),
            root_id: "root".into(),
            operations: vec![FileOperationRequest {
                kind: FileOperationKind::Move,
                source: Some("source-directory".into()),
                destination: Some("destination.txt".into()),
            }],
            conflict_policy: ConflictPolicy::Overwrite,
        };

        let error = build_batch_preview(&[root(&directory)], &request).unwrap_err();

        assert_eq!(error.code, "blocked");
        assert_eq!(
            fs::read_to_string(directory.join("destination.txt")).unwrap(),
            "keep me"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn preview_rejects_directory_trash_so_the_source_cap_cannot_be_bypassed() {
        let directory = test_dir();
        fs::create_dir_all(directory.join("source-directory")).unwrap();
        fs::write(directory.join("source-directory/file.txt"), "source").unwrap();
        let request = BatchPreviewRequest {
            run_id: "run".into(),
            root_id: "root".into(),
            operations: vec![FileOperationRequest {
                kind: FileOperationKind::Trash,
                source: Some("source-directory".into()),
                destination: None,
            }],
            conflict_policy: ConflictPolicy::Skip,
        };

        let error = build_batch_preview(&[root(&directory)], &request).unwrap_err();

        assert_eq!(error.code, "blocked");
        assert!(directory.join("source-directory").is_dir());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_preview_errors_redact_adapter_paths() {
        let error = sanitize_native_preview_error(WorkAssistantError::blocked(
            r"could not inspect source path: C:\Users\Administrator\secret.txt",
        ));

        assert_eq!(error.code, "blocked");
        assert_eq!(error.message, "native file preview is blocked");
        assert!(!error.message.contains(r"C:\Users\Administrator"));
    }
}
use crate::work_assistant::{
    append_audit_entry, ApprovalChoice, ApprovalGrant, AssistantRiskLevel, AssistantToolPreview,
    AuditEntry, AuthorizedRoot, BatchPreview, BatchPreviewRequest, ConflictPolicy,
    FileOperationKind, FileOperationRequest, NativePreviewRequest, PathPolicy, StoredApproval,
    StoredPreview, WorkAssistantError, WorkAssistantState,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const MAX_OPERATIONS: usize = 200;
const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const PREVIEW_LIFETIME_SECONDS: u64 = 5 * 60;
const APPROVAL_LIFETIME_SECONDS: u64 = 5 * 60;
const MAX_RUN_APPROVAL_ITEMS: u32 = 10_000;

#[derive(Clone, Debug)]
pub(crate) struct CalculatedPreview {
    pub revision: u64,
    pub risk: String,
}

/// Converts the public frontend envelope into the existing private batch request. The model may
/// only request a named plan; run ownership always comes from the envelope, never its arguments.
pub fn batch_preview_request_from_native(
    request: &NativePreviewRequest,
) -> Result<BatchPreviewRequest, WorkAssistantError> {
    if request.tool_name != "file_plan_batch" {
        return Err(WorkAssistantError::blocked(
            "this native preview only supports file_plan_batch",
        ));
    }
    if request.run_id.trim().is_empty() || request.tool_call_id.trim().is_empty() {
        return Err(WorkAssistantError::protocol(
            "native preview requires a run id and tool call id",
        ));
    }

    let mut arguments = request.arguments.clone();
    let object = arguments.as_object_mut().ok_or_else(|| {
        WorkAssistantError::protocol("file_plan_batch arguments must be a JSON object")
    })?;
    if object
        .get("rootId")
        .and_then(Value::as_str)
        .is_none_or(|root_id| root_id.trim().is_empty())
    {
        return Err(WorkAssistantError::protocol(
            "file_plan_batch requires a rootId",
        ));
    }
    if !object.contains_key("operations") || !object.contains_key("conflictPolicy") {
        return Err(WorkAssistantError::protocol(
            "file_plan_batch requires operations and conflictPolicy",
        ));
    }
    object.insert("runId".into(), Value::String(request.run_id.clone()));

    serde_json::from_value(arguments)
        .map_err(|_| WorkAssistantError::protocol("file_plan_batch arguments are invalid"))
}

/// Creates the only frontend-visible file preview. It intentionally exposes opaque identifiers
/// and aggregate descriptions, not local filesystem paths or the stored operation payload.
pub fn create_native_file_preview(
    state: &WorkAssistantState,
    request: NativePreviewRequest,
) -> Result<AssistantToolPreview, WorkAssistantError> {
    let batch = batch_preview_request_from_native(&request)?;
    let preview = create_batch_preview_with_tool_call(state, batch, request.tool_call_id)
        .map_err(sanitize_native_preview_error)?;
    let risk = assistant_risk(&preview.risk)?;
    let reversible = risk == AssistantRiskLevel::Reversible;

    Ok(AssistantToolPreview {
        id: preview.preview_id,
        revision: preview.revision.to_string(),
        risk,
        title: "文件操作预览".into(),
        target_summary: "已授权的工作区".into(),
        impact_summary: format!("{} 项文件操作", preview.operation_count),
        reversible,
        expires_at: preview.expires,
        scope: vec![preview.root_id],
    })
}

pub(crate) fn sanitize_native_preview_error(error: WorkAssistantError) -> WorkAssistantError {
    let message = match error.code.as_str() {
        "path_outside_workspace" => "requested path is outside an authorized workspace",
        "blocked" => "native file preview is blocked",
        "protocol" => "native file preview request is invalid",
        _ => "could not create native file preview",
    };
    WorkAssistantError {
        code: error.code,
        message: message.into(),
        recoverable: error.recoverable,
    }
}

fn assistant_risk(risk: &str) -> Result<AssistantRiskLevel, WorkAssistantError> {
    match risk {
        "read" => Ok(AssistantRiskLevel::Read),
        "reversible" => Ok(AssistantRiskLevel::Reversible),
        "high" => Ok(AssistantRiskLevel::High),
        "blocked" => Ok(AssistantRiskLevel::Blocked),
        _ => Err(WorkAssistantError::protocol(
            "stored preview has an unknown risk level",
        )),
    }
}

pub fn create_batch_preview(
    state: &WorkAssistantState,
    request: BatchPreviewRequest,
) -> Result<BatchPreview, WorkAssistantError> {
    create_batch_preview_with_tool_call(state, request, String::new())
}

fn create_batch_preview_with_tool_call(
    state: &WorkAssistantState,
    request: BatchPreviewRequest,
    tool_call_id: String,
) -> Result<BatchPreview, WorkAssistantError> {
    let roots = state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))?
        .clone();
    let calculated = build_batch_preview(&roots, &request)?;
    let now = unix_seconds();
    let preview = BatchPreview {
        preview_id: Uuid::new_v4().to_string(),
        run_id: request.run_id.clone(),
        root_id: request.root_id.clone(),
        revision: calculated.revision,
        risk: calculated.risk.clone(),
        operation_count: request.operations.len(),
        expires: now.saturating_add(PREVIEW_LIFETIME_SECONDS),
    };
    let payload = serde_json::to_value(&request).map_err(|error| {
        WorkAssistantError::protocol(format!("could not serialize preview request: {error}"))
    })?;
    state
        .previews
        .lock()
        .map_err(|_| WorkAssistantError::protocol("workspace previews lock is unavailable"))?
        .insert(
            preview.preview_id.clone(),
            StoredPreview {
                id: preview.preview_id.clone(),
                run: preview.run_id.clone(),
                tool_call_id,
                revision: preview.revision,
                risk: preview.risk.clone(),
                scope: vec![preview.root_id.clone()],
                payload,
                expires: preview.expires,
            },
        );
    append_audit_entry(
        state,
        &AuditEntry::new(
            "file_operation_preview",
            format!("preview={}", preview.preview_id),
        ),
    )?;
    Ok(preview)
}

pub fn approve_batch_preview(
    state: &WorkAssistantState,
    preview_id: &str,
    run_id: &str,
    choice: ApprovalChoice,
) -> Result<ApprovalGrant, WorkAssistantError> {
    let preview = stored_preview(state, preview_id)?;
    if preview.run != run_id {
        return Err(WorkAssistantError::blocked(
            "approval run does not match preview",
        ));
    }
    if preview.expires <= unix_seconds() {
        return Err(WorkAssistantError::stale_preview("preview has expired"));
    }
    if preview.risk != "reversible" && choice == ApprovalChoice::Run {
        return Err(WorkAssistantError::blocked(
            "high-risk file operations only allow one-time approval",
        ));
    }
    if choice == ApprovalChoice::Run {
        let existing = state
            .approvals
            .lock()
            .map_err(|_| WorkAssistantError::protocol("workspace approvals lock is unavailable"))?
            .values()
            .find(|approval| {
                approval.run_scoped
                    && approval.run == preview.run
                    && approval.scope == preview.scope
                    && approval.expires > unix_seconds()
                    && approval.used_count < approval.max_count
            })
            .cloned();
        if let Some(existing) = existing {
            append_audit_entry(
                state,
                &AuditEntry::new(
                    "file_operation_approval_reused",
                    format!("preview={};scope={:?}", preview.id, preview.scope),
                ),
            )?;
            return Ok(ApprovalGrant {
                token: existing.token,
                preview_id: preview.id.clone(),
                expires: existing.expires,
            });
        }
    }
    let max_count = if choice == ApprovalChoice::Run {
        MAX_RUN_APPROVAL_ITEMS
    } else {
        request_from_payload(&preview.payload)?.operations.len() as u32
    };

    let choice_label = match choice {
        ApprovalChoice::Once => "once",
        ApprovalChoice::Run => "run",
        ApprovalChoice::Deny => "deny",
    };
    append_audit_entry(
        state,
        &AuditEntry::new(
            "file_operation_approval",
            format!("preview={preview_id};choice={choice_label}"),
        ),
    )?;
    if choice == ApprovalChoice::Deny {
        state
            .approvals
            .lock()
            .map_err(|_| WorkAssistantError::protocol("workspace approvals lock is unavailable"))?
            .retain(|_, approval| {
                !(approval.run == preview.run && approval.scope == preview.scope)
            });
        return Err(WorkAssistantError::blocked(
            "file operation approval was denied",
        ));
    }

    let token = Uuid::new_v4().to_string();
    let grant = ApprovalGrant {
        token: token.clone(),
        preview_id: preview.id.clone(),
        expires: unix_seconds().saturating_add(APPROVAL_LIFETIME_SECONDS),
    };
    state
        .approvals
        .lock()
        .map_err(|_| WorkAssistantError::protocol("workspace approvals lock is unavailable"))?
        .insert(
            token.clone(),
            StoredApproval {
                token,
                preview: preview.id,
                revision: preview.revision,
                run: preview.run,
                scope: preview.scope,
                once: choice == ApprovalChoice::Once,
                run_scoped: choice == ApprovalChoice::Run,
                expires: grant.expires,
                max_count,
                used_count: 0,
            },
        );
    Ok(grant)
}

pub(crate) fn validate_preview_fresh(
    state: &WorkAssistantState,
    preview_id: &str,
    revision: u64,
) -> Result<(StoredPreview, BatchPreviewRequest), WorkAssistantError> {
    let preview = stored_preview(state, preview_id)?;
    if preview.revision != revision {
        return Err(WorkAssistantError::stale_preview(
            "preview revision does not match",
        ));
    }
    if preview.expires <= unix_seconds() {
        return Err(WorkAssistantError::stale_preview("preview has expired"));
    }
    let request = request_from_payload(&preview.payload)?;
    let roots = state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))?
        .clone();
    let current = build_batch_preview(&roots, &request)?;
    if current.revision != preview.revision {
        return Err(WorkAssistantError::stale_preview(
            "preview is no longer current; create a new preview",
        ));
    }
    Ok((preview, request))
}

pub(crate) fn validate_preview_by_id_fresh(
    state: &WorkAssistantState,
    preview_id: &str,
) -> Result<(StoredPreview, BatchPreviewRequest), WorkAssistantError> {
    let preview = stored_preview(state, preview_id)?;
    validate_preview_fresh(state, preview_id, preview.revision)
}

pub(crate) fn build_batch_preview(
    roots: &[AuthorizedRoot],
    request: &BatchPreviewRequest,
) -> Result<CalculatedPreview, WorkAssistantError> {
    if request.run_id.trim().is_empty() {
        return Err(WorkAssistantError::blocked("run id is required"));
    }
    if request.operations.is_empty() {
        return Err(WorkAssistantError::blocked(
            "at least one file operation is required",
        ));
    }
    if request.operations.len() > MAX_OPERATIONS {
        return Err(WorkAssistantError::blocked(
            "a preview may contain at most 200 operations",
        ));
    }
    let policy = PathPolicy::new(roots);
    let mut digest = Sha256::new();
    digest.update(request.run_id.as_bytes());
    digest.update(request.root_id.as_bytes());
    digest.update([conflict_policy_byte(&request.conflict_policy)]);
    let mut total_source_bytes = 0u64;
    let mut high_risk = request.conflict_policy == ConflictPolicy::Overwrite;

    for operation in &request.operations {
        let source = resolve_operation_source(&policy, &request.root_id, operation)?;
        let destination = resolve_operation_destination(&policy, &request.root_id, operation)?;
        digest.update([operation_kind_byte(&operation.kind)]);
        digest.update(operation.source.as_deref().unwrap_or_default().as_bytes());
        digest.update([0]);
        digest.update(
            operation
                .destination
                .as_deref()
                .unwrap_or_default()
                .as_bytes(),
        );
        digest.update([0]);
        if let Some(source) = source {
            let metadata = fs::metadata(&source).map_err(|error| {
                WorkAssistantError::blocked(format!("could not inspect source path: {error}"))
            })?;
            if !metadata.is_file() {
                return Err(WorkAssistantError::blocked(
                    "file operations support regular files only in this phase",
                ));
            }
            if metadata.is_file() {
                total_source_bytes = total_source_bytes.saturating_add(metadata.len());
            }
            if total_source_bytes > MAX_SOURCE_BYTES {
                return Err(WorkAssistantError::blocked("preview sources exceed 2 GiB"));
            }
            digest.update(source.as_os_str().to_string_lossy().as_bytes());
            digest.update(metadata.len().to_le_bytes());
            digest.update(modified_nanos(&metadata)?.to_le_bytes());
        }
        if let Some(destination) = destination {
            digest.update(destination.as_os_str().to_string_lossy().as_bytes());
            digest.update([u8::from(destination.exists())]);
        }
        high_risk |= operation.kind == FileOperationKind::Trash;
    }
    let bytes: [u8; 8] = digest.finalize()[..8]
        .try_into()
        .expect("sha256 prefix is eight bytes");
    Ok(CalculatedPreview {
        revision: u64::from_le_bytes(bytes),
        risk: if high_risk { "high" } else { "reversible" }.into(),
    })
}

fn stored_preview(
    state: &WorkAssistantState,
    preview_id: &str,
) -> Result<StoredPreview, WorkAssistantError> {
    state
        .previews
        .lock()
        .map_err(|_| WorkAssistantError::protocol("workspace previews lock is unavailable"))?
        .get(preview_id)
        .cloned()
        .ok_or_else(|| WorkAssistantError::blocked("preview was not found"))
}

fn request_from_payload(payload: &Value) -> Result<BatchPreviewRequest, WorkAssistantError> {
    serde_json::from_value(payload.clone()).map_err(|error| {
        WorkAssistantError::protocol(format!("stored preview payload is invalid: {error}"))
    })
}

fn resolve_operation_source(
    policy: &PathPolicy<'_>,
    root_id: &str,
    operation: &FileOperationRequest,
) -> Result<Option<std::path::PathBuf>, WorkAssistantError> {
    match operation.kind {
        FileOperationKind::Copy
        | FileOperationKind::Move
        | FileOperationKind::Rename
        | FileOperationKind::Trash => {
            let source = operation.source.as_deref().ok_or_else(|| {
                WorkAssistantError::blocked("source is required for this operation")
            })?;
            Ok(Some(policy.resolve_existing(root_id, source)?))
        }
        FileOperationKind::CreateDirectory => {
            if operation.source.is_some() {
                return Err(WorkAssistantError::blocked(
                    "create directory does not accept a source",
                ));
            }
            Ok(None)
        }
    }
}

fn resolve_operation_destination(
    policy: &PathPolicy<'_>,
    root_id: &str,
    operation: &FileOperationRequest,
) -> Result<Option<std::path::PathBuf>, WorkAssistantError> {
    match operation.kind {
        FileOperationKind::Copy
        | FileOperationKind::Move
        | FileOperationKind::Rename
        | FileOperationKind::CreateDirectory => {
            let destination = operation.destination.as_deref().ok_or_else(|| {
                WorkAssistantError::blocked("destination is required for this operation")
            })?;
            Ok(Some(policy.resolve_destination(root_id, destination)?))
        }
        FileOperationKind::Trash => {
            if operation.destination.is_some() {
                return Err(WorkAssistantError::blocked(
                    "trash does not accept a destination",
                ));
            }
            Ok(None)
        }
    }
}

fn operation_kind_byte(kind: &FileOperationKind) -> u8 {
    match kind {
        FileOperationKind::Copy => 1,
        FileOperationKind::Move => 2,
        FileOperationKind::Rename => 3,
        FileOperationKind::CreateDirectory => 4,
        FileOperationKind::Trash => 5,
    }
}

fn conflict_policy_byte(policy: &ConflictPolicy) -> u8 {
    match policy {
        ConflictPolicy::Skip => 1,
        ConflictPolicy::Rename => 2,
        ConflictPolicy::Overwrite => 3,
    }
}

fn modified_nanos(metadata: &fs::Metadata) -> Result<u128, WorkAssistantError> {
    metadata
        .modified()
        .map_err(|error| {
            WorkAssistantError::blocked(format!("could not read source modification time: {error}"))
        })?
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|_| {
            WorkAssistantError::blocked("source modification time predates the Unix epoch")
        })
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
