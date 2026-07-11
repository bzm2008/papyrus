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
}
