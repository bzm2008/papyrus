use super::{OpenedPlatformSource, PlatformFileIdentity, PreparedRecoveryHandles};
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
    Foundation::{GENERIC_READ, INVALID_HANDLE_VALUE, LocalFree},
    Security::{DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES},
    Security::Authorization::{ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SE_FILE_OBJECT},
    Storage::FileSystem::{
        CreateDirectoryW, CreateFileW, FileAttributeTagInfo, FileIdInfo, GetFileInformationByHandleEx,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    },
};

const RECOVERY_DIRECTORY: &str = ".papyrus-recovery";

pub(crate) fn open_source(
    root: &Path,
    relative: &Path,
) -> Result<OpenedPlatformSource, WorkAssistantError> {
    let root = fs::canonicalize(root).map_err(blocked_io("could not resolve authorized root"))?;
    let mut directories = vec![open_verified_directory(&root)?];
    let root_identity = file_identity(directories.last().unwrap())?;
    let mut current = root;
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    for component in parent.components() {
        current.push(component.as_os_str());
        directories.push(open_verified_directory(&current)?);
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
        parent_path: current,
        root_identity,
        source_identity,
        byte_len: metadata.len(),
    })
}

pub(crate) fn prepare_recovery_vault(root: &Path, leaf: &str) -> Result<PreparedRecoveryHandles, WorkAssistantError> {
    let root = fs::canonicalize(root).map_err(blocked_io("could not resolve authorized root"))?;
    let root_guard = open_verified_directory(&root)?;
    let vault_path = root.join(RECOVERY_DIRECTORY);
    create_private_directory(&vault_path, true)?;
    let vault_guard = open_verified_directory(&vault_path)?;
    verify_private_dacl(&vault_guard)?;
    let leaf_path = vault_path.join(leaf);
    create_private_directory(&leaf_path, false)?;
    let slot = open_verified_directory(&leaf_path)?;
    verify_private_dacl(&slot)?;
    Ok(PreparedRecoveryHandles { root: root_guard, vault: vault_guard, slot })
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

fn open_handle(path: &Path, directory: bool) -> Result<File, WorkAssistantError> {
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
    let share_mode = FILE_SHARE_READ | FILE_SHARE_WRITE;
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ,
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

fn blocked_io(context: &'static str) -> impl FnOnce(std::io::Error) -> WorkAssistantError {
    move |error| WorkAssistantError::blocked(format!("{context}: {error}"))
}
