//! Cross-platform, non-shell terminal execution for the work assistant.
//!
//! The model can select an allowlisted program and structured arguments, but it
//! cannot provide a shell string, executable path, environment, or stdin. Every
//! invocation is scoped to an authorized workspace and is bounded by time and
//! output limits.

use crate::work_assistant::{
    append_audit_entry, path_is_within, AssistantErrorPayload, AuditEntry, PathPolicy,
    WorkAssistantError, WorkAssistantState,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Instant,
};
use tauri::State;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    time::{timeout, Duration},
};

const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_TOTAL_OUTPUT_BYTES: usize = MAX_OUTPUT_BYTES * 2;
const TERMINAL_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRunResult {
    pub program: String,
    pub exit_code: Option<i32>,
    pub diagnostic: TerminalDiagnostic,
    pub truncated: bool,
    pub duration_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDiagnostic {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_changes: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged_files: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unstaged_files: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub untracked_files: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_changed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines_added: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines_deleted: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_files: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_commit_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_limit_reached: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attached_branch: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub stderr_present: bool,
}

#[derive(Clone, Debug)]
struct CommandSpec {
    executable: PathBuf,
    args: Vec<String>,
}

#[tauri::command]
pub async fn work_assistant_terminal_run(
    _state: State<'_, WorkAssistantState>,
    _operation: Option<String>,
    _program: Option<String>,
    _args: Option<Vec<String>>,
    _root_id: String,
    _cwd: Option<String>,
) -> Result<TerminalRunResult, AssistantErrorPayload> {
    Err(WorkAssistantError::blocked(
        "terminal execution requires a native preview and one-time approval token",
    )
    .into())
}

/// Runs one fixed diagnostic operation. It is used by the Tauri wrapper and by the native action
/// executor after it has consumed a one-time approval bound to a stored preview.
pub(crate) async fn run_terminal_operation(
    state: &WorkAssistantState,
    run_id: &str,
    operation_name: &str,
    root_id: &str,
    cwd: Option<&str>,
) -> Result<TerminalRunResult, WorkAssistantError> {
    if terminal_run_cancelled(state, run_id)? {
        return Err(WorkAssistantError::cancelled(
            "the task was cancelled before terminal execution",
        ));
    }
    let roots = state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))?
        .clone();
    let policy = PathPolicy::new(&roots);
    let requested_cwd = cwd.unwrap_or_default();
    let working_directory = policy
        .resolve_existing(root_id, Path::new(requested_cwd))
        .map_err(|_| {
            WorkAssistantError::terminal_cwd_invalid(
                "terminal cwd is outside the authorized workspace",
            )
        })?;
    if !working_directory.is_dir() {
        return Err(WorkAssistantError::terminal_cwd_invalid(
            "terminal cwd is not a directory",
        ));
    }

    let spec = command_spec_for_operation(operation_name)?;
    if operation_name.starts_with("git_") {
        let root_path = roots
            .iter()
            .find(|root| root.id == root_id)
            .map(|root| root.path.clone())
            .ok_or_else(|| {
                WorkAssistantError::terminal_cwd_invalid("authorized workspace root was not found")
            })?;
        validate_git_workspace_boundary(&root_path, &working_directory)?;
    }
    let latest_working_directory = policy
        .resolve_existing(root_id, Path::new(requested_cwd))
        .map_err(|_| {
            WorkAssistantError::terminal_cwd_invalid(
                "terminal cwd changed outside the authorized workspace",
            )
        })?;
    if !path_is_within(&working_directory, &latest_working_directory)
        || !path_is_within(&latest_working_directory, &working_directory)
    {
        return Err(WorkAssistantError::terminal_cwd_invalid(
            "terminal cwd changed before execution",
        ));
    }
    let executable = resolve_operation_executable(operation_name)?;
    let started = Instant::now();
    let mut child = Command::new(&executable);
    child
        .args(&spec.args)
        .current_dir(&working_directory)
        .env_clear()
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", null_config_path())
        .env("GIT_CONFIG_SYSTEM", null_config_path())
        .env("GIT_EXTERNAL_DIFF", null_config_path())
        .env("GIT_SSH_COMMAND", disabled_helper_command())
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if operation_name.starts_with("git_") {
        if let Some(root) = roots.iter().find(|root| root.id == root_id) {
            if let Ok(root_path) = fs::canonicalize(&root.path) {
                // Stop Git discovery at the authorized root.  This prevents a repository or
                // configuration above the selected workspace from influencing diagnostics.
                child.env("GIT_CEILING_DIRECTORIES", root_path);
            }
        }
    }
    if terminal_run_cancelled(state, run_id)? {
        return Err(WorkAssistantError::cancelled(
            "the task was cancelled before terminal execution",
        ));
    }
    let mut child = child.spawn().map_err(|error| {
        WorkAssistantError::terminal_failed(format!(
            "could not start allowlisted terminal program: {error}"
        ))
    })?;

    let stdout_task = child
        .stdout
        .take()
        .map(|stdout| tokio::spawn(read_limited(stdout, MAX_OUTPUT_BYTES)));
    let stderr_task = child
        .stderr
        .take()
        .map(|stderr| tokio::spawn(read_limited(stderr, MAX_OUTPUT_BYTES)));
    let wait_result = {
        let wait = timeout(TERMINAL_TIMEOUT, child.wait());
        tokio::pin!(wait);
        tokio::select! {
            result = &mut wait => Some(result),
            _ = terminal_cancellation_wait(state, run_id) => None,
        }
    };
    let status = match wait_result {
        Some(Ok(result)) => result.map_err(|error| {
            WorkAssistantError::terminal_failed(format!("terminal process failed: {error}"))
        })?,
        Some(Err(_)) => {
            let _ = child.kill().await;
            return Err(WorkAssistantError::terminal_timeout(
                "terminal command exceeded the 60 second limit",
            )
            .into());
        }
        None => {
            let _ = child.kill().await;
            return Err(WorkAssistantError::cancelled(
                "the task was cancelled while the terminal diagnostic was running",
            ));
        }
    };

    let (stdout, stdout_truncated) = join_output_native(stdout_task).await?;
    let (stderr, stderr_truncated) = join_output_native(stderr_task).await?;
    let total_truncated = stdout_truncated
        || stderr_truncated
        || stdout.len() + stderr.len() > MAX_TOTAL_OUTPUT_BYTES;
    let result = TerminalRunResult {
        program: operation_name.trim().to_owned(),
        exit_code: status.code(),
        diagnostic: summarize_terminal_output(operation_name, &stdout, &stderr),
        truncated: total_truncated,
        duration_ms: started.elapsed().as_millis(),
    };

    let audit_detail = format!(
        "operation={};root={};cwd_relative={};exit={};truncated={}",
        result.program,
        root_id,
        !requested_cwd.is_empty(),
        result
            .exit_code
            .map_or_else(|| "signal".into(), |code| code.to_string()),
        result.truncated,
    );
    append_audit_entry(state, &AuditEntry::new("terminal_run", audit_detail))?;
    Ok(result)
}

fn terminal_run_cancelled(
    state: &WorkAssistantState,
    run_id: &str,
) -> Result<bool, WorkAssistantError> {
    state
        .cancelled_runs
        .lock()
        .map_err(|_| WorkAssistantError::protocol("cancelled runs lock is unavailable"))
        .map(|runs| runs.contains(run_id))
}

async fn terminal_cancellation_wait(state: &WorkAssistantState, run_id: &str) {
    loop {
        if terminal_run_cancelled(state, run_id).unwrap_or(true) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn read_limited<R: AsyncRead + Unpin>(mut reader: R, limit: usize) -> (Vec<u8>, bool) {
    let mut output = Vec::with_capacity(limit.min(4096));
    let mut buffer = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(size) => {
                let remaining = limit.saturating_sub(output.len());
                if remaining > 0 {
                    output.extend_from_slice(&buffer[..size.min(remaining)]);
                }
                if size > remaining {
                    truncated = true;
                }
            }
            Err(_) => {
                truncated = true;
                break;
            }
        }
    }
    (output, truncated)
}

async fn join_output_native(
    task: Option<tokio::task::JoinHandle<(Vec<u8>, bool)>>,
) -> Result<(Vec<u8>, bool), WorkAssistantError> {
    match task {
        Some(task) => task
            .await
            .map_err(|_| WorkAssistantError::terminal_failed("terminal output reader failed")),
        None => Ok((Vec::new(), false)),
    }
}

fn command_spec(program: &str, args: &[String]) -> Result<CommandSpec, WorkAssistantError> {
    let _ = (program, args);
    Err(WorkAssistantError::terminal_program_not_allowed(
        "free-form terminal programs and arguments are disabled; choose a diagnostic operation",
    ))
}

fn command_spec_for_operation(operation: &str) -> Result<CommandSpec, WorkAssistantError> {
    let (executable, args) = match operation {
        "git_status" => (
            git_executable_hint(),
            git_diagnostic_args(vec!["status".into(), "--porcelain=v1".into(), "-z".into()]),
        ),
        "git_diff_stat" => (
            git_executable_hint(),
            git_diagnostic_args(vec![
                "diff".into(),
                "--no-ext-diff".into(),
                "--no-textconv".into(),
                "--numstat".into(),
                "-z".into(),
                "--no-renames".into(),
            ]),
        ),
        "git_branch" => (
            git_executable_hint(),
            git_diagnostic_args(vec!["branch".into(), "--show-current".into()]),
        ),
        "git_log" => (
            git_executable_hint(),
            git_diagnostic_args(vec![
                "rev-list".into(),
                "--count".into(),
                "--max-count=100".into(),
                "HEAD".into(),
            ]),
        ),
        "git_version" => (
            git_executable_hint(),
            git_diagnostic_args(vec!["--version".into()]),
        ),
        "system_info" => (system_info_executable_hint(), system_info_args()),
        "whoami" => (whoami_executable_hint(), Vec::new()),
        _ => {
            return Err(WorkAssistantError::terminal_program_not_allowed(
                "terminal operation is not allowlisted",
            ))
        }
    };
    Ok(CommandSpec { executable, args })
}

fn git_diagnostic_args(command: Vec<String>) -> Vec<String> {
    let mut args = vec![
        "--no-pager".into(),
        "-c".into(),
        "core.fsmonitor=false".into(),
        "-c".into(),
        "core.worktree=.".into(),
        "-c".into(),
        "diff.external=".into(),
        "-c".into(),
        "core.pager=cat".into(),
    ];
    args.extend(command);
    args
}

pub(crate) fn validate_terminal_operation(operation: &str) -> Result<(), WorkAssistantError> {
    command_spec_for_operation(operation).map(|_| ())
}

fn git_executable_hint() -> PathBuf {
    git_candidates()
        .into_iter()
        .next()
        .unwrap_or_else(|| PathBuf::from("/usr/bin/git"))
}

fn resolve_operation_executable(operation: &str) -> Result<PathBuf, WorkAssistantError> {
    let path = match operation {
        "git_status" | "git_diff_stat" | "git_branch" | "git_log" | "git_version" => {
            resolve_git_executable()?
        }
        "system_info" => resolve_fixed_executable(system_info_candidates())?,
        "whoami" => resolve_fixed_executable(whoami_candidates())?,
        _ => {
            return Err(WorkAssistantError::terminal_program_not_allowed(
                "terminal operation is not allowlisted",
            ))
        }
    };
    Ok(path)
}

fn resolve_git_executable() -> Result<PathBuf, WorkAssistantError> {
    let candidates = git_candidates();
    resolve_fixed_executable(candidates)
}

fn resolve_fixed_executable(candidates: Vec<PathBuf>) -> Result<PathBuf, WorkAssistantError> {
    for path in candidates {
        let _metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => continue,
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if _metadata.permissions().mode() & 0o111 == 0 {
                continue;
            }
        }
        let canonical = fs::canonicalize(&path).map_err(|error| {
            WorkAssistantError::terminal_program_not_allowed(format!(
                "trusted terminal executable could not be verified: {error}"
            ))
        })?;
        if !canonical.is_file() {
            continue;
        }
        if !trusted_executable_path(&canonical) {
            return Err(WorkAssistantError::terminal_program_not_allowed(
                "terminal executable is outside a trusted system directory",
            ));
        }
        return Ok(canonical);
    }
    Err(WorkAssistantError::terminal_program_not_allowed(
        "没有找到受信任的系统程序，请先安装 Git 或系统诊断工具",
    ))
}

fn git_candidates() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut paths = Vec::new();
        for root in [
            Some(std::ffi::OsString::from(r"C:\Program Files")),
            Some(std::ffi::OsString::from(r"C:\Program Files (x86)")),
        ] {
            if let Some(root) = root {
                paths.push(PathBuf::from(root.clone()).join("Git\\cmd\\git.exe"));
                paths.push(PathBuf::from(root).join("Git\\bin\\git.exe"));
            }
        }
        return paths;
    }
    #[cfg(target_os = "macos")]
    {
        return vec![PathBuf::from("/usr/bin/git"), PathBuf::from("/bin/git")];
    }
    #[cfg(target_os = "linux")]
    {
        return vec![
            PathBuf::from("/usr/bin/git"),
            PathBuf::from("/bin/git"),
            PathBuf::from("/usr/lib/git-core/git"),
        ];
    }
    #[allow(unreachable_code)]
    Vec::new()
}

fn system_info_executable_hint() -> PathBuf {
    #[cfg(windows)]
    {
        return PathBuf::from(r"C:\Windows\System32\systeminfo.exe");
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/usr/bin/uname")
    }
}

fn system_info_candidates() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        return vec![PathBuf::from(r"C:\Windows\System32\systeminfo.exe")];
    }
    #[cfg(not(windows))]
    {
        vec![PathBuf::from("/usr/bin/uname"), PathBuf::from("/bin/uname")]
    }
}

fn system_info_args() -> Vec<String> {
    #[cfg(windows)]
    {
        vec!["/FO".into(), "CSV".into(), "/NH".into()]
    }
    #[cfg(not(windows))]
    {
        vec!["-a".into()]
    }
}

fn whoami_executable_hint() -> PathBuf {
    #[cfg(windows)]
    {
        return PathBuf::from(r"C:\Windows\System32\whoami.exe");
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/usr/bin/whoami")
    }
}

fn whoami_candidates() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        return vec![PathBuf::from(r"C:\Windows\System32\whoami.exe")];
    }
    #[cfg(not(windows))]
    {
        vec![
            PathBuf::from("/usr/bin/whoami"),
            PathBuf::from("/bin/whoami"),
        ]
    }
}

fn trusted_executable_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        // `fs::canonicalize` returns a verbatim local path (`\\?\C:\...`) on
        // Windows. Normalize only that local prefix before checking the fixed
        // system directories; UNC paths still do not match this allowlist.
        let normalized = raw
            .strip_prefix(r"\\?\")
            .unwrap_or(raw.as_ref())
            .to_ascii_lowercase();
        return normalized.starts_with(r"c:\windows\system32\")
            || normalized.starts_with(r"c:\program files\git\")
            || normalized.starts_with(r"c:\program files (x86)\git\");
    }
    #[cfg(target_os = "linux")]
    {
        return path.starts_with("/usr/bin")
            || path.starts_with("/bin")
            || path.starts_with("/usr/lib/git-core");
    }
    #[cfg(target_os = "macos")]
    {
        return path.starts_with("/usr/bin") || path.starts_with("/bin");
    }
    #[allow(unreachable_code)]
    false
}

fn disabled_helper_command() -> &'static str {
    #[cfg(windows)]
    {
        r"C:\Windows\System32\where.exe"
    }
    #[cfg(not(windows))]
    {
        "/usr/bin/false"
    }
}

fn validate_git_workspace_boundary(root: &Path, cwd: &Path) -> Result<(), WorkAssistantError> {
    let root = fs::canonicalize(root).map_err(|_| {
        WorkAssistantError::terminal_cwd_invalid("authorized workspace root is unavailable")
    })?;
    let cwd = fs::canonicalize(cwd)
        .map_err(|_| WorkAssistantError::terminal_cwd_invalid("terminal cwd is unavailable"))?;
    if !cwd.starts_with(&root) {
        return Err(WorkAssistantError::terminal_cwd_invalid(
            "terminal cwd is outside the authorized workspace",
        ));
    }
    let mut current = cwd.as_path();
    loop {
        let marker = current.join(".git");
        if let Ok(metadata) = fs::symlink_metadata(&marker) {
            if metadata.file_type().is_symlink() {
                return Err(WorkAssistantError::blocked(
                    "Git worktree links are not allowed",
                ));
            }
            if metadata.is_file() {
                let text = fs::read_to_string(&marker).map_err(|_| {
                    WorkAssistantError::blocked("Git worktree metadata could not be inspected")
                })?;
                let target = text
                    .strip_prefix("gitdir:")
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        WorkAssistantError::blocked("Git worktree metadata is invalid")
                    })?;
                let target = Path::new(target);
                let target = if target.is_absolute() {
                    target.to_path_buf()
                } else {
                    marker.parent().unwrap_or(current).join(target)
                };
                let target = fs::canonicalize(target).map_err(|_| {
                    WorkAssistantError::blocked(
                        "Git worktree metadata points to an unavailable path",
                    )
                })?;
                if !target.starts_with(&root) {
                    return Err(WorkAssistantError::blocked(
                        "Git worktree metadata points outside the authorized workspace",
                    ));
                }
            }
            return Ok(());
        }
        if current == root {
            break;
        }
        current = current.parent().unwrap_or(root.as_path());
    }
    Ok(())
}

fn null_config_path() -> &'static str {
    #[cfg(windows)]
    {
        "NUL"
    }
    #[cfg(not(windows))]
    {
        "/dev/null"
    }
}

fn summarize_terminal_output(operation: &str, stdout: &[u8], stderr: &[u8]) -> TerminalDiagnostic {
    let mut diagnostic = TerminalDiagnostic {
        kind: operation.to_owned(),
        has_changes: None,
        staged_files: None,
        unstaged_files: None,
        untracked_files: None,
        files_changed: None,
        lines_added: None,
        lines_deleted: None,
        binary_files: None,
        recent_commit_count: None,
        history_limit_reached: None,
        attached_branch: None,
        version: None,
        stderr_present: !stderr.is_empty(),
    };

    match operation {
        "git_status" => summarize_git_status(stdout, &mut diagnostic),
        "git_diff_stat" => summarize_git_numstat(stdout, &mut diagnostic),
        "git_branch" => {
            diagnostic.attached_branch = Some(!stdout.is_empty());
        }
        "git_log" => {
            let count = parse_first_u64(stdout).unwrap_or(0);
            diagnostic.recent_commit_count = Some(count);
            diagnostic.history_limit_reached = Some(count >= 100);
        }
        "git_version" => {
            diagnostic.version = parse_git_version(stdout);
        }
        "system_info" | "whoami" => {}
        _ => {}
    }
    diagnostic
}

fn summarize_git_status(stdout: &[u8], diagnostic: &mut TerminalDiagnostic) {
    let mut staged = 0u64;
    let mut unstaged = 0u64;
    let mut untracked = 0u64;
    for record in stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        if record.len() < 3 || record[2] != b' ' {
            continue;
        }
        let index = record[0];
        let worktree = record[1];
        if index == b'?' && worktree == b'?' {
            untracked = untracked.saturating_add(1);
            continue;
        }
        if index != b' ' && index != b'?' && index != b'!' {
            staged = staged.saturating_add(1);
        }
        if worktree != b' ' && worktree != b'?' && worktree != b'!' {
            unstaged = unstaged.saturating_add(1);
        }
    }
    diagnostic.staged_files = Some(staged);
    diagnostic.unstaged_files = Some(unstaged);
    diagnostic.untracked_files = Some(untracked);
    diagnostic.has_changes = Some(staged + unstaged + untracked > 0);
}

fn summarize_git_numstat(stdout: &[u8], diagnostic: &mut TerminalDiagnostic) {
    let mut files = 0u64;
    let mut added = 0u64;
    let mut deleted = 0u64;
    let mut binary = 0u64;
    for record in stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let mut fields = record.split(|byte| *byte == b'\t');
        let Some(insertions) = fields.next() else {
            continue;
        };
        let Some(deletions) = fields.next() else {
            continue;
        };
        files = files.saturating_add(1);
        match (parse_ascii_u64(insertions), parse_ascii_u64(deletions)) {
            (Some(left), Some(right)) => {
                added = added.saturating_add(left);
                deleted = deleted.saturating_add(right);
            }
            _ => binary = binary.saturating_add(1),
        }
    }
    diagnostic.files_changed = Some(files);
    diagnostic.lines_added = Some(added);
    diagnostic.lines_deleted = Some(deleted);
    diagnostic.binary_files = Some(binary);
    diagnostic.has_changes = Some(files > 0);
}

fn parse_first_u64(bytes: &[u8]) -> Option<u64> {
    String::from_utf8_lossy(bytes)
        .split_whitespace()
        .find_map(|value| value.parse::<u64>().ok())
}

fn parse_ascii_u64(bytes: &[u8]) -> Option<u64> {
    std::str::from_utf8(bytes).ok()?.parse::<u64>().ok()
}

fn parse_git_version(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .split_whitespace()
        .find(|part| {
            part.chars()
                .next()
                .is_some_and(|character| character.is_ascii_digit())
        })
        .map(|part| {
            part.chars()
                .take_while(|character| character.is_ascii_digit() || *character == '.')
                .collect::<String>()
        })
        .map(|part| part.trim_end_matches('.').to_owned())
        .filter(|part| !part.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_assistant::WorkAssistantState;
    #[cfg(windows)]
    use std::env;
    use std::{
        collections::{HashMap, HashSet},
        path::PathBuf,
        sync::{Mutex, RwLock},
    };

    fn cancelled_test_state() -> WorkAssistantState {
        WorkAssistantState {
            roots: RwLock::new(Vec::new()),
            previews: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            cancelled_runs: Mutex::new(HashSet::from(["cancelled-run".to_owned()])),
            cancelled_execution_audits: Mutex::new(HashSet::new()),
            audit_path: PathBuf::from("unused-terminal-audit.jsonl"),
            audit_guard: Mutex::new(()),
        }
    }

    #[tokio::test]
    async fn cancelled_run_is_rejected_before_any_terminal_process_is_started() {
        let state = cancelled_test_state();

        let error =
            run_terminal_operation(&state, "cancelled-run", "system_info", "unused-root", None)
                .await
                .expect_err("a cancelled run must not dispatch a terminal process");

        assert_eq!(error.code, "cancelled");
    }

    #[test]
    fn allowlisted_specs_never_use_a_shell() {
        let spec = command_spec_for_operation("git_status").unwrap();
        assert!(std::path::Path::new(&spec.executable).is_absolute());
        assert!(spec
            .args
            .ends_with(&["status".into(), "--porcelain=v1".into(), "-z".into(),]));
        assert!(spec.args.iter().any(|argument| argument == "--no-pager"));
        assert!(!spec.args.iter().any(|argument| {
            matches!(
                argument.as_str(),
                "sh" | "bash" | "zsh" | "cmd" | "powershell" | "pwsh"
            )
        }));
    }

    #[test]
    fn git_diff_operation_disables_local_external_helpers() {
        let spec = command_spec_for_operation("git_diff_stat").unwrap();

        assert!(spec.args.iter().any(|argument| argument == "--no-ext-diff"));
        assert!(spec.args.iter().any(|argument| argument == "--no-textconv"));
        assert!(spec.args.iter().any(|argument| argument == "--numstat"));
        assert!(spec.args.iter().any(|argument| argument == "--no-renames"));
        assert!(spec
            .args
            .windows(2)
            .any(|arguments| arguments == ["-c", "core.fsmonitor=false"]));
    }

    #[test]
    fn git_diagnostics_force_the_authorized_working_directory() {
        for operation in ["git_status", "git_diff_stat", "git_branch", "git_log"] {
            let spec = command_spec_for_operation(operation).unwrap();
            assert!(
                spec.args
                    .windows(2)
                    .any(|arguments| arguments == ["-c", "core.worktree=."],),
                "{operation} must not inherit a repository-local core.worktree",
            );
        }
    }

    #[test]
    fn git_log_operation_returns_counts_not_commit_titles() {
        let spec = command_spec_for_operation("git_log").unwrap();

        assert!(spec.args.iter().any(|argument| argument == "rev-list"));
        assert!(spec.args.iter().any(|argument| argument == "--count"));
        assert!(spec
            .args
            .iter()
            .any(|argument| argument == "--max-count=100"));
        assert!(!spec.args.iter().any(|argument| argument == "--oneline"));
    }

    #[test]
    fn blocks_shell_and_escape_arguments() {
        assert!(command_spec("git", &["status".into(), "--exec-path".into()]).is_err());
        assert!(command_spec("powershell", &["-Command".into(), "whoami".into()]).is_err());
        assert!(command_spec("npm", &["run".into(), "bad-script".into()]).is_err());
        assert!(command_spec("cargo", &["check".into()]).is_err());
        assert!(command_spec("python", &["--version".into()]).is_err());
        assert!(command_spec("node", &["--version".into()]).is_err());
    }

    #[test]
    fn supports_cross_platform_diagnostic_programs() {
        for operation in [
            "git_status",
            "git_diff_stat",
            "git_branch",
            "git_log",
            "git_version",
            "system_info",
            "whoami",
        ] {
            let spec = command_spec_for_operation(operation).unwrap();
            assert!(std::path::Path::new(&spec.executable).is_absolute());
            assert!(spec.args.iter().all(|arg| !arg.contains("$({")));
        }
    }

    #[test]
    fn terminal_catalog_excludes_user_writable_program_locations() {
        #[cfg(windows)]
        {
            if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
                let local_app_data = PathBuf::from(local_app_data);
                assert!(git_candidates()
                    .iter()
                    .all(|candidate| !candidate.starts_with(&local_app_data)));
            }
        }

        #[cfg(target_os = "linux")]
        assert!(!trusted_executable_path(Path::new("/usr/local/bin/git")));

        #[cfg(target_os = "macos")]
        assert!(!trusted_executable_path(Path::new("/opt/homebrew/bin/git")));
    }

    #[cfg(windows)]
    #[test]
    fn trusted_windows_system_binary_accepts_the_canonical_verbatim_prefix() {
        assert!(trusted_executable_path(Path::new(
            r"\\?\C:\Windows\System32\whoami.exe"
        )));
    }

    #[test]
    fn rejects_free_form_programs_even_when_they_look_allowlisted() {
        for program in ["git", "npm", "pnpm", "yarn", "cargo", "python", "node"] {
            let error = command_spec(program, &["--version".into()]).unwrap_err();
            assert_eq!(error.code, "terminal_program_not_allowed", "{program}");
        }
    }

    #[test]
    fn operation_mapping_never_uses_path_lookup() {
        let spec = command_spec_for_operation("git_status").unwrap();
        let executable = spec.executable.to_string_lossy();
        assert!(std::path::Path::new(executable.as_ref()).is_absolute());
        assert!(!executable.eq_ignore_ascii_case("git"));
        assert!(!executable.eq_ignore_ascii_case("git.exe"));
    }

    #[test]
    fn terminal_diagnostics_summarize_without_raw_paths_or_messages() {
        let sentinel = "PAPYRUS_LEAK_SENTINEL_7f312a";
        let status = summarize_terminal_output(
            "git_status",
            format!("M  {sentinel}\0?? other-secret\0").as_bytes(),
            sentinel.as_bytes(),
        );
        let value = serde_json::to_string(&status).unwrap();

        assert!(!value.contains(sentinel));
        assert!(status.has_changes.unwrap());
        assert_eq!(status.staged_files, Some(1));
        assert_eq!(status.untracked_files, Some(1));
        assert!(status.stderr_present);
    }

    #[test]
    fn terminal_result_serialization_never_contains_stdout_or_stderr_fields() {
        let result = TerminalRunResult {
            program: "git_log".into(),
            exit_code: Some(0),
            diagnostic: summarize_terminal_output("git_log", b"100\n", b""),
            truncated: false,
            duration_ms: 1,
        };

        let value = serde_json::to_value(result).unwrap();
        assert!(value.get("stdout").is_none());
        assert!(value.get("stderr").is_none());
        assert_eq!(value["diagnostic"]["recentCommitCount"], 100);
        assert_eq!(value["diagnostic"]["historyLimitReached"], true);
    }
}
