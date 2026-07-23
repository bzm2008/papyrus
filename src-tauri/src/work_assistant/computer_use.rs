use crate::work_assistant::{AssistantErrorPayload, WorkAssistantError, WorkAssistantState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, time::{SystemTime, UNIX_EPOCH}};
use tauri::State;
use uuid::Uuid;

pub const COMPUTER_OBSERVATION_TTL_MS: u64 = 30_000;
const MAX_COMPUTER_OBSERVATIONS: usize = 32;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComputerRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWindow {
    pub app_id: String,
    pub title: String,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComputerTarget {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<ComputerRect>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComputerObservation {
    pub id: String,
    pub window: ComputerWindow,
    pub targets: Vec<ComputerTarget>,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerActionRequest {
    pub action: String,
    pub observation_id: String,
    pub window_fingerprint: String,
    pub target_id: String,
    pub target_fingerprint: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub delta: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerActionResult {
    pub ok: bool,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recoverable: Option<bool>,
}

#[derive(Default)]
pub struct ComputerObservationStore {
    observations: HashMap<String, ComputerObservation>,
}

impl ComputerObservationStore {
    pub fn insert(&mut self, observation: ComputerObservation, now: u64) {
        self.prune(now);
        if self.observations.len() >= MAX_COMPUTER_OBSERVATIONS {
            if let Some(oldest) = self
                .observations
                .values()
                .min_by_key(|candidate| candidate.expires_at)
                .map(|candidate| candidate.id.clone())
            {
                self.observations.remove(&oldest);
            }
        }
        self.observations.insert(observation.id.clone(), observation);
    }

    pub fn validate(
        &mut self,
        request: &ComputerActionRequest,
        current: &ComputerObservation,
        now: u64,
    ) -> Result<ComputerTarget, WorkAssistantError> {
        self.prune(now);
        let observed = self
            .observations
            .get(&request.observation_id)
            .ok_or_else(|| WorkAssistantError::stale_preview("computer observation has expired"))?;
        if observed.window.fingerprint != request.window_fingerprint
            || current.window.fingerprint != observed.window.fingerprint
        {
            return Err(WorkAssistantError {
                code: "window_changed".into(),
                message: "foreground window changed since observation".into(),
                recoverable: true,
            });
        }
        let target = observed
            .targets
            .iter()
            .find(|candidate| candidate.id == request.target_id)
            .ok_or_else(|| WorkAssistantError {
                code: "target_missing".into(),
                message: "observed target is no longer available".into(),
                recoverable: true,
            })?;
        let current_target = current
            .targets
            .iter()
            .find(|candidate| candidate.id == request.target_id)
            .ok_or_else(|| WorkAssistantError {
                code: "target_missing".into(),
                message: "accessibility target is no longer available".into(),
                recoverable: true,
            })?;
        if target.fingerprint != request.target_fingerprint
            || current_target.fingerprint != target.fingerprint
        {
            return Err(WorkAssistantError {
                code: "target_changed".into(),
                message: "accessibility target changed since observation".into(),
                recoverable: true,
            });
        }
        Ok(target.clone())
    }

    pub fn clear(&mut self) {
        self.observations.clear();
    }

    fn prune(&mut self, now: u64) {
        self.observations.retain(|_, observation| observation.expires_at > now);
    }
}

pub fn assess_action(action: &str, target: &ComputerTarget) -> Result<(), WorkAssistantError> {
    let surface = format!(
        "{} {} {}",
        action,
        target.role.as_deref().unwrap_or_default(),
        target.name.as_deref().unwrap_or_default()
    )
    .to_lowercase();
    if [
        "password", "passcode", "otp", "verification", "captcha", "payment", "card", "cvv", "bank",
        "密码", "验证码", "支付", "银行卡", "证件",
    ]
    .iter()
    .any(|marker| surface.contains(marker))
    {
        return Err(WorkAssistantError {
            code: "sensitive_surface".into(),
            message: "sensitive desktop surface is blocked".into(),
            recoverable: true,
        });
    }
    Ok(())
}

pub fn validate_action_payload(request: &ComputerActionRequest) -> Result<(), WorkAssistantError> {
    if let Some(text) = request.text.as_deref() {
        if text.chars().count() > 4_000 {
            return Err(WorkAssistantError::blocked("computer text exceeds the 4000 character limit"));
        }
        let normalized = text.to_lowercase();
        if ["password", "passcode", "otp", "verification code", "验证码", "密码", "支付密码"]
            .iter()
            .any(|marker| normalized.contains(marker))
        {
            return Err(WorkAssistantError {
                code: "sensitive_surface".into(),
                message: "sensitive values cannot be typed by computer assistance".into(),
                recoverable: true,
            });
        }
    }
    if request.action == "computer_keypress" {
        let key = request.key.as_deref().unwrap_or_default().to_ascii_lowercase();
        if !matches!(key.as_str(), "enter" | "tab" | "escape" | "space" | "up" | "down" | "left" | "right" | "pageup" | "pagedown" | "home" | "end") {
            return Err(WorkAssistantError::blocked("computer keypress is not in the approved key directory"));
        }
    }
    if request.action == "computer_scroll" && !matches!(request.delta.as_deref(), Some("up" | "down")) {
        return Err(WorkAssistantError::blocked("computer scroll direction must be up or down"));
    }
    Ok(())
}

pub fn computer_capability() -> (bool, Option<&'static str>) {
    #[cfg(windows)]
    { (true, None) }
    #[cfg(target_os = "linux")]
    { (false, Some("需要 AT-SPI 与 GNOME Portal RemoteDesktop 授权；当前不会回退为坐标点击")) }
    #[cfg(target_os = "macos")]
    { (false, Some("需要 macOS 辅助功能授权；当前仅提供兼容诊断")) }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    { (false, Some("当前平台不支持 Computer Use")) }
}

#[tauri::command]
pub fn work_assistant_computer_observe(
    state: State<'_, WorkAssistantState>,
) -> Result<ComputerObservation, AssistantErrorPayload> {
    let now = unix_millis();
    let observation = platform::observe_foreground(now).map_err(AssistantErrorPayload::from)?;
    state
        .computer_observations
        .lock()
        .map_err(|_| WorkAssistantError::protocol("computer observation store is unavailable"))
        .map_err(AssistantErrorPayload::from)?
        .insert(observation.clone(), now);
    Ok(observation)
}

#[tauri::command]
pub fn work_assistant_computer_execute(
    state: State<'_, WorkAssistantState>,
    request: ComputerActionRequest,
) -> Result<ComputerActionResult, AssistantErrorPayload> {
    let now = unix_millis();
    let current = platform::observe_foreground(now).map_err(AssistantErrorPayload::from)?;
    let target = state
        .computer_observations
        .lock()
        .map_err(|_| WorkAssistantError::protocol("computer observation store is unavailable"))
        .map_err(AssistantErrorPayload::from)?
        .validate(&request, &current, now)
        .map_err(AssistantErrorPayload::from)?;
    assess_action(&request.action, &target).map_err(AssistantErrorPayload::from)?;
    validate_action_payload(&request).map_err(AssistantErrorPayload::from)?;
    platform::execute_action(&request, &target).map_err(AssistantErrorPayload::from)
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn fingerprint(parts: &[&str]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update(part.as_bytes());
        digest.update([0]);
    }
    format!("{:x}", digest.finalize())
}

mod platform {
    use super::*;

    #[cfg(windows)]
    pub fn observe_foreground(now: u64) -> Result<ComputerObservation, WorkAssistantError> {
        use uiautomation::{types::TreeScope, UIAutomation};
        use uiautomation::screenshots::Screenshot;

        let automation = UIAutomation::new()
            .map_err(|_| WorkAssistantError::blocked("Windows UI Automation is unavailable"))?;
        let focused = automation.get_focused_element()
            .map_err(|_| WorkAssistantError::blocked("could not read the foreground accessible window"))?;
        let window_handle = focused.get_native_window_handle().map(|value| value.to_string()).unwrap_or_default();
        let title = focused.get_name().unwrap_or_default();
        let app_id = focused.get_classname().unwrap_or_default();
        let shot = Screenshot::capture_desktop()
            .map_err(|_| WorkAssistantError::blocked("could not capture the current desktop for observation verification"))?;
        let screenshot_fingerprint = fingerprint(&[
            &shot.width().to_string(),
            &shot.height().to_string(),
            &format!("{:x}", Sha256::digest(shot.pixels())),
        ]);
        let window = ComputerWindow {
            app_id,
            title,
            fingerprint: fingerprint(&[&window_handle, &screenshot_fingerprint]),
        };
        let mut accessible_elements = vec![focused.clone()];
        accessible_elements.extend(focused
            .find_all(TreeScope::Descendants, &automation.create_true_condition().map_err(|_| WorkAssistantError::blocked("could not inspect accessibility targets"))?)
            .unwrap_or_default());
        let targets = accessible_elements
            .into_iter()
            .take(96)
            .enumerate()
            .filter_map(|(index, element)| {
                let name = element.get_name().unwrap_or_default();
                let role = element.get_control_type().ok().map(|value| format!("{value:?}"));
                let bounds = element.get_bounding_rectangle().ok().map(|rect| ComputerRect {
                    x: f64::from(rect.get_left()),
                    y: f64::from(rect.get_top()),
                    width: f64::from(rect.get_right() - rect.get_left()),
                    height: f64::from(rect.get_bottom() - rect.get_top()),
                });
                if name.is_empty() && bounds.is_none() { return None; }
                let id = format!("target-{index}");
                Some(ComputerTarget {
                    fingerprint: fingerprint(&[&window.fingerprint, &id, role.as_deref().unwrap_or_default(), &name, &bounds.as_ref().map(|value| format!("{}:{}:{}:{}", value.x, value.y, value.width, value.height)).unwrap_or_default()]),
                    id,
                    role,
                    name: (!name.is_empty()).then_some(name),
                    bounds,
                })
            })
            .collect();
        Ok(ComputerObservation { id: Uuid::new_v4().to_string(), window, targets, expires_at: now.saturating_add(COMPUTER_OBSERVATION_TTL_MS) })
    }

    #[cfg(windows)]
    pub fn execute_action(request: &ComputerActionRequest, target: &ComputerTarget) -> Result<ComputerActionResult, WorkAssistantError> {
        use uiautomation::{patterns::UIScrollPattern, types::{ScrollAmount, TreeScope}, UIAutomation};
        let automation = UIAutomation::new().map_err(|_| WorkAssistantError::blocked("Windows UI Automation is unavailable"))?;
        let focused = automation.get_focused_element().map_err(|_| WorkAssistantError::stale_preview("foreground accessible window is unavailable"))?;
        let mut targets = vec![focused.clone()];
        targets.extend(focused.find_all(TreeScope::Descendants, &automation.create_true_condition().map_err(|_| WorkAssistantError::blocked("could not inspect accessibility targets"))?).unwrap_or_default());
        let element = targets.into_iter()
            .filter(|element| !element.get_name().unwrap_or_default().is_empty() || element.get_bounding_rectangle().is_ok())
            .enumerate()
            .find_map(|(index, element)| (format!("target-{index}") == target.id).then_some(element))
            .ok_or_else(|| WorkAssistantError { code: "target_missing".into(), message: "accessibility target is no longer available".into(), recoverable: true })?;
        match request.action.as_str() {
            "computer_focus" => element.set_focus().map_err(|_| WorkAssistantError::stale_preview("could not focus the verified target"))?,
            "computer_click" => element.click().map_err(|_| WorkAssistantError::stale_preview("could not activate the verified target"))?,
            "computer_type" => element.send_text(request.text.as_deref().unwrap_or_default(), 5).map_err(|_| WorkAssistantError::stale_preview("could not type into the verified target"))?,
            "computer_keypress" => element.send_keys(key_sequence(request.key.as_deref().unwrap_or_default())?, 5).map_err(|_| WorkAssistantError::stale_preview("could not send the verified keypress"))?,
            "computer_scroll" => {
                let amount = if request.delta.as_deref() == Some("up") { ScrollAmount::SmallDecrement } else { ScrollAmount::SmallIncrement };
                element.get_pattern::<UIScrollPattern>().map_err(|_| WorkAssistantError::blocked("scroll is unavailable for this accessible target"))?.scroll(ScrollAmount::NoAmount, amount).map_err(|_| WorkAssistantError::stale_preview("could not scroll the verified target"))?
            }
            _ => return Err(WorkAssistantError::blocked("unsupported computer action")),
        }
        Ok(ComputerActionResult { ok: true, summary: "已执行已验证的电脑操作。".into(), error_code: None, recoverable: None })
    }

    #[cfg(windows)]
    fn key_sequence(key: &str) -> Result<&'static str, WorkAssistantError> {
        match key.to_ascii_lowercase().as_str() {
            "enter" => Ok("{ENTER}"), "tab" => Ok("{TAB}"), "escape" => Ok("{ESC}"), "space" => Ok(" "),
            "up" => Ok("{UP}"), "down" => Ok("{DOWN}"), "left" => Ok("{LEFT}"), "right" => Ok("{RIGHT}"),
            "pageup" => Ok("{PGUP}"), "pagedown" => Ok("{PGDN}"), "home" => Ok("{HOME}"), "end" => Ok("{END}"),
            _ => Err(WorkAssistantError::blocked("computer keypress is not in the approved key directory")),
        }
    }

    #[cfg(target_os = "linux")]
    pub fn observe_foreground(_now: u64) -> Result<ComputerObservation, WorkAssistantError> {
        Err(WorkAssistantError { code: "computer_portal_required".into(), message: "Debian Wayland requires an AT-SPI and GNOME Portal RemoteDesktop session before computer assistance can observe the desktop".into(), recoverable: true })
    }

    #[cfg(target_os = "linux")]
    pub fn execute_action(_request: &ComputerActionRequest, _target: &ComputerTarget) -> Result<ComputerActionResult, WorkAssistantError> {
        Err(WorkAssistantError { code: "computer_portal_required".into(), message: "Debian Wayland computer assistance is unavailable until AT-SPI and GNOME Portal authorization are granted".into(), recoverable: true })
    }

    #[cfg(target_os = "macos")]
    pub fn observe_foreground(_now: u64) -> Result<ComputerObservation, WorkAssistantError> {
        Err(WorkAssistantError { code: "computer_accessibility_required".into(), message: "macOS Accessibility permission is required for computer assistance".into(), recoverable: true })
    }

    #[cfg(target_os = "macos")]
    pub fn execute_action(_request: &ComputerActionRequest, _target: &ComputerTarget) -> Result<ComputerActionResult, WorkAssistantError> {
        Err(WorkAssistantError { code: "computer_accessibility_required".into(), message: "macOS Accessibility permission is required for computer assistance".into(), recoverable: true })
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    pub fn observe_foreground(_now: u64) -> Result<ComputerObservation, WorkAssistantError> {
        Err(WorkAssistantError::blocked("computer assistance is not supported on this platform"))
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    pub fn execute_action(_request: &ComputerActionRequest, _target: &ComputerTarget) -> Result<ComputerActionResult, WorkAssistantError> {
        Err(WorkAssistantError::blocked("computer assistance is not supported on this platform"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation(id: &str, window: &str, target: &str, expires_at: u64) -> ComputerObservation {
        ComputerObservation {
            id: id.into(),
            window: ComputerWindow { app_id: "app".into(), title: "Window".into(), fingerprint: window.into() },
            targets: vec![ComputerTarget { id: "target-1".into(), role: Some("button".into()), name: Some("Save".into()), fingerprint: target.into(), bounds: None }],
            expires_at,
        }
    }

    fn request() -> ComputerActionRequest {
        ComputerActionRequest {
            action: "computer_click".into(),
            observation_id: "observe-1".into(),
            window_fingerprint: "window-v1".into(),
            target_id: "target-1".into(),
            target_fingerprint: "target-v1".into(),
            text: None,
            key: None,
            delta: None,
        }
    }

    #[test]
    fn validation_rejects_expired_observations_and_foreground_window_changes() {
        let mut store = ComputerObservationStore::default();
        store.insert(observation("observe-1", "window-v1", "target-v1", 100), 0);

        let expired = store.validate(&request(), &observation("current", "window-v1", "target-v1", 200), 100).unwrap_err();
        assert_eq!(expired.code, "stale_preview");

        store.insert(observation("observe-1", "window-v1", "target-v1", 200), 101);
        let changed = store.validate(&request(), &observation("current", "window-v2", "target-v1", 200), 102).unwrap_err();
        assert_eq!(changed.code, "window_changed");
    }

    #[test]
    fn validation_rejects_target_fingerprint_changes_and_sensitive_surfaces() {
        let mut store = ComputerObservationStore::default();
        store.insert(observation("observe-1", "window-v1", "target-v1", 200), 0);
        let changed = store.validate(&request(), &observation("current", "window-v1", "target-v2", 200), 1).unwrap_err();
        assert_eq!(changed.code, "target_changed");

        let password = ComputerTarget { id: "password".into(), role: Some("textbox".into()), name: Some("Password".into()), fingerprint: "target".into(), bounds: None };
        assert_eq!(assess_action("computer_type", &password).unwrap_err().code, "sensitive_surface");
    }

    #[test]
    fn action_payload_rejects_sensitive_text_and_unbounded_keypresses() {
        let mut typing = request();
        typing.action = "computer_type".into();
        typing.text = Some("my password is not for automation".into());
        assert_eq!(validate_action_payload(&typing).unwrap_err().code, "sensitive_surface");

        let mut keypress = request();
        keypress.action = "computer_keypress".into();
        keypress.key = Some("{WIN}R".into());
        assert_eq!(validate_action_payload(&keypress).unwrap_err().code, "blocked");
    }
}
