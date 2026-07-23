use crate::work_assistant::{AssistantErrorPayload, WorkAssistantError, WorkAssistantState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use uuid::Uuid;

pub const COMPUTER_OBSERVATION_TTL_MS: u64 = 30_000;
const MAX_COMPUTER_OBSERVATIONS: usize = 32;
const MAX_COMPUTER_PREVIEWS: usize = 32;
const MAX_COMPUTER_MODEL_TARGETS: usize = 96;
const COMPUTER_APPROVAL_TTL_MS: u64 = 30_000;
const COMPUTER_RUN_GRANT_TTL_MS: u64 = 10 * 60_000;

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
    pub stable_fingerprint: String,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererComputerWindow {
    pub fingerprint: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererComputerTarget {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererComputerObservation {
    pub id: String,
    pub window: RendererComputerWindow,
    pub targets: Vec<RendererComputerTarget>,
    pub expires_at: u64,
}

#[derive(Clone, Debug)]
struct ComputerNativeApprovalPrompt {
    title: String,
    message: String,
    requires_confirmation: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerActionRequest {
    pub run_id: String,
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
pub struct ComputerActionPreview {
    pub id: String,
    pub revision: String,
    pub risk: String,
    pub title: String,
    pub target_summary: String,
    pub impact_summary: String,
    pub reversible: bool,
    pub approval_required: bool,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerApprovalGrant {
    pub token: String,
    pub preview_id: String,
    pub expires: u64,
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
    observations: HashMap<String, StoredComputerObservation>,
    previews: HashMap<String, StoredComputerPreview>,
    approvals: HashMap<String, StoredComputerApproval>,
    run_grants: HashMap<String, StoredComputerRunGrant>,
}

#[derive(Clone, Debug)]
struct StoredComputerObservation {
    run_id: String,
    observation: ComputerObservation,
}

#[derive(Clone, Debug)]
struct StoredComputerPreview {
    id: String,
    run_id: String,
    request: ComputerActionRequest,
    expires_at: u64,
}

#[derive(Clone, Debug)]
struct StoredComputerApproval {
    token: String,
    preview_id: String,
    run_id: String,
    expires_at: u64,
}

#[derive(Clone, Debug)]
struct StoredComputerRunGrant {
    run_id: String,
    app_id: String,
    window_fingerprint: String,
    expires_at: u64,
}

impl ComputerObservationStore {
    pub fn insert_for_run(&mut self, run_id: &str, observation: ComputerObservation, now: u64) {
        self.prune(now);
        if self.observations.len() >= MAX_COMPUTER_OBSERVATIONS {
            if let Some(oldest) = self
                .observations
                .values()
                .min_by_key(|candidate| candidate.observation.expires_at)
                .map(|candidate| candidate.observation.id.clone())
            {
                self.observations.remove(&oldest);
            }
        }
        self.observations.insert(
            observation.id.clone(),
            StoredComputerObservation {
                run_id: run_id.into(),
                observation,
            },
        );
    }

    pub fn create_preview(
        &mut self,
        request: ComputerActionRequest,
        now: u64,
    ) -> Result<ComputerActionPreview, WorkAssistantError> {
        self.prune(now);
        validate_action_request(&request)?;
        validate_action_payload(&request)?;
        let observed = self
            .observations
            .get(&request.observation_id)
            .cloned()
            .ok_or_else(|| WorkAssistantError::stale_preview("computer observation has expired"))?;
        if observed.run_id != request.run_id {
            return Err(WorkAssistantError::blocked(
                "computer observation belongs to a different run",
            ));
        }
        let target = validate_reference(&observed.observation, &request)?;
        assess_observation_surface(&observed.observation.window, &observed.observation.targets)?;
        assess_action(&request.action, &observed.observation.window, &target)?;
        let approval_required =
            !self.has_active_run_grant(&request, &observed.observation.window, now);
        if self.previews.len() >= MAX_COMPUTER_PREVIEWS {
            if let Some(oldest) = self
                .previews
                .values()
                .min_by_key(|candidate| candidate.expires_at)
                .map(|candidate| candidate.id.clone())
            {
                self.remove_preview(&oldest);
            }
        }
        let id = Uuid::new_v4().to_string();
        let risk = String::from(action_risk(&request.action));
        let expires_at = observed
            .observation
            .expires_at
            .min(now.saturating_add(COMPUTER_OBSERVATION_TTL_MS));
        self.previews.insert(
            id.clone(),
            StoredComputerPreview {
                id: id.clone(),
                run_id: request.run_id.clone(),
                request: request.clone(),
                expires_at,
            },
        );
        Ok(ComputerActionPreview {
            id,
            revision: request.observation_id,
            risk,
            title: "电脑操作确认".into(),
            target_summary: "已验证的当前窗口目标".into(),
            impact_summary: action_summary(&request.action).into(),
            reversible: matches!(
                request.action.as_str(),
                "computer_focus" | "computer_scroll"
            ),
            approval_required,
            expires_at,
        })
    }

    pub fn approve(
        &mut self,
        preview_id: &str,
        run_id: &str,
        choice: &str,
        now: u64,
    ) -> Result<ComputerApprovalGrant, WorkAssistantError> {
        self.prune(now);
        if choice != "once" {
            return Err(WorkAssistantError::blocked(
                "computer actions require one-time approval",
            ));
        }
        let preview = self
            .previews
            .get(preview_id)
            .ok_or_else(|| WorkAssistantError::blocked("a valid computer preview is required"))?;
        if preview.run_id != run_id {
            return Err(WorkAssistantError::blocked(
                "computer preview belongs to a different run",
            ));
        }
        let token = Uuid::new_v4().to_string();
        let expires = preview
            .expires_at
            .min(now.saturating_add(COMPUTER_APPROVAL_TTL_MS));
        self.approvals.insert(
            token.clone(),
            StoredComputerApproval {
                token: token.clone(),
                preview_id: preview_id.into(),
                run_id: run_id.into(),
                expires_at: expires,
            },
        );
        Ok(ComputerApprovalGrant {
            token,
            preview_id: preview_id.into(),
            expires,
        })
    }

    fn approval_prompt(
        &mut self,
        preview_id: &str,
        run_id: &str,
        scope: &str,
        now: u64,
    ) -> Result<ComputerNativeApprovalPrompt, WorkAssistantError> {
        self.prune(now);
        let preview = self
            .previews
            .get(preview_id)
            .ok_or_else(|| WorkAssistantError::blocked("a valid computer preview is required"))?;
        if preview.run_id != run_id {
            return Err(WorkAssistantError::blocked(
                "computer preview belongs to a different run",
            ));
        }
        if !matches!(scope, "once" | "run") {
            return Err(WorkAssistantError::blocked(
                "computer approval scope is invalid",
            ));
        }
        if scope == "run" && !is_run_grant_action(&preview.request.action) {
            return Err(WorkAssistantError::blocked(
                "only reversible computer actions can request a task grant",
            ));
        }
        if scope == "run"
            && self.has_active_run_grant(
                &preview.request,
                &self
                    .observations
                    .get(&preview.request.observation_id)
                    .ok_or_else(|| {
                        WorkAssistantError::stale_preview("computer observation has expired")
                    })?
                    .observation
                    .window,
                now,
            )
        {
            return Ok(ComputerNativeApprovalPrompt {
                title: String::new(),
                message: String::new(),
                requires_confirmation: false,
            });
        }
        Ok(ComputerNativeApprovalPrompt {
            title: "Papyrus 电脑操作确认".into(),
            message: if scope == "run" {
                format!(
                    "{}\n\n允许本任务在当前应用中继续进行聚焦和滚动，最长 10 分钟。",
                    action_summary(&preview.request.action)
                )
            } else {
                format!(
                    "{}\n\n此操作将在当前已验证窗口中执行。",
                    action_summary(&preview.request.action)
                )
            },
            requires_confirmation: true,
        })
    }

    fn approve_after_native_confirmation(
        &mut self,
        preview_id: &str,
        run_id: &str,
        scope: &str,
        confirmed: bool,
        now: u64,
    ) -> Result<ComputerApprovalGrant, WorkAssistantError> {
        self.prune(now);
        if !confirmed {
            return Err(WorkAssistantError::cancelled(
                "native computer action confirmation was declined",
            ));
        }
        let preview =
            self.previews.get(preview_id).cloned().ok_or_else(|| {
                WorkAssistantError::blocked("a valid computer preview is required")
            })?;
        if preview.run_id != run_id {
            return Err(WorkAssistantError::blocked(
                "computer preview belongs to a different run",
            ));
        }
        if scope == "run" {
            if !is_run_grant_action(&preview.request.action) {
                return Err(WorkAssistantError::blocked(
                    "only reversible computer actions can receive a task grant",
                ));
            }
            let observation = self
                .observations
                .get(&preview.request.observation_id)
                .ok_or_else(|| {
                    WorkAssistantError::stale_preview("computer observation has expired")
                })?;
            self.run_grants.insert(
                run_id.into(),
                StoredComputerRunGrant {
                    run_id: run_id.into(),
                    app_id: observation.observation.window.app_id.clone(),
                    window_fingerprint: observation.observation.window.stable_fingerprint.clone(),
                    expires_at: now.saturating_add(COMPUTER_RUN_GRANT_TTL_MS),
                },
            );
        } else if scope != "once" {
            return Err(WorkAssistantError::blocked(
                "computer approval scope is invalid",
            ));
        }
        self.approve(preview_id, run_id, "once", now)
    }

    /// Claims a grant before the native action starts. Removing it here makes replay impossible
    /// even if the foreground revalidation or platform dispatch subsequently fails.
    fn take_execution(
        &mut self,
        preview_id: &str,
        approval_token: &str,
        now: u64,
    ) -> Result<StoredComputerPreview, WorkAssistantError> {
        self.prune(now);
        let approval = self.approvals.remove(approval_token).ok_or_else(|| {
            WorkAssistantError::blocked("a valid computer approval token is required")
        })?;
        let preview =
            self.previews.get(preview_id).cloned().ok_or_else(|| {
                WorkAssistantError::blocked("a valid computer preview is required")
            })?;
        if approval.token != approval_token
            || approval.preview_id != preview_id
            || approval.run_id != preview.run_id
            || approval.expires_at <= now
            || preview.expires_at <= now
        {
            return Err(WorkAssistantError::blocked(
                "computer approval token is invalid or has expired",
            ));
        }
        self.remove_preview(preview_id);
        Ok(preview)
    }

    fn validate_execution(
        &mut self,
        preview: &StoredComputerPreview,
        current: &ComputerObservation,
        now: u64,
    ) -> Result<ComputerTarget, WorkAssistantError> {
        self.prune(now);
        let observed = self
            .observations
            .get(&preview.request.observation_id)
            .ok_or_else(|| WorkAssistantError::stale_preview("computer observation has expired"))?;
        if observed.run_id != preview.run_id {
            return Err(WorkAssistantError::blocked(
                "computer observation belongs to a different run",
            ));
        }
        let target = validate_reference(&observed.observation, &preview.request)?;
        let current_target = validate_reference(current, &preview.request)?;
        if current.window.fingerprint != observed.observation.window.fingerprint {
            return Err(WorkAssistantError {
                code: "window_changed".into(),
                message: "foreground window changed since observation".into(),
                recoverable: true,
            });
        }
        if current_target.fingerprint != target.fingerprint {
            return Err(WorkAssistantError {
                code: "target_changed".into(),
                message: "accessibility target changed since observation".into(),
                recoverable: true,
            });
        }
        assess_observation_surface(&current.window, &current.targets)?;
        assess_action(&preview.request.action, &current.window, &current_target)?;
        Ok(current_target)
    }

    pub fn clear_run(&mut self, run_id: &str) {
        self.observations
            .retain(|_, observation| observation.run_id != run_id);
        let previews = self
            .previews
            .values()
            .filter(|preview| preview.run_id == run_id)
            .map(|preview| preview.id.clone())
            .collect::<Vec<_>>();
        for preview_id in previews {
            self.remove_preview(&preview_id);
        }
        self.approvals
            .retain(|_, approval| approval.run_id != run_id);
        self.run_grants.remove(run_id);
    }

    pub(crate) fn has_observation_for_run(&self, run_id: &str) -> bool {
        self.observations
            .values()
            .any(|observation| observation.run_id == run_id)
    }

    fn prune(&mut self, now: u64) {
        self.observations
            .retain(|_, observation| observation.observation.expires_at > now);
        let expired_previews = self
            .previews
            .values()
            .filter(|preview| preview.expires_at <= now)
            .map(|preview| preview.id.clone())
            .collect::<Vec<_>>();
        for preview_id in expired_previews {
            self.remove_preview(&preview_id);
        }
        self.approvals
            .retain(|_, approval| approval.expires_at > now);
        self.run_grants.retain(|_, grant| grant.expires_at > now);
    }

    fn remove_preview(&mut self, preview_id: &str) {
        self.previews.remove(preview_id);
        self.approvals
            .retain(|_, approval| approval.preview_id != preview_id);
    }

    fn has_active_run_grant(
        &self,
        request: &ComputerActionRequest,
        window: &ComputerWindow,
        now: u64,
    ) -> bool {
        is_run_grant_action(&request.action)
            && self.run_grants.get(&request.run_id).is_some_and(|grant| {
                grant.run_id == request.run_id
                    && grant.app_id == window.app_id
                    && grant.window_fingerprint == window.stable_fingerprint
                    && grant.expires_at > now
            })
    }
}

fn is_run_grant_action(action: &str) -> bool {
    matches!(action, "computer_focus" | "computer_scroll")
}

fn validate_reference(
    observation: &ComputerObservation,
    request: &ComputerActionRequest,
) -> Result<ComputerTarget, WorkAssistantError> {
    if observation.window.fingerprint != request.window_fingerprint {
        return Err(WorkAssistantError {
            code: "window_changed".into(),
            message: "foreground window changed since observation".into(),
            recoverable: true,
        });
    }
    let target = observation
        .targets
        .iter()
        .find(|candidate| candidate.id == request.target_id)
        .ok_or_else(|| WorkAssistantError {
            code: "target_missing".into(),
            message: "accessibility target is no longer available".into(),
            recoverable: true,
        })?;
    if target.fingerprint != request.target_fingerprint {
        return Err(WorkAssistantError {
            code: "target_changed".into(),
            message: "accessibility target changed since observation".into(),
            recoverable: true,
        });
    }
    Ok(target.clone())
}

fn validate_dispatch_reference(
    expected_window: &ComputerWindow,
    expected_target: &ComputerTarget,
    dispatch_window: &ComputerWindow,
    dispatch_target: &ComputerTarget,
) -> Result<(), WorkAssistantError> {
    if dispatch_window.fingerprint != expected_window.fingerprint {
        return Err(WorkAssistantError {
            code: "window_changed".into(),
            message: "foreground window changed before native dispatch".into(),
            recoverable: true,
        });
    }
    if dispatch_target.id != expected_target.id
        || dispatch_target.fingerprint != expected_target.fingerprint
    {
        return Err(WorkAssistantError {
            code: "target_changed".into(),
            message: "accessibility target changed before native dispatch".into(),
            recoverable: true,
        });
    }
    Ok(())
}

fn validate_dispatch_surface(
    action: &str,
    window: &ComputerWindow,
    targets: &[ComputerTarget],
    target: &ComputerTarget,
) -> Result<(), WorkAssistantError> {
    assess_observation_surface(window, targets)?;
    assess_action(action, window, target)
}

fn validate_action_request(request: &ComputerActionRequest) -> Result<(), WorkAssistantError> {
    if request.run_id.trim().is_empty() || request.run_id.chars().count() > 128 {
        return Err(WorkAssistantError::blocked("a bounded run id is required"));
    }
    if !matches!(
        request.action.as_str(),
        "computer_focus"
            | "computer_click"
            | "computer_type"
            | "computer_keypress"
            | "computer_scroll"
    ) {
        return Err(WorkAssistantError::blocked("unsupported computer action"));
    }
    Ok(())
}

fn action_risk(action: &str) -> &'static str {
    match action {
        "computer_focus" | "computer_scroll" => "reversible",
        _ => "high",
    }
}

fn action_summary(action: &str) -> &'static str {
    match action {
        "computer_focus" => "聚焦当前已验证窗口。",
        "computer_click" => "激活当前已验证的界面控件。",
        "computer_type" => "向当前已验证控件输入一段草稿。",
        "computer_keypress" => "向当前已验证控件发送一个键盘操作。",
        "computer_scroll" => "滚动当前已验证内容。",
        _ => "执行已验证的电脑操作。",
    }
}

pub fn assess_action(
    action: &str,
    window: &ComputerWindow,
    target: &ComputerTarget,
) -> Result<(), WorkAssistantError> {
    let surface = format!(
        "{} {} {} {}",
        action,
        window.title,
        target.role.as_deref().unwrap_or_default(),
        target.name.as_deref().unwrap_or_default()
    )
    .to_lowercase();
    if contains_sensitive_marker(&surface) {
        return Err(WorkAssistantError {
            code: "sensitive_surface".into(),
            message: "sensitive desktop surface is blocked".into(),
            recoverable: true,
        });
    }
    Ok(())
}

fn assess_observation_surface(
    window: &ComputerWindow,
    targets: &[ComputerTarget],
) -> Result<(), WorkAssistantError> {
    let mut surface = window.title.to_lowercase();
    for target in targets {
        surface.push(' ');
        surface.push_str(target.role.as_deref().unwrap_or_default());
        surface.push(' ');
        surface.push_str(target.name.as_deref().unwrap_or_default());
    }
    if contains_sensitive_marker(&surface.to_lowercase()) {
        return Err(WorkAssistantError {
            code: "sensitive_surface".into(),
            message: "sensitive desktop surface is blocked".into(),
            recoverable: true,
        });
    }
    Ok(())
}

fn truncate_model_visible_targets(
    window: &ComputerWindow,
    targets: Vec<ComputerTarget>,
) -> Result<Vec<ComputerTarget>, WorkAssistantError> {
    assess_observation_surface(window, &targets)?;
    Ok(targets
        .into_iter()
        .take(MAX_COMPUTER_MODEL_TARGETS)
        .collect())
}

fn contains_sensitive_marker(surface: &str) -> bool {
    [
        "password",
        "passcode",
        "otp",
        "one-time code",
        "verification",
        "captcha",
        "payment",
        "checkout",
        "card",
        "cvv",
        "bank",
        "密码",
        "验证码",
        "支付",
        "结账",
        "银行卡",
        "证件",
    ]
    .iter()
    .any(|marker| surface.contains(marker))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PasswordMetadata {
    NotPassword,
    Password,
    Unavailable,
}

fn assess_password_metadata(metadata: PasswordMetadata) -> Result<(), WorkAssistantError> {
    match metadata {
        PasswordMetadata::NotPassword => Ok(()),
        PasswordMetadata::Password => Err(WorkAssistantError {
            code: "sensitive_surface".into(),
            message: "password desktop surfaces are blocked".into(),
            recoverable: true,
        }),
        PasswordMetadata::Unavailable => Err(WorkAssistantError::blocked(
            "could not read accessibility password metadata",
        )),
    }
}

fn renderer_observation(observation: &ComputerObservation) -> RendererComputerObservation {
    RendererComputerObservation {
        id: observation.id.clone(),
        window: RendererComputerWindow {
            fingerprint: observation.window.fingerprint.clone(),
        },
        targets: observation
            .targets
            .iter()
            .map(|target| RendererComputerTarget {
                id: target.id.clone(),
                role: target.role.clone(),
                name: safe_renderer_target_name(target),
                fingerprint: target.fingerprint.clone(),
            })
            .collect(),
        expires_at: observation.expires_at,
    }
}

fn safe_renderer_target_name(target: &ComputerTarget) -> Option<String> {
    let role = target.role.as_deref()?.to_ascii_lowercase();
    if ![
        "button",
        "checkbox",
        "radiobutton",
        "menuitem",
        "tabitem",
        "hyperlink",
    ]
    .iter()
    .any(|allowed| role.contains(allowed))
    {
        return None;
    }
    let name = target.name.as_deref()?.trim();
    if name.is_empty()
        || name.chars().count() > 64
        || contains_sensitive_marker(&name.to_lowercase())
        || name.contains('@')
        || name
            .chars()
            .filter(|character| character.is_ascii_digit())
            .count()
            >= 6
    {
        return None;
    }
    Some(name.into())
}

pub fn validate_action_payload(request: &ComputerActionRequest) -> Result<(), WorkAssistantError> {
    if let Some(text) = request.text.as_deref() {
        if text.chars().count() > 4_000 {
            return Err(WorkAssistantError::blocked(
                "computer text exceeds the 4000 character limit",
            ));
        }
        let normalized = text.to_lowercase();
        if [
            "password",
            "passcode",
            "otp",
            "verification code",
            "验证码",
            "密码",
            "支付密码",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
        {
            return Err(WorkAssistantError {
                code: "sensitive_surface".into(),
                message: "sensitive values cannot be typed by computer assistance".into(),
                recoverable: true,
            });
        }
        if request.action == "computer_type"
            && (4..=8).contains(&text.chars().count())
            && text.chars().all(|character| character.is_ascii_digit())
        {
            return Err(WorkAssistantError {
                code: "sensitive_surface".into(),
                message: "verification-code-like values cannot be typed by computer assistance"
                    .into(),
                recoverable: true,
            });
        }
    }
    if request.action == "computer_keypress" {
        let key = request
            .key
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(
            key.as_str(),
            "enter"
                | "tab"
                | "escape"
                | "space"
                | "up"
                | "down"
                | "left"
                | "right"
                | "pageup"
                | "pagedown"
                | "home"
                | "end"
        ) {
            return Err(WorkAssistantError::blocked(
                "computer keypress is not in the approved key directory",
            ));
        }
    }
    if request.action == "computer_scroll"
        && !matches!(request.delta.as_deref(), Some("up" | "down"))
    {
        return Err(WorkAssistantError::blocked(
            "computer scroll direction must be up or down",
        ));
    }
    Ok(())
}

pub fn computer_capability() -> (bool, Option<&'static str>) {
    #[cfg(windows)]
    {
        (true, None)
    }
    #[cfg(target_os = "linux")]
    {
        (
            false,
            Some("需要 AT-SPI 与 GNOME Portal RemoteDesktop 授权；当前不会回退为坐标点击"),
        )
    }
    #[cfg(target_os = "macos")]
    {
        (false, Some("需要 macOS 辅助功能授权；当前仅提供兼容诊断"))
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        (false, Some("当前平台不支持 Computer Use"))
    }
}

#[tauri::command]
pub fn work_assistant_computer_observe(
    state: State<'_, WorkAssistantState>,
    run_id: String,
) -> Result<RendererComputerObservation, AssistantErrorPayload> {
    let now = unix_millis();
    ensure_run_active(&state, &run_id).map_err(AssistantErrorPayload::from)?;
    let observation = platform::observe_foreground(now).map_err(AssistantErrorPayload::from)?;
    state
        .computer_observations
        .lock()
        .map_err(|_| WorkAssistantError::protocol("computer observation store is unavailable"))
        .map_err(AssistantErrorPayload::from)?
        .insert_for_run(&run_id, observation.clone(), now);
    Ok(renderer_observation(&observation))
}

#[tauri::command]
pub fn work_assistant_computer_preview(
    state: State<'_, WorkAssistantState>,
    request: ComputerActionRequest,
) -> Result<ComputerActionPreview, AssistantErrorPayload> {
    let now = unix_millis();
    ensure_run_active(&state, &request.run_id).map_err(AssistantErrorPayload::from)?;
    state
        .computer_observations
        .lock()
        .map_err(|_| WorkAssistantError::protocol("computer observation store is unavailable"))
        .map_err(AssistantErrorPayload::from)?
        .create_preview(request, now)
        .map_err(AssistantErrorPayload::from)
}

#[tauri::command]
pub async fn work_assistant_computer_approve(
    state: State<'_, WorkAssistantState>,
    app: AppHandle,
    preview_id: String,
    run_id: String,
    scope: String,
) -> Result<ComputerApprovalGrant, AssistantErrorPayload> {
    let now = unix_millis();
    ensure_run_active(&state, &run_id).map_err(AssistantErrorPayload::from)?;
    let prompt = state
        .computer_observations
        .lock()
        .map_err(|_| WorkAssistantError::protocol("computer observation store is unavailable"))
        .map_err(AssistantErrorPayload::from)?
        .approval_prompt(&preview_id, &run_id, &scope, now)
        .map_err(AssistantErrorPayload::from)?;
    let confirmed = if prompt.requires_confirmation {
        native_computer_confirmation(app, prompt)
            .await
            .map_err(AssistantErrorPayload::from)?
    } else {
        true
    };
    ensure_run_active(&state, &run_id).map_err(AssistantErrorPayload::from)?;
    state
        .computer_observations
        .lock()
        .map_err(|_| WorkAssistantError::protocol("computer observation store is unavailable"))
        .map_err(AssistantErrorPayload::from)?
        .approve_after_native_confirmation(&preview_id, &run_id, &scope, confirmed, unix_millis())
        .map_err(AssistantErrorPayload::from)
}

#[tauri::command]
pub fn work_assistant_computer_execute(
    state: State<'_, WorkAssistantState>,
    preview_id: String,
    approval_token: String,
) -> Result<ComputerActionResult, AssistantErrorPayload> {
    let now = unix_millis();
    let preview = state
        .computer_observations
        .lock()
        .map_err(|_| WorkAssistantError::protocol("computer observation store is unavailable"))
        .map_err(AssistantErrorPayload::from)?
        .take_execution(&preview_id, &approval_token, now)
        .map_err(AssistantErrorPayload::from)?;
    let _dispatch_gate = state
        .computer_dispatch_gate
        .lock()
        .map_err(|_| WorkAssistantError::protocol("computer dispatch gate is unavailable"))
        .map_err(AssistantErrorPayload::from)?;
    ensure_run_active(&state, &preview.run_id).map_err(AssistantErrorPayload::from)?;
    let current = platform::observe_foreground(now).map_err(AssistantErrorPayload::from)?;
    let target = state
        .computer_observations
        .lock()
        .map_err(|_| WorkAssistantError::protocol("computer observation store is unavailable"))
        .map_err(AssistantErrorPayload::from)?
        .validate_execution(&preview, &current, now)
        .map_err(AssistantErrorPayload::from)?;
    ensure_run_active(&state, &preview.run_id).map_err(AssistantErrorPayload::from)?;
    assess_action(&preview.request.action, &current.window, &target)
        .map_err(AssistantErrorPayload::from)?;
    validate_action_payload(&preview.request).map_err(AssistantErrorPayload::from)?;
    platform::execute_action(&preview.request, &current.window, &target)
        .map_err(AssistantErrorPayload::from)
}

fn ensure_run_active(state: &WorkAssistantState, run_id: &str) -> Result<(), WorkAssistantError> {
    if run_id.trim().is_empty() || run_id.chars().count() > 128 {
        return Err(WorkAssistantError::blocked("a bounded run id is required"));
    }
    let cancelled = state
        .cancelled_runs
        .lock()
        .map_err(|_| WorkAssistantError::protocol("cancelled runs lock is unavailable"))?
        .contains(run_id);
    if cancelled {
        Err(WorkAssistantError::cancelled(
            "computer action run was cancelled",
        ))
    } else {
        Ok(())
    }
}

async fn native_computer_confirmation(
    app: AppHandle,
    prompt: ComputerNativeApprovalPrompt,
) -> Result<bool, WorkAssistantError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(prompt.message)
            .title(prompt.title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "继续".into(),
                "取消".into(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|_| WorkAssistantError::protocol("native computer confirmation could not be shown"))
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
    fn foreground_window_root(
        automation: &uiautomation::UIAutomation,
    ) -> Result<(uiautomation::UIElement, String), WorkAssistantError> {
        use uiautomation::types::Handle;
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return Err(WorkAssistantError::blocked(
                "could not read the native foreground window",
            ));
        }
        let window_handle = format!("{:p}", hwnd.0);
        let root = automation
            .element_from_handle(Handle::from(hwnd))
            .map_err(|_| WorkAssistantError::blocked("could not read the foreground window"))?;
        Ok((root, window_handle))
    }

    #[cfg(windows)]
    fn complete_window_tree(
        automation: &uiautomation::UIAutomation,
        root: &uiautomation::UIElement,
    ) -> Result<Vec<uiautomation::UIElement>, WorkAssistantError> {
        use uiautomation::types::TreeScope;

        let condition = automation
            .create_true_condition()
            .map_err(|_| WorkAssistantError::blocked("could not inspect accessibility targets"))?;
        let descendants = root
            .find_all(TreeScope::Descendants, &condition)
            .map_err(|_| {
                WorkAssistantError::blocked("could not inspect the complete accessibility tree")
            })?;
        let mut elements = Vec::with_capacity(descendants.len().saturating_add(1));
        elements.push(root.clone());
        elements.extend(descendants);
        Ok(elements)
    }

    #[cfg(windows)]
    fn assess_complete_accessibility_surface(
        window: &ComputerWindow,
        elements: &[uiautomation::UIElement],
    ) -> Result<(), WorkAssistantError> {
        if contains_sensitive_marker(&window.title.to_lowercase()) {
            return Err(WorkAssistantError {
                code: "sensitive_surface".into(),
                message: "sensitive desktop surface is blocked".into(),
                recoverable: true,
            });
        }

        for element in elements {
            let password_metadata = match element.is_password() {
                Ok(true) => PasswordMetadata::Password,
                Ok(false) => PasswordMetadata::NotPassword,
                Err(_) => PasswordMetadata::Unavailable,
            };
            assess_password_metadata(password_metadata)?;
            let name = element.get_name().unwrap_or_default();
            let role = element
                .get_control_type()
                .ok()
                .map(|value| format!("{value:?}"))
                .unwrap_or_default();
            if contains_sensitive_marker(&name.to_lowercase())
                || contains_sensitive_marker(&role.to_lowercase())
            {
                return Err(WorkAssistantError {
                    code: "sensitive_surface".into(),
                    message: "sensitive desktop surface is blocked".into(),
                    recoverable: true,
                });
            }
        }
        Ok(())
    }

    #[cfg(windows)]
    pub fn observe_foreground(now: u64) -> Result<ComputerObservation, WorkAssistantError> {
        use uiautomation::screenshots::Screenshot;
        use uiautomation::UIAutomation;

        let automation = UIAutomation::new()
            .map_err(|_| WorkAssistantError::blocked("Windows UI Automation is unavailable"))?;
        let (root, window_handle) = foreground_window_root(&automation)?;
        let title = root.get_name().unwrap_or_default();
        let app_id = root.get_classname().unwrap_or_default();
        let shot = Screenshot::capture_desktop().map_err(|_| {
            WorkAssistantError::blocked(
                "could not capture the current desktop for observation verification",
            )
        })?;
        let screenshot_fingerprint = fingerprint(&[
            &shot.width().to_string(),
            &shot.height().to_string(),
            &format!("{:x}", Sha256::digest(shot.pixels())),
        ]);
        let window = ComputerWindow {
            app_id,
            title,
            fingerprint: fingerprint(&[&window_handle, &screenshot_fingerprint]),
            stable_fingerprint: fingerprint(&[&window_handle]),
        };
        let accessible_elements = complete_window_tree(&automation, &root)?;
        // The complete UIA tree stays local; only the bounded target subset is persisted.
        assess_complete_accessibility_surface(&window, &accessible_elements)?;
        let targets = accessible_elements
            .into_iter()
            .enumerate()
            .filter_map(|(index, element)| {
                let name = element.get_name().unwrap_or_default();
                let role = element
                    .get_control_type()
                    .ok()
                    .map(|value| format!("{value:?}"));
                let bounds = element
                    .get_bounding_rectangle()
                    .ok()
                    .map(|rect| ComputerRect {
                        x: f64::from(rect.get_left()),
                        y: f64::from(rect.get_top()),
                        width: f64::from(rect.get_right() - rect.get_left()),
                        height: f64::from(rect.get_bottom() - rect.get_top()),
                    });
                if name.is_empty() && bounds.is_none() {
                    return None;
                }
                let id = format!("target-{index}");
                Some(ComputerTarget {
                    fingerprint: fingerprint(&[
                        &window.fingerprint,
                        &id,
                        role.as_deref().unwrap_or_default(),
                        &name,
                        &bounds
                            .as_ref()
                            .map(|value| {
                                format!("{}:{}:{}:{}", value.x, value.y, value.width, value.height)
                            })
                            .unwrap_or_default(),
                    ]),
                    id,
                    role,
                    name: (!name.is_empty()).then_some(name),
                    bounds,
                })
            })
            .take(MAX_COMPUTER_MODEL_TARGETS)
            .collect();
        Ok(ComputerObservation {
            id: Uuid::new_v4().to_string(),
            window,
            targets,
            expires_at: now.saturating_add(COMPUTER_OBSERVATION_TTL_MS),
        })
    }

    #[cfg(windows)]
    pub fn execute_action(
        request: &ComputerActionRequest,
        window: &ComputerWindow,
        target: &ComputerTarget,
    ) -> Result<ComputerActionResult, WorkAssistantError> {
        use uiautomation::{
            patterns::UIScrollPattern, screenshots::Screenshot, types::ScrollAmount, UIAutomation,
        };
        let automation = UIAutomation::new()
            .map_err(|_| WorkAssistantError::blocked("Windows UI Automation is unavailable"))?;
        let (root, window_handle) = foreground_window_root(&automation)?;
        let title = root.get_name().unwrap_or_default();
        let app_id = root.get_classname().unwrap_or_default();
        let shot = Screenshot::capture_desktop().map_err(|_| {
            WorkAssistantError::blocked(
                "could not capture the current desktop for dispatch verification",
            )
        })?;
        let screenshot_fingerprint = fingerprint(&[
            &shot.width().to_string(),
            &shot.height().to_string(),
            &format!("{:x}", Sha256::digest(shot.pixels())),
        ]);
        let dispatch_window = ComputerWindow {
            app_id,
            title,
            fingerprint: fingerprint(&[&window_handle, &screenshot_fingerprint]),
            stable_fingerprint: fingerprint(&[&window_handle]),
        };
        let elements = complete_window_tree(&automation, &root)?;
        // Recheck the complete native tree immediately before dispatching an action.
        assess_complete_accessibility_surface(&dispatch_window, &elements)?;
        let mut dispatch_targets = Vec::new();
        let mut matched = None;
        for (index, element) in elements.into_iter().enumerate() {
            let name = element.get_name().unwrap_or_default();
            let role = element
                .get_control_type()
                .ok()
                .map(|value| format!("{value:?}"));
            let bounds = element
                .get_bounding_rectangle()
                .ok()
                .map(|rect| ComputerRect {
                    x: f64::from(rect.get_left()),
                    y: f64::from(rect.get_top()),
                    width: f64::from(rect.get_right() - rect.get_left()),
                    height: f64::from(rect.get_bottom() - rect.get_top()),
                });
            if name.is_empty() && bounds.is_none() {
                continue;
            }
            let id = format!("target-{index}");
            let candidate = ComputerTarget {
                fingerprint: fingerprint(&[
                    &dispatch_window.fingerprint,
                    &id,
                    role.as_deref().unwrap_or_default(),
                    &name,
                    &bounds
                        .as_ref()
                        .map(|value| {
                            format!("{}:{}:{}:{}", value.x, value.y, value.width, value.height)
                        })
                        .unwrap_or_default(),
                ]),
                id,
                role,
                name: (!name.is_empty()).then_some(name),
                bounds,
            };
            if candidate.id == target.id {
                matched = Some((candidate.clone(), element));
            }
            dispatch_targets.push(candidate);
            if dispatch_targets.len() >= MAX_COMPUTER_MODEL_TARGETS {
                break;
            }
        }
        let (dispatch_target, element) = matched.ok_or_else(|| WorkAssistantError {
            code: "target_missing".into(),
            message: "accessibility target is no longer available".into(),
            recoverable: true,
        })?;
        validate_dispatch_reference(window, target, &dispatch_window, &dispatch_target)?;
        validate_dispatch_surface(
            &request.action,
            &dispatch_window,
            &dispatch_targets,
            &dispatch_target,
        )?;
        match request.action.as_str() {
            "computer_focus" => element.set_focus().map_err(|_| {
                WorkAssistantError::stale_preview("could not focus the verified target")
            })?,
            "computer_click" => element.click().map_err(|_| {
                WorkAssistantError::stale_preview("could not activate the verified target")
            })?,
            "computer_type" => element
                .send_text(request.text.as_deref().unwrap_or_default(), 5)
                .map_err(|_| {
                    WorkAssistantError::stale_preview("could not type into the verified target")
                })?,
            "computer_keypress" => element
                .send_keys(key_sequence(request.key.as_deref().unwrap_or_default())?, 5)
                .map_err(|_| {
                    WorkAssistantError::stale_preview("could not send the verified keypress")
                })?,
            "computer_scroll" => {
                let amount = if request.delta.as_deref() == Some("up") {
                    ScrollAmount::SmallDecrement
                } else {
                    ScrollAmount::SmallIncrement
                };
                element
                    .get_pattern::<UIScrollPattern>()
                    .map_err(|_| {
                        WorkAssistantError::blocked(
                            "scroll is unavailable for this accessible target",
                        )
                    })?
                    .scroll(ScrollAmount::NoAmount, amount)
                    .map_err(|_| {
                        WorkAssistantError::stale_preview("could not scroll the verified target")
                    })?
            }
            _ => return Err(WorkAssistantError::blocked("unsupported computer action")),
        }
        Ok(ComputerActionResult {
            ok: true,
            summary: "已执行已验证的电脑操作。".into(),
            error_code: None,
            recoverable: None,
        })
    }

    #[cfg(windows)]
    fn key_sequence(key: &str) -> Result<&'static str, WorkAssistantError> {
        match key.to_ascii_lowercase().as_str() {
            "enter" => Ok("{ENTER}"),
            "tab" => Ok("{TAB}"),
            "escape" => Ok("{ESC}"),
            "space" => Ok(" "),
            "up" => Ok("{UP}"),
            "down" => Ok("{DOWN}"),
            "left" => Ok("{LEFT}"),
            "right" => Ok("{RIGHT}"),
            "pageup" => Ok("{PGUP}"),
            "pagedown" => Ok("{PGDN}"),
            "home" => Ok("{HOME}"),
            "end" => Ok("{END}"),
            _ => Err(WorkAssistantError::blocked(
                "computer keypress is not in the approved key directory",
            )),
        }
    }

    #[cfg(target_os = "linux")]
    pub fn observe_foreground(_now: u64) -> Result<ComputerObservation, WorkAssistantError> {
        Err(WorkAssistantError { code: "computer_portal_required".into(), message: "Debian Wayland requires an AT-SPI and GNOME Portal RemoteDesktop session before computer assistance can observe the desktop".into(), recoverable: true })
    }

    #[cfg(target_os = "linux")]
    pub fn execute_action(
        _request: &ComputerActionRequest,
        _window: &ComputerWindow,
        _target: &ComputerTarget,
    ) -> Result<ComputerActionResult, WorkAssistantError> {
        Err(WorkAssistantError { code: "computer_portal_required".into(), message: "Debian Wayland computer assistance is unavailable until AT-SPI and GNOME Portal authorization are granted".into(), recoverable: true })
    }

    #[cfg(target_os = "macos")]
    pub fn observe_foreground(_now: u64) -> Result<ComputerObservation, WorkAssistantError> {
        Err(WorkAssistantError {
            code: "computer_accessibility_required".into(),
            message: "macOS Accessibility permission is required for computer assistance".into(),
            recoverable: true,
        })
    }

    #[cfg(target_os = "macos")]
    pub fn execute_action(
        _request: &ComputerActionRequest,
        _window: &ComputerWindow,
        _target: &ComputerTarget,
    ) -> Result<ComputerActionResult, WorkAssistantError> {
        Err(WorkAssistantError {
            code: "computer_accessibility_required".into(),
            message: "macOS Accessibility permission is required for computer assistance".into(),
            recoverable: true,
        })
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    pub fn observe_foreground(_now: u64) -> Result<ComputerObservation, WorkAssistantError> {
        Err(WorkAssistantError::blocked(
            "computer assistance is not supported on this platform",
        ))
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    pub fn execute_action(
        _request: &ComputerActionRequest,
        _window: &ComputerWindow,
        _target: &ComputerTarget,
    ) -> Result<ComputerActionResult, WorkAssistantError> {
        Err(WorkAssistantError::blocked(
            "computer assistance is not supported on this platform",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation(id: &str, window: &str, target: &str, expires_at: u64) -> ComputerObservation {
        ComputerObservation {
            id: id.into(),
            window: ComputerWindow {
                app_id: "app".into(),
                title: "Window".into(),
                fingerprint: window.into(),
                stable_fingerprint: window.into(),
            },
            targets: vec![ComputerTarget {
                id: "target-1".into(),
                role: Some("button".into()),
                name: Some("Save".into()),
                fingerprint: target.into(),
                bounds: None,
            }],
            expires_at,
        }
    }

    fn request() -> ComputerActionRequest {
        ComputerActionRequest {
            run_id: "run-1".into(),
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
    fn computer_approval_is_run_bound_and_single_use() {
        let mut store = ComputerObservationStore::default();
        store.insert_for_run(
            "run-1",
            observation("observe-1", "window-v1", "target-v1", 10_000),
            0,
        );
        let preview = store.create_preview(request(), 1).unwrap();

        assert_eq!(
            store
                .approve(&preview.id, "run-2", "once", 2)
                .unwrap_err()
                .code,
            "blocked"
        );

        let grant = store.approve(&preview.id, "run-1", "once", 2).unwrap();
        let executed = store.take_execution(&preview.id, &grant.token, 3).unwrap();
        assert_eq!(executed.request.run_id, "run-1");
        assert_eq!(
            store
                .approve(&preview.id, "run-1", "once", 4)
                .unwrap_err()
                .code,
            "blocked"
        );
        assert_eq!(
            store
                .take_execution(&preview.id, &grant.token, 4)
                .unwrap_err()
                .code,
            "blocked"
        );
    }

    #[test]
    fn computer_preview_rejects_cross_run_observations_and_cancelled_run_state() {
        let mut store = ComputerObservationStore::default();
        store.insert_for_run(
            "run-1",
            observation("observe-1", "window-v1", "target-v1", 10_000),
            0,
        );
        let mut cross_run = request();
        cross_run.run_id = "run-2".into();
        assert_eq!(
            store.create_preview(cross_run, 1).unwrap_err().code,
            "blocked"
        );

        let preview = store.create_preview(request(), 1).unwrap();
        let grant = store.approve(&preview.id, "run-1", "once", 2).unwrap();
        store.clear_run("run-1");
        assert_eq!(
            store
                .take_execution(&preview.id, &grant.token, 3)
                .unwrap_err()
                .code,
            "blocked"
        );
    }

    #[test]
    fn computer_execution_revalidates_target_and_observation_expiry() {
        let mut store = ComputerObservationStore::default();
        store.insert_for_run(
            "run-1",
            observation("observe-1", "window-v1", "target-v1", 10),
            0,
        );
        let preview = store.create_preview(request(), 1).unwrap();
        let grant = store.approve(&preview.id, "run-1", "once", 2).unwrap();
        let execution = store.take_execution(&preview.id, &grant.token, 3).unwrap();
        let changed = observation("current", "window-v1", "target-v2", 100);
        assert_eq!(
            store
                .validate_execution(&execution, &changed, 4)
                .unwrap_err()
                .code,
            "target_changed"
        );

        let mut expired_store = ComputerObservationStore::default();
        expired_store.insert_for_run(
            "run-1",
            observation("observe-2", "window-v1", "target-v1", 4),
            0,
        );
        let mut expired_request = request();
        expired_request.observation_id = "observe-2".into();
        let preview = expired_store.create_preview(expired_request, 1).unwrap();
        let grant = expired_store
            .approve(&preview.id, "run-1", "once", 2)
            .unwrap();
        let execution = expired_store
            .take_execution(&preview.id, &grant.token, 3)
            .unwrap();
        assert_eq!(
            expired_store
                .validate_execution(
                    &execution,
                    &observation("current", "window-v1", "target-v1", 100),
                    4
                )
                .unwrap_err()
                .code,
            "stale_preview"
        );
    }

    #[test]
    fn validation_rejects_expired_observations_and_foreground_window_changes() {
        let mut store = ComputerObservationStore::default();
        store.insert_for_run(
            "run-1",
            observation("observe-1", "window-v1", "target-v1", 100),
            0,
        );
        let preview = store.create_preview(request(), 1).unwrap();
        let stored = store.previews.get(&preview.id).unwrap().clone();

        let expired = store
            .validate_execution(
                &stored,
                &observation("current", "window-v1", "target-v1", 200),
                100,
            )
            .unwrap_err();
        assert_eq!(expired.code, "stale_preview");

        store.insert_for_run(
            "run-1",
            observation("observe-1", "window-v1", "target-v1", 200),
            101,
        );
        let preview = store.create_preview(request(), 102).unwrap();
        let stored = store.previews.get(&preview.id).unwrap().clone();
        let mut refreshed_screen = observation("current", "window-v2", "target-v1", 200);
        refreshed_screen.window.stable_fingerprint = "window-v1".into();
        let changed = store
            .validate_execution(&stored, &refreshed_screen, 102)
            .unwrap_err();
        assert_eq!(changed.code, "window_changed");
    }

    #[test]
    fn validation_rejects_target_fingerprint_changes_and_sensitive_surfaces() {
        let mut store = ComputerObservationStore::default();
        store.insert_for_run(
            "run-1",
            observation("observe-1", "window-v1", "target-v1", 200),
            0,
        );
        let preview = store.create_preview(request(), 1).unwrap();
        let stored = store.previews.get(&preview.id).unwrap().clone();
        let changed = store
            .validate_execution(
                &stored,
                &observation("current", "window-v1", "target-v2", 200),
                1,
            )
            .unwrap_err();
        assert_eq!(changed.code, "target_changed");

        let password = ComputerTarget {
            id: "password".into(),
            role: Some("textbox".into()),
            name: Some("Password".into()),
            fingerprint: "target".into(),
            bounds: None,
        };
        assert_eq!(
            assess_action(
                "computer_type",
                &ComputerWindow {
                    app_id: "app".into(),
                    title: "Window".into(),
                    fingerprint: "window".into(),
                    stable_fingerprint: "window".into(),
                },
                &password
            )
            .unwrap_err()
            .code,
            "sensitive_surface"
        );
    }

    #[test]
    fn native_password_metadata_blocks_passwords_and_missing_values() {
        assert!(assess_password_metadata(PasswordMetadata::NotPassword).is_ok());
        assert_eq!(
            assess_password_metadata(PasswordMetadata::Password)
                .unwrap_err()
                .code,
            "sensitive_surface"
        );
        assert_eq!(
            assess_password_metadata(PasswordMetadata::Unavailable)
                .unwrap_err()
                .code,
            "blocked"
        );
    }

    #[test]
    fn sensitive_neighbor_or_code_like_input_blocks_an_otherwise_unlabeled_control() {
        let window = ComputerWindow {
            app_id: "browser".into(),
            title: "Checkout".into(),
            fingerprint: "window".into(),
            stable_fingerprint: "window".into(),
        };
        let continue_button = ComputerTarget {
            id: "target-1".into(),
            role: Some("button".into()),
            name: Some("Continue".into()),
            fingerprint: "button".into(),
            bounds: None,
        };
        let otp_field = ComputerTarget {
            id: "target-2".into(),
            role: Some("textbox".into()),
            name: Some("One-time code".into()),
            fingerprint: "code".into(),
            bounds: None,
        };
        assert_eq!(
            assess_observation_surface(&window, &[continue_button.clone(), otp_field])
                .unwrap_err()
                .code,
            "sensitive_surface"
        );

        let mut code_request = request();
        code_request.action = "computer_type".into();
        code_request.text = Some("123456".into());
        code_request.target_id = continue_button.id;
        assert_eq!(
            validate_action_payload(&code_request).unwrap_err().code,
            "sensitive_surface"
        );
    }

    #[test]
    fn sensitive_accessibility_target_beyond_model_limit_is_blocked() {
        let window = ComputerWindow {
            app_id: "browser".into(),
            title: "Account settings".into(),
            fingerprint: "window".into(),
            stable_fingerprint: "window".into(),
        };
        let mut targets = (0..96)
            .map(|index| ComputerTarget {
                id: format!("target-{index}"),
                role: Some("Button".into()),
                name: Some("Continue".into()),
                fingerprint: format!("target-{index}"),
                bounds: None,
            })
            .collect::<Vec<_>>();
        targets.push(ComputerTarget {
            id: "target-96".into(),
            role: Some("Edit".into()),
            name: Some("Password".into()),
            fingerprint: "target-96".into(),
            bounds: None,
        });

        assert_eq!(
            truncate_model_visible_targets(&window, targets)
                .unwrap_err()
                .code,
            "sensitive_surface"
        );
    }

    #[test]
    fn renderer_observation_omits_window_titles_and_edit_names() {
        let observation = ComputerObservation {
            id: "observe-1".into(),
            window: ComputerWindow {
                app_id: "writer".into(),
                title: "Alice private notes".into(),
                fingerprint: "window-1".into(),
                stable_fingerprint: "window-1".into(),
            },
            targets: vec![
                ComputerTarget {
                    id: "save".into(),
                    role: Some("Button".into()),
                    name: Some("Save draft".into()),
                    fingerprint: "save-1".into(),
                    bounds: None,
                },
                ComputerTarget {
                    id: "edit".into(),
                    role: Some("Edit".into()),
                    name: Some("alice@example.com".into()),
                    fingerprint: "edit-1".into(),
                    bounds: None,
                },
            ],
            expires_at: 123,
        };

        let serialized = serde_json::to_string(&renderer_observation(&observation)).unwrap();
        assert!(!serialized.contains("Alice private notes"));
        assert!(!serialized.contains("alice@example.com"));
        assert!(serialized.contains("Save draft"));
    }

    #[test]
    fn approval_token_is_only_issued_after_native_confirmation_result() {
        let mut store = ComputerObservationStore::default();
        store.insert_for_run(
            "run-1",
            observation("observe-1", "window-v1", "target-v1", 10_000),
            0,
        );
        let preview = store.create_preview(request(), 1).unwrap();

        assert_eq!(
            store
                .approve_after_native_confirmation(&preview.id, "run-1", "once", false, 2)
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert_eq!(
            store
                .approve_after_native_confirmation(&preview.id, "run-1", "once", true, 2)
                .unwrap()
                .preview_id,
            preview.id
        );
    }

    #[test]
    fn expired_native_run_confirmation_cannot_leave_a_run_grant() {
        let mut store = ComputerObservationStore::default();
        store.insert_for_run(
            "run-1",
            observation("observe-1", "window-v1", "target-v1", 3),
            0,
        );
        let mut focus = request();
        focus.action = "computer_focus".into();
        let preview = store.create_preview(focus, 1).unwrap();

        assert_eq!(
            store
                .approve_after_native_confirmation(&preview.id, "run-1", "run", true, 3)
                .unwrap_err()
                .code,
            "blocked"
        );
        assert!(!store.run_grants.contains_key("run-1"));
    }

    #[test]
    fn reversible_run_grant_applies_only_to_the_same_run_and_window() {
        let mut store = ComputerObservationStore::default();
        store.insert_for_run(
            "run-1",
            observation("observe-1", "window-v1", "target-v1", 100_000),
            0,
        );
        let mut focus = request();
        focus.action = "computer_focus".into();
        let first = store.create_preview(focus.clone(), 1).unwrap();
        assert!(first.approval_required);
        store
            .approve_after_native_confirmation(&first.id, "run-1", "run", true, 2)
            .unwrap();

        let same_window = store.create_preview(focus.clone(), 3).unwrap();
        assert!(!same_window.approval_required);

        let mut refreshed_window = observation("observe-2", "window-v2", "target-v2", 100_000);
        refreshed_window.window.stable_fingerprint = "window-v1".into();
        store.insert_for_run("run-1", refreshed_window, 3);
        let mut refreshed_focus = focus.clone();
        refreshed_focus.observation_id = "observe-2".into();
        refreshed_focus.window_fingerprint = "window-v2".into();
        refreshed_focus.target_fingerprint = "target-v2".into();
        assert!(
            !store
                .create_preview(refreshed_focus, 3)
                .unwrap()
                .approval_required
        );

        let mut high_risk = focus.clone();
        high_risk.action = "computer_click".into();
        assert!(
            store
                .create_preview(high_risk, 3)
                .unwrap()
                .approval_required
        );

        store.insert_for_run(
            "run-1",
            observation("observe-2", "window-v2", "target-v1", 100_000),
            3,
        );
        let mut other_window = focus;
        other_window.observation_id = "observe-2".into();
        other_window.window_fingerprint = "window-v2".into();
        assert!(
            store
                .create_preview(other_window, 4)
                .unwrap()
                .approval_required
        );
    }

    #[test]
    fn dispatch_revalidation_rejects_a_reenumerated_target_with_a_different_fingerprint() {
        let window = ComputerWindow {
            app_id: "app".into(),
            title: "Window".into(),
            fingerprint: "window-v1".into(),
            stable_fingerprint: "window-v1".into(),
        };
        let expected = ComputerTarget {
            id: "target-1".into(),
            role: Some("button".into()),
            name: Some("Save".into()),
            fingerprint: "target-v1".into(),
            bounds: None,
        };
        let changed = ComputerTarget {
            fingerprint: "target-v2".into(),
            ..expected.clone()
        };

        assert_eq!(
            validate_dispatch_reference(&window, &expected, &window, &changed)
                .unwrap_err()
                .code,
            "target_changed"
        );
    }

    #[test]
    fn final_dispatch_surface_check_blocks_a_new_sensitive_neighbor() {
        let window = ComputerWindow {
            app_id: "browser".into(),
            title: "Window".into(),
            fingerprint: "window-v1".into(),
            stable_fingerprint: "window-v1".into(),
        };
        let target = ComputerTarget {
            id: "continue".into(),
            role: Some("Button".into()),
            name: Some("Continue".into()),
            fingerprint: "continue-v1".into(),
            bounds: None,
        };
        let payment_field = ComputerTarget {
            id: "card".into(),
            role: Some("Edit".into()),
            name: Some("Card number".into()),
            fingerprint: "card-v1".into(),
            bounds: None,
        };

        assert_eq!(
            validate_dispatch_surface(
                "computer_click",
                &window,
                &[target.clone(), payment_field],
                &target
            )
            .unwrap_err()
            .code,
            "sensitive_surface"
        );
    }

    #[test]
    fn action_payload_rejects_sensitive_text_and_unbounded_keypresses() {
        let mut typing = request();
        typing.action = "computer_type".into();
        typing.text = Some("my password is not for automation".into());
        assert_eq!(
            validate_action_payload(&typing).unwrap_err().code,
            "sensitive_surface"
        );

        let mut keypress = request();
        keypress.action = "computer_keypress".into();
        keypress.key = Some("{WIN}R".into());
        assert_eq!(
            validate_action_payload(&keypress).unwrap_err().code,
            "blocked"
        );
    }
}
