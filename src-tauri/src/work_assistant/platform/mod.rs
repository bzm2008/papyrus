//! Identity-bound filesystem primitives for approved file work.
//!
//! This boundary protects model-provided relative paths from traversal, link/reparse traversal,
//! stale previews, and ordinary concurrent filesystem changes. It deliberately does not claim to
//! revoke a destructive handle that a same-identity local process acquired before this code did.

use crate::work_assistant::WorkAssistantError;
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
            _ => Err(WorkAssistantError::stale_preview("the workspace or source changed after preview")),
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
            platform_source_identity: source.source_identity.clone(),
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
fn prepare_platform_recovery_vault(root: &Path, leaf: &str) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    windows::prepare_recovery_vault(root, leaf)
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
