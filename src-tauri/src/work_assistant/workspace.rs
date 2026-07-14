use crate::work_assistant::{
    path_is_within, AssistantErrorPayload, AuthorizedRoot, AuthorizedRootKind, FileInspection,
    FileSearchResult, PathPolicy, WorkAssistantError, WorkAssistantState, WorkspaceEntry,
    WorkspaceScan,
};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};
use tauri::State;

const MAX_SCAN_DEPTH: usize = 8;
const MAX_SCAN_ENTRIES: usize = 5_000;
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SEARCH_TEXT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_EXCERPT_CHARS: usize = 8_000;

#[tauri::command]
pub fn work_assistant_workspace_list(
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
pub fn work_assistant_workspace_scan(
    state: State<'_, WorkAssistantState>,
    root_id: String,
) -> Result<WorkspaceScan, AssistantErrorPayload> {
    let roots = read_roots(&state)?;
    scan_workspace(&roots, &root_id).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_file_search(
    state: State<'_, WorkAssistantState>,
    root_id: String,
    query: String,
) -> Result<FileSearchResult, AssistantErrorPayload> {
    let roots = read_roots(&state)?;
    search_workspace(&roots, &root_id, &query).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_file_inspect(
    state: State<'_, WorkAssistantState>,
    root_id: String,
    path: String,
) -> Result<FileInspection, AssistantErrorPayload> {
    let roots = read_roots(&state)?;
    inspect_file(&roots, &root_id, Path::new(&path)).map_err(Into::into)
}

#[tauri::command]
pub fn work_assistant_downloads_scan(
    state: State<'_, WorkAssistantState>,
    root_id: String,
) -> Result<WorkspaceScan, AssistantErrorPayload> {
    let roots = read_roots(&state)?;
    require_downloads_root(&roots, &root_id).map_err(AssistantErrorPayload::from)?;
    scan_workspace(&roots, &root_id).map_err(Into::into)
}

fn require_downloads_root<'a>(
    roots: &'a [AuthorizedRoot],
    root_id: &str,
) -> Result<&'a AuthorizedRoot, WorkAssistantError> {
    let root = roots
        .iter()
        .find(|root| root.id == root_id)
        .ok_or_else(|| WorkAssistantError::blocked("authorized Downloads root was not found"))?;
    if !matches!(root.kind, AuthorizedRootKind::Downloads) {
        return Err(WorkAssistantError::blocked(
            "selected root is not authorized as a Downloads directory",
        ));
    }
    Ok(root)
}

pub fn scan_workspace(
    roots: &[AuthorizedRoot],
    root_id: &str,
) -> Result<WorkspaceScan, WorkAssistantError> {
    let policy = PathPolicy::new(roots);
    let root = policy.resolve_existing(root_id, Path::new(""))?;
    let mut scan = WorkspaceScan {
        root_id: root_id.to_string(),
        entries: Vec::new(),
        truncated: false,
    };
    collect_entries(&policy, root_id, &root, &root, Path::new(""), 0, &mut scan)?;
    Ok(scan)
}

pub fn search_workspace(
    roots: &[AuthorizedRoot],
    root_id: &str,
    query: &str,
) -> Result<FileSearchResult, WorkAssistantError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(WorkAssistantError::blocked("search query is required"));
    }
    let scan = scan_workspace(roots, root_id)?;
    let needle = query.to_lowercase();
    let policy = PathPolicy::new(roots);
    let root = policy.resolve_existing(root_id, Path::new(""))?;
    let mut entries = Vec::new();
    let mut truncated = scan.truncated;
    let mut remaining_text_bytes = MAX_SEARCH_TEXT_BYTES;

    for entry in scan.entries {
        if entries.len() >= MAX_SCAN_ENTRIES {
            truncated = true;
            break;
        }
        let path = policy.resolve_existing(root_id, Path::new(&entry.path))?;
        if !is_eligible_workspace_path(&root, Path::new(&entry.path), &path, &entry.extension) {
            continue;
        }
        let name_matches = entry.name.to_lowercase().contains(&needle);
        let content_matches =
            if !name_matches && entry.kind == "file" && is_text_extension(&entry.extension) {
                let candidate = root.join(&entry.path);
                let (file, size) = match open_verified_text_file(&candidate, &root, &path) {
                    Ok(file) => file,
                    Err(_) => continue,
                };
                if size > remaining_text_bytes {
                    truncated = true;
                    break;
                }
                remaining_text_bytes -= size;
                read_text_from_file(file)
                    .map(|text| text.to_lowercase().contains(&needle))
                    .unwrap_or(false)
            } else {
                false
            };
        if name_matches || content_matches {
            entries.push(entry);
        }
    }

    Ok(FileSearchResult { entries, truncated })
}

pub fn inspect_file(
    roots: &[AuthorizedRoot],
    root_id: &str,
    requested_path: &Path,
) -> Result<FileInspection, WorkAssistantError> {
    let policy = PathPolicy::new(roots);
    let root = policy.resolve_existing(root_id, Path::new(""))?;
    let path = policy.resolve_existing(root_id, requested_path)?;
    let extension = extension_for(&path);
    if !is_eligible_workspace_path(&root, requested_path, &path, &extension) {
        return Err(WorkAssistantError::blocked(
            "this workspace file is not eligible for inspection",
        ));
    }
    if !is_text_extension(&extension) {
        return Err(WorkAssistantError::blocked(
            "this file type cannot be inspected as text",
        ));
    }
    let candidate = root.join(requested_path);
    let (file, _) = open_verified_text_file(&candidate, &root, &path)?;
    let text = read_text_from_file(file)?;
    let excerpt = text.chars().take(MAX_EXCERPT_CHARS).collect::<String>();
    Ok(FileInspection {
        path: requested_path.to_string_lossy().to_string(),
        truncated: text.chars().count() > MAX_EXCERPT_CHARS,
        excerpt,
    })
}

fn read_roots(state: &WorkAssistantState) -> Result<Vec<AuthorizedRoot>, WorkAssistantError> {
    state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))
        .map(|roots| roots.clone())
}

fn collect_entries(
    policy: &PathPolicy<'_>,
    root_id: &str,
    workspace_root: &Path,
    directory: &Path,
    relative_directory: &Path,
    depth: usize,
    scan: &mut WorkspaceScan,
) -> Result<(), WorkAssistantError> {
    if depth > MAX_SCAN_DEPTH || scan.entries.len() >= MAX_SCAN_ENTRIES {
        scan.truncated = true;
        return Ok(());
    }
    let read_dir = fs::read_dir(directory).map_err(|error| {
        WorkAssistantError::blocked(format!("could not scan workspace: {error}"))
    })?;
    for entry in read_dir {
        if scan.entries.len() >= MAX_SCAN_ENTRIES {
            scan.truncated = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let relative_path = relative_directory.join(&name);
        if relative_path.components().count() > MAX_SCAN_DEPTH {
            scan.truncated = true;
            continue;
        }
        let resolved = match policy.resolve_existing(root_id, &relative_path) {
            Ok(path) => path,
            Err(error) if error.code == "path_outside_workspace" => continue,
            Err(error) => return Err(error),
        };
        let metadata = match fs::metadata(&resolved) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let extension = extension_for(&resolved);
        if !is_eligible_workspace_path(workspace_root, &relative_path, &resolved, &extension) {
            continue;
        }
        if metadata.is_dir() {
            scan.entries
                .push(workspace_entry(&name, &relative_path, "directory", "", 0));
            if depth < MAX_SCAN_DEPTH {
                collect_entries(
                    policy,
                    root_id,
                    workspace_root,
                    &resolved,
                    &relative_path,
                    depth + 1,
                    scan,
                )?;
            } else {
                scan.truncated = true;
            }
        } else if metadata.is_file() {
            scan.entries.push(workspace_entry(
                &name,
                &relative_path,
                "file",
                &extension,
                metadata.len(),
            ));
        }
    }
    Ok(())
}

fn workspace_entry(
    name: &str,
    path: &Path,
    kind: &str,
    extension: &str,
    size: u64,
) -> WorkspaceEntry {
    WorkspaceEntry {
        name: name.to_string(),
        path: path.to_string_lossy().to_string(),
        kind: kind.to_string(),
        extension: extension.to_string(),
        size,
    }
}

fn open_verified_text_file(
    candidate: &Path,
    workspace_root: &Path,
    expected_resolved: &Path,
) -> Result<(fs::File, u64), WorkAssistantError> {
    open_verified_file(candidate, workspace_root, expected_resolved)
}

fn open_verified_file(
    candidate: &Path,
    workspace_root: &Path,
    expected_resolved: &Path,
) -> Result<(fs::File, u64), WorkAssistantError> {
    open_verified_file_with_opener(
        candidate,
        workspace_root,
        expected_resolved,
        open_candidate_file,
    )
}

fn open_verified_file_with_opener(
    candidate: &Path,
    workspace_root: &Path,
    expected_resolved: &Path,
    open_candidate: impl FnOnce(&Path) -> io::Result<fs::File>,
) -> Result<(fs::File, u64), WorkAssistantError> {
    let file = open_candidate(candidate).map_err(|error| {
        WorkAssistantError::blocked(format!("could not open text file: {error}"))
    })?;
    let opened_path = opened_file_path(&file)?;
    if !opened_path_is_within_workspace(workspace_root, &opened_path) {
        return Err(WorkAssistantError::blocked(
            "opened file is outside the authorized workspace",
        ));
    }
    if !opened_path_matches_expected(expected_resolved, &opened_path) {
        return Err(WorkAssistantError::blocked(
            "opened file does not match the resolved workspace path",
        ));
    }

    let metadata = file.metadata().map_err(|error| {
        WorkAssistantError::blocked(format!("could not inspect opened file: {error}"))
    })?;
    if !metadata.is_file() {
        return Err(WorkAssistantError::blocked("workspace path is not a file"));
    }
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(WorkAssistantError::blocked(
            "text inspection is limited to files of 2 MB or less",
        ));
    }
    Ok((file, metadata.len()))
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn open_candidate_file(candidate: &Path) -> io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;

    const O_NOFOLLOW: i32 = 0o400000;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(O_NOFOLLOW)
        .open(candidate)
}

#[cfg(windows)]
fn open_candidate_file(candidate: &Path) -> io::Result<fs::File> {
    fs::File::open(candidate)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
fn open_candidate_file(_: &Path) -> io::Result<fs::File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "verified workspace file opens are not supported on this platform",
    ))
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn opened_file_path(file: &fs::File) -> Result<PathBuf, WorkAssistantError> {
    use std::os::fd::AsRawFd;

    fs::canonicalize(format!("/proc/self/fd/{}", file.as_raw_fd())).map_err(|error| {
        WorkAssistantError::blocked(format!("could not resolve opened workspace file: {error}"))
    })
}

#[cfg(windows)]
fn opened_file_path(file: &fs::File) -> Result<PathBuf, WorkAssistantError> {
    use std::{
        ffi::OsString,
        os::windows::{ffi::OsStringExt, io::AsRawHandle},
    };

    let mut buffer = vec![0u16; 260];
    loop {
        let length = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle() as *mut std::ffi::c_void,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
        if length == 0 {
            return Err(WorkAssistantError::blocked(format!(
                "could not resolve opened workspace file: {}",
                io::Error::last_os_error()
            )));
        }
        if (length as usize) < buffer.len() {
            return Ok(normalize_windows_path(PathBuf::from(OsString::from_wide(
                &buffer[..length as usize],
            ))));
        }
        buffer.resize(length as usize + 1, 0);
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
fn opened_file_path(_: &fs::File) -> Result<PathBuf, WorkAssistantError> {
    Err(WorkAssistantError::blocked(
        "verified workspace file opens are not supported on this platform",
    ))
}

#[cfg(windows)]
fn opened_path_is_within_workspace(workspace_root: &Path, opened_path: &Path) -> bool {
    path_is_within(
        &normalize_windows_path(workspace_root.to_path_buf()),
        &normalize_windows_path(opened_path.to_path_buf()),
    )
}

#[cfg(not(windows))]
fn opened_path_is_within_workspace(workspace_root: &Path, opened_path: &Path) -> bool {
    path_is_within(workspace_root, opened_path)
}

#[cfg(windows)]
fn opened_path_matches_expected(expected_path: &Path, opened_path: &Path) -> bool {
    normalize_windows_path(expected_path.to_path_buf())
        == normalize_windows_path(opened_path.to_path_buf())
}

#[cfg(not(windows))]
fn opened_path_matches_expected(expected_path: &Path, opened_path: &Path) -> bool {
    expected_path == opened_path
}

#[cfg(windows)]
fn normalize_windows_path(path: PathBuf) -> PathBuf {
    use std::{
        ffi::OsString,
        os::windows::ffi::{OsStrExt, OsStringExt},
    };

    let wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
    const EXTENDED_PREFIX: &[u16] = &[b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    const EXTENDED_UNC_PREFIX: &[u16] = &[
        b'\\' as u16,
        b'\\' as u16,
        b'?' as u16,
        b'\\' as u16,
        b'U' as u16,
        b'N' as u16,
        b'C' as u16,
        b'\\' as u16,
    ];
    if wide.len() >= EXTENDED_UNC_PREFIX.len()
        && wide_prefix_equals_ignore_ascii_case(&wide, EXTENDED_UNC_PREFIX)
    {
        let mut normalized = vec![b'\\' as u16, b'\\' as u16];
        normalized.extend_from_slice(&wide[EXTENDED_UNC_PREFIX.len()..]);
        return PathBuf::from(OsString::from_wide(&normalized));
    }
    if wide.len() >= EXTENDED_PREFIX.len()
        && wide_prefix_equals_ignore_ascii_case(&wide, EXTENDED_PREFIX)
    {
        return PathBuf::from(OsString::from_wide(&wide[EXTENDED_PREFIX.len()..]));
    }
    path
}

#[cfg(windows)]
fn wide_prefix_equals_ignore_ascii_case(path: &[u16], prefix: &[u16]) -> bool {
    path.starts_with(prefix)
        || path
            .iter()
            .zip(prefix)
            .all(|(path_character, prefix_character)| {
                *path_character <= 0x7f
                    && *prefix_character <= 0x7f
                    && (*path_character as u8).eq_ignore_ascii_case(&(*prefix_character as u8))
            })
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetFinalPathNameByHandleW(
        file: *mut std::ffi::c_void,
        path: *mut u16,
        path_length: u32,
        flags: u32,
    ) -> u32;
}

fn read_text_from_file(file: fs::File) -> Result<String, WorkAssistantError> {
    let mut contents = String::new();
    file.take(MAX_TEXT_BYTES + 1)
        .read_to_string(&mut contents)
        .map_err(|error| {
            WorkAssistantError::blocked(format!("could not read text file: {error}"))
        })?;
    Ok(contents)
}

fn extension_for(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_excluded_name(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | "vendor"
        )
}

fn is_eligible_workspace_path(
    workspace_root: &Path,
    relative_path: &Path,
    resolved_path: &Path,
    extension: &str,
) -> bool {
    is_eligible_relative_path(relative_path)
        && resolved_path
            .strip_prefix(workspace_root)
            .map(|canonical_relative_path| is_eligible_relative_path(canonical_relative_path))
            .unwrap_or(false)
        && !has_hidden_or_system_attribute_in_workspace(workspace_root, resolved_path)
        && !is_dangerous_extension(extension)
}

fn is_eligible_relative_path(path: &Path) -> bool {
    path.components()
        .all(|component| !is_excluded_name(&component.as_os_str().to_string_lossy()))
}

fn is_dangerous_extension(extension: &str) -> bool {
    matches!(
        extension,
        "exe"
            | "dll"
            | "msi"
            | "com"
            | "bat"
            | "cmd"
            | "ps1"
            | "vbs"
            | "js"
            | "jar"
            | "sh"
            | "bash"
            | "zsh"
            | "fish"
            | "app"
            | "scr"
            | "dmg"
            | "pkg"
            | "lnk"
            | "desktop"
    )
}

fn is_text_extension(extension: &str) -> bool {
    matches!(
        extension,
        "txt"
            | "md"
            | "rst"
            | "log"
            | "csv"
            | "json"
            | "toml"
            | "yaml"
            | "yml"
            | "xml"
            | "html"
            | "htm"
            | "css"
            | "rs"
            | "ts"
            | "tsx"
            | "jsx"
            | "py"
            | "go"
            | "java"
            | "c"
            | "h"
            | "cpp"
            | "hpp"
            | "cs"
            | "php"
            | "rb"
            | "sql"
            | "ini"
            | "conf"
    )
}

#[cfg(windows)]
fn has_hidden_or_system_attribute(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;

    fs::metadata(path)
        .map(|metadata| {
            metadata.file_attributes() & 0x2 != 0 || metadata.file_attributes() & 0x4 != 0
        })
        .unwrap_or(true)
}

#[cfg(not(windows))]
fn has_hidden_or_system_attribute(_: &Path) -> bool {
    false
}

fn has_hidden_or_system_attribute_in_workspace(workspace_root: &Path, target: &Path) -> bool {
    has_hidden_or_system_attribute_in_ancestors(
        workspace_root,
        target,
        has_hidden_or_system_attribute,
    )
}

fn has_hidden_or_system_attribute_in_ancestors(
    workspace_root: &Path,
    target: &Path,
    has_hidden_or_system_attribute: impl Fn(&Path) -> bool,
) -> bool {
    let mut candidate = target;
    loop {
        if has_hidden_or_system_attribute(candidate) {
            return true;
        }
        if candidate == workspace_root {
            return false;
        }
        let Some(parent) = candidate.parent() else {
            return false;
        };
        candidate = parent;
    }
}

#[cfg(test)]
mod tests {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    use super::open_verified_file_with_opener;
    use super::{
        has_hidden_or_system_attribute_in_ancestors, inspect_file, require_downloads_root,
        scan_workspace, search_workspace,
    };
    use crate::work_assistant::{AuthorizedRoot, AuthorizedRootKind};
    use std::{
        fs,
        path::{Path, PathBuf},
    };
    use uuid::Uuid;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("papyrus-workspace-{}", Uuid::new_v4()))
    }

    #[test]
    fn scan_excludes_hidden_and_dangerous_entries() {
        let directory = test_dir();
        fs::create_dir_all(directory.join(".private")).unwrap();
        fs::write(directory.join("notes.txt"), "visible").unwrap();
        fs::write(directory.join("run.exe"), "binary").unwrap();
        fs::write(directory.join(".private/secret.txt"), "hidden").unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let scan = scan_workspace(&[root], "root").unwrap();

        assert!(scan.entries.iter().any(|entry| entry.name == "notes.txt"));
        assert!(!scan.entries.iter().any(|entry| entry.name == "run.exe"));
        assert!(!scan.entries.iter().any(|entry| entry.name == ".private"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn downloads_scan_requires_a_root_explicitly_marked_as_downloads() {
        let workspace = AuthorizedRoot {
            id: "workspace".into(),
            label: "Work".into(),
            path: PathBuf::from("workspace"),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };
        let downloads = AuthorizedRoot {
            id: "downloads".into(),
            label: "Downloads".into(),
            path: PathBuf::from("downloads"),
            kind: AuthorizedRootKind::Downloads,
            created_at: 1,
        };

        assert_eq!(
            require_downloads_root(&[workspace.clone()], "workspace")
                .unwrap_err()
                .code,
            "blocked"
        );
        assert_eq!(
            require_downloads_root(&[workspace], "missing")
                .unwrap_err()
                .code,
            "blocked"
        );
        assert!(matches!(
            &require_downloads_root(&[downloads], "downloads")
                .unwrap()
                .kind,
            &AuthorizedRootKind::Downloads
        ));
    }

    #[test]
    fn scan_enforces_depth_and_entry_limits() {
        let directory = test_dir();
        let mut nested = directory.clone();
        for level in 0..10 {
            nested = nested.join(format!("level-{level}"));
            fs::create_dir_all(&nested).unwrap();
        }
        for index in 0..5_010 {
            fs::write(directory.join(format!("entry-{index}.txt")), "x").unwrap();
        }
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let scan = scan_workspace(&[root], "root").unwrap();

        assert!(scan.truncated);
        assert!(scan.entries.len() <= 5_000);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn scan_excludes_entries_deeper_than_eight_relative_components() {
        let directory = test_dir();
        let mut nested = directory.clone();
        for level in 1..=9 {
            nested = nested.join(format!("level-{level}"));
            fs::create_dir_all(&nested).unwrap();
        }
        fs::write(nested.join("too-deep.txt"), "hidden by depth limit").unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let scan = scan_workspace(&[root], "root").unwrap();

        assert!(scan.truncated);
        assert!(scan
            .entries
            .iter()
            .all(|entry| { Path::new(&entry.path).components().count() <= 8 }));
        assert!(!scan.entries.iter().any(|entry| entry.name == "level-9"));
        assert!(!scan
            .entries
            .iter()
            .any(|entry| entry.name == "too-deep.txt"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn inspect_rejects_executables_and_oversized_text() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("program.exe"), "not text").unwrap();
        fs::write(directory.join("large.txt"), vec![b'x'; 2 * 1024 * 1024 + 1]).unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let executable =
            inspect_file(&[root.clone()], "root", Path::new("program.exe")).unwrap_err();
        let oversized = inspect_file(&[root], "root", Path::new("large.txt")).unwrap_err();

        assert_eq!(executable.code, "blocked");
        assert_eq!(oversized.code, "blocked");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn direct_inspect_and_search_exclude_hidden_and_dangerous_text_files() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join(".env"), "SECRET=needle").unwrap();
        fs::write(directory.join("tool.js"), "const needle = true;").unwrap();
        fs::write(directory.join("notes.txt"), "needle").unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let hidden = inspect_file(&[root.clone()], "root", Path::new(".env")).unwrap_err();
        let dangerous = inspect_file(&[root.clone()], "root", Path::new("tool.js")).unwrap_err();
        let search = search_workspace(&[root], "root", "needle").unwrap();

        assert_eq!(hidden.code, "blocked");
        assert_eq!(dangerous.code, "blocked");
        assert!(hidden.message.contains("not eligible"));
        assert!(dangerous.message.contains("not eligible"));
        assert_eq!(search.entries.len(), 1);
        assert_eq!(search.entries[0].name, "notes.txt");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn direct_inspect_and_search_exclude_additional_dangerous_extensions() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        for extension in ["dmg", "pkg", "lnk", "desktop"] {
            fs::write(directory.join(format!("needle.{extension}")), "needle").unwrap();
        }
        fs::write(directory.join("notes.txt"), "needle").unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        for extension in ["dmg", "pkg", "lnk", "desktop"] {
            let error = inspect_file(
                &[root.clone()],
                "root",
                Path::new(&format!("needle.{extension}")),
            )
            .unwrap_err();
            assert_eq!(error.code, "blocked");
        }
        let search = search_workspace(&[root], "root", "needle").unwrap();

        assert_eq!(search.entries.len(), 1);
        assert_eq!(search.entries[0].name, "notes.txt");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn hidden_or_system_attributes_on_workspace_ancestors_are_ineligible() {
        let root = PathBuf::from("workspace");
        let private_directory = root.join("private");
        let target = private_directory.join("notes.txt");

        assert!(has_hidden_or_system_attribute_in_ancestors(
            &root,
            &target,
            |path| { path == private_directory }
        ));
        assert!(!has_hidden_or_system_attribute_in_ancestors(
            &root,
            &target,
            |_| false
        ));
    }

    #[cfg(unix)]
    #[test]
    fn hidden_internal_symlink_is_not_eligible_for_inspection_or_search() {
        use std::os::unix::fs::symlink;

        let directory = test_dir();
        fs::create_dir_all(directory.join(".private")).unwrap();
        fs::write(directory.join(".private/secret.txt"), "needle").unwrap();
        symlink(directory.join(".private"), directory.join("ordinary")).unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let inspection = inspect_file(&[root.clone()], "root", Path::new("ordinary/secret.txt"));
        let search = search_workspace(&[root], "root", "needle").unwrap();

        assert!(inspection.is_err());
        assert!(search.entries.is_empty());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    fn set_hidden_attribute(path: &Path) {
        use std::os::windows::ffi::OsStrExt;

        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        const INVALID_FILE_ATTRIBUTES: u32 = u32::MAX;

        #[link(name = "kernel32")]
        extern "system" {
            fn GetFileAttributesW(file_name: *const u16) -> u32;
            fn SetFileAttributesW(file_name: *const u16, file_attributes: u32) -> i32;
        }

        let wide_path = path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let attributes = unsafe { GetFileAttributesW(wide_path.as_ptr()) };
        assert_ne!(
            attributes,
            INVALID_FILE_ATTRIBUTES,
            "{:#?}",
            std::io::Error::last_os_error()
        );
        assert_ne!(
            unsafe { SetFileAttributesW(wide_path.as_ptr(), attributes | FILE_ATTRIBUTE_HIDDEN) },
            0,
            "{:#?}",
            std::io::Error::last_os_error()
        );
    }

    #[cfg(windows)]
    #[test]
    fn hidden_internal_symlink_is_not_eligible_for_inspection_or_search() {
        use std::os::windows::fs::symlink_dir;

        const ERROR_PRIVILEGE_NOT_HELD: i32 = 1314;

        let directory = test_dir();
        let private_directory = directory.join("private");
        fs::create_dir_all(&private_directory).unwrap();
        fs::write(private_directory.join("secret.txt"), "needle").unwrap();
        set_hidden_attribute(&private_directory);
        match symlink_dir(&private_directory, directory.join("ordinary")) {
            Ok(()) => {}
            // Windows symlink creation requires this privilege unless Developer Mode is enabled.
            Err(error) if error.raw_os_error() == Some(ERROR_PRIVILEGE_NOT_HELD) => {
                fs::remove_dir_all(directory).unwrap();
                return;
            }
            Err(error) => panic!("could not create internal symlink: {error}"),
        }
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let inspection = inspect_file(&[root.clone()], "root", Path::new("ordinary/secret.txt"));
        let search = search_workspace(&[root], "root", "needle").unwrap();

        assert_eq!(inspection.unwrap_err().code, "blocked");
        assert!(search.entries.is_empty());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    #[test]
    fn verified_open_rejects_a_handle_opened_while_a_path_is_retargeted_then_restored() {
        use std::os::unix::fs::symlink;

        let directory = test_dir();
        let workspace = directory.join("workspace");
        let inside = workspace.join("inside.txt");
        let outside = directory.join("outside.txt");
        let link = workspace.join("candidate.txt");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(&inside, "inside").unwrap();
        fs::write(&outside, "outside").unwrap();
        symlink(&inside, &link).unwrap();
        let expected = fs::canonicalize(&inside).unwrap();

        let root = fs::canonicalize(&workspace).unwrap();
        let error = open_verified_file_with_opener(&link, &root, &expected, |candidate| {
            fs::remove_file(&link).unwrap();
            symlink(&outside, &link).unwrap();
            let opened_outside = fs::File::open(candidate).unwrap();
            fs::remove_file(&link).unwrap();
            symlink(&inside, &link).unwrap();
            Ok(opened_outside)
        })
        .unwrap_err();

        assert_eq!(error.code, "blocked");
        assert!(error
            .message
            .contains("opened file is outside the authorized workspace"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn verified_open_accepts_a_windows_handle_within_the_workspace() {
        use super::open_verified_file;

        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        let target = directory.join("notes.txt");
        fs::write(&target, "inside").unwrap();
        let root = fs::canonicalize(&directory).unwrap();
        let expected = fs::canonicalize(&target).unwrap();

        assert!(open_verified_file(&target, &root, &expected).is_ok());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn search_stops_when_aggregate_content_budget_is_exhausted() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        for index in 0..9 {
            fs::write(
                directory.join(format!("document-{index}.txt")),
                vec![b'x'; 2 * 1024 * 1024 - 6]
                    .into_iter()
                    .chain(b"needle".iter().copied())
                    .collect::<Vec<_>>(),
            )
            .unwrap();
        }
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let search = search_workspace(&[root], "root", "needle").unwrap();

        assert!(search.truncated);
        assert_eq!(search.entries.len(), 8);
        fs::remove_dir_all(directory).unwrap();
    }
}
