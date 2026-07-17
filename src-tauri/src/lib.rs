use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::Manager;

pub mod secretary_ledger;
mod update_protection;
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
            secretary_ledger::secretary_ledger_start_task,
            secretary_ledger::secretary_ledger_claim_task,
            secretary_ledger::secretary_ledger_persist_task_progress,
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
            work_assistant::work_assistant_browser_snapshot,
            work_assistant::work_assistant_browser_execute_action,
            work_assistant::work_assistant_web_extract,
            update_protection::prepare_update_snapshot,
            update_protection::verify_update_snapshot,
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
    #[serde(default)]
    routing_mode: Option<String>,
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
    #[serde(default)]
    routing_mode: Option<String>,
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
      "routing_mode": request.routing_mode,
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
        .body(
            json!({
              "model": model_name,
              "routing_mode": request.routing_mode,
              "messages": request.messages,
              "temperature": request.temperature,
              "max_tokens": request.max_tokens,
              "stream": false
            })
            .to_string(),
        )
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
        let staged = parent.join(format!(
            "{MEMORY_CLEAR_STAGING_PREFIX}{}",
            uuid::Uuid::new_v4()
        ));
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
        bytes: directory_size(&memory_dir.to_path_buf())
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
        bytes: directory_size(&memory_dir.to_path_buf()).saturating_add(staged_bytes),
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

fn restore_staged_memory_directory(memory_dir: &Path, staged: Option<&Path>) -> bool {
    let Some(staged) = staged else { return true };
    let _ = fs::remove_dir_all(memory_dir);
    fs::rename(staged, memory_dir).is_ok()
}

fn staged_memory_directories(parent: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(parent).map_err(|_| "检查本地记忆状态失败".to_string())?;
    Ok(entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(MEMORY_CLEAR_STAGING_PREFIX))
        })
        .collect())
}

fn storage_entry_size(path: &Path) -> u64 {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.is_dir() {
            return fs::read_dir(path)
                .map(|entries| {
                    entries
                        .flatten()
                        .map(|entry| storage_entry_size(&entry.path()))
                        .sum()
                })
                .unwrap_or(0);
        }
        return metadata.len();
    }
    0
}

fn read_optional_file(path: PathBuf) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

fn directory_size(path: &PathBuf) -> u64 {
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
                "secretary_ledger::secretary_ledger_start_task",
                "secretary_ledger::secretary_ledger_claim_task",
                "secretary_ledger::secretary_ledger_persist_task_progress",
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
                "work_assistant::work_assistant_browser_snapshot",
                "work_assistant::work_assistant_browser_execute_action",
                "work_assistant::work_assistant_web_extract",
                "update_protection::prepare_update_snapshot",
                "update_protection::verify_update_snapshot",
            ]
        );
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
