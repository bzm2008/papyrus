use super::{
    file_version, FileVersion, OpenedDestination, OpenedPlatformSource, PlatformFileIdentity, PreparedRecoveryHandles,
    RecoveryBinding, StagedFile,
};
use crate::work_assistant::WorkAssistantError;
use sha2::{Digest, Sha256};
use std::{
    ffi::CString,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{
            ffi::OsStrExt,
            fs::{MetadataExt, OpenOptionsExt},
        },
    },
    path::Path,
};

const RECOVERY_DIRECTORY: &str = ".papyrus-recovery";

pub(crate) fn open_source(
    root: &Path,
    relative: &Path,
) -> Result<OpenedPlatformSource, WorkAssistantError> {
    let root = open_root(root)?;
    let root_identity = identity(&root)?;
    let root_capability = root
        .try_clone()
        .map_err(blocked_io("could not retain root handle"))?;
    let mut directory = root;
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        let name = component_name(component.as_os_str())?;
        if components.peek().is_some() {
            validate_directory_at(directory.as_raw_fd(), &name)?;
            directory = openat_directory(directory.as_raw_fd(), &name)?;
        } else {
            validate_regular_at(directory.as_raw_fd(), &name)?;
            let file = openat_regular(directory.as_raw_fd(), &name)?;
            let metadata = file
                .metadata()
                .map_err(blocked_io("could not inspect source"))?;
            if !metadata.is_file() {
                return Err(WorkAssistantError::blocked(
                    "approved source must be a regular file",
                ));
            }
            return Ok(OpenedPlatformSource {
                file: file
                    .try_clone()
                    .map_err(blocked_io("could not retain source handle"))?,
                root: root_capability,
                parent: directory
                    .try_clone()
                    .map_err(blocked_io("could not retain parent handle"))?,
                source: file,
                leaf: name.to_string_lossy().into_owned(),
                parent_identity: identity(&directory)?,
                root_identity,
                source_identity: identity_from_metadata(&metadata),
                byte_len: metadata.len(),
                version: file_version(&file)?,
            });
        }
    }
    Err(WorkAssistantError::blocked("source file name is missing"))
}

pub(crate) fn open_destination(
    root: &Path,
    relative: &Path,
) -> Result<OpenedDestination, WorkAssistantError> {
    let root = open_root(root)?;
    let root_identity = identity(&root)?;
    let root_capability = root
        .try_clone()
        .map_err(blocked_io("could not retain destination root handle"))?;
    let mut directory = root;
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        let name = component_name(component.as_os_str())?;
        if components.peek().is_some() {
            validate_directory_at(directory.as_raw_fd(), &name)?;
            directory = openat_directory(directory.as_raw_fd(), &name)?;
        } else {
            if name.as_bytes().is_empty() || name.as_bytes() == b"." || name.as_bytes() == b".." {
                return Err(WorkAssistantError::blocked(
                    "destination file name is invalid",
                ));
            }
            let parent_identity = identity(&directory)?;
            return Ok(OpenedDestination {
                parent: directory,
                leaf: name.to_string_lossy().into_owned(),
                root: root_capability,
                root_identity,
                parent_identity,
            });
        }
    }
    Err(WorkAssistantError::blocked(
        "destination file name is missing",
    ))
}

pub(crate) fn destination_exists(parent: &File, leaf: &str) -> Result<bool, WorkAssistantError> {
    Ok(destination_identity(parent, leaf)?.is_some())
}

pub(crate) fn destination_identity(
    parent: &File,
    leaf: &str,
) -> Result<Option<PlatformFileIdentity>, WorkAssistantError> {
    let name = CString::new(leaf)
        .map_err(|_| WorkAssistantError::blocked("destination leaf contains a NUL byte"))?;
    let stat = match stat_at(parent.as_raw_fd(), &name) {
        Ok(stat) => stat,
        Err(error) if error.code == "not_found" => return Ok(None),
        Err(error) => return Err(error),
    };
    if is_symlink(stat.st_mode) {
        return Err(WorkAssistantError::stale_preview(
            "destination is a symbolic link",
        ));
    }
    if !is_regular(stat.st_mode) {
        return Err(WorkAssistantError::blocked(
            "destination must be a regular file",
        ));
    }
    Ok(Some(identity_from_stat(&stat)))
}

pub(crate) fn stage_copy(source: &File, parent: &File) -> Result<StagedFile, WorkAssistantError> {
    let leaf = format!(".papyrus-stage-{}", uuid::Uuid::new_v4());
    let name = CString::new(leaf.as_str()).expect("uuid staging leaf has no NUL");
    let descriptor = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if descriptor < 0 {
        return Err(last_os_error("could not create opaque staging file"));
    }
    let mut output = unsafe { File::from_raw_fd(descriptor) };
    let mut input = source
        .try_clone()
        .map_err(blocked_io("could not clone approved source handle"))?;
    input
        .seek(SeekFrom::Start(0))
        .map_err(blocked_io("could not seek approved source"))?;
    let mut buffer = [0u8; 64 * 1024];
    let mut digest = Sha256::new();
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(blocked_io("could not read approved source"))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(blocked_io("could not stage approved source"))?;
        digest.update(&buffer[..read]);
    }
    output
        .sync_all()
        .map_err(blocked_io("could not sync staged source"))?;
    Ok(StagedFile {
        file: output,
        parent: parent
            .try_clone()
            .map_err(blocked_io("could not retain staging parent"))?,
        leaf,
        digest: digest.finalize().into(),
        published: false,
    })
}

pub(crate) fn publish_staging(
    staged: &StagedFile,
    parent: &File,
    leaf: &str,
) -> Result<(), WorkAssistantError> {
    let old_name = CString::new(staged.leaf.as_str())
        .map_err(|_| WorkAssistantError::blocked("staging leaf contains a NUL byte"))?;
    let new_name = CString::new(leaf)
        .map_err(|_| WorkAssistantError::blocked("destination leaf contains a NUL byte"))?;
    rename_noreplace(
        staged.parent.as_raw_fd(),
        &old_name,
        parent.as_raw_fd(),
        &new_name,
    )
}

pub(crate) fn move_snapshot(
    source_parent: &File,
    source_leaf: &str,
    destination_parent: &File,
    destination_leaf: &str,
) -> Result<(), WorkAssistantError> {
    let source_name = CString::new(source_leaf)
        .map_err(|_| WorkAssistantError::blocked("source leaf contains a NUL byte"))?;
    let destination_name = CString::new(destination_leaf)
        .map_err(|_| WorkAssistantError::blocked("destination leaf contains a NUL byte"))?;
    rename_noreplace(
        source_parent.as_raw_fd(),
        &source_name,
        destination_parent.as_raw_fd(),
        &destination_name,
    )
}

pub(crate) fn create_directory(parent: &File, leaf: &str) -> Result<(), WorkAssistantError> {
    let name = CString::new(leaf)
        .map_err(|_| WorkAssistantError::blocked("destination leaf contains a NUL byte"))?;
    if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o755) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::EEXIST) {
        return Err(WorkAssistantError::stale_preview(
            "destination changed before directory creation",
        ));
    }
    Err(WorkAssistantError::blocked(format!(
        "could not create destination directory: {error}"
    )))
}

pub(crate) fn write_recovery_receipt(
    slot: &File,
    receipt: &[u8],
) -> Result<(), WorkAssistantError> {
    let name = CString::new("receipt.json").expect("static receipt name has no NUL");
    let descriptor = unsafe {
        libc::openat(
            slot.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_TRUNC | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if descriptor < 0 {
        return Err(last_os_error("could not open recovery receipt"));
    }
    let mut file = unsafe { File::from_raw_fd(descriptor) };
    file.write_all(receipt)
        .map_err(blocked_io("could not write recovery receipt"))?;
    file.sync_all()
        .map_err(blocked_io("could not sync recovery receipt"))
}

/// Confirm that the freshly rebound recovery slot can create and remove a private receipt file
/// without leaving receipt metadata behind for an approval that is never executed.
pub(crate) fn preflight_recovery_receipt(slot: &File) -> Result<(), WorkAssistantError> {
    let probe_leaf = format!(".papyrus-receipt-probe-{}", uuid::Uuid::new_v4());
    let name = CString::new(probe_leaf.as_str()).expect("uuid probe leaf has no NUL");
    let descriptor = unsafe {
        libc::openat(
            slot.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    let operation = if descriptor < 0 {
        Err(last_os_error("could not preflight recovery receipt"))
    } else {
        let file = unsafe { File::from_raw_fd(descriptor) };
        sync_receipt_probe(&file).map_err(blocked_io("could not sync recovery receipt preflight"))
    };
    let cleanup = unsafe { libc::unlinkat(slot.as_raw_fd(), name.as_ptr(), 0) };
    let cleanup = if cleanup == 0 { Ok(()) } else { Err(last_os_error("could not clean up recovery receipt preflight")) };
    match (operation, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), _) | (_, Err(error)) => Err(recovery_unavailable(error)),
    }
}

fn sync_receipt_probe(file: &File) -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_RECEIPT_PROBE_SYNC_ONCE.swap(false, std::sync::atomic::Ordering::SeqCst) {
        return Err(std::io::Error::other("injected receipt probe sync failure"));
    }
    file.sync_all()
}

#[cfg(test)]
static FAIL_RECEIPT_PROBE_SYNC_ONCE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub(crate) fn remove_staging(parent: &File, leaf: &str) -> Result<(), WorkAssistantError> {
    let name = CString::new(leaf)
        .map_err(|_| WorkAssistantError::blocked("staging leaf contains a NUL byte"))?;
    if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), 0) } == 0 {
        return Ok(());
    }
    if std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOENT) {
        return Ok(());
    }
    Err(last_os_error("could not clean up staged content"))
}

pub(crate) fn verify_published(
    parent: &File,
    leaf: &str,
    source: &File,
    expected_len: u64,
) -> Result<(), WorkAssistantError> {
    let name = CString::new(leaf)
        .map_err(|_| WorkAssistantError::blocked("destination leaf contains a NUL byte"))?;
    let destination = openat_regular(parent.as_raw_fd(), &name)?;
    let metadata = destination
        .metadata()
        .map_err(blocked_io("could not inspect published destination"))?;
    if metadata.len() != expected_len {
        return Err(WorkAssistantError::stale_preview(
            "published destination size differs from source",
        ));
    }
    compare_contents(source, &destination)
}

fn compare_contents(source: &File, destination: &File) -> Result<(), WorkAssistantError> {
    let mut left = source
        .try_clone()
        .map_err(blocked_io("could not clone approved source handle"))?;
    let mut right = destination
        .try_clone()
        .map_err(blocked_io("could not clone published destination handle"))?;
    left.seek(SeekFrom::Start(0))
        .map_err(blocked_io("could not seek approved source"))?;
    right
        .seek(SeekFrom::Start(0))
        .map_err(blocked_io("could not seek published destination"))?;
    let mut a = [0u8; 64 * 1024];
    let mut b = [0u8; 64 * 1024];
    loop {
        let an = left
            .read(&mut a)
            .map_err(blocked_io("could not read approved source"))?;
        let bn = right
            .read(&mut b)
            .map_err(blocked_io("could not read published destination"))?;
        if an != bn || a[..an] != b[..bn] {
            return Err(WorkAssistantError::stale_preview(
                "published destination content differs from source",
            ));
        }
        if an == 0 {
            return Ok(());
        }
    }
}

fn rename_noreplace(
    from_dir: i32,
    from: &CString,
    to_dir: i32,
    to: &CString,
) -> Result<(), WorkAssistantError> {
    let result = unsafe { renameatx_np(from_dir, from.as_ptr(), to_dir, to.as_ptr(), RENAME_EXCL) };
    if result == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::EEXIST) => Err(WorkAssistantError::destination_exists(
            "destination changed before native publication",
        )),
        Some(libc::EXDEV) => Err(WorkAssistantError {
            code: "cross_device".into(),
            message: "native rename crosses filesystem devices".into(),
            recoverable: true,
        }),
        _ => Err(WorkAssistantError::blocked(format!(
            "could not complete native relative rename: {error}"
        ))),
    }
}

const RENAME_EXCL: u32 = 0x0000_0004;

extern "C" {
    fn renameatx_np(
        fromfd: libc::c_int,
        from: *const libc::c_char,
        tofd: libc::c_int,
        to: *const libc::c_char,
        flags: u32,
    ) -> libc::c_int;
}

pub(crate) fn prepare_recovery_vault(
    root: &Path,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    let root = open_root(root)?;
    let vault_name = CString::new(RECOVERY_DIRECTORY).expect("static recovery name has no NUL");
    mkdirat_private(root.as_raw_fd(), &vault_name, true)?;
    validate_directory_at(root.as_raw_fd(), &vault_name)?;
    let vault = openat_directory(root.as_raw_fd(), &vault_name)?;
    ensure_private_directory(&vault)?;
    let leaf =
        CString::new(leaf).map_err(|_| WorkAssistantError::blocked("invalid recovery leaf"))?;
    mkdirat_private(vault.as_raw_fd(), &leaf, false)?;
    validate_directory_at(vault.as_raw_fd(), &leaf)?;
    let leaf_directory = openat_directory(vault.as_raw_fd(), &leaf)?;
    ensure_private_directory(&leaf_directory)?;
    let vault_identity = identity(&vault)?;
    let slot_identity = identity(&leaf_directory)?;
    Ok(PreparedRecoveryHandles {
        root,
        vault,
        slot: leaf_directory,
        vault_identity,
        slot_identity,
    })
}

pub(crate) fn prepare_recovery_vault_at_parent(
    parent: &File,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    let root = parent
        .try_clone()
        .map_err(blocked_io("could not retain source parent capability"))?;
    let vault_name = CString::new(RECOVERY_DIRECTORY).expect("static recovery name has no NUL");
    mkdirat_private(root.as_raw_fd(), &vault_name, true).map_err(recovery_unavailable)?;
    validate_directory_at(root.as_raw_fd(), &vault_name).map_err(recovery_unavailable)?;
    let vault = openat_directory(root.as_raw_fd(), &vault_name).map_err(recovery_unavailable)?;
    ensure_private_directory(&vault).map_err(recovery_unavailable)?;
    let leaf = CString::new(leaf)
        .map_err(|_| WorkAssistantError::stale_preview("invalid recovery leaf"))?;
    mkdirat_private(vault.as_raw_fd(), &leaf, false).map_err(recovery_unavailable)?;
    validate_directory_at(vault.as_raw_fd(), &leaf).map_err(recovery_unavailable)?;
    let slot = openat_directory(vault.as_raw_fd(), &leaf).map_err(recovery_unavailable)?;
    ensure_private_directory(&slot).map_err(recovery_unavailable)?;
    let vault_identity = identity(&vault).map_err(recovery_unavailable)?;
    let slot_identity = identity(&slot).map_err(recovery_unavailable)?;
    Ok(PreparedRecoveryHandles {
        root,
        vault,
        slot,
        vault_identity,
        slot_identity,
    })
}

pub(crate) fn rebind_recovery_parent(
    authorized_root_path: &Path,
    expected_root_identity: &PlatformFileIdentity,
    parent_components: &[String],
    expected_parent_identity: &PlatformFileIdentity,
) -> Result<File, WorkAssistantError> {
    let current_root = open_root(authorized_root_path)
        .map_err(|_| WorkAssistantError::stale_preview("authorized root changed after preview"))?;
    if identity(&current_root)? != *expected_root_identity {
        return Err(WorkAssistantError::stale_preview(
            "authorized root changed after preview",
        ));
    }
    let mut current = current_root;
    for component in parent_components {
        let name = CString::new(component.as_str())
            .map_err(|_| WorkAssistantError::stale_preview("recovery ancestor is invalid"))?;
        validate_directory_at(current.as_raw_fd(), &name).map_err(|_| {
            WorkAssistantError::stale_preview("recovery ancestor changed after preview")
        })?;
        current = openat_directory(current.as_raw_fd(), &name).map_err(|_| {
            WorkAssistantError::stale_preview("recovery ancestor changed after preview")
        })?;
    }
    if identity(&current)? != *expected_parent_identity {
        return Err(WorkAssistantError::stale_preview(
            "recovery parent changed after preview",
        ));
    }
    Ok(current)
}

pub(crate) fn rebind_recovery_slot(binding: &RecoveryBinding) -> Result<File, WorkAssistantError> {
    let parent = rebind_recovery_parent(
        &binding.authorized_root_path,
        &binding.root_identity,
        &binding.parent_components,
        &binding.parent_identity,
    )?;
    let vault_name = CString::new(RECOVERY_DIRECTORY).expect("static recovery name has no NUL");
    validate_directory_at(parent.as_raw_fd(), &vault_name).map_err(|_| {
        WorkAssistantError::stale_preview("private recovery vault changed after preview")
    })?;
    let vault = openat_directory(parent.as_raw_fd(), &vault_name).map_err(|_| {
        WorkAssistantError::stale_preview("private recovery vault changed after preview")
    })?;
    if identity(&vault)? != binding.vault_identity {
        return Err(WorkAssistantError::stale_preview(
            "private recovery vault changed after preview",
        ));
    }
    let leaf = CString::new(binding.slot_leaf.as_str())
        .map_err(|_| WorkAssistantError::stale_preview("private recovery slot is invalid"))?;
    validate_directory_at(vault.as_raw_fd(), &leaf).map_err(|_| {
        WorkAssistantError::stale_preview("private recovery slot changed after preview")
    })?;
    let slot = openat_directory(vault.as_raw_fd(), &leaf).map_err(|_| {
        WorkAssistantError::stale_preview("private recovery slot changed after preview")
    })?;
    if identity(&slot)? != binding.slot_identity {
        return Err(WorkAssistantError::stale_preview(
            "private recovery slot changed after preview",
        ));
    }
    Ok(slot)
}

/// The retained parent descriptor is the only namespace used for the leaf re-open.
pub(crate) fn verify_bound_source(
    root: &File,
    authorized_root_path: &Path,
    expected_root_identity: &PlatformFileIdentity,
    parent: &File,
    source: &File,
    leaf: &str,
    parent_components: &[String],
    expected_parent_identity: &PlatformFileIdentity,
    expected_version: &FileVersion,
) -> Result<(PlatformFileIdentity, PlatformFileIdentity), WorkAssistantError> {
    let current_root = open_root(authorized_root_path)
        .map_err(|_| WorkAssistantError::stale_preview("authorized root changed after preview"))?;
    let root_identity = identity(&current_root)?;
    if root_identity != *expected_root_identity || identity(root)? != *expected_root_identity {
        return Err(WorkAssistantError::stale_preview(
            "authorized root changed after preview",
        ));
    }
    let source_identity = identity(source)?;
    if file_version(source)? != *expected_version {
        return Err(WorkAssistantError::stale_preview("the source file content changed after preview"));
    }
    if identity(parent)? != *expected_parent_identity {
        return Err(WorkAssistantError::stale_preview(
            "the source parent identity changed after preview",
        ));
    }
    let mut current = current_root;
    for component in parent_components {
        let name = CString::new(component.as_str())
            .map_err(|_| WorkAssistantError::blocked("invalid source parent component"))?;
        validate_directory_at(current.as_raw_fd(), &name).map_err(|_| {
            WorkAssistantError::stale_preview("the source ancestor changed after preview")
        })?;
        current = openat_directory(current.as_raw_fd(), &name).map_err(|_| {
            WorkAssistantError::stale_preview("the source ancestor changed after preview")
        })?;
    }
    if identity(&current)? != *expected_parent_identity {
        return Err(WorkAssistantError::stale_preview(
            "the source parent identity changed after preview",
        ));
    }
    let leaf =
        CString::new(leaf).map_err(|_| WorkAssistantError::blocked("invalid source leaf"))?;
    validate_regular_at(current.as_raw_fd(), &leaf)
        .map_err(|_| WorkAssistantError::stale_preview("the source changed after preview"))?;
    let current_source = openat_regular(current.as_raw_fd(), &leaf)
        .map_err(|_| WorkAssistantError::stale_preview("the source changed after preview"))?;
    let current_identity = identity(&current_source)?;
    if current_identity != source_identity {
        return Err(WorkAssistantError::stale_preview(
            "the source file identity changed after preview",
        ));
    }
    if file_version(&current_source)? != *expected_version {
        return Err(WorkAssistantError::stale_preview("the source file content changed after preview"));
    }
    Ok((root_identity, current_identity))
}

/// Re-walk a destination parent from the authorized root.  POSIX descriptors remain valid after
/// a rename, so identity comparison must happen at the live root namespace before every write.
pub(crate) fn verify_bound_destination(
    root: &File,
    authorized_root_path: &Path,
    expected_root_identity: &PlatformFileIdentity,
    parent: &File,
    parent_components: &[String],
    expected_parent_identity: &PlatformFileIdentity,
) -> Result<(), WorkAssistantError> {
    // Reopen the canonical approved root before every mutation: POSIX descriptors remain live
    // after a rename. A same-identity actor can still race after this rebind, but replacement or
    // disappearance of the root pathname is detected before the handle-backed write.
    let current_root = open_root(authorized_root_path)
        .map_err(|_| WorkAssistantError::stale_preview("authorized root changed after preview"))?;
    if identity(&current_root)? != *expected_root_identity
        || identity(root)? != *expected_root_identity
    {
        return Err(WorkAssistantError::stale_preview(
            "authorized root changed after preview",
        ));
    }
    let mut current = current_root;
    for component in parent_components {
        let name = CString::new(component.as_str())
            .map_err(|_| WorkAssistantError::stale_preview("destination ancestor is invalid"))?;
        validate_directory_at(current.as_raw_fd(), &name).map_err(|_| {
            WorkAssistantError::stale_preview("destination ancestor changed after preview")
        })?;
        current = openat_directory(current.as_raw_fd(), &name).map_err(|_| {
            WorkAssistantError::stale_preview("destination ancestor changed after preview")
        })?;
    }
    if identity(&current)? != *expected_parent_identity
        || identity(parent)? != *expected_parent_identity
    {
        return Err(WorkAssistantError::stale_preview(
            "destination parent changed after preview",
        ));
    }
    Ok(())
}

fn open_root(root: &Path) -> Result<File, WorkAssistantError> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(root)
        .map_err(blocked_io("could not open authorized root"))?;
    ensure_directory(&file)?;
    Ok(file)
}

fn openat_directory(parent: i32, name: &CString) -> Result<File, WorkAssistantError> {
    let descriptor = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if descriptor < 0 {
        return Err(last_os_error("could not open approved directory component"));
    }
    let file = unsafe { File::from_raw_fd(descriptor) };
    ensure_directory(&file)?;
    Ok(file)
}

fn openat_regular(parent: i32, name: &CString) -> Result<File, WorkAssistantError> {
    let descriptor = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if descriptor < 0 {
        return Err(last_os_error("could not open approved source"));
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

// fstatat with AT_SYMLINK_NOFOLLOW checks the directory entry itself before openat follows it.
fn validate_directory_at(parent: i32, name: &CString) -> Result<(), WorkAssistantError> {
    let stat = stat_at(parent, name)?;
    if is_symlink(stat.st_mode) || !is_directory(stat.st_mode) {
        return Err(WorkAssistantError::blocked(
            "approved path component must be a non-link directory",
        ));
    }
    Ok(())
}

fn validate_regular_at(parent: i32, name: &CString) -> Result<(), WorkAssistantError> {
    let stat = stat_at(parent, name)?;
    if is_symlink(stat.st_mode) || !is_regular(stat.st_mode) {
        return Err(WorkAssistantError::blocked(
            "approved source must be a non-link regular file",
        ));
    }
    Ok(())
}

fn stat_at(parent: i32, name: &CString) -> Result<libc::stat, WorkAssistantError> {
    let mut stat = unsafe { std::mem::zeroed::<libc::stat>() };
    if unsafe { libc::fstatat(parent, name.as_ptr(), &mut stat, libc::AT_SYMLINK_NOFOLLOW) } != 0 {
        if std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOENT) {
            return Err(WorkAssistantError {
                code: "not_found".into(),
                message: String::new(),
                recoverable: true,
            });
        }
        return Err(last_os_error("could not inspect approved path component"));
    }
    Ok(stat)
}

fn mkdirat_private(
    parent: i32,
    name: &CString,
    allow_existing: bool,
) -> Result<(), WorkAssistantError> {
    if unsafe { libc::mkdirat(parent, name.as_ptr(), 0o700) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if allow_existing && error.raw_os_error() == Some(libc::EEXIST) {
        return Ok(());
    }
    Err(WorkAssistantError::blocked(format!(
        "could not create private recovery directory: {error}"
    )))
}

fn ensure_directory(file: &File) -> Result<(), WorkAssistantError> {
    if !file
        .metadata()
        .map_err(blocked_io("could not inspect directory"))?
        .is_dir()
    {
        return Err(WorkAssistantError::blocked(
            "approved path component is not a directory",
        ));
    }
    Ok(())
}

fn ensure_private_directory(file: &File) -> Result<(), WorkAssistantError> {
    let metadata = file
        .metadata()
        .map_err(blocked_io("could not inspect recovery directory"))?;
    if !metadata.is_dir() || metadata.mode() & 0o077 != 0 {
        return Err(WorkAssistantError::blocked(
            "recovery directory must be private to the current user",
        ));
    }
    if unsafe { libc::fchmod(file.as_raw_fd(), 0o700) } != 0 {
        return Err(last_os_error(
            "could not enforce private recovery directory permissions",
        ));
    }
    Ok(())
}

fn component_name(value: &std::ffi::OsStr) -> Result<CString, WorkAssistantError> {
    CString::new(value.as_bytes())
        .map_err(|_| WorkAssistantError::blocked("filesystem path contains a NUL byte"))
}
fn identity(file: &File) -> Result<PlatformFileIdentity, WorkAssistantError> {
    Ok(identity_from_metadata(&file.metadata().map_err(
        blocked_io("could not inspect filesystem identity"),
    )?))
}
fn identity_from_metadata(metadata: &std::fs::Metadata) -> PlatformFileIdentity {
    PlatformFileIdentity {
        platform: "macos".into(),
        volume: format!("{:x}", metadata.dev()),
        file_id: format!("{:x}", metadata.ino()),
    }
}
fn identity_from_stat(stat: &libc::stat) -> PlatformFileIdentity {
    PlatformFileIdentity {
        platform: "macos".into(),
        volume: format!("{:x}", stat.st_dev),
        file_id: format!("{:x}", stat.st_ino),
    }
}
fn is_symlink(mode: libc::mode_t) -> bool {
    mode & libc::S_IFMT == libc::S_IFLNK
}
fn is_directory(mode: libc::mode_t) -> bool {
    mode & libc::S_IFMT == libc::S_IFDIR
}
fn is_regular(mode: libc::mode_t) -> bool {
    mode & libc::S_IFMT == libc::S_IFREG
}
fn last_os_error(context: &str) -> WorkAssistantError {
    WorkAssistantError::blocked(format!("{context}: {}", std::io::Error::last_os_error()))
}
fn blocked_io(context: &'static str) -> impl FnOnce(std::io::Error) -> WorkAssistantError {
    move |error| WorkAssistantError::blocked(format!("{context}: {error}"))
}

fn recovery_unavailable(error: WorkAssistantError) -> WorkAssistantError {
    WorkAssistantError {
        code: "recovery_unavailable".into(),
        message: error.message,
        recoverable: true,
    }
}
