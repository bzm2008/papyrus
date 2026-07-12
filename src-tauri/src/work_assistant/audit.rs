use crate::work_assistant::{WorkAssistantError, WorkAssistantState};
use serde::{Deserialize, Serialize};
#[cfg(test)]
use std::cell::RefCell;
use std::{
    fs,
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

#[cfg(test)]
thread_local! {
    static AUDIT_LOCK_TEST_HOOK: RefCell<Option<Box<dyn FnOnce(&std::sync::Mutex<()>)>>> =
        RefCell::new(None);
}

#[cfg(test)]
fn install_audit_lock_test_hook(hook: Box<dyn FnOnce(&std::sync::Mutex<()>)>) {
    AUDIT_LOCK_TEST_HOOK.with(|slot| {
        assert!(
            slot.borrow().is_none(),
            "audit lock test hook is already installed"
        );
        *slot.borrow_mut() = Some(hook);
    });
}

#[cfg(test)]
fn run_audit_lock_test_hook(audit_guard: &std::sync::Mutex<()>) {
    AUDIT_LOCK_TEST_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook(audit_guard);
        }
    });
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub at: u64,
    pub event: String,
    pub detail: String,
}

impl AuditEntry {
    pub fn new(event: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            at: unix_seconds(),
            event: event.into(),
            detail: detail.into(),
        }
    }
}

pub fn append_audit_entry(
    state: &WorkAssistantState,
    entry: &AuditEntry,
) -> Result<(), WorkAssistantError> {
    #[cfg(test)]
    run_audit_lock_test_hook(&state.audit_guard);
    let _guard = state
        .audit_guard
        .lock()
        .map_err(|_| WorkAssistantError::protocol("audit log lock is unavailable"))?;
    append_audit_entry_at(&state.audit_path, entry)
}

fn append_audit_entry_at(path: &Path, entry: &AuditEntry) -> Result<(), WorkAssistantError> {
    let parent = path
        .parent()
        .ok_or_else(|| WorkAssistantError::protocol("audit path has no parent directory"))?;
    fs::create_dir_all(parent).map_err(|error| {
        WorkAssistantError::protocol(format!("could not create audit directory: {error}"))
    })?;
    let mut serialized = serde_json::to_vec(entry).map_err(|error| {
        WorkAssistantError::protocol(format!("could not serialize audit entry: {error}"))
    })?;
    serialized.push(b'\n');
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| {
            WorkAssistantError::protocol(format!("could not open audit log: {error}"))
        })?;
    file.write_all(&serialized)
        .and_then(|_| file.flush())
        .map_err(|error| {
            WorkAssistantError::protocol(format!("could not append audit entry: {error}"))
        })
}

pub fn read_audit_entries(path: &Path) -> Result<Vec<AuditEntry>, WorkAssistantError> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(WorkAssistantError::protocol(format!(
                "could not read audit log: {error}"
            )))
        }
    };

    let lines = contents.lines().collect::<Vec<_>>();
    let mut entries = Vec::with_capacity(lines.len());
    for (index, line) in lines.iter().enumerate().rev() {
        match serde_json::from_str::<AuditEntry>(line) {
            Ok(entry) => entries.push(entry),
            Err(_) if index == lines.len() - 1 && !contents.ends_with('\n') => {}
            Err(error) => {
                return Err(WorkAssistantError::protocol(format!(
                    "could not parse audit entry: {error}"
                )))
            }
        }
    }

    Ok(entries)
}

pub fn clear_audit_entries(state: &WorkAssistantState) -> Result<(), WorkAssistantError> {
    #[cfg(test)]
    run_audit_lock_test_hook(&state.audit_guard);
    let _guard = state
        .audit_guard
        .lock()
        .map_err(|_| WorkAssistantError::protocol("audit log lock is unavailable"))?;
    clear_audit_entries_at(&state.audit_path)
}

fn clear_audit_entries_at(path: &Path) -> Result<(), WorkAssistantError> {
    let parent = path
        .parent()
        .ok_or_else(|| WorkAssistantError::protocol("audit path has no parent directory"))?;
    fs::create_dir_all(parent).map_err(|error| {
        WorkAssistantError::protocol(format!("could not create audit directory: {error}"))
    })?;
    fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| {
            WorkAssistantError::protocol(format!("could not clear audit log: {error}"))
        })
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
    use crate::work_assistant::WorkAssistantState;
    use std::{
        collections::{HashMap, HashSet},
        fs,
        sync::{mpsc, Arc, Mutex, RwLock, TryLockError},
        thread,
    };
    use uuid::Uuid;

    fn test_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("papyrus-test-{}", Uuid::new_v4()))
    }

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
    fn appends_and_reads_newest_audit_entry_first() {
        let directory = test_dir();
        let state = test_state(&directory);
        let first = AuditEntry::new("first", "one");
        let second = AuditEntry::new("second", "two");

        append_audit_entry(&state, &first).unwrap();
        append_audit_entry(&state, &second).unwrap();

        let entries = read_audit_entries(&state.audit_path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].event, "second");
        assert_eq!(entries[1].event, "first");

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn skips_malformed_trailing_lines() {
        let directory = test_dir();
        let state = test_state(&directory);
        let entry = AuditEntry::new("saved", "ok");

        append_audit_entry(&state, &entry).unwrap();
        fs::write(
            &state.audit_path,
            format!("{}\n{{bad-json", serde_json::to_string(&entry).unwrap()),
        )
        .unwrap();

        let entries = read_audit_entries(&state.audit_path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].event, "saved");

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_malformed_non_trailing_lines() {
        let directory = test_dir();
        let path = directory.join("audit.jsonl");
        let first = AuditEntry::new("first", "ok");
        let second = AuditEntry::new("second", "ok");

        fs::create_dir_all(&directory).unwrap();
        fs::write(
            &path,
            format!(
                "{}\n{{bad-json\n{}\n",
                serde_json::to_string(&first).unwrap(),
                serde_json::to_string(&second).unwrap(),
            ),
        )
        .unwrap();

        let error = read_audit_entries(&path).unwrap_err();
        assert_eq!(error.code, "protocol");

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn clear_truncates_file_without_deleting_parent_directory() {
        let directory = test_dir();
        let state = test_state(&directory);
        append_audit_entry(&state, &AuditEntry::new("saved", "ok")).unwrap();

        clear_audit_entries(&state).unwrap();

        assert!(directory.is_dir());
        assert!(state.audit_path.is_file());
        assert_eq!(fs::metadata(&state.audit_path).unwrap().len(), 0);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn state_audit_guard_serializes_append_and_clear_operations() {
        let directory = test_dir();
        let state = Arc::new(test_state(&directory));
        let path = state.audit_path.clone();
        let held_guard = state.audit_guard.lock().unwrap();
        let (append_contended_tx, append_contended_rx) = mpsc::channel();
        let append_state = Arc::clone(&state);

        let append = thread::spawn(move || {
            install_audit_lock_test_hook(Box::new(move |audit_guard| {
                assert!(matches!(
                    audit_guard.try_lock(),
                    Err(TryLockError::WouldBlock)
                ));
                append_contended_tx.send(()).unwrap();
            }));
            append_audit_entry(&append_state, &AuditEntry::new("saved", "ok"))
        });

        append_contended_rx.recv().unwrap();
        drop(held_guard);
        append.join().unwrap().unwrap();
        let entries = read_audit_entries(&path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].event, "saved");

        let held_guard = state.audit_guard.lock().unwrap();
        let (clear_contended_tx, clear_contended_rx) = mpsc::channel();
        let clear_state = Arc::clone(&state);
        let clear = thread::spawn(move || {
            install_audit_lock_test_hook(Box::new(move |audit_guard| {
                assert!(matches!(
                    audit_guard.try_lock(),
                    Err(TryLockError::WouldBlock)
                ));
                clear_contended_tx.send(()).unwrap();
            }));
            clear_audit_entries(&clear_state)
        });

        clear_contended_rx.recv().unwrap();
        drop(held_guard);
        clear.join().unwrap().unwrap();
        assert!(read_audit_entries(&path).unwrap().is_empty());

        fs::remove_dir_all(directory).unwrap();
    }
}
