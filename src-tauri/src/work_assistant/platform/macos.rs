use super::{OpenedPlatformSource, PlatformFileIdentity};
use crate::work_assistant::WorkAssistantError;
use std::{
    ffi::CString,
    fs::{File, OpenOptions},
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
                file,
                root_identity,
                source_identity: identity_from_metadata(&metadata),
                byte_len: metadata.len(),
            });
        }
    }
    Err(WorkAssistantError::blocked("source file name is missing"))
}

pub(crate) fn prepare_recovery_vault(root: &Path, leaf: &str) -> Result<File, WorkAssistantError> {
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
    Ok(leaf_directory)
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
