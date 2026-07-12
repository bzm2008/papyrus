use super::{OpenedDestination, OpenedPlatformSource, PlatformFileIdentity, PreparedRecoveryHandles, StagedFile};
use crate::work_assistant::WorkAssistantError;
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
    let file = open_handle(&source_path, false)?;
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

pub(crate) fn reserve_destination_name(parent: &File, parent_path: &Path, leaf: &str) -> Result<bool, WorkAssistantError> {
    Ok(destination_identity(parent, parent_path, leaf)?.is_none())
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
    loop {
        let read = input.read(&mut buffer).map_err(blocked_io("could not read approved source"))?;
        if read == 0 { break; }
        output.write_all(&buffer[..read]).map_err(blocked_io("could not stage approved source"))?;
    }
    output.sync_all().map_err(blocked_io("could not sync staged source"))?;
    Ok(StagedFile { file: output, parent: parent.try_clone().map_err(blocked_io("could not retain staging parent"))?, leaf, published: false })
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
) -> Result<(PlatformFileIdentity, PlatformFileIdentity), WorkAssistantError> {
    let root_identity = file_identity(root)?;
    let source_identity = file_identity(source)?;
    if file_identity(parent)? != *expected_parent_identity {
        return Err(WorkAssistantError::stale_preview("the source parent identity changed after preview"));
    }
    let current = open_read_handle(&parent_path.join(leaf), false).map_err(|error| WorkAssistantError {
        code: error.code,
        message: format!("could not re-open retained source leaf for identity verification: {}", error.message),
        recoverable: error.recoverable,
    })?;
    reject_reparse(&current, "source")?;
    let metadata = current.metadata().map_err(blocked_io("could not inspect source"))?;
    if !metadata.is_file() {
        return Err(WorkAssistantError::blocked("approved source must be a regular file"));
    }
    let current_identity = file_identity(&current)?;
    if current_identity != source_identity {
        return Err(WorkAssistantError::stale_preview("the source file identity changed after preview"));
    }
    Ok((root_identity, current_identity))
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
            0xC000_0035 => Err(WorkAssistantError::stale_preview("destination changed before native publication")),
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

#[link(name = "ntdll")]
extern "system" {
    fn NtSetInformationFile(
        file_handle: *mut std::ffi::c_void,
        io_status_block: *mut NtIoStatusBlock,
        file_information: *mut std::ffi::c_void,
        length: u32,
        file_information_class: u32,
    ) -> i32;
}

fn create_staging_file(path: &Path) -> Result<File, WorkAssistantError> {
    let wide = path.as_os_str().encode_wide().chain(iter::once(0)).collect::<Vec<_>>();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_WRITE | DELETE,
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
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    let mut capacity = 512usize;
    let mut path = loop {
        let mut buffer = vec![0u16; capacity];
        let length = unsafe { windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW(parent.as_raw_handle(), buffer.as_mut_ptr(), buffer.len() as u32, 0) };
        if length == 0 { return Err(last_native_error("could not resolve private recovery slot")); }
        if (length as usize) < buffer.len() {
            break std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length as usize]));
        }
        capacity = capacity.checked_mul(2).ok_or_else(|| WorkAssistantError::blocked("private recovery slot path is too long"))?;
        if capacity > 32768 { return Err(WorkAssistantError::blocked("private recovery slot path is too long")); }
    };
    path.push(leaf);
    open_receipt_file(&path)
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
