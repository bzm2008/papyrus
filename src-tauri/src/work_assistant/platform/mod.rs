//! Identity-bound filesystem primitives for approved file work.
//!
//! This boundary protects model-provided relative paths from traversal, link/reparse traversal,
//! stale previews, and ordinary concurrent filesystem changes. It deliberately does not claim to
//! revoke a destructive handle that a same-identity local process acquired before this code did.

use crate::work_assistant::{
    ConflictPolicy, FileOperationKind, FileOperationRequest, WorkAssistantError,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
pub(crate) mod desktop;

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
    pub version: FileVersion,
    /// Integrity value retained only by the native approval capability. It is deliberately not
    /// serialized into a UI preview, audit payload, or recovery receipt.
    #[serde(skip)]
    content_digest: [u8; 32],
}

/// Portable freshness information captured with an identity-bound file handle.  File identities
/// alone do not change for an in-place write, so all mutations require this value to match both
/// the retained handle and a fresh handle rebound from the approved namespace.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub byte_len: u64,
    pub modified_unix_nanos: i128,
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
    authorized_root_path: PathBuf,
    parent: File,
    source: File,
    leaf: String,
    parent_components: Vec<String>,
    parent_identity: PlatformFileIdentity,
    root_identity: PlatformFileIdentity,
    source_identity: PlatformFileIdentity,
    source_version: FileVersion,
    source_digest: [u8; 32],
    #[cfg(windows)]
    parent_path: PathBuf,
    #[cfg(windows)]
    ancestor_handles: Vec<File>,
}

impl PlatformSource for BoundPlatformSource {
    fn verify_snapshot(&self) -> Result<(), WorkAssistantError> {
        let identities = {
            #[cfg(windows)]
            {
                windows::verify_bound_source(
                    &self.root,
                    &self.parent,
                    &self.source,
                    &self.leaf,
                    &self.parent_identity,
                    &self.parent_path,
                    &self.source_version,
                )
            }
            #[cfg(target_os = "linux")]
            {
                linux::verify_bound_source(
                    &self.root,
                    &self.authorized_root_path,
                    &self.root_identity,
                    &self.parent,
                    &self.source,
                    &self.leaf,
                    &self.parent_components,
                    &self.parent_identity,
                    &self.source_version,
                )
            }
            #[cfg(target_os = "macos")]
            {
                macos::verify_bound_source(
                    &self.root,
                    &self.authorized_root_path,
                    &self.root_identity,
                    &self.parent,
                    &self.source,
                    &self.leaf,
                    &self.parent_components,
                    &self.parent_identity,
                    &self.source_version,
                )
            }
            #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
            {
                Err(WorkAssistantError::blocked(
                    "identity-bound source snapshots are not available on this platform",
                ))
            }
        };
        match identities {
            Ok((root, source)) if root == self.root_identity && source == self.source_identity => {
                Ok(())
            }
            Ok(_) => Err(WorkAssistantError::stale_preview(
                "the workspace or source changed after preview",
            )),
            Err(error) => Err(WorkAssistantError {
                code: error.code,
                message: format!(
                    "snapshot verification could not complete: {}",
                    error.message
                ),
                recoverable: error.recoverable,
            }),
        }
    }
    fn copy_to_staging(&self) -> Result<(), WorkAssistantError> {
        unavailable_operation("copy_to_staging")
    }
    fn move_to_recovery(&self) -> Result<(), WorkAssistantError> {
        unavailable_operation("move_to_recovery")
    }
    fn publish_staging(&self) -> Result<(), WorkAssistantError> {
        unavailable_operation("publish_staging")
    }
    fn create_directory(&self) -> Result<(), WorkAssistantError> {
        unavailable_operation("create_directory")
    }
}

fn unavailable_operation(operation: &str) -> Result<(), WorkAssistantError> {
    Err(WorkAssistantError::blocked(format!(
        "{operation} is reserved for the native transaction executor"
    )))
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
            && self.summary.version == expected.version
            && self.summary.content_digest == expected.content_digest
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

    /// Verify both the namespace/version binding and the full bounded bytes still exposed by
    /// the retained source handle. Version checks catch ordinary edits; this digest closes the
    /// same-length/same-timestamp edge before any staged bytes are published or renamed.
    fn verify_content_snapshot(&self) -> Result<(), WorkAssistantError> {
        self.verify_snapshot()?;
        let digest = digest_regular_file(&self.file, self.summary.byte_len)?;
        if digest == self.platform.source_digest {
            Ok(())
        } else {
            Err(WorkAssistantError::stale_preview(
                "the approved source content changed after preview",
            ))
        }
    }

    pub(crate) fn copy_to_staging(&self) -> Result<(), WorkAssistantError> {
        self.platform.copy_to_staging()
    }
    pub(crate) fn move_to_recovery(&self) -> Result<(), WorkAssistantError> {
        self.platform.move_to_recovery()
    }
    pub(crate) fn publish_staging(&self) -> Result<(), WorkAssistantError> {
        self.platform.publish_staging()
    }
    pub(crate) fn create_directory(&self) -> Result<(), WorkAssistantError> {
        self.platform.create_directory()
    }
}

/// A freshly created, private recovery directory. The absolute filesystem location is kept
/// private; the serializable receipt contains only a fixed relative original path and UUID leaf.
pub struct PreparedRecoverySlot {
    receipt: RecoveryReceipt,
    receipt_bytes: Vec<u8>,
    root: File,
    vault: File,
    slot: File,
    // A slot is disposable until it contains recovered data. Once a recovery move succeeds it
    // must survive every later error so the operation remains recoverable.
    committed: bool,
    // A recovery slot is a write capability.  POSIX directory descriptors survive renames, so
    // retain the original approved namespace and every identity needed to re-bind it before a
    // vault or receipt mutation.  The retained FDs are never used for POSIX writes directly.
    binding: RecoveryBinding,
}

struct RecoverySlotPreparationFailure {
    error: WorkAssistantError,
    slot: Option<PreparedRecoverySlot>,
}

impl From<WorkAssistantError> for RecoverySlotPreparationFailure {
    fn from(error: WorkAssistantError) -> Self {
        Self { error, slot: None }
    }
}

pub(crate) struct RecoveryBinding {
    pub(crate) authorized_root_path: PathBuf,
    pub(crate) root_identity: PlatformFileIdentity,
    pub(crate) parent_components: Vec<String>,
    pub(crate) parent_identity: PlatformFileIdentity,
    pub(crate) vault_identity: PlatformFileIdentity,
    pub(crate) slot_leaf: String,
    pub(crate) slot_identity: PlatformFileIdentity,
}

impl PreparedRecoverySlot {
    pub fn receipt(&self) -> &RecoveryReceipt {
        &self.receipt
    }

    pub(crate) fn vault(&self) -> &File {
        &self.slot
    }

    fn mark_committed(&mut self) {
        self.committed = true;
    }

    /// Consume a never-committed slot before attempting cleanup.  In particular Windows source
    /// parent capabilities intentionally deny DELETE sharing; those capabilities must be gone
    /// before the cleanup code re-opens the approved namespace.
    fn cleanup_uncommitted(self) -> Result<(), WorkAssistantError> {
        let mut bindings = Vec::new();
        if let Some(binding) = self.take_binding_for_cleanup() {
            bindings.push(binding);
        }
        cleanup_recovery_bindings(bindings)
    }

    fn take_binding_for_cleanup(self) -> Option<RecoveryBinding> {
        if self.committed {
            return None;
        }
        let binding = self.binding;
        drop(self.root);
        drop(self.vault);
        drop(self.slot);
        Some(binding)
    }
}

pub(crate) struct PreparedRecoveryHandles {
    pub(crate) root: File,
    pub(crate) vault: File,
    pub(crate) slot: File,
    pub(crate) vault_identity: PlatformFileIdentity,
    pub(crate) slot_identity: PlatformFileIdentity,
}

pub fn open_source_snapshot(
    authorized_root: &Path,
    original_relative_path: impl AsRef<Path>,
) -> Result<SourceSnapshot, WorkAssistantError> {
    let original_relative_path = normalized_relative_path(original_relative_path.as_ref())?;
    let opened = open_platform_source(authorized_root, Path::new(&original_relative_path))?;
    let content_digest = digest_regular_file(&opened.file, opened.byte_len)?;
    // The digest is meaningful only if the version captured by the adapter remained stable while
    // it was streamed. Do not retry against a moving source: approval must be regenerated.
    if file_version(&opened.file)? != opened.version {
        return Err(WorkAssistantError::stale_preview(
            "the approved source changed while its preview was being captured",
        ));
    }
    Ok(SourceSnapshot {
        file: opened.file,
        platform: BoundPlatformSource {
            root: opened.root,
            authorized_root_path: canonical_authorized_root_path(authorized_root)?,
            parent: opened.parent,
            source: opened.source,
            leaf: opened.leaf,
            parent_components: normalized_parent_components(&original_relative_path),
            parent_identity: opened.parent_identity,
            root_identity: opened.root_identity.clone(),
            source_identity: opened.source_identity.clone(),
            source_version: opened.version.clone(),
            source_digest: content_digest,
            #[cfg(windows)]
            parent_path: opened.parent_path,
            #[cfg(windows)]
            ancestor_handles: opened.ancestor_handles,
        },
        summary: SourceSnapshotSummary {
            original_relative_path,
            root_identity: opened.root_identity,
            source_identity: opened.source_identity,
            byte_len: opened.byte_len,
            version: opened.version,
            content_digest,
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

// Production recovery slots are always created from a held source capability below.  This
// root-only helper remains a test seam for vault layout coverage; accepting a caller-provided
// summary in production would not provide the source-parent identity needed for a safe rebind.
#[cfg(test)]
pub(crate) fn prepare_recovery_slot(
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

    let receipt = RecoveryReceipt {
        preview_id: preview_id.into(),
        index,
        original_relative_path: source.original_relative_path.clone(),
        recovery_leaf,
        vault_scope: uuid::Uuid::new_v4().to_string(),
        platform_source_identity: source.source_identity.clone(),
    };
    let receipt_bytes = serde_json::to_vec(&receipt)
        .map_err(|_| WorkAssistantError::protocol("could not encode recovery receipt"))?;
    let slot_leaf = receipt.recovery_leaf.clone();
    let slot = PreparedRecoverySlot {
        receipt,
        receipt_bytes,
        root: handles.root,
        vault: handles.vault,
        slot: handles.slot,
        committed: false,
        binding: RecoveryBinding {
            authorized_root_path: canonical_authorized_root_path(authorized_root)?,
            root_identity: source.root_identity.clone(),
            parent_components: Vec::new(),
            parent_identity: source.root_identity.clone(),
            vault_identity: handles.vault_identity,
            slot_leaf,
            slot_identity: handles.slot_identity,
        },
    };
    if let Err(error) = preflight_recovery_receipt(&slot) {
        // The slot is not yet owned by a prepared transaction. Consume it so cleanup releases
        // the original capabilities before performing the fresh identity-bound removal. The
        // preflight failure remains the caller-visible cause even if cleanup also needs repair.
        let _ = slot.cleanup_uncommitted();
        return Err(error);
    }
    Ok(slot)
}

/// Prepares recovery beside the held source parent rather than blindly under the workspace root.
/// This is the only safe way to recover a source located below a nested mount/device.
pub(crate) fn prepare_recovery_slot_for_source(
    source: &SourceSnapshot,
    preview_id: &str,
    index: usize,
) -> Result<PreparedRecoverySlot, WorkAssistantError> {
    prepare_recovery_slot_for_source_capturing(source, preview_id, index)
        .map_err(|failure| failure.error)
}

fn prepare_recovery_slot_for_source_capturing(
    source: &SourceSnapshot,
    preview_id: &str,
    index: usize,
) -> Result<PreparedRecoverySlot, RecoverySlotPreparationFailure> {
    if preview_id.trim().is_empty() || preview_id.contains('\0') {
        return Err(WorkAssistantError::protocol(
            "recovery receipt requires a valid preview id",
        ).into());
    }
    source.verify_snapshot()?;
    let recovery_leaf = uuid::Uuid::new_v4().to_string();
    validate_recovery_leaf(&recovery_leaf)?;
    // Reopen the original authorized root and re-walk the parent *immediately* before the
    // first vault mkdir/open. A retained POSIX source-parent FD may already name a moved
    // directory. Windows keeps its existing handle-bound implementation.
    #[cfg(unix)]
    let handles = {
        let parent = rebind_recovery_parent(&source.platform)?;
        prepare_platform_recovery_vault_at_parent(&parent, &recovery_leaf)?
    };
    #[cfg(windows)]
    let handles = prepare_platform_recovery_vault_for_source(&source.platform, &recovery_leaf)?;
    let receipt = RecoveryReceipt {
        preview_id: preview_id.into(),
        index,
        original_relative_path: source.summary.original_relative_path.clone(),
        recovery_leaf,
        vault_scope: uuid::Uuid::new_v4().to_string(),
        platform_source_identity: source.summary.source_identity.clone(),
    };
    let receipt_bytes = serde_json::to_vec(&receipt)
        .map_err(|_| WorkAssistantError::protocol("could not encode recovery receipt"))?;
    let slot_leaf = receipt.recovery_leaf.clone();
    let slot = PreparedRecoverySlot {
        receipt,
        receipt_bytes,
        root: handles.root,
        vault: handles.vault,
        slot: handles.slot,
        committed: false,
        binding: RecoveryBinding {
            authorized_root_path: source.platform.authorized_root_path.clone(),
            root_identity: source.platform.root_identity.clone(),
            parent_components: source.platform.parent_components.clone(),
            parent_identity: source.platform.parent_identity.clone(),
            vault_identity: handles.vault_identity,
            slot_leaf,
            slot_identity: handles.slot_identity,
        },
    };
    if let Err(error) = preflight_recovery_receipt(&slot) {
        return Err(RecoverySlotPreparationFailure { error, slot: Some(slot) });
    }
    Ok(slot)
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
    // POSIX directory descriptors remain usable after a directory is renamed.  Retain the
    // authorized root and the exact parent walk so each mutation can prove that this capability
    // still names the approved namespace, rather than merely a directory with a live FD.
    #[cfg(unix)]
    root: File,
    /// Canonical pathname captured from the approved root at preview time.  A directory file
    /// descriptor alone can outlive a rename, so POSIX mutations re-open this pathname before
    /// every write and compare it with `root_identity`.
    #[cfg(unix)]
    authorized_root_path: PathBuf,
    #[cfg(unix)]
    root_identity: PlatformFileIdentity,
    #[cfg(unix)]
    parent_components: Vec<String>,
    #[cfg(unix)]
    parent_identity: PlatformFileIdentity,
    #[cfg(windows)]
    parent_path: PathBuf,
    #[cfg(windows)]
    ancestor_handles: Vec<File>,
    rename_candidate: Option<RenameCandidate>,
}

struct RenameCandidate {
    stem: String,
    extension: Option<String>,
    next_number: u32,
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

impl PreparedFileTransaction {
    pub(crate) fn take_recovery_slots_for_cleanup(&mut self) -> Vec<PreparedRecoverySlot> {
        // Releasing source/destination capabilities first is required on Windows: their parent
        // handles deliberately deny DELETE sharing, which is the lock that prevents namespace
        // swaps during an active transaction.  Cleanup later rebinds from the authorized root.
        self.source.take();
        self.destination.take();
        self.existing_destination.take();
        let source_recovery = self.source_recovery.take();
        let destination_recovery = self.destination_recovery.take();
        [source_recovery, destination_recovery]
            .into_iter()
            .flatten()
            .collect()
    }

    pub(crate) fn cleanup_uncommitted(&mut self) -> Result<(), WorkAssistantError> {
        cleanup_recovery_slots(self.take_recovery_slots_for_cleanup())
    }
}

pub(crate) fn cleanup_recovery_slots(slots: Vec<PreparedRecoverySlot>) -> Result<(), WorkAssistantError> {
    let bindings = slots
        .into_iter()
        .filter_map(PreparedRecoverySlot::take_binding_for_cleanup)
        .collect();
    cleanup_recovery_bindings(bindings)
}

fn cleanup_recovery_bindings(bindings: Vec<RecoveryBinding>) -> Result<(), WorkAssistantError> {
    let mut first_error = None;
    for binding in bindings {
        if let Err(error) = remove_recovery_slot(&binding) {
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
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
    let mut source = match operation.kind {
        FileOperationKind::Copy
        | FileOperationKind::Move
        | FileOperationKind::Rename
        | FileOperationKind::Trash => {
            let value = operation.source.as_deref().ok_or_else(|| {
                WorkAssistantError::blocked("source is required for this operation")
            })?;
            Some(open_source_snapshot(root, value)?)
        }
        FileOperationKind::CreateDirectory => None,
    };
    let mut destination = match operation.kind {
        FileOperationKind::Copy
        | FileOperationKind::Move
        | FileOperationKind::Rename
        | FileOperationKind::CreateDirectory => {
            let value = operation.destination.as_deref().ok_or_else(|| {
                WorkAssistantError::blocked("destination is required for this operation")
            })?;
            Some(bind_destination(root, Path::new(value))?)
        }
        FileOperationKind::Trash => None,
    };
    if let (Some(source), Some(destination)) = (&source, &destination) {
        if destination_entry_identity(destination)?
            .is_some_and(|identity| source.summary.source_identity == identity)
        {
            return Err(WorkAssistantError::blocked(
                "source and destination must be different files",
            ));
        }
    }
    let mut existing_destination = if let (Some(destination), Some(value)) =
        (&destination, operation.destination.as_deref())
    {
        if destination_exists(destination)? {
            Some(open_source_snapshot(root, value)?)
        } else {
            None
        }
    } else {
        None
    };
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
                    return Err(WorkAssistantError::blocked(
                        "directories cannot overwrite an existing entry",
                    ));
                }
            }
        }
    }
    let mut source_recovery = if matches!(
        operation.kind,
        FileOperationKind::Move | FileOperationKind::Rename | FileOperationKind::Trash
    ) && !skip
    {
        match prepare_recovery_slot_for_source_capturing(
            source.as_ref().expect("source is required"), preview_id, index,
        ) {
            Ok(slot) => Some(slot),
            Err(failure) => {
                drop(source.take());
                drop(existing_destination.take());
                drop(destination.take());
                if let Some(slot) = failure.slot { let _ = cleanup_recovery_slots(vec![slot]); }
                return Err(failure.error);
            }
        }
    } else {
        None
    };
    let destination_recovery =
        if matches!(conflict, ConflictPolicy::Overwrite) && existing_destination.is_some() && !skip
        {
            match prepare_recovery_slot_for_source_capturing(
                existing_destination
                    .as_ref()
                    .expect("destination snapshot is present"),
                preview_id,
                index,
            ) {
                Ok(slot) => Some(slot),
                Err(failure) => {
                    drop(source.take());
                    drop(existing_destination.take());
                    drop(destination.take());
                    let mut slots = Vec::new();
                    if let Some(slot) = source_recovery.take() { slots.push(slot); }
                    if let Some(slot) = failure.slot { slots.push(slot); }
                    let _ = cleanup_recovery_slots(slots);
                    return Err(failure.error);
                }
            }
        } else {
            None
        };
    Ok(PreparedFileTransaction {
        kind: operation.kind.clone(),
        source,
        destination,
        existing_destination,
        source_recovery,
        destination_recovery,
        skip,
    })
}

impl PreparedFileTransaction {
    pub(crate) fn execute<F>(
        &mut self,
        cancelled: F,
    ) -> Result<TransactionExecution, WorkAssistantError>
    where
        F: Fn() -> Result<bool, WorkAssistantError>,
    {
        if self.skip {
            return Ok(TransactionExecution {
                detail: "destination already exists".into(),
                receipts: Vec::new(),
            });
        }
        if cancelled()? {
            return Err(WorkAssistantError::cancelled(
                "operation was cancelled before execution",
            ));
        }
        if let Some(source) = &self.source {
            source.verify_snapshot()?;
        }
        if let Some(destination) = &self.existing_destination {
            destination.verify_snapshot()?;
        }
        if cancelled()? {
            return Err(WorkAssistantError::cancelled(
                "operation was cancelled before staging",
            ));
        }

        match self.kind {
            FileOperationKind::CreateDirectory => {
                create_directory(self.destination.as_ref().expect("destination is required"))?;
                Ok(TransactionExecution {
                    detail: "created directory".into(),
                    receipts: Vec::new(),
                })
            }
            FileOperationKind::Trash => {
                let source = self.source.as_ref().expect("source is required");
                let recovery = self.source_recovery.as_mut().expect("recovery is required");
                if let Err(error) = move_snapshot_to_recovery(source, recovery) {
                    return Err(error);
                }
                recovery.mark_committed();
                if let Err(error) = persist_recovery_receipt(recovery) {
                    return Err(WorkAssistantError::partial_transaction(format!(
                        "source moved to private recovery but receipt persistence failed: {}",
                        safe_transaction_error(&error)
                    )));
                }
                Ok(TransactionExecution {
                    detail: "moved file to private recovery".into(),
                    receipts: vec![recovery.receipt.clone()],
                })
            }
            FileOperationKind::Copy => self.copy_or_overwrite(&cancelled, false),
            FileOperationKind::Move | FileOperationKind::Rename => self.move_or_rename(&cancelled),
        }
    }

    fn copy_or_overwrite<F>(
        &mut self,
        cancelled: &F,
        _move_after: bool,
    ) -> Result<TransactionExecution, WorkAssistantError>
    where
        F: Fn() -> Result<bool, WorkAssistantError>,
    {
        let source = self.source.as_mut().expect("source is required");
        let destination = self.destination.as_mut().expect("destination is required");
        let staging = stage_source(source, destination)?;
        if cancelled()? {
            return Err(cleanup_cancelled_staging(
                staging,
                "operation was cancelled after staging",
            ));
        }
        // Validate the approved source and the opaque staged bytes again at the last safe
        // point before an overwrite can displace the current destination.  In particular, do
        // this before creating a recovery receipt: a stale preview must be a no-op.
        run_after_staging_before_prepublish_hook();
        let staging = revalidate_staging_for_publish(staging, source)?;
        let mut receipts = Vec::new();
        if let Some(old) = &self.existing_destination {
            let recovery = self
                .destination_recovery
                .as_mut()
                .expect("overwrite recovery is required");
            old.verify_snapshot()?;
            move_snapshot_to_recovery(old, recovery)?;
            recovery.mark_committed();
            if let Err(error) = persist_recovery_receipt(recovery) {
                return Err(WorkAssistantError::partial_transaction(format!(
                    "old destination is recoverable but its receipt could not be persisted: {}",
                    safe_transaction_error(&error)
                )));
            }
            receipts.push(recovery.receipt.clone());
            run_after_destination_recovery_hook();
        }
        if cancelled()? {
            return Err(WorkAssistantError::partial_transaction(
                "the old destination is safely recoverable; publication was cancelled",
            ));
        }
        // The source may have changed while the old destination was secured.  Do not publish
        // stale staged bytes; the old destination is already recoverable in this rare case.
        let staging = revalidate_after_destination_recovery(staging, source)?;
        if let Err(error) = publish_staging(staging, destination) {
            return if receipts.is_empty() {
                Err(error)
            } else {
                Err(WorkAssistantError::partial_transaction("the old destination is safely recoverable but the replacement was not published"))
            };
        }
        Ok(TransactionExecution {
            detail: "copied regular file".into(),
            receipts,
        })
    }

    fn move_or_rename<F>(
        &mut self,
        cancelled: &F,
    ) -> Result<TransactionExecution, WorkAssistantError>
    where
        F: Fn() -> Result<bool, WorkAssistantError>,
    {
        let source = self.source.as_mut().expect("source is required");
        let destination = self.destination.as_mut().expect("destination is required");
        if self.existing_destination.is_none() {
            match move_snapshot_to_destination(source, destination) {
                Ok(()) => {
                    return Ok(TransactionExecution {
                        detail: "renamed regular file".into(),
                        receipts: Vec::new(),
                    })
                }
                Err(error) if is_cross_device(&error) => {}
                Err(error) => return Err(error),
            }
        }
        // Cross-device moves copy and publish before touching the original.  An overwrite first
        // secures the old destination in its own recovery vault.
        let staging = stage_source(source, destination)?;
        if cancelled()? {
            return Err(cleanup_cancelled_staging(
                staging,
                "operation was cancelled after staging",
            ));
        }
        // Cross-device moves publish a copy before recovering the source.  Revalidate while
        // both the source and any overwrite destination remain untouched.
        run_after_staging_before_prepublish_hook();
        let staging = revalidate_staging_for_publish(staging, source)?;
        let mut receipts = Vec::new();
        if let Some(old) = &self.existing_destination {
            let recovery = self
                .destination_recovery
                .as_mut()
                .expect("overwrite recovery is required");
            old.verify_snapshot()?;
            move_snapshot_to_recovery(old, recovery)?;
            recovery.mark_committed();
            if let Err(error) = persist_recovery_receipt(recovery) {
                return Err(WorkAssistantError::partial_transaction(format!(
                    "old destination is recoverable but its receipt could not be persisted: {}",
                    safe_transaction_error(&error)
                )));
            }
            receipts.push(recovery.receipt.clone());
            run_after_destination_recovery_hook();
        }
        if cancelled()? {
            return if receipts.is_empty() {
                Err(cleanup_cancelled_staging(
                    staging,
                    "operation was cancelled before publication",
                ))
            } else {
                Err(cleanup_recoverable_staging_after_destination_recovery(
                    staging,
                ))
            };
        }
        let staging = revalidate_after_destination_recovery(staging, source)?;
        if let Err(error) = publish_staging(staging, destination) {
            return if receipts.is_empty() {
                Err(error)
            } else {
                Err(WorkAssistantError::partial_transaction("the old destination is safely recoverable but the moved file was not published"))
            };
        }
        if let Err(error) = verify_published_copy(source, destination) {
            return Err(WorkAssistantError::partial_transaction(format!(
                "the new copy was published but could not be verified; the original remains in place: {}",
                safe_transaction_error(&error)
            )));
        }
        if cancelled()? {
            return Err(WorkAssistantError::partial_transaction(
                "the new copy was published; the original was not moved to recovery",
            ));
        }
        // Re-check immediately before recovering the original.  If it changed after
        // publication, preserve it in place instead of claiming a successful move.
        source.verify_content_snapshot()?;
        let recovery = self
            .source_recovery
            .as_mut()
            .expect("source recovery is required");
        move_snapshot_to_recovery(source, recovery)?;
        recovery.mark_committed();
        if let Err(error) = persist_recovery_receipt(recovery) {
            return Err(WorkAssistantError::partial_transaction(format!(
                "the original was moved to private recovery but its receipt could not be persisted: {}",
                safe_transaction_error(&error)
            )));
        }
        receipts.push(recovery.receipt.clone());
        Ok(TransactionExecution {
            detail: "copied and recovered original across devices".into(),
            receipts,
        })
    }
}

pub(super) struct OpenedDestination {
    parent: File,
    leaf: String,
    #[cfg(unix)]
    root: File,
    #[cfg(unix)]
    root_identity: PlatformFileIdentity,
    #[cfg(unix)]
    parent_identity: PlatformFileIdentity,
    #[cfg(windows)]
    parent_path: PathBuf,
    #[cfg(windows)]
    ancestor_handles: Vec<File>,
}

pub(super) struct StagedFile {
    file: File,
    parent: File,
    leaf: String,
    digest: [u8; 32],
    published: bool,
}

impl Drop for StagedFile {
    fn drop(&mut self) {
        if !self.published {
            let _ = remove_staging_file(&self.file, &self.parent, &self.leaf);
        }
    }
}

fn bind_destination(
    root: &Path,
    relative: &Path,
) -> Result<DestinationBinding, WorkAssistantError> {
    let opened = open_platform_destination(root, relative)?;
    Ok(DestinationBinding {
        parent: opened.parent,
        leaf: opened.leaf,
        #[cfg(unix)]
        root: opened.root,
        #[cfg(unix)]
        authorized_root_path: canonical_authorized_root_path(root)?,
        #[cfg(unix)]
        root_identity: opened.root_identity,
        #[cfg(unix)]
        parent_components: normalized_parent_components(&normalized_relative_path(relative)?),
        #[cfg(unix)]
        parent_identity: opened.parent_identity,
        #[cfg(windows)]
        parent_path: opened.parent_path,
        #[cfg(windows)]
        ancestor_handles: opened.ancestor_handles,
        rename_candidate: None,
    })
}

fn destination_exists(destination: &DestinationBinding) -> Result<bool, WorkAssistantError> {
    #[cfg(windows)]
    {
        windows::destination_exists(
            &destination.parent,
            &destination.parent_path,
            &destination.leaf,
        )
    }
    #[cfg(target_os = "linux")]
    {
        linux::destination_exists(&destination.parent, &destination.leaf)
    }
    #[cfg(target_os = "macos")]
    {
        macos::destination_exists(&destination.parent, &destination.leaf)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = destination;
        Err(WorkAssistantError::blocked(
            "native destination capability is unavailable",
        ))
    }
}

fn destination_entry_identity(
    destination: &DestinationBinding,
) -> Result<Option<PlatformFileIdentity>, WorkAssistantError> {
    #[cfg(windows)]
    {
        windows::destination_identity(
            &destination.parent,
            &destination.parent_path,
            &destination.leaf,
        )
    }
    #[cfg(target_os = "linux")]
    {
        linux::destination_identity(&destination.parent, &destination.leaf)
    }
    #[cfg(target_os = "macos")]
    {
        macos::destination_identity(&destination.parent, &destination.leaf)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = destination;
        Err(WorkAssistantError::blocked(
            "native destination capability is unavailable",
        ))
    }
}

fn reserve_renamed_destination(
    destination: &mut DestinationBinding,
) -> Result<(), WorkAssistantError> {
    verify_destination_binding(destination)?;
    let (stem, extension) = split_leaf(&destination.leaf)?;
    destination.rename_candidate = Some(RenameCandidate {
        stem: stem.into(),
        extension: extension.map(str::to_owned),
        next_number: 1,
    });
    advance_renamed_destination(destination)
}

/// Candidate existence is intentionally not probed then unlinked.  Publication uses the native
/// no-replace primitive; a collision advances this bounded sequence and retries with the same
/// staged/held source capability.
fn advance_renamed_destination(
    destination: &mut DestinationBinding,
) -> Result<(), WorkAssistantError> {
    verify_destination_binding(destination)?;
    let candidate = destination
        .rename_candidate
        .as_mut()
        .ok_or_else(|| WorkAssistantError::blocked("rename candidate state is unavailable"))?;
    if candidate.next_number > 10_000 {
        return Err(WorkAssistantError::blocked(
            "could not reserve an available destination name",
        ));
    }
    let number = candidate.next_number;
    candidate.next_number += 1;
    destination.leaf = match &candidate.extension {
        Some(extension) => format!("{} ({number}).{extension}", candidate.stem),
        None => format!("{} ({number})", candidate.stem),
    };
    Ok(())
}

fn split_leaf(value: &str) -> Result<(&str, Option<&str>), WorkAssistantError> {
    if value.is_empty() || value == "." || value == ".." || value.contains(['/', '\\', '\0']) {
        return Err(WorkAssistantError::blocked("destination leaf is invalid"));
    }
    let path = Path::new(value);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| WorkAssistantError::blocked("destination leaf is not valid unicode"))?;
    Ok((stem, path.extension().and_then(|value| value.to_str())))
}

fn stage_source(
    source: &mut SourceSnapshot,
    destination: &DestinationBinding,
) -> Result<StagedFile, WorkAssistantError> {
    verify_destination_binding(destination)?;
    source.verify_content_snapshot()?;
    source.file.seek(SeekFrom::Start(0)).map_err(io_error)?;
    #[cfg(windows)]
    let staged =
        { windows::stage_copy(source.file(), &destination.parent, &destination.parent_path) }?;
    #[cfg(target_os = "linux")]
    let staged = { linux::stage_copy(source.file(), &destination.parent) }?;
    #[cfg(target_os = "macos")]
    let staged = { macos::stage_copy(source.file(), &destination.parent) }?;
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = destination;
        return Err(WorkAssistantError::blocked("native staging is unavailable"));
    }
    // A staged file is never published solely because it was copied successfully. Both sides
    // must still equal the full digest captured at preview time; clean the opaque staging child
    // through its held capability before returning a recoverable stale-preview result.
    let verification = source
        .verify_content_snapshot()
        .and_then(|_| verify_staged_digest(&staged, source.summary.content_digest));
    match verification {
        Ok(()) => Ok(staged),
        Err(error) => Err(cleanup_stale_staging(staged, error)),
    }
}

fn publish_staging(
    mut staged: StagedFile,
    destination: &mut DestinationBinding,
) -> Result<(), WorkAssistantError> {
    loop {
        verify_destination_binding(destination)?;
        let result = injected_rename_collision()
            .then(|| {
                WorkAssistantError::destination_exists("injected native publication collision")
            })
            .map_or_else(
                || {
                    #[cfg(windows)]
                    {
                        windows::publish_staging(
                            &staged.file,
                            &destination.parent,
                            &destination.leaf,
                        )
                    }
                    #[cfg(target_os = "linux")]
                    {
                        linux::publish_staging(&staged, &destination.parent, &destination.leaf)
                    }
                    #[cfg(target_os = "macos")]
                    {
                        macos::publish_staging(&staged, &destination.parent, &destination.leaf)
                    }
                    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
                    {
                        let _ = (&staged, destination);
                        Err(WorkAssistantError::blocked(
                            "native publication is unavailable",
                        ))
                    }
                },
                Err,
            );
        match result {
            Ok(()) => {
                staged.published = true;
                return Ok(());
            }
            Err(error)
                if error.code == "destination_exists" && destination.rename_candidate.is_some() =>
            {
                advance_renamed_destination(destination)?
            }
            Err(error) => return Err(error),
        }
    }
}

fn move_snapshot_to_destination(
    source: &SourceSnapshot,
    destination: &mut DestinationBinding,
) -> Result<(), WorkAssistantError> {
    loop {
        verify_destination_binding(destination)?;
        source.verify_content_snapshot()?;
        let result = injected_rename_collision()
            .then(|| {
                WorkAssistantError::destination_exists("injected native publication collision")
            })
            .map_or_else(
                || {
                    #[cfg(windows)]
                    {
                        windows::move_snapshot(
                            &source.platform.source,
                            &destination.parent,
                            &destination.leaf,
                        )
                    }
                    #[cfg(target_os = "linux")]
                    {
                        linux::move_snapshot(
                            &source.platform.parent,
                            &source.platform.leaf,
                            &destination.parent,
                            &destination.leaf,
                        )
                    }
                    #[cfg(target_os = "macos")]
                    {
                        macos::move_snapshot(
                            &source.platform.parent,
                            &source.platform.leaf,
                            &destination.parent,
                            &destination.leaf,
                        )
                    }
                    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
                    {
                        let _ = (source, destination);
                        Err(WorkAssistantError::blocked("native rename is unavailable"))
                    }
                },
                Err,
            );
        match result {
            Ok(()) => return Ok(()),
            Err(error)
                if error.code == "destination_exists" && destination.rename_candidate.is_some() =>
            {
                advance_renamed_destination(destination)?
            }
            Err(error) => return Err(error),
        }
    }
}

fn move_snapshot_to_recovery(
    source: &SourceSnapshot,
    recovery: &PreparedRecoverySlot,
) -> Result<(), WorkAssistantError> {
    source.verify_content_snapshot()?;
    #[cfg(windows)]
    {
        windows::move_snapshot(&source.platform.source, &recovery.slot, "content")
    }
    #[cfg(target_os = "linux")]
    {
        // Both rename parents are freshly reopened from their original approved namespace.
        // Retained POSIX directory FDs survive a rename and are therefore never write parents.
        let source_parent = linux::rebind_recovery_parent(
            &source.platform.authorized_root_path,
            &source.platform.root_identity,
            &source.platform.parent_components,
            &source.platform.parent_identity,
        )?;
        let slot = linux::rebind_recovery_slot(&recovery.binding)?;
        linux::move_snapshot(&source_parent, &source.platform.leaf, &slot, "content")
    }
    #[cfg(target_os = "macos")]
    {
        // See Linux above: neither side of this destructive rename may use a retained FD.
        let source_parent = macos::rebind_recovery_parent(
            &source.platform.authorized_root_path,
            &source.platform.root_identity,
            &source.platform.parent_components,
            &source.platform.parent_identity,
        )?;
        let slot = macos::rebind_recovery_slot(&recovery.binding)?;
        macos::move_snapshot(&source_parent, &source.platform.leaf, &slot, "content")
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = (source, recovery);
        Err(WorkAssistantError::blocked(
            "native recovery move is unavailable",
        ))
    }
}

fn create_directory(destination: &DestinationBinding) -> Result<(), WorkAssistantError> {
    verify_destination_binding(destination)?;
    #[cfg(windows)]
    {
        windows::create_directory(
            &destination.parent,
            &destination.parent_path,
            &destination.leaf,
        )
    }
    #[cfg(target_os = "linux")]
    {
        linux::create_directory(&destination.parent, &destination.leaf)
    }
    #[cfg(target_os = "macos")]
    {
        macos::create_directory(&destination.parent, &destination.leaf)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = destination;
        Err(WorkAssistantError::blocked(
            "native directory creation is unavailable",
        ))
    }
}

/// Re-walk the destination from the retained authorized-root capability immediately before a
/// write.  A descriptor for a moved POSIX directory is otherwise still valid and could mutate a
/// location that has been renamed outside the workspace.
fn verify_destination_binding(destination: &DestinationBinding) -> Result<(), WorkAssistantError> {
    #[cfg(target_os = "linux")]
    {
        return linux::verify_bound_destination(
            &destination.root,
            &destination.authorized_root_path,
            &destination.root_identity,
            &destination.parent,
            &destination.parent_components,
            &destination.parent_identity,
        );
    }
    #[cfg(target_os = "macos")]
    {
        return macos::verify_bound_destination(
            &destination.root,
            &destination.authorized_root_path,
            &destination.root_identity,
            &destination.parent,
            &destination.parent_components,
            &destination.parent_identity,
        );
    }
    #[cfg(windows)]
    {
        // Windows adapter methods independently reopen and compare the path-backed parent
        // before every mutation; retained handles carry no DELETE share.
        let _ = destination;
        return Ok(());
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    Err(WorkAssistantError::blocked(
        "native destination validation is unavailable",
    ))
}

fn persist_recovery_receipt(recovery: &PreparedRecoverySlot) -> Result<(), WorkAssistantError> {
    let bytes = &recovery.receipt_bytes;
    #[cfg(windows)]
    {
        windows::write_recovery_receipt(&recovery.slot, bytes)
    }
    #[cfg(target_os = "linux")]
    {
        let slot = linux::rebind_recovery_slot(&recovery.binding)?;
        linux::write_recovery_receipt(&slot, bytes)
    }
    #[cfg(target_os = "macos")]
    {
        let slot = macos::rebind_recovery_slot(&recovery.binding)?;
        macos::write_recovery_receipt(&slot, bytes)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = bytes;
        Err(WorkAssistantError::blocked(
            "native recovery receipts are unavailable",
        ))
    }
}

/// Remove an empty, never-committed slot through freshly verified namespace capabilities. This
/// deliberately never uses a caller path or a generic filesystem deletion API.
fn remove_recovery_slot(binding: &RecoveryBinding) -> Result<(), WorkAssistantError> {
    #[cfg(windows)]
    {
        windows::remove_empty_recovery_slot(binding)
    }
    #[cfg(target_os = "linux")]
    {
        linux::remove_empty_recovery_slot(binding)
    }
    #[cfg(target_os = "macos")]
    {
        macos::remove_empty_recovery_slot(binding)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = binding;
        Err(WorkAssistantError::blocked("native recovery cleanup is unavailable"))
    }
}

fn preflight_recovery_receipt(recovery: &PreparedRecoverySlot) -> Result<(), WorkAssistantError> {
    // Do not create a receipt during preparation. Besides leaving orphan metadata for an
    // abandoned approval, that would write through a slot before the execution-time rebind.
    #[cfg(windows)]
    {
        windows::preflight_recovery_receipt(&recovery.slot)
    }
    #[cfg(target_os = "linux")]
    {
        let slot = linux::rebind_recovery_slot(&recovery.binding)?;
        linux::preflight_recovery_receipt(&slot)
    }
    #[cfg(target_os = "macos")]
    {
        let slot = macos::rebind_recovery_slot(&recovery.binding)?;
        macos::preflight_recovery_receipt(&slot)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = recovery;
        Err(WorkAssistantError::blocked(
            "native recovery receipts are unavailable",
        ))
    }
}

fn cleanup_cancelled_staging(mut staged: StagedFile, message: &str) -> WorkAssistantError {
    let result = remove_staging_file(&staged.file, &staged.parent, &staged.leaf);
    staged.published = true;
    match result {
        Ok(()) => WorkAssistantError::cancelled(message),
        Err(error) => WorkAssistantError::partial_transaction(format!(
            "{message}; staged content could not be cleaned up: {}",
            safe_transaction_error(&error)
        )),
    }
}

fn cleanup_recoverable_staging_after_destination_recovery(
    mut staged: StagedFile,
) -> WorkAssistantError {
    let cleanup = remove_staging_file(&staged.file, &staged.parent, &staged.leaf);
    staged.published = true;
    match cleanup {
        Ok(()) => WorkAssistantError::partial_transaction(
            "the old destination is safely recoverable; the replacement was not published because the operation was cancelled",
        ),
        Err(error) => WorkAssistantError::partial_transaction(format!(
            "the old destination is safely recoverable; the replacement was not published because the operation was cancelled, and staged content could not be cleaned up: {}",
            safe_transaction_error(&error)
        )),
    }
}

fn cleanup_stale_staging(
    mut staged: StagedFile,
    original: WorkAssistantError,
) -> WorkAssistantError {
    let cleanup = remove_staging_file(&staged.file, &staged.parent, &staged.leaf);
    staged.published = true;
    match cleanup {
        Ok(()) => WorkAssistantError::stale_preview(original.message),
        Err(error) => WorkAssistantError::partial_transaction(format!(
            "the source changed before publication and opaque staged content could not be cleaned up: {}",
            safe_transaction_error(&error)
        )),
    }
}

/// Revalidate immediately before a staged file can affect a destination.  Keeping ownership of
/// `StagedFile` here is deliberate: a stale source or tampered staging file is unlinked through
/// the already-held capability rather than by resolving its name again.
fn revalidate_staging_for_publish(
    staged: StagedFile,
    source: &SourceSnapshot,
) -> Result<StagedFile, WorkAssistantError> {
    match source
        .verify_content_snapshot()
        .and_then(|_| verify_staged_digest(&staged, source.summary.content_digest))
    {
        Ok(()) => Ok(staged),
        Err(error) => Err(cleanup_stale_staging(staged, error)),
    }
}

/// Once an overwrite destination has been moved to the private recovery vault and its receipt
/// is durable, a source change is no longer an ordinary stale-preview no-op.  The staged file is
/// still removed through its held capability, but callers must surface that the old destination
/// remains recoverable and that no replacement was published.
fn revalidate_after_destination_recovery(
    staged: StagedFile,
    source: &SourceSnapshot,
) -> Result<StagedFile, WorkAssistantError> {
    revalidate_staging_for_publish(staged, source).map_err(|error| {
        let cleanup_note = if error.code == "partial_transaction" {
            "; opaque staged content could not be cleaned up"
        } else {
            ""
        };
        WorkAssistantError::partial_transaction(format!(
            "the old destination is safely recoverable and the new content was not published because the source changed after recovery{cleanup_note}"
        ))
    })
}

fn verify_staged_digest(staged: &StagedFile, expected: [u8; 32]) -> Result<(), WorkAssistantError> {
    if staged.digest != expected {
        return Err(WorkAssistantError::stale_preview(
            "staged content differs from the approved source preview",
        ));
    }
    let byte_len = staged.file.metadata().map_err(io_error)?.len();
    let digest = digest_regular_file(&staged.file, byte_len)?;
    if digest == expected {
        Ok(())
    } else {
        Err(WorkAssistantError::stale_preview(
            "staged content differs from the approved source preview",
        ))
    }
}

fn safe_transaction_error(error: &WorkAssistantError) -> &'static str {
    match error.code.as_str() {
        "stale_preview" => "the filesystem changed",
        "cross_device" => "the filesystem devices differ",
        "recovery_unavailable" => "private recovery storage is unavailable",
        "partial_transaction" => "a recoverable transaction step failed",
        "cancelled" => "the operation was cancelled",
        _ => "the native filesystem operation failed",
    }
}

fn remove_staging_file(file: &File, parent: &File, leaf: &str) -> Result<(), WorkAssistantError> {
    #[cfg(windows)]
    {
        let _ = (parent, leaf);
        windows::remove_staging(file)
    }
    #[cfg(target_os = "linux")]
    {
        linux::remove_staging(parent, leaf)
    }
    #[cfg(target_os = "macos")]
    {
        macos::remove_staging(parent, leaf)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = (file, parent, leaf);
        Err(WorkAssistantError::blocked(
            "native staging cleanup is unavailable",
        ))
    }
}

#[cfg(test)]
thread_local! {
    static INJECT_RENAME_PUBLICATION_COLLISION: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static INJECT_AFTER_STAGING_BEFORE_PREPUBLISH: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static INJECT_AFTER_DESTINATION_RECOVERY: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn inject_rename_publication_collision_once() {
    INJECT_RENAME_PUBLICATION_COLLISION.with(|value| value.set(true));
}

fn injected_rename_collision() -> bool {
    #[cfg(test)]
    {
        return INJECT_RENAME_PUBLICATION_COLLISION.with(|value| value.replace(false));
    }
    #[cfg(not(test))]
    false
}

#[cfg(test)]
fn inject_after_staging_before_prepublish(callback: impl FnOnce() + 'static) {
    INJECT_AFTER_STAGING_BEFORE_PREPUBLISH.with(|value| {
        assert!(
            value.borrow().is_none(),
            "only one prepublish test hook may be pending"
        );
        *value.borrow_mut() = Some(Box::new(callback));
    });
}

#[cfg(test)]
fn inject_after_destination_recovery(callback: impl FnOnce() + 'static) {
    INJECT_AFTER_DESTINATION_RECOVERY.with(|value| {
        assert!(
            value.borrow().is_none(),
            "only one post-recovery test hook may be pending"
        );
        *value.borrow_mut() = Some(Box::new(callback));
    });
}

fn run_after_staging_before_prepublish_hook() {
    #[cfg(test)]
    INJECT_AFTER_STAGING_BEFORE_PREPUBLISH.with(|value| {
        if let Some(callback) = value.borrow_mut().take() {
            callback();
        }
    });
}

fn run_after_destination_recovery_hook() {
    #[cfg(test)]
    INJECT_AFTER_DESTINATION_RECOVERY.with(|value| {
        if let Some(callback) = value.borrow_mut().take() {
            callback();
        }
    });
}

fn verify_published_copy(
    source: &SourceSnapshot,
    destination: &DestinationBinding,
) -> Result<(), WorkAssistantError> {
    #[cfg(windows)]
    {
        windows::verify_published(
            &destination.parent,
            &destination.parent_path,
            &destination.leaf,
            source.file(),
            source.summary.byte_len,
        )
    }
    #[cfg(target_os = "linux")]
    {
        linux::verify_published(
            &destination.parent,
            &destination.leaf,
            source.file(),
            source.summary.byte_len,
        )
    }
    #[cfg(target_os = "macos")]
    {
        macos::verify_published(
            &destination.parent,
            &destination.leaf,
            source.file(),
            source.summary.byte_len,
        )
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = (source, destination);
        Err(WorkAssistantError::blocked(
            "native publication verification is unavailable",
        ))
    }
}

fn is_cross_device(error: &WorkAssistantError) -> bool {
    error.code == "cross_device"
}

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

/// Keep the physical approved root pathname captured at snapshot time.  POSIX rebinds this
/// pathname with `O_DIRECTORY|O_NOFOLLOW` before every recovery mutation; comparing its handle
/// identity then detects a moved or replaced workspace root.
fn canonical_authorized_root_path(root: &Path) -> Result<PathBuf, WorkAssistantError> {
    std::fs::canonicalize(root).map_err(|error| {
        WorkAssistantError::blocked(format!("could not canonicalize authorized root: {error}"))
    })
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
    #[cfg(windows)]
    ancestor_handles: Vec<File>,
    root_identity: PlatformFileIdentity,
    source_identity: PlatformFileIdentity,
    byte_len: u64,
    version: FileVersion,
}

pub(super) fn file_version(file: &File) -> Result<FileVersion, WorkAssistantError> {
    let metadata = file.metadata().map_err(blocked_io_version)?;
    let modified = metadata.modified().map_err(blocked_io_version)?;
    let modified_unix_nanos = match modified.duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_nanos() as i128,
        Err(error) => -(error.duration().as_nanos() as i128),
    };
    Ok(FileVersion {
        byte_len: metadata.len(),
        modified_unix_nanos,
    })
}

// Keep content capture within the existing preview operation's per-source ceiling. Hashing is
// streamed from a retained handle; no source bytes are accumulated or surfaced to callers.
const MAX_DIGESTED_SOURCE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

fn digest_regular_file(file: &File, expected_len: u64) -> Result<[u8; 32], WorkAssistantError> {
    if expected_len > MAX_DIGESTED_SOURCE_BYTES {
        return Err(WorkAssistantError::blocked(
            "approved source exceeds the maximum preview size",
        ));
    }
    let mut reader = file.try_clone().map_err(io_error)?;
    let original_position = reader.stream_position().map_err(io_error)?;
    let result = (|| {
        reader.seek(SeekFrom::Start(0)).map_err(io_error)?;
        let mut digest = Sha256::new();
        let mut observed = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = reader.read(&mut buffer).map_err(io_error)?;
            if read == 0 {
                break;
            }
            observed = observed.checked_add(read as u64).ok_or_else(|| {
                WorkAssistantError::stale_preview("approved source size overflowed")
            })?;
            if observed > MAX_DIGESTED_SOURCE_BYTES {
                return Err(WorkAssistantError::blocked(
                    "approved source exceeds the maximum preview size",
                ));
            }
            digest.update(&buffer[..read]);
        }
        if observed != expected_len {
            return Err(WorkAssistantError::stale_preview(
                "approved source size changed during integrity verification",
            ));
        }
        Ok(digest.finalize().into())
    })();
    let restore = reader
        .seek(SeekFrom::Start(original_position))
        .map_err(io_error);
    match (result, restore) {
        (Ok(digest), Ok(_)) => Ok(digest),
        (Err(error), _) => Err(error),
        (_, Err(error)) => Err(error),
    }
}

fn blocked_io_version(error: std::io::Error) -> WorkAssistantError {
    WorkAssistantError::blocked(format!("could not inspect approved file version: {error}"))
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
fn open_platform_destination(
    root: &Path,
    relative: &Path,
) -> Result<OpenedDestination, WorkAssistantError> {
    windows::open_destination(root, relative)
}

#[cfg(target_os = "linux")]
fn open_platform_destination(
    root: &Path,
    relative: &Path,
) -> Result<OpenedDestination, WorkAssistantError> {
    linux::open_destination(root, relative)
}

#[cfg(target_os = "macos")]
fn open_platform_destination(
    root: &Path,
    relative: &Path,
) -> Result<OpenedDestination, WorkAssistantError> {
    macos::open_destination(root, relative)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn open_platform_destination(_: &Path, _: &Path) -> Result<OpenedDestination, WorkAssistantError> {
    Err(WorkAssistantError::blocked(
        "native destination capability is unavailable on this platform",
    ))
}

#[cfg(windows)]
fn prepare_platform_recovery_vault(
    root: &Path,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
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
fn rebind_recovery_parent(source: &BoundPlatformSource) -> Result<File, WorkAssistantError> {
    linux::rebind_recovery_parent(
        &source.authorized_root_path,
        &source.root_identity,
        &source.parent_components,
        &source.parent_identity,
    )
}

#[cfg(target_os = "macos")]
fn rebind_recovery_parent(source: &BoundPlatformSource) -> Result<File, WorkAssistantError> {
    macos::rebind_recovery_parent(
        &source.authorized_root_path,
        &source.root_identity,
        &source.parent_components,
        &source.parent_identity,
    )
}

#[cfg(target_os = "linux")]
fn prepare_platform_recovery_vault_at_parent(
    parent: &File,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    linux::prepare_recovery_vault_at_parent(parent, leaf)
}

#[cfg(target_os = "macos")]
fn prepare_platform_recovery_vault_at_parent(
    parent: &File,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    macos::prepare_recovery_vault_at_parent(parent, leaf)
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
fn prepare_platform_recovery_vault(
    root: &Path,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    linux::prepare_recovery_vault(root, leaf)
}

#[cfg(target_os = "macos")]
fn prepare_platform_recovery_vault(
    root: &Path,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    macos::prepare_recovery_vault(root, leaf)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn prepare_platform_recovery_vault(
    _: &Path,
    _: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    Err(WorkAssistantError::blocked(
        "private recovery storage is not available on this platform",
    ))
}

#[cfg(test)]
mod tests {
    use super::inject_after_destination_recovery;
    #[cfg(not(windows))]
    use super::inject_after_staging_before_prepublish;
    #[cfg(unix)]
    use super::{bind_destination, create_directory, stage_source};
    use super::{
        inject_rename_publication_collision_once, open_source_snapshot, prepare_file_transaction,
        validate_recovery_leaf,
    };
    #[cfg(not(windows))]
    use super::prepare_recovery_slot;
    #[cfg(unix)]
    use super::{move_snapshot_to_recovery, persist_recovery_receipt};
    #[cfg(any(unix, windows))]
    use super::prepare_recovery_slot_for_source;
    use crate::work_assistant::{ConflictPolicy, FileOperationKind, FileOperationRequest};
    use std::{
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
    };
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

    #[test]
    #[cfg(not(windows))]
    fn in_place_source_content_change_is_reported_as_stale_preview() {
        use std::io::{Seek, SeekFrom, Write};

        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("document.txt");
        fs::write(&source, b"before\n").unwrap();
        // Keep a writer acquired before the snapshot.  A snapshot cannot revoke a same-user
        // writer that already exists, so content freshness must catch this mutation even though
        // the file identity remains unchanged.
        let mut writer_options = std::fs::OpenOptions::new();
        writer_options.write(true);
        let mut writer = writer_options.open(&source).unwrap();
        let snapshot = open_source_snapshot(&root, "document.txt").unwrap();
        writer.seek(SeekFrom::Start(0)).unwrap();
        writer.write_all(b"after!\n").unwrap();
        writer.sync_all().unwrap();

        let error = snapshot.verify_snapshot().unwrap_err();
        assert_eq!(error.code, "stale_preview");
        drop(writer);
        drop(snapshot);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn content_digest_rejects_a_same_length_rewrite_when_version_matches() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("document.txt");
        fs::write(&source, b"before\n").unwrap();
        let mut snapshot = open_source_snapshot(&root, "document.txt").unwrap();

        fs::write(&source, b"after!\n").unwrap();
        // Model a coarse timestamp filesystem (or a same-timestamp adversarial rewrite): the
        // identity and version seam no longer distinguish the source, so the digest must.
        snapshot.platform.source_version = file_version(snapshot.file()).unwrap();

        let error = snapshot.verify_content_snapshot().unwrap_err();
        assert_eq!(error.code, "stale_preview");
        drop(snapshot);
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
            #[cfg(windows)]
            let slot = prepare_recovery_slot_for_source(&snapshot, "preview-1", 3).unwrap();
            #[cfg(not(windows))]
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
        #[cfg(windows)]
        let first = prepare_recovery_slot_for_source(&snapshot, "preview-1", 0).unwrap();
        #[cfg(not(windows))]
        let first = prepare_recovery_slot(&root, "preview-1", 0, snapshot.summary()).unwrap();
        drop(first);

        // A second slot must accept the pre-existing vault only after its platform
        // privacy policy has been verified. Creating a fresh UUID leaf is expected.
        #[cfg(windows)]
        let second = prepare_recovery_slot_for_source(&snapshot, "preview-2", 1).unwrap();
        #[cfg(not(windows))]
        let second = prepare_recovery_slot(&root, "preview-2", 1, snapshot.summary()).unwrap();
        drop(second);
        drop(snapshot);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn recovery_cleanup_rebind_mismatch_leaves_the_slot_untouched() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("document.txt"), "contents").unwrap();
        let snapshot = open_source_snapshot(&root, "document.txt").unwrap();
        let mut slot = prepare_recovery_slot_for_source(&snapshot, "preview-1", 0).unwrap();
        let slot_path = root
            .join(".papyrus-recovery")
            .join(&slot.receipt.recovery_leaf);
        // This models a namespace replacement detected by the fresh cleanup rebind. The cleanup
        // path must not delete merely by UUID name when any captured identity disagrees.
        slot.binding.slot_identity.file_id.push('x');
        drop(snapshot);

        let error = slot.cleanup_uncommitted().unwrap_err();

        assert_eq!(error.code, "stale_preview");
        assert!(slot_path.is_dir());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn preflight_failure_releases_transaction_locks_before_reclaiming_slot() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("document.txt"), "contents").unwrap();
        let operation = FileOperationRequest {
            kind: FileOperationKind::Trash,
            source: Some("document.txt".into()),
            destination: None,
        };
        super::windows::inject_receipt_probe_sync_failure_once();
        let error = match prepare_file_transaction(
            &root, "preview-preflight", 0, &operation, &ConflictPolicy::Skip,
        ) { Err(error) => error, Ok(_) => panic!("injected recovery preflight must fail") };
        assert_eq!(error.code, "recovery_unavailable");
        assert!(root.join("document.txt").is_file());
        let vault = root.join(".papyrus-recovery");
        assert!(!vault.exists() || fs::read_dir(&vault).unwrap().next().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn second_recovery_preflight_failure_reclaims_the_first_slot_too() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("source.txt"), "source").unwrap();
        fs::write(root.join("destination.txt"), "destination").unwrap();
        let operation = FileOperationRequest {
            kind: FileOperationKind::Move,
            source: Some("source.txt".into()),
            destination: Some("destination.txt".into()),
        };
        super::windows::inject_receipt_probe_sync_failure_after(1);
        let error = match prepare_file_transaction(
            &root, "preview-second-preflight", 0, &operation, &ConflictPolicy::Overwrite,
        ) { Err(error) => error, Ok(_) => panic!("injected second recovery preflight must fail") };
        assert_eq!(error.code, "recovery_unavailable");
        assert!(root.join("source.txt").is_file() && root.join("destination.txt").is_file());
        let vault = root.join(".papyrus-recovery");
        assert!(!vault.exists() || fs::read_dir(&vault).unwrap().next().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_leaf_rejects_model_controlled_separators_and_nuls() {
        for value in ["model/name", "model\\name", "model\0name", ".."] {
            let error = validate_recovery_leaf(value).unwrap_err();
            assert_eq!(error.code, "blocked");
        }
    }

    #[test]
    fn rename_publish_collision_retries_the_next_bounded_suffix() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("source.txt"), "contents").unwrap();
        fs::write(root.join("destination.txt"), "existing").unwrap();
        let operation = FileOperationRequest {
            kind: FileOperationKind::Copy,
            source: Some("source.txt".into()),
            destination: Some("destination.txt".into()),
        };
        let mut transaction = prepare_file_transaction(
            &root,
            "preview-collision",
            0,
            &operation,
            &ConflictPolicy::Rename,
        )
        .unwrap();

        inject_rename_publication_collision_once();
        transaction.execute(|| Ok(false)).unwrap();

        assert!(!root.join("destination (1).txt").exists());
        assert_eq!(
            fs::read_to_string(root.join("destination (2).txt")).unwrap(),
            "contents"
        );
        // The transaction deliberately retains no-DELETE-share source/destination parents until
        // its lifecycle ends. Release those capabilities before asking the test harness to
        // remove the workspace tree.
        drop(transaction);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn overwrite_move_or_rename_cancellation_after_destination_recovery_keeps_recovery_and_cleans_staging(
    ) {
        for (label, kind) in [
            ("move", FileOperationKind::Move),
            ("rename", FileOperationKind::Rename),
        ] {
            let root = test_dir();
            fs::create_dir_all(&root).unwrap();
            let source_path = root.join("source.txt");
            let destination_path = root.join("destination.txt");
            fs::write(&source_path, b"new contents").unwrap();
            fs::write(&destination_path, b"old contents").unwrap();
            let operation = FileOperationRequest {
                kind,
                source: Some("source.txt".into()),
                destination: Some("destination.txt".into()),
            };
            let mut transaction = prepare_file_transaction(
                &root,
                &format!("preview-cancel-after-recovery-{label}"),
                0,
                &operation,
                &ConflictPolicy::Overwrite,
            )
            .unwrap();
            let cancelled = Arc::new(AtomicBool::new(false));
            let cancel_after_recovery = Arc::clone(&cancelled);
            inject_after_destination_recovery(move || {
                cancel_after_recovery.store(true, Ordering::SeqCst);
            });

            let error = match transaction.execute(|| Ok(cancelled.load(Ordering::SeqCst))) {
                Ok(_) => {
                    panic!("{label}: cancellation after recovery must not publish the replacement")
                }
                Err(error) => error,
            };

            assert_eq!(error.code, "partial_transaction", "{label}");
            assert!(
                error
                    .message
                    .contains("old destination is safely recoverable"),
                "{label}: {}",
                error.message
            );
            assert!(
                error.message.contains("replacement was not published"),
                "{label}: {}",
                error.message
            );
            assert!(
                !destination_path.exists(),
                "{label}: the replacement must not be published"
            );
            assert_eq!(fs::read(&source_path).unwrap(), b"new contents", "{label}");
            let recovery_root = root.join(".papyrus-recovery");
            assert!(fs::read_dir(&recovery_root).unwrap().any(|entry| entry
                .unwrap()
                .path()
                .join("receipt.json")
                .exists()));
            assert!(!fs::read_dir(&root).unwrap().any(|entry| {
                entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".papyrus-stage-")
            }));
            // A committed recovery receipt keeps its transaction capabilities live until this
            // scope releases them; cleanup must model the completed transaction lifecycle.
            drop(transaction);
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    #[cfg(not(windows))]
    fn copy_rejects_a_same_length_source_rewrite_after_staging() {
        use std::{
            io::{Seek, SeekFrom, Write},
            sync::{Arc, Mutex},
        };

        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        let source_path = root.join("source.txt");
        let destination_path = root.join("destination.txt");
        fs::write(&source_path, b"before\n").unwrap();
        fs::write(&destination_path, b"existing").unwrap();
        // Keep this writer open before the preview, including on Windows where the retained
        // preview handle correctly blocks a writer opened afterwards.
        let mut writer_options = fs::OpenOptions::new();
        writer_options.write(true);
        let writer = Arc::new(Mutex::new(writer_options.open(&source_path).unwrap()));
        let operation = FileOperationRequest {
            kind: FileOperationKind::Copy,
            source: Some("source.txt".into()),
            destination: Some("destination.txt".into()),
        };
        let transaction = prepare_file_transaction(
            &root,
            "preview-source-rewrite",
            0,
            &operation,
            &ConflictPolicy::Overwrite,
        )
        .unwrap();
        // This hook runs after `stage_source` has completed (including its digest check) and
        // directly before the pre-publish validation.  It therefore exercises the exact race
        // that must leave both destination and recovery state untouched.
        let mutating_writer = Arc::clone(&writer);
        inject_after_staging_before_prepublish(move || {
            let mut writer = mutating_writer.lock().unwrap();
            writer.seek(SeekFrom::Start(0)).unwrap();
            writer.write_all(b"after!\n").unwrap();
            writer.sync_all().unwrap();
        });

        let error = match transaction.execute(|| Ok(false)) {
            Ok(_) => panic!("a source rewrite after staging must reject publication"),
            Err(error) => error,
        };

        assert_eq!(error.code, "stale_preview");
        assert_eq!(fs::read(&destination_path).unwrap(), b"existing");
        let recovery_root = root.join(".papyrus-recovery");
        assert!(
            !recovery_root.exists()
                || !fs::read_dir(&recovery_root).unwrap().any(|entry| entry
                    .unwrap()
                    .path()
                    .join("receipt.json")
                    .exists()),
            "a stale source must not create an overwrite recovery receipt"
        );
        assert!(!fs::read_dir(&root).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".papyrus-stage-")
        }));
        drop(writer);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(not(windows))]
    fn overwrite_reports_partial_transaction_when_source_changes_after_old_destination_recovery() {
        use std::{
            io::{Seek, SeekFrom, Write},
            sync::{Arc, Mutex},
        };

        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        let source_path = root.join("source.txt");
        let destination_path = root.join("destination.txt");
        fs::write(&source_path, b"before\n").unwrap();
        fs::write(&destination_path, b"existing").unwrap();
        let mut writer_options = fs::OpenOptions::new();
        writer_options.write(true);
        let writer = Arc::new(Mutex::new(writer_options.open(&source_path).unwrap()));
        let operation = FileOperationRequest {
            kind: FileOperationKind::Copy,
            source: Some("source.txt".into()),
            destination: Some("destination.txt".into()),
        };
        let transaction = prepare_file_transaction(
            &root,
            "preview-post-recovery-rewrite",
            0,
            &operation,
            &ConflictPolicy::Overwrite,
        )
        .unwrap();
        let mutating_writer = Arc::clone(&writer);
        inject_after_destination_recovery(move || {
            let mut writer = mutating_writer.lock().unwrap();
            writer.seek(SeekFrom::Start(0)).unwrap();
            writer.write_all(b"after!\n").unwrap();
            writer.sync_all().unwrap();
        });

        let error = match transaction.execute(|| Ok(false)) {
            Ok(_) => panic!("a post-recovery source rewrite must not publish the replacement"),
            Err(error) => error,
        };

        assert_eq!(error.code, "partial_transaction");
        assert!(
            !destination_path.exists(),
            "the replacement must not be published"
        );
        let recovery_root = root.join(".papyrus-recovery");
        assert!(fs::read_dir(&recovery_root).unwrap().any(|entry| entry
            .unwrap()
            .path()
            .join("receipt.json")
            .exists()));
        assert!(!fs::read_dir(&root).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".papyrus-stage-")
        }));
        drop(writer);
        fs::remove_dir_all(root).unwrap();
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

    #[cfg(unix)]
    #[test]
    fn moved_destination_ancestor_cannot_receive_staging_or_directory_creation() {
        let root = test_dir();
        let outside = test_dir();
        fs::create_dir_all(root.join("subdir")).unwrap();
        fs::write(root.join("source.txt"), "contents").unwrap();
        let mut source = open_source_snapshot(&root, "source.txt").unwrap();
        let destination = bind_destination(&root, std::path::Path::new("subdir/new.txt")).unwrap();

        fs::rename(root.join("subdir"), &outside).unwrap();

        let stage_error = stage_source(&mut source, &destination).unwrap_err();
        assert_eq!(stage_error.code, "stale_preview");
        let directory_error = create_directory(&destination).unwrap_err();
        assert_eq!(directory_error.code, "stale_preview");
        assert!(!outside.join("new.txt").exists());
        assert!(fs::read_dir(&outside).unwrap().next().is_none());

        drop(destination);
        drop(source);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn replaced_authorized_root_cannot_receive_a_bound_destination_mutation() {
        let root = test_dir();
        let moved_root = test_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("source.txt"), "contents").unwrap();
        let mut source = open_source_snapshot(&root, "source.txt").unwrap();
        let destination = bind_destination(&root, std::path::Path::new("new.txt")).unwrap();

        // A retained directory FD remains usable after this rename. The mutation must instead
        // bind the original root pathname again and reject the replacement root.
        fs::rename(&root, &moved_root).unwrap();
        fs::create_dir_all(&root).unwrap();

        let error = stage_source(&mut source, &destination).unwrap_err();
        assert_eq!(error.code, "stale_preview");
        assert!(!root.join("new.txt").exists());
        assert!(!moved_root.join("new.txt").exists());

        drop(destination);
        drop(source);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(moved_root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn recovery_vault_preparation_rejects_a_replaced_authorized_root() {
        let root = test_dir();
        let moved_root = test_dir();
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("nested/source.txt"), "contents").unwrap();
        let source = open_source_snapshot(&root, "nested/source.txt").unwrap();

        fs::rename(&root, &moved_root).unwrap();
        fs::create_dir_all(&root).unwrap();

        let error = match prepare_recovery_slot_for_source(&source, "preview-rebind", 0) {
            Ok(_) => panic!("recovery vault preparation unexpectedly succeeded"),
            Err(error) => error,
        };
        assert_eq!(error.code, "stale_preview");
        assert!(!root.join(".papyrus-recovery").exists());
        assert!(!moved_root.join("nested/.papyrus-recovery").exists());

        drop(source);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(moved_root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn recovery_receipt_write_rejects_a_moved_recovery_parent() {
        let root = test_dir();
        let moved_root = test_dir();
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("nested/source.txt"), "contents").unwrap();
        let source = open_source_snapshot(&root, "nested/source.txt").unwrap();
        let mut recovery = prepare_recovery_slot_for_source(&source, "preview-rebind", 0).unwrap();
        recovery.receipt_bytes = br#"{\"mustNot\":\"escape\"}"#.to_vec();

        fs::rename(&root, &moved_root).unwrap();
        fs::create_dir_all(root.join("nested")).unwrap();

        let error = persist_recovery_receipt(&recovery).unwrap_err();
        assert_eq!(error.code, "stale_preview");
        assert!(!moved_root
            .join("nested/.papyrus-recovery")
            .join(&recovery.receipt.recovery_leaf)
            .join("receipt.json")
            .exists());

        drop(recovery);
        drop(source);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(moved_root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn recovery_move_rejects_a_moved_authorized_root_without_writing_old_namespace() {
        let root = test_dir();
        let moved_root = test_dir();
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("nested/source.txt"), "contents").unwrap();
        let source = open_source_snapshot(&root, "nested/source.txt").unwrap();
        let recovery = prepare_recovery_slot_for_source(&source, "preview-rebind", 0).unwrap();

        fs::rename(&root, &moved_root).unwrap();
        fs::create_dir_all(root.join("nested")).unwrap();

        let error = move_snapshot_to_recovery(&source, &recovery).unwrap_err();
        assert_eq!(error.code, "stale_preview");
        assert!(moved_root.join("nested/source.txt").is_file());
        assert!(!moved_root
            .join("nested/.papyrus-recovery")
            .join(&recovery.receipt.recovery_leaf)
            .join("content")
            .exists());

        drop(recovery);
        drop(source);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(moved_root).unwrap();
    }
}
