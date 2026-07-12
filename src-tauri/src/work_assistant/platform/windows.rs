use super::{file_version, FileVersion, OpenedDestination, OpenedPlatformSource, PlatformFileIdentity, PreparedRecoveryHandles, StagedFile};
use crate::work_assistant::WorkAssistantError;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    iter,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle},
    },
    path::Path,
    ptr,
};
use windows_sys::Win32::{
    Foundation::{GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE, LocalFree},
    Security::{DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES},
    Security::Authorization::{ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SE_FILE_OBJECT},
    Storage::FileSystem::{
        CreateDirectoryW, CreateFileW, FileAttributeTagInfo, FileIdInfo, GetFileInformationByHandleEx,
        FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_ATTRIBUTE_TAG_INFO, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_ID_INFO, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        DELETE, CREATE_NEW, OPEN_EXISTING,
    },
};

const RECOVERY_DIRECTORY: &str = ".papyrus-recovery";

pub(crate) fn open_source(
    root: &Path,
    relative: &Path,
) -> Result<OpenedPlatformSource, WorkAssistantError> {
    let root = fs::canonicalize(root).map_err(blocked_io("could not resolve authorized root"))?;
    let mut directories = vec![open_snapshot_directory(&root)?];
    let root_identity = file_identity(directories.last().unwrap())?;
    let mut current = root;
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    for component in parent.components() {
        current.push(component.as_os_str());
        directories.push(open_snapshot_directory(&current)?);
    }

    let source_path = current.join(
        relative
            .file_name()
            .ok_or_else(|| WorkAssistantError::blocked("source file name is missing"))?,
    );
    let file = open_source_handle(&source_path)?;
    reject_reparse(&file, "source")?;
    let metadata = file
        .metadata()
        .map_err(blocked_io("could not inspect source"))?;
    if !metadata.is_file() {
        return Err(WorkAssistantError::blocked(
            "approved source must be a regular file",
        ));
    }
    let source_identity = file_identity(&file)?;
    let version = file_version(&file)?;
    let leaf = relative
        .file_name()
        .ok_or_else(|| WorkAssistantError::blocked("source file name is missing"))?
        .to_string_lossy()
        .into_owned();
    Ok(OpenedPlatformSource {
        file: file.try_clone().map_err(blocked_io("could not retain source handle"))?,
        root: directories[0].try_clone().map_err(blocked_io("could not retain root handle"))?,
        parent: directories.last().unwrap().try_clone().map_err(blocked_io("could not retain parent handle"))?,
        source: file,
        leaf,
        parent_identity: file_identity(directories.last().unwrap())?,
        parent_path: current,
        ancestor_handles: directories,
        root_identity,
        source_identity,
        byte_len: metadata.len(),
        version,
    })
}

pub(crate) fn open_destination(
    root: &Path,
    relative: &Path,
) -> Result<OpenedDestination, WorkAssistantError> {
    let root = fs::canonicalize(root).map_err(blocked_io("could not resolve authorized root"))?;
    let mut current = root.clone();
    let mut ancestor_handles = vec![open_read_verified_directory(&root)?];
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    for component in parent.components() {
        current.push(component.as_os_str());
        ancestor_handles.push(open_read_verified_directory(&current)?);
    }
    let leaf = relative.file_name().and_then(|part| part.to_str()).ok_or_else(|| WorkAssistantError::blocked("destination file name is missing"))?;
    if leaf.is_empty() || leaf == "." || leaf == ".." {
        return Err(WorkAssistantError::blocked("destination file name is invalid"));
    }
    let parent_handle = open_read_verified_directory(&current)?;
    Ok(OpenedDestination { parent: parent_handle, leaf: leaf.into(), parent_path: current, ancestor_handles })
}

pub(crate) fn destination_exists(parent: &File, parent_path: &Path, leaf: &str) -> Result<bool, WorkAssistantError> {
    Ok(destination_identity(parent, parent_path, leaf)?.is_some())
}

pub(crate) fn destination_identity(parent: &File, parent_path: &Path, leaf: &str) -> Result<Option<PlatformFileIdentity>, WorkAssistantError> {
    use std::os::windows::fs::MetadataExt;
    let current_parent = open_read_verified_directory(parent_path)?;
    if file_identity(&current_parent)? != file_identity(parent)? {
        return Err(WorkAssistantError::stale_preview("destination parent changed after preview"));
    }
    let candidate = parent_path.join(leaf);
    match fs::symlink_metadata(&candidate) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || is_reparse_attributes(metadata.file_attributes()) {
                return Err(WorkAssistantError::stale_preview("destination is a reparse point"));
            }
            if !metadata.is_file() { return Err(WorkAssistantError::blocked("destination must be a regular file")); }
            let file = open_handle(&candidate, false)?;
            Ok(Some(file_identity(&file)?))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(blocked_io("could not inspect destination")(error)),
    }
}

pub(crate) fn stage_copy(source: &File, parent: &File, parent_path: &Path) -> Result<StagedFile, WorkAssistantError> {
    let current_parent = open_read_verified_directory(parent_path)?;
    if file_identity(&current_parent)? != file_identity(parent)? {
        return Err(WorkAssistantError::stale_preview("destination parent changed before staging"));
    }
    let leaf = format!(".papyrus-stage-{}", uuid::Uuid::new_v4());
    let path = parent_path.join(&leaf);
    let mut output = create_staging_file(&path)?;
    let mut input = source.try_clone().map_err(blocked_io("could not clone approved source handle"))?;
    use std::io::{Read, Seek, SeekFrom, Write};
    input.seek(SeekFrom::Start(0)).map_err(blocked_io("could not seek approved source"))?;
    let mut buffer = [0u8; 64 * 1024];
    let mut digest = Sha256::new();
    loop {
        let read = input.read(&mut buffer).map_err(blocked_io("could not read approved source"))?;
        if read == 0 { break; }
        output.write_all(&buffer[..read]).map_err(blocked_io("could not stage approved source"))?;
        digest.update(&buffer[..read]);
    }
    output.sync_all().map_err(blocked_io("could not sync staged source"))?;
    Ok(StagedFile { file: output, parent: parent.try_clone().map_err(blocked_io("could not retain staging parent"))?, leaf, digest: digest.finalize().into(), published: false })
}

pub(crate) fn publish_staging(staging: &File, parent: &File, leaf: &str) -> Result<(), WorkAssistantError> {
    rename_handle_without_replace(staging, parent, leaf)
}

pub(crate) fn move_snapshot(source: &File, parent: &File, leaf: &str) -> Result<(), WorkAssistantError> {
    rename_handle_without_replace(source, parent, leaf)
}

pub(crate) fn create_directory(parent: &File, parent_path: &Path, leaf: &str) -> Result<(), WorkAssistantError> {
    let current_parent = open_read_verified_directory(parent_path)?;
    if file_identity(&current_parent)? != file_identity(parent)? {
        return Err(WorkAssistantError::stale_preview("destination parent changed before directory creation"));
    }
    let path = parent_path.join(leaf);
    let wide = path.as_os_str().encode_wide().chain(iter::once(0)).collect::<Vec<_>>();
    if unsafe { CreateDirectoryW(wide.as_ptr(), ptr::null()) } == 0 {
        return Err(last_native_error("could not create destination directory"));
    }
    Ok(())
}

pub(crate) fn write_recovery_receipt(slot: &File, receipt: &[u8]) -> Result<(), WorkAssistantError> {
    let mut file = create_child_file(slot, "receipt.json")?;
    use std::io::Write;
    file.write_all(receipt).map_err(blocked_io("could not write recovery receipt"))?;
    file.sync_all().map_err(blocked_io("could not sync recovery receipt"))
}

/// Proves that this held recovery slot can create, flush, close, and remove a receipt-sized
/// child before a transaction mutates either its source or destination. Every child open is
/// relative to the retained slot handle, so this check does not introduce path or reparse walks.
pub(crate) fn preflight_recovery_receipt(slot: &File) -> Result<(), WorkAssistantError> {
    let probe_leaf = uuid::Uuid::new_v4().to_string();
    let outcome = (|| {
        let mut probe = create_child_file_relative(slot, &probe_leaf)?;
        use std::io::Write;
        probe
            .write_all(b"papyrus-recovery-probe")
            .map_err(blocked_io("could not write recovery receipt probe"))?;
        probe
            .sync_all()
            .map_err(blocked_io("could not sync recovery receipt probe"))?;
        drop(probe);
        Ok(())
    })();

    // Cleanup is required even if writing or syncing failed. A failed cleanup makes this
    // preflight fail; otherwise an abandoned probe could be mistaken for receipt metadata.
    let cleanup = delete_child_file_relative(slot, &probe_leaf);
    match (outcome, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(recovery_unavailable(error)),
        (_, Err(error)) => Err(recovery_unavailable(error)),
    }
}

pub(crate) fn remove_staging(staging: &File) -> Result<(), WorkAssistantError> {
    use std::os::windows::io::AsRawHandle;
    let mut info = NtFileDispositionInformation { delete_file: 1 };
    let mut io_status = NtIoStatusBlock { status: 0, information: 0 };
    let status = unsafe {
        NtSetInformationFile(
            staging.as_raw_handle(),
            &mut io_status,
            (&mut info as *mut NtFileDispositionInformation).cast(),
            std::mem::size_of::<NtFileDispositionInformation>() as u32,
            NT_FILE_DISPOSITION_INFORMATION,
        )
    };
    if status < 0 {
        return Err(WorkAssistantError::partial_transaction("could not remove opaque staging file"));
    }
    Ok(())
}

pub(crate) fn verify_published(parent: &File, parent_path: &Path, leaf: &str, source: &File, expected_len: u64) -> Result<(), WorkAssistantError> {
    let current_parent = open_read_verified_directory(parent_path)?;
    if file_identity(&current_parent)? != file_identity(parent)? {
        return Err(WorkAssistantError::stale_preview("destination parent changed after publication"));
    }
    let destination_path = parent_path.join(leaf);
    let destination = open_read_handle(&destination_path, false)?;
    reject_reparse(&destination, "published destination")?;
    let metadata = destination.metadata().map_err(blocked_io("could not inspect published destination"))?;
    if metadata.len() != expected_len { return Err(WorkAssistantError::stale_preview("published destination size differs from source")); }
    let mut left = source.try_clone().map_err(blocked_io("could not clone approved source handle"))?;
    let mut right = destination.try_clone().map_err(blocked_io("could not clone published destination handle"))?;
    use std::io::{Read, Seek, SeekFrom};
    left.seek(SeekFrom::Start(0)).map_err(blocked_io("could not seek approved source"))?;
    right.seek(SeekFrom::Start(0)).map_err(blocked_io("could not seek published destination"))?;
    let mut a = [0u8; 64 * 1024];
    let mut b = [0u8; 64 * 1024];
    loop {
        let an = left.read(&mut a).map_err(blocked_io("could not read approved source"))?;
        let bn = right.read(&mut b).map_err(blocked_io("could not read published destination"))?;
        if an != bn || a[..an] != b[..bn] { return Err(WorkAssistantError::stale_preview("published destination content differs from source")); }
        if an == 0 { return Ok(()); }
    }
}

pub(crate) fn prepare_recovery_vault(root: &Path, leaf: &str) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    let root = fs::canonicalize(root).map_err(blocked_io("could not resolve authorized root"))?;
    let root_guard = open_read_verified_directory(&root)?;
    let vault_path = root.join(RECOVERY_DIRECTORY);
    create_private_directory(&vault_path, true)?;
    let vault_guard = open_read_verified_directory(&vault_path)?;
    verify_private_dacl(&vault_guard)?;
    let leaf_path = vault_path.join(leaf);
    create_private_directory(&leaf_path, false)?;
    let slot = open_read_verified_directory(&leaf_path)?;
    verify_private_dacl(&slot)?;
    Ok(PreparedRecoveryHandles { root: root_guard, vault: vault_guard, slot })
}

/// The caller holds `parent` with delete sharing denied.  Re-opening `parent_path` is therefore
/// bound to that capability for the duration of the transaction, while the vault remains on the
/// source parent's volume (including nested mounted volumes).
pub(crate) fn prepare_recovery_vault_at_parent(
    parent: &File,
    parent_path: &Path,
    leaf: &str,
) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    let current = open_read_verified_directory(parent_path)?;
    if file_identity(&current)? != file_identity(parent)? {
        return Err(WorkAssistantError::stale_preview(
            "the source parent changed before its recovery vault was prepared",
        ));
    }
    let root = parent.try_clone().map_err(blocked_io("could not retain source parent capability"))?;
    let vault_path = parent_path.join(RECOVERY_DIRECTORY);
    create_private_directory(&vault_path, true).map_err(recovery_unavailable)?;
    let vault = open_read_verified_directory(&vault_path).map_err(recovery_unavailable)?;
    verify_private_dacl(&vault).map_err(recovery_unavailable)?;
    let slot_path = vault_path.join(leaf);
    create_private_directory(&slot_path, false).map_err(recovery_unavailable)?;
    let slot = open_read_verified_directory(&slot_path).map_err(recovery_unavailable)?;
    verify_private_dacl(&slot).map_err(recovery_unavailable)?;
    Ok(PreparedRecoveryHandles { root, vault, slot })
}

/// Revalidation consumes only retained capabilities and adapter-private leaf/path metadata.
/// No model or consumer path enters this operation.
pub(crate) fn verify_bound_source(
    root: &File,
    parent: &File,
    source: &File,
    leaf: &str,
    expected_parent_identity: &PlatformFileIdentity,
    parent_path: &Path,
    expected_version: &FileVersion,
) -> Result<(PlatformFileIdentity, PlatformFileIdentity), WorkAssistantError> {
    let root_identity = file_identity(root)?;
    let source_identity = file_identity(source)?;
    if file_version(source)? != *expected_version {
        return Err(WorkAssistantError::stale_preview("the source file content changed after preview"));
    }
    if file_identity(parent)? != *expected_parent_identity {
        return Err(WorkAssistantError::stale_preview("the source parent identity changed after preview"));
    }
    // The retained source handle was opened without WRITE or DELETE sharing. It is therefore
    // the authoritative namespace binding for this transaction: reopening the path here would
    // only race that capability and can fail while a staged copy is active. The held handle's
    // identity/version above plus the source digest checked by the caller are the freshness
    // guard; no path fallback is used.
    let _ = (parent_path, leaf);
    Ok((root_identity, source_identity))
}

const PRIVATE_RECOVERY_DACL: &str = "D:P(A;;FA;;;OW)";

fn create_private_directory(path: &Path, allow_existing: bool) -> Result<(), WorkAssistantError> {
    let wide = path.as_os_str().encode_wide().chain(iter::once(0)).collect::<Vec<_>>();
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    // Protected owner-rights DACL: no inherited ACEs and only the directory owner receives full access.
    let sddl: Vec<u16> = PRIVATE_RECOVERY_DACL.encode_utf16().chain(iter::once(0)).collect();
    if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut descriptor, ptr::null_mut()) } == 0 {
        return Err(WorkAssistantError::blocked(format!("could not build private recovery DACL: {}", std::io::Error::last_os_error())));
    }
    let mut attributes = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: descriptor, bInheritHandle: 0 };
    let result = unsafe { CreateDirectoryW(wide.as_ptr(), &mut attributes) };
    unsafe { LocalFree(descriptor); }
    if result == 0 {
        let error = std::io::Error::last_os_error();
        if allow_existing && error.raw_os_error() == Some(183) {
            return Ok(());
        }
        return Err(WorkAssistantError::blocked(format!("could not create private recovery directory (existing directories are rejected until their DACL is verified): {}", std::io::Error::last_os_error())));
    }
    Ok(())
}

/// Existing recovery directories are accepted only when their DACL is exactly a
/// protected owner-rights full-control ACE: no inherited ACEs and no other SID.
fn verify_private_dacl(file: &File) -> Result<(), WorkAssistantError> {
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    let result = unsafe {
        GetSecurityInfo(
            file.as_raw_handle(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
            ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), &mut descriptor,
        )
    };
    if result != 0 || descriptor.is_null() {
        return Err(WorkAssistantError::blocked(format!("could not inspect recovery directory DACL: Windows error {result}")));
    }
    let mut text_ptr = ptr::null_mut();
    let mut len = 0;
    let converted = unsafe { ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor, 1, DACL_SECURITY_INFORMATION, &mut text_ptr, &mut len) };
    unsafe { LocalFree(descriptor); }
    if converted == 0 || text_ptr.is_null() {
        return Err(WorkAssistantError::blocked(format!("could not serialize recovery directory DACL: {}", std::io::Error::last_os_error())));
    }
    let text = unsafe { String::from_utf16_lossy(std::slice::from_raw_parts(text_ptr, len as usize)) };
    unsafe { LocalFree(text_ptr as *mut std::ffi::c_void); }
    if text.trim_end_matches('\0') != PRIVATE_RECOVERY_DACL {
        return Err(WorkAssistantError::blocked("recovery directory DACL is not owner-only"));
    }
    Ok(())
}

fn open_verified_directory(path: &Path) -> Result<File, WorkAssistantError> {
    let file = open_handle(path, true)?;
    reject_reparse(&file, "directory")?;
    if !file
        .metadata()
        .map_err(blocked_io("could not inspect directory"))?
        .is_dir()
    {
        return Err(WorkAssistantError::blocked(
            "approved path component is not a directory",
        ));
    }
    let _ = file_identity(&file)?;
    Ok(file)
}

fn open_snapshot_directory(path: &Path) -> Result<File, WorkAssistantError> {
    let file = open_handle_with_access(path, true, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE)?;
    reject_reparse(&file, "directory")?;
    if !file.metadata().map_err(blocked_io("could not inspect directory"))?.is_dir() {
        return Err(WorkAssistantError::blocked("approved path component is not a directory"));
    }
    let _ = file_identity(&file)?;
    Ok(file)
}

fn open_read_verified_directory(path: &Path) -> Result<File, WorkAssistantError> {
    // FILE_RENAME_INFO uses this as RootDirectory.  Denying DELETE sharing prevents an
    // ancestor/destination reparse swap while path-derived helper APIs are in flight.
    let file = open_handle_with_access(
        path,
        true,
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
    )?;
    reject_reparse(&file, "directory")?;
    if !file.metadata().map_err(blocked_io("could not inspect directory"))?.is_dir() {
        return Err(WorkAssistantError::blocked("approved path component is not a directory"));
    }
    let _ = file_identity(&file)?;
    Ok(file)
}

fn open_handle(path: &Path, directory: bool) -> Result<File, WorkAssistantError> {
    open_handle_with_access(path, directory, GENERIC_READ | DELETE, FILE_SHARE_READ | FILE_SHARE_WRITE)
}

fn open_source_handle(path: &Path) -> Result<File, WorkAssistantError> {
    // Retain DELETE access for the later atomic rename, but grant no WRITE/DELETE sharing to
    // other handles. The verifier's read-only re-open explicitly grants DELETE sharing back to
    // this retained handle, so freshness checks remain possible without weakening the lock.
    open_handle_with_access(path, false, GENERIC_READ | DELETE, FILE_SHARE_READ)
}

fn open_read_handle(path: &Path, directory: bool) -> Result<File, WorkAssistantError> {
    // Windows checks both directions of sharing.  This verifier requests only read access, but
    // must grant DELETE sharing because the retained source capability itself owns DELETE access.
    open_handle_with_access(path, directory, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
}

fn open_handle_with_access(path: &Path, directory: bool, access: u32, share_mode: u32) -> Result<File, WorkAssistantError> {
    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let mut flags = FILE_FLAG_OPEN_REPARSE_POINT;
    if directory {
        flags |= FILE_FLAG_BACKUP_SEMANTICS;
    }
    // Keep all retained capabilities non-deletable: another process cannot replace
    // the verified root, ancestor, or source while this snapshot is in flight.
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            access,
            share_mode,
            ptr::null(),
            OPEN_EXISTING,
            flags,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(WorkAssistantError::blocked(format!(
            "could not open approved filesystem object: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(unsafe { File::from_raw_handle(handle as *mut std::ffi::c_void) })
}

fn reject_reparse(file: &File, kind: &str) -> Result<(), WorkAssistantError> {
    let mut attributes = FILE_ATTRIBUTE_TAG_INFO {
        FileAttributes: 0,
        ReparseTag: 0,
    };
    let succeeded = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileAttributeTagInfo,
            &mut attributes as *mut FILE_ATTRIBUTE_TAG_INFO as *mut std::ffi::c_void,
            std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
        )
    };
    if succeeded == 0 {
        return Err(WorkAssistantError::blocked(format!(
            "could not query {kind} reparse attributes: {}",
            std::io::Error::last_os_error()
        )));
    }
    if is_reparse_attributes(attributes.FileAttributes) {
        return Err(WorkAssistantError::blocked(format!(
            "approved {kind} may not be a reparse point",
        )));
    }
    Ok(())
}

pub(crate) fn is_reparse_attributes(attributes: u32) -> bool {
    attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

fn file_identity(file: &File) -> Result<PlatformFileIdentity, WorkAssistantError> {
    use std::os::windows::io::AsRawHandle;

    let mut info = FILE_ID_INFO {
        VolumeSerialNumber: 0,
        FileId: windows_sys::Win32::Storage::FileSystem::FILE_ID_128 {
            Identifier: [0; 16],
        },
    };
    let succeeded = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            &mut info as *mut FILE_ID_INFO as *mut std::ffi::c_void,
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    };
    if succeeded == 0 {
        return Err(WorkAssistantError::blocked(format!(
            "could not query filesystem identity: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(PlatformFileIdentity {
        platform: "windows".into(),
        volume: format!("{:016x}", info.VolumeSerialNumber),
        file_id: info
            .FileId
            .Identifier
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    })
}

fn rename_handle_without_replace(source: &File, destination_parent: &File, leaf: &str) -> Result<(), WorkAssistantError> {
    use std::os::windows::{ffi::OsStrExt, io::AsRawHandle};

    let name = std::ffi::OsStr::new(leaf).encode_wide().collect::<Vec<_>>();
    if name.is_empty() || name.iter().any(|value| *value == 0) {
        return Err(WorkAssistantError::blocked("native destination leaf is invalid"));
    }
    let prefix = std::mem::offset_of!(NtFileRenameInformation, file_name);
    let mut buffer = vec![0u8; prefix + name.len() * std::mem::size_of::<u16>()];
    let info = buffer.as_mut_ptr() as *mut NtFileRenameInformation;
    unsafe {
        (*info).replace_if_exists = 0;
        (*info).root_directory = destination_parent.as_raw_handle();
        (*info).file_name_length = (name.len() * std::mem::size_of::<u16>()) as u32;
        std::ptr::copy_nonoverlapping(name.as_ptr(), (*info).file_name.as_mut_ptr(), name.len());
    }
    let mut io_status = NtIoStatusBlock { status: 0, information: 0 };
    let status = unsafe {
        NtSetInformationFile(
            source.as_raw_handle(),
            &mut io_status,
            info.cast(),
            buffer.len() as u32,
            NT_FILE_RENAME_INFORMATION,
        )
    };
    if status < 0 {
        return match status as u32 {
            0xC000_0035 => Err(WorkAssistantError::destination_exists("destination changed before native publication")),
            0xC000_00D4 => Err(WorkAssistantError { code: "cross_device".into(), message: "native rename crosses filesystem devices".into(), recoverable: true }),
            value => Err(WorkAssistantError::blocked(format!("could not complete native relative rename (NTSTATUS 0x{value:08X})"))),
        };
    }
    Ok(())
}

// `NtSetInformationFile(FileRenameInformation)` is the native relative-rename primitive.  It is
// intentionally kept private to this adapter: RootDirectory is a retained directory handle and
// `file_name` has been validated as exactly one leaf before this FFI boundary.
const NT_FILE_RENAME_INFORMATION: u32 = 10;

#[repr(C)]
struct NtIoStatusBlock {
    status: i32,
    information: usize,
}

#[repr(C)]
struct NtFileRenameInformation {
    replace_if_exists: u8,
    _padding: [u8; 7],
    root_directory: *mut std::ffi::c_void,
    file_name_length: u32,
    file_name: [u16; 1],
}

#[repr(C)]
struct NtFileDispositionInformation {
    delete_file: u8,
}

const NT_FILE_DISPOSITION_INFORMATION: u32 = 13;
const FILE_CREATE: u32 = 2;
const FILE_NON_DIRECTORY_FILE: u32 = 0x0000_0040;
const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x0000_0020;
const FILE_OPEN_REPARSE_POINT_NATIVE: u32 = 0x0020_0000;
const OBJ_CASE_INSENSITIVE: u32 = 0x0000_0040;
const SYNCHRONIZE: u32 = 0x0010_0000;

#[repr(C)]
struct NtUnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}

#[repr(C)]
struct NtObjectAttributes {
    length: u32,
    root_directory: *mut std::ffi::c_void,
    object_name: *mut NtUnicodeString,
    attributes: u32,
    security_descriptor: *mut std::ffi::c_void,
    security_quality_of_service: *mut std::ffi::c_void,
}

#[link(name = "ntdll")]
extern "system" {
    fn NtCreateFile(
        file_handle: *mut *mut std::ffi::c_void,
        desired_access: u32,
        object_attributes: *mut NtObjectAttributes,
        io_status_block: *mut NtIoStatusBlock,
        allocation_size: *mut i64,
        file_attributes: u32,
        share_access: u32,
        create_disposition: u32,
        create_options: u32,
        ea_buffer: *mut std::ffi::c_void,
        ea_length: u32,
    ) -> i32;
    fn NtOpenFile(
        file_handle: *mut *mut std::ffi::c_void,
        desired_access: u32,
        object_attributes: *mut NtObjectAttributes,
        io_status_block: *mut NtIoStatusBlock,
        share_access: u32,
        open_options: u32,
    ) -> i32;
    fn NtSetInformationFile(
        file_handle: *mut std::ffi::c_void,
        io_status_block: *mut NtIoStatusBlock,
        file_information: *mut std::ffi::c_void,
        length: u32,
        file_information_class: u32,
    ) -> i32;
}

fn relative_object_attributes(
    parent: &File,
    leaf: &str,
) -> Result<(Vec<u16>, NtUnicodeString, NtObjectAttributes), WorkAssistantError> {
    use std::os::windows::io::AsRawHandle;

    if uuid::Uuid::parse_str(leaf).is_err() {
        return Err(WorkAssistantError::blocked("recovery probe leaf is invalid"));
    }
    let mut name = std::ffi::OsStr::new(leaf).encode_wide().collect::<Vec<_>>();
    let byte_len = name
        .len()
        .checked_mul(std::mem::size_of::<u16>())
        .and_then(|length| u16::try_from(length).ok())
        .ok_or_else(|| WorkAssistantError::blocked("recovery probe leaf is too long"))?;
    // Native counted strings do not include a terminator in their length.
    name.push(0);
    let mut object_name = NtUnicodeString {
        length: byte_len,
        maximum_length: byte_len,
        buffer: name.as_mut_ptr(),
    };
    let attributes = NtObjectAttributes {
        length: std::mem::size_of::<NtObjectAttributes>() as u32,
        root_directory: parent.as_raw_handle(),
        object_name: &mut object_name,
        attributes: OBJ_CASE_INSENSITIVE,
        security_descriptor: ptr::null_mut(),
        security_quality_of_service: ptr::null_mut(),
    };
    Ok((name, object_name, attributes))
}

fn create_child_file_relative(parent: &File, leaf: &str) -> Result<File, WorkAssistantError> {
    let (_name, mut object_name, mut attributes) = relative_object_attributes(parent, leaf)?;
    attributes.object_name = &mut object_name;
    let mut handle = ptr::null_mut();
    let mut io_status = NtIoStatusBlock { status: 0, information: 0 };
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            GENERIC_READ | GENERIC_WRITE | DELETE | SYNCHRONIZE,
            &mut attributes,
            &mut io_status,
            ptr::null_mut(),
            FILE_ATTRIBUTE_NORMAL,
            0,
            FILE_CREATE,
            FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT_NATIVE,
            ptr::null_mut(),
            0,
        )
    };
    if status < 0 {
        return Err(WorkAssistantError::blocked(format!(
            "could not create recovery receipt probe (NTSTATUS 0x{:08X})",
            status as u32
        )));
    }
    let file = unsafe { File::from_raw_handle(handle) };
    reject_reparse(&file, "recovery receipt probe")?;
    Ok(file)
}

fn delete_child_file_relative(parent: &File, leaf: &str) -> Result<(), WorkAssistantError> {
    let (_name, mut object_name, mut attributes) = relative_object_attributes(parent, leaf)?;
    attributes.object_name = &mut object_name;
    let mut handle = ptr::null_mut();
    let mut io_status = NtIoStatusBlock { status: 0, information: 0 };
    let status = unsafe {
        NtOpenFile(
            &mut handle,
            DELETE | GENERIC_READ | SYNCHRONIZE,
            &mut attributes,
            &mut io_status,
            0,
            FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT_NATIVE,
        )
    };
    if status < 0 {
        return Err(WorkAssistantError::blocked(format!(
            "could not reopen recovery receipt probe for cleanup (NTSTATUS 0x{:08X})",
            status as u32
        )));
    }
    let probe = unsafe { File::from_raw_handle(handle) };
    reject_reparse(&probe, "recovery receipt probe")?;
    remove_staging(&probe)
}

fn create_staging_file(path: &Path) -> Result<File, WorkAssistantError> {
    let wide = path.as_os_str().encode_wide().chain(iter::once(0)).collect::<Vec<_>>();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE | DELETE,
            0,
            ptr::null(),
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE { return Err(last_native_error("could not create opaque staging file")); }
    Ok(unsafe { File::from_raw_handle(handle as *mut std::ffi::c_void) })
}

fn create_child_file(parent: &File, leaf: &str) -> Result<File, WorkAssistantError> {
    // CreateFileW has no root-directory handle argument.  The receipt is instead written through
    // a handle-derived final path in the adapter; callers never receive that path.
    let mut path = path_from_handle(parent, "could not resolve private recovery slot")?;
    path.push(leaf);
    open_receipt_file(&path)
}

fn path_from_handle(parent: &File, context: &str) -> Result<std::path::PathBuf, WorkAssistantError> {
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    let mut capacity = 512usize;
    loop {
        let mut buffer = vec![0u16; capacity];
        let length = unsafe { windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW(parent.as_raw_handle(), buffer.as_mut_ptr(), buffer.len() as u32, 0) };
        if length == 0 { return Err(last_native_error(context)); }
        if (length as usize) < buffer.len() {
            return Ok(std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length as usize])));
        }
        capacity = capacity.checked_mul(2).ok_or_else(|| WorkAssistantError::blocked("private recovery slot path is too long"))?;
        if capacity > 32768 { return Err(WorkAssistantError::blocked("private recovery slot path is too long")); }
    }
}

fn open_receipt_file(path: &Path) -> Result<File, WorkAssistantError> {
    let wide = path.as_os_str().encode_wide().chain(iter::once(0)).collect::<Vec<_>>();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null(),
            windows_sys::Win32::Storage::FileSystem::OPEN_ALWAYS,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE { return Err(last_native_error("could not open private recovery receipt")); }
    let mut file = unsafe { File::from_raw_handle(handle as *mut std::ffi::c_void) };
    reject_reparse(&file, "recovery receipt")?;
    file.set_len(0).map_err(blocked_io("could not truncate recovery receipt"))?;
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0)).map_err(blocked_io("could not seek recovery receipt"))?;
    Ok(file)
}

fn last_native_error(context: &str) -> WorkAssistantError {
    WorkAssistantError::blocked(format!("{context}: {}", std::io::Error::last_os_error()))
}

fn recovery_unavailable(error: WorkAssistantError) -> WorkAssistantError {
    WorkAssistantError { code: "recovery_unavailable".into(), message: error.message, recoverable: true }
}

fn blocked_io(context: &'static str) -> impl FnOnce(std::io::Error) -> WorkAssistantError {
    move |error| WorkAssistantError::blocked(format!("{context}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{file_identity, file_version, open_handle, open_read_verified_directory, preflight_recovery_receipt, verify_bound_source};
    use std::{fs, io::{Seek, SeekFrom, Write}, path::PathBuf};

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("papyrus-recovery-probe-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn recovery_receipt_preflight_removes_its_opaque_probe() {
        let root = test_dir();
        fs::create_dir_all(&root).unwrap();
        let slot = open_read_verified_directory(&root).unwrap();

        preflight_recovery_receipt(&slot).unwrap();

        drop(slot);
        assert!(fs::read_dir(&root).unwrap().next().is_none());
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn recovery_receipt_preflight_fails_closed_for_a_non_directory_slot() {
        let path = test_dir();
        let slot = fs::File::create(&path).unwrap();

        let error = preflight_recovery_receipt(&slot).unwrap_err();

        assert_eq!(error.code, "recovery_unavailable");
        assert!(error.recoverable);
        drop(slot);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn in_place_write_with_the_same_file_identity_is_stale() {
        let root_path = test_dir();
        fs::create_dir_all(&root_path).unwrap();
        let source_path = root_path.join("document.txt");
        fs::write(&source_path, b"before\n").unwrap();
        // The verifier accepts a retained shared source here so this test can model a writer
        // acquired before a production snapshot. Production snapshots deny new write sharing.
        let root = open_read_verified_directory(&root_path).unwrap();
        let parent = open_read_verified_directory(&root_path).unwrap();
        let source = open_handle(&source_path, false).unwrap();
        let expected_version = file_version(&source).unwrap();
        let parent_identity = file_identity(&parent).unwrap();
        let mut writer = fs::OpenOptions::new().write(true).open(&source_path).unwrap();
        writer.seek(SeekFrom::Start(0)).unwrap();
        writer.write_all(b"after!\n").unwrap();
        writer.sync_all().unwrap();

        let error = verify_bound_source(
            &root, &parent, &source, "document.txt", &parent_identity, &root_path,
            &expected_version,
        ).unwrap_err();
        assert_eq!(error.code, "stale_preview");

        drop(writer);
        drop(source);
        drop(parent);
        drop(root);
        fs::remove_dir_all(root_path).unwrap();
    }
}
