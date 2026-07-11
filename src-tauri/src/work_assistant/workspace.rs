use crate::work_assistant::{
    AssistantErrorPayload, AuthorizedRoot, AuthorizedRootKind, FileInspection, FileSearchResult,
    PathPolicy, WorkAssistantError, WorkAssistantState, WorkspaceEntry, WorkspaceScan,
};
use std::{fs, io::Read, path::Path};
use tauri::State;

const MAX_SCAN_DEPTH: usize = 8;
const MAX_SCAN_ENTRIES: usize = 5_000;
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
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
) -> Result<Vec<WorkspaceScan>, AssistantErrorPayload> {
    let roots = read_roots(&state)?;
    roots
        .iter()
        .filter(|root| matches!(root.kind, AuthorizedRootKind::Downloads))
        .map(|root| scan_workspace(&roots, &root.id))
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
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
        let content_matches = if entry.kind == "file" && is_text_extension(&entry.extension) {
            read_text_limited(&path)
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
    let metadata = fs::metadata(&path)
        .map_err(|error| WorkAssistantError::blocked(format!("could not inspect file: {error}")))?;
    if !metadata.is_file() {
        return Err(WorkAssistantError::blocked("workspace path is not a file"));
    }
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
    let text = read_text_limited(&path)?;
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

fn read_text_limited(path: &Path) -> Result<String, WorkAssistantError> {
    let metadata = fs::metadata(path)
        .map_err(|error| WorkAssistantError::blocked(format!("could not inspect file: {error}")))?;
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(WorkAssistantError::blocked(
            "text inspection is limited to files of 2 MB or less",
        ));
    }
    let mut contents = String::new();
    fs::File::open(path)
        .and_then(|file| file.take(MAX_TEXT_BYTES + 1).read_to_string(&mut contents))
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
    relative_path
        .components()
        .all(|component| !is_excluded_name(&component.as_os_str().to_string_lossy()))
        && !has_hidden_or_system_attribute_in_workspace(workspace_root, resolved_path)
        && !is_dangerous_extension(extension)
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
    has_hidden_or_system_attribute_in_ancestors(workspace_root, target, has_hidden_or_system_attribute)
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
    use super::{
        has_hidden_or_system_attribute_in_ancestors, inspect_file, scan_workspace, search_workspace,
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

        assert!(has_hidden_or_system_attribute_in_ancestors(&root, &target, |path| {
            path == private_directory
        }));
        assert!(!has_hidden_or_system_attribute_in_ancestors(&root, &target, |_| false));
    }
}
