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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExecutionResult {
    pub completed: Vec<BatchItemResult>,
    pub skipped: Vec<BatchItemResult>,
    pub failed: Vec<BatchItemResult>,
    pub remaining: Vec<BatchItemResult>,
    pub cancelled: bool,
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
}
