use crate::work_assistant::{
    clear_audit_entries_locked, persist_roots, read_audit_entries, AssistantErrorPayload,
    AuditEntry, AuthorizedRoot, AuthorizedRootKind, CapabilityStatus, WorkAssistantError,
    WorkAssistantState,
};
use std::{
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;
use uuid::Uuid;

const MAX_CANCELLED_RUNS: usize = 256;
const MAX_RUN_ID_LENGTH: usize = 128;

pub fn capability_statuses() -> Vec<CapabilityStatus> {
    let platform = std::env::consts::OS.to_string();
    ["root_management", "audit_log", "run_cancellation"]
        .into_iter()
        .map(|name| CapabilityStatus {
            name: name.into(),
            toolset: "work_assistant".into(),
            available: true,
            reason: None,
            platform: platform.clone(),
        })
        .collect()
}

#[tauri::command]
pub fn work_assistant_capabilities() -> Vec<CapabilityStatus> {
    capability_statuses()
}

#[tauri::command]
pub fn work_assistant_list_roots(
    state: State<'_, WorkAssistantState>,
) -> Result<Vec<AuthorizedRoot>, AssistantErrorPayload> {
    state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))
        .map(|roots| roots.clone())
        .map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_add_root(
    state: State<'_, WorkAssistantState>,
    label: String,
    path: String,
    kind: AuthorizedRootKind,
) -> Result<AuthorizedRoot, AssistantErrorPayload> {
    if label.trim().is_empty() {
        return Err(WorkAssistantError::blocked("root label is required").into());
    }

    let root = AuthorizedRoot {
        id: Uuid::new_v4().to_string(),
        label: label.trim().to_string(),
        path: PathBuf::from(path),
        kind,
        created_at: unix_seconds(),
    };
    let mut roots = state
        .roots
        .write()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))
        .map_err(AssistantErrorPayload::from)?;
    roots.push(root.clone());
    if let Err(error) = persist_roots(&state, &roots) {
        roots.pop();
        return Err(error.into());
    }

    Ok(root)
}

#[tauri::command]
pub fn work_assistant_remove_root(
    state: State<'_, WorkAssistantState>,
    id: String,
) -> Result<AuthorizedRoot, AssistantErrorPayload> {
    let mut roots = state
        .roots
        .write()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))
        .map_err(AssistantErrorPayload::from)?;
    let index = roots
        .iter()
        .position(|root| root.id == id)
        .ok_or_else(|| WorkAssistantError::blocked("authorized root was not found"))
        .map_err(AssistantErrorPayload::from)?;
    let root = roots.remove(index);
    if let Err(error) = persist_roots(&state, &roots) {
        roots.insert(index, root.clone());
        return Err(error.into());
    }

    Ok(root)
}

#[tauri::command]
pub fn work_assistant_list_audit(
    state: State<'_, WorkAssistantState>,
) -> Result<Vec<AuditEntry>, AssistantErrorPayload> {
    let _guard = state
        .audit_guard
        .lock()
        .map_err(|_| WorkAssistantError::protocol("audit log lock is unavailable"))
        .map_err(AssistantErrorPayload::from)?;
    read_audit_entries(&state.audit_path).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_clear_audit(
    state: State<'_, WorkAssistantState>,
) -> Result<(), AssistantErrorPayload> {
    clear_audit_entries_locked(&state.audit_guard, &state.audit_path).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_cancel_run(
    state: State<'_, WorkAssistantState>,
    run: String,
) -> Result<(), AssistantErrorPayload> {
    record_cancelled_run(&state, run).map_err(Into::into)
}

fn record_cancelled_run(
    state: &WorkAssistantState,
    run: String,
) -> Result<(), WorkAssistantError> {
    if run.trim().is_empty() {
        return Err(WorkAssistantError::blocked("run id is required"));
    }
    if run.chars().count() > MAX_RUN_ID_LENGTH {
        return Err(WorkAssistantError::blocked("run id exceeds 128 characters"));
    }
    let mut runs = state
        .cancelled_runs
        .lock()
        .map_err(|_| WorkAssistantError::protocol("cancelled runs lock is unavailable"))?;
    if runs.contains(&run) {
        return Ok(());
    }
    if runs.len() >= MAX_CANCELLED_RUNS {
        return Err(WorkAssistantError {
            code: "blocked".into(),
            message: "cancelled run capacity has been reached".into(),
            recoverable: true,
        });
    }
    runs.insert(run);

    Ok(())
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::{HashMap, HashSet},
        sync::{Mutex, RwLock},
    };

    fn test_state() -> WorkAssistantState {
        WorkAssistantState {
            roots: RwLock::new(Vec::new()),
            previews: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            cancelled_runs: Mutex::new(HashSet::new()),
            audit_path: PathBuf::from("unused-audit-path"),
            audit_guard: Mutex::new(()),
        }
    }

    #[test]
    fn capabilities_describe_the_native_broker_without_execution() {
        let capabilities = capability_statuses();

        assert!(capabilities
            .iter()
            .any(|capability| capability.name == "root_management"));
        assert!(capabilities.iter().all(|capability| capability.available));
        assert!(capabilities
            .iter()
            .all(|capability| capability.toolset == "work_assistant"));
    }

    #[test]
    fn cancellation_rejects_blank_and_oversized_run_ids() {
        let state = test_state();

        let blank = record_cancelled_run(&state, " \t\n ".into()).unwrap_err();
        assert_eq!(blank.code, "blocked");

        let oversized = record_cancelled_run(&state, "a".repeat(129)).unwrap_err();
        assert_eq!(oversized.code, "blocked");
    }

    #[test]
    fn cancellation_rejects_new_runs_when_full_without_discarding_existing_ids() {
        let state = test_state();
        for index in 0..256 {
            record_cancelled_run(&state, format!("run-{index}")).unwrap();
        }

        record_cancelled_run(&state, "run-0".into()).unwrap();
        let overflow = record_cancelled_run(&state, "overflow".into()).unwrap_err();

        let runs = state.cancelled_runs.lock().unwrap();
        assert_eq!(runs.len(), 256);
        assert!(runs.contains("run-0"));
        assert!(runs.contains("run-255"));
        assert!(!runs.contains("overflow"));
        assert_eq!(overflow.code, "blocked");
        assert!(overflow.recoverable);
    }
}
