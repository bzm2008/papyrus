use super::{OpenedPlatformSource, PlatformFileIdentity};
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
    Foundation::{GENERIC_READ, INVALID_HANDLE_VALUE},
    Storage::FileSystem::{
        CreateFileW, FileAttributeTagInfo, FileIdInfo, GetFileInformationByHandleEx,
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
    Ok(OpenedPlatformSource {
        file,
        root_identity,
        source_identity,
        byte_len: metadata.len(),
    })
}

pub(crate) fn prepare_recovery_vault(root: &Path, leaf: &str) -> Result<File, WorkAssistantError> {
    let root = fs::canonicalize(root).map_err(blocked_io("could not resolve authorized root"))?;
    let _root_guard = open_verified_directory(&root)?;
    let vault_path = root.join(RECOVERY_DIRECTORY);
    create_private_directory(&vault_path, true)?;
    let _vault_guard = open_verified_directory(&vault_path)?;
    let leaf_path = vault_path.join(leaf);
    create_private_directory(&leaf_path, false)?;
    open_verified_directory(&leaf_path)
}

fn create_private_directory(path: &Path, allow_existing: bool) -> Result<(), WorkAssistantError> {
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if allow_existing && error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(blocked_io("could not create private recovery directory")(
            error,
        )),
    }
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
    // DELETE is intentionally excluded from the share mode. It keeps an already opened root,
    // component, or source from being replaced through a normal pathname mutation while bound.
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
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
