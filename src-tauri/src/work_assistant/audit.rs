use crate::work_assistant::WorkAssistantError;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

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

pub fn append_audit_entry(path: &Path, entry: &AuditEntry) -> Result<(), WorkAssistantError> {
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

pub fn append_audit_entry_locked(
    audit_guard: &Mutex<()>,
    path: &Path,
    entry: &AuditEntry,
) -> Result<(), WorkAssistantError> {
    let _guard = audit_guard
        .lock()
        .map_err(|_| WorkAssistantError::protocol("audit log lock is unavailable"))?;
    append_audit_entry(path, entry)
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

pub fn clear_audit_entries(path: &Path) -> Result<(), WorkAssistantError> {
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

pub fn clear_audit_entries_locked(
    audit_guard: &Mutex<()>,
    path: &Path,
) -> Result<(), WorkAssistantError> {
    let _guard = audit_guard
        .lock()
        .map_err(|_| WorkAssistantError::protocol("audit log lock is unavailable"))?;
    clear_audit_entries(path)
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
    use std::{
        fs,
        sync::{mpsc, Arc, Mutex},
        thread,
        time::Duration,
    };
    use uuid::Uuid;

    fn test_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("papyrus-test-{}", Uuid::new_v4()))
    }

    #[test]
    fn appends_and_reads_newest_audit_entry_first() {
        let directory = test_dir();
        let path = directory.join("audit.jsonl");
        let first = AuditEntry::new("first", "one");
        let second = AuditEntry::new("second", "two");

        append_audit_entry(&path, &first).unwrap();
        append_audit_entry(&path, &second).unwrap();

        let entries = read_audit_entries(&path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].event, "second");
        assert_eq!(entries[1].event, "first");

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn skips_malformed_trailing_lines() {
        let directory = test_dir();
        let path = directory.join("audit.jsonl");
        let entry = AuditEntry::new("saved", "ok");

        append_audit_entry(&path, &entry).unwrap();
        fs::write(
            &path,
            format!("{}\n{{bad-json", serde_json::to_string(&entry).unwrap()),
        )
        .unwrap();

        let entries = read_audit_entries(&path).unwrap();
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
        let path = directory.join("audit.jsonl");
        append_audit_entry(&path, &AuditEntry::new("saved", "ok")).unwrap();

        clear_audit_entries(&path).unwrap();

        assert!(directory.is_dir());
        assert!(path.is_file());
        assert_eq!(fs::metadata(&path).unwrap().len(), 0);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn shared_audit_guard_serializes_append_and_clear_operations() {
        let directory = test_dir();
        let path = directory.join("audit.jsonl");
        let audit_guard = Arc::new(Mutex::new(()));
        let held_guard = audit_guard.lock().unwrap();
        let (append_complete_tx, append_complete_rx) = mpsc::channel();
        let append_path = path.clone();
        let append_guard = Arc::clone(&audit_guard);

        let append = thread::spawn(move || {
            append_audit_entry_locked(
                &append_guard,
                &append_path,
                &AuditEntry::new("saved", "ok"),
            )
            .unwrap();
            append_complete_tx.send(()).unwrap();
        });

        assert!(append_complete_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        drop(held_guard);
        append.join().unwrap();
        append_complete_rx.recv().unwrap();
        let entries = read_audit_entries(&path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].event, "saved");

        let held_guard = audit_guard.lock().unwrap();
        let (clear_complete_tx, clear_complete_rx) = mpsc::channel();
        let clear_path = path.clone();
        let clear_guard = Arc::clone(&audit_guard);
        let clear = thread::spawn(move || {
            clear_audit_entries_locked(&clear_guard, &clear_path).unwrap();
            clear_complete_tx.send(()).unwrap();
        });

        assert!(clear_complete_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        drop(held_guard);
        clear.join().unwrap();
        clear_complete_rx.recv().unwrap();
        assert!(read_audit_entries(&path).unwrap().is_empty());

        fs::remove_dir_all(directory).unwrap();
    }
}
