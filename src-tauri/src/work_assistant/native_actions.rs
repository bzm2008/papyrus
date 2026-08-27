//! Native approval-bound actions for desktop application launches and terminal diagnostics.
//!
//! File operations use a richer batch preview protocol.  These two actions are deliberately
//! smaller: their complete, validated payload is stored behind an opaque preview id and only that
//! stored payload can be executed after a one-time approval token is consumed.

use crate::work_assistant::{
    append_audit_entry, bind_application_launch_target, launch_bound_application,
    open_file_from_native, open_url_from_native, reserve_approval_slot, reserve_preview_slot,
    reveal_file_from_native, run_terminal_operation, validate_open_file_from_native,
    validate_open_url, validate_reveal_file_from_native, validate_terminal_operation,
    ApplicationLaunchBinding, ApprovalChoice, ApprovalGrant, AssistantRiskLevel,
    AssistantToolPreview, AuditEntry, StoredApproval, StoredPreview, WorkAssistantError,
    WorkAssistantState,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const PREVIEW_LIFETIME_SECONDS: u64 = 5 * 60;
const APPROVAL_LIFETIME_SECONDS: u64 = 5 * 60;
const MAX_RUN_ID_LENGTH: usize = 128;
const MAX_TOOL_CALL_ID_LENGTH: usize = 160;
const MAX_ROOT_ID_LENGTH: usize = 160;
const MAX_CWD_LENGTH: usize = 512;
const MAX_FILE_PATH_LENGTH: usize = 1_024;
const MAX_URL_LENGTH: usize = 2_048;

const ACTION_DESKTOP_OPEN_APP: &str = "desktop_open_app";
const ACTION_DESKTOP_OPEN_URL: &str = "desktop_open_url";
const ACTION_FILE_OPEN: &str = "file_open";
const ACTION_DESKTOP_REVEAL_FILE: &str = "desktop_reveal_file";
const ACTION_TERMINAL_RUN: &str = "terminal_run";

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredNativeAction {
    #[serde(rename = "nativeAction")]
    action: String,
    arguments: Value,
    #[serde(
        rename = "applicationBinding",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    application_binding: Option<ApplicationLaunchBinding>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeActionExecutionResult {
    pub ok: bool,
    pub action: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recoverable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Create a native preview for an external desktop action. The full arguments stay in native
/// memory only; the frontend receives an opaque id and safe summary.
pub(crate) fn create_native_action_preview(
    state: &WorkAssistantState,
    run_id: String,
    tool_call_id: String,
    tool_name: String,
    arguments: Value,
) -> Result<AssistantToolPreview, WorkAssistantError> {
    validate_identifiers(&run_id, &tool_call_id)?;
    let action = tool_name.trim();
    let mut application_binding = None;
    let (scope, title, target_summary, impact_summary, risk, reversible) = match action {
        ACTION_DESKTOP_OPEN_APP => {
            let app_id = parse_app_id(&arguments)?;
            let binding = bind_application_launch_target(state, app_id)?;
            let label = binding.label.clone();
            application_binding = Some(binding);
            (
                vec![app_id.to_owned()],
                "打开桌面应用".to_owned(),
                format!("已登记的桌面应用：{label}"),
                "将启动已确认的本地应用。".to_owned(),
                AssistantRiskLevel::High,
                false,
            )
        }
        ACTION_DESKTOP_OPEN_URL => {
            let url = parse_url_arguments(&arguments)?;
            validate_open_url(url)?;
            (
                vec!["desktop-url".to_owned()],
                "在默认浏览器打开链接".to_owned(),
                "一条 HTTP(S) 链接".to_owned(),
                "将使用系统默认浏览器打开该链接。".to_owned(),
                AssistantRiskLevel::Reversible,
                true,
            )
        }
        ACTION_FILE_OPEN => {
            let file = parse_root_file_arguments(&arguments, ACTION_FILE_OPEN)?;
            validate_open_file_from_native(state, file.root_id, file.path)?;
            (
                vec![file.root_id.to_owned()],
                "打开已授权文件".to_owned(),
                "已授权工作区中的文件".to_owned(),
                "将使用系统默认应用打开该文件。".to_owned(),
                AssistantRiskLevel::Reversible,
                true,
            )
        }
        ACTION_DESKTOP_REVEAL_FILE => {
            let file = parse_root_file_arguments(&arguments, ACTION_DESKTOP_REVEAL_FILE)?;
            validate_reveal_file_from_native(state, file.root_id, file.path)?;
            (
                vec![file.root_id.to_owned()],
                "在文件管理器中定位文件".to_owned(),
                "已授权工作区中的文件".to_owned(),
                "将打开系统文件管理器并定位该文件。".to_owned(),
                AssistantRiskLevel::Reversible,
                true,
            )
        }
        ACTION_TERMINAL_RUN => {
            let terminal = parse_terminal_arguments(&arguments)?;
            validate_terminal_operation(terminal.operation)?;
            validate_terminal_workspace(state, terminal.root_id, terminal.cwd)?;
            (
                vec![terminal.root_id.to_owned()],
                "运行只读诊断".to_owned(),
                "已授权的工作区".to_owned(),
                "将运行固定的只读诊断，不经过 shell、脚本或自由参数。".to_owned(),
                AssistantRiskLevel::High,
                false,
            )
        }
        _ => {
            return Err(WorkAssistantError::blocked(
                "native previews do not support this desktop action",
            ))
        }
    };

    let payload = serde_json::to_value(StoredNativeAction {
        action: action.to_owned(),
        arguments,
        application_binding,
    })
    .map_err(|_| WorkAssistantError::protocol("native action preview could not be serialized"))?;
    let revision = native_action_revision(&run_id, &tool_call_id, &payload)?;
    let now = unix_seconds();
    let expires = now.saturating_add(PREVIEW_LIFETIME_SECONDS);
    let id = Uuid::new_v4().to_string();
    {
        let mut previews = state
            .previews
            .lock()
            .map_err(|_| WorkAssistantError::protocol("native previews lock is unavailable"))?;
        reserve_preview_slot(&mut previews, now)?;
        previews.insert(
            id.clone(),
            StoredPreview {
                id: id.clone(),
                run: run_id,
                tool_call_id,
                revision,
                risk: risk_label(&risk).to_owned(),
                scope,
                payload,
                expires,
            },
        );
    }
    append_audit_entry(
        state,
        &AuditEntry::new(
            "native_action_preview",
            format!("action={action};preview={id}"),
        ),
    )?;

    Ok(AssistantToolPreview {
        id,
        revision: revision.to_string(),
        risk,
        title,
        target_summary,
        impact_summary,
        reversible,
        expires_at: expires,
    })
}

pub(crate) fn is_native_action_preview(
    state: &WorkAssistantState,
    preview_id: &str,
) -> Result<bool, WorkAssistantError> {
    let preview = stored_preview(state, preview_id)?;
    if preview.payload.get("nativeAction").is_none() {
        return Ok(false);
    }
    parse_stored_action(&preview.payload).map(|_| true)
}

pub(crate) fn approve_native_action_preview(
    state: &WorkAssistantState,
    preview_id: &str,
    run_id: &str,
    choice: ApprovalChoice,
) -> Result<ApprovalGrant, WorkAssistantError> {
    let preview = stored_preview(state, preview_id)?;
    let _action = parse_stored_action(&preview.payload)?;
    if preview.run != run_id {
        return Err(WorkAssistantError::blocked(
            "approval run does not match preview",
        ));
    }
    if preview.expires <= unix_seconds() {
        return Err(WorkAssistantError::stale_preview("preview has expired"));
    }
    if choice != ApprovalChoice::Once {
        return Err(WorkAssistantError::blocked(
            "native desktop actions require a one-time approval",
        ));
    }

    let now = unix_seconds();
    let token = Uuid::new_v4().to_string();
    let grant = ApprovalGrant {
        token: token.clone(),
        preview_id: preview.id.clone(),
        expires: now.saturating_add(APPROVAL_LIFETIME_SECONDS),
    };
    let mut approvals = state
        .approvals
        .lock()
        .map_err(|_| WorkAssistantError::protocol("native approvals lock is unavailable"))?;
    reserve_approval_slot(&mut approvals, now)?;
    if approvals.values().any(|approval| {
        approval.preview == preview.id
            && approval.once
            && approval.used_count == 0
            && approval.expires > now
    }) {
        return Err(WorkAssistantError::blocked(
            "native action is already awaiting one-time approval",
        ));
    }
    approvals.insert(
        token.clone(),
        StoredApproval {
            token,
            preview: preview.id.clone(),
            revision: preview.revision,
            run: preview.run.clone(),
            scope: preview.scope.clone(),
            once: true,
            expires: grant.expires,
            max_count: 1,
            used_count: 0,
        },
    );
    append_audit_entry(
        state,
        &AuditEntry::new(
            "native_action_approval",
            format!("preview={preview_id};choice=once"),
        ),
    )?;
    Ok(grant)
}

/// Consume a one-time token and execute only the immutable native payload stored by preview.
/// Callers never pass an app id, terminal operation, root, cwd, program, or argument here.
pub(crate) async fn execute_native_action(
    state: &WorkAssistantState,
    preview_id: &str,
    approval_token: &str,
) -> Result<NativeActionExecutionResult, WorkAssistantError> {
    let preview = stored_preview(state, preview_id)?;
    if preview.expires <= unix_seconds() {
        return Err(WorkAssistantError::stale_preview("preview has expired"));
    }
    let action = parse_stored_action(&preview.payload)?;
    let current_revision =
        native_action_revision(&preview.run, &preview.tool_call_id, &preview.payload)?;
    if preview.revision != current_revision {
        return Err(WorkAssistantError::stale_preview(
            "native action preview has changed; create a new preview",
        ));
    }
    ensure_native_run_not_cancelled(state, &preview.run)?;
    consume_native_approval(state, approval_token, &preview)?;
    // A cancellation can arrive while the one-time token is being consumed. The token remains
    // spent, but no OS action may be dispatched after the cancellation is observed.
    ensure_native_run_not_cancelled(state, &preview.run)?;

    let result = match action.action.as_str() {
        ACTION_DESKTOP_OPEN_APP => {
            let binding = action.application_binding.as_ref().ok_or_else(|| {
                WorkAssistantError::stale_preview("application preview is missing target binding")
            })?;
            launch_bound_application(state, binding)?;
            NativeActionExecutionResult {
                ok: true,
                action: ACTION_DESKTOP_OPEN_APP.to_owned(),
                summary: "已请求打开应用。".to_owned(),
                error_code: None,
                recoverable: None,
                data: None,
            }
        }
        ACTION_DESKTOP_OPEN_URL => {
            let url = parse_url_arguments(&action.arguments)?;
            open_url_from_native(url)?;
            NativeActionExecutionResult {
                ok: true,
                action: ACTION_DESKTOP_OPEN_URL.to_owned(),
                summary: "已请求在默认浏览器打开链接。".to_owned(),
                error_code: None,
                recoverable: None,
                data: None,
            }
        }
        ACTION_FILE_OPEN => {
            let file = parse_root_file_arguments(&action.arguments, ACTION_FILE_OPEN)?;
            open_file_from_native(state, file.root_id, file.path)?;
            NativeActionExecutionResult {
                ok: true,
                action: ACTION_FILE_OPEN.to_owned(),
                summary: "已请求打开已授权文件。".to_owned(),
                error_code: None,
                recoverable: None,
                data: None,
            }
        }
        ACTION_DESKTOP_REVEAL_FILE => {
            let file = parse_root_file_arguments(&action.arguments, ACTION_DESKTOP_REVEAL_FILE)?;
            reveal_file_from_native(state, file.root_id, file.path)?;
            NativeActionExecutionResult {
                ok: true,
                action: ACTION_DESKTOP_REVEAL_FILE.to_owned(),
                summary: "已请求在文件管理器中定位文件。".to_owned(),
                error_code: None,
                recoverable: None,
                data: None,
            }
        }
        ACTION_TERMINAL_RUN => {
            let terminal = parse_terminal_arguments(&action.arguments)?;
            let terminal_result = run_terminal_operation(
                state,
                &preview.run,
                terminal.operation,
                terminal.root_id,
                terminal.cwd,
            )
            .await?;
            NativeActionExecutionResult {
                ok: terminal_result.exit_code == Some(0),
                action: ACTION_TERMINAL_RUN.to_owned(),
                summary: if terminal_result.exit_code == Some(0) {
                    "只读诊断已完成。".to_owned()
                } else {
                    "只读诊断已完成，但返回了失败退出码。".to_owned()
                },
                error_code: (terminal_result.exit_code != Some(0))
                    .then(|| "terminal_exit".to_owned()),
                recoverable: (terminal_result.exit_code != Some(0)).then_some(true),
                data: Some(serde_json::to_value(terminal_result).map_err(|_| {
                    WorkAssistantError::protocol("terminal result could not be serialized")
                })?),
            }
        }
        _ => {
            return Err(WorkAssistantError::blocked(
                "stored native action is not supported",
            ))
        }
    };
    append_audit_entry(
        state,
        &AuditEntry::new(
            "native_action_execute",
            format!(
                "action={};outcome={}",
                result.action,
                if result.ok { "ok" } else { "exit_nonzero" }
            ),
        ),
    )?;
    Ok(result)
}

fn ensure_native_run_not_cancelled(
    state: &WorkAssistantState,
    run_id: &str,
) -> Result<(), WorkAssistantError> {
    if state
        .cancelled_runs
        .lock()
        .map_err(|_| WorkAssistantError::protocol("cancelled runs lock is unavailable"))?
        .contains(run_id)
    {
        return Err(WorkAssistantError::cancelled(
            "the task was cancelled before execution",
        ));
    }
    Ok(())
}

fn consume_native_approval(
    state: &WorkAssistantState,
    approval_token: &str,
    preview: &StoredPreview,
) -> Result<(), WorkAssistantError> {
    if approval_token.trim().is_empty() {
        return Err(WorkAssistantError::blocked(
            "a native approval token is required",
        ));
    }
    let mut approvals = state
        .approvals
        .lock()
        .map_err(|_| WorkAssistantError::protocol("native approvals lock is unavailable"))?;
    let approval = approvals
        .get(approval_token)
        .cloned()
        .ok_or_else(|| WorkAssistantError::blocked("a valid native approval token is required"))?;
    if approval.token != approval_token
        || approval.preview != preview.id
        || approval.revision != preview.revision
        || approval.run != preview.run
        || approval.scope != preview.scope
        || !approval.once
        || approval.expires <= unix_seconds()
        || approval.used_count != 0
        || approval.max_count != 1
    {
        return Err(WorkAssistantError::blocked(
            "approval token is invalid or has expired",
        ));
    }
    // Remove before execution. A launch or diagnostic cannot be replayed, including after an
    // execution failure, and the token cannot be raced by a second frontend request. The preview
    // itself is also discarded so a fresh approval cannot be minted after the first execution.
    approvals.remove(approval_token);
    drop(approvals);
    let mut previews = state
        .previews
        .lock()
        .map_err(|_| WorkAssistantError::protocol("native previews lock is unavailable"))?;
    previews.remove(&preview.id);
    Ok(())
}

fn stored_preview(
    state: &WorkAssistantState,
    preview_id: &str,
) -> Result<StoredPreview, WorkAssistantError> {
    state
        .previews
        .lock()
        .map_err(|_| WorkAssistantError::protocol("native previews lock is unavailable"))?
        .get(preview_id)
        .cloned()
        .ok_or_else(|| WorkAssistantError::blocked("preview was not found"))
}

fn parse_stored_action(payload: &Value) -> Result<StoredNativeAction, WorkAssistantError> {
    let action: StoredNativeAction = serde_json::from_value(payload.clone())
        .map_err(|_| WorkAssistantError::protocol("stored native action payload is invalid"))?;
    if !matches!(
        action.action.as_str(),
        ACTION_DESKTOP_OPEN_APP
            | ACTION_DESKTOP_OPEN_URL
            | ACTION_FILE_OPEN
            | ACTION_DESKTOP_REVEAL_FILE
            | ACTION_TERMINAL_RUN
    ) {
        return Err(WorkAssistantError::protocol(
            "stored native action payload is not supported",
        ));
    }
    Ok(action)
}

fn risk_label(risk: &AssistantRiskLevel) -> &'static str {
    match risk {
        AssistantRiskLevel::Read => "read",
        AssistantRiskLevel::Reversible => "reversible",
        AssistantRiskLevel::High => "high",
        AssistantRiskLevel::Blocked => "blocked",
    }
}

fn validate_identifiers(run_id: &str, tool_call_id: &str) -> Result<(), WorkAssistantError> {
    if run_id.trim().is_empty()
        || run_id.chars().count() > MAX_RUN_ID_LENGTH
        || tool_call_id.trim().is_empty()
        || tool_call_id.chars().count() > MAX_TOOL_CALL_ID_LENGTH
    {
        return Err(WorkAssistantError::protocol(
            "native action preview requires valid run and tool call ids",
        ));
    }
    Ok(())
}

fn parse_app_id(arguments: &Value) -> Result<&str, WorkAssistantError> {
    let object = arguments.as_object().ok_or_else(|| {
        WorkAssistantError::protocol("desktop_open_app arguments must be an object")
    })?;
    if object.len() != 1 {
        return Err(WorkAssistantError::protocol(
            "desktop_open_app arguments contain unsupported fields",
        ));
    }
    object
        .get("appId")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty() && id.chars().count() <= 160)
        .ok_or_else(|| WorkAssistantError::protocol("desktop_open_app requires an application id"))
}

fn parse_url_arguments(arguments: &Value) -> Result<&str, WorkAssistantError> {
    let object = arguments.as_object().ok_or_else(|| {
        WorkAssistantError::protocol("desktop_open_url arguments must be an object")
    })?;
    if object.len() != 1 {
        return Err(WorkAssistantError::protocol(
            "desktop_open_url arguments contain unsupported fields",
        ));
    }
    object
        .get("url")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.chars().count() <= MAX_URL_LENGTH)
        .ok_or_else(|| WorkAssistantError::protocol("desktop_open_url requires an HTTP(S) URL"))
}

struct RootFileArguments<'a> {
    root_id: &'a str,
    path: &'a str,
}

fn parse_root_file_arguments<'a>(
    arguments: &'a Value,
    action: &str,
) -> Result<RootFileArguments<'a>, WorkAssistantError> {
    let object = arguments.as_object().ok_or_else(|| {
        WorkAssistantError::protocol(format!("{action} arguments must be an object"))
    })?;
    if object.len() != 2 || !object.contains_key("rootId") || !object.contains_key("path") {
        return Err(WorkAssistantError::protocol(format!(
            "{action} arguments contain unsupported fields"
        )));
    }
    let root_id = object
        .get("rootId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.chars().count() <= MAX_ROOT_ID_LENGTH)
        .ok_or_else(|| {
            WorkAssistantError::protocol(format!("{action} requires an authorized root id"))
        })?;
    let path = object
        .get("path")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.trim().is_empty()
                && value.chars().count() <= MAX_FILE_PATH_LENGTH
                && !value.chars().any(char::is_control)
        })
        .ok_or_else(|| {
            WorkAssistantError::protocol(format!("{action} requires a safe relative path"))
        })?;
    Ok(RootFileArguments { root_id, path })
}

struct TerminalArguments<'a> {
    operation: &'a str,
    root_id: &'a str,
    cwd: Option<&'a str>,
}

fn parse_terminal_arguments(
    arguments: &Value,
) -> Result<TerminalArguments<'_>, WorkAssistantError> {
    let object = arguments
        .as_object()
        .ok_or_else(|| WorkAssistantError::protocol("terminal_run arguments must be an object"))?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "operation" | "rootId" | "cwd"))
    {
        return Err(WorkAssistantError::protocol(
            "terminal_run arguments contain unsupported fields",
        ));
    }
    let operation = object
        .get("operation")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.chars().count() <= 64)
        .ok_or_else(|| WorkAssistantError::protocol("terminal_run requires an operation"))?;
    let root_id = object
        .get("rootId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.chars().count() <= MAX_ROOT_ID_LENGTH)
        .ok_or_else(|| {
            WorkAssistantError::protocol("terminal_run requires an authorized root id")
        })?;
    let cwd = match object.get("cwd") {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) if value.chars().count() <= MAX_CWD_LENGTH => {
            Some(value.as_str())
        }
        _ => return Err(WorkAssistantError::protocol("terminal_run cwd is invalid")),
    };
    Ok(TerminalArguments {
        operation,
        root_id,
        cwd,
    })
}

fn validate_terminal_workspace(
    state: &WorkAssistantState,
    root_id: &str,
    cwd: Option<&str>,
) -> Result<(), WorkAssistantError> {
    let roots = state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))?;
    let policy = crate::work_assistant::PathPolicy::new(&roots);
    let cwd = cwd.unwrap_or_default();
    let path = policy
        .resolve_existing(root_id, std::path::Path::new(cwd))
        .map_err(|_| {
            WorkAssistantError::terminal_cwd_invalid(
                "terminal cwd is outside the authorized workspace",
            )
        })?;
    if path.is_dir() {
        Ok(())
    } else {
        Err(WorkAssistantError::terminal_cwd_invalid(
            "terminal cwd is not a directory",
        ))
    }
}

fn native_action_revision(
    run_id: &str,
    tool_call_id: &str,
    payload: &Value,
) -> Result<u64, WorkAssistantError> {
    let serialized = serde_json::to_vec(payload).map_err(|_| {
        WorkAssistantError::protocol("native action payload could not be serialized")
    })?;
    let mut digest = Sha256::new();
    digest.update(run_id.as_bytes());
    digest.update([0]);
    digest.update(tool_call_id.as_bytes());
    digest.update([0]);
    digest.update(serialized);
    let bytes: [u8; 8] = digest.finalize()[..8]
        .try_into()
        .map_err(|_| WorkAssistantError::protocol("native action revision is invalid"))?;
    Ok(u64::from_le_bytes(bytes))
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
    use crate::work_assistant::{
        register_application_from_picker, AuthorizedRoot, AuthorizedRootKind, RegisteredApplication,
    };
    use serde_json::json;
    use std::{
        collections::{HashMap, HashSet},
        fs,
        path::PathBuf,
        sync::{Mutex, RwLock},
    };

    fn test_state(directory: &std::path::Path) -> WorkAssistantState {
        WorkAssistantState {
            roots: RwLock::new(Vec::new()),
            previews: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            cancelled_runs: Mutex::new(HashSet::new()),
            cancelled_execution_audits: Mutex::new(HashSet::new()),
            audit_path: directory.join("audit.jsonl"),
            audit_guard: Mutex::new(()),
        }
    }

    fn directory() -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("papyrus-native-actions-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn add_root(state: &WorkAssistantState, directory: &std::path::Path) {
        state.roots.write().unwrap().push(AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        });
    }

    fn application_test_path(directory: &std::path::Path, stem: &str) -> PathBuf {
        #[cfg(target_os = "macos")]
        {
            return directory.join(format!("{stem}.app"));
        }

        #[cfg(not(target_os = "macos"))]
        directory.join(if cfg!(windows) {
            format!("{stem}.exe")
        } else {
            stem.to_owned()
        })
    }

    fn write_application_test_file(path: &std::path::Path, contents: &[u8]) {
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::fs::PermissionsExt;

            let stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .expect("test application bundle must have a valid name");
            let contents_directory = path.join("Contents");
            let executable = contents_directory.join("MacOS").join(stem);
            fs::create_dir_all(executable.parent().unwrap()).unwrap();
            fs::write(contents_directory.join("Info.plist"), "test metadata").unwrap();
            fs::write(&executable, contents).unwrap();
            let mut permissions = fs::metadata(&executable).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(executable, permissions).unwrap();
            return;
        }

        #[cfg(not(target_os = "macos"))]
        fs::write(path, contents).unwrap();
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).unwrap();
        }
    }

    fn replace_registered_application_target(
        state: &WorkAssistantState,
        application_id: &str,
        target: &std::path::Path,
    ) {
        let registry_path = state
            .audit_path
            .parent()
            .unwrap()
            .join("work-assistant-applications.json");
        let mut registered = serde_json::from_slice::<Vec<RegisteredApplication>>(
            &fs::read(&registry_path).unwrap(),
        )
        .unwrap();
        registered
            .iter_mut()
            .find(|application| application.id == application_id)
            .unwrap()
            .executable_path = fs::canonicalize(target).unwrap();
        fs::write(registry_path, serde_json::to_vec(&registered).unwrap()).unwrap();
    }

    #[test]
    fn terminal_preview_rejects_free_form_command_fields() {
        let directory = directory();
        let state = test_state(&directory);
        add_root(&state, &directory);
        let error = create_native_action_preview(
            &state,
            "run".into(),
            "tool".into(),
            ACTION_TERMINAL_RUN.into(),
            json!({ "program": "git", "args": ["status"], "rootId": "root" }),
        )
        .unwrap_err();
        assert_eq!(error.code, "protocol");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_previews_hold_url_and_file_targets_without_frontend_synthetic_ids() {
        let directory = directory();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("brief.txt"), "brief").unwrap();
        let state = test_state(&directory);
        add_root(&state, &directory);

        let url = create_native_action_preview(
            &state,
            "run".into(),
            "url-tool".into(),
            ACTION_DESKTOP_OPEN_URL.into(),
            json!({ "url": "https://example.com/research" }),
        )
        .unwrap();
        assert_eq!(url.risk, AssistantRiskLevel::Reversible);
        assert!(url.reversible);
        assert_eq!(url.target_summary, "一条 HTTP(S) 链接");

        let file = create_native_action_preview(
            &state,
            "run".into(),
            "file-tool".into(),
            ACTION_FILE_OPEN.into(),
            json!({ "rootId": "root", "path": "brief.txt" }),
        )
        .unwrap();
        assert_eq!(file.risk, AssistantRiskLevel::Reversible);
        assert!(file.reversible);
        assert_eq!(file.target_summary, "已授权工作区中的文件");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn application_preview_shows_the_registered_name_without_exposing_its_path() {
        let directory = directory();
        let state = test_state(&directory);
        let executable = application_test_path(&directory, "editor");
        write_application_test_file(&executable, b"editor program");
        let application =
            register_application_from_picker(&state, "Editor".into(), &executable).unwrap();

        let preview = create_native_action_preview(
            &state,
            "run".into(),
            "open-editor".into(),
            ACTION_DESKTOP_OPEN_APP.into(),
            json!({ "appId": application.id }),
        )
        .unwrap();

        assert!(preview.target_summary.contains("Editor"));
        assert!(!preview
            .target_summary
            .contains(&executable.to_string_lossy().to_string()));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn file_preview_payload_is_not_misclassified_as_a_native_action() {
        let directory = directory();
        let state = test_state(&directory);
        state.previews.lock().unwrap().insert(
            "file-preview".into(),
            StoredPreview {
                id: "file-preview".into(),
                run: "run".into(),
                tool_call_id: "tool".into(),
                revision: 1,
                risk: "reversible".into(),
                scope: vec!["root".into()],
                payload: json!({ "rootId": "root", "operations": [] }),
                expires: unix_seconds() + 60,
            },
        );
        assert!(!is_native_action_preview(&state, "file-preview").unwrap());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn approval_is_bound_to_run_and_is_one_time() {
        let directory = directory();
        let state = test_state(&directory);
        add_root(&state, &directory);
        let preview = create_native_action_preview(
            &state,
            "run".into(),
            "tool".into(),
            ACTION_TERMINAL_RUN.into(),
            json!({ "operation": "whoami", "rootId": "root" }),
        )
        .unwrap();
        assert!(
            approve_native_action_preview(&state, &preview.id, "other", ApprovalChoice::Once)
                .is_err()
        );
        assert!(
            approve_native_action_preview(&state, &preview.id, "run", ApprovalChoice::Run).is_err()
        );
        let grant = approve_native_action_preview(&state, &preview.id, "run", ApprovalChoice::Once)
            .unwrap();
        assert!(
            approve_native_action_preview(&state, &preview.id, "run", ApprovalChoice::Once)
                .is_err()
        );
        let stored = stored_preview(&state, &preview.id).unwrap();
        consume_native_approval(&state, &grant.token, &stored).unwrap();
        assert!(consume_native_approval(&state, &grant.token, &stored).is_err());
        assert!(
            approve_native_action_preview(&state, &preview.id, "run", ApprovalChoice::Once)
                .is_err()
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn expired_preview_and_token_are_rejected_without_execution() {
        let directory = directory();
        let state = test_state(&directory);
        add_root(&state, &directory);
        let preview = create_native_action_preview(
            &state,
            "run".into(),
            "tool".into(),
            ACTION_TERMINAL_RUN.into(),
            json!({ "operation": "whoami", "rootId": "root" }),
        )
        .unwrap();
        state
            .previews
            .lock()
            .unwrap()
            .get_mut(&preview.id)
            .unwrap()
            .expires = 0;
        assert!(
            approve_native_action_preview(&state, &preview.id, "run", ApprovalChoice::Once)
                .is_err()
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_approval_refuses_full_state_without_evicting_unexpired_grants() {
        const MAX_PENDING_APPROVALS: usize = 256;

        let directory = directory();
        let state = test_state(&directory);
        add_root(&state, &directory);
        let preview = create_native_action_preview(
            &state,
            "run".into(),
            "tool".into(),
            ACTION_TERMINAL_RUN.into(),
            json!({ "operation": "whoami", "rootId": "root" }),
        )
        .unwrap();
        let now = unix_seconds();
        let preserved_token = "valid-approval-0".to_owned();
        {
            let mut approvals = state.approvals.lock().unwrap();
            for index in 0..MAX_PENDING_APPROVALS {
                let token = format!("valid-approval-{index}");
                approvals.insert(
                    token.clone(),
                    StoredApproval {
                        token,
                        preview: format!("existing-preview-{index}"),
                        revision: index as u64,
                        run: "existing-run".into(),
                        scope: vec!["root".into()],
                        once: true,
                        expires: now.saturating_add(60),
                        max_count: 1,
                        used_count: 0,
                    },
                );
            }
        }

        let error = approve_native_action_preview(&state, &preview.id, "run", ApprovalChoice::Once)
            .unwrap_err();
        assert_eq!(error.code, "blocked");
        let approvals = state.approvals.lock().unwrap();
        assert_eq!(approvals.len(), MAX_PENDING_APPROVALS);
        assert!(approvals.contains_key(&preserved_token));

        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn stored_parameter_mutation_invalidates_the_preview_before_execution() {
        let directory = directory();
        let state = test_state(&directory);
        add_root(&state, &directory);
        let preview = create_native_action_preview(
            &state,
            "run".into(),
            "tool".into(),
            ACTION_TERMINAL_RUN.into(),
            json!({ "operation": "whoami", "rootId": "root" }),
        )
        .unwrap();
        let grant = approve_native_action_preview(&state, &preview.id, "run", ApprovalChoice::Once)
            .unwrap();
        state
            .previews
            .lock()
            .unwrap()
            .get_mut(&preview.id)
            .unwrap()
            .payload = json!({
            "nativeAction": "terminal_run",
            "arguments": { "operation": "system_info", "rootId": "root" }
        });
        let error = execute_native_action(&state, &preview.id, &grant.token)
            .await
            .unwrap_err();
        assert_eq!(error.code, "stale_preview");
        // Token remains untouched because execution rejects the altered preview before it can
        // consume a grant or spawn anything.
        assert!(state.approvals.lock().unwrap().contains_key(&grant.token));
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(not(target_os = "macos"))]
    #[tokio::test]
    async fn application_replacement_after_preview_is_stale_and_never_launches() {
        let directory = directory();
        let state = test_state(&directory);
        let executable = application_test_path(&directory, "editor");
        let original = b"original program";
        let replacement = b"changed program!";
        assert_eq!(original.len(), replacement.len());
        write_application_test_file(&executable, original);
        let application =
            register_application_from_picker(&state, "Editor".into(), &executable).unwrap();
        let preview = create_native_action_preview(
            &state,
            "run".into(),
            "open-editor".into(),
            ACTION_DESKTOP_OPEN_APP.into(),
            json!({ "appId": application.id }),
        )
        .unwrap();
        let grant = approve_native_action_preview(&state, &preview.id, "run", ApprovalChoice::Once)
            .unwrap();

        write_application_test_file(&executable, replacement);

        let error = execute_native_action(&state, &preview.id, &grant.token)
            .await
            .unwrap_err();
        assert_eq!(error.code, "stale_preview");
        let audit = fs::read_to_string(directory.join("audit.jsonl")).unwrap_or_default();
        assert!(!audit.contains("application_launch"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(not(target_os = "macos"))]
    #[tokio::test]
    async fn application_target_drift_after_preview_is_stale_and_never_launches() {
        let directory = directory();
        let state = test_state(&directory);
        let first = application_test_path(&directory, "editor-a");
        let second = application_test_path(&directory, "editor-b");
        write_application_test_file(&first, b"first program");
        write_application_test_file(&second, b"second program");
        let application =
            register_application_from_picker(&state, "Editor".into(), &first).unwrap();
        let preview = create_native_action_preview(
            &state,
            "run".into(),
            "open-editor".into(),
            ACTION_DESKTOP_OPEN_APP.into(),
            json!({ "appId": application.id }),
        )
        .unwrap();
        let grant = approve_native_action_preview(&state, &preview.id, "run", ApprovalChoice::Once)
            .unwrap();

        replace_registered_application_target(&state, &application.id, &second);

        let error = execute_native_action(&state, &preview.id, &grant.token)
            .await
            .unwrap_err();
        assert_eq!(error.code, "stale_preview");
        let audit = fs::read_to_string(directory.join("audit.jsonl")).unwrap_or_default();
        assert!(!audit.contains("application_launch"));
        fs::remove_dir_all(directory).unwrap();
    }
}
