//! Controlled desktop capabilities.
//!
//! This module deliberately keeps model-controlled input at the validation boundary.  URLs are
//! restricted to HTTP(S), files are resolved through the existing authorized-root policy, and
//! application launches use an opaque persisted alias with no caller supplied arguments.

use crate::work_assistant::{
    append_audit_entry, platform, AssistantErrorPayload, AuthorizedRoot, DesktopStatus, DiskStatus,
    PathPolicy, RegisteredApplication, WorkAssistantError, WorkAssistantState,
};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::MutexGuard,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;
use uuid::Uuid;

/// Extensions that are never passed to an external opener.  The list intentionally includes
/// executable, shell, installer, and desktop-launcher formats used on the supported platforms.
const BLOCKED_OPEN_EXTENSIONS: &[&str] = &[
    "exe", "dll", "msi", "msix", "app", "dmg", "pkg", "deb", "rpm", "run", "bin", "elf", "sh",
    "bash", "zsh", "fish", "csh", "ksh", "bat", "cmd", "ps1", "psm1", "com", "scr", "lnk",
    "desktop", "py", "pyw", "js", "mjs", "cjs", "ts", "tsx", "jsx", "vbs", "vbe", "wsf", "wsh",
    "hta", "jar", "war", "class",
];

const MAX_APPLICATION_LABEL_LENGTH: usize = 128;
const DEFAULT_AUDIT_LIMIT: usize = 50;

/// Validate an external URL before it reaches a platform opener.
pub fn validate_open_url(value: &str) -> Result<(), WorkAssistantError> {
    if value.trim() != value || value.chars().any(char::is_control) {
        return Err(WorkAssistantError::blocked(
            "URL must not contain surrounding whitespace or control characters",
        ));
    }
    let parsed =
        reqwest::Url::parse(value).map_err(|_| WorkAssistantError::blocked("URL is not valid"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(WorkAssistantError::blocked(
            "only HTTP(S) URLs with a host can be opened",
        ));
    }
    Ok(())
}

/// Validate the extension of a path before it reaches an external opener.  If the path already
/// exists, inspect it for executable signatures as well; root authorization is handled by
/// `resolve_open_path`, while non-existent paths remain useful for pure preview validation.
pub fn validate_open_file(path: impl AsRef<Path>) -> Result<(), WorkAssistantError> {
    let path = path.as_ref();
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    if extension
        .as_deref()
        .is_some_and(|extension| BLOCKED_OPEN_EXTENSIONS.contains(&extension))
    {
        return Err(WorkAssistantError::blocked(
            "executables and script files cannot be opened by the assistant",
        ));
    }
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => return Ok(()),
        Ok(metadata) if !metadata.is_file() => {
            return Err(WorkAssistantError::blocked(
                "only ordinary files and directories can be opened",
            ));
        }
        Ok(metadata) => {
            if file_looks_executable(path, &metadata)? {
                return Err(WorkAssistantError::blocked(
                    "executable and script files cannot be opened by the assistant",
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(WorkAssistantError::blocked(format!(
                "could not inspect the file before opening it: {error}"
            )));
        }
    }
    Ok(())
}

fn file_looks_executable(
    path: &Path,
    _metadata: &fs::Metadata,
) -> Result<bool, WorkAssistantError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if _metadata.permissions().mode() & 0o111 != 0 {
            return Ok(true);
        }
    }

    let mut file = fs::File::open(path).map_err(|error| {
        WorkAssistantError::blocked(format!("could not inspect file contents: {error}"))
    })?;
    let mut prefix = [0u8; 4];
    let length = file.read(&mut prefix).map_err(|error| {
        WorkAssistantError::blocked(format!("could not inspect file contents: {error}"))
    })?;
    if length >= 2 && &prefix[..2] == b"#!" {
        return Ok(true);
    }
    if length >= 2 && &prefix[..2] == b"MZ" {
        return Ok(true);
    }
    if length >= 4
        && matches!(
            prefix,
            [0x7f, b'E', b'L', b'F']
                | [0xfe, 0xed, 0xfa, 0xce]
                | [0xce, 0xfa, 0xed, 0xfe]
                | [0xfe, 0xed, 0xfa, 0xcf]
                | [0xcf, 0xfa, 0xed, 0xfe]
                | [0xca, 0xfe, 0xba, 0xbe]
                | [0xbe, 0xba, 0xfe, 0xca]
        )
    {
        return Ok(true);
    }
    Ok(false)
}

/// Canonicalize a path selected by the user for an application alias.  This is intentionally a
/// separate validation entry point: the frontend must obtain the path from its native picker
/// before calling the `*_from_picker` registration command.
pub fn validate_application_alias_path(
    selected_path: impl AsRef<Path>,
) -> Result<PathBuf, WorkAssistantError> {
    let selected_path = selected_path.as_ref();
    let canonical = fs::canonicalize(selected_path).map_err(|error| {
        WorkAssistantError::blocked(format!("selected application path is unavailable: {error}"))
    })?;
    let metadata = fs::symlink_metadata(&canonical).map_err(|error| {
        WorkAssistantError::blocked(format!("could not inspect selected application: {error}"))
    })?;

    #[cfg(target_os = "macos")]
    {
        let extension = canonical
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase);
        if !metadata.is_dir() || extension.as_deref() != Some("app") {
            return Err(WorkAssistantError::blocked(
                "macOS application aliases must target an .app bundle",
            ));
        }
    }

    #[cfg(windows)]
    {
        let extension = canonical
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase);
        if !metadata.is_file() || !matches!(extension.as_deref(), Some("exe" | "com")) {
            return Err(WorkAssistantError::blocked(
                "Windows application aliases must target an executable file",
            ));
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;

        if !metadata.is_file() {
            return Err(WorkAssistantError::blocked(
                "Linux application aliases must target an executable file",
            ));
        }
        let extension = canonical
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase);
        if extension
            .as_deref()
            .is_some_and(|extension| BLOCKED_OPEN_EXTENSIONS.contains(&extension))
            || metadata.permissions().mode() & 0o111 == 0
            || file_has_shebang(&canonical)?
        {
            return Err(WorkAssistantError::blocked(
                "Linux application aliases must target a user-selected executable",
            ));
        }
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = metadata;
        return Err(WorkAssistantError::blocked(
            "application aliases are unavailable on this platform",
        ));
    }

    Ok(canonical)
}

#[cfg(target_os = "linux")]
fn file_has_shebang(path: &Path) -> Result<bool, WorkAssistantError> {
    let mut file = fs::File::open(path).map_err(|error| {
        WorkAssistantError::blocked(format!("could not inspect selected application: {error}"))
    })?;
    let mut prefix = [0u8; 2];
    let length = file.read(&mut prefix).map_err(|error| {
        WorkAssistantError::blocked(format!("could not inspect selected application: {error}"))
    })?;
    Ok(length == prefix.len() && &prefix == b"#!")
}

fn resolve_existing_path(
    roots: &[AuthorizedRoot],
    root_id: &str,
    requested_path: impl AsRef<Path>,
) -> Result<PathBuf, WorkAssistantError> {
    let resolved = PathPolicy::new(roots).resolve_existing(root_id, requested_path)?;
    let metadata = fs::metadata(&resolved).map_err(|error| {
        WorkAssistantError::blocked(format!("could not inspect workspace path: {error}"))
    })?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(WorkAssistantError::blocked(
            "only ordinary files and directories can be opened",
        ));
    }
    Ok(resolved)
}

fn resolve_open_path(
    roots: &[AuthorizedRoot],
    root_id: &str,
    requested_path: impl AsRef<Path>,
) -> Result<PathBuf, WorkAssistantError> {
    let resolved = resolve_existing_path(roots, root_id, requested_path)?;
    validate_open_file(&resolved)?;
    Ok(resolved)
}

fn resolve_reveal_path(
    roots: &[AuthorizedRoot],
    root_id: &str,
    requested_path: impl AsRef<Path>,
) -> Result<PathBuf, WorkAssistantError> {
    resolve_existing_path(roots, root_id, requested_path)
}

#[tauri::command]
pub fn work_assistant_desktop_status() -> DesktopStatus {
    let mut system = sysinfo::System::new_all();
    system.refresh_all();
    let disks = sysinfo::Disks::new_with_refreshed_list()
        .list()
        .iter()
        .map(|disk| DiskStatus {
            mount_point: disk.mount_point().to_string_lossy().into_owned(),
            total_bytes: disk.total_space(),
            available_bytes: disk.available_space(),
        })
        .collect();

    DesktopStatus {
        platform: std::env::consts::OS.into(),
        cpu_count: system.cpus().len(),
        cpu_usage_percent: system.global_cpu_usage(),
        memory_total_bytes: system.total_memory(),
        memory_used_bytes: system.used_memory(),
        disks,
        capabilities: crate::work_assistant::capability_statuses(),
    }
}

#[tauri::command]
pub fn work_assistant_desktop_open_url(url: String) -> Result<(), AssistantErrorPayload> {
    validate_open_url(&url).map_err(AssistantErrorPayload::from)?;
    platform::desktop::open_url(&url).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_desktop_open_file(
    state: State<'_, WorkAssistantState>,
    root_id: String,
    path: String,
) -> Result<(), AssistantErrorPayload> {
    let roots = state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))
        .map_err(AssistantErrorPayload::from)?;
    let resolved = resolve_open_path(&roots, &root_id, Path::new(&path))
        .map_err(AssistantErrorPayload::from)?;
    platform::desktop::open_path(&resolved).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_desktop_reveal_file(
    state: State<'_, WorkAssistantState>,
    root_id: String,
    path: String,
) -> Result<(), AssistantErrorPayload> {
    let roots = state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))
        .map_err(AssistantErrorPayload::from)?;
    let resolved = resolve_reveal_path(&roots, &root_id, Path::new(&path))
        .map_err(AssistantErrorPayload::from)?;
    platform::desktop::reveal_file(&resolved).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_validate_application_selection(
    path: String,
) -> Result<String, AssistantErrorPayload> {
    validate_application_alias_path(path)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_list_applications(
    state: State<'_, WorkAssistantState>,
) -> Result<Vec<RegisteredApplication>, AssistantErrorPayload> {
    let _guard = application_guard(&state).map_err(AssistantErrorPayload::from)?;
    load_applications(&applications_path(&state)).map_err(Into::into)
}

/// Register a path that was selected by the native picker.  This command deliberately has no
/// model-facing tool manifest; the agent can only launch an already persisted opaque id.
#[tauri::command]
pub fn work_assistant_register_application_from_picker(
    state: State<'_, WorkAssistantState>,
    label: String,
    path: String,
) -> Result<RegisteredApplication, AssistantErrorPayload> {
    register_application_from_picker(&state, label, path).map_err(Into::into)
}

pub fn register_application_from_picker(
    state: &WorkAssistantState,
    label: String,
    selected_path: impl AsRef<Path>,
) -> Result<RegisteredApplication, WorkAssistantError> {
    let label = label.trim();
    if label.is_empty() {
        return Err(WorkAssistantError::blocked(
            "application alias label is required",
        ));
    }
    if label.chars().count() > MAX_APPLICATION_LABEL_LENGTH {
        return Err(WorkAssistantError::blocked(
            "application alias label exceeds 128 characters",
        ));
    }
    let executable_path = validate_application_alias_path(selected_path)?;
    let _guard = application_guard(state)?;
    let path = applications_path(state);
    let mut applications = load_applications(&path)?;
    if applications
        .iter()
        .any(|application| application.executable_path == executable_path)
    {
        return Err(WorkAssistantError::blocked(
            "this application is already registered",
        ));
    }
    let application = RegisteredApplication {
        id: Uuid::new_v4().to_string(),
        label: label.to_string(),
        executable_path,
        platform: std::env::consts::OS.into(),
        created_at: unix_seconds(),
    };
    applications.push(application.clone());
    persist_applications(&path, &applications)?;
    drop(_guard);
    let _ = append_audit_entry(
        state,
        &crate::work_assistant::AuditEntry::new(
            "application_registered",
            format!(
                "applicationId={};label={}",
                application.id, application.label
            ),
        ),
    );
    Ok(application)
}

#[tauri::command]
pub fn work_assistant_remove_application(
    state: State<'_, WorkAssistantState>,
    application_id: String,
) -> Result<(), AssistantErrorPayload> {
    remove_registered_application(&state, &application_id).map_err(Into::into)
}

pub fn remove_registered_application(
    state: &WorkAssistantState,
    application_id: &str,
) -> Result<(), WorkAssistantError> {
    let _guard = application_guard(state)?;
    let path = applications_path(state);
    let mut applications = load_applications(&path)?;
    let previous_len = applications.len();
    applications.retain(|application| application.id != application_id);
    if applications.len() == previous_len {
        return Err(WorkAssistantError::blocked(
            "registered application was not found",
        ));
    }
    persist_applications(&path, &applications)?;
    drop(_guard);
    let _ = append_audit_entry(
        state,
        &crate::work_assistant::AuditEntry::new(
            "application_removed",
            format!("applicationId={application_id}"),
        ),
    );
    Ok(())
}

#[tauri::command]
pub fn work_assistant_launch_application(
    state: State<'_, WorkAssistantState>,
    application_id: String,
) -> Result<(), AssistantErrorPayload> {
    launch_registered_application(&state, &application_id).map_err(Into::into)
}

pub fn launch_registered_application(
    state: &WorkAssistantState,
    application_id: &str,
) -> Result<(), WorkAssistantError> {
    let _guard = application_guard(state)?;
    let applications = load_applications(&applications_path(state))?;
    let application = applications
        .iter()
        .find(|application| application.id == application_id)
        .ok_or_else(|| WorkAssistantError::blocked("registered application was not found"))?;
    let path = validate_application_alias_path(&application.executable_path)?;
    platform::desktop::launch_application(&path)
}

fn applications_path(state: &WorkAssistantState) -> PathBuf {
    state
        .audit_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .join("work-assistant-applications.json")
}

fn application_guard<'a>(
    state: &'a WorkAssistantState,
) -> Result<MutexGuard<'a, ()>, WorkAssistantError> {
    state
        .audit_guard
        .lock()
        .map_err(|_| WorkAssistantError::protocol("application registry lock is unavailable"))
}

fn load_applications(path: &Path) -> Result<Vec<RegisteredApplication>, WorkAssistantError> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(WorkAssistantError::protocol(format!(
                "could not read application aliases: {error}"
            )))
        }
    };
    serde_json::from_slice(&contents).map_err(|error| {
        WorkAssistantError::protocol(format!("could not parse application aliases: {error}"))
    })
}

fn persist_applications(
    path: &Path,
    applications: &[RegisteredApplication],
) -> Result<(), WorkAssistantError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|error| {
        WorkAssistantError::protocol(format!(
            "could not create application registry directory: {error}"
        ))
    })?;
    let serialized = serde_json::to_vec_pretty(applications).map_err(|error| {
        WorkAssistantError::protocol(format!("could not serialize application aliases: {error}"))
    })?;
    let result = persist_serialized_applications_with(
        path,
        &serialized,
        write_application_temporary,
        replace_application_file,
    );
    result
}

fn persist_serialized_applications_with<WriteTemporary, ReplaceTemporary>(
    path: &Path,
    serialized: &[u8],
    write_temporary: WriteTemporary,
    replace_temporary: ReplaceTemporary,
) -> Result<(), WorkAssistantError>
where
    WriteTemporary: FnOnce(&Path, &[u8]) -> io::Result<()>,
    ReplaceTemporary: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let temporary = parent.join(format!(
        ".work-assistant-applications.tmp-{}",
        Uuid::new_v4()
    ));
    let result = write_temporary(&temporary, serialized)
        .map_err(|error| {
            WorkAssistantError::protocol(format!("could not write application aliases: {error}"))
        })
        .and_then(|_| {
            replace_temporary(&temporary, path).map_err(|error| {
                WorkAssistantError::protocol(format!(
                    "could not publish application aliases: {error}"
                ))
            })
        });
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn write_application_temporary(path: &Path, serialized: &[u8]) -> io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)?;
    file.write_all(serialized)?;
    file.sync_all()
}

fn replace_application_file(temporary_path: &Path, path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        return crate::work_assistant::replace_temporary_roots_file(temporary_path, path);
    }
    #[cfg(not(windows))]
    {
        fs::rename(temporary_path, path)
    }
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn audit_page_limit(limit: usize) -> usize {
    if limit == 0 {
        DEFAULT_AUDIT_LIMIT
    } else {
        limit.min(200)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_assistant::{
        AuditEntry, AuthorizedRoot, AuthorizedRootKind, WorkAssistantState,
    };
    use std::{
        collections::{HashMap, HashSet},
        fs,
        path::PathBuf,
        sync::{Mutex, RwLock},
    };

    fn test_state(directory: &Path) -> WorkAssistantState {
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

    #[test]
    fn accepts_http_and_https_urls_only() {
        assert!(validate_open_url("https://example.com/report").is_ok());
        assert!(validate_open_url("http://localhost:8080").is_ok());
        for value in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/plain,hello",
            "https://",
            " https://example.com",
        ] {
            assert!(validate_open_url(value).is_err(), "{value}");
        }
    }

    #[test]
    fn rejects_the_full_open_file_executable_and_script_denylist() {
        for extension in BLOCKED_OPEN_EXTENSIONS {
            let path = PathBuf::from(format!("payload.{extension}"));
            assert_eq!(validate_open_file(&path).unwrap_err().code, "blocked");
        }
        assert!(validate_open_file(Path::new("report.pdf")).is_ok());
        assert!(validate_open_file(Path::new("folder")).is_ok());
    }

    #[test]
    fn rejects_existing_executable_signatures_and_shebang_files_but_allows_plain_files() {
        let directory = std::env::temp_dir().join(format!("papyrus-desktop-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let plain = directory.join("notes.txt");
        let pe = directory.join("binary");
        let script = directory.join("script");
        fs::write(&plain, b"notes").unwrap();
        fs::write(&pe, b"MZ\x90\0").unwrap();
        fs::write(&script, b"#!/bin/sh\necho no\n").unwrap();
        assert!(validate_open_file(&plain).is_ok());
        assert_eq!(validate_open_file(&pe).unwrap_err().code, "blocked");
        assert_eq!(validate_open_file(&script).unwrap_err().code, "blocked");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let executable = directory.join("executable");
            fs::write(&executable, b"plain executable").unwrap();
            let mut permissions = fs::metadata(&executable).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&executable, permissions).unwrap();
            assert_eq!(validate_open_file(&executable).unwrap_err().code, "blocked");
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reveal_resolution_allows_an_executable_target_without_allowing_open_execution() {
        let directory = std::env::temp_dir().join(format!("papyrus-desktop-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("run.exe"), b"MZ\x90\0").unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };
        let roots = vec![root];

        assert!(resolve_reveal_path(&roots, "root", "run.exe").is_ok());
        assert_eq!(
            resolve_open_path(&roots, "root", "run.exe")
                .unwrap_err()
                .code,
            "blocked"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn application_alias_validation_requires_a_user_selectable_target() {
        let directory = std::env::temp_dir().join(format!("papyrus-desktop-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let executable = directory.join(if cfg!(windows) { "tool.exe" } else { "tool" });
        fs::write(&executable, b"placeholder").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&executable).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&executable, permissions).unwrap();
        }
        if cfg!(any(windows, target_os = "linux")) {
            assert!(validate_application_alias_path(&executable).is_ok());
        }
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::PermissionsExt;
            let script = directory.join("script");
            fs::write(&script, b"#!/bin/sh\necho no\n").unwrap();
            let mut permissions = fs::metadata(&script).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script, permissions).unwrap();
            assert_eq!(
                validate_application_alias_path(&script).unwrap_err().code,
                "blocked"
            );
        }
        assert!(validate_application_alias_path(directory.join("run.ps1")).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn application_aliases_persist_and_launch_by_opaque_id_contract() {
        let directory = std::env::temp_dir().join(format!("papyrus-desktop-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let state = test_state(&directory);
        let executable = directory.join(if cfg!(windows) { "tool.exe" } else { "tool" });
        fs::write(&executable, b"placeholder").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&executable).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&executable, permissions).unwrap();
        }
        if cfg!(any(windows, target_os = "linux")) {
            let app =
                register_application_from_picker(&state, "Editor".into(), &executable).unwrap();
            let second_executable = directory.join(if cfg!(windows) {
                "tool-two.exe"
            } else {
                "tool-two"
            });
            fs::write(&second_executable, b"placeholder").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut permissions = fs::metadata(&second_executable).unwrap().permissions();
                permissions.set_mode(0o755);
                fs::set_permissions(&second_executable, permissions).unwrap();
            }
            let second = register_application_from_picker(
                &state,
                "Second editor".into(),
                &second_executable,
            )
            .unwrap();
            let saved = load_applications(&applications_path(&state)).unwrap();
            assert_eq!(saved.len(), 2);
            assert_eq!(saved[0].id, app.id);
            assert_eq!(saved[0].label, "Editor");
            assert_eq!(saved[1].id, second.id);
            assert!(launch_registered_application(&state, "missing").is_err());
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn removing_an_application_alias_persists_the_remaining_registry() {
        let directory = std::env::temp_dir().join(format!("papyrus-desktop-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let state = test_state(&directory);
        let executable = directory.join(if cfg!(windows) { "tool.exe" } else { "tool" });
        fs::write(&executable, b"placeholder").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&executable).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&executable, permissions).unwrap();
        }
        if cfg!(any(windows, target_os = "linux")) {
            let app =
                register_application_from_picker(&state, "Editor".into(), &executable).unwrap();
            remove_registered_application(&state, &app.id).unwrap();
            assert!(load_applications(&applications_path(&state))
                .unwrap()
                .is_empty());
            assert_eq!(
                remove_registered_application(&state, &app.id)
                    .unwrap_err()
                    .code,
                "blocked"
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn audit_page_limit_is_capped_and_defaults_safely() {
        assert_eq!(audit_page_limit(0), 50);
        assert_eq!(audit_page_limit(1), 1);
        assert_eq!(audit_page_limit(999), 200);
    }

    #[test]
    fn failed_application_registry_replace_preserves_the_previous_file() {
        let directory = std::env::temp_dir().join(format!("papyrus-desktop-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("work-assistant-applications.json");
        let previous = br#"[{"id":"old"}]"#;
        let replacement = br#"[{"id":"new"}]"#;
        fs::write(&path, previous).unwrap();

        let error = persist_serialized_applications_with(
            &path,
            replacement,
            write_application_temporary,
            |_, _| Err(io::Error::other("injected replacement failure")),
        )
        .unwrap_err();

        assert_eq!(error.code, "protocol");
        assert_eq!(fs::read(&path).unwrap(), previous);
        assert!(!fs::read_dir(&directory).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".work-assistant-applications.tmp-")
        }));
        fs::remove_dir_all(directory).unwrap();
    }

    #[allow(dead_code)]
    fn _type_contracts_are_serializable() {
        let _ = serde_json::to_value(AuthorizedRootKind::Workspace).unwrap();
        let _ = serde_json::to_value(AuditEntry::new("test", "ok")).unwrap();
    }
}
