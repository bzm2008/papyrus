use crate::work_assistant::{
    clear_audit_entries, persist_roots, read_audit_entries_page, validate_authorized_root,
    AssistantErrorPayload, AuditEntry, AuthorizedRoot, AuthorizedRootKind, CapabilityStatus,
    WorkAssistantError, WorkAssistantState,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use uuid::Uuid;

const MAX_CANCELLED_RUNS: usize = 256;
const MAX_RUN_ID_LENGTH: usize = 128;

pub fn capability_statuses() -> Vec<CapabilityStatus> {
    let platform = std::env::consts::OS.to_string();
    let mut capabilities: Vec<_> = ["root_management", "audit_log", "run_cancellation"]
        .into_iter()
        .map(|name| CapabilityStatus {
            name: name.into(),
            toolset: "workspace".into(),
            available: true,
            reason: None,
            platform: platform.clone(),
        })
        .collect();
    capabilities.extend(file_operation_capabilities(&platform));
    capabilities.extend(desktop_capabilities(&platform));
    capabilities.extend(browser_capabilities(&platform, false));
    capabilities
}

fn browser_capabilities(platform: &str, paired: bool) -> Vec<CapabilityStatus> {
    let reason = if paired {
        None
    } else {
        Some("先在设置中启动并配对 Browser Bridge 当前标签页")
    };
    [
        "browser_bridge",
        "web_extract",
        "web_archive",
        "browser_open",
        "browser_snapshot",
        "browser_fill_draft",
        "browser_click",
        "browser_download",
        "browser_submit",
    ]
    .into_iter()
    .map(|name| {
        let web_only = matches!(name, "web_extract" | "web_archive");
        CapabilityStatus {
            name: name.into(),
            toolset: "browser".into(),
            available: paired || web_only,
            reason: if paired || web_only {
                None
            } else {
                reason.map(str::to_owned)
            },
            platform: platform.into(),
        }
    })
    .collect()
}

fn desktop_capabilities(platform: &str) -> Vec<CapabilityStatus> {
    let capability = |name: &str, available: bool, reason: Option<&str>| CapabilityStatus {
        name: name.into(),
        toolset: "desktop".into(),
        available,
        reason: reason.map(str::to_owned),
        platform: platform.into(),
    };
    let supported = cfg!(any(windows, target_os = "linux", target_os = "macos"));
    vec![
        capability(
            "desktop_status",
            supported,
            (!supported).then_some("desktop status is unavailable on this platform"),
        ),
        capability(
            "desktop_open_url",
            supported,
            (!supported).then_some("external URL opening is unavailable on this platform"),
        ),
        capability(
            "desktop_open_file",
            supported,
            (!supported).then_some("controlled file opening is unavailable on this platform"),
        ),
        capability(
            "desktop_reveal_file",
            supported,
            (!supported).then_some("file reveal is unavailable on this platform"),
        ),
        capability(
            "desktop_open_app",
            supported,
            (!supported).then_some("application aliases are unavailable on this platform"),
        ),
    ]
}

fn file_operation_capabilities(platform: &str) -> Vec<CapabilityStatus> {
    let capability = |name: &str, available: bool, reason: Option<&str>| CapabilityStatus {
        name: name.into(),
        toolset: "workspace".into(),
        available,
        reason: reason.map(str::to_owned),
        platform: platform.into(),
    };

    let (copy_available, create_directory_available, unavailable_reason) =
        if cfg!(any(windows, target_os = "linux", target_os = "macos")) {
            (true, true, None)
        } else {
            (
                false,
                false,
                Some("secure destination operations are not available on this platform"),
            )
        };

    let capabilities = vec![
        capability("file_copy", copy_available, unavailable_reason),
        capability(
            "file_create_directory",
            create_directory_available,
            unavailable_reason,
        ),
        capability(
            "file_trash",
            copy_available,
            if copy_available {
                Some("moves regular files into Papyrus private same-volume recovery storage")
            } else {
                unavailable_reason
            },
        ),
        capability(
            "file_overwrite",
            copy_available,
            if copy_available {
                Some("recovers the existing destination before publishing replacement content")
            } else {
                unavailable_reason
            },
        ),
        capability(
            "file_move",
            copy_available,
            if copy_available {
                Some("same-volume uses native no-replace rename; cross-volume uses copy -> publish -> recovery; unavailable kernel primitives fail closed")
            } else {
                unavailable_reason
            },
        ),
        capability(
            "file_rename",
            copy_available,
            if copy_available {
                Some("uses the native no-replace rename primitive; unavailable kernel primitives fail closed")
            } else {
                unavailable_reason
            },
        ),
    ];

    capabilities
}

#[tauri::command]
pub fn work_assistant_capabilities(
    browser: State<'_, crate::work_assistant::browser_bridge::BrowserBridgeState>,
) -> Vec<CapabilityStatus> {
    let mut capabilities = capability_statuses();
    let paired = browser_bridge_is_paired(&browser);
    for capability in capabilities
        .iter_mut()
        .filter(|item| item.toolset == "browser")
    {
        let web_only = matches!(capability.name.as_str(), "web_extract" | "web_archive");
        capability.available = paired || web_only;
        capability.reason = if paired || web_only {
            None
        } else {
            Some("先在设置中启动并配对 Browser Bridge 当前标签页".into())
        };
    }
    capabilities
}

fn browser_bridge_is_paired(
    state: &crate::work_assistant::browser_bridge::BrowserBridgeState,
) -> bool {
    state.status().paired
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

    let mut roots = state
        .roots
        .write()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))
        .map_err(AssistantErrorPayload::from)?;
    let canonical_path =
        validate_authorized_root(&path, &roots).map_err(AssistantErrorPayload::from)?;
    let root = AuthorizedRoot {
        id: Uuid::new_v4().to_string(),
        label: label.trim().to_string(),
        path: canonical_path,
        kind,
        created_at: unix_seconds(),
    };
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
    drop(roots);
    invalidate_previews_for_root(&state, &id).map_err(AssistantErrorPayload::from)?;

    Ok(root)
}

fn invalidate_previews_for_root(
    state: &WorkAssistantState,
    root_id: &str,
) -> Result<(), WorkAssistantError> {
    let mut previews = state
        .previews
        .lock()
        .map_err(|_| WorkAssistantError::protocol("workspace previews lock is unavailable"))?;
    previews.retain(|_, preview| {
        !preview.scope.iter().any(|scope| scope == root_id)
            && crate::work_assistant::scope_root_id(&preview.scope).as_deref() != Some(root_id)
            && preview
                .payload
                .get("rootId")
                .and_then(|value| value.as_str())
                != Some(root_id)
    });
    Ok(())
}

#[tauri::command]
pub fn work_assistant_list_audit(
    state: State<'_, WorkAssistantState>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<AuditEntry>, AssistantErrorPayload> {
    let _guard = state
        .audit_guard
        .lock()
        .map_err(|_| WorkAssistantError::protocol("audit log lock is unavailable"))
        .map_err(AssistantErrorPayload::from)?;
    read_audit_entries_page(
        &state.audit_path,
        offset.unwrap_or(0),
        limit
            .map(crate::work_assistant::audit_page_limit)
            .unwrap_or(50),
    )
    .map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_clear_audit(
    state: State<'_, WorkAssistantState>,
) -> Result<(), AssistantErrorPayload> {
    clear_audit_entries(&state).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_cancel_run(
    state: State<'_, WorkAssistantState>,
    run: String,
) -> Result<(), AssistantErrorPayload> {
    record_cancelled_run(&state, run).map_err(Into::into)
}

fn record_cancelled_run(state: &WorkAssistantState, run: String) -> Result<(), WorkAssistantError> {
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
    if !runs.contains(&run) && runs.len() >= MAX_CANCELLED_RUNS {
        return Err(WorkAssistantError {
            code: "blocked".into(),
            message: "cancelled run capacity has been reached".into(),
            recoverable: true,
        });
    }
    runs.insert(run.clone());
    drop(runs);

    // A run-scoped approval is valid only for the live run. Cancellation must
    // invalidate it even when the native executor has not observed the cancel
    // flag yet.
    state
        .approvals
        .lock()
        .map_err(|_| WorkAssistantError::protocol("workspace approvals lock is unavailable"))?
        .retain(|_, approval| approval.run != run);

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
    use crate::work_assistant::StoredApproval;
    use std::{
        collections::{HashMap, HashSet},
        path::PathBuf,
        sync::{Mutex, RwLock},
    };

    fn test_state() -> WorkAssistantState {
        WorkAssistantState {
            roots: RwLock::new(Vec::new()),
            previews: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            cancelled_runs: Mutex::new(HashSet::new()),
            cancelled_execution_audits: Mutex::new(HashSet::new()),
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
        assert!(capabilities
            .iter()
            .filter(|capability| capability.name == "root_management")
            .all(|capability| capability.available));
        assert!(capabilities.iter().all(|capability| {
            matches!(
                capability.toolset.as_str(),
                "workspace" | "desktop" | "browser" | "project"
            )
        }));
        for name in ["root_management", "audit_log", "run_cancellation"] {
            assert_eq!(
                capabilities
                    .iter()
                    .find(|capability| capability.name == name)
                    .unwrap()
                    .toolset,
                "workspace"
            );
        }
    }

    #[test]
    fn file_operation_capabilities_explicitly_describe_current_platform_limits() {
        let capabilities = capability_statuses();
        let capability = |name: &str| {
            capabilities
                .iter()
                .find(|candidate| candidate.name == name)
                .unwrap_or_else(|| panic!("missing capability {name}"))
        };

        assert!(capability("file_copy").available);
        assert!(capability("file_create_directory").available);
        assert!(capability("file_trash").available);
        assert!(capability("file_overwrite").available);
        assert!(capability("file_trash").reason.is_some());
        assert!(capability("file_overwrite").reason.is_some());

        assert!(capability("file_move").available);
        assert!(capability("file_rename").available);
        assert!(capability("file_move")
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("cross-volume")));
        assert!(capability("file_rename")
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("no-replace")));
        assert!(capability("file_move")
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("fail closed")));
        assert!(capability("file_rename")
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("fail closed")));
    }

    #[test]
    fn desktop_capabilities_are_explicit_and_use_the_desktop_toolset() {
        let capabilities = capability_statuses();
        for name in [
            "desktop_status",
            "desktop_open_url",
            "desktop_open_file",
            "desktop_reveal_file",
            "desktop_open_app",
        ] {
            let capability = capabilities
                .iter()
                .find(|candidate| candidate.name == name)
                .unwrap_or_else(|| panic!("missing capability {name}"));
            assert_eq!(capability.toolset, "desktop");
            assert!(capability.available);
        }
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
    fn cancellation_invalidates_run_scoped_approvals() {
        let state = test_state();
        state.approvals.lock().unwrap().insert(
            "token-run".into(),
            StoredApproval {
                token: "token-run".into(),
                preview: "preview".into(),
                revision: 1,
                run: "cancel-me".into(),
                scope: vec!["root".into()],
                once: false,
                run_scoped: true,
                expires: u64::MAX,
                max_count: 100,
                used_count: 0,
            },
        );

        record_cancelled_run(&state, "cancel-me".into()).unwrap();

        assert!(state.approvals.lock().unwrap().is_empty());
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

    #[test]
    fn invalidating_a_root_preview_leaves_other_root_previews_intact() {
        let state = test_state();
        let preview = |scope: &str| crate::work_assistant::StoredPreview {
            id: format!("preview-{scope}"),
            run: "run".into(),
            tool_call_id: String::new(),
            revision: 1,
            risk: "read".into(),
            scope: vec![scope.into()],
            payload: serde_json::json!({ "rootId": scope }),
            expires: 1,
        };
        let mut previews = state.previews.lock().unwrap();
        previews.insert("a".into(), preview("root-a"));
        previews.insert("b".into(), preview("root-b"));
        drop(previews);

        invalidate_previews_for_root(&state, "root-a").unwrap();

        let previews = state.previews.lock().unwrap();
        assert!(!previews.contains_key("a"));
        assert!(previews.contains_key("b"));
    }
}
