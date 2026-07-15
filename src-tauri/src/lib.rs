use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::Manager;
use uuid::Uuid;

pub mod secretary_ledger;
mod work_assistant;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(work_assistant::init_state(&app.handle())?);
            app.manage(work_assistant::browser_bridge::init_browser_bridge_state());
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            rag_query,
            mcp_search,
            read_project_guidance,
            web_search,
            health_check_backend,
            check_sqlite_status,
            get_memory_usage,
            clear_global_memory,
            rebuild_project_index,
            test_model_connection,
            llm_chat,
            open_external_url,
            secretary_ledger::secretary_ledger_bootstrap,
            secretary_ledger::secretary_ledger_health,
            secretary_ledger::secretary_ledger_create_project,
            secretary_ledger::secretary_ledger_list_projects,
            secretary_ledger::secretary_ledger_create_memory,
            secretary_ledger::secretary_ledger_get_memory,
            secretary_ledger::secretary_ledger_list_memories,
            secretary_ledger::secretary_ledger_update_memory,
            secretary_ledger::secretary_ledger_rollback_memory,
            secretary_ledger::secretary_ledger_delete_memory,
            secretary_ledger::secretary_ledger_search,
            secretary_ledger::secretary_ledger_create_task,
            secretary_ledger::secretary_ledger_get_task,
            secretary_ledger::secretary_ledger_list_tasks,
            secretary_ledger::secretary_ledger_update_task,
            secretary_ledger::secretary_ledger_delete_task,
            secretary_ledger::secretary_ledger_record_event,
            secretary_ledger::secretary_ledger_list_events,
            secretary_ledger::secretary_ledger_save_checkpoint,
            secretary_ledger::secretary_ledger_load_latest_checkpoint,
            secretary_ledger::secretary_ledger_import_legacy_batch,
            work_assistant::work_assistant_capabilities,
            work_assistant::work_assistant_list_roots,
            work_assistant::work_assistant_add_root,
            work_assistant::work_assistant_remove_root,
            work_assistant::work_assistant_workspace_list,
            work_assistant::work_assistant_workspace_scan,
            work_assistant::work_assistant_file_search,
            work_assistant::work_assistant_file_inspect,
            work_assistant::work_assistant_downloads_scan,
            work_assistant::work_assistant_list_audit,
            work_assistant::work_assistant_clear_audit,
            work_assistant::work_assistant_desktop_status,
            work_assistant::work_assistant_desktop_open_url,
            work_assistant::work_assistant_desktop_open_file,
            work_assistant::work_assistant_desktop_reveal_file,
            work_assistant::work_assistant_validate_application_selection,
            work_assistant::work_assistant_list_applications,
            work_assistant::work_assistant_register_application_from_picker,
            work_assistant::work_assistant_remove_application,
            work_assistant::work_assistant_launch_application,
            work_assistant::work_assistant_cancel_run,
            work_assistant::work_assistant_preview,
            work_assistant::work_assistant_approve,
            work_assistant::work_assistant_execute,
            work_assistant::work_assistant_doctor,
            work_assistant::browser_bridge_status,
            work_assistant::browser_bridge_start_pairing,
            work_assistant::browser_bridge_pair,
            work_assistant::browser_bridge_disconnect,
            work_assistant::browser_open,
            work_assistant::browser_snapshot,
            work_assistant::browser_fill_draft,
            work_assistant::browser_click,
            work_assistant::browser_download,
            work_assistant::browser_submit,
            work_assistant::web_extract,
            work_assistant::work_assistant_browser_status,
            work_assistant::work_assistant_browser_start_pairing,
            work_assistant::work_assistant_browser_disconnect,
            work_assistant::work_assistant_browser_preview_action,
            work_assistant::work_assistant_browser_approve_action,
            work_assistant::work_assistant_browser_reject_action,
            work_assistant::work_assistant_browser_cancel_run,
            work_assistant::work_assistant_browser_snapshot,
            work_assistant::work_assistant_browser_execute_action,
            work_assistant::work_assistant_web_extract,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Serialize)]
struct ProjectGuidancePayload {
    style: String,
    world: String,
}

#[derive(Serialize)]
struct WebSearchResult {
    title: String,
    url: String,
    excerpt: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MaintenanceStatus {
    status: String,
    message: String,
    latency_ms: Option<u128>,
    bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    clear_committed: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelConnectionRequest {
    base_url: String,
    model_name: String,
    api_key: String,
    provider_type: String,
}

#[derive(Deserialize, Serialize)]
struct LlmChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmChatRequest {
    base_url: String,
    model_name: String,
    api_key: String,
    provider_type: String,
    messages: Vec<LlmChatMessage>,
    temperature: f32,
    max_tokens: u32,
    frequency_penalty: Option<f32>,
    presence_penalty: Option<f32>,
}

#[derive(Deserialize)]
struct LlmChatResponse {
    choices: Option<Vec<LlmChoice>>,
    error: Option<LlmError>,
}

#[derive(Deserialize)]
struct LlmChoice {
    message: Option<LlmChatMessage>,
    text: Option<String>,
}

#[derive(Deserialize)]
struct LlmError {
    message: Option<String>,
}

fn chat_endpoint(base_url: &str, provider_type: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');

    if trimmed.ends_with("/chat/completions") || trimmed.ends_with("/chat") {
        return trimmed.to_string();
    }

    if provider_type == "scallion_proxy" {
        format!("{}/chat", trimmed)
    } else {
        format!("{}/chat/completions", trimmed)
    }
}

#[tauri::command]
fn read_project_guidance() -> ProjectGuidancePayload {
    let root = project_root();

    ProjectGuidancePayload {
        style: read_optional_file(root.join("STYLE.md")),
        world: read_optional_file(root.join("WORLD.md")),
    }
}

#[tauri::command]
fn health_check_backend() -> MaintenanceStatus {
    MaintenanceStatus {
        status: "ok".into(),
        message: "Tauri 后端通信正常".into(),
        latency_ms: Some(0),
        bytes: None,
        clear_committed: None,
    }
}

#[tauri::command]
fn check_sqlite_status(app: tauri::AppHandle) -> Result<MaintenanceStatus, String> {
    let health = secretary_ledger::SecretaryLedger::open_for_app(&app)
        .and_then(|ledger| ledger.health())
        .map_err(|error| error.safe_message().to_string())?;

    Ok(MaintenanceStatus {
        status: "ok".into(),
        message: "秘书账本 SQLite 与 FTS5 可用".into(),
        latency_ms: None,
        bytes: Some(health.bytes),
        clear_committed: None,
    })
}

#[tauri::command]
fn get_memory_usage(app: tauri::AppHandle) -> Result<MaintenanceStatus, String> {
    let memory_dir = memory_dir(&app)?;
    let storage = memory_storage_usage(&memory_dir)?;
    let ledger_bytes = secretary_ledger::ledger_size_for_app(&app)
        .map_err(|error| error.safe_message().to_string())?;
    let bytes = storage.bytes.saturating_add(ledger_bytes);

    Ok(MaintenanceStatus {
        status: if storage.legacy_cleanup_pending {
            "warning".into()
        } else {
            "ok".into()
        },
        message: if storage.legacy_cleanup_pending {
            "记忆目录与秘书账本统计完成，旧记忆仍待清理".into()
        } else {
            "记忆目录与秘书账本统计完成".into()
        },
        latency_ms: None,
        bytes: Some(bytes),
        clear_committed: None,
    })
}

#[tauri::command]
fn clear_global_memory(app: tauri::AppHandle) -> Result<MaintenanceStatus, String> {
    let memory_dir = memory_dir(&app)?;
    let ledger = secretary_ledger::SecretaryLedger::open_for_app(&app)
        .map_err(|error| error.safe_message().to_string())?;
    let result = clear_memory_storage(&memory_dir, || ledger.clear())?;

    Ok(MaintenanceStatus {
        status: if result.legacy_cleanup_pending {
            "warning".into()
        } else {
            "ok".into()
        },
        message: if result.legacy_cleanup_pending {
            "秘书账本已清空，旧记忆已隔离但仍待清理".into()
        } else {
            "全局记忆已清空".into()
        },
        latency_ms: None,
        bytes: Some(result.bytes),
        clear_committed: Some(true),
    })
}

#[tauri::command]
fn rebuild_project_index(app: tauri::AppHandle) -> Result<MaintenanceStatus, String> {
    let memory_dir = memory_dir(&app)?;
    fs::create_dir_all(&memory_dir).map_err(|error| format!("创建记忆目录失败：{}", error))?;
    fs::write(
        memory_dir.join("index-rebuild-requested.txt"),
        "Papyrus project index rebuild requested.\n",
    )
    .map_err(|error| format!("写入索引重建标记失败：{}", error))?;

    Ok(MaintenanceStatus {
        status: "warning".into(),
        message: "项目索引重建请求已记录，真实向量库接入后会执行完整重建".into(),
        latency_ms: None,
        bytes: Some(directory_size(&memory_dir)),
        clear_committed: None,
    })
}

#[tauri::command]
async fn test_model_connection(
    request: ModelConnectionRequest,
) -> Result<MaintenanceStatus, String> {
    let base_url = request.base_url.trim().trim_end_matches('/').to_string();
    let model_name = request.model_name.trim().to_string();

    if base_url.is_empty() || model_name.is_empty() {
        return Err("Base URL 和 Model Name 不能为空".into());
    }

    let endpoint = chat_endpoint(&base_url, &request.provider_type);
    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(18));

    if base_url.starts_with("http://localhost") || base_url.starts_with("http://127.0.0.1") {
        builder = builder.danger_accept_invalid_certs(true);
    }

    let client = builder
        .build()
        .map_err(|error| format!("创建模型检测客户端失败：{}", error))?;
    let started_at = Instant::now();
    let mut request_builder = client
        .post(endpoint)
        .header(reqwest::header::CONTENT_TYPE, "application/json");

    if !request.api_key.trim().is_empty() {
        request_builder = request_builder.bearer_auth(request.api_key.trim());
    }

    let body = json!({
      "model": model_name,
      "messages": [
        { "role": "system", "content": "You are a connectivity checker. Reply with exactly: OK" },
        { "role": "user", "content": "OK" }
      ],
      "temperature": 0.0,
      "max_tokens": 8,
      "stream": false
    })
    .to_string();
    let response = request_builder
        .body(body)
        .send()
        .await
        .map_err(|error| format!("模型联通性检测失败：{}", error))?;
    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let excerpt: String = body.chars().take(180).collect();
        return Err(format!("模型联通性检测失败：HTTP {} {}", status, excerpt));
    }

    Ok(MaintenanceStatus {
        status: "ok".into(),
        message: "模型联通性检测通过".into(),
        latency_ms: Some(started_at.elapsed().as_millis()),
        bytes: None,
        clear_committed: None,
    })
}

#[tauri::command]
async fn llm_chat(request: LlmChatRequest) -> Result<String, String> {
    let base_url = request.base_url.trim().trim_end_matches('/').to_string();
    let model_name = request.model_name.trim().to_string();

    if base_url.is_empty() || model_name.is_empty() {
        return Err("Base URL and Model Name are required".into());
    }

    let endpoint = chat_endpoint(&base_url, &request.provider_type);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("create LLM client failed: {}", error))?;
    let mut request_builder = client
        .post(endpoint)
        .header(reqwest::header::CONTENT_TYPE, "application/json");

    if !request.api_key.trim().is_empty() {
        request_builder = request_builder.bearer_auth(request.api_key.trim());
    }

    let response = request_builder
        .body(llm_request_body(&request).to_string())
        .send()
        .await
        .map_err(|error| format!("LLM network request failed: {}", error))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("read LLM response failed: {}", error))?;

    if !status.is_success() {
        let excerpt: String = text.chars().take(240).collect();
        return Err(format!("LLM request failed: HTTP {} {}", status, excerpt));
    }

    let payload: LlmChatResponse = serde_json::from_str(&text)
        .map_err(|error| format!("parse LLM response failed: {}", error))?;

    if let Some(message) = payload.error.and_then(|error| error.message) {
        return Err(message);
    }

    let content = payload
        .choices
        .and_then(|choices| choices.into_iter().next())
        .and_then(|choice| {
            choice
                .message
                .and_then(|message| Some(message.content))
                .or(choice.text)
        })
        .unwrap_or_default()
        .trim()
        .to_string();

    if content.is_empty() {
        return Err("LLM returned no usable text".into());
    }

    Ok(content)
}

fn llm_request_body(request: &LlmChatRequest) -> serde_json::Value {
    let mut body = json!({
      "model": request.model_name,
      "messages": request.messages,
      "temperature": request.temperature,
      "max_tokens": request.max_tokens,
      "stream": false
    });
    if let Some(frequency_penalty) = request.frequency_penalty {
        body["frequency_penalty"] = json!(frequency_penalty);
    }
    if let Some(presence_penalty) = request.presence_penalty {
        body["presence_penalty"] = json!(presence_penalty);
    }
    body
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();

    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("only http(s) URLs can be opened".into());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .map_err(|error| format!("open browser failed: {}", error))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|error| format!("open browser failed: {}", error))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|error| format!("open browser failed: {}", error))?;
    }

    Ok(())
}

#[tauri::command]
fn rag_query(mentions: Vec<String>, query: String) -> String {
    let mention_list = mentions.join(", ");
    let query_excerpt: String = query.chars().take(800).collect();

    format!(
    "本地 RAG 预留通道已接收检索请求。\n提及对象：{}\n检索查询：{}\n后续可替换为 SQLite-vss 或 Chroma 向量召回结果。",
    mention_list, query_excerpt
  )
}

#[tauri::command]
fn mcp_search(query: String) -> Vec<String> {
    vec![format!(
        "MCP 预留通道已接收：{}。后续可连接 Obsidian / Notion MCP Server。",
        query
    )]
}

#[tauri::command]
async fn web_search(query: String) -> Result<Vec<WebSearchResult>, String> {
    let trimmed = query.trim();

    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::new();
    let url = format!(
        "https://duckduckgo.com/html/?q={}",
        urlencoding::encode(trimmed)
    );
    let html = client
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 Papyrus/0.1 web-search",
        )
        .send()
        .await
        .map_err(|error| format!("联网搜索失败：{}", error))?
        .text()
        .await
        .map_err(|error| format!("读取搜索结果失败：{}", error))?;

    let duckduckgo_results = parse_duckduckgo_results(&html);
    if !duckduckgo_results.is_empty() {
        return Ok(duckduckgo_results);
    }

    let bing_url = format!(
        "https://www.bing.com/search?q={}",
        urlencoding::encode(trimmed)
    );
    let bing_html = client
        .get(bing_url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 Papyrus/0.1 web-search",
        )
        .send()
        .await
        .map_err(|error| format!("web search failed: {}", error))?
        .text()
        .await
        .map_err(|error| format!("read search results failed: {}", error))?;

    Ok(parse_bing_results(&bing_html))
}

fn project_root() -> PathBuf {
    let current = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    if current.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        return current.parent().map(PathBuf::from).unwrap_or(current);
    }

    current
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{}", error))
}

fn memory_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("memory"))
}

struct MemoryStorageClearResult {
    bytes: u64,
    legacy_cleanup_pending: bool,
}

struct MemoryStorageUsage {
    bytes: u64,
    legacy_cleanup_pending: bool,
}

const MEMORY_CLEAR_STAGING_PREFIX: &str = ".memory-clear-";

fn clear_memory_storage(
    memory_dir: &Path,
    clear_ledger: impl FnOnce() -> Result<u64, secretary_ledger::LedgerError>,
) -> Result<MemoryStorageClearResult, String> {
    clear_memory_storage_with_staged_cleanup(memory_dir, clear_ledger, remove_staged_memory_entry)
}

fn remove_staged_memory_entry(path: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    let file_type = metadata.file_type();
    if file_type.is_dir() {
        fs::remove_dir_all(path)
    } else if file_type.is_file() || file_type.is_symlink() {
        fs::remove_file(path)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "unsupported staged memory entry",
        ))
    }
}

fn clear_memory_storage_with_staged_cleanup(
    memory_dir: &Path,
    clear_ledger: impl FnOnce() -> Result<u64, secretary_ledger::LedgerError>,
    remove_staged: impl Fn(&Path) -> std::io::Result<()>,
) -> Result<MemoryStorageClearResult, String> {
    let parent = memory_dir
        .parent()
        .ok_or_else(|| "清空本地记忆失败".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "清空本地记忆失败".to_string())?;
    retry_stale_memory_staging_cleanup(parent, &remove_staged)?;

    let staged_memory_dir = if memory_dir.exists() {
        let staged = parent.join(format!("{MEMORY_CLEAR_STAGING_PREFIX}{}", Uuid::new_v4()));
        fs::rename(memory_dir, &staged).map_err(|_| "隔离旧记忆失败".to_string())?;
        Some(staged)
    } else {
        None
    };
    let had_legacy_memory = staged_memory_dir.is_some();

    if fs::create_dir_all(memory_dir).is_err() {
        let restored = restore_staged_memory_directory(memory_dir, staged_memory_dir.as_deref());
        return Err(if restored && had_legacy_memory {
            "重建本地记忆失败，旧记忆已恢复".into()
        } else if restored {
            "重建本地记忆失败".into()
        } else {
            "重建本地记忆失败，旧记忆恢复失败".into()
        });
    }

    let ledger_bytes = match clear_ledger() {
        Ok(bytes) => bytes,
        Err(_) => {
            let restored =
                restore_staged_memory_directory(memory_dir, staged_memory_dir.as_deref());
            return Err(if restored && had_legacy_memory {
                "清空秘书账本失败，旧记忆已恢复".into()
            } else if restored {
                "清空秘书账本失败".into()
            } else {
                "清空失败，旧记忆恢复失败".into()
            });
        }
    };

    let legacy_cleanup_pending = staged_memory_dir
        .as_deref()
        .is_some_and(|staged| remove_staged(staged).is_err());
    let staged_bytes = if legacy_cleanup_pending {
        staged_memory_dir
            .as_deref()
            .map(storage_entry_size)
            .unwrap_or(0)
    } else {
        0
    };
    Ok(MemoryStorageClearResult {
        bytes: directory_size(memory_dir)
            .saturating_add(staged_bytes)
            .saturating_add(ledger_bytes),
        legacy_cleanup_pending,
    })
}

fn memory_storage_usage(memory_dir: &Path) -> Result<MemoryStorageUsage, String> {
    let parent = memory_dir
        .parent()
        .ok_or_else(|| "检查本地记忆状态失败".to_string())?;
    let staged_dirs = staged_memory_directories(parent)?;
    let staged_bytes = staged_dirs
        .iter()
        .map(|path| storage_entry_size(path))
        .sum();
    Ok(MemoryStorageUsage {
        bytes: directory_size(memory_dir).saturating_add(staged_bytes),
        legacy_cleanup_pending: !staged_dirs.is_empty(),
    })
}

fn retry_stale_memory_staging_cleanup(
    parent: &Path,
    remove_staged: &impl Fn(&Path) -> std::io::Result<()>,
) -> Result<(), String> {
    let staged_dirs = staged_memory_directories(parent)?;
    let mut cleanup_failed = false;
    for staged in staged_dirs {
        if remove_staged(&staged).is_err() {
            cleanup_failed = true;
        }
    }
    if cleanup_failed {
        Err("旧记忆仍待清理，请稍后重试".into())
    } else {
        Ok(())
    }
}

fn staged_memory_directories(parent: &Path) -> Result<Vec<PathBuf>, String> {
    if !parent.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(parent).map_err(|_| "检查本地记忆状态失败".to_string())?;
    let mut staged_dirs = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|_| "检查本地记忆状态失败".to_string())?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(MEMORY_CLEAR_STAGING_PREFIX)
        {
            staged_dirs.push(entry.path());
        }
    }
    staged_dirs.sort();
    Ok(staged_dirs)
}

fn storage_entry_size(path: &Path) -> u64 {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return 0;
    };
    if metadata.is_dir() {
        directory_size(path)
    } else if metadata.is_file() {
        metadata.len()
    } else {
        0
    }
}

fn restore_staged_memory_directory(memory_dir: &Path, staged_memory_dir: Option<&Path>) -> bool {
    if memory_dir.exists() && fs::remove_dir_all(memory_dir).is_err() {
        return false;
    }
    staged_memory_dir
        .map(|staged| fs::rename(staged, memory_dir).is_ok())
        .unwrap_or(true)
}

fn read_optional_file(path: PathBuf) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

fn directory_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };

    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                return 0;
            };

            if metadata.is_dir() {
                directory_size(&path)
            } else {
                metadata.len()
            }
        })
        .sum()
}

#[cfg(test)]
mod security_tests {
    use super::*;
    use std::fs;

    #[test]
    fn maintenance_status_serializes_clear_commitment_in_camel_case_only_when_known() {
        let committed = MaintenanceStatus {
            status: "warning".into(),
            message: "ledger clear committed".into(),
            latency_ms: None,
            bytes: Some(12),
            clear_committed: Some(true),
        };
        let uncommitted = MaintenanceStatus {
            status: "error".into(),
            message: "ledger clear did not commit".into(),
            latency_ms: None,
            bytes: None,
            clear_committed: None,
        };

        let committed_payload = serde_json::to_value(committed).unwrap();
        let uncommitted_payload = serde_json::to_value(uncommitted).unwrap();

        assert_eq!(committed_payload["clearCommitted"], true);
        assert!(uncommitted_payload.get("clearCommitted").is_none());
    }

    #[test]
    fn clear_memory_storage_restores_legacy_memory_when_ledger_clear_fails() {
        let root = std::env::temp_dir().join(format!(
            "papyrus-clear-memory-test-{}",
            uuid::Uuid::new_v4()
        ));
        let memory_dir = root.join("memory");
        fs::create_dir_all(&memory_dir).unwrap();
        fs::write(memory_dir.join("legacy-memory.json"), "old memory").unwrap();

        let result = clear_memory_storage(&memory_dir, || {
            Err(secretary_ledger::LedgerError::Unavailable)
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(memory_dir.join("legacy-memory.json")).unwrap(),
            "old memory"
        );
        assert!(fs::read_dir(&root).unwrap().flatten().all(|entry| !entry
            .file_name()
            .to_string_lossy()
            .starts_with(".memory-clear-")));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clear_memory_storage_does_not_claim_to_restore_absent_legacy_memory() {
        let root = std::env::temp_dir().join(format!(
            "papyrus-clear-empty-memory-test-{}",
            uuid::Uuid::new_v4()
        ));
        let memory_dir = root.join("memory");

        let error = match clear_memory_storage(&memory_dir, || {
            Err(secretary_ledger::LedgerError::Unavailable)
        }) {
            Err(error) => error,
            Ok(_) => panic!("ledger clear failure must not report success"),
        };

        assert_eq!(error, "清空秘书账本失败");
        assert!(!memory_dir.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_stale_memory_staging_blocks_a_new_clear_without_hiding_old_data() {
        let root = std::env::temp_dir().join(format!(
            "papyrus-stale-memory-clear-test-{}",
            uuid::Uuid::new_v4()
        ));
        let memory_dir = root.join("memory");
        let stale_dir = root.join(".memory-clear-stale");
        fs::create_dir_all(&memory_dir).unwrap();
        fs::create_dir_all(&stale_dir).unwrap();
        fs::write(memory_dir.join("current-memory.json"), "current memory").unwrap();
        fs::write(stale_dir.join("legacy-memory.json"), "old staged memory").unwrap();
        let ledger_clears = std::cell::Cell::new(0);

        let usage = memory_storage_usage(&memory_dir).unwrap();
        assert!(usage.legacy_cleanup_pending);
        assert_eq!(
            usage.bytes,
            ("current memory".len() + "old staged memory".len()) as u64
        );

        let error = match clear_memory_storage_with_staged_cleanup(
            &memory_dir,
            || {
                ledger_clears.set(ledger_clears.get() + 1);
                Ok(0)
            },
            |_| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
        ) {
            Err(error) => error,
            Ok(_) => panic!("a stale staged memory directory must block a new clear"),
        };

        assert_eq!(error, "旧记忆仍待清理，请稍后重试");
        assert!(!error.contains(root.to_string_lossy().as_ref()));
        assert_eq!(ledger_clears.get(), 0);
        assert_eq!(
            fs::read_to_string(memory_dir.join("current-memory.json")).unwrap(),
            "current memory"
        );
        assert_eq!(
            fs::read_to_string(stale_dir.join("legacy-memory.json")).unwrap(),
            "old staged memory"
        );

        let retry = clear_memory_storage(&memory_dir, || {
            ledger_clears.set(ledger_clears.get() + 1);
            Ok(0)
        })
        .unwrap();
        assert!(!retry.legacy_cleanup_pending);
        assert_eq!(ledger_clears.get(), 1);
        assert!(staged_memory_directories(&root).unwrap().is_empty());
        assert!(!memory_dir.join("current-memory.json").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_regular_memory_clear_file_is_removed_before_a_new_clear() {
        let root = std::env::temp_dir().join(format!(
            "papyrus-stale-memory-clear-file-test-{}",
            uuid::Uuid::new_v4()
        ));
        let memory_dir = root.join("memory");
        let stale_file = root.join(".memory-clear-stale-file");
        fs::create_dir_all(&memory_dir).unwrap();
        fs::write(memory_dir.join("current-memory.json"), "current memory").unwrap();
        fs::write(&stale_file, "stale clear marker").unwrap();
        let ledger_clears = std::cell::Cell::new(0);

        let usage = memory_storage_usage(&memory_dir).unwrap();
        assert!(usage.legacy_cleanup_pending);
        assert_eq!(
            usage.bytes,
            ("current memory".len() + "stale clear marker".len()) as u64
        );

        let result = clear_memory_storage(&memory_dir, || {
            ledger_clears.set(ledger_clears.get() + 1);
            Ok(0)
        })
        .unwrap();

        assert_eq!(ledger_clears.get(), 1);
        assert!(!result.legacy_cleanup_pending);
        assert!(!stale_file.exists());
        assert!(staged_memory_directories(&root).unwrap().is_empty());
        assert!(!memory_dir.join("current-memory.json").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn staged_memory_symlink_is_removed_without_following_its_target() {
        let root = std::env::temp_dir().join(format!(
            "papyrus-staged-memory-symlink-test-{}",
            uuid::Uuid::new_v4()
        ));
        let target = root.join("target");
        let staged_symlink = root.join(".memory-clear-staged-symlink");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("keep.txt"), "target data").unwrap();

        #[cfg(unix)]
        let link_result = std::os::unix::fs::symlink(&target, &staged_symlink);
        #[cfg(windows)]
        let link_result = std::os::windows::fs::symlink_dir(&target, &staged_symlink);

        if let Err(error) = link_result {
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || error.raw_os_error() == Some(1314)
            {
                fs::remove_dir_all(root).unwrap();
                return;
            }
            panic!("failed to create staged memory symlink: {error}");
        }

        remove_staged_memory_entry(&staged_symlink).unwrap();

        assert!(fs::symlink_metadata(&staged_symlink).is_err());
        assert_eq!(
            fs::read_to_string(target.join("keep.txt")).unwrap(),
            "target data"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn staged_memory_cleanup_treats_symlinks_as_leaf_entries() {
        let source = include_str!("lib.rs");
        let cleanup_start = source
            .find("fn remove_staged_memory_entry")
            .expect("staged memory cleanup helper must exist");
        let cleanup_end = cleanup_start
            + source[cleanup_start..]
                .find("\nfn clear_memory_storage_with_staged_cleanup")
                .expect("staged memory cleanup helper must end before the clear workflow");
        let cleanup = &source[cleanup_start..cleanup_end];

        assert!(cleanup.contains("fs::symlink_metadata(path)"));
        assert!(cleanup.contains("let file_type = metadata.file_type();"));
        assert!(cleanup.contains("file_type.is_symlink()"));
        assert!(cleanup.contains("fs::remove_file(path)"));
        assert!(cleanup.contains("std::io::ErrorKind::InvalidInput"));
    }

    #[cfg(unix)]
    #[test]
    fn staged_memory_cleanup_rejects_unsupported_entry_kinds() {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};

        let root = std::env::temp_dir().join(format!(
            "papyrus-staged-memory-unsupported-test-{}",
            uuid::Uuid::new_v4()
        ));
        let staged_fifo = root.join(".memory-clear-staged-fifo");
        fs::create_dir_all(&root).unwrap();
        let fifo_path = CString::new(staged_fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) }, 0);

        let error = remove_staged_memory_entry(&staged_fifo).unwrap_err();

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        fs::remove_file(staged_fifo).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn post_commit_staging_cleanup_failure_remains_reported_until_a_successful_retry() {
        let root = std::env::temp_dir().join(format!(
            "papyrus-post-commit-memory-clear-test-{}",
            uuid::Uuid::new_v4()
        ));
        let memory_dir = root.join("memory");
        fs::create_dir_all(&memory_dir).unwrap();
        fs::write(memory_dir.join("legacy-memory.json"), "old staged memory").unwrap();
        let staged_bytes = "old staged memory".len() as u64;
        let first_ledger_clear = std::cell::Cell::new(0);

        let first = clear_memory_storage_with_staged_cleanup(
            &memory_dir,
            || {
                first_ledger_clear.set(first_ledger_clear.get() + 1);
                Ok(17)
            },
            |_| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
        )
        .unwrap();
        assert_eq!(first_ledger_clear.get(), 1);
        assert!(first.legacy_cleanup_pending);
        assert_eq!(first.bytes, staged_bytes + 17);

        let usage = memory_storage_usage(&memory_dir).unwrap();
        assert!(usage.legacy_cleanup_pending);
        assert_eq!(usage.bytes, staged_bytes);

        let blocked_ledger_clear = std::cell::Cell::new(0);
        let error = match clear_memory_storage_with_staged_cleanup(
            &memory_dir,
            || {
                blocked_ledger_clear.set(blocked_ledger_clear.get() + 1);
                Ok(0)
            },
            |_| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
        ) {
            Err(error) => error,
            Ok(_) => panic!("a pending staged directory must block a later clear"),
        };
        assert_eq!(error, "旧记忆仍待清理，请稍后重试");
        assert!(!error.contains(root.to_string_lossy().as_ref()));
        assert_eq!(blocked_ledger_clear.get(), 0);

        let retried_ledger_clear = std::cell::Cell::new(0);
        let retry = clear_memory_storage(&memory_dir, || {
            retried_ledger_clear.set(retried_ledger_clear.get() + 1);
            Ok(0)
        })
        .unwrap();
        assert_eq!(retried_ledger_clear.get(), 1);
        assert!(!retry.legacy_cleanup_pending);
        assert_eq!(retry.bytes, 0);
        let usage = memory_storage_usage(&memory_dir).unwrap();
        assert!(!usage.legacy_cleanup_pending);
        assert_eq!(usage.bytes, 0);
        assert!(staged_memory_directories(&root).unwrap().is_empty());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invoke_handler_exposes_only_approved_commands() {
        let source = include_str!("lib.rs");
        let handler_start = source
            .find(".invoke_handler(")
            .expect("invoke handler must be declared");
        let macro_start = handler_start
            + source[handler_start..]
                .find("generate_handler!")
                .expect("invoke handler must use generate_handler!");
        let commands_start = macro_start
            + source[macro_start..]
                .find('[')
                .expect("generate_handler! must open a command list")
            + 1;
        let commands_end = commands_start
            + source[commands_start..]
                .find(']')
                .expect("generate_handler! must close its command list");
        let handler = &source[commands_start..commands_end];

        let registered_commands = handler
            .split(',')
            .map(str::trim)
            .filter(|command| !command.is_empty())
            .collect::<Vec<_>>();

        assert_eq!(
            registered_commands,
            [
                "rag_query",
                "mcp_search",
                "read_project_guidance",
                "web_search",
                "health_check_backend",
                "check_sqlite_status",
                "get_memory_usage",
                "clear_global_memory",
                "rebuild_project_index",
                "test_model_connection",
                "llm_chat",
                "open_external_url",
                "secretary_ledger::secretary_ledger_bootstrap",
                "secretary_ledger::secretary_ledger_health",
                "secretary_ledger::secretary_ledger_create_project",
                "secretary_ledger::secretary_ledger_list_projects",
                "secretary_ledger::secretary_ledger_create_memory",
                "secretary_ledger::secretary_ledger_get_memory",
                "secretary_ledger::secretary_ledger_list_memories",
                "secretary_ledger::secretary_ledger_update_memory",
                "secretary_ledger::secretary_ledger_rollback_memory",
                "secretary_ledger::secretary_ledger_delete_memory",
                "secretary_ledger::secretary_ledger_search",
                "secretary_ledger::secretary_ledger_create_task",
                "secretary_ledger::secretary_ledger_get_task",
                "secretary_ledger::secretary_ledger_list_tasks",
                "secretary_ledger::secretary_ledger_update_task",
                "secretary_ledger::secretary_ledger_delete_task",
                "secretary_ledger::secretary_ledger_record_event",
                "secretary_ledger::secretary_ledger_list_events",
                "secretary_ledger::secretary_ledger_save_checkpoint",
                "secretary_ledger::secretary_ledger_load_latest_checkpoint",
                "secretary_ledger::secretary_ledger_import_legacy_batch",
                "work_assistant::work_assistant_capabilities",
                "work_assistant::work_assistant_list_roots",
                "work_assistant::work_assistant_add_root",
                "work_assistant::work_assistant_remove_root",
                "work_assistant::work_assistant_workspace_list",
                "work_assistant::work_assistant_workspace_scan",
                "work_assistant::work_assistant_file_search",
                "work_assistant::work_assistant_file_inspect",
                "work_assistant::work_assistant_downloads_scan",
                "work_assistant::work_assistant_list_audit",
                "work_assistant::work_assistant_clear_audit",
                "work_assistant::work_assistant_desktop_status",
                "work_assistant::work_assistant_desktop_open_url",
                "work_assistant::work_assistant_desktop_open_file",
                "work_assistant::work_assistant_desktop_reveal_file",
                "work_assistant::work_assistant_validate_application_selection",
                "work_assistant::work_assistant_list_applications",
                "work_assistant::work_assistant_register_application_from_picker",
                "work_assistant::work_assistant_remove_application",
                "work_assistant::work_assistant_launch_application",
                "work_assistant::work_assistant_cancel_run",
                "work_assistant::work_assistant_preview",
                "work_assistant::work_assistant_approve",
                "work_assistant::work_assistant_execute",
                "work_assistant::work_assistant_doctor",
                "work_assistant::browser_bridge_status",
                "work_assistant::browser_bridge_start_pairing",
                "work_assistant::browser_bridge_pair",
                "work_assistant::browser_bridge_disconnect",
                "work_assistant::browser_open",
                "work_assistant::browser_snapshot",
                "work_assistant::browser_fill_draft",
                "work_assistant::browser_click",
                "work_assistant::browser_download",
                "work_assistant::browser_submit",
                "work_assistant::web_extract",
                "work_assistant::work_assistant_browser_status",
                "work_assistant::work_assistant_browser_start_pairing",
                "work_assistant::work_assistant_browser_disconnect",
                "work_assistant::work_assistant_browser_preview_action",
                "work_assistant::work_assistant_browser_approve_action",
                "work_assistant::work_assistant_browser_reject_action",
                "work_assistant::work_assistant_browser_cancel_run",
                "work_assistant::work_assistant_browser_snapshot",
                "work_assistant::work_assistant_browser_execute_action",
                "work_assistant::work_assistant_web_extract",
            ]
        );
    }

    #[test]
    fn invoke_handler_registers_the_bounded_secretary_ledger_surface() {
        let source = include_str!("lib.rs");
        let handler_start = source
            .find(".invoke_handler(")
            .expect("invoke handler must be declared");
        let macro_start = handler_start
            + source[handler_start..]
                .find("generate_handler!")
                .expect("invoke handler must use generate_handler!");
        let commands_start = macro_start
            + source[macro_start..]
                .find('[')
                .expect("generate_handler! must open a command list")
            + 1;
        let commands_end = commands_start
            + source[commands_start..]
                .find(']')
                .expect("generate_handler! must close its command list");
        let handler = &source[commands_start..commands_end];

        for command in [
            "secretary_ledger::secretary_ledger_bootstrap",
            "secretary_ledger::secretary_ledger_create_project",
            "secretary_ledger::secretary_ledger_create_memory",
            "secretary_ledger::secretary_ledger_search",
            "secretary_ledger::secretary_ledger_create_task",
            "secretary_ledger::secretary_ledger_record_event",
            "secretary_ledger::secretary_ledger_save_checkpoint",
            "secretary_ledger::secretary_ledger_import_legacy_batch",
        ] {
            assert!(
                handler.contains(command),
                "missing bounded command: {command}"
            );
        }
    }

    #[test]
    fn native_llm_request_body_keeps_sampling_penalties() {
        let request = LlmChatRequest {
            base_url: "https://example.test/v1".into(),
            model_name: "papyrus-test".into(),
            api_key: "test-key".into(),
            provider_type: "vendor_key".into(),
            messages: vec![LlmChatMessage {
                role: "user".into(),
                content: "test".into(),
            }],
            temperature: 0.31,
            max_tokens: 1234,
            frequency_penalty: Some(0.48),
            presence_penalty: Some(0.22),
        };

        let body = llm_request_body(&request);

        assert!(
            (body["frequency_penalty"].as_f64().unwrap() - 0.48).abs() < 0.000_001,
            "frequency penalty must reach the native request body"
        );
        assert!(
            (body["presence_penalty"].as_f64().unwrap() - 0.22).abs() < 0.000_001,
            "presence penalty must reach the native request body"
        );

        let without_penalties = LlmChatRequest {
            base_url: "https://example.test/v1".into(),
            model_name: "papyrus-test".into(),
            api_key: "test-key".into(),
            provider_type: "vendor_key".into(),
            messages: Vec::new(),
            temperature: 0.28,
            max_tokens: 512,
            frequency_penalty: None,
            presence_penalty: None,
        };
        let body_without_penalties = llm_request_body(&without_penalties);

        assert!(body_without_penalties.get("frequency_penalty").is_none());
        assert!(body_without_penalties.get("presence_penalty").is_none());
    }
}

fn parse_duckduckgo_results(html: &str) -> Vec<WebSearchResult> {
    let document = Html::parse_document(html);
    let result_selector = Selector::parse(".result").expect("valid selector");
    let title_selector = Selector::parse(".result__a").expect("valid selector");
    let excerpt_selector = Selector::parse(".result__snippet").expect("valid selector");

    document
        .select(&result_selector)
        .filter_map(|result| {
            let title_node = result.select(&title_selector).next()?;
            let title = title_node
                .text()
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string();
            let url = title_node.value().attr("href").unwrap_or("").to_string();
            let excerpt = result
                .select(&excerpt_selector)
                .next()
                .map(|node| node.text().collect::<Vec<_>>().join(" ").trim().to_string())
                .unwrap_or_default();

            if title.is_empty() {
                return None;
            }

            Some(WebSearchResult {
                title,
                url,
                excerpt,
            })
        })
        .take(5)
        .collect()
}

fn parse_bing_results(html: &str) -> Vec<WebSearchResult> {
    let document = Html::parse_document(html);
    let result_selector = Selector::parse("li.b_algo").expect("valid selector");
    let title_selector = Selector::parse("h2 a").expect("valid selector");
    let excerpt_selector = Selector::parse(".b_caption p").expect("valid selector");

    document
        .select(&result_selector)
        .filter_map(|result| {
            let title_node = result.select(&title_selector).next()?;
            let title = title_node
                .text()
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string();
            let url = title_node.value().attr("href").unwrap_or("").to_string();
            let excerpt = result
                .select(&excerpt_selector)
                .next()
                .map(|node| node.text().collect::<Vec<_>>().join(" ").trim().to_string())
                .unwrap_or_default();

            if title.is_empty() || url.is_empty() {
                return None;
            }

            Some(WebSearchResult {
                title,
                url,
                excerpt,
            })
        })
        .take(5)
        .collect()
}
