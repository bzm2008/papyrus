use crate::work_assistant::WorkAssistantError;
use std::{path::Path, process::Command};

pub(crate) fn open_url(value: &str) -> Result<(), WorkAssistantError> {
    open::that(value)
        .map(|_| ())
        .map_err(|error| WorkAssistantError::blocked(format!("could not open URL: {error}")))
}

pub(crate) fn open_path(path: &Path) -> Result<(), WorkAssistantError> {
    open::that(path)
        .map(|_| ())
        .map_err(|error| WorkAssistantError::blocked(format!("could not open file: {error}")))
}

pub(crate) fn reveal_file(path: &Path) -> Result<(), WorkAssistantError> {
    #[cfg(windows)]
    {
        let argument = format!("/select,{}", path.display());
        return Command::new("explorer.exe")
            .arg(argument)
            .spawn()
            .map(|_| ())
            .map_err(|error| {
                WorkAssistantError::blocked(format!("could not reveal file: {error}"))
            });
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| {
                WorkAssistantError::blocked(format!("could not reveal file: {error}"))
            });
    }
    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().unwrap_or(path);
        return Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map(|_| ())
            .map_err(|error| {
                WorkAssistantError::blocked(format!("could not reveal file: {error}"))
            });
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = path;
        Err(WorkAssistantError::blocked(
            "file reveal is unavailable on this platform",
        ))
    }
}

pub(crate) fn launch_application(path: &Path) -> Result<(), WorkAssistantError> {
    #[cfg(target_os = "macos")]
    {
        return Command::new("open")
            .arg("-a")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| {
                WorkAssistantError::blocked(format!("could not launch application: {error}"))
            });
    }
    #[cfg(any(windows, target_os = "linux"))]
    {
        return Command::new(path).spawn().map(|_| ()).map_err(|error| {
            WorkAssistantError::blocked(format!("could not launch application: {error}"))
        });
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = path;
        Err(WorkAssistantError::blocked(
            "application launch is unavailable on this platform",
        ))
    }
}
