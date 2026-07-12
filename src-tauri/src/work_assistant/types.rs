use serde::{Deserialize, Serialize};
use std::{fmt, path::PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    pub name: String,
    pub toolset: String,
    pub available: bool,
    pub reason: Option<String>,
    pub platform: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePreviewRequest {
    pub run_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AssistantRiskLevel {
    Read,
    Reversible,
    High,
    Blocked,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantToolPreview {
    pub id: String,
    pub revision: String,
    pub risk: AssistantRiskLevel,
    pub title: String,
    pub target_summary: String,
    pub impact_summary: String,
    pub reversible: bool,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedRoot {
    pub id: String,
    pub label: String,
    pub path: PathBuf,
    pub kind: AuthorizedRootKind,
    pub created_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorizedRootKind {
    Workspace,
    Downloads,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub extension: String,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScan {
    pub root_id: String,
    pub entries: Vec<WorkspaceEntry>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub entries: Vec<WorkspaceEntry>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInspection {
    pub path: String,
    pub excerpt: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileOperationKind {
    Copy,
    Move,
    Rename,
    CreateDirectory,
    Trash,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConflictPolicy {
    Skip,
    Rename,
    Overwrite,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalChoice {
    Once,
    Run,
    Deny,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationRequest {
    pub kind: FileOperationKind,
    pub source: Option<String>,
    pub destination: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPreviewRequest {
    pub run_id: String,
    pub root_id: String,
    pub operations: Vec<FileOperationRequest>,
    pub conflict_policy: ConflictPolicy,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPreview {
    pub preview_id: String,
    pub run_id: String,
    pub root_id: String,
    pub revision: u64,
    pub risk: String,
    pub operation_count: usize,
    pub expires: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalGrant {
    pub token: String,
    pub preview_id: String,
    pub expires: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExecutionRequest {
    pub preview_id: String,
    pub revision: u64,
    pub token: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItemResult {
    pub index: usize,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recoverable: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recovery_receipts: Vec<crate::work_assistant::platform::RecoveryReceipt>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExecutionResult {
    pub completed: Vec<BatchItemResult>,
    pub skipped: Vec<BatchItemResult>,
    pub failed: Vec<BatchItemResult>,
    pub remaining: Vec<BatchItemResult>,
    pub cancelled: bool,
    /// Non-fatal persistence/cleanup failures observed after a file transaction committed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<BatchItemResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantErrorPayload {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

#[derive(Clone, Debug)]
pub struct WorkAssistantError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

impl WorkAssistantError {
    pub fn path_outside_workspace(message: impl Into<String>) -> Self {
        Self {
            code: "path_outside_workspace".into(),
            message: message.into(),
            recoverable: false,
        }
    }

    pub fn blocked(message: impl Into<String>) -> Self {
        Self {
            code: "blocked".into(),
            message: message.into(),
            recoverable: false,
        }
    }

    pub fn protocol(message: impl Into<String>) -> Self {
        Self {
            code: "protocol".into(),
            message: message.into(),
            recoverable: false,
        }
    }

    pub fn stale_preview(message: impl Into<String>) -> Self {
        Self {
            code: "stale_preview".into(),
            message: message.into(),
            recoverable: true,
        }
    }

    /// Cancellation is distinct from a stale filesystem preview: callers can safely retain the
    /// approval audit trail and report unfinished items without treating the operation as a
    /// failed mutation.
    pub fn cancelled(message: impl Into<String>) -> Self {
        Self {
            code: "cancelled".into(),
            message: message.into(),
            recoverable: true,
        }
    }

    /// Internal native no-replace collision.  The rename policy retries this error with the next
    /// bounded suffix; it must never be surfaced as a stale preview.
    pub(crate) fn destination_exists(message: impl Into<String>) -> Self {
        Self {
            code: "destination_exists".into(),
            message: message.into(),
            recoverable: true,
        }
    }

    pub fn partial_transaction(message: impl Into<String>) -> Self {
        Self {
            code: "partial_transaction".into(),
            message: message.into(),
            recoverable: true,
        }
    }
}

impl fmt::Display for WorkAssistantError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for WorkAssistantError {}

impl From<WorkAssistantError> for AssistantErrorPayload {
    fn from(error: WorkAssistantError) -> Self {
        Self {
            code: error.code,
            message: error.message,
            recoverable: error.recoverable,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_payload_preserves_blocked_error_details() {
        let payload: AssistantErrorPayload = WorkAssistantError::blocked("denied").into();

        assert_eq!(payload.code, "blocked");
        assert_eq!(payload.message, "denied");
        assert!(!payload.recoverable);
    }

    #[test]
    fn root_kind_serializes_with_snake_case() {
        assert_eq!(
            serde_json::to_string(&AuthorizedRootKind::Workspace).unwrap(),
            "\"workspace\""
        );
    }

    #[test]
    fn file_operation_contracts_use_camel_case_fields_and_snake_case_variants() {
        let request = FileOperationRequest {
            kind: FileOperationKind::Copy,
            source: Some("draft.txt".into()),
            destination: Some("archive/draft.txt".into()),
        };
        let batch = BatchPreviewRequest {
            run_id: "run-1".into(),
            root_id: "root-1".into(),
            operations: vec![request],
            conflict_policy: ConflictPolicy::Rename,
        };

        let value = serde_json::to_value(&batch).unwrap();
        assert_eq!(value["runId"], "run-1");
        assert_eq!(value["rootId"], "root-1");
        assert_eq!(value["conflictPolicy"], "rename");
        assert_eq!(value["operations"][0]["kind"], "copy");
    }

    #[test]
    fn native_preview_contract_matches_the_frontend_envelope() {
        let request = NativePreviewRequest {
            run_id: "run-1".into(),
            tool_call_id: "call-1".into(),
            tool_name: "file_plan_batch".into(),
            arguments: serde_json::json!({
                "rootId": "root-1",
                "operations": [],
                "conflictPolicy": "skip",
            }),
        };
        let preview = AssistantToolPreview {
            id: "preview-1".into(),
            revision: "42".into(),
            risk: AssistantRiskLevel::Reversible,
            title: "文件操作预览".into(),
            target_summary: "已授权的工作区".into(),
            impact_summary: "1 项文件操作".into(),
            reversible: true,
            expires_at: 1,
        };

        let request_value = serde_json::to_value(request).unwrap();
        let preview_value = serde_json::to_value(preview).unwrap();
        assert_eq!(request_value["toolCallId"], "call-1");
        assert_eq!(preview_value["expiresAt"], 1);
        assert_eq!(preview_value["risk"], "reversible");
    }
}
