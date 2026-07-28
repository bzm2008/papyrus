use crate::work_assistant::WorkAssistantError;
use std::{path::Path, process::Command};

pub(crate) fn open_url(value: &str) -> Result<(), WorkAssistantError> {
    spawn_opener(value, false)
}

pub(crate) fn open_path(path: &Path) -> Result<(), WorkAssistantError> {
    spawn_opener(path, false)
}

fn spawn_opener(
    value: impl AsRef<std::ffi::OsStr>,
    reveal: bool,
) -> Result<(), WorkAssistantError> {
    let mut command = Command::new(opener_executable());
    opener_arguments(&mut command, value.as_ref(), reveal);
    command.spawn().map(|_| ()).map_err(|error| {
        WorkAssistantError::blocked(format!("could not open desktop target: {error}"))
    })
}

fn opener_executable() -> &'static str {
    #[cfg(windows)]
    {
        r"C:\Windows\explorer.exe"
    }
    #[cfg(target_os = "macos")]
    {
        "/usr/bin/open"
    }
    #[cfg(target_os = "linux")]
    {
        // `/usr/bin` is the canonical Debian location.  The fallback is selected only when the
        // first path is unavailable and is still an absolute, fixed system path.
        if std::path::Path::new("/usr/bin/xdg-open").is_file() {
            "/usr/bin/xdg-open"
        } else {
            "/bin/xdg-open"
        }
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        ""
    }
}

fn opener_arguments(command: &mut Command, value: &std::ffi::OsStr, reveal: bool) {
    #[cfg(windows)]
    {
        let _ = reveal;
        command.arg(value);
    }
    #[cfg(target_os = "macos")]
    {
        if reveal {
            command.arg("-R");
        }
        command.arg(value);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = reveal;
        command.arg(value);
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = (command, value, reveal);
    }
}

pub(crate) fn reveal_file(path: &Path) -> Result<(), WorkAssistantError> {
    #[cfg(windows)]
    {
        let argument = format!("/select,{}", path.display());
        return Command::new(r"C:\Windows\explorer.exe")
            .arg(argument)
            .spawn()
            .map(|_| ())
            .map_err(|error| {
                WorkAssistantError::blocked(format!("could not reveal file: {error}"))
            });
    }
    #[cfg(target_os = "macos")]
    {
        return spawn_opener(path, true);
    }
    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().unwrap_or(path);
        return spawn_opener(parent, false);
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
    if !path.is_absolute() {
        return Err(WorkAssistantError::blocked(
            "application launch requires an absolute trusted path",
        ));
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("/usr/bin/open")
            .env_clear()
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
