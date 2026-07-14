use crate::work_assistant::{AuthorizedRoot, WorkAssistantError};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub struct PathPolicy<'a> {
    roots: &'a [AuthorizedRoot],
}

/// Keeps the complete destination-parent chain open while a mutation is in progress.
/// On Windows these handles deny DELETE sharing, so a later path operation cannot be
/// redirected by replacing a checked parent with a junction or reparse point.
pub struct DestinationMutationGuard {
    candidate: PathBuf,
    #[cfg(windows)]
    _directories: Vec<fs::File>,
    #[cfg(unix)]
    parent: fs::File,
    #[cfg(unix)]
    name: std::ffi::CString,
}

impl DestinationMutationGuard {
    pub fn candidate(&self) -> &Path {
        &self.candidate
    }

    #[cfg(unix)]
    pub fn parent_fd(&self) -> std::os::fd::RawFd {
        use std::os::fd::AsRawFd;

        self.parent.as_raw_fd()
    }

    #[cfg(unix)]
    pub fn name(&self) -> &std::ffi::CStr {
        &self.name
    }
}

impl<'a> PathPolicy<'a> {
    pub fn new(roots: &'a [AuthorizedRoot]) -> Self {
        Self { roots }
    }

    pub fn resolve_existing(
        &self,
        root_id: &str,
        requested_path: impl AsRef<Path>,
    ) -> Result<PathBuf, WorkAssistantError> {
        let root = self.authorized_root(root_id)?;
        let root_path = canonical_root(root)?;
        let candidate = self.relative_candidate(&root_path, requested_path.as_ref())?;
        let resolved = fs::canonicalize(candidate).map_err(|error| {
            WorkAssistantError::blocked(format!("could not resolve workspace path: {error}"))
        })?;

        ensure_within_root(&root_path, &resolved)?;
        Ok(resolved)
    }

    pub fn resolve_destination(
        &self,
        root_id: &str,
        requested_path: impl AsRef<Path>,
    ) -> Result<PathBuf, WorkAssistantError> {
        let root = self.authorized_root(root_id)?;
        let root_path = canonical_root(root)?;
        let candidate = self.relative_candidate(&root_path, requested_path.as_ref())?;
        reject_existing_destination_links(&root_path, &candidate)?;
        let existing_ancestor = nearest_existing_ancestor(&candidate)?;

        ensure_within_root(&root_path, &existing_ancestor)?;
        Ok(candidate)
    }

    /// Resolves a destination and rejects every existing link/reparse point on the path.
    /// The check is repeated immediately before each pathname mutation by file operations.
    pub fn resolve_safe_destination(
        &self,
        root_id: &str,
        requested_path: impl AsRef<Path>,
    ) -> Result<PathBuf, WorkAssistantError> {
        let candidate = self.resolve_destination(root_id, requested_path)?;
        self.verify_safe_destination(root_id, &candidate)?;
        Ok(candidate)
    }

    pub fn verify_safe_destination(
        &self,
        root_id: &str,
        candidate: &Path,
    ) -> Result<(), WorkAssistantError> {
        let root = self.authorized_root(root_id)?;
        let root_path = canonical_root(root)?;
        let relative = candidate.strip_prefix(&root_path).map_err(|_| {
            WorkAssistantError::path_outside_workspace(
                "destination is outside the authorized workspace",
            )
        })?;
        let mut current = root_path.clone();
        for component in relative.components() {
            current.push(component.as_os_str());
            match fs::symlink_metadata(&current) {
                Ok(metadata) => {
                    if is_link_or_reparse_point(&metadata) {
                        return Err(WorkAssistantError::blocked(
                            "destination paths may not contain links or reparse points",
                        ));
                    }
                    let resolved = fs::canonicalize(&current).map_err(|error| {
                        WorkAssistantError::blocked(format!(
                            "could not verify destination path: {error}"
                        ))
                    })?;
                    ensure_within_root(&root_path, &resolved)?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    if current != candidate {
                        return Err(WorkAssistantError::blocked(
                            "destination parent directory does not exist",
                        ));
                    }
                    return Ok(());
                }
                Err(error) => {
                    return Err(WorkAssistantError::blocked(format!(
                        "could not inspect destination path: {error}"
                    )))
                }
            }
        }
        Ok(())
    }

    pub fn bind_destination_mutation(
        &self,
        root_id: &str,
        candidate: &Path,
    ) -> Result<DestinationMutationGuard, WorkAssistantError> {
        self.verify_safe_destination(root_id, candidate)?;

        #[cfg(windows)]
        {
            let root = canonical_root(self.authorized_root(root_id)?)?;
            let parent = candidate.parent().ok_or_else(|| {
                WorkAssistantError::blocked("destination has no parent directory")
            })?;
            let relative_parent = parent.strip_prefix(&root).map_err(|_| {
                WorkAssistantError::path_outside_workspace(
                    "destination parent is outside the authorized workspace",
                )
            })?;
            let mut expected = root.clone();
            let mut directories = Vec::new();
            directories.push(open_verified_windows_directory(&expected)?);
            for component in relative_parent.components() {
                expected.push(component.as_os_str());
                directories.push(open_verified_windows_directory(&expected)?);
            }
            return Ok(DestinationMutationGuard {
                candidate: candidate.to_path_buf(),
                _directories: directories,
            });
        }

        #[cfg(unix)]
        {
            use std::os::unix::{ffi::OsStrExt, fs::OpenOptionsExt};

            let root = canonical_root(self.authorized_root(root_id)?)?;
            let parent = candidate.parent().ok_or_else(|| {
                WorkAssistantError::blocked("destination has no parent directory")
            })?;
            let expected_parent = fs::canonicalize(parent).map_err(|error| {
                WorkAssistantError::blocked(format!(
                    "could not resolve destination parent for binding: {error}"
                ))
            })?;
            ensure_within_root(&root, &expected_parent)?;
            let file = fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
                .open(parent)
                .map_err(|error| {
                    WorkAssistantError::blocked(format!(
                        "could not bind destination parent directory: {error}"
                    ))
                })?;
            let opened_parent = opened_unix_directory_path(&file)?;
            if opened_parent != expected_parent {
                return Err(WorkAssistantError::blocked(
                    "destination parent changed while it was being bound",
                ));
            }
            let name = candidate
                .file_name()
                .ok_or_else(|| WorkAssistantError::blocked("destination has no file name"))?;
            let name = std::ffi::CString::new(name.as_bytes()).map_err(|_| {
                WorkAssistantError::blocked("destination file name contains a NUL byte")
            })?;
            return Ok(DestinationMutationGuard {
                candidate: candidate.to_path_buf(),
                parent: file,
                name,
            });
        }

        #[cfg(not(any(windows, unix)))]
        {
            let _ = (root_id, candidate);
            Err(WorkAssistantError::blocked(
                "secure handle-bound destination mutations are not available on this platform",
            ))
        }
    }

    fn authorized_root(&self, root_id: &str) -> Result<&AuthorizedRoot, WorkAssistantError> {
        self.roots
            .iter()
            .find(|root| root.id == root_id)
            .ok_or_else(|| WorkAssistantError::blocked("authorized root was not found"))
    }

    fn relative_candidate(
        &self,
        root: &Path,
        requested_path: &Path,
    ) -> Result<PathBuf, WorkAssistantError> {
        if requested_path.is_absolute()
            || requested_path.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(WorkAssistantError::path_outside_workspace(
                "workspace paths must be relative and may not contain '..'",
            ));
        }

        Ok(root.join(requested_path))
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn opened_unix_directory_path(file: &fs::File) -> Result<PathBuf, WorkAssistantError> {
    use std::os::fd::AsRawFd;

    fs::canonicalize(format!("/proc/self/fd/{}", file.as_raw_fd())).map_err(|error| {
        WorkAssistantError::blocked(format!(
            "could not verify bound destination directory: {error}"
        ))
    })
}

#[cfg(target_os = "macos")]
fn opened_unix_directory_path(file: &fs::File) -> Result<PathBuf, WorkAssistantError> {
    use std::{ffi::CStr, os::fd::AsRawFd, os::unix::ffi::OsStrExt};

    const F_GETPATH: libc::c_int = 50;
    let mut buffer = [0 as libc::c_char; libc::PATH_MAX as usize];
    let result = unsafe { libc::fcntl(file.as_raw_fd(), F_GETPATH, buffer.as_mut_ptr()) };
    if result == -1 {
        return Err(WorkAssistantError::blocked(format!(
            "could not verify bound destination directory: {}",
            std::io::Error::last_os_error()
        )));
    }
    let bytes = unsafe { CStr::from_ptr(buffer.as_ptr()) }.to_bytes();
    Ok(PathBuf::from(std::ffi::OsStr::from_bytes(bytes)))
}

#[cfg(all(
    unix,
    not(any(target_os = "linux", target_os = "android", target_os = "macos"))
))]
fn opened_unix_directory_path(_: &fs::File) -> Result<PathBuf, WorkAssistantError> {
    Err(WorkAssistantError::blocked(
        "secure handle-bound destination mutations are not available on this platform",
    ))
}

#[cfg(windows)]
fn open_verified_windows_directory(expected: &Path) -> Result<fs::File, WorkAssistantError> {
    use std::{
        iter,
        os::windows::{ffi::OsStrExt, io::FromRawHandle},
        ptr,
    };

    const GENERIC_READ: u32 = 0x8000_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const INVALID_HANDLE_VALUE: isize = -1;

    let wide = expected
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(WorkAssistantError::blocked(format!(
            "could not bind destination directory: {}",
            std::io::Error::last_os_error()
        )));
    }
    let file = unsafe { fs::File::from_raw_handle(handle as *mut std::ffi::c_void) };
    let opened = opened_windows_directory_path(&file)?;
    if normalize_windows_path(expected.to_path_buf()) != opened {
        return Err(WorkAssistantError::blocked(
            "destination directory changed while it was being bound",
        ));
    }
    Ok(file)
}

#[cfg(windows)]
fn opened_windows_directory_path(file: &fs::File) -> Result<PathBuf, WorkAssistantError> {
    use std::{
        ffi::OsString,
        os::windows::{ffi::OsStringExt, io::AsRawHandle},
    };

    let mut buffer = vec![0u16; 260];
    loop {
        let length = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle() as *mut std::ffi::c_void,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
        if length == 0 {
            return Err(WorkAssistantError::blocked(format!(
                "could not verify destination directory: {}",
                std::io::Error::last_os_error()
            )));
        }
        if (length as usize) < buffer.len() {
            return Ok(normalize_windows_path(PathBuf::from(OsString::from_wide(
                &buffer[..length as usize],
            ))));
        }
        buffer.resize(length as usize + 1, 0);
    }
}

#[cfg(windows)]
fn normalize_windows_path(path: PathBuf) -> PathBuf {
    use std::{
        ffi::OsString,
        os::windows::ffi::{OsStrExt, OsStringExt},
    };

    let wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
    const PREFIX: &[u16] = &[b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    if wide.starts_with(PREFIX) {
        return PathBuf::from(OsString::from_wide(&wide[PREFIX.len()..]));
    }
    path
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn CreateFileW(
        file_name: *const u16,
        desired_access: u32,
        share_mode: u32,
        security_attributes: *const std::ffi::c_void,
        creation_disposition: u32,
        flags_and_attributes: u32,
        template_file: *mut std::ffi::c_void,
    ) -> isize;
    fn GetFinalPathNameByHandleW(
        file: *mut std::ffi::c_void,
        path: *mut u16,
        path_length: u32,
        flags: u32,
    ) -> u32;
}

#[cfg(windows)]
fn is_link_or_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    metadata.file_type().is_symlink() || metadata.file_attributes() & 0x0400 != 0
}

#[cfg(not(windows))]
fn is_link_or_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

pub fn validate_authorized_root(
    requested_path: impl AsRef<Path>,
    existing_roots: &[AuthorizedRoot],
) -> Result<PathBuf, WorkAssistantError> {
    let path = fs::canonicalize(requested_path.as_ref()).map_err(|error| {
        WorkAssistantError::blocked(format!("authorized root must exist: {error}"))
    })?;
    if !fs::metadata(&path)
        .map_err(|error| {
            WorkAssistantError::blocked(format!("could not inspect authorized root: {error}"))
        })?
        .is_dir()
    {
        return Err(WorkAssistantError::blocked(
            "authorized root must be an existing directory",
        ));
    }
    if is_sensitive_root(&path)? {
        return Err(WorkAssistantError::blocked(
            "this directory cannot be authorized as a workspace root",
        ));
    }
    for existing in existing_roots {
        let existing_path = canonical_root(existing)?;
        if path_is_within(&path, &existing_path) || path_is_within(&existing_path, &path) {
            return Err(WorkAssistantError::blocked(
                "authorized roots may not duplicate or nest within each other",
            ));
        }
    }

    Ok(path)
}

fn canonical_root(root: &AuthorizedRoot) -> Result<PathBuf, WorkAssistantError> {
    let path = fs::canonicalize(&root.path).map_err(|error| {
        WorkAssistantError::blocked(format!("could not resolve authorized root: {error}"))
    })?;
    if !fs::metadata(&path)
        .map_err(|error| {
            WorkAssistantError::blocked(format!("could not inspect authorized root: {error}"))
        })?
        .is_dir()
    {
        return Err(WorkAssistantError::blocked(
            "authorized root is not a directory",
        ));
    }
    Ok(path)
}

fn nearest_existing_ancestor(path: &Path) -> Result<PathBuf, WorkAssistantError> {
    let mut current = path;
    loop {
        match fs::canonicalize(current) {
            Ok(resolved) => return Ok(resolved),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                current = current.parent().ok_or_else(|| {
                    WorkAssistantError::path_outside_workspace(
                        "workspace destination has no existing ancestor",
                    )
                })?;
            }
            Err(error) => {
                return Err(WorkAssistantError::blocked(format!(
                    "could not resolve workspace destination: {error}"
                )))
            }
        }
    }
}

fn reject_existing_destination_links(
    root: &Path,
    candidate: &Path,
) -> Result<(), WorkAssistantError> {
    let relative = candidate.strip_prefix(root).map_err(|_| {
        WorkAssistantError::path_outside_workspace(
            "destination is outside the authorized workspace",
        )
    })?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if is_link_or_reparse_point(&metadata) => {
                return Err(WorkAssistantError::blocked(
                    "destination paths may not contain links or reparse points",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(WorkAssistantError::blocked(format!(
                    "could not inspect destination path: {error}"
                )));
            }
        }
    }
    Ok(())
}

fn ensure_within_root(root: &Path, path: &Path) -> Result<(), WorkAssistantError> {
    if path_is_within(root, path) {
        Ok(())
    } else {
        Err(WorkAssistantError::path_outside_workspace(
            "path resolves outside the authorized workspace",
        ))
    }
}

fn is_sensitive_root(path: &Path) -> Result<bool, WorkAssistantError> {
    if path.parent().is_none() || matches_environment_path(path, "HOME", false)? {
        return Ok(true);
    }
    #[cfg(windows)]
    {
        if matches_environment_path(path, "USERPROFILE", false)?
            || matches_environment_path(path, "APPDATA", true)?
            || matches_environment_path(path, "LOCALAPPDATA", true)?
        {
            return Ok(true);
        }
    }
    #[cfg(not(windows))]
    {
        if matches_environment_path(path, "XDG_CONFIG_HOME", true)?
            || matches_home_relative_path(path, ".config")
            || matches_home_relative_path(path, ".cache")
            || matches_home_relative_path(path, ".local/share")
        {
            return Ok(true);
        }
        #[cfg(target_os = "macos")]
        if matches_home_relative_path(path, "Library/Application Support")
            || matches_home_relative_path(path, "Library/Preferences")
            || matches_home_relative_path(path, "Library/Caches")
        {
            return Ok(true);
        }
    }

    Ok(path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        name.eq_ignore_ascii_case(".ssh")
            || name.eq_ignore_ascii_case("credential")
            || name.eq_ignore_ascii_case("credentials")
    }))
}

fn matches_environment_path(
    path: &Path,
    variable: &str,
    include_descendants: bool,
) -> Result<bool, WorkAssistantError> {
    let Ok(value) = std::env::var(variable) else {
        return Ok(false);
    };
    let environment_path = match fs::canonicalize(value) {
        Ok(path) => path,
        Err(_) => return Ok(false),
    };
    Ok(if include_descendants {
        path_is_within(&environment_path, path)
    } else {
        path_is_within(&environment_path, path) && path_is_within(path, &environment_path)
    })
}

#[cfg(not(windows))]
fn matches_home_relative_path(path: &Path, suffix: &str) -> bool {
    let Ok(home) = std::env::var("HOME") else {
        return false;
    };
    let Ok(home) = fs::canonicalize(home) else {
        return false;
    };
    let candidate = home.join(suffix);
    path_is_within(&candidate, path)
}

pub fn path_is_within(root: &Path, candidate: &Path) -> bool {
    #[cfg(windows)]
    {
        let root_components = normalized_windows_components(root);
        let candidate_components = normalized_windows_components(candidate);
        candidate_components.starts_with(&root_components)
    }
    #[cfg(not(windows))]
    {
        let root_components = root.components().collect::<Vec<_>>();
        let candidate_components = candidate.components().collect::<Vec<_>>();
        candidate_components.starts_with(&root_components)
    }
}

#[cfg(windows)]
fn normalized_windows_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    #[cfg(not(windows))]
    use super::is_sensitive_root;
    use super::{path_is_within, validate_authorized_root, PathPolicy};
    use crate::work_assistant::{AuthorizedRoot, AuthorizedRootKind};
    use std::{
        fs,
        path::{Path, PathBuf},
    };
    use uuid::Uuid;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("papyrus-path-policy-{}", Uuid::new_v4()))
    }

    #[test]
    fn resolve_existing_rejects_parent_escape_with_path_outside_workspace() {
        let directory = test_dir();
        let root = directory.join("workspace");
        fs::create_dir_all(&root).unwrap();
        fs::write(directory.join("secret.txt"), "secret").unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(root).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let error = PathPolicy::new(&[root])
            .resolve_existing("root", PathBuf::from("../secret.txt"))
            .unwrap_err();

        assert_eq!(error.code, "path_outside_workspace");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn destination_rejects_absolute_path_with_path_outside_workspace() {
        let directory = test_dir();
        fs::create_dir_all(&directory).unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&directory).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let error = PathPolicy::new(&[root])
            .resolve_destination("root", std::env::temp_dir())
            .unwrap_err();

        assert_eq!(error.code, "path_outside_workspace");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn root_validation_rejects_nested_duplicates() {
        let directory = test_dir();
        let root_path = directory.join("workspace");
        let nested_path = root_path.join("nested");
        fs::create_dir_all(&nested_path).unwrap();
        let existing = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&root_path).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let error = validate_authorized_root(&nested_path, &[existing]).unwrap_err();

        assert_eq!(error.code, "blocked");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn root_validation_rejects_credential_directories_case_insensitively() {
        let directory = test_dir();
        let credential = directory.join("CrEdEnTiAl");
        let credentials = directory.join("cReDeNtIaLs");
        fs::create_dir_all(&credential).unwrap();
        fs::create_dir_all(&credentials).unwrap();

        let credential_error = validate_authorized_root(&credential, &[]).unwrap_err();
        let credentials_error = validate_authorized_root(&credentials, &[]).unwrap_err();

        assert_eq!(credential_error.code, "blocked");
        assert_eq!(credentials_error.code, "blocked");
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(not(windows))]
    #[test]
    fn default_unix_application_data_roots_are_sensitive() {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .and_then(|path| fs::canonicalize(path).ok())
            .expect("HOME must be available for the Unix path policy test");
        let mut suffixes = vec![".config", ".cache", ".local/share"];
        #[cfg(target_os = "macos")]
        suffixes.extend([
            "Library/Application Support",
            "Library/Preferences",
            "Library/Caches",
        ]);

        for suffix in suffixes {
            let root = home.join(suffix);
            assert!(
                is_sensitive_root(&root).unwrap(),
                "application data root should be blocked: {}",
                root.display()
            );
            assert!(is_sensitive_root(&root.join("papyrus")).unwrap());
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_path_checks_ignore_component_casing() {
        assert!(path_is_within(
            Path::new(r"C:\\Workspace\\Project"),
            Path::new(r"c:\\workspace\\project\\notes.txt"),
        ));
    }

    #[cfg(unix)]
    #[test]
    fn existing_symlink_escape_is_rejected() {
        use std::os::unix::fs::symlink;

        let directory = test_dir();
        let root_path = directory.join("workspace");
        let outside_path = directory.join("outside");
        fs::create_dir_all(&root_path).unwrap();
        fs::create_dir_all(&outside_path).unwrap();
        fs::write(outside_path.join("secret.txt"), "secret").unwrap();
        symlink(&outside_path, root_path.join("escape")).unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&root_path).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let error = PathPolicy::new(&[root])
            .resolve_existing("root", Path::new("escape/secret.txt"))
            .unwrap_err();

        assert_eq!(error.code, "path_outside_workspace");
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn destination_rejects_an_existing_final_symlink() {
        use std::os::unix::fs::symlink;

        let directory = test_dir();
        let root_path = directory.join("workspace");
        let outside_path = directory.join("outside.txt");
        fs::create_dir_all(&root_path).unwrap();
        fs::write(&outside_path, "outside").unwrap();
        symlink(&outside_path, root_path.join("output.txt")).unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&root_path).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let error = PathPolicy::new(&[root])
            .resolve_destination("root", Path::new("output.txt"))
            .unwrap_err();

        assert_eq!(error.code, "blocked");
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn destination_rejects_a_symlinked_parent_directory() {
        use std::os::unix::fs::symlink;

        let directory = test_dir();
        let root_path = directory.join("workspace");
        let outside_path = directory.join("outside");
        fs::create_dir_all(&root_path).unwrap();
        fs::create_dir_all(&outside_path).unwrap();
        symlink(&outside_path, root_path.join("mutable")).unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&root_path).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let error = PathPolicy::new(&[root])
            .resolve_destination("root", Path::new("mutable/output.txt"))
            .unwrap_err();

        assert_eq!(error.code, "blocked");
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn safe_destination_rejects_a_destination_parent_that_is_a_symlink() {
        use std::os::unix::fs::symlink;

        let directory = test_dir();
        let root_path = directory.join("workspace");
        let outside_path = directory.join("outside");
        fs::create_dir_all(&root_path).unwrap();
        fs::create_dir_all(&outside_path).unwrap();
        symlink(&outside_path, root_path.join("mutable")).unwrap();
        let root = AuthorizedRoot {
            id: "root".into(),
            label: "workspace".into(),
            path: fs::canonicalize(&root_path).unwrap(),
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        };

        let error = PathPolicy::new(&[root])
            .resolve_safe_destination("root", Path::new("mutable/output.txt"))
            .unwrap_err();

        assert_eq!(error.code, "blocked");
        assert!(!outside_path.join("output.txt").exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
