use crate::secretary_ledger::SecretaryLedger;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const STORAGE_KEY: &str = "papyrus-workstation-settings-v1";
const SNAPSHOT_SCHEMA_VERSION: u32 = 1;
const MAX_STORAGE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_TOTAL_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;
const SNAPSHOT_RETENTION: usize = 3;
const SNAPSHOT_ROOT: &str = "update-snapshots";
const PENDING_FILE: &str = "pending.json";
const STORAGE_FILE: &str = "workstation-settings.json";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUpdateSnapshotInput {
    pub target_version: String,
    pub storage_key: String,
    pub storage_payload: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyUpdateSnapshotInput {
    pub storage_key: String,
    pub storage_payload: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshotReceipt {
    pub snapshot_id: String,
    pub target_version: String,
    pub ledger_healthy: bool,
    pub storage_bytes: u64,
    pub file_count: usize,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshotVerification {
    pub pending: bool,
    pub status: String,
    pub target_version: Option<String>,
    pub ledger_healthy: bool,
    pub storage_present: bool,
    pub snapshot_available: bool,
    pub ledger_schema_version: Option<i64>,
    pub ledger_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restore_storage_payload: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingPointer {
    snapshot_id: String,
    target_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotManifest {
    schema_version: u32,
    snapshot_id: String,
    target_version: String,
    created_at_ms: u64,
    storage_key: String,
    storage_file: Option<String>,
    storage_bytes: u64,
    total_bytes: u64,
    files: Vec<SnapshotFile>,
    verified_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotFile {
    path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug)]
struct SnapshotStore {
    data_dir: PathBuf,
}

#[derive(Debug)]
struct SnapshotWriter {
    stage_dir: PathBuf,
    files: Vec<SnapshotFile>,
    total_bytes: u64,
}

#[tauri::command]
pub fn prepare_update_snapshot(
    app: AppHandle,
    input: PrepareUpdateSnapshotInput,
) -> Result<UpdateSnapshotReceipt, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法定位应用数据目录，已阻止安装更新。".to_string())?;
    SnapshotStore::new(data_dir)
        .prepare(input)
        .map_err(|_| "无法保存更新数据快照，已阻止安装更新。".to_string())
}

#[tauri::command]
pub fn verify_update_snapshot(
    app: AppHandle,
    input: VerifyUpdateSnapshotInput,
) -> Result<UpdateSnapshotVerification, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法定位应用数据目录，快照校验未完成。".to_string())?;
    SnapshotStore::new(data_dir)
        .verify(input)
        .map_err(|_| "更新后数据校验未完成，快照仍保留。".to_string())
}

impl SnapshotStore {
    fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    fn prepare(&self, input: PrepareUpdateSnapshotInput) -> io::Result<UpdateSnapshotReceipt> {
        validate_storage_key(&input.storage_key)?;
        validate_version(&input.target_version)?;
        validate_storage_payload(input.storage_payload.as_deref())?;

        fs::create_dir_all(&self.data_dir)?;
        let ledger = SecretaryLedger::open_at(self.data_dir.join("papyrus-secretary.sqlite3"))
            .map_err(|_| io::Error::new(io::ErrorKind::Other, "ledger unavailable"))?;
        let ledger_health = ledger
            .checkpoint_for_update()
            .map_err(|_| io::Error::new(io::ErrorKind::Other, "ledger checkpoint unavailable"))?;

        let root = self.snapshot_root();
        fs::create_dir_all(&root)?;
        let snapshot_id = format!("{}-{}", unix_millis(), Uuid::new_v4().simple());
        let stage = root.join(format!(".stage-{snapshot_id}"));
        let final_dir = root.join(&snapshot_id);
        let result = (|| {
            fs::create_dir_all(&stage)?;
            let mut writer = SnapshotWriter::new(stage.clone());

            let storage_bytes = if let Some(payload) = input.storage_payload.as_deref() {
                let storage_path = stage.join(STORAGE_FILE);
                fs::write(&storage_path, payload.as_bytes())?;
                writer.record_existing_file(STORAGE_FILE)?;
                payload.len() as u64
            } else {
                0
            };

            for relative in [
                "papyrus-secretary.sqlite3",
                "papyrus-secretary.sqlite3-wal",
                "papyrus-secretary.sqlite3-shm",
                "work-assistant.jsonl",
                "work-assistant-roots.json",
                "work-assistant-applications.json",
            ] {
                writer.copy_if_present(&self.data_dir.join(relative), relative)?;
            }
            writer.copy_tree_if_present(&self.data_dir.join("memory"), Path::new("memory"))?;

            let manifest = SnapshotManifest {
                schema_version: SNAPSHOT_SCHEMA_VERSION,
                snapshot_id: snapshot_id.clone(),
                target_version: input.target_version.clone(),
                created_at_ms: unix_millis(),
                storage_key: input.storage_key.clone(),
                storage_file: (storage_bytes > 0).then(|| STORAGE_FILE.to_string()),
                storage_bytes,
                total_bytes: writer.total_bytes,
                files: writer.files,
                verified_at_ms: None,
            };
            write_json(&stage.join("manifest.json"), &manifest)?;
            fs::rename(&stage, &final_dir)?;
            write_json(
                &root.join(PENDING_FILE),
                &PendingPointer {
                    snapshot_id: snapshot_id.clone(),
                    target_version: input.target_version.clone(),
                },
            )?;
            self.cleanup_old_snapshots(&snapshot_id)?;
            Ok::<_, io::Error>(UpdateSnapshotReceipt {
                snapshot_id,
                target_version: input.target_version,
                ledger_healthy: true,
                storage_bytes,
                file_count: manifest_file_count(&final_dir)?,
                message: "已保存更新数据快照，SQLite 检查点已完成。".into(),
            })
        })();

        if result.is_err() {
            let _ = fs::remove_dir_all(&stage);
        }
        result.map(|mut receipt| {
            receipt.ledger_healthy = ledger_health.status == "ok";
            receipt
        })
    }

    fn verify(&self, input: VerifyUpdateSnapshotInput) -> io::Result<UpdateSnapshotVerification> {
        validate_storage_key(&input.storage_key)?;
        validate_storage_payload(input.storage_payload.as_deref())?;
        let current_storage_present = input
            .storage_payload
            .as_deref()
            .map(is_valid_storage_payload)
            .unwrap_or(false);
        let pending = self.pending_pointer()?;
        let ledger_health =
            SecretaryLedger::open_at(self.data_dir.join("papyrus-secretary.sqlite3"))
                .ok()
                .and_then(|ledger| ledger.health().ok());
        let Some(ledger_health) = ledger_health else {
            return Ok(UpdateSnapshotVerification {
                pending: pending.is_some(),
                status: "error".into(),
                target_version: pending.map(|item| item.target_version),
                ledger_healthy: false,
                storage_present: current_storage_present,
                snapshot_available: false,
                ledger_schema_version: None,
                ledger_bytes: None,
                restore_storage_payload: None,
                message: "更新后 SQLite 健康检查失败，快照仍保留，请勿清理应用数据。".into(),
            });
        };

        let Some(pointer) = pending else {
            return Ok(UpdateSnapshotVerification {
                pending: false,
                status: "none".into(),
                target_version: None,
                ledger_healthy: ledger_health.status == "ok",
                storage_present: current_storage_present,
                snapshot_available: false,
                ledger_schema_version: Some(ledger_health.schema_version),
                ledger_bytes: Some(ledger_health.bytes),
                restore_storage_payload: None,
                message: "本地数据目录健康。".into(),
            });
        };

        let snapshot_dir = self.snapshot_root().join(&pointer.snapshot_id);
        let manifest = read_manifest(&snapshot_dir)?;
        if manifest.snapshot_id != pointer.snapshot_id
            || manifest.target_version != pointer.target_version
        {
            return Ok(UpdateSnapshotVerification {
                pending: true,
                status: "error".into(),
                target_version: Some(pointer.target_version),
                ledger_healthy: ledger_health.status == "ok",
                storage_present: current_storage_present,
                snapshot_available: false,
                ledger_schema_version: Some(ledger_health.schema_version),
                ledger_bytes: Some(ledger_health.bytes),
                restore_storage_payload: None,
                message: "更新快照元数据不匹配，原始数据仍保留。".into(),
            });
        }
        let snapshot_available = self.verify_manifest(&snapshot_dir, &manifest)?;
        if !snapshot_available {
            return Ok(UpdateSnapshotVerification {
                pending: true,
                status: "error".into(),
                target_version: Some(pointer.target_version),
                ledger_healthy: ledger_health.status == "ok",
                storage_present: current_storage_present,
                snapshot_available: false,
                ledger_schema_version: Some(ledger_health.schema_version),
                ledger_bytes: Some(ledger_health.bytes),
                restore_storage_payload: None,
                message: "更新快照完整性检查失败，原始数据仍保留。".into(),
            });
        }

        if !current_storage_present && manifest.storage_bytes > 0 {
            let storage_file = manifest.storage_file.as_deref().ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "missing storage file")
            })?;
            let storage_path = safe_join(&snapshot_dir, storage_file)?;
            let payload = fs::read_to_string(storage_path)?;
            validate_storage_payload(Some(&payload))?;
            return Ok(UpdateSnapshotVerification {
                pending: true,
                status: "restore_required".into(),
                target_version: Some(pointer.target_version),
                ledger_healthy: ledger_health.status == "ok",
                storage_present: false,
                snapshot_available: true,
                ledger_schema_version: Some(ledger_health.schema_version),
                ledger_bytes: Some(ledger_health.bytes),
                restore_storage_payload: Some(payload),
                message: "更新后发现本地对话存储缺失，可从本地快照恢复。".into(),
            });
        }

        let mut verified_manifest = manifest;
        verified_manifest.verified_at_ms = Some(unix_millis());
        write_json(&snapshot_dir.join("manifest.json"), &verified_manifest)?;
        remove_if_present(&self.snapshot_root().join(PENDING_FILE))?;
        Ok(UpdateSnapshotVerification {
            pending: true,
            status: "verified".into(),
            target_version: Some(pointer.target_version),
            ledger_healthy: ledger_health.status == "ok",
            storage_present: current_storage_present || verified_manifest.storage_bytes == 0,
            snapshot_available: true,
            ledger_schema_version: Some(ledger_health.schema_version),
            ledger_bytes: Some(ledger_health.bytes),
            restore_storage_payload: None,
            message: "更新后数据保留检查通过，SQLite 与对话快照均可用。".into(),
        })
    }

    fn snapshot_root(&self) -> PathBuf {
        self.data_dir.join(SNAPSHOT_ROOT)
    }

    fn pending_pointer(&self) -> io::Result<Option<PendingPointer>> {
        let path = self.snapshot_root().join(PENDING_FILE);
        if !path.exists() {
            return Ok(None);
        }
        let bytes = fs::read(path)?;
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid pending pointer"))
    }

    fn verify_manifest(
        &self,
        snapshot_dir: &Path,
        manifest: &SnapshotManifest,
    ) -> io::Result<bool> {
        if manifest.schema_version != SNAPSHOT_SCHEMA_VERSION
            || manifest.storage_key != STORAGE_KEY
            || manifest.files.len() > 10_000
            || manifest.total_bytes > MAX_TOTAL_SNAPSHOT_BYTES
            || (manifest.storage_bytes == 0 && manifest.storage_file.is_some())
            || (manifest.storage_bytes > 0 && manifest.storage_file.is_none())
        {
            return Ok(false);
        }
        if let Some(storage_file) = manifest.storage_file.as_deref() {
            let Some(entry) = manifest.files.iter().find(|file| file.path == storage_file) else {
                return Ok(false);
            };
            if entry.bytes != manifest.storage_bytes {
                return Ok(false);
            }
        }
        let mut total = 0u64;
        for file in &manifest.files {
            let path = safe_join(snapshot_dir, &file.path)?;
            let metadata = fs::metadata(&path)?;
            if !metadata.is_file() || metadata.len() != file.bytes {
                return Ok(false);
            }
            if sha256_file(&path)? != file.sha256 {
                return Ok(false);
            }
            total = total.saturating_add(file.bytes);
            if total > MAX_TOTAL_SNAPSHOT_BYTES {
                return Ok(false);
            }
        }
        Ok(total == manifest.total_bytes)
    }

    fn cleanup_old_snapshots(&self, current_id: &str) -> io::Result<()> {
        let root = self.snapshot_root();
        let mut entries = fs::read_dir(&root)?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                    && entry.file_name().to_string_lossy() != current_id
                    && !entry.file_name().to_string_lossy().starts_with('.')
            })
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.file_name());
        if entries.len() > SNAPSHOT_RETENTION.saturating_sub(1) {
            let remove_count = entries.len() - SNAPSHOT_RETENTION.saturating_sub(1);
            for entry in entries.into_iter().take(remove_count) {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
        Ok(())
    }
}

impl SnapshotWriter {
    fn new(stage_dir: PathBuf) -> Self {
        Self {
            stage_dir,
            files: Vec::new(),
            total_bytes: 0,
        }
    }

    fn copy_if_present(&mut self, source: &Path, relative: &str) -> io::Result<()> {
        if !source.exists() {
            return Ok(());
        }
        let metadata = fs::symlink_metadata(source)?;
        if !metadata.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "snapshot source is not a file",
            ));
        }
        let destination = self.stage_dir.join(relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, &destination)?;
        self.record_file(relative, &destination)
    }

    fn copy_tree_if_present(&mut self, source: &Path, relative: &Path) -> io::Result<()> {
        if !source.exists() {
            return Ok(());
        }
        let metadata = fs::symlink_metadata(source)?;
        if !metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "snapshot source is not a directory",
            ));
        }
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            let source_path = entry.path();
            let child_relative = relative.join(entry.file_name());
            let child_metadata = fs::symlink_metadata(&source_path)?;
            if child_metadata.file_type().is_symlink() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "symlink in snapshot source",
                ));
            }
            if child_metadata.is_dir() {
                self.copy_tree_if_present(&source_path, &child_relative)?;
            } else if child_metadata.is_file() {
                let destination = self.stage_dir.join(&child_relative);
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(&source_path, &destination)?;
                self.record_file(&child_relative.to_string_lossy(), &destination)?;
            }
        }
        Ok(())
    }

    fn record_existing_file(&mut self, relative: &str) -> io::Result<()> {
        let path = self.stage_dir.join(relative);
        self.record_file(relative, &path)
    }

    fn record_file(&mut self, relative: &str, path: &Path) -> io::Result<()> {
        let metadata = fs::metadata(path)?;
        if !metadata.is_file() || metadata.len() > MAX_TOTAL_SNAPSHOT_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid snapshot file",
            ));
        }
        let next_total = self.total_bytes.saturating_add(metadata.len());
        if next_total > MAX_TOTAL_SNAPSHOT_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "snapshot too large",
            ));
        }
        self.files.push(SnapshotFile {
            path: relative.replace('\\', "/"),
            bytes: metadata.len(),
            sha256: sha256_file(path)?,
        });
        self.total_bytes = next_total;
        Ok(())
    }
}

fn read_manifest(snapshot_dir: &Path) -> io::Result<SnapshotManifest> {
    let bytes = fs::read(snapshot_dir.join("manifest.json"))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid snapshot manifest"))
}

fn manifest_file_count(snapshot_dir: &Path) -> io::Result<usize> {
    Ok(read_manifest(snapshot_dir)?.files.len())
}

fn safe_join(root: &Path, relative: &str) -> io::Result<PathBuf> {
    let relative_path = Path::new(relative);
    if relative_path.components().any(|component| {
        matches!(
            component,
            Component::Prefix(_) | Component::RootDir | Component::ParentDir
        )
    }) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unsafe snapshot path",
        ));
    }
    Ok(root.join(relative_path))
}

fn validate_storage_key(value: &str) -> io::Result<()> {
    if value == STORAGE_KEY {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "unexpected storage key",
        ))
    }
}

fn validate_version(value: &str) -> io::Result<()> {
    if value.len() <= 32
        && value.split('.').count() == 3
        && value.split('.').all(|part| {
            !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
        })
    {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid target version",
        ))
    }
}

fn validate_storage_payload(value: Option<&str>) -> io::Result<()> {
    if let Some(payload) = value {
        if payload.as_bytes().len() as u64 > MAX_STORAGE_BYTES || !is_valid_storage_payload(payload)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid storage payload",
            ));
        }
    }
    Ok(())
}

fn is_valid_storage_payload(value: &str) -> bool {
    if value.as_bytes().len() as u64 > MAX_STORAGE_BYTES {
        return false;
    }
    let Ok(parsed) = serde_json::from_str::<Value>(value) else {
        return false;
    };
    let Some(object) = parsed.as_object() else {
        return false;
    };
    object.get("state").is_some_and(Value::is_object)
        && object
            .get("version")
            .map(|version| version.is_i64() || version.is_u64() || version.is_f64())
            .unwrap_or(true)
}

fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "serialize snapshot metadata"))?;
    write_atomic(path, &bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_file_name(format!(
        ".{}.tmp-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("data"),
        Uuid::new_v4().simple()
    ));
    {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    replace_atomic(&temporary, path)?;
    Ok(())
}

#[cfg(not(windows))]
fn replace_atomic(temporary: &Path, path: &Path) -> io::Result<()> {
    fs::rename(temporary, path)
}

#[cfg(windows)]
fn replace_atomic(temporary: &Path, path: &Path) -> io::Result<()> {
    match fs::metadata(path) {
        Ok(_) => replace_existing_file_windows(path, temporary),
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::rename(temporary, path),
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn replace_existing_file_windows(path: &Path, temporary: &Path) -> io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt, ptr};

    let target = path
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let replacement = temporary
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
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

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("papyrus-update-protection-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn payload() -> String {
        serde_json::json!({
            "state": { "activeChatId": "chat-1", "chatSessions": [{ "id": "chat-1", "messages": [] }] },
            "version": 0
        })
        .to_string()
    }

    #[test]
    fn snapshot_round_trip_restores_storage_and_marks_pending_as_verified() {
        let directory = test_dir();
        fs::write(
            directory.join("work-assistant.jsonl"),
            "{\"event\":\"safe\"}\n",
        )
        .unwrap();
        fs::write(directory.join("work-assistant-applications.json"), "[]\n").unwrap();
        fs::create_dir_all(directory.join("memory")).unwrap();
        fs::write(
            directory.join("memory").join("global.md"),
            "偏好使用清楚的中文。\n",
        )
        .unwrap();
        let store = SnapshotStore::new(directory.clone());
        let storage = payload();

        let receipt = store
            .prepare(PrepareUpdateSnapshotInput {
                target_version: "1.0.1".into(),
                storage_key: STORAGE_KEY.into(),
                storage_payload: Some(storage.clone()),
            })
            .unwrap();
        assert_eq!(receipt.target_version, "1.0.1");
        assert!(receipt.file_count >= 3);
        assert!(directory
            .join(SNAPSHOT_ROOT)
            .join(&receipt.snapshot_id)
            .join("work-assistant-applications.json")
            .is_file());

        let restore = store
            .verify(VerifyUpdateSnapshotInput {
                storage_key: STORAGE_KEY.into(),
                storage_payload: None,
            })
            .unwrap();
        assert_eq!(restore.status, "restore_required");
        assert_eq!(
            restore.restore_storage_payload.as_deref(),
            Some(storage.as_str())
        );

        let verified = store
            .verify(VerifyUpdateSnapshotInput {
                storage_key: STORAGE_KEY.into(),
                storage_payload: Some(storage),
            })
            .unwrap();
        assert_eq!(verified.status, "verified");
        assert!(store.pending_pointer().unwrap().is_none());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn tampered_snapshot_is_rejected_without_clearing_pending_marker() {
        let directory = test_dir();
        let store = SnapshotStore::new(directory.clone());
        let receipt = store
            .prepare(PrepareUpdateSnapshotInput {
                target_version: "1.0.1".into(),
                storage_key: STORAGE_KEY.into(),
                storage_payload: Some(payload()),
            })
            .unwrap();
        fs::write(
            directory
                .join(SNAPSHOT_ROOT)
                .join(receipt.snapshot_id)
                .join(STORAGE_FILE),
            "tampered",
        )
        .unwrap();

        let result = store
            .verify(VerifyUpdateSnapshotInput {
                storage_key: STORAGE_KEY.into(),
                storage_payload: Some(payload()),
            })
            .unwrap();
        assert_eq!(result.status, "error");
        assert!(store.pending_pointer().unwrap().is_some());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn invalid_storage_payload_is_rejected_before_snapshot_creation() {
        let directory = test_dir();
        let store = SnapshotStore::new(directory.clone());
        assert!(store
            .prepare(PrepareUpdateSnapshotInput {
                target_version: "1.0.1".into(),
                storage_key: STORAGE_KEY.into(),
                storage_payload: Some("not-json".into()),
            })
            .is_err());
        assert!(!directory.join(SNAPSHOT_ROOT).exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
