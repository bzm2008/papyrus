//! Identity-bound filesystem primitives for approved file work.
//!
//! This boundary protects model-provided relative paths from traversal, link/reparse traversal,
//! stale previews, and ordinary concurrent filesystem changes. It deliberately does not claim to
//! revoke a destructive handle that a same-identity local process acquired before this code did.

use crate::work_assistant::{ConflictPolicy, FileOperationKind, FileOperationRequest, WorkAssistantError};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
};

#[cfg(target_os = "linux")]
pub(crate) mod linux;
#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(windows)]
pub(crate) mod windows;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformFileIdentity {
    pub platform: String,
    pub volume: String,
    pub file_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSnapshotSummary {
    pub original_relative_path: String,
    pub root_identity: PlatformFileIdentity,
    pub source_identity: PlatformFileIdentity,
    pub byte_len: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReceipt {
    pub preview_id: String,
    pub index: usize,
    pub original_relative_path: String,
    pub recovery_leaf: String,
    /// Opaque adapter-generated identifier for the private vault's device scope.  It is useful
    /// for audit correlation but deliberately cannot be turned back into a filesystem path.
    pub vault_scope: String,
    pub platform_source_identity: PlatformFileIdentity,
}

/// A regular source file held open by the platform adapter.
///
/// Content reads always use this retained handle. The adapter validates paths against a root while
/// opening it; it does not later reopen a model-controlled full path. Handle ownership cannot
/// revoke destructive handles a same-identity process obtained before the snapshot was opened.
pub struct SourceSnapshot {
    file: File,
    summary: SourceSnapshotSummary,
    platform: BoundPlatformSource,
}

// Task 3 receives only this bound adapter, never a caller-supplied full source path.
trait PlatformSource {
    fn verify_snapshot(&self) -> Result<(), WorkAssistantError>;
    fn copy_to_staging(&self) -> Result<(), WorkAssistantError>;
    fn move_to_recovery(&self) -> Result<(), WorkAssistantError>;
    fn publish_staging(&self) -> Result<(), WorkAssistantError>;
    fn create_directory(&self) -> Result<(), WorkAssistantError>;
}

/// Sealed native capability retained with the snapshot.  Task 3 will receive this
/// capability, never a caller supplied source or destination path.  On POSIX an
/// ancestor can still be moved by another process after it has been opened; the
/// retained descriptors make that boundary explicit and every transaction must
/// revalidate identities before publishing.
struct BoundPlatformSource {
    root: File,
    parent: File,
    source: File,
    leaf: String,
    parent_components: Vec<String>,
    parent_identity: PlatformFileIdentity,
    root_identity: PlatformFileIdentity,
    source_identity: PlatformFileIdentity,
    #[cfg(windows)]
    parent_path: PathBuf,
}

impl PlatformSource for BoundPlatformSource {
    fn verify_snapshot(&self) -> Result<(), WorkAssistantError> {
        let identities = {
            #[cfg(windows)]
            { windows::verify_bound_source(&self.root, &self.parent, &self.source, &self.leaf, &self.parent_identity, &self.parent_path) }
            #[cfg(target_os = "linux")]
            { linux::verify_bound_source(&self.root, &self.parent, &self.source, &self.leaf, &self.parent_components, &self.parent_identity) }
            #[cfg(target_os = "macos")]
            { macos::verify_bound_source(&self.root, &self.parent, &self.source, &self.leaf, &self.parent_components, &self.parent_identity) }
            #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
            { Err(WorkAssistantError::blocked("identity-bound source snapshots are not available on this platform")) }
        };
        match identities {
            Ok((root, source)) if root == self.root_identity && source == self.source_identity => Ok(()),
            Ok(_) => Err(WorkAssistantError::stale_preview("the workspace or source changed after preview")),
            Err(error) => Err(WorkAssistantError {
                code: error.code,
                message: format!("snapshot verification could not complete: {}", error.message),
                recoverable: error.recoverable,
            }),
        }
    }
    fn copy_to_staging(&self) -> Result<(), WorkAssistantError> { unavailable_operation("copy_to_staging") }
    fn move_to_recovery(&self) -> Result<(), WorkAssistantError> { unavailable_operation("move_to_recovery") }
    fn publish_staging(&self) -> Result<(), WorkAssistantError> { unavailable_operation("publish_staging") }
    fn create_directory(&self) -> Result<(), WorkAssistantError> { unavailable_operation("create_directory") }
}

fn unavailable_operation(operation: &str) -> Result<(), WorkAssistantError> {
    Err(WorkAssistantError::blocked(format!("{operation} is reserved for the native transaction executor")))
}

impl SourceSnapshot {
    pub fn summary(&self) -> &SourceSnapshotSummary {
        &self.summary
    }

    pub fn require_identity(
        &self,
        expected: &PlatformFileIdentity,
    ) -> Result<(), WorkAssistantError> {
        if &self.summary.source_identity == expected {
            Ok(())
        } else {
            Err(WorkAssistantError::stale_preview(
                "the source file identity changed after preview",
            ))
        }
    }

    pub fn require_summary_identity(
        &self,
        expected: &SourceSnapshotSummary,
    ) -> Result<(), WorkAssistantError> {
        if self.summary.root_identity == expected.root_identity
            && self.summary.source_identity == expected.source_identity
        {
            Ok(())
        } else {
            Err(WorkAssistantError::stale_preview(
                "the workspace or source identity changed after preview",
            ))
        }
    }

    pub fn read_all(&mut self) -> Result<Vec<u8>, WorkAssistantError> {
        self.file.seek(SeekFrom::Start(0)).map_err(io_error)?;
        let mut contents = Vec::new();
        self.file.read_to_end(&mut contents).map_err(io_error)?;
        Ok(contents)
    }

    pub(crate) fn file(&self) -> &File {
        &self.file
    }

    pub fn verify_snapshot(&self) -> Result<(), WorkAssistantError> {
        self.platform.verify_snapshot()
    }

    pub(crate) fn copy_to_staging(&self) -> Result<(), WorkAssistantError> { self.platform.copy_to_staging() }
    pub(crate) fn move_to_recovery(&self) -> Result<(), WorkAssistantError> { self.platform.move_to_recovery() }
    pub(crate) fn publish_staging(&self) -> Result<(), WorkAssistantError> { self.platform.publish_staging() }
    pub(crate) fn create_directory(&self) -> Result<(), WorkAssistantError> { self.platform.create_directory() }
}

/// A freshly created, private recovery directory. The absolute filesystem location is kept
/// private; the serializable receipt contains only a fixed relative original path and UUID leaf.
pub struct PreparedRecoverySlot {
    receipt: RecoveryReceipt,
    root: File,
    vault: File,
    slot: File,
}

impl PreparedRecoverySlot {
    pub fn receipt(&self) -> &RecoveryReceipt {
        &self.receipt
    }

    pub(crate) fn vault(&self) -> &File {
        &self.slot
    }
}

pub(crate) struct PreparedRecoveryHandles {
    pub(crate) root: File,
    pub(crate) vault: File,
    pub(crate) slot: File,
}

pub fn open_source_snapshot(
    authorized_root: &Path,
    original_relative_path: impl AsRef<Path>,
) -> Result<SourceSnapshot, WorkAssistantError> {
    let original_relative_path = normalized_relative_path(original_relative_path.as_ref())?;
    let opened = open_platform_source(authorized_root, Path::new(&original_relative_path))?;
    Ok(SourceSnapshot {
        file: opened.file,
        platform: BoundPlatformSource {
            root: opened.root,
            parent: opened.parent,
            source: opened.source,
            leaf: opened.leaf,
            parent_components: normalized_parent_components(&original_relative_path),
            parent_identity: opened.parent_identity,
            root_identity: opened.root_identity.clone(),
            source_identity: opened.source_identity.clone(),
            #[cfg(windows)]
            parent_path: opened.parent_path,
        },
        summary: SourceSnapshotSummary {
            original_relative_path,
            root_identity: opened.root_identity,
            source_identity: opened.source_identity,
            byte_len: opened.byte_len,
        },
    })
}

fn normalized_parent_components(relative: &str) -> Vec<String> {
    Path::new(relative)
        .parent()
        .into_iter()
        .flat_map(Path::components)
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

pub fn prepare_recovery_slot(
    authorized_root: &Path,
    preview_id: &str,
    index: usize,
    source: &SourceSnapshotSummary,
) -> Result<PreparedRecoverySlot, WorkAssistantError> {
    if preview_id.trim().is_empty() || preview_id.contains('\0') {
        return Err(WorkAssistantError::protocol(
            "recovery receipt requires a valid preview id",
        ));
    }
    let recovery_leaf = uuid::Uuid::new_v4().to_string();
    validate_recovery_leaf(&recovery_leaf)?;
    let handles = prepare_platform_recovery_vault(authorized_root, &recovery_leaf)?;

    Ok(PreparedRecoverySlot {
        receipt: RecoveryReceipt {
            preview_id: preview_id.into(),
            index,
            original_relative_path: source.original_relative_path.clone(),
            recovery_leaf,
            vault_scope: uuid::Uuid::new_v4().to_string(),
            platform_source_identity: source.source_identity.clone(),
        },
        root: handles.root,
        vault: handles.vault,
        slot: handles.slot,
    })
}

/// Prepares recovery beside the held source parent rather than blindly under the workspace root.
/// This is the only safe way to recover a source located below a nested mount/device.
pub(crate) fn prepare_recovery_slot_for_source(
    source: &SourceSnapshot,
    preview_id: &str,
    index: usize,
) -> Result<PreparedRecoverySlot, WorkAssistantError> {
    if preview_id.trim().is_empty() || preview_id.contains('\0') {
        return Err(WorkAssistantError::protocol("recovery receipt requires a valid preview id"));
    }
    source.verify_snapshot()?;
    let recovery_leaf = uuid::Uuid::new_v4().to_string();
    validate_recovery_leaf(&recovery_leaf)?;
    let handles = prepare_platform_recovery_vault_for_source(&source.platform, &recovery_leaf)?;
    Ok(PreparedRecoverySlot {
        receipt: RecoveryReceipt {
            preview_id: preview_id.into(),
            index,
            original_relative_path: source.summary.original_relative_path.clone(),
            recovery_leaf,
            vault_scope: uuid::Uuid::new_v4().to_string(),
            platform_source_identity: source.summary.source_identity.clone(),
        },
        root: handles.root,
        vault: handles.vault,
        slot: handles.slot,
    })
}

pub(crate) fn validate_recovery_leaf(value: &str) -> Result<(), WorkAssistantError> {
    if value.is_empty()
        || value.contains('\0')
        || value.contains('/')
        || value.contains('\\')
        || value == "."
        || value == ".."
        || uuid::Uuid::parse_str(value).is_err()
    {
        return Err(WorkAssistantError::blocked(
            "recovery storage accepts only adapter-generated UUID leaves",
        ));
    }
    Ok(())
}

/// A destination whose parent capability is held by the adapter.  The only name retained is the
/// final, validated leaf from the immutable preview; callers cannot substitute a filesystem path
/// once preflight has completed.
struct DestinationBinding {
    parent: File,
    leaf: String,
    #[cfg(windows)]
    parent_path: PathBuf,
}

pub(crate) struct PreparedFileTransaction {
    kind: FileOperationKind,
    source: Option<SourceSnapshot>,
    destination: Option<DestinationBinding>,
    existing_destination: Option<SourceSnapshot>,
    source_recovery: Option<PreparedRecoverySlot>,
    destination_recovery: Option<PreparedRecoverySlot>,
    skip: bool,
}

pub(crate) struct TransactionExecution {
    pub(crate) detail: String,
    pub(crate) receipts: Vec<RecoveryReceipt>,
}

/// Performs all model-path interpretation once, while the stored preview is still fresh.  The
/// returned object owns every source handle and recovery slot needed by execution.
pub(crate) fn prepare_file_transaction(
    root: &Path,
    preview_id: &str,
    index: usize,
    operation: &FileOperationRequest,
    conflict: &ConflictPolicy,
) -> Result<PreparedFileTransaction, WorkAssistantError> {
    let source = match operation.kind {
        FileOperationKind::Copy | FileOperationKind::Move | FileOperationKind::Rename | FileOperationKind::Trash => {
            let value = operation.source.as_deref().ok_or_else(|| WorkAssistantError::blocked("source is required for this operation"))?;
            Some(open_source_snapshot(root, value)?)
        }
        FileOperationKind::CreateDirectory => None,
    };
    let mut destination = match operation.kind {
        FileOperationKind::Copy | FileOperationKind::Move | FileOperationKind::Rename | FileOperationKind::CreateDirectory => {
            let value = operation.destination.as_deref().ok_or_else(|| WorkAssistantError::blocked("destination is required for this operation"))?;
            Some(bind_destination(root, Path::new(value))?)
        }
        FileOperationKind::Trash => None,
    };
    if let (Some(source), Some(destination)) = (&source, &destination) {
        if destination_entry_identity(destination)?
            .is_some_and(|identity| source.summary.source_identity == identity)
        {
            return Err(WorkAssistantError::blocked("source and destination must be different files"));
        }
    }
    let mut existing_destination = if let (Some(destination), Some(value)) = (&destination, operation.destination.as_deref()) {
        if destination_exists(destination)? { Some(open_source_snapshot(root, value)?) } else { None }
    } else { None };
    let mut skip = false;
    if existing_destination.is_some() {
        match conflict {
            ConflictPolicy::Skip => skip = true,
            ConflictPolicy::Rename => {
                let destination_ref = destination.as_mut().expect("destination is present");
                reserve_renamed_destination(destination_ref)?;
                existing_destination = None;
            }
            ConflictPolicy::Overwrite => {
                if operation.kind == FileOperationKind::CreateDirectory {
                    return Err(WorkAssistantError::blocked("directories cannot overwrite an existing entry"));
                }
            }
        }
    }
    let source_recovery = if matches!(operation.kind, FileOperationKind::Move | FileOperationKind::Rename | FileOperationKind::Trash) && !skip {
        Some(prepare_recovery_slot_for_source(source.as_ref().expect("source is required"), preview_id, index)?)
    } else { None };
    let destination_recovery = if matches!(conflict, ConflictPolicy::Overwrite) && existing_destination.is_some() && !skip {
        Some(prepare_recovery_slot_for_source(existing_destination.as_ref().expect("destination snapshot is present"), preview_id, index)?)
    } else { None };
    Ok(PreparedFileTransaction { kind: operation.kind.clone(), source, destination, existing_destination, source_recovery, destination_recovery, skip })
}

impl PreparedFileTransaction {
    pub(crate) fn execute<F>(mut self, cancelled: F) -> Result<TransactionExecution, WorkAssistantError>
    where
        F: Fn() -> Result<bool, WorkAssistantError>,
    {
        if self.skip {
            return Ok(TransactionExecution { detail: "destination already exists".into(), receipts: Vec::new() });
        }
        if cancelled()? { return Err(WorkAssistantError::stale_preview("operation was cancelled before execution")); }
        if let Some(source) = &self.source { source.verify_snapshot()?; }
        if let Some(destination) = &self.existing_destination { destination.verify_snapshot()?; }
        if cancelled()? { return Err(WorkAssistantError::stale_preview("operation was cancelled before staging")); }

        match self.kind {
            FileOperationKind::CreateDirectory => {
                create_directory(self.destination.as_ref().expect("destination is required"))?;
                Ok(TransactionExecution { detail: "created directory".into(), receipts: Vec::new() })
            }
            FileOperationKind::Trash => {
                let source = self.source.as_ref().expect("source is required");
                let recovery = self.source_recovery.as_ref().expect("recovery is required");
                move_snapshot_to_recovery(source, recovery)?;
                persist_recovery_receipt(recovery)?;
                Ok(TransactionExecution { detail: "moved file to private recovery".into(), receipts: vec![recovery.receipt.clone()] })
            }
            FileOperationKind::Copy => self.copy_or_overwrite(&cancelled, false),
            FileOperationKind::Move | FileOperationKind::Rename => self.move_or_rename(&cancelled),
        }
    }

    fn copy_or_overwrite<F>(&mut self, cancelled: &F, _move_after: bool) -> Result<TransactionExecution, WorkAssistantError>
    where F: Fn() -> Result<bool, WorkAssistantError> {
        let source = self.source.as_mut().expect("source is required");
        let destination = self.destination.as_ref().expect("destination is required");
        let staging = stage_source(source, destination)?;
        if cancelled()? { return Err(WorkAssistantError::stale_preview("operation was cancelled after staging")); }
        let mut receipts = Vec::new();
        if let Some(old) = &self.existing_destination {
            let recovery = self.destination_recovery.as_ref().expect("overwrite recovery is required");
            old.verify_snapshot()?;
            move_snapshot_to_recovery(old, recovery)?;
            persist_recovery_receipt(recovery)?;
            receipts.push(recovery.receipt.clone());
        }
        if cancelled()? { return Err(WorkAssistantError::partial_transaction("the old destination is safely recoverable; publication was cancelled")); }
        if let Err(error) = publish_staging(staging, destination) {
            return if receipts.is_empty() { Err(error) } else { Err(WorkAssistantError::partial_transaction("the old destination is safely recoverable but the replacement was not published")) };
        }
        Ok(TransactionExecution { detail: "copied regular file".into(), receipts })
    }

    fn move_or_rename<F>(&mut self, cancelled: &F) -> Result<TransactionExecution, WorkAssistantError>
    where F: Fn() -> Result<bool, WorkAssistantError> {
        let source = self.source.as_mut().expect("source is required");
        let destination = self.destination.as_ref().expect("destination is required");
        if self.existing_destination.is_none() {
            match move_snapshot_to_destination(source, destination) {
                Ok(()) => return Ok(TransactionExecution { detail: "renamed regular file".into(), receipts: Vec::new() }),
                Err(error) if is_cross_device(&error) => {}
                Err(error) => return Err(error),
            }
        }
        // Cross-device moves copy and publish before touching the original.  An overwrite first
        // secures the old destination in its own recovery vault.
        let staging = stage_source(source, destination)?;
        if cancelled()? { return Err(WorkAssistantError::stale_preview("operation was cancelled after staging")); }
        let mut receipts = Vec::new();
        if let Some(old) = &self.existing_destination {
            let recovery = self.destination_recovery.as_ref().expect("overwrite recovery is required");
            old.verify_snapshot()?;
            move_snapshot_to_recovery(old, recovery)?;
            persist_recovery_receipt(recovery)?;
            receipts.push(recovery.receipt.clone());
        }
        if let Err(_) = publish_staging(staging, destination) {
            return if receipts.is_empty() { Err(WorkAssistantError::stale_preview("the destination changed before publication")) } else { Err(WorkAssistantError::partial_transaction("the old destination is safely recoverable but the moved file was not published")) };
        }
        if cancelled()? { return Err(WorkAssistantError::partial_transaction("the new copy was published; the original was not moved to recovery")); }
        let recovery = self.source_recovery.as_ref().expect("source recovery is required");
        move_snapshot_to_recovery(source, recovery)?;
        persist_recovery_receipt(recovery)?;
        receipts.push(recovery.receipt.clone());
        Ok(TransactionExecution { detail: "copied and recovered original across devices".into(), receipts })
    }
}

struct OpenedDestination {
    parent: File,
    leaf: String,
    #[cfg(windows)]
    parent_path: PathBuf,
}

struct StagedFile {
    file: File,
    leaf: String,
}

fn bind_destination(root: &Path, relative: &Path) -> Result<DestinationBinding, WorkAssistantError> {
    let opened = open_platform_destination(root, relative)?;
    Ok(DestinationBinding {
        parent: opened.parent,
        leaf: opened.leaf,
        #[cfg(windows)]
        parent_path: opened.parent_path,
    })
}

fn destination_exists(destination: &DestinationBinding) -> Result<bool, WorkAssistantError> {
    #[cfg(windows)] { windows::destination_exists(&destination.parent, &destination.parent_path, &destination.leaf) }
    #[cfg(target_os = "linux")] { linux::destination_exists(&destination.parent, &destination.leaf) }
    #[cfg(target_os = "macos")] { macos::destination_exists(&destination.parent, &destination.leaf) }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))] { let _ = destination; Err(WorkAssistantError::blocked("native destination capability is unavailable")) }
}

fn destination_entry_identity(destination: &DestinationBinding) -> Result<Option<PlatformFileIdentity>, WorkAssistantError> {
    #[cfg(windows)] { windows::destination_identity(&destination.parent, &destination.parent_path, &destination.leaf) }
    #[cfg(target_os = "linux")] { linux::destination_identity(&destination.parent, &destination.leaf) }
    #[cfg(target_os = "macos")] { macos::destination_identity(&destination.parent, &destination.leaf) }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))] { let _ = destination; Err(WorkAssistantError::blocked("native destination capability is unavailable")) }
}

fn reserve_renamed_destination(destination: &mut DestinationBinding) -> Result<(), WorkAssistantError> {
    let (stem, extension) = split_leaf(&destination.leaf)?;
    for number in 1..=10_000 {
        let candidate = match extension { Some(value) => format!("{stem} ({number}).{value}"), None => format!("{stem} ({number})") };
        #[cfg(windows)]
        let available = windows::reserve_destination_name(&destination.parent, &destination.parent_path, &candidate)?;
        #[cfg(target_os = "linux")]
        let available = linux::reserve_destination_name(&destination.parent, &candidate)?;
        #[cfg(target_os = "macos")]
        let available = macos::reserve_destination_name(&destination.parent, &candidate)?;
        #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
        let available = false;
        if available { destination.leaf = candidate; return Ok(()); }
    }
    Err(WorkAssistantError::blocked("could not reserve an available destination name"))
}

fn split_leaf(value: &str) -> Result<(&str, Option<&str>), WorkAssistantError> {
    if value.is_empty() || value == "." || value == ".." || value.contains(['/', '\\', '\0']) {
        return Err(WorkAssistantError::blocked("destination leaf is invalid"));
    }
    let path = Path::new(value);
    let stem = path.file_stem().and_then(|value| value.to_str()).ok_or_else(|| WorkAssistantError::blocked("destination leaf is not valid unicode"))?;
    Ok((stem, path.extension().and_then(|value| value.to_str())))
}

fn stage_source(source: &mut SourceSnapshot, destination: &DestinationBinding) -> Result<StagedFile, WorkAssistantError> {
    source.verify_snapshot()?;
    source.file.seek(SeekFrom::Start(0)).map_err(io_error)?;
    #[cfg(windows)] { windows::stage_copy(source.file(), &destination.parent, &destination.parent_path) }
    #[cfg(target_os = "linux")] { linux::stage_copy(source.file(), &destination.parent) }
    #[cfg(target_os = "macos")] { macos::stage_copy(source.file(), &destination.parent) }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))] { let _ = destination; Err(WorkAssistantError::blocked("native staging is unavailable")) }
}

fn publish_staging(staged: StagedFile, destination: &DestinationBinding) -> Result<(), WorkAssistantError> {
    #[cfg(windows)] { windows::publish_staging(&staged.file, &destination.parent, &destination.leaf) }
    #[cfg(target_os = "linux")] { linux::publish_staging(&staged.file, &destination.parent, &staged.leaf, &destination.leaf) }
    #[cfg(target_os = "macos")] { macos::publish_staging(&staged.file, &destination.parent, &staged.leaf, &destination.leaf) }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))] { let _ = (staged, destination); Err(WorkAssistantError::blocked("native publication is unavailable")) }
}

fn move_snapshot_to_destination(source: &SourceSnapshot, destination: &DestinationBinding) -> Result<(), WorkAssistantError> {
    source.verify_snapshot()?;
    #[cfg(windows)] { windows::move_snapshot(&source.platform.source, &destination.parent, &destination.leaf) }
    #[cfg(target_os = "linux")] { linux::move_snapshot(&source.platform.parent, &source.platform.leaf, &destination.parent, &destination.leaf) }
    #[cfg(target_os = "macos")] { macos::move_snapshot(&source.platform.parent, &source.platform.leaf, &destination.parent, &destination.leaf) }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))] { let _ = (source, destination); Err(WorkAssistantError::blocked("native rename is unavailable")) }
}

fn move_snapshot_to_recovery(source: &SourceSnapshot, recovery: &PreparedRecoverySlot) -> Result<(), WorkAssistantError> {
    source.verify_snapshot()?;
    #[cfg(windows)] { windows::move_snapshot(&source.platform.source, &recovery.slot, "content") }
    #[cfg(target_os = "linux")] { linux::move_snapshot(&source.platform.parent, &source.platform.leaf, &recovery.slot, "content") }
    #[cfg(target_os = "macos")] { macos::move_snapshot(&source.platform.parent, &source.platform.leaf, &recovery.slot, "content") }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))] { let _ = (source, recovery); Err(WorkAssistantError::blocked("native recovery move is unavailable")) }
}

fn create_directory(destination: &DestinationBinding) -> Result<(), WorkAssistantError> {
    #[cfg(windows)] { windows::create_directory(&destination.parent, &destination.parent_path, &destination.leaf) }
    #[cfg(target_os = "linux")] { linux::create_directory(&destination.parent, &destination.leaf) }
    #[cfg(target_os = "macos")] { macos::create_directory(&destination.parent, &destination.leaf) }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))] { let _ = destination; Err(WorkAssistantError::blocked("native directory creation is unavailable")) }
}

fn persist_recovery_receipt(recovery: &PreparedRecoverySlot) -> Result<(), WorkAssistantError> {
    let bytes = serde_json::to_vec(recovery.receipt()).map_err(|_| WorkAssistantError::protocol("could not encode recovery receipt"))?;
    #[cfg(windows)] { windows::write_recovery_receipt(&recovery.slot, &bytes) }
    #[cfg(target_os = "linux")] { linux::write_recovery_receipt(&recovery.slot, &bytes) }
    #[cfg(target_os = "macos")] { macos::write_recovery_receipt(&recovery.slot, &bytes) }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))] { let _ = bytes; Err(WorkAssistantError::blocked("native recovery receipts are unavailable")) }
}

fn is_cross_device(error: &WorkAssistantError) -> bool { error.code == "cross_device" }

fn normalized_relative_path(path: &Path) -> Result<String, WorkAssistantError> {
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err(WorkAssistantError::path_outside_workspace(
            "source paths must be non-empty relative workspace paths",
        ));
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            _ => {
                return Err(WorkAssistantError::path_outside_workspace(
                    "source paths may not contain traversal or root components",
                ))
            }
        }
    }
    if parts.is_empty() {
        return Err(WorkAssistantError::path_outside_workspace(
            "source paths must name a file",
        ));
    }
    Ok(parts.join("/"))
}

fn io_error(error: std::io::Error) -> WorkAssistantError {
    WorkAssistantError::blocked(format!(
        "could not access approved filesystem object: {error}"
    ))
}

pub(crate) struct OpenedPlatformSource {
    file: File,
    root: File,
    parent: File,
    source: File,
    leaf: String,
    parent_identity: PlatformFileIdentity,
    #[cfg(windows)]
    parent_path: PathBuf,
    root_identity: PlatformFileIdentity,
    source_identity: PlatformFileIdentity,
    byte_len: u64,
}

#[cfg(windows)]
fn open_platform_source(
    root: &Path,
    relative: &Path,
) -> Result<OpenedPlatformSource, WorkAssistantError> {
    windows::open_source(root, relative)
}

#[cfg(target_os = "linux")]
fn open_platform_source(
    root: &Path,
    relative: &Path,
) -> Result<OpenedPlatformSource, WorkAssistantError> {
    linux::open_source(root, relative)
}

#[cfg(target_os = "macos")]
fn open_platform_source(
    root: &Path,
    relative: &Path,
) -> Result<OpenedPlatformSource, WorkAssistantError> {
    macos::open_source(root, relative)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn open_platform_source(_: &Path, _: &Path) -> Result<OpenedPlatformSource, WorkAssistantError> {
    Err(WorkAssistantError::blocked(
        "identity-bound source snapshots are not available on this platform",
    ))
}

#[cfg(windows)]
fn open_platform_destination(root: &Path, relative: &Path) -> Result<OpenedDestination, WorkAssistantError> {
    windows::open_destination(root, relative)
}

#[cfg(target_os = "linux")]
fn open_platform_destination(root: &Path, relative: &Path) -> Result<OpenedDestination, WorkAssistantError> {
    linux::open_destination(root, relative)
}

#[cfg(target_os = "macos")]
fn open_platform_destination(root: &Path, relative: &Path) -> Result<OpenedDestination, WorkAssistantError> {
    macos::open_destination(root, relative)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn open_platform_destination(_: &Path, _: &Path) -> Result<OpenedDestination, WorkAssistantError> {
    Err(WorkAssistantError::blocked("native destination capability is unavailable on this platform"))
}

#[cfg(windows)]
fn prepare_platform_recovery_vault(root: &Path, leaf: &str) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    windows::prepare_recovery_vault(root, leaf)
}

#[cfg(windows)]
fn prepare_platform_recovery_vault_for_source(
    source: &BoundPlatformSource,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    windows::prepare_recovery_vault_at_parent(&source.parent, &source.parent_path, leaf)
}

#[cfg(target_os = "linux")]
fn prepare_platform_recovery_vault_for_source(
    source: &BoundPlatformSource,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    linux::prepare_recovery_vault_at_parent(&source.parent, leaf)
}

#[cfg(target_os = "macos")]
fn prepare_platform_recovery_vault_for_source(
    source: &BoundPlatformSource,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    macos::prepare_recovery_vault_at_parent(&source.parent, leaf)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn prepare_platform_recovery_vault_for_source(
    _: &BoundPlatformSource,
    _: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    Err(WorkAssistantError::stale_preview(
        "a same-device private recovery vault is not available on this platform",
    ))
}

#[cfg(target_os = "linux")]
fn prepare_platform_recovery_vault(root: &Path, leaf: &str) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    linux::prepare_recovery_vault(root, leaf)
}

#[cfg(target_os = "macos")]
fn prepare_platform_recovery_vault(root: &Path, leaf: &str) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    macos::prepare_recovery_vault(root, leaf)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn prepare_platform_recovery_vault(_: &Path, _: &str) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    Err(WorkAssistantError::blocked(
        "private recovery storage is not available on this platform",
    ))
}

#[cfg(test)]
mod tests {
    use super::{open_source_snapshot, prepare_recovery_slot, validate_recovery_leaf};
    use std::{fs, path::PathBuf};
    use uuid::Uuid;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("papyrus-platform-{}", Uuid::new_v4()))
    }

    #[test]
    fn regular_snapshot_summary_never_serializes_an_absolute_path() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("document.txt"), "contents").unwrap();

        {
            let snapshot = open_source_snapshot(&root, "document.txt").unwrap();
            let serialized = serde_json::to_string(snapshot.summary()).unwrap();

            assert_eq!(snapshot.summary().original_relative_path, "document.txt");
            assert!(!serialized.contains(&root.to_string_lossy().to_string()));
            assert!(!snapshot.summary().original_relative_path.contains(".."));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(not(windows))]
    fn replaced_source_identity_is_reported_as_stale_preview() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("document.txt");
        fs::write(&source, "first").unwrap();
        let snapshot = open_source_snapshot(&root, "document.txt").unwrap();
        fs::remove_file(&source).unwrap();
        fs::write(&source, "replacement").unwrap();
        let error = snapshot.verify_snapshot().unwrap_err();

        assert_eq!(error.code, "stale_preview");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn held_windows_snapshot_prevents_source_replacement() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("document.txt");
        fs::write(&source, "first").unwrap();
        let snapshot = open_source_snapshot(&root, "document.txt").unwrap();
        let error = fs::remove_file(&source).unwrap_err();
        assert_eq!(error.raw_os_error(), Some(32));
        drop(snapshot);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_identity_comparison_seam_reports_replaced_source_as_stale() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("document.txt"), "first").unwrap();
        let snapshot = open_source_snapshot(&root, "document.txt").unwrap();
        let mut replacement = snapshot.summary().clone();
        replacement.source_identity.file_id.push('x');
        let error = snapshot.require_summary_identity(&replacement).unwrap_err();
        assert_eq!(error.code, "stale_preview");
        drop(snapshot);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_identity_comparison_seam_reports_replaced_root_as_stale() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("document.txt"), "first").unwrap();
        let snapshot = open_source_snapshot(&root, "document.txt").unwrap();
        let mut replacement = snapshot.summary().clone();
        replacement.root_identity.file_id.push('x');
        let error = snapshot.require_summary_identity(&replacement).unwrap_err();
        assert_eq!(error.code, "stale_preview");
        drop(snapshot);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_slot_uses_only_a_uuid_leaf_and_private_vault_child() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("document.txt"), "contents").unwrap();
        {
            let snapshot = open_source_snapshot(&root, "document.txt").unwrap();
            let slot = prepare_recovery_slot(&root, "preview-1", 3, snapshot.summary()).unwrap();
            let receipt = slot.receipt();

            assert!(Uuid::parse_str(&receipt.recovery_leaf).is_ok());
            assert_eq!(receipt.original_relative_path, "document.txt");
            assert!(!serde_json::to_string(receipt)
                .unwrap()
                .contains(&root.to_string_lossy().to_string()));
            assert!(root
                .join(".papyrus-recovery")
                .join(&receipt.recovery_leaf)
                .is_dir());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn verified_private_recovery_vault_is_reusable() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("document.txt"), "contents").unwrap();

        let snapshot = open_source_snapshot(&root, "document.txt").unwrap();
        let first = prepare_recovery_slot(&root, "preview-1", 0, snapshot.summary()).unwrap();
        drop(first);

        // A second slot must accept the pre-existing vault only after its platform
        // privacy policy has been verified. Creating a fresh UUID leaf is expected.
        let second = prepare_recovery_slot(&root, "preview-2", 1, snapshot.summary()).unwrap();
        drop(second);
        drop(snapshot);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_leaf_rejects_model_controlled_separators_and_nuls() {
        for value in ["model/name", "model\\name", "model\0name", ".."] {
            let error = validate_recovery_leaf(value).unwrap_err();
            assert_eq!(error.code, "blocked");
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_reparse_attribute_is_rejected() {
        assert!(super::windows::is_reparse_attributes(0x0400));
        assert!(!super::windows::is_reparse_attributes(0));
    }

    #[cfg(windows)]
    #[test]
    fn windows_final_symlink_fixture_is_rejected_or_policy_skipped() {
        use std::os::windows::fs::symlink_file;
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("target.txt"), "contents").unwrap();
        match symlink_file("target.txt", root.join("linked.txt")) {
            Ok(()) => {
                let result = open_source_snapshot(&root, "linked.txt");
                assert!(matches!(result, Err(error) if error.code == "blocked"));
                fs::remove_dir_all(root).unwrap();
            }
            Err(error) if error.raw_os_error() == Some(1314) => {
                println!("SKIPPED: Windows policy does not permit symlink fixtures: {error}");
                fs::remove_dir_all(root).unwrap();
            }
            Err(error) => panic!("could not create Windows symlink fixture: {error}"),
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_intermediate_symlink_fixture_is_rejected_or_policy_skipped() {
        use std::os::windows::fs::symlink_dir;
        let root = test_dir();
        let outside = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("document.txt"), "contents").unwrap();
        match symlink_dir(&outside, root.join("linked-directory")) {
            Ok(()) => {
                let result = open_source_snapshot(&root, "linked-directory/document.txt");
                assert!(matches!(result, Err(error) if error.code == "blocked"));
                fs::remove_dir_all(&root).unwrap();
                fs::remove_dir_all(&outside).unwrap();
            }
            Err(error) if error.raw_os_error() == Some(1314) => {
                println!("SKIPPED: Windows policy does not permit symlink fixtures: {error}");
                fs::remove_dir_all(&root).unwrap();
                fs::remove_dir_all(&outside).unwrap();
            }
            Err(error) => panic!("could not create Windows directory symlink fixture: {error}"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_source_is_rejected() {
        use std::os::unix::fs::symlink;

        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("target.txt"), "contents").unwrap();
        symlink("target.txt", root.join("linked.txt")).unwrap();

        let error = open_source_snapshot(&root, "linked.txt").unwrap_err();

        assert_eq!(error.code, "blocked");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_component_is_rejected() {
        use std::os::unix::fs::symlink;

        let root = test_dir();
        let outside = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("document.txt"), "contents").unwrap();
        symlink(&outside, root.join("linked-directory")).unwrap();

        let error = open_source_snapshot(&root, "linked-directory/document.txt").unwrap_err();

        assert_eq!(error.code, "blocked");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn moved_posix_ancestor_is_reported_as_stale_preview() {
        let root = test_dir();
        let moved = test_dir();
        fs::create_dir_all(root.join("subdir")).unwrap();
        fs::write(root.join("subdir/document.txt"), "contents").unwrap();
        let snapshot = open_source_snapshot(&root, "subdir/document.txt").unwrap();

        fs::rename(root.join("subdir"), &moved).unwrap();
        let error = snapshot.verify_snapshot().unwrap_err();
        assert_eq!(error.code, "stale_preview");

        drop(snapshot);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(moved).unwrap();
    }
}
