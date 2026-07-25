//! Cross-platform, non-shell terminal execution for the work assistant.
//!
//! The model can select an allowlisted program and structured arguments, but it
//! cannot provide a shell string, executable path, environment, or stdin. Every
//! invocation is scoped to an authorized workspace and is bounded by time and
//! output limits.

use crate::work_assistant::{
    append_audit_entry, AuditEntry, AssistantErrorPayload, PathPolicy, WorkAssistantError,
    WorkAssistantState,
};
use serde::Serialize;
use std::{
    path::Path,
    process::Stdio,
    time::Instant,
};
use tauri::State;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    time::{timeout, Duration},
};

const MAX_ARGUMENTS: usize = 12;
const MAX_ARGUMENT_LENGTH: usize = 160;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_TOTAL_OUTPUT_BYTES: usize = MAX_OUTPUT_BYTES * 2;
const TERMINAL_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRunResult {
    pub program: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub duration_ms: u128,
}

#[derive(Clone, Debug)]
struct CommandSpec {
    executable: String,
    args: Vec<String>,
}

#[tauri::command]
pub async fn work_assistant_terminal_run(
    state: State<'_, WorkAssistantState>,
    program: String,
    args: Vec<String>,
    root_id: String,
    cwd: Option<String>,
) -> Result<TerminalRunResult, AssistantErrorPayload> {
    let roots = state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))?
        .clone();
    let policy = PathPolicy::new(&roots);
    let requested_cwd = cwd.unwrap_or_default();
    let working_directory = policy
        .resolve_existing(&root_id, Path::new(&requested_cwd))
        .map_err(|_| WorkAssistantError::terminal_cwd_invalid("terminal cwd is outside the authorized workspace"))?;
    if !working_directory.is_dir() {
        return Err(WorkAssistantError::terminal_cwd_invalid("terminal cwd is not a directory").into());
    }

    let spec = command_spec(&program, &args).map_err(AssistantErrorPayload::from)?;
    let started = Instant::now();
    let mut child = Command::new(&spec.executable);
    child
        .args(&spec.args)
        .current_dir(&working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = child.spawn().map_err(|error| {
        WorkAssistantError::terminal_failed(format!("could not start allowlisted terminal program: {error}"))
    })?;

    let stdout_task = child.stdout.take().map(|stdout| tokio::spawn(read_limited(stdout, MAX_OUTPUT_BYTES)));
    let stderr_task = child.stderr.take().map(|stderr| tokio::spawn(read_limited(stderr, MAX_OUTPUT_BYTES)));
    let status = match timeout(TERMINAL_TIMEOUT, child.wait()).await {
        Ok(result) => result.map_err(|error| {
            WorkAssistantError::terminal_failed(format!("terminal process failed: {error}"))
        })?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(WorkAssistantError::terminal_timeout("terminal command exceeded the 60 second limit").into());
        }
    };

    let (stdout, stdout_truncated) = join_output(stdout_task).await?;
    let (stderr, stderr_truncated) = join_output(stderr_task).await?;
    let total_truncated = stdout_truncated || stderr_truncated || stdout.len() + stderr.len() > MAX_TOTAL_OUTPUT_BYTES;
    let result = TerminalRunResult {
        program: program.trim().to_owned(),
        exit_code: status.code(),
        stdout: redact_output(stdout),
        stderr: redact_output(stderr),
        truncated: total_truncated,
        duration_ms: started.elapsed().as_millis(),
    };

    let audit_detail = format!(
        "program={};root={};cwd={};exit={};truncated={}",
        result.program,
        root_id,
        requested_cwd,
        result.exit_code.map_or_else(|| "signal".into(), |code| code.to_string()),
        result.truncated,
    );
    append_audit_entry(&state, &AuditEntry::new("terminal_run", audit_detail))
        .map_err(AssistantErrorPayload::from)?;
    Ok(result)
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

async fn join_output(
    task: Option<tokio::task::JoinHandle<(Vec<u8>, bool)>>,
) -> Result<(Vec<u8>, bool), AssistantErrorPayload> {
    match task {
        Some(task) => task
            .await
            .map_err(|_| WorkAssistantError::terminal_failed("terminal output reader failed"))
            .map_err(Into::into),
        None => Ok((Vec::new(), false)),
    }
}

fn command_spec(program: &str, args: &[String]) -> Result<CommandSpec, WorkAssistantError> {
    let program = program.trim().to_ascii_lowercase();
    if program.is_empty() || args.len() > MAX_ARGUMENTS {
        return Err(WorkAssistantError::terminal_program_not_allowed("terminal program or argument count is not allowed"));
    }
    for argument in args {
        if argument.is_empty()
            || argument.len() > MAX_ARGUMENT_LENGTH
            || argument.chars().any(char::is_control)
            || argument.contains('\0')
        {
            return Err(WorkAssistantError::terminal_program_not_allowed("terminal arguments contain invalid characters or are too long"));
        }
    }

    let mut normalized_args = args.to_vec();
    let executable = match program.as_str() {
        "git" => {
            require_subcommand(args, &["status", "diff", "log", "branch", "show"])?;
            reject_git_escape_args(args)?;
            executable_name("git")
        }
        "npm" | "pnpm" | "yarn" => {
            validate_package_manager_args(args)?;
            executable_name(&program)
        }
        "cargo" => {
            require_subcommand(args, &["check", "test", "build", "fmt", "clippy"])?;
            reject_flag(args, &["--manifest-path", "--target-dir", "--config"])?;
            executable_name("cargo")
        }
        "rustc" => {
            require_exact_args(args, &["--version", "-V"])?;
            executable_name("rustc")
        }
        "python" => {
            require_exact_args(args, &["--version", "-V"])?;
            #[cfg(windows)]
            {
                normalized_args = vec!["-3".into(), "--version".into()];
            }
            executable_name("python")
        }
        "node" => {
            require_exact_args(args, &["--version", "-v"])?;
            executable_name("node")
        }
        "dotnet" => {
            require_exact_args(args, &["--info", "--version"])?;
            executable_name("dotnet")
        }
        "go" => {
            require_exact_args(args, &["version"])?;
            executable_name("go")
        }
        "system_info" => {
            if !args.is_empty() {
                return Err(WorkAssistantError::terminal_program_not_allowed("system_info does not accept arguments"));
            }
            #[cfg(windows)]
            {
                normalized_args = vec!["/FO".into(), "CSV".into(), "/NH".into()];
                "systeminfo.exe".into()
            }
            #[cfg(not(windows))]
            {
                normalized_args = vec!["-a".into()];
                "uname".into()
            }
        }
        "whoami" => {
            if !args.is_empty() {
                return Err(WorkAssistantError::terminal_program_not_allowed("whoami does not accept arguments"));
            }
            executable_name("whoami")
        }
        _ => return Err(WorkAssistantError::terminal_program_not_allowed("terminal program is not allowlisted")),
    };

    Ok(CommandSpec {
        executable,
        args: normalized_args,
    })
}

fn require_subcommand(args: &[String], allowed: &[&str]) -> Result<(), WorkAssistantError> {
    let first = args.first().map(String::as_str).unwrap_or_default();
    if allowed.contains(&first) {
        Ok(())
    } else {
        Err(WorkAssistantError::terminal_program_not_allowed("terminal subcommand is not allowlisted"))
    }
}

fn require_exact_args(args: &[String], allowed: &[&str]) -> Result<(), WorkAssistantError> {
    if args.len() == 1 && allowed.contains(&args[0].as_str()) {
        Ok(())
    } else {
        Err(WorkAssistantError::terminal_program_not_allowed("terminal arguments are not allowlisted"))
    }
}

fn reject_flag(args: &[String], blocked: &[&str]) -> Result<(), WorkAssistantError> {
    if args.iter().any(|arg| blocked.iter().any(|item| arg == item || arg.starts_with(&format!("{item}=")))) {
        return Err(WorkAssistantError::terminal_program_not_allowed("terminal path/configuration override is blocked"));
    }
    Ok(())
}

fn reject_git_escape_args(args: &[String]) -> Result<(), WorkAssistantError> {
    reject_flag(args, &["-c", "--exec-path", "--upload-pack", "--receive-pack", "--git-dir", "--work-tree", "--output"])
}

fn validate_package_manager_args(args: &[String]) -> Result<(), WorkAssistantError> {
    let first = args.first().map(String::as_str).unwrap_or_default();
    if matches!(first, "test" | "build" | "lint" | "--version" | "-v") {
        return Ok(());
    }
    if first == "run" {
        let script = args.get(1).map(String::as_str).unwrap_or_default();
        if !script.is_empty() && script.len() <= 64 && script.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ':')) {
            return Ok(());
        }
    }
    Err(WorkAssistantError::terminal_program_not_allowed("package-manager script is not allowlisted"))
}

fn executable_name(program: &str) -> String {
    #[cfg(windows)]
    {
        if matches!(program, "npm" | "pnpm" | "yarn") {
            return format!("{program}.cmd");
        }
        if program == "python" {
            return "py.exe".into();
        }
    }
    #[cfg(not(windows))]
    {
        if program == "python" {
            return "python3".into();
        }
    }
    program.into()
}

fn redact_output(bytes: Vec<u8>) -> String {
    let text = String::from_utf8_lossy(&bytes);
    text.lines()
        .map(|line| {
            if line.chars().any(char::is_control) && !line.contains('\t') {
                return "[已隐藏控制字符输出]".to_owned();
            }
            let lower = line.to_ascii_lowercase();
            if ["password", "token", "secret", "api_key", "api-key", "authorization"]
                .iter()
                .any(|marker| lower.contains(marker))
            {
                "[已隐藏疑似敏感输出]".to_owned()
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlisted_specs_never_use_a_shell() {
        let spec = command_spec("git", &["status".into()]).unwrap();
        assert_eq!(spec.executable, executable_name("git"));
        assert_eq!(spec.args, vec!["status"]);
    }

    #[test]
    fn blocks_shell_and_escape_arguments() {
        assert!(command_spec("git", &["status".into(), "--exec-path".into()]).is_err());
        assert!(command_spec("powershell", &["-Command".into(), "whoami".into()]).is_err());
        assert!(command_spec("npm", &["run".into(), "bad script".into()]).is_err());
    }

    #[test]
    fn supports_cross_platform_diagnostic_programs() {
        assert!(command_spec("system_info", &[]).is_ok());
        assert!(command_spec("whoami", &[]).is_ok());
        assert!(command_spec("python", &["--version".into()]).is_ok());
        assert!(command_spec("cargo", &["check".into(), "--release".into()]).is_ok());
    }
}
