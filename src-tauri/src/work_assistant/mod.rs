mod audit;
mod path_policy;
mod registry;
mod types;
mod workspace;

pub use audit::*;
pub use path_policy::*;
pub use registry::*;
pub use types::*;
pub use workspace::*;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Mutex, RwLock},
};
use tauri::Manager;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPreview {
    pub id: String,
    pub run: String,
    pub revision: u64,
    pub risk: String,
    pub scope: Vec<String>,
    pub payload: Value,
    pub expires: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredApproval {
    pub token: String,
    pub preview: String,
    pub revision: u64,
    pub run: String,
    pub scope: Vec<String>,
    pub once: bool,
    pub expires: u64,
}

pub struct WorkAssistantState {
    pub(crate) roots: RwLock<Vec<AuthorizedRoot>>,
    pub(crate) previews: Mutex<HashMap<String, StoredPreview>>,
    pub(crate) approvals: Mutex<HashMap<String, StoredApproval>>,
    pub(crate) cancelled_runs: Mutex<HashSet<String>>,
    pub(crate) audit_path: PathBuf,
    pub(crate) audit_guard: Mutex<()>,
}

pub fn init_state(app: &tauri::AppHandle) -> Result<WorkAssistantState, WorkAssistantError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        WorkAssistantError::protocol(format!("could not locate app data directory: {error}"))
    })?;
    load_state_from_data_dir(&data_dir)
}

fn load_state_from_data_dir(data_dir: &Path) -> Result<WorkAssistantState, WorkAssistantError> {
    fs::create_dir_all(&data_dir).map_err(|error| {
        WorkAssistantError::protocol(format!("could not create app data directory: {error}"))
    })?;

    let audit_path = data_dir.join("work-assistant.jsonl");
    let roots_path = data_dir.join("work-assistant-roots.json");
    let roots = load_roots(&roots_path)?;

    Ok(WorkAssistantState {
        roots: RwLock::new(roots),
        previews: Mutex::new(HashMap::new()),
        approvals: Mutex::new(HashMap::new()),
        cancelled_runs: Mutex::new(HashSet::new()),
        audit_path,
        audit_guard: Mutex::new(()),
    })
}

pub(crate) fn persist_roots(
    state: &WorkAssistantState,
    roots: &[AuthorizedRoot],
) -> Result<(), WorkAssistantError> {
    persist_roots_at(&roots_path(state), roots)
}

fn persist_roots_at(path: &Path, roots: &[AuthorizedRoot]) -> Result<(), WorkAssistantError> {
    let serialized = serde_json::to_vec_pretty(roots).map_err(|error| {
        WorkAssistantError::protocol(format!("could not serialize authorized roots: {error}"))
    })?;

    persist_serialized_roots_with(
        path,
        &serialized,
        write_temporary_roots_file,
        replace_temporary_roots_file,
    )
}

fn persist_serialized_roots_with<WriteTemporary, ReplaceTemporary>(
    path: &Path,
    serialized: &[u8],
    write_temporary: WriteTemporary,
    replace_temporary: ReplaceTemporary,
) -> Result<(), WorkAssistantError>
where
    WriteTemporary: FnOnce(&Path, &[u8]) -> io::Result<()>,
    ReplaceTemporary: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(directory).map_err(|error| {
        WorkAssistantError::protocol(format!(
            "could not create authorized roots directory: {error}"
        ))
    })?;

    let temporary_path = temporary_roots_path(path)?;
    let result = write_temporary(&temporary_path, serialized)
        .map_err(|error| {
            WorkAssistantError::protocol(format!(
                "could not write temporary authorized roots file: {error}"
            ))
        })
        .and_then(|_| {
            replace_temporary(&temporary_path, path).map_err(|error| {
                WorkAssistantError::protocol(format!(
                    "could not atomically replace authorized roots file: {error}"
                ))
            })
        });

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    result
}

fn temporary_roots_path(path: &Path) -> Result<PathBuf, WorkAssistantError> {
    let file_name = path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .ok_or_else(|| {
            WorkAssistantError::protocol("authorized roots path has no valid file name")
        })?;
    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));

    Ok(directory.join(format!(".{file_name}.tmp-{}", Uuid::new_v4())))
}

fn write_temporary_roots_file(path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)?;
    file.write_all(contents)?;
    file.sync_all()
}

#[cfg(not(windows))]
fn replace_temporary_roots_file(temporary_path: &Path, path: &Path) -> io::Result<()> {
    fs::rename(temporary_path, path)
}

#[cfg(windows)]
fn replace_temporary_roots_file(temporary_path: &Path, path: &Path) -> io::Result<()> {
    match fs::metadata(path) {
        Ok(_) => replace_existing_file_windows(path, temporary_path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::rename(temporary_path, path),
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn replace_existing_file_windows(path: &Path, temporary_path: &Path) -> io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt, ptr};

    let target = path
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let replacement = temporary_path
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();

    // ReplaceFileW preserves the existing registry until Windows can replace it with the fully
    // synced temporary file. The target and temporary file are siblings on the same volume.
    let replaced = unsafe {
        ReplaceFileW(
            target.as_ptr(),
            replacement.as_ptr(),
            ptr::null(),
            0,
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    if replaced == 0 {
        return Err(io::Error::last_os_error());
    }

    Ok(())
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn ReplaceFileW(
        replaced_file_name: *const u16,
        replacement_file_name: *const u16,
        backup_file_name: *const u16,
        replace_flags: u32,
        exclude: *mut std::ffi::c_void,
        reserved: *mut std::ffi::c_void,
    ) -> i32;
}

fn load_roots(path: &Path) -> Result<Vec<AuthorizedRoot>, WorkAssistantError> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(WorkAssistantError::protocol(format!(
                "could not read authorized roots: {error}"
            )))
        }
    };

    serde_json::from_slice(&contents).map_err(|error| {
        WorkAssistantError::protocol(format!("could not parse authorized roots: {error}"))
    })
}

fn roots_path(state: &WorkAssistantState) -> PathBuf {
    state
        .audit_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("work-assistant-roots.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io};
    use uuid::Uuid;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("papyrus-work-assistant-roots-{}", Uuid::new_v4()))
    }

    fn root(id: &str, label: &str) -> AuthorizedRoot {
        AuthorizedRoot {
            id: id.into(),
            label: label.into(),
            path: PathBuf::from(format!("C:/test/{id}")),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        }
    }

    #[test]
    fn atomically_persists_and_loads_authorized_roots() {
        let directory = test_dir();
        let path = directory.join("work-assistant-roots.json");
        let roots = vec![root("first", "First")];

        persist_roots_at(&path, &roots).unwrap();

        let loaded = load_roots(&path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "first");
        assert_eq!(loaded[0].label, "First");

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn state_load_does_not_parse_historical_audit_entries() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("work-assistant.jsonl"),
            b"not valid audit json",
        )
        .unwrap();

        let state = load_state_from_data_dir(&directory).unwrap();

        assert_eq!(state.audit_path, directory.join("work-assistant.jsonl"));
        assert!(state.roots.read().unwrap().is_empty());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn dependency_lockfile_does_not_include_rayon_packages() {
        let lockfile = include_str!("../../Cargo.lock");

        assert!(!lockfile.contains("name = \"rayon\""));
        assert!(!lockfile.contains("name = \"rayon-core\""));
    }

    #[test]
    fn failed_temporary_write_preserves_existing_valid_roots_file() {
        let directory = test_dir();
        let path = directory.join("work-assistant-roots.json");
        let existing = vec![root("existing", "Existing")];
        let replacement = vec![root("replacement", "Replacement")];
        fs::create_dir_all(&directory).unwrap();
        fs::write(&path, serde_json::to_vec(&existing).unwrap()).unwrap();

        let result = persist_serialized_roots_with(
            &path,
            &serde_json::to_vec(&replacement).unwrap(),
            |temporary_path, _| {
                fs::write(temporary_path, b"partial roots file").unwrap();
                Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "injected temporary write failure",
                ))
            },
            replace_temporary_roots_file,
        );

        assert!(result.is_err());
        let loaded = load_roots(&path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "existing");
        assert_no_temporary_roots_files(&directory);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_atomic_replace_preserves_existing_valid_roots_file() {
        let directory = test_dir();
        let path = directory.join("work-assistant-roots.json");
        let existing = vec![root("existing", "Existing")];
        let replacement = vec![root("replacement", "Replacement")];
        fs::create_dir_all(&directory).unwrap();
        fs::write(&path, serde_json::to_vec(&existing).unwrap()).unwrap();

        let result = persist_serialized_roots_with(
            &path,
            &serde_json::to_vec(&replacement).unwrap(),
            write_temporary_roots_file,
            |_, _| {
                Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "injected replace failure",
                ))
            },
        );

        assert!(result.is_err());
        let loaded = load_roots(&path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "existing");
        assert_no_temporary_roots_files(&directory);

        fs::remove_dir_all(directory).unwrap();
    }

    fn assert_no_temporary_roots_files(directory: &Path) {
        let temporary_files = fs::read_dir(directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains("work-assistant-roots.json.tmp-")
            })
            .count();
        assert_eq!(temporary_files, 0);
    }
}
