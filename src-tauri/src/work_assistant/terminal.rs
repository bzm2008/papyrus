//! Narrow, approval-bound document terminal commands.
//!
//! This is deliberately separate from the file batch preview protocol. The
//! catalog contains only fixed document extractors, builds every argument from
//! structured fields, and never invokes a shell or a caller-supplied program.

use crate::work_assistant::platform::{
    open_source_snapshot, SourceSnapshot, SourceSnapshotSummary,
};
use crate::work_assistant::{
    append_audit_entry, ApprovalChoice, ApprovalGrant, AssistantErrorPayload, AssistantRiskLevel,
    AssistantToolPreview, AuditEntry, AuthorizedRoot, PathPolicy, WorkAssistantError,
    WorkAssistantState,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    ffi::{OsStr, OsString},
    fs,
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use uuid::Uuid;

const PREVIEW_TTL: Duration = Duration::from_secs(5 * 60);
const EXECUTION_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 48 * 1024;
const MAX_IDENTIFIER_CHARS: usize = 128;
const MAX_PATH_CHARS: usize = 512;
const MAX_TERMINAL_PREVIEWS: usize = 128;
const MAX_TERMINAL_APPROVALS: usize = 128;
const MAX_EXECUTABLE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TerminalCommand {
    PdfToText,
    DocumentToText,
}

impl TerminalCommand {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "terminal_pdf_to_text" => Some(Self::PdfToText),
            "terminal_document_to_text" => Some(Self::DocumentToText),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::PdfToText => "terminal_pdf_to_text",
            Self::DocumentToText => "terminal_document_to_text",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Self::PdfToText => "提取 PDF 正文",
            Self::DocumentToText => "提取文档正文",
        }
    }

    fn installation_hint(self) -> &'static str {
        match self {
            Self::PdfToText => "需要安装 Poppler 的 pdftotext 工具。",
            Self::DocumentToText => "需要安装 Pandoc 文档转换工具。",
        }
    }

    fn accepts_extension(self, extension: &str) -> bool {
        match self {
            Self::PdfToText => extension.eq_ignore_ascii_case("pdf"),
            Self::DocumentToText => ["docx", "odt", "rtf", "md", "markdown", "txt"]
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate)),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPreviewRequest {
    pub run_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug)]
struct StoredTerminalPreview {
    id: String,
    run_id: String,
    root_id: String,
    relative_path: String,
    source_snapshot: SourceSnapshotSummary,
    source_extension: OsString,
    command: TerminalCommand,
    executable: ExecutableFingerprint,
    expires_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ExecutableFingerprint {
    path: PathBuf,
    byte_len: u64,
    modified: u128,
    digest: [u8; 32],
}

#[derive(Clone, Debug)]
struct StoredTerminalApproval {
    token: String,
    preview_id: String,
    run_id: String,
    expires_at: u64,
}

pub struct ControlledTerminalState {
    previews: Mutex<HashMap<String, StoredTerminalPreview>>,
    approvals: Mutex<HashMap<String, StoredTerminalApproval>>,
    active_runs: Mutex<HashMap<String, usize>>,
}

pub fn init_controlled_terminal_state() -> ControlledTerminalState {
    ControlledTerminalState {
        previews: Mutex::new(HashMap::new()),
        approvals: Mutex::new(HashMap::new()),
        active_runs: Mutex::new(HashMap::new()),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExecutionResult {
    pub ok: bool,
    pub summary: String,
    pub command: String,
    pub output_chars: usize,
    pub truncated: bool,
    pub audit_recorded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    /// This text is transient work material for the active assistant run. It
    /// is never placed in the audit log or secretary ledger.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[tauri::command]
pub fn work_assistant_terminal_preview(
    state: State<'_, WorkAssistantState>,
    terminal: State<'_, ControlledTerminalState>,
    request: TerminalPreviewRequest,
) -> Result<AssistantToolPreview, AssistantErrorPayload> {
    create_terminal_preview(&state, &terminal, request).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_terminal_approve(
    state: State<'_, WorkAssistantState>,
    terminal: State<'_, ControlledTerminalState>,
    preview_id: String,
    run_id: String,
    choice: ApprovalChoice,
) -> Result<ApprovalGrant, AssistantErrorPayload> {
    approve_terminal_preview(&state, &terminal, &preview_id, &run_id, choice).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_terminal_execute(
    state: State<'_, WorkAssistantState>,
    terminal: State<'_, ControlledTerminalState>,
    preview_id: String,
    approval_token: Option<String>,
) -> Result<TerminalExecutionResult, AssistantErrorPayload> {
    let token = approval_token
        .ok_or_else(|| WorkAssistantError::blocked("a terminal approval token is required"))?;
    execute_terminal_preview(&state, &terminal, &preview_id, &token).map_err(Into::into)
}

pub fn terminal_capabilities(platform: &str) -> Vec<crate::work_assistant::CapabilityStatus> {
    [TerminalCommand::PdfToText, TerminalCommand::DocumentToText]
        .into_iter()
        .map(|command| {
            let available = resolve_catalog_executable(command).is_ok();
            crate::work_assistant::CapabilityStatus {
                name: command.name().into(),
                toolset: "terminal".into(),
                available,
                reason: (!available).then(|| command.installation_hint().into()),
                platform: platform.into(),
            }
        })
        .collect()
}

fn create_terminal_preview(
    state: &WorkAssistantState,
    terminal: &ControlledTerminalState,
    request: TerminalPreviewRequest,
) -> Result<AssistantToolPreview, WorkAssistantError> {
    prune_terminal_state(terminal)?;
    validate_identifier(&request.run_id, "run id")?;
    validate_identifier(&request.tool_call_id, "tool call id")?;
    if is_run_cancelled(state, &request.run_id)? {
        return Err(WorkAssistantError::cancelled(
            "the assistant run has been cancelled",
        ));
    }
    let command = TerminalCommand::parse(request.tool_name.trim()).ok_or_else(|| {
        WorkAssistantError::blocked("terminal command is not in the approved catalog")
    })?;
    let (root_id, relative_path) = parse_terminal_arguments(&request.arguments)?;
    let (source_snapshot, source_extension) =
        capture_terminal_source(state, &root_id, &relative_path, command)?;
    let executable = resolve_catalog_executable(command)?;
    let now = unix_millis();
    let expires_at = now.saturating_add(PREVIEW_TTL.as_millis() as u64);
    let id = format!("terminal-preview-{}", Uuid::new_v4());
    let preview = StoredTerminalPreview {
        id: id.clone(),
        run_id: request.run_id.clone(),
        root_id: root_id.clone(),
        relative_path: relative_path.clone(),
        source_snapshot,
        source_extension,
        command,
        executable,
        expires_at,
    };
    insert_terminal_preview(terminal, id.clone(), preview)?;

    Ok(AssistantToolPreview {
        id,
        revision: format!("terminal:{now}"),
        risk: AssistantRiskLevel::Read,
        title: command.title().into(),
        target_summary: relative_path,
        impact_summary: "将以固定的只读文档工具提取有限正文；不会写入文件或启动 shell。".into(),
        reversible: true,
        expires_at,
        scope: vec![format!("terminal:{root_id}:{}", command.name())],
    })
}

fn approve_terminal_preview(
    state: &WorkAssistantState,
    terminal: &ControlledTerminalState,
    preview_id: &str,
    run_id: &str,
    choice: ApprovalChoice,
) -> Result<ApprovalGrant, WorkAssistantError> {
    prune_terminal_state(terminal)?;
    if choice != ApprovalChoice::Once {
        return Err(WorkAssistantError::blocked(
            "terminal approvals are single-use and cannot be reused for a run",
        ));
    }
    validate_identifier(run_id, "run id")?;
    if is_run_cancelled(state, run_id)? {
        return Err(WorkAssistantError::cancelled(
            "the assistant run has been cancelled",
        ));
    }
    let preview = terminal_preview(terminal, preview_id)?;
    if preview.run_id != run_id {
        return Err(WorkAssistantError::blocked(
            "terminal preview belongs to another run",
        ));
    }
    validate_terminal_preview_fresh(state, &preview)?;
    let token = format!("terminal-approval-{}", Uuid::new_v4());
    let approval = StoredTerminalApproval {
        token: token.clone(),
        preview_id: preview.id.clone(),
        run_id: preview.run_id.clone(),
        expires_at: preview.expires_at,
    };
    insert_terminal_approval(terminal, token.clone(), approval)?;
    Ok(ApprovalGrant {
        token,
        preview_id: preview.id,
        expires: preview.expires_at,
    })
}

fn execute_terminal_preview(
    state: &WorkAssistantState,
    terminal: &ControlledTerminalState,
    preview_id: &str,
    token: &str,
) -> Result<TerminalExecutionResult, WorkAssistantError> {
    prune_terminal_state(terminal)?;
    let approval = terminal
        .approvals
        .lock()
        .map_err(|_| WorkAssistantError::protocol("terminal approval lock is unavailable"))?
        .remove(token)
        .ok_or_else(|| {
            WorkAssistantError::blocked("terminal approval is unavailable or already used")
        })?;
    if approval.token != token
        || approval.preview_id != preview_id
        || approval.expires_at < unix_millis()
    {
        return Err(WorkAssistantError::stale_preview(
            "terminal approval has expired",
        ));
    }
    let preview = take_terminal_preview(terminal, preview_id)?;
    if preview.run_id != approval.run_id {
        return Err(WorkAssistantError::blocked(
            "terminal approval does not match this preview",
        ));
    }
    if is_run_cancelled(state, &preview.run_id)? {
        return Ok(cancelled_terminal_result(&preview, false));
    }
    let execution = {
        let _active_run = activate_controlled_terminal_run(terminal, &preview.run_id)?;
        if is_run_cancelled(state, &preview.run_id)? {
            return Ok(cancelled_terminal_result(&preview, false));
        }
        let source = open_fresh_terminal_source(state, &preview)?;
        validate_terminal_executable_fresh(&preview)?;
        run_catalog_command(state, &preview, &source)?
    };
    finalize_terminal_execution_with_audit(state, preview.command, execution)
}

fn terminal_preview(
    terminal: &ControlledTerminalState,
    preview_id: &str,
) -> Result<StoredTerminalPreview, WorkAssistantError> {
    prune_terminal_state(terminal)?;
    terminal
        .previews
        .lock()
        .map_err(|_| WorkAssistantError::protocol("terminal preview lock is unavailable"))?
        .get(preview_id)
        .cloned()
        .ok_or_else(|| WorkAssistantError::stale_preview("terminal preview is unavailable"))
}

fn take_terminal_preview(
    terminal: &ControlledTerminalState,
    preview_id: &str,
) -> Result<StoredTerminalPreview, WorkAssistantError> {
    prune_terminal_state(terminal)?;
    terminal
        .previews
        .lock()
        .map_err(|_| WorkAssistantError::protocol("terminal preview lock is unavailable"))?
        .remove(preview_id)
        .ok_or_else(|| WorkAssistantError::stale_preview("terminal preview is unavailable"))
}

fn insert_terminal_preview(
    terminal: &ControlledTerminalState,
    id: String,
    preview: StoredTerminalPreview,
) -> Result<(), WorkAssistantError> {
    let mut previews = terminal
        .previews
        .lock()
        .map_err(|_| WorkAssistantError::protocol("terminal preview lock is unavailable"))?;
    prune_terminal_previews(&mut previews, unix_millis());
    previews.insert(id, preview);
    trim_terminal_previews(&mut previews);
    Ok(())
}

fn insert_terminal_approval(
    terminal: &ControlledTerminalState,
    token: String,
    approval: StoredTerminalApproval,
) -> Result<(), WorkAssistantError> {
    let mut approvals = terminal
        .approvals
        .lock()
        .map_err(|_| WorkAssistantError::protocol("terminal approval lock is unavailable"))?;
    prune_terminal_approvals(&mut approvals, unix_millis(), None);
    approvals.insert(token, approval);
    trim_terminal_approvals(&mut approvals);
    Ok(())
}

fn prune_terminal_state(terminal: &ControlledTerminalState) -> Result<(), WorkAssistantError> {
    prune_terminal_state_at(terminal, unix_millis())
}

fn prune_terminal_state_at(
    terminal: &ControlledTerminalState,
    now: u64,
) -> Result<(), WorkAssistantError> {
    let preview_ids: HashSet<String> = {
        let mut previews = terminal
            .previews
            .lock()
            .map_err(|_| WorkAssistantError::protocol("terminal preview lock is unavailable"))?;
        prune_terminal_previews(&mut previews, now);
        previews.keys().cloned().collect()
    };
    let mut approvals = terminal
        .approvals
        .lock()
        .map_err(|_| WorkAssistantError::protocol("terminal approval lock is unavailable"))?;
    prune_terminal_approvals(&mut approvals, now, Some(&preview_ids));
    Ok(())
}

fn prune_terminal_previews(previews: &mut HashMap<String, StoredTerminalPreview>, now: u64) {
    previews.retain(|_, preview| preview.expires_at >= now);
    trim_terminal_previews(previews);
}

fn trim_terminal_previews(previews: &mut HashMap<String, StoredTerminalPreview>) {
    let excess = previews.len().saturating_sub(MAX_TERMINAL_PREVIEWS);
    if excess == 0 {
        return;
    }
    let mut ids: Vec<_> = previews
        .iter()
        .map(|(id, preview)| (preview.expires_at, id.clone()))
        .collect();
    ids.sort_unstable();
    for (_, id) in ids.into_iter().take(excess) {
        previews.remove(&id);
    }
}

fn prune_terminal_approvals(
    approvals: &mut HashMap<String, StoredTerminalApproval>,
    now: u64,
    preview_ids: Option<&HashSet<String>>,
) {
    approvals.retain(|_, approval| {
        approval.expires_at >= now
            && preview_ids
                .map(|ids| ids.contains(&approval.preview_id))
                .unwrap_or(true)
    });
    trim_terminal_approvals(approvals);
}

fn trim_terminal_approvals(approvals: &mut HashMap<String, StoredTerminalApproval>) {
    let excess = approvals.len().saturating_sub(MAX_TERMINAL_APPROVALS);
    if excess == 0 {
        return;
    }
    let mut tokens: Vec<_> = approvals
        .iter()
        .map(|(token, approval)| (approval.expires_at, token.clone()))
        .collect();
    tokens.sort_unstable();
    for (_, token) in tokens.into_iter().take(excess) {
        approvals.remove(&token);
    }
}

pub(crate) fn cancel_controlled_terminal_run(
    terminal: &ControlledTerminalState,
    run_id: &str,
) -> Result<(), WorkAssistantError> {
    prune_terminal_state(terminal)?;
    {
        let mut previews = terminal
            .previews
            .lock()
            .map_err(|_| WorkAssistantError::protocol("terminal preview lock is unavailable"))?;
        previews.retain(|_, preview| preview.run_id != run_id);
    }
    let mut approvals = terminal
        .approvals
        .lock()
        .map_err(|_| WorkAssistantError::protocol("terminal approval lock is unavailable"))?;
    approvals.retain(|_, approval| approval.run_id != run_id);
    Ok(())
}

pub(crate) fn controlled_terminal_run_is_active(
    terminal: &ControlledTerminalState,
    run_id: &str,
) -> Result<bool, WorkAssistantError> {
    terminal
        .active_runs
        .lock()
        .map_err(|_| WorkAssistantError::protocol("terminal active-runs lock is unavailable"))
        .map(|runs| runs.contains_key(run_id))
}

pub(crate) fn activate_controlled_terminal_run<'a>(
    terminal: &'a ControlledTerminalState,
    run_id: &str,
) -> Result<ActiveTerminalRun<'a>, WorkAssistantError> {
    let mut runs = terminal
        .active_runs
        .lock()
        .map_err(|_| WorkAssistantError::protocol("terminal active-runs lock is unavailable"))?;
    *runs.entry(run_id.into()).or_insert(0) += 1;
    Ok(ActiveTerminalRun {
        terminal,
        run_id: run_id.into(),
    })
}

pub(crate) struct ActiveTerminalRun<'a> {
    terminal: &'a ControlledTerminalState,
    run_id: String,
}

impl Drop for ActiveTerminalRun<'_> {
    fn drop(&mut self) {
        let Ok(mut runs) = self.terminal.active_runs.lock() else {
            return;
        };
        let Some(count) = runs.get_mut(&self.run_id) else {
            return;
        };
        if *count == 1 {
            runs.remove(&self.run_id);
        } else {
            *count -= 1;
        }
    }
}

fn validate_terminal_preview_fresh(
    state: &WorkAssistantState,
    preview: &StoredTerminalPreview,
) -> Result<(), WorkAssistantError> {
    if preview.expires_at < unix_millis() {
        return Err(WorkAssistantError::stale_preview(
            "terminal preview has expired",
        ));
    }
    let _source = open_fresh_terminal_source(state, preview)?;
    validate_terminal_executable_fresh(preview)?;
    Ok(())
}

fn parse_terminal_arguments(value: &Value) -> Result<(String, String), WorkAssistantError> {
    let object = value.as_object().ok_or_else(|| {
        WorkAssistantError::blocked("terminal arguments must be a structured object")
    })?;
    if object.len() != 2 || !object.contains_key("rootId") || !object.contains_key("path") {
        return Err(WorkAssistantError::blocked(
            "terminal arguments may contain only rootId and path",
        ));
    }
    let root_id = object
        .get("rootId")
        .and_then(Value::as_str)
        .ok_or_else(|| WorkAssistantError::blocked("terminal rootId is required"))?
        .trim()
        .to_string();
    let path = object
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| WorkAssistantError::blocked("terminal path is required"))?
        .trim()
        .to_string();
    validate_identifier(&root_id, "root id")?;
    if path.is_empty() || path.chars().count() > MAX_PATH_CHARS || path.contains('\0') {
        return Err(WorkAssistantError::blocked("terminal path is invalid"));
    }
    Ok((root_id, path))
}

fn capture_terminal_source(
    state: &WorkAssistantState,
    root_id: &str,
    relative_path: &str,
    command: TerminalCommand,
) -> Result<(SourceSnapshotSummary, OsString), WorkAssistantError> {
    let roots = read_roots(state)?;
    let policy = PathPolicy::new(&roots);
    let source = policy.resolve_existing(root_id, Path::new(relative_path))?;
    let root = authorized_root(&roots, root_id)?;
    let metadata = fs::metadata(&source).map_err(|error| {
        WorkAssistantError::blocked(format!("could not inspect terminal document: {error}"))
    })?;
    if !metadata.is_file() || metadata.len() > MAX_SOURCE_BYTES {
        return Err(WorkAssistantError::blocked(
            "terminal input must be a regular document within the supported size limit",
        ));
    }
    let extension = source.extension().ok_or_else(|| {
        WorkAssistantError::blocked(
            "this document type is not accepted by the requested terminal command",
        )
    })?;
    if !command.accepts_extension(extension.to_str().unwrap_or_default()) {
        return Err(WorkAssistantError::blocked(
            "this document type is not accepted by the requested terminal command",
        ));
    }
    let snapshot = open_source_snapshot(&root.path, Path::new(relative_path))?;
    if snapshot.summary().byte_len > MAX_SOURCE_BYTES {
        return Err(WorkAssistantError::blocked(
            "terminal input must be a regular document within the supported size limit",
        ));
    }
    Ok((snapshot.summary().clone(), extension.to_os_string()))
}

fn read_roots(state: &WorkAssistantState) -> Result<Vec<AuthorizedRoot>, WorkAssistantError> {
    state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))
        .map(|roots| roots.clone())
}

fn authorized_root(
    roots: &[AuthorizedRoot],
    root_id: &str,
) -> Result<AuthorizedRoot, WorkAssistantError> {
    roots
        .iter()
        .find(|root| root.id == root_id)
        .cloned()
        .ok_or_else(|| WorkAssistantError::blocked("authorized root was not found"))
}

fn open_fresh_terminal_source(
    state: &WorkAssistantState,
    preview: &StoredTerminalPreview,
) -> Result<SourceSnapshot, WorkAssistantError> {
    let roots = read_roots(state)?;
    let root = authorized_root(&roots, &preview.root_id)?;
    let source = open_source_snapshot(&root.path, Path::new(&preview.relative_path))?;
    if source.summary().byte_len > MAX_SOURCE_BYTES {
        return Err(WorkAssistantError::stale_preview(
            "the approved document exceeds the supported size limit",
        ));
    }
    source.require_summary_identity(&preview.source_snapshot)?;
    source.verify_snapshot()?;
    Ok(source)
}

fn validate_terminal_executable_fresh(
    preview: &StoredTerminalPreview,
) -> Result<(), WorkAssistantError> {
    let executable = resolve_catalog_executable(preview.command).map_err(|_| {
        WorkAssistantError::stale_preview(
            "the approved terminal executable changed; generate a new preview",
        )
    })?;
    if executable != preview.executable {
        return Err(WorkAssistantError::stale_preview(
            "the approved terminal executable changed; generate a new preview",
        ));
    }
    Ok(())
}

fn run_catalog_command(
    state: &WorkAssistantState,
    preview: &StoredTerminalPreview,
    source: &SourceSnapshot,
) -> Result<TerminalExecutionResult, WorkAssistantError> {
    let staged_source = stage_terminal_source(source, &preview.source_extension)?;
    let staging_directory = staged_source.path.parent().ok_or_else(|| {
        WorkAssistantError::protocol("terminal staging path has no parent directory")
    })?;
    let mut command = Command::new(&preview.executable.path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(staging_directory);
    match preview.command {
        TerminalCommand::PdfToText => {
            command.arg(&staged_source.path).arg("-");
        }
        TerminalCommand::DocumentToText => {
            command
                .arg(&staged_source.path)
                .arg("--to=plain")
                .arg("--wrap=none");
        }
    }
    let mut child = command.spawn().map_err(|_| {
        WorkAssistantError::blocked("the approved document tool is unavailable on this computer")
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| WorkAssistantError::protocol("could not capture terminal stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| WorkAssistantError::protocol("could not capture terminal stderr"))?;
    let stdout_reader = thread::spawn(move || read_capped(stdout));
    let stderr_reader = thread::spawn(move || read_capped(stderr));
    let started = Instant::now();

    let status = loop {
        if is_run_cancelled(state, &preview.run_id)? {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Ok(cancelled_terminal_result(preview, true));
        }
        if started.elapsed() >= EXECUTION_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Ok(timeout_terminal_result(preview));
        }
        match child.try_wait().map_err(|error| {
            WorkAssistantError::protocol(format!("could not wait for terminal command: {error}"))
        })? {
            Some(status) => break status,
            None => thread::sleep(Duration::from_millis(30)),
        }
    };
    let stdout = join_capped(stdout_reader)?;
    let stderr = join_capped(stderr_reader)?;
    terminal_result_from_output(preview, status, stdout, stderr)
}

struct StagedTerminalSource {
    path: PathBuf,
}

impl Drop for StagedTerminalSource {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn stage_terminal_source(
    source: &SourceSnapshot,
    extension: &OsStr,
) -> Result<StagedTerminalSource, WorkAssistantError> {
    source.verify_snapshot()?;
    for _ in 0..4 {
        let mut path = std::env::temp_dir().join(format!("papyrus-terminal-{}", Uuid::new_v4()));
        path.set_extension(extension);
        let mut staged = match fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(WorkAssistantError::protocol(format!(
                    "could not create terminal staging file: {error}"
                )))
            }
        };
        let copy_result = (|| {
            let mut input = source.file().try_clone().map_err(|error| {
                WorkAssistantError::protocol(format!(
                    "could not duplicate terminal source snapshot: {error}"
                ))
            })?;
            input.seek(SeekFrom::Start(0)).map_err(|error| {
                WorkAssistantError::protocol(format!(
                    "could not rewind terminal source snapshot: {error}"
                ))
            })?;
            let copied = io::copy(&mut input, &mut staged).map_err(|error| {
                WorkAssistantError::protocol(format!(
                    "could not stage terminal source snapshot: {error}"
                ))
            })?;
            if copied != source.summary().byte_len {
                return Err(WorkAssistantError::stale_preview(
                    "the approved document changed while it was staged",
                ));
            }
            staged
                .flush()
                .and_then(|_| staged.sync_all())
                .map_err(|error| {
                    WorkAssistantError::protocol(format!(
                        "could not finalize terminal staging file: {error}"
                    ))
                })?;
            source.verify_snapshot()
        })();
        drop(staged);
        match copy_result {
            Ok(()) => return Ok(StagedTerminalSource { path }),
            Err(error) => {
                let _ = fs::remove_file(&path);
                return Err(error);
            }
        }
    }
    Err(WorkAssistantError::protocol(
        "could not allocate a terminal staging file",
    ))
}

fn terminal_result_from_output(
    preview: &StoredTerminalPreview,
    status: ExitStatus,
    stdout: CappedOutput,
    _stderr: CappedOutput,
) -> Result<TerminalExecutionResult, WorkAssistantError> {
    let text = String::from_utf8_lossy(&stdout.bytes).trim().to_string();
    if !status.success() {
        return Ok(TerminalExecutionResult {
            ok: false,
            summary: "受控文档工具未能完成，请检查文档格式和本机工具安装。".into(),
            command: preview.command.name().into(),
            output_chars: text.chars().count(),
            truncated: stdout.truncated,
            audit_recorded: false,
            error_code: Some("terminal_failed".into()),
            text: None,
        });
    }
    Ok(TerminalExecutionResult {
        ok: true,
        summary: if stdout.truncated {
            "文档正文已提取，但输出达到安全上限。".into()
        } else {
            "文档正文已提取。".into()
        },
        command: preview.command.name().into(),
        output_chars: text.chars().count(),
        truncated: stdout.truncated,
        audit_recorded: false,
        error_code: None,
        text: Some(text),
    })
}

fn cancelled_terminal_result(
    preview: &StoredTerminalPreview,
    started: bool,
) -> TerminalExecutionResult {
    TerminalExecutionResult {
        ok: false,
        summary: if started {
            "受控文档工具已取消，未保留部分正文。".into()
        } else {
            "受控文档工具未开始，运行已取消。".into()
        },
        command: preview.command.name().into(),
        output_chars: 0,
        truncated: false,
        audit_recorded: false,
        error_code: Some("cancelled".into()),
        text: None,
    }
}

fn timeout_terminal_result(preview: &StoredTerminalPreview) -> TerminalExecutionResult {
    TerminalExecutionResult {
        ok: false,
        summary: "受控文档工具超时，已停止执行。".into(),
        command: preview.command.name().into(),
        output_chars: 0,
        truncated: false,
        audit_recorded: false,
        error_code: Some("timeout".into()),
        text: None,
    }
}

fn finalize_terminal_execution_with_audit(
    state: &WorkAssistantState,
    command: TerminalCommand,
    execution: TerminalExecutionResult,
) -> Result<TerminalExecutionResult, WorkAssistantError> {
    append_terminal_audit(state, command, &execution)?;
    Ok(TerminalExecutionResult {
        audit_recorded: true,
        ..execution
    })
}

fn append_terminal_audit(
    state: &WorkAssistantState,
    command: TerminalCommand,
    result: &TerminalExecutionResult,
) -> Result<(), WorkAssistantError> {
    append_audit_entry(
        state,
        &AuditEntry::new(
            "terminal_document_command",
            format!(
                "command={};ok={};chars={};truncated={};code={}",
                command.name(),
                result.ok,
                result.output_chars,
                result.truncated,
                result.error_code.as_deref().unwrap_or("none"),
            ),
        ),
    )
}

fn is_run_cancelled(state: &WorkAssistantState, run_id: &str) -> Result<bool, WorkAssistantError> {
    state
        .cancelled_runs
        .lock()
        .map_err(|_| WorkAssistantError::protocol("cancelled runs lock is unavailable"))
        .map(|runs| runs.contains(run_id))
}

fn resolve_catalog_executable(
    command: TerminalCommand,
) -> Result<ExecutableFingerprint, WorkAssistantError> {
    catalog_candidates(command)
        .into_iter()
        .find_map(|candidate| fingerprint_catalog_executable(&candidate).ok())
        .ok_or_else(|| WorkAssistantError::blocked(command.installation_hint()))
}

fn fingerprint_catalog_executable(
    candidate: &Path,
) -> Result<ExecutableFingerprint, WorkAssistantError> {
    let path = fs::canonicalize(candidate).map_err(|error| {
        WorkAssistantError::blocked(format!("could not resolve terminal executable: {error}"))
    })?;
    let metadata = fs::metadata(&path).map_err(|error| {
        WorkAssistantError::blocked(format!("could not inspect terminal executable: {error}"))
    })?;
    if !metadata.is_file() || metadata.len() > MAX_EXECUTABLE_BYTES {
        return Err(WorkAssistantError::blocked(
            "terminal executable is not a supported regular file",
        ));
    }
    let digest = digest_catalog_executable(&path, metadata.len())?;
    let after = fs::metadata(&path).map_err(|error| {
        WorkAssistantError::blocked(format!("could not recheck terminal executable: {error}"))
    })?;
    if after.len() != metadata.len()
        || modified_fingerprint(&after) != modified_fingerprint(&metadata)
    {
        return Err(WorkAssistantError::stale_preview(
            "terminal executable changed while its preview was being captured",
        ));
    }
    Ok(ExecutableFingerprint {
        path,
        byte_len: metadata.len(),
        modified: modified_fingerprint(&metadata),
        digest,
    })
}

fn digest_catalog_executable(
    path: &Path,
    expected_len: u64,
) -> Result<[u8; 32], WorkAssistantError> {
    let mut file = fs::File::open(path).map_err(|error| {
        WorkAssistantError::blocked(format!("could not read terminal executable: {error}"))
    })?;
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 8192];
    loop {
        let count = file.read(&mut buffer).map_err(|error| {
            WorkAssistantError::blocked(format!("could not hash terminal executable: {error}"))
        })?;
        if count == 0 {
            break;
        }
        total = total.saturating_add(count as u64);
        if total > expected_len || total > MAX_EXECUTABLE_BYTES {
            return Err(WorkAssistantError::stale_preview(
                "terminal executable changed while it was being inspected",
            ));
        }
        hasher.update(&buffer[..count]);
    }
    if total != expected_len {
        return Err(WorkAssistantError::stale_preview(
            "terminal executable changed while it was being inspected",
        ));
    }
    Ok(hasher.finalize().into())
}

fn catalog_candidates(command: TerminalCommand) -> Vec<PathBuf> {
    let executable = match command {
        TerminalCommand::PdfToText => executable_name("pdftotext"),
        TerminalCommand::DocumentToText => executable_name("pandoc"),
    };
    let mut candidates = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            let base = PathBuf::from(program_files);
            match command {
                TerminalCommand::PdfToText => candidates.push(
                    base.join("poppler")
                        .join("Library")
                        .join("bin")
                        .join(&executable),
                ),
                TerminalCommand::DocumentToText => {
                    candidates.push(base.join("Pandoc").join(&executable))
                }
            }
        }
        if let Some(program_data) = std::env::var_os("ProgramData") {
            candidates.push(
                PathBuf::from(program_data)
                    .join("chocolatey")
                    .join("bin")
                    .join(&executable),
            );
        }
    }
    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin").join(&executable));
        candidates.push(PathBuf::from("/usr/local/bin").join(&executable));
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin").join(&executable));
        candidates.push(PathBuf::from("/usr/local/bin").join(&executable));
        candidates.push(PathBuf::from("/usr/bin").join(&executable));
    }
    candidates
}

fn executable_name(base: &str) -> OsString {
    #[cfg(target_os = "windows")]
    {
        return OsString::from(format!("{base}.exe"));
    }
    #[cfg(not(target_os = "windows"))]
    OsString::from(base)
}

fn validate_identifier(value: &str, label: &str) -> Result<(), WorkAssistantError> {
    if value.is_empty()
        || value.chars().count() > MAX_IDENTIFIER_CHARS
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err(WorkAssistantError::blocked(format!(
            "terminal {label} is invalid"
        )));
    }
    Ok(())
}

fn modified_fingerprint(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default()
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

struct CappedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

fn read_capped<R: Read>(mut reader: R) -> CappedOutput {
    let mut bytes = Vec::with_capacity(MAX_OUTPUT_BYTES);
    let mut buffer = [0u8; 4096];
    let mut truncated = false;
    loop {
        let read = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        let available = MAX_OUTPUT_BYTES.saturating_sub(bytes.len());
        let keep = available.min(read);
        bytes.extend_from_slice(&buffer[..keep]);
        if keep < read {
            truncated = true;
        }
    }
    CappedOutput { bytes, truncated }
}

fn join_capped(
    reader: thread::JoinHandle<CappedOutput>,
) -> Result<CappedOutput, WorkAssistantError> {
    reader
        .join()
        .map_err(|_| WorkAssistantError::protocol("terminal output reader stopped unexpectedly"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::HashSet,
        ffi::OsStr,
        sync::{Mutex, OnceLock, RwLock},
    };

    fn test_state() -> WorkAssistantState {
        WorkAssistantState {
            roots: RwLock::new(Vec::new()),
            previews: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            cancelled_runs: Mutex::new(HashSet::new()),
            cancelled_execution_audits: Mutex::new(HashSet::new()),
            audit_path: std::env::temp_dir()
                .join(format!("terminal-audit-{}.jsonl", Uuid::new_v4())),
            audit_guard: Mutex::new(()),
        }
    }

    fn test_source_snapshot_summary() -> SourceSnapshotSummary {
        static SUMMARY: OnceLock<SourceSnapshotSummary> = OnceLock::new();
        SUMMARY
            .get_or_init(|| {
                let root =
                    std::env::temp_dir().join(format!("terminal-fixture-{}", Uuid::new_v4()));
                fs::create_dir_all(&root).unwrap();
                fs::write(root.join("source.pdf"), b"fixture").unwrap();
                let summary = {
                    let snapshot =
                        crate::work_assistant::platform::open_source_snapshot(&root, "source.pdf")
                            .unwrap();
                    snapshot.summary().clone()
                };
                fs::remove_dir_all(root).unwrap();
                summary
            })
            .clone()
    }

    fn terminal_preview_fixture(id: &str, run_id: &str, expires_at: u64) -> StoredTerminalPreview {
        StoredTerminalPreview {
            id: id.into(),
            run_id: run_id.into(),
            root_id: "root".into(),
            relative_path: "source.pdf".into(),
            source_snapshot: test_source_snapshot_summary(),
            source_extension: OsString::from("pdf"),
            command: TerminalCommand::PdfToText,
            executable: ExecutableFingerprint {
                path: PathBuf::from("pdftotext"),
                byte_len: 1,
                modified: 1,
                digest: [0; 32],
            },
            expires_at,
        }
    }

    #[test]
    fn terminal_lookup_prunes_expired_capabilities() {
        let terminal = init_controlled_terminal_state();
        terminal.previews.lock().unwrap().insert(
            "expired-preview".into(),
            terminal_preview_fixture("expired-preview", "run-expired", 0),
        );
        terminal.approvals.lock().unwrap().insert(
            "expired-approval".into(),
            StoredTerminalApproval {
                token: "expired-approval".into(),
                preview_id: "expired-preview".into(),
                run_id: "run-expired".into(),
                expires_at: 0,
            },
        );

        let error = terminal_preview(&terminal, "expired-preview").unwrap_err();

        assert_eq!(error.code, "stale_preview");
        assert!(terminal.previews.lock().unwrap().is_empty());
        assert!(terminal.approvals.lock().unwrap().is_empty());
    }

    #[test]
    fn terminal_lookup_bounds_retained_preview_state() {
        let terminal = init_controlled_terminal_state();
        let future = u64::MAX - 1024;
        for index in 0..129 {
            let id = format!("preview-{index}");
            terminal.previews.lock().unwrap().insert(
                id.clone(),
                terminal_preview_fixture(&id, "run", future + index),
            );
            terminal.approvals.lock().unwrap().insert(
                format!("approval-{index}"),
                StoredTerminalApproval {
                    token: format!("approval-{index}"),
                    preview_id: id,
                    run_id: "run".into(),
                    expires_at: future + index,
                },
            );
        }

        terminal_preview(&terminal, "preview-128").unwrap();

        assert!(terminal.previews.lock().unwrap().len() <= 128);
        assert!(terminal.approvals.lock().unwrap().len() <= 128);
        assert!(!terminal.previews.lock().unwrap().contains_key("preview-0"));
        assert!(!terminal
            .approvals
            .lock()
            .unwrap()
            .contains_key("approval-0"));
    }

    #[test]
    fn cancelling_a_run_removes_its_terminal_capabilities() {
        let terminal = init_controlled_terminal_state();
        terminal.previews.lock().unwrap().insert(
            "cancelled-preview".into(),
            terminal_preview_fixture("cancelled-preview", "cancel-me", u64::MAX),
        );
        terminal.previews.lock().unwrap().insert(
            "other-preview".into(),
            terminal_preview_fixture("other-preview", "other-run", u64::MAX),
        );
        terminal.approvals.lock().unwrap().insert(
            "cancelled-approval".into(),
            StoredTerminalApproval {
                token: "cancelled-approval".into(),
                preview_id: "cancelled-preview".into(),
                run_id: "cancel-me".into(),
                expires_at: u64::MAX,
            },
        );
        terminal.approvals.lock().unwrap().insert(
            "other-approval".into(),
            StoredTerminalApproval {
                token: "other-approval".into(),
                preview_id: "other-preview".into(),
                run_id: "other-run".into(),
                expires_at: u64::MAX,
            },
        );

        cancel_controlled_terminal_run(&terminal, "cancel-me").unwrap();

        assert!(!terminal
            .previews
            .lock()
            .unwrap()
            .contains_key("cancelled-preview"));
        assert!(!terminal
            .approvals
            .lock()
            .unwrap()
            .contains_key("cancelled-approval"));
        assert!(terminal
            .previews
            .lock()
            .unwrap()
            .contains_key("other-preview"));
        assert!(terminal
            .approvals
            .lock()
            .unwrap()
            .contains_key("other-approval"));
    }

    #[test]
    fn taking_a_terminal_preview_consumes_it() {
        let terminal = init_controlled_terminal_state();
        terminal.previews.lock().unwrap().insert(
            "preview".into(),
            terminal_preview_fixture("preview", "run", u64::MAX),
        );

        let preview = take_terminal_preview(&terminal, "preview").unwrap();

        assert_eq!(preview.id, "preview");
        assert!(terminal.previews.lock().unwrap().is_empty());
    }

    #[test]
    fn audit_failure_prevents_a_terminal_success_result() {
        let state = test_state();
        crate::work_assistant::inject_audit_append_failure_once();

        let error = finalize_terminal_execution_with_audit(
            &state,
            TerminalCommand::PdfToText,
            TerminalExecutionResult {
                ok: true,
                summary: "extracted".into(),
                command: "terminal_pdf_to_text".into(),
                output_chars: 9,
                truncated: false,
                audit_recorded: false,
                error_code: None,
                text: Some("contents".into()),
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "audit_unavailable");
    }

    #[test]
    fn terminal_staging_uses_snapshot_bytes_and_cleans_up() {
        let root = std::env::temp_dir().join(format!("terminal-source-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("source.pdf"), b"snapshot contents").unwrap();
        let snapshot =
            crate::work_assistant::platform::open_source_snapshot(&root, "source.pdf").unwrap();

        let staged = stage_terminal_source(&snapshot, OsStr::new("pdf")).unwrap();
        let staged_path = staged.path.clone();

        assert_eq!(staged_path.extension(), Some(OsStr::new("pdf")));
        assert_eq!(fs::read(&staged_path).unwrap(), b"snapshot contents");
        assert_ne!(staged_path, root.join("source.pdf"));

        drop(staged);
        drop(snapshot);
        assert!(!staged_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn terminal_arguments_only_accept_the_catalog_shape() {
        let valid = parse_terminal_arguments(&serde_json::json!({
            "rootId": "root-1",
            "path": "source/report.pdf",
        }))
        .unwrap();
        assert_eq!(valid, ("root-1".into(), "source/report.pdf".into()));
        assert!(parse_terminal_arguments(&serde_json::json!({
            "rootId": "root-1",
            "path": "source/report.pdf",
            "command": "cmd.exe",
        }))
        .is_err());
    }

    #[test]
    fn catalog_only_exposes_document_extractors() {
        assert_eq!(
            TerminalCommand::parse("terminal_pdf_to_text"),
            Some(TerminalCommand::PdfToText)
        );
        assert_eq!(
            TerminalCommand::parse("terminal_document_to_text"),
            Some(TerminalCommand::DocumentToText)
        );
        assert_eq!(TerminalCommand::parse("terminal_shell"), None);
    }

    #[test]
    fn output_reader_enforces_a_fixed_memory_cap() {
        let result = read_capped(std::io::Cursor::new(vec![b'x'; MAX_OUTPUT_BYTES + 9]));
        assert_eq!(result.bytes.len(), MAX_OUTPUT_BYTES);
        assert!(result.truncated);
    }

    #[test]
    fn document_catalog_rejects_wrong_extensions_before_execution() {
        assert!(TerminalCommand::PdfToText.accepts_extension("pdf"));
        assert!(!TerminalCommand::PdfToText.accepts_extension("docx"));
        assert!(TerminalCommand::DocumentToText.accepts_extension("docx"));
        assert!(!TerminalCommand::DocumentToText.accepts_extension("exe"));
    }
}
