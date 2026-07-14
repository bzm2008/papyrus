//! Read-only platform diagnostics for the Work Assistant release boundary.
//!
//! The doctor deliberately does not create probe files, launch applications, or invoke a shell.
//! It reports optional degradation as warnings and reserves errors for broken authorization,
//! audit, or loopback boundaries.

use crate::work_assistant::{
    browser_bridge::BrowserBridgeState, RegisteredApplication, WorkAssistantError,
    WorkAssistantState,
};
use serde::Serialize;
use std::{
    env, fs,
    net::TcpListener,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DoctorStatus {
    Ok,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
    pub id: String,
    pub label: String,
    pub status: DoctorStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkAssistantDoctorReport {
    pub platform: String,
    pub architecture: String,
    pub checks: Vec<DoctorCheck>,
    pub generated_at: u64,
}

/// Inputs that cross the host boundary during a doctor run.
///
/// Production callers should use [`DoctorProbes::system`]. Tests and release checks can inject
/// deterministic paths, PATH lookup results, clock values, and loopback failures without changing
/// process-wide environment variables or launching anything.
#[derive(Debug, Clone)]
pub struct DoctorProbes {
    pub platform: String,
    pub architecture: String,
    pub now: u64,
    pub downloads_directory: Option<PathBuf>,
    pub path_entries: Vec<PathBuf>,
    pub loopback_error: Option<String>,
}

impl DoctorProbes {
    pub fn system() -> Self {
        let platform = env::consts::OS.to_owned();
        let path_entries = env::var_os("PATH")
            .map(|value| env::split_paths(&value).collect())
            .unwrap_or_default();
        let loopback_error = TcpListener::bind(("127.0.0.1", 0))
            .err()
            .map(|error| error.to_string());

        Self {
            platform: platform.clone(),
            architecture: env::consts::ARCH.into(),
            now: unix_seconds(),
            downloads_directory: downloads_directory_for_platform(&platform),
            path_entries,
            loopback_error,
        }
    }
}

#[tauri::command]
pub fn work_assistant_doctor(
    state: State<'_, WorkAssistantState>,
    browser: State<'_, BrowserBridgeState>,
) -> Result<WorkAssistantDoctorReport, crate::work_assistant::AssistantErrorPayload> {
    run_doctor_with_browser(&state, Some(&browser)).map_err(Into::into)
}

pub fn run_doctor(
    state: &WorkAssistantState,
) -> Result<WorkAssistantDoctorReport, WorkAssistantError> {
    let probes = DoctorProbes::system();
    run_doctor_with_browser_and_probes(state, None, &probes)
}

pub fn run_doctor_with_browser(
    state: &WorkAssistantState,
    browser: Option<&BrowserBridgeState>,
) -> Result<WorkAssistantDoctorReport, WorkAssistantError> {
    let probes = DoctorProbes::system();
    run_doctor_with_browser_and_probes(state, browser, &probes)
}

pub fn run_doctor_with_browser_and_probes(
    state: &WorkAssistantState,
    browser: Option<&BrowserBridgeState>,
    probes: &DoctorProbes,
) -> Result<WorkAssistantDoctorReport, WorkAssistantError> {
    let app_data = state
        .audit_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut checks = Vec::new();
    checks.push(check_directory("app_data", "应用数据目录", app_data, true));
    checks.push(check_audit_path(&state.audit_path));

    let roots = state
        .roots
        .read()
        .map_err(|_| WorkAssistantError::protocol("authorized roots lock is unavailable"))?;
    checks.push(check_roots(&roots));
    checks.push(check_downloads_directory(probes));
    checks.push(check_external_opener(probes));
    checks.push(check_registered_applications(app_data));
    checks.push(check_loopback(probes));

    checks.push(check_browser_bridge(browser, probes.now));

    Ok(WorkAssistantDoctorReport {
        platform: probes.platform.clone(),
        architecture: probes.architecture.clone(),
        checks,
        generated_at: probes.now,
    })
}

fn check_browser_bridge(browser: Option<&BrowserBridgeState>, now: u64) -> DoctorCheck {
    let status = browser.map(BrowserBridgeState::status);
    check_browser_bridge_status(status.as_ref(), now)
}

fn check_browser_bridge_status(
    status: Option<&crate::work_assistant::browser_bridge::BrowserBridgeStatus>,
    now: u64,
) -> DoctorCheck {
    let Some(status) = status else {
        return DoctorCheck {
            id: "browser_bridge".into(),
            label: "Browser Bridge".into(),
            status: DoctorStatus::Warning,
            message: "未提供 Browser Bridge 状态；请在设置中检查配对".into(),
        };
    };

    if let Some(error) = status.error.as_ref() {
        return DoctorCheck {
            id: "browser_bridge".into(),
            label: "Browser Bridge".into(),
            status: DoctorStatus::Error,
            message: error.clone(),
        };
    }
    if !status.running {
        return DoctorCheck {
            id: "browser_bridge".into(),
            label: "Browser Bridge".into(),
            status: DoctorStatus::Warning,
            message: "回环监听尚未启动；配对前请生成配对信息".into(),
        };
    }
    if status.expires_at.is_some_and(|expires| expires <= now) {
        return DoctorCheck {
            id: "browser_bridge".into(),
            label: "Browser Bridge".into(),
            status: DoctorStatus::Warning,
            message: "配对信息已过期，请重新生成并连接当前标签页".into(),
        };
    }
    if !status.paired {
        return DoctorCheck {
            id: "browser_bridge".into(),
            label: "Browser Bridge".into(),
            status: DoctorStatus::Warning,
            message: "回环监听已启动，等待扩展配对当前标签页".into(),
        };
    }

    DoctorCheck {
        id: "browser_bridge".into(),
        label: "Browser Bridge".into(),
        status: DoctorStatus::Ok,
        message: format!(
            "已配对当前标签页{}",
            status
                .origin
                .as_deref()
                .map(|origin| format!("：{origin}"))
                .unwrap_or_default()
        ),
    }
}

fn check_directory(id: &str, label: &str, path: &Path, required: bool) -> DoctorCheck {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.permissions().readonly() => DoctorCheck {
            id: id.into(),
            label: label.into(),
            status: DoctorStatus::Ok,
            message: path.to_string_lossy().into_owned(),
        },
        Ok(metadata) if metadata.is_dir() => DoctorCheck {
            id: id.into(),
            label: label.into(),
            status: if required {
                DoctorStatus::Error
            } else {
                DoctorStatus::Warning
            },
            message: format!("{} 不可写", path.display()),
        },
        Ok(_) => DoctorCheck {
            id: id.into(),
            label: label.into(),
            status: DoctorStatus::Error,
            message: format!("{} 不是目录", path.display()),
        },
        Err(error) => DoctorCheck {
            id: id.into(),
            label: label.into(),
            status: if required {
                DoctorStatus::Error
            } else {
                DoctorStatus::Warning
            },
            message: format!("无法读取 {}: {error}", path.display()),
        },
    }
}

fn check_audit_path(path: &Path) -> DoctorCheck {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.permissions().readonly() => DoctorCheck {
            id: "audit_path".into(),
            label: "审计路径".into(),
            status: DoctorStatus::Ok,
            message: path.to_string_lossy().into_owned(),
        },
        Ok(metadata) if metadata.is_file() => DoctorCheck {
            id: "audit_path".into(),
            label: "审计路径".into(),
            status: DoctorStatus::Error,
            message: format!("{} 不可写", path.display()),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path.parent().unwrap_or_else(|| Path::new("."));
            check_directory("audit_path", "审计路径", parent, true)
        }
        Err(error) => DoctorCheck {
            id: "audit_path".into(),
            label: "审计路径".into(),
            status: DoctorStatus::Error,
            message: format!("无法读取 {}: {error}", path.display()),
        },
        Ok(_) => DoctorCheck {
            id: "audit_path".into(),
            label: "审计路径".into(),
            status: DoctorStatus::Error,
            message: format!("{} 不是普通文件", path.display()),
        },
    }
}

fn check_roots(roots: &[crate::work_assistant::AuthorizedRoot]) -> DoctorCheck {
    if roots.is_empty() {
        return DoctorCheck {
            id: "authorized_roots".into(),
            label: "授权目录".into(),
            status: DoctorStatus::Warning,
            message: "尚未授权工作目录".into(),
        };
    }
    let missing: Vec<_> = roots
        .iter()
        .filter(|root| {
            fs::metadata(&root.path)
                .map(|metadata| !metadata.is_dir())
                .unwrap_or(true)
        })
        .map(|root| root.label.as_str())
        .collect();
    if missing.is_empty() {
        DoctorCheck {
            id: "authorized_roots".into(),
            label: "授权目录".into(),
            status: DoctorStatus::Ok,
            message: format!("{} 个目录可读取", roots.len()),
        }
    } else {
        DoctorCheck {
            id: "authorized_roots".into(),
            label: "授权目录".into(),
            status: DoctorStatus::Error,
            message: format!("不可读取：{}", missing.join("、")),
        }
    }
}

fn check_downloads_directory(probes: &DoctorProbes) -> DoctorCheck {
    let path = probes.downloads_directory.as_deref();
    match path {
        Some(path)
            if fs::metadata(&path)
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false) =>
        {
            DoctorCheck {
                id: "downloads_directory".into(),
                label: "下载目录".into(),
                status: DoctorStatus::Ok,
                message: path.to_string_lossy().into_owned(),
            }
        }
        Some(path) => DoctorCheck {
            id: "downloads_directory".into(),
            label: "下载目录".into(),
            status: DoctorStatus::Warning,
            message: format!("下载目录不存在：{}", path.display()),
        },
        None => DoctorCheck {
            id: "downloads_directory".into(),
            label: "下载目录".into(),
            status: DoctorStatus::Warning,
            message: "无法确定下载目录；可在设置中手动授权目录".into(),
        },
    }
}

fn downloads_directory_for_platform(platform: &str) -> Option<PathBuf> {
    let home = if platform == "windows" {
        env::var_os("USERPROFILE")
    } else {
        env::var_os("HOME")
    }?;
    Some(PathBuf::from(home).join("Downloads"))
}

fn check_external_opener(probes: &DoctorProbes) -> DoctorCheck {
    let (id, label, executable) = if probes.platform == "windows" {
        ("external_opener", "外部打开器", "explorer.exe")
    } else if probes.platform == "macos" {
        ("external_opener", "外部打开器", "open")
    } else {
        ("external_opener", "外部打开器", "xdg-open")
    };
    let status = if executable_on_paths(executable, &probes.path_entries, &probes.platform) {
        DoctorStatus::Ok
    } else {
        DoctorStatus::Warning
    };
    let message = if matches!(status, DoctorStatus::Ok) {
        format!("已找到 {executable}")
    } else {
        format!("未找到 {executable}；只能使用受限路径能力")
    };
    DoctorCheck {
        id: id.into(),
        label: label.into(),
        status,
        message,
    }
}

fn executable_on_paths(name: &str, directories: &[PathBuf], platform: &str) -> bool {
    directories.iter().any(|directory| {
        let candidate = directory.join(name);
        candidate.is_file()
            || (platform == "windows" && directory.join(format!("{name}.exe")).is_file())
    })
}

fn check_registered_applications(app_data: &Path) -> DoctorCheck {
    let path = app_data.join("work-assistant-applications.json");
    let contents = match fs::read(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return DoctorCheck {
                id: "registered_applications".into(),
                label: "应用别名".into(),
                status: DoctorStatus::Ok,
                message: "没有登记的应用别名".into(),
            }
        }
        Err(error) => {
            return DoctorCheck {
                id: "registered_applications".into(),
                label: "应用别名".into(),
                status: DoctorStatus::Warning,
                message: format!("无法读取登记文件：{error}"),
            }
        }
    };
    let applications = match serde_json::from_slice::<Vec<RegisteredApplication>>(&contents) {
        Ok(applications) => applications,
        Err(error) => {
            return DoctorCheck {
                id: "registered_applications".into(),
                label: "应用别名".into(),
                status: DoctorStatus::Error,
                message: format!("登记文件格式错误：{error}"),
            }
        }
    };
    let missing = applications
        .iter()
        .filter(|application| !application.executable_path.exists())
        .count();
    if missing == 0 {
        DoctorCheck {
            id: "registered_applications".into(),
            label: "应用别名".into(),
            status: DoctorStatus::Ok,
            message: format!("{} 个应用路径存在", applications.len()),
        }
    } else {
        DoctorCheck {
            id: "registered_applications".into(),
            label: "应用别名".into(),
            status: DoctorStatus::Warning,
            message: format!("{} 个登记路径已失效", missing),
        }
    }
}

fn check_loopback(probes: &DoctorProbes) -> DoctorCheck {
    match probes.loopback_error.as_deref() {
        None => DoctorCheck {
            id: "loopback_port".into(),
            label: "回环端口".into(),
            status: DoctorStatus::Ok,
            message: "可绑定 127.0.0.1 临时端口".into(),
        },
        Some(error) => DoctorCheck {
            id: "loopback_port".into(),
            label: "回环端口".into(),
            status: DoctorStatus::Error,
            message: format!("无法绑定 127.0.0.1：{error}"),
        },
    }
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_assistant::{AuthorizedRoot, AuthorizedRootKind, BrowserBridgeStatus};
    use std::{
        collections::{HashMap, HashSet},
        sync::{Mutex, RwLock},
    };

    fn state(path: PathBuf) -> WorkAssistantState {
        WorkAssistantState {
            roots: RwLock::new(Vec::new()),
            previews: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            cancelled_runs: Mutex::new(HashSet::new()),
            cancelled_execution_audits: Mutex::new(HashSet::new()),
            audit_path: path,
            audit_guard: Mutex::new(()),
        }
    }

    #[test]
    fn doctor_report_is_structured_and_read_only() {
        let directory =
            std::env::temp_dir().join(format!("papyrus-doctor-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let report = run_doctor(&state(directory.join("audit.jsonl"))).unwrap();
        assert_eq!(report.platform, env::consts::OS);
        assert!(report
            .checks
            .iter()
            .any(|check| check.id == "loopback_port"));
        assert!(report
            .checks
            .iter()
            .any(|check| check.id == "browser_bridge"));
        assert!(!directory.join("audit.jsonl").exists());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn doctor_reports_unstarted_browser_bridge_as_warning() {
        let directory =
            std::env::temp_dir().join(format!("papyrus-doctor-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let browser = crate::work_assistant::browser_bridge::init_browser_bridge_state();
        let report =
            run_doctor_with_browser(&state(directory.join("audit.jsonl")), Some(&browser)).unwrap();
        let check = report
            .checks
            .iter()
            .find(|check| check.id == "browser_bridge")
            .unwrap();
        assert_eq!(check.status, DoctorStatus::Warning);
        assert!(check.message.contains("尚未启动"));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn executable_lookup_does_not_launch_processes() {
        assert!(!executable_on_paths(
            "definitely-not-a-papyrus-executable",
            &[],
            "linux"
        ));
    }

    #[test]
    fn injected_probes_cover_core_paths_optional_degradation_and_side_effects() {
        let directory =
            std::env::temp_dir().join(format!("papyrus-doctor-injected-{}", uuid::Uuid::new_v4()));
        let root_path = directory.join("workspace");
        let application_path = directory.join("papyrus-editor");
        std::fs::create_dir_all(&root_path).unwrap();
        std::fs::write(&application_path, b"fake executable").unwrap();
        let audit_path = directory.join("audit.jsonl");
        std::fs::write(&audit_path, b"existing audit\n").unwrap();
        let applications = vec![RegisteredApplication {
            id: "editor".into(),
            label: "Papyrus Editor".into(),
            executable_path: application_path.clone(),
            platform: "linux".into(),
            created_at: 1,
        }];
        std::fs::write(
            directory.join("work-assistant-applications.json"),
            serde_json::to_vec(&applications).unwrap(),
        )
        .unwrap();

        let state = state(audit_path.clone());
        state.roots.write().unwrap().push(AuthorizedRoot {
            id: "workspace".into(),
            label: "工作区".into(),
            path: root_path,
            kind: AuthorizedRootKind::Workspace,
            created_at: 1,
        });
        let probes = DoctorProbes {
            platform: "linux".into(),
            architecture: "x86_64".into(),
            now: 42,
            downloads_directory: Some(directory.join("missing-downloads")),
            path_entries: Vec::new(),
            loopback_error: None,
        };
        let before_entries = directory_entries(&directory);
        let before_audit = std::fs::read(&audit_path).unwrap();

        let report = run_doctor_with_browser_and_probes(&state, None, &probes).unwrap();

        assert_eq!(check(&report, "app_data").status, DoctorStatus::Ok);
        assert_eq!(check(&report, "audit_path").status, DoctorStatus::Ok);
        assert_eq!(check(&report, "authorized_roots").status, DoctorStatus::Ok);
        assert_eq!(
            check(&report, "registered_applications").status,
            DoctorStatus::Ok
        );
        assert_eq!(
            check(&report, "downloads_directory").status,
            DoctorStatus::Warning
        );
        assert_eq!(
            check(&report, "external_opener").status,
            DoctorStatus::Warning
        );
        assert_eq!(check(&report, "loopback_port").status, DoctorStatus::Ok);
        assert_eq!(report.platform, "linux");
        assert_eq!(report.architecture, "x86_64");
        assert_eq!(report.generated_at, 42);
        assert_eq!(before_entries, directory_entries(&directory));
        assert_eq!(before_audit, std::fs::read(&audit_path).unwrap());

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn injected_linux_path_lookup_and_loopback_failure_are_explicit() {
        let directory =
            std::env::temp_dir().join(format!("papyrus-doctor-probes-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let fake_bin = directory.join("bin");
        std::fs::create_dir_all(&fake_bin).unwrap();
        std::fs::write(fake_bin.join("xdg-open"), b"not executed").unwrap();
        let state = state(directory.join("audit.jsonl"));

        let available = DoctorProbes {
            platform: "linux".into(),
            architecture: "x86_64".into(),
            now: 100,
            downloads_directory: None,
            path_entries: vec![fake_bin],
            loopback_error: None,
        };
        let report = run_doctor_with_browser_and_probes(&state, None, &available).unwrap();
        assert_eq!(check(&report, "external_opener").status, DoctorStatus::Ok);
        assert!(check(&report, "external_opener")
            .message
            .contains("xdg-open"));

        let unavailable = DoctorProbes {
            loopback_error: Some("injected bind failure".into()),
            path_entries: Vec::new(),
            ..available
        };
        let report = run_doctor_with_browser_and_probes(&state, None, &unavailable).unwrap();
        assert_eq!(
            check(&report, "external_opener").status,
            DoctorStatus::Warning
        );
        assert_eq!(check(&report, "loopback_port").status, DoctorStatus::Error);
        assert!(check(&report, "loopback_port")
            .message
            .contains("injected bind failure"));

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn browser_bridge_states_are_checked_without_starting_a_listener() {
        let connected = BrowserBridgeStatus {
            running: true,
            paired: true,
            origin: Some("https://example.com".into()),
            expires_at: Some(100),
            ..Default::default()
        };
        assert_eq!(
            check_browser_bridge_status(Some(&connected), 42).status,
            DoctorStatus::Ok
        );

        let stale = BrowserBridgeStatus {
            running: true,
            paired: true,
            expires_at: Some(41),
            ..Default::default()
        };
        assert_eq!(
            check_browser_bridge_status(Some(&stale), 42).status,
            DoctorStatus::Warning
        );

        let disconnected = BrowserBridgeStatus::default();
        assert_eq!(
            check_browser_bridge_status(Some(&disconnected), 42).status,
            DoctorStatus::Warning
        );
        assert_eq!(
            check_browser_bridge_status(None, 42).status,
            DoctorStatus::Warning
        );
    }

    fn check<'a>(report: &'a WorkAssistantDoctorReport, id: &str) -> &'a DoctorCheck {
        report.checks.iter().find(|check| check.id == id).unwrap()
    }

    fn directory_entries(path: &Path) -> Vec<String> {
        let mut entries = std::fs::read_dir(path)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        entries.sort();
        entries
    }
}
