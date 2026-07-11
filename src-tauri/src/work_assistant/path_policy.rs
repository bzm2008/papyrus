use crate::work_assistant::{AuthorizedRoot, WorkAssistantError};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub struct PathPolicy<'a> {
    roots: &'a [AuthorizedRoot],
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
        let existing_ancestor = nearest_existing_ancestor(&candidate)?;

        ensure_within_root(&root_path, &existing_ancestor)?;
        Ok(candidate)
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
    if matches_environment_path(path, "XDG_CONFIG_HOME", true)? {
        return Ok(true);
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
}
