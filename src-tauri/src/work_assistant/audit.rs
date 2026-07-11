use crate::work_assistant::WorkAssistantError;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::Path,
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
    let serialized = serde_json::to_string(entry).map_err(|error| {
        WorkAssistantError::protocol(format!("could not serialize audit entry: {error}"))
    })?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| {
            WorkAssistantError::protocol(format!("could not open audit log: {error}"))
        })?;
    file.write_all(serialized.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
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

    Ok(contents
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<AuditEntry>(line).ok())
        .collect())
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

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
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
}
