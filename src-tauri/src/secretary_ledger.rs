use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    fmt, fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use uuid::Uuid;

pub const SECRETARY_LEDGER_SCHEMA_VERSION: i64 = 5;
const LEGACY_PROJECT_ID: &str = "__papyrus_legacy__";

#[derive(Clone, Debug)]
pub struct SecretaryLedger {
    path: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerHealth {
    pub status: String,
    pub schema_version: i64,
    pub fts_available: bool,
    pub bytes: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretaryProject {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub story_project_id: Option<String>,
    pub chat_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub id: Option<String>,
    pub title: String,
    pub kind: String,
    pub story_project_id: Option<String>,
    pub chat_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryScope {
    Personal,
    Project,
}

impl MemoryScope {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Personal => "personal",
            Self::Project => "project",
        }
    }

    fn from_database(value: String) -> rusqlite::Result<Self> {
        match value.as_str() {
            "personal" => Ok(Self::Personal),
            "project" => Ok(Self::Project),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretaryMemory {
    pub id: String,
    pub scope: MemoryScope,
    pub project_id: Option<String>,
    pub kind: String,
    pub content: String,
    pub source: String,
    pub confidence: f64,
    pub status: String,
    pub revision: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoryInput {
    pub id: Option<String>,
    pub scope: MemoryScope,
    pub project_id: Option<String>,
    pub kind: String,
    pub content: String,
    pub source: String,
    pub confidence: f64,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoryInput {
    pub kind: Option<String>,
    pub content: Option<String>,
    pub source: Option<String>,
    pub confidence: Option<f64>,
    pub status: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchInput {
    pub query: String,
    pub current_project_id: String,
    pub include_cross_project: bool,
    pub limit: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub entity_type: String,
    pub project_id: Option<String>,
    pub project_title: Option<String>,
    pub title: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretaryTask {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub request: String,
    pub status: String,
    pub priority: i64,
    pub schedule_at: Option<i64>,
    pub next_step: Option<String>,
    pub public_plan: Option<String>,
    pub summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub id: Option<String>,
    pub project_id: String,
    pub title: String,
    pub request: String,
    pub status: Option<String>,
    pub priority: Option<i64>,
    pub schedule_at: Option<i64>,
    pub next_step: Option<String>,
    pub public_plan: Option<String>,
    pub summary: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub title: Option<String>,
    pub request: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i64>,
    pub schedule_at: Option<i64>,
    pub next_step: Option<String>,
    pub public_plan: Option<String>,
    pub summary: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub task_id: String,
    pub sequence: i64,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub created_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordEventInput {
    pub event_type: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretaryCheckpoint {
    pub task_id: String,
    pub sequence: i64,
    pub context_snapshot: serde_json::Value,
    pub next_step: String,
    pub created_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCheckpointInput {
    pub context_snapshot: serde_json::Value,
    pub next_step: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyProjectInput {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub story_project_id: Option<String>,
    pub chat_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMemoryInput {
    pub id: Option<String>,
    pub scope: MemoryScope,
    pub project_id: Option<String>,
    pub kind: String,
    pub content: String,
    pub source: String,
    pub confidence: f64,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyTaskInput {
    pub id: Option<String>,
    pub project_id: Option<String>,
    pub title: String,
    pub request: String,
    pub status: Option<String>,
    pub priority: Option<i64>,
    pub schedule_at: Option<i64>,
    pub next_step: Option<String>,
    pub public_plan: Option<String>,
    pub summary: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportBatch {
    pub migration_key: String,
    pub projects: Vec<LegacyProjectInput>,
    pub memories: Vec<LegacyMemoryInput>,
    pub tasks: Vec<LegacyTaskInput>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportResult {
    pub imported: bool,
    pub projects_imported: u32,
    pub memories_imported: u32,
    pub tasks_imported: u32,
}

#[derive(Debug)]
pub enum LedgerError {
    InvalidInput,
    Unavailable,
}

impl LedgerError {
    pub fn safe_message(&self) -> &'static str {
        match self {
            Self::InvalidInput => "秘书账本输入无效",
            Self::Unavailable => "秘书账本暂不可用",
        }
    }
}

impl fmt::Display for LedgerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.safe_message())
    }
}

impl Error for LedgerError {}

impl From<rusqlite::Error> for LedgerError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Unavailable
    }
}

impl From<std::io::Error> for LedgerError {
    fn from(_: std::io::Error) -> Self {
        Self::Unavailable
    }
}

impl SecretaryLedger {
    pub fn open_for_app(app: &tauri::AppHandle) -> Result<Self, LedgerError> {
        let data_directory = app
            .path()
            .app_data_dir()
            .map_err(|_| LedgerError::Unavailable)?;
        Self::open_at(data_directory.join("papyrus-secretary.sqlite3"))
    }

    pub fn open_at(path: impl AsRef<Path>) -> Result<Self, LedgerError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let ledger = Self { path };
        let mut connection = ledger.connection()?;
        apply_migrations(&mut connection)?;
        Ok(ledger)
    }

    pub fn health(&self) -> Result<LedgerHealth, LedgerError> {
        let connection = self.connection()?;
        let schema_version = connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM secretary_schema_migrations",
            [],
            |row| row.get(0),
        )?;
        connection.query_row("SELECT COUNT(*) FROM secretary_fts", [], |_| Ok(()))?;

        Ok(LedgerHealth {
            status: "ok".into(),
            schema_version,
            fts_available: true,
            bytes: ledger_file_size(&self.path),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn create_project(
        &self,
        input: CreateProjectInput,
    ) -> Result<SecretaryProject, LedgerError> {
        let id = normalize_identifier(input.id.unwrap_or_else(|| Uuid::new_v4().to_string()))?;
        let title = normalize_text(input.title, 240)?;
        let kind = normalize_text(input.kind, 64)?;
        let story_project_id = normalize_optional_text(input.story_project_id, 128)?;
        let chat_id = normalize_optional_text(input.chat_id, 128)?;
        let now = unix_millis();
        let project = SecretaryProject {
            id,
            title,
            kind,
            story_project_id,
            chat_id,
            created_at: now,
            updated_at: now,
            archived: false,
        };
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "
            INSERT INTO secretary_projects(
                id, title, kind, story_project_id, chat_id, created_at, updated_at, archived
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
            ",
            params![
                project.id,
                project.title,
                project.kind,
                project.story_project_id,
                project.chat_id,
                project.created_at,
                project.updated_at,
            ],
        )?;
        transaction.commit()?;
        Ok(project)
    }

    pub fn list_projects(
        &self,
        include_archived: bool,
    ) -> Result<Vec<SecretaryProject>, LedgerError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "
            SELECT id, title, kind, story_project_id, chat_id, created_at, updated_at, archived
            FROM secretary_projects
            WHERE (?1 = 1 OR archived = 0)
            ORDER BY updated_at DESC, id ASC
            ",
        )?;
        let projects = statement
            .query_map(
                params![if include_archived { 1 } else { 0 }],
                project_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(projects)
    }

    pub fn create_memory(&self, input: CreateMemoryInput) -> Result<SecretaryMemory, LedgerError> {
        let memory = normalized_new_memory(input)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        ensure_memory_owner(&transaction, &memory, false)?;
        insert_memory(&transaction, &memory)?;
        transaction.commit()?;
        Ok(memory)
    }

    pub fn get_memory(&self, id: &str) -> Result<Option<SecretaryMemory>, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let connection = self.connection()?;
        find_memory(&connection, &id)
    }

    pub fn list_memories(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<SecretaryMemory>, LedgerError> {
        let project_id = project_id
            .map(|value| normalize_identifier(value.to_string()))
            .transpose()?
            .unwrap_or_default();
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "
            SELECT id, scope, project_id, kind, content, source, confidence, status,
                   revision, created_at, updated_at
            FROM secretary_memories
            WHERE (?1 = '' OR project_id IS NULL OR project_id = ?1)
              AND (project_id IS NULL OR project_id != ?2)
            ORDER BY updated_at DESC, id ASC
            ",
        )?;
        let memories = statement
            .query_map(params![project_id, LEGACY_PROJECT_ID], memory_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(memories)
    }

    pub fn update_memory(
        &self,
        id: &str,
        input: UpdateMemoryInput,
    ) -> Result<SecretaryMemory, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let existing =
            find_memory_in_transaction(&transaction, &id)?.ok_or(LedgerError::InvalidInput)?;
        let updated = SecretaryMemory {
            id,
            scope: existing.scope,
            project_id: existing.project_id,
            kind: input
                .kind
                .map(|value| normalize_safe_text(value, 64))
                .transpose()?
                .unwrap_or(existing.kind),
            content: input
                .content
                .map(|value| normalize_safe_text(value, 16_000))
                .transpose()?
                .unwrap_or(existing.content),
            source: input
                .source
                .map(|value| normalize_safe_text(value, 96))
                .transpose()?
                .unwrap_or(existing.source),
            confidence: input.confidence.unwrap_or(existing.confidence),
            status: input
                .status
                .map(|value| normalize_safe_text(value, 32))
                .transpose()?
                .unwrap_or(existing.status),
            revision: existing.revision + 1,
            created_at: existing.created_at,
            updated_at: unix_millis(),
        };
        validate_confidence(updated.confidence)?;
        update_memory_record(&transaction, &updated)?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn rollback_memory(&self, id: &str, revision: i64) -> Result<SecretaryMemory, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        if revision < 1 {
            return Err(LedgerError::InvalidInput);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let existing =
            find_memory_in_transaction(&transaction, &id)?.ok_or(LedgerError::InvalidInput)?;
        let prior = transaction
            .query_row(
                "
                SELECT kind, content, source, confidence, status
                FROM secretary_memory_revisions
                WHERE memory_id = ?1 AND revision = ?2
                ",
                params![id, revision],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, f64>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?
            .ok_or(LedgerError::InvalidInput)?;
        let restored = SecretaryMemory {
            id,
            scope: existing.scope,
            project_id: existing.project_id,
            kind: prior.0,
            content: prior.1,
            source: prior.2,
            confidence: prior.3,
            status: prior.4,
            revision: existing.revision + 1,
            created_at: existing.created_at,
            updated_at: unix_millis(),
        };
        update_memory_record(&transaction, &restored)?;
        transaction.commit()?;
        Ok(restored)
    }

    pub fn delete_memory(&self, id: &str) -> Result<(), LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM secretary_fts WHERE entity_type = 'memory' AND record_id = ?1",
            params![id],
        )?;
        let deleted =
            transaction.execute("DELETE FROM secretary_memories WHERE id = ?1", params![id])?;
        if deleted != 1 {
            return Err(LedgerError::InvalidInput);
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn search(&self, input: SearchInput) -> Result<Vec<SearchResult>, LedgerError> {
        let current_project_id = normalize_identifier(input.current_project_id)?;
        let query = build_fts_query(&input.query)?;
        let limit = i64::from(input.limit.clamp(1, 100));
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "
            SELECT f.record_id, f.entity_type, f.project_id, p.title, f.title, f.content
            FROM secretary_fts AS f
            LEFT JOIN secretary_projects AS p ON p.id = f.project_id
            WHERE secretary_fts MATCH ?1
              AND f.project_id != ?2
              AND (
                    f.project_id = ''
                    OR f.project_id = ?3
                    OR (?4 = 1 AND f.project_id != ?2)
              )
            ORDER BY bm25(secretary_fts), f.rowid DESC
            LIMIT ?5
            ",
        )?;
        let rows = statement
            .query_map(
                params![
                    query,
                    LEGACY_PROJECT_ID,
                    current_project_id,
                    if input.include_cross_project { 1 } else { 0 },
                    limit,
                ],
                |row| {
                    let project_id = row.get::<_, String>(2)?;
                    let project_title = row.get::<_, Option<String>>(3)?;
                    Ok(SearchResult {
                        id: row.get(0)?,
                        entity_type: row.get(1)?,
                        project_id: (!project_id.is_empty()).then_some(project_id.clone()),
                        project_title: if project_id.is_empty() {
                            Some("个人偏好".into())
                        } else {
                            project_title
                        },
                        title: row.get(4)?,
                        content: row.get(5)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_task(&self, input: CreateTaskInput) -> Result<SecretaryTask, LedgerError> {
        let task = normalized_new_task(input)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        ensure_task_project(&transaction, &task.project_id, false)?;
        insert_task(&transaction, &task)?;
        transaction.commit()?;
        Ok(task)
    }

    pub fn get_task(&self, id: &str) -> Result<Option<SecretaryTask>, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let connection = self.connection()?;
        find_task(&connection, &id)
    }

    pub fn list_tasks(
        &self,
        project_id: &str,
        limit: u32,
    ) -> Result<Vec<SecretaryTask>, LedgerError> {
        let project_id = normalize_identifier(project_id.to_string())?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "
            SELECT id, project_id, title, request, status, priority, schedule_at, next_step,
                   public_plan, summary, created_at, updated_at
            FROM secretary_tasks
            WHERE project_id = ?1
            ORDER BY updated_at DESC, id ASC
            LIMIT ?2
            ",
        )?;
        let tasks = statement
            .query_map(
                params![project_id, i64::from(limit.clamp(1, 100))],
                task_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    pub fn update_task(
        &self,
        id: &str,
        input: UpdateTaskInput,
    ) -> Result<SecretaryTask, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let existing =
            find_task_in_transaction(&transaction, &id)?.ok_or(LedgerError::InvalidInput)?;
        let task = SecretaryTask {
            id,
            project_id: existing.project_id,
            title: input
                .title
                .map(|value| normalize_safe_text(value, 240))
                .transpose()?
                .unwrap_or(existing.title),
            request: input
                .request
                .map(|value| normalize_safe_text(value, 16_000))
                .transpose()?
                .unwrap_or(existing.request),
            status: input
                .status
                .map(normalize_task_status)
                .transpose()?
                .unwrap_or(existing.status),
            priority: input.priority.unwrap_or(existing.priority),
            schedule_at: input.schedule_at.or(existing.schedule_at),
            next_step: input
                .next_step
                .map(|value| normalize_safe_text(value, 4_000))
                .transpose()?
                .or(existing.next_step),
            public_plan: input
                .public_plan
                .map(|value| normalize_safe_text(value, 16_000))
                .transpose()?
                .or(existing.public_plan),
            summary: input
                .summary
                .map(|value| normalize_safe_text(value, 4_000))
                .transpose()?
                .or(existing.summary),
            created_at: existing.created_at,
            updated_at: unix_millis(),
        };
        validate_priority(task.priority)?;
        update_task_record(&transaction, &task)?;
        transaction.commit()?;
        Ok(task)
    }

    pub fn delete_task(&self, id: &str) -> Result<(), LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "
            DELETE FROM secretary_fts
            WHERE (entity_type = 'task' AND record_id = ?1)
               OR (entity_type = 'event' AND record_id GLOB ?2)
               OR (entity_type = 'checkpoint' AND record_id GLOB ?3)
            ",
            params![id, format!("event:{id}:*"), format!("checkpoint:{id}:*"),],
        )?;
        let deleted =
            transaction.execute("DELETE FROM secretary_tasks WHERE id = ?1", params![id])?;
        if deleted != 1 {
            return Err(LedgerError::InvalidInput);
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn record_event(
        &self,
        task_id: &str,
        input: RecordEventInput,
    ) -> Result<TaskEvent, LedgerError> {
        let task_id = normalize_identifier(task_id.to_string())?;
        let event_type = normalize_safe_text(input.event_type, 64)?;
        let payload = normalize_safe_json(input.payload, 16_000)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let task =
            find_task_in_transaction(&transaction, &task_id)?.ok_or(LedgerError::InvalidInput)?;
        let event = TaskEvent {
            task_id,
            sequence: next_sequence(&transaction, "secretary_task_events", &task.id)?,
            event_type,
            payload,
            created_at: unix_millis(),
        };
        let payload_text = serialize_json(&event.payload)?;
        transaction.execute(
            "
            INSERT INTO secretary_task_events(task_id, sequence, event_type, payload, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ",
            params![
                event.task_id,
                event.sequence,
                event.event_type,
                payload_text,
                event.created_at,
            ],
        )?;
        upsert_fts(
            &transaction,
            &format!("event:{}:{}", event.task_id, event.sequence),
            "event",
            Some(&task.project_id),
            &event.event_type,
            &payload_text,
        )?;
        transaction.commit()?;
        Ok(event)
    }

    pub fn list_events(&self, task_id: &str) -> Result<Vec<TaskEvent>, LedgerError> {
        let task_id = normalize_identifier(task_id.to_string())?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "
            SELECT task_id, sequence, event_type, payload, created_at
            FROM secretary_task_events
            WHERE task_id = ?1
            ORDER BY sequence ASC
            ",
        )?;
        let events = statement
            .query_map(params![task_id], event_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(events)
    }

    pub fn save_checkpoint(
        &self,
        task_id: &str,
        input: SaveCheckpointInput,
    ) -> Result<SecretaryCheckpoint, LedgerError> {
        let task_id = normalize_identifier(task_id.to_string())?;
        let context_snapshot = normalize_safe_json(input.context_snapshot, 16_000)?;
        let next_step = normalize_safe_text(input.next_step, 4_000)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let task =
            find_task_in_transaction(&transaction, &task_id)?.ok_or(LedgerError::InvalidInput)?;
        let checkpoint = SecretaryCheckpoint {
            task_id,
            sequence: next_sequence(&transaction, "secretary_task_checkpoints", &task.id)?,
            context_snapshot,
            next_step,
            created_at: unix_millis(),
        };
        let snapshot_text = serialize_json(&checkpoint.context_snapshot)?;
        transaction.execute(
            "
            INSERT INTO secretary_task_checkpoints(task_id, sequence, context_snapshot, next_step, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ",
            params![
                checkpoint.task_id,
                checkpoint.sequence,
                snapshot_text,
                checkpoint.next_step,
                checkpoint.created_at,
            ],
        )?;
        upsert_fts(
            &transaction,
            &format!("checkpoint:{}:{}", checkpoint.task_id, checkpoint.sequence),
            "checkpoint",
            Some(&task.project_id),
            "任务检查点",
            &format!("{} {}", checkpoint.next_step, snapshot_text),
        )?;
        transaction.commit()?;
        Ok(checkpoint)
    }

    pub fn load_latest_checkpoint(
        &self,
        task_id: &str,
    ) -> Result<Option<SecretaryCheckpoint>, LedgerError> {
        let task_id = normalize_identifier(task_id.to_string())?;
        let connection = self.connection()?;
        Ok(connection
            .query_row(
                "
                SELECT task_id, sequence, context_snapshot, next_step, created_at
                FROM secretary_task_checkpoints
                WHERE task_id = ?1
                ORDER BY sequence DESC
                LIMIT 1
                ",
                params![task_id],
                checkpoint_from_row,
            )
            .optional()?)
    }

    pub fn import_legacy_batch(
        &self,
        batch: LegacyImportBatch,
    ) -> Result<LegacyImportResult, LedgerError> {
        let prepared = prepare_legacy_batch(batch)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let already_imported = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM secretary_legacy_imports WHERE migration_key = ?1)",
            params![prepared.migration_key],
            |row| row.get::<_, i64>(0),
        )?;
        if already_imported != 0 {
            return Ok(LegacyImportResult {
                imported: false,
                projects_imported: 0,
                memories_imported: 0,
                tasks_imported: 0,
            });
        }

        let mut projects_imported = 0u32;
        for project in &prepared.projects {
            projects_imported += insert_project_if_missing(&transaction, project)?;
        }
        if prepared.needs_legacy_project {
            projects_imported += insert_project_if_missing(&transaction, &legacy_project())?;
        }

        let mut memories_imported = 0u32;
        for memory in &prepared.memories {
            ensure_memory_owner(&transaction, memory, true)?;
            insert_memory(&transaction, memory)?;
            memories_imported += 1;
        }

        let mut tasks_imported = 0u32;
        for task in &prepared.tasks {
            ensure_task_project(&transaction, &task.project_id, true)?;
            insert_task(&transaction, task)?;
            tasks_imported += 1;
        }

        transaction.execute(
            "INSERT INTO secretary_legacy_imports(migration_key, imported_at) VALUES (?1, ?2)",
            params![prepared.migration_key, unix_millis()],
        )?;
        transaction.commit()?;
        Ok(LegacyImportResult {
            imported: true,
            projects_imported,
            memories_imported,
            tasks_imported,
        })
    }

    fn connection(&self) -> Result<Connection, LedgerError> {
        let connection = Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
        )?;
        connection.busy_timeout(Duration::from_secs(3))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        // WAL is preferred for the desktop ledger. SQLite transparently retains a compatible
        // journal mode when a filesystem does not support WAL.
        let _ = connection.query_row("PRAGMA journal_mode = WAL", [], |row| {
            row.get::<_, String>(0)
        });
        Ok(connection)
    }
}

pub fn ledger_size_for_app(app: &tauri::AppHandle) -> Result<u64, LedgerError> {
    Ok(SecretaryLedger::open_for_app(app)?.health()?.bytes)
}

fn with_app_ledger<T>(
    app: tauri::AppHandle,
    operation: impl FnOnce(&SecretaryLedger) -> Result<T, LedgerError>,
) -> Result<T, String> {
    let ledger =
        SecretaryLedger::open_for_app(&app).map_err(|error| error.safe_message().to_string())?;
    operation(&ledger).map_err(|error| error.safe_message().to_string())
}

#[tauri::command]
pub fn secretary_ledger_bootstrap(app: tauri::AppHandle) -> Result<LedgerHealth, String> {
    with_app_ledger(app, SecretaryLedger::health)
}

#[tauri::command]
pub fn secretary_ledger_health(app: tauri::AppHandle) -> Result<LedgerHealth, String> {
    with_app_ledger(app, SecretaryLedger::health)
}

#[tauri::command]
pub fn secretary_ledger_create_project(
    app: tauri::AppHandle,
    input: CreateProjectInput,
) -> Result<SecretaryProject, String> {
    with_app_ledger(app, |ledger| ledger.create_project(input))
}

#[tauri::command]
pub fn secretary_ledger_list_projects(
    app: tauri::AppHandle,
    include_archived: bool,
) -> Result<Vec<SecretaryProject>, String> {
    with_app_ledger(app, |ledger| ledger.list_projects(include_archived))
}

#[tauri::command]
pub fn secretary_ledger_create_memory(
    app: tauri::AppHandle,
    input: CreateMemoryInput,
) -> Result<SecretaryMemory, String> {
    with_app_ledger(app, |ledger| ledger.create_memory(input))
}

#[tauri::command]
pub fn secretary_ledger_get_memory(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<SecretaryMemory>, String> {
    with_app_ledger(app, |ledger| ledger.get_memory(&id))
}

#[tauri::command]
pub fn secretary_ledger_list_memories(
    app: tauri::AppHandle,
    project_id: Option<String>,
) -> Result<Vec<SecretaryMemory>, String> {
    with_app_ledger(app, |ledger| ledger.list_memories(project_id.as_deref()))
}

#[tauri::command]
pub fn secretary_ledger_update_memory(
    app: tauri::AppHandle,
    id: String,
    input: UpdateMemoryInput,
) -> Result<SecretaryMemory, String> {
    with_app_ledger(app, |ledger| ledger.update_memory(&id, input))
}

#[tauri::command]
pub fn secretary_ledger_rollback_memory(
    app: tauri::AppHandle,
    id: String,
    revision: i64,
) -> Result<SecretaryMemory, String> {
    with_app_ledger(app, |ledger| ledger.rollback_memory(&id, revision))
}

#[tauri::command]
pub fn secretary_ledger_delete_memory(app: tauri::AppHandle, id: String) -> Result<(), String> {
    with_app_ledger(app, |ledger| ledger.delete_memory(&id))
}

#[tauri::command]
pub fn secretary_ledger_search(
    app: tauri::AppHandle,
    input: SearchInput,
) -> Result<Vec<SearchResult>, String> {
    with_app_ledger(app, |ledger| ledger.search(input))
}

#[tauri::command]
pub fn secretary_ledger_create_task(
    app: tauri::AppHandle,
    input: CreateTaskInput,
) -> Result<SecretaryTask, String> {
    with_app_ledger(app, |ledger| ledger.create_task(input))
}

#[tauri::command]
pub fn secretary_ledger_get_task(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<SecretaryTask>, String> {
    with_app_ledger(app, |ledger| ledger.get_task(&id))
}

#[tauri::command]
pub fn secretary_ledger_list_tasks(
    app: tauri::AppHandle,
    project_id: String,
    limit: u32,
) -> Result<Vec<SecretaryTask>, String> {
    with_app_ledger(app, |ledger| ledger.list_tasks(&project_id, limit))
}

#[tauri::command]
pub fn secretary_ledger_update_task(
    app: tauri::AppHandle,
    id: String,
    input: UpdateTaskInput,
) -> Result<SecretaryTask, String> {
    with_app_ledger(app, |ledger| ledger.update_task(&id, input))
}

#[tauri::command]
pub fn secretary_ledger_delete_task(app: tauri::AppHandle, id: String) -> Result<(), String> {
    with_app_ledger(app, |ledger| ledger.delete_task(&id))
}

#[tauri::command]
pub fn secretary_ledger_record_event(
    app: tauri::AppHandle,
    task_id: String,
    input: RecordEventInput,
) -> Result<TaskEvent, String> {
    with_app_ledger(app, |ledger| ledger.record_event(&task_id, input))
}

#[tauri::command]
pub fn secretary_ledger_list_events(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<Vec<TaskEvent>, String> {
    with_app_ledger(app, |ledger| ledger.list_events(&task_id))
}

#[tauri::command]
pub fn secretary_ledger_save_checkpoint(
    app: tauri::AppHandle,
    task_id: String,
    input: SaveCheckpointInput,
) -> Result<SecretaryCheckpoint, String> {
    with_app_ledger(app, |ledger| ledger.save_checkpoint(&task_id, input))
}

#[tauri::command]
pub fn secretary_ledger_load_latest_checkpoint(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<Option<SecretaryCheckpoint>, String> {
    with_app_ledger(app, |ledger| ledger.load_latest_checkpoint(&task_id))
}

#[tauri::command]
pub fn secretary_ledger_import_legacy_batch(
    app: tauri::AppHandle,
    batch: LegacyImportBatch,
) -> Result<LegacyImportResult, String> {
    with_app_ledger(app, |ledger| ledger.import_legacy_batch(batch))
}

fn apply_migrations(connection: &mut Connection) -> Result<(), LedgerError> {
    let transaction = connection.transaction()?;
    transaction.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS secretary_schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
        ",
    )?;

    let first_migration_applied = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_schema_migrations WHERE version = 1)",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if first_migration_applied == 0 {
        transaction.execute_batch(
            "
            CREATE VIRTUAL TABLE secretary_fts USING fts5(
                record_id UNINDEXED,
                entity_type UNINDEXED,
                project_id UNINDEXED,
                title,
                content,
                normalized_cjk,
                tokenize = 'unicode61 remove_diacritics 2'
            );
            ",
        )?;
        transaction.execute(
            "INSERT INTO secretary_schema_migrations(version, applied_at) VALUES (1, unixepoch())",
            [],
        )?;
    }
    let second_migration_applied = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_schema_migrations WHERE version = 2)",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if second_migration_applied == 0 {
        transaction.execute_batch(
            "
            CREATE TABLE secretary_projects (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                kind TEXT NOT NULL,
                story_project_id TEXT,
                chat_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
            );
            CREATE INDEX secretary_projects_updated_at_idx
                ON secretary_projects(updated_at DESC);
            ",
        )?;
        transaction.execute(
            "INSERT INTO secretary_schema_migrations(version, applied_at) VALUES (2, unixepoch())",
            [],
        )?;
    }
    let third_migration_applied = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_schema_migrations WHERE version = 3)",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if third_migration_applied == 0 {
        transaction.execute_batch(
            "
            CREATE TABLE secretary_memories (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL CHECK (scope IN ('personal', 'project')),
                project_id TEXT,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
                status TEXT NOT NULL,
                revision INTEGER NOT NULL CHECK (revision >= 1),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                CHECK (
                    (scope = 'personal' AND project_id IS NULL)
                    OR (scope = 'project' AND project_id IS NOT NULL)
                ),
                FOREIGN KEY (project_id) REFERENCES secretary_projects(id) ON DELETE RESTRICT
            );
            CREATE INDEX secretary_memories_project_updated_idx
                ON secretary_memories(project_id, updated_at DESC);
            CREATE TABLE secretary_memory_revisions (
                memory_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL NOT NULL,
                status TEXT NOT NULL,
                changed_at INTEGER NOT NULL,
                PRIMARY KEY (memory_id, revision),
                FOREIGN KEY (memory_id) REFERENCES secretary_memories(id) ON DELETE CASCADE
            );
            ",
        )?;
        transaction.execute(
            "INSERT INTO secretary_schema_migrations(version, applied_at) VALUES (3, unixepoch())",
            [],
        )?;
    }
    let fourth_migration_applied = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_schema_migrations WHERE version = 4)",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if fourth_migration_applied == 0 {
        transaction.execute_batch(
            "
            CREATE TABLE secretary_tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                request TEXT NOT NULL,
                status TEXT NOT NULL CHECK (
                    status IN ('queued', 'running', 'awaiting_approval', 'paused', 'completed', 'failed', 'cancelled')
                ),
                priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
                schedule_at INTEGER,
                next_step TEXT,
                public_plan TEXT,
                summary TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (project_id) REFERENCES secretary_projects(id) ON DELETE RESTRICT
            );
            CREATE INDEX secretary_tasks_project_updated_idx
                ON secretary_tasks(project_id, updated_at DESC);
            CREATE TABLE secretary_task_events (
                task_id TEXT NOT NULL,
                sequence INTEGER NOT NULL CHECK (sequence >= 1),
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (task_id, sequence),
                FOREIGN KEY (task_id) REFERENCES secretary_tasks(id) ON DELETE CASCADE
            );
            CREATE TABLE secretary_task_checkpoints (
                task_id TEXT NOT NULL,
                sequence INTEGER NOT NULL CHECK (sequence >= 1),
                context_snapshot TEXT NOT NULL,
                next_step TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (task_id, sequence),
                FOREIGN KEY (task_id) REFERENCES secretary_tasks(id) ON DELETE CASCADE
            );
            ",
        )?;
        transaction.execute(
            "INSERT INTO secretary_schema_migrations(version, applied_at) VALUES (4, unixepoch())",
            [],
        )?;
    }
    let fifth_migration_applied = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_schema_migrations WHERE version = 5)",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if fifth_migration_applied == 0 {
        transaction.execute_batch(
            "
            CREATE TABLE secretary_legacy_imports (
                migration_key TEXT PRIMARY KEY,
                imported_at INTEGER NOT NULL
            );
            ",
        )?;
        transaction.execute(
            "INSERT INTO secretary_schema_migrations(version, applied_at) VALUES (5, unixepoch())",
            [],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

struct PreparedLegacyBatch {
    migration_key: String,
    projects: Vec<SecretaryProject>,
    memories: Vec<SecretaryMemory>,
    tasks: Vec<SecretaryTask>,
    needs_legacy_project: bool,
}

fn prepare_legacy_batch(batch: LegacyImportBatch) -> Result<PreparedLegacyBatch, LedgerError> {
    let migration_key = normalize_safe_text(batch.migration_key, 128)?;
    let now = unix_millis();
    let mut project_ids = std::collections::HashSet::new();
    let mut projects = Vec::with_capacity(batch.projects.len());
    for project in batch.projects {
        let id = normalize_identifier(project.id)?;
        if id == LEGACY_PROJECT_ID || !project_ids.insert(id.clone()) {
            return Err(LedgerError::InvalidInput);
        }
        projects.push(SecretaryProject {
            id,
            title: normalize_safe_text(project.title, 240)?,
            kind: normalize_safe_text(project.kind, 64)?,
            story_project_id: normalize_optional_text(project.story_project_id, 128)?,
            chat_id: normalize_optional_text(project.chat_id, 128)?,
            created_at: now,
            updated_at: now,
            archived: false,
        });
    }

    let mut needs_legacy_project = false;
    let mut memories = Vec::with_capacity(batch.memories.len());
    for memory in batch.memories {
        let project_id = match (&memory.scope, memory.project_id) {
            (MemoryScope::Personal, None) => None,
            (MemoryScope::Personal, Some(_)) => return Err(LedgerError::InvalidInput),
            (MemoryScope::Project, Some(project_id)) => Some(project_id),
            (MemoryScope::Project, None) => {
                needs_legacy_project = true;
                Some(LEGACY_PROJECT_ID.into())
            }
        };
        memories.push(normalized_new_memory(CreateMemoryInput {
            id: memory.id,
            scope: memory.scope,
            project_id,
            kind: memory.kind,
            content: memory.content,
            source: memory.source,
            confidence: memory.confidence,
            status: memory.status,
        })?);
    }

    let mut tasks = Vec::with_capacity(batch.tasks.len());
    for task in batch.tasks {
        let project_id = match task.project_id {
            Some(project_id) => project_id,
            None => {
                needs_legacy_project = true;
                LEGACY_PROJECT_ID.into()
            }
        };
        tasks.push(normalized_new_task(CreateTaskInput {
            id: task.id,
            project_id,
            title: task.title,
            request: task.request,
            status: task.status,
            priority: task.priority,
            schedule_at: task.schedule_at,
            next_step: task.next_step,
            public_plan: task.public_plan,
            summary: task.summary,
        })?);
    }

    Ok(PreparedLegacyBatch {
        migration_key,
        projects,
        memories,
        tasks,
        needs_legacy_project,
    })
}

fn legacy_project() -> SecretaryProject {
    let now = unix_millis();
    SecretaryProject {
        id: LEGACY_PROJECT_ID.into(),
        title: "旧记录".into(),
        kind: "legacy".into(),
        story_project_id: None,
        chat_id: None,
        created_at: now,
        updated_at: now,
        archived: true,
    }
}

fn insert_project_if_missing(
    transaction: &Transaction<'_>,
    project: &SecretaryProject,
) -> Result<u32, LedgerError> {
    let changed = transaction.execute(
        "
        INSERT OR IGNORE INTO secretary_projects(
            id, title, kind, story_project_id, chat_id, created_at, updated_at, archived
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ",
        params![
            project.id,
            project.title,
            project.kind,
            project.story_project_id,
            project.chat_id,
            project.created_at,
            project.updated_at,
            if project.archived { 1 } else { 0 },
        ],
    )?;
    Ok(changed as u32)
}

fn normalized_new_task(input: CreateTaskInput) -> Result<SecretaryTask, LedgerError> {
    let status = input
        .status
        .map(normalize_task_status)
        .transpose()?
        .unwrap_or_else(|| "queued".into());
    let priority = input.priority.unwrap_or(3);
    validate_priority(priority)?;
    let now = unix_millis();
    Ok(SecretaryTask {
        id: normalize_identifier(input.id.unwrap_or_else(|| Uuid::new_v4().to_string()))?,
        project_id: normalize_identifier(input.project_id)?,
        title: normalize_safe_text(input.title, 240)?,
        request: normalize_safe_text(input.request, 16_000)?,
        status,
        priority,
        schedule_at: input.schedule_at,
        next_step: input
            .next_step
            .map(|value| normalize_safe_text(value, 4_000))
            .transpose()?,
        public_plan: input
            .public_plan
            .map(|value| normalize_safe_text(value, 16_000))
            .transpose()?,
        summary: input
            .summary
            .map(|value| normalize_safe_text(value, 4_000))
            .transpose()?,
        created_at: now,
        updated_at: now,
    })
}

fn normalize_task_status(value: String) -> Result<String, LedgerError> {
    let value = normalize_safe_text(value, 32)?;
    if matches!(
        value.as_str(),
        "queued"
            | "running"
            | "awaiting_approval"
            | "paused"
            | "completed"
            | "failed"
            | "cancelled"
    ) {
        Ok(value)
    } else {
        Err(LedgerError::InvalidInput)
    }
}

fn validate_priority(priority: i64) -> Result<(), LedgerError> {
    if !(1..=5).contains(&priority) {
        return Err(LedgerError::InvalidInput);
    }
    Ok(())
}

fn ensure_task_project(
    transaction: &Transaction<'_>,
    project_id: &str,
    allow_legacy_project: bool,
) -> Result<(), LedgerError> {
    if project_id == LEGACY_PROJECT_ID && !allow_legacy_project {
        return Err(LedgerError::InvalidInput);
    }
    let exists = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_projects WHERE id = ?1)",
        params![project_id],
        |row| row.get::<_, i64>(0),
    )?;
    if exists == 0 {
        return Err(LedgerError::InvalidInput);
    }
    Ok(())
}

fn insert_task(transaction: &Transaction<'_>, task: &SecretaryTask) -> Result<(), LedgerError> {
    transaction.execute(
        "
        INSERT INTO secretary_tasks(
            id, project_id, title, request, status, priority, schedule_at, next_step,
            public_plan, summary, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ",
        params![
            task.id,
            task.project_id,
            task.title,
            task.request,
            task.status,
            task.priority,
            task.schedule_at,
            task.next_step,
            task.public_plan,
            task.summary,
            task.created_at,
            task.updated_at,
        ],
    )?;
    index_task(transaction, task)
}

fn update_task_record(
    transaction: &Transaction<'_>,
    task: &SecretaryTask,
) -> Result<(), LedgerError> {
    transaction.execute(
        "
        UPDATE secretary_tasks
        SET title = ?2, request = ?3, status = ?4, priority = ?5, schedule_at = ?6,
            next_step = ?7, public_plan = ?8, summary = ?9, updated_at = ?10
        WHERE id = ?1
        ",
        params![
            task.id,
            task.title,
            task.request,
            task.status,
            task.priority,
            task.schedule_at,
            task.next_step,
            task.public_plan,
            task.summary,
            task.updated_at,
        ],
    )?;
    index_task(transaction, task)
}

fn index_task(transaction: &Transaction<'_>, task: &SecretaryTask) -> Result<(), LedgerError> {
    let content = [
        task.request.as_str(),
        task.next_step.as_deref().unwrap_or_default(),
        task.public_plan.as_deref().unwrap_or_default(),
        task.summary.as_deref().unwrap_or_default(),
    ]
    .join("\n");
    upsert_fts(
        transaction,
        &task.id,
        "task",
        Some(&task.project_id),
        &task.title,
        &content,
    )
}

fn find_task(connection: &Connection, id: &str) -> Result<Option<SecretaryTask>, LedgerError> {
    Ok(connection
        .query_row(
            "
            SELECT id, project_id, title, request, status, priority, schedule_at, next_step,
                   public_plan, summary, created_at, updated_at
            FROM secretary_tasks WHERE id = ?1
            ",
            params![id],
            task_from_row,
        )
        .optional()?)
}

fn find_task_in_transaction(
    transaction: &Transaction<'_>,
    id: &str,
) -> Result<Option<SecretaryTask>, LedgerError> {
    Ok(transaction
        .query_row(
            "
            SELECT id, project_id, title, request, status, priority, schedule_at, next_step,
                   public_plan, summary, created_at, updated_at
            FROM secretary_tasks WHERE id = ?1
            ",
            params![id],
            task_from_row,
        )
        .optional()?)
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SecretaryTask> {
    Ok(SecretaryTask {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        request: row.get(3)?,
        status: row.get(4)?,
        priority: row.get(5)?,
        schedule_at: row.get(6)?,
        next_step: row.get(7)?,
        public_plan: row.get(8)?,
        summary: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn next_sequence(
    transaction: &Transaction<'_>,
    table: &str,
    task_id: &str,
) -> Result<i64, LedgerError> {
    let query = match table {
        "secretary_task_events" => "SELECT COALESCE(MAX(sequence), 0) + 1 FROM secretary_task_events WHERE task_id = ?1",
        "secretary_task_checkpoints" => "SELECT COALESCE(MAX(sequence), 0) + 1 FROM secretary_task_checkpoints WHERE task_id = ?1",
        _ => return Err(LedgerError::InvalidInput),
    };
    Ok(transaction.query_row(query, params![task_id], |row| row.get(0))?)
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskEvent> {
    let payload: String = row.get(3)?;
    let payload = serde_json::from_str(&payload).map_err(|_| rusqlite::Error::InvalidQuery)?;
    Ok(TaskEvent {
        task_id: row.get(0)?,
        sequence: row.get(1)?,
        event_type: row.get(2)?,
        payload,
        created_at: row.get(4)?,
    })
}

fn checkpoint_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SecretaryCheckpoint> {
    let context_snapshot: String = row.get(2)?;
    let context_snapshot =
        serde_json::from_str(&context_snapshot).map_err(|_| rusqlite::Error::InvalidQuery)?;
    Ok(SecretaryCheckpoint {
        task_id: row.get(0)?,
        sequence: row.get(1)?,
        context_snapshot,
        next_step: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn serialize_json(value: &serde_json::Value) -> Result<String, LedgerError> {
    serde_json::to_string(value).map_err(|_| LedgerError::InvalidInput)
}

fn normalize_safe_json(
    value: serde_json::Value,
    maximum_chars: usize,
) -> Result<serde_json::Value, LedgerError> {
    let serialized = serialize_json(&value)?;
    normalize_safe_text(serialized, maximum_chars)?;
    Ok(value)
}

fn normalized_new_memory(input: CreateMemoryInput) -> Result<SecretaryMemory, LedgerError> {
    let scope = input.scope;
    let project_id = input.project_id.map(normalize_identifier).transpose()?;
    match scope {
        MemoryScope::Personal if project_id.is_some() => return Err(LedgerError::InvalidInput),
        MemoryScope::Project if project_id.is_none() => return Err(LedgerError::InvalidInput),
        _ => {}
    }
    validate_confidence(input.confidence)?;
    let now = unix_millis();
    Ok(SecretaryMemory {
        id: normalize_identifier(input.id.unwrap_or_else(|| Uuid::new_v4().to_string()))?,
        scope,
        project_id,
        kind: normalize_safe_text(input.kind, 64)?,
        content: normalize_safe_text(input.content, 16_000)?,
        source: normalize_safe_text(input.source, 96)?,
        confidence: input.confidence,
        status: normalize_safe_text(input.status, 32)?,
        revision: 1,
        created_at: now,
        updated_at: now,
    })
}

fn ensure_memory_owner(
    transaction: &Transaction<'_>,
    memory: &SecretaryMemory,
    allow_legacy_project: bool,
) -> Result<(), LedgerError> {
    let Some(project_id) = memory.project_id.as_deref() else {
        return Ok(());
    };
    if project_id == LEGACY_PROJECT_ID && !allow_legacy_project {
        return Err(LedgerError::InvalidInput);
    }
    let exists = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_projects WHERE id = ?1)",
        params![project_id],
        |row| row.get::<_, i64>(0),
    )?;
    if exists == 0 {
        return Err(LedgerError::InvalidInput);
    }
    Ok(())
}

fn insert_memory(
    transaction: &Transaction<'_>,
    memory: &SecretaryMemory,
) -> Result<(), LedgerError> {
    transaction.execute(
        "
        INSERT INTO secretary_memories(
            id, scope, project_id, kind, content, source, confidence, status, revision,
            created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ",
        params![
            memory.id,
            memory.scope.as_str(),
            memory.project_id,
            memory.kind,
            memory.content,
            memory.source,
            memory.confidence,
            memory.status,
            memory.revision,
            memory.created_at,
            memory.updated_at,
        ],
    )?;
    insert_memory_revision(transaction, memory)?;
    upsert_fts(
        transaction,
        &memory.id,
        "memory",
        memory.project_id.as_deref(),
        &memory.kind,
        &memory.content,
    )
}

fn update_memory_record(
    transaction: &Transaction<'_>,
    memory: &SecretaryMemory,
) -> Result<(), LedgerError> {
    transaction.execute(
        "
        UPDATE secretary_memories
        SET kind = ?2, content = ?3, source = ?4, confidence = ?5, status = ?6,
            revision = ?7, updated_at = ?8
        WHERE id = ?1
        ",
        params![
            memory.id,
            memory.kind,
            memory.content,
            memory.source,
            memory.confidence,
            memory.status,
            memory.revision,
            memory.updated_at,
        ],
    )?;
    insert_memory_revision(transaction, memory)?;
    upsert_fts(
        transaction,
        &memory.id,
        "memory",
        memory.project_id.as_deref(),
        &memory.kind,
        &memory.content,
    )
}

fn insert_memory_revision(
    transaction: &Transaction<'_>,
    memory: &SecretaryMemory,
) -> Result<(), LedgerError> {
    transaction.execute(
        "
        INSERT INTO secretary_memory_revisions(
            memory_id, revision, kind, content, source, confidence, status, changed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ",
        params![
            memory.id,
            memory.revision,
            memory.kind,
            memory.content,
            memory.source,
            memory.confidence,
            memory.status,
            memory.updated_at,
        ],
    )?;
    Ok(())
}

fn find_memory(connection: &Connection, id: &str) -> Result<Option<SecretaryMemory>, LedgerError> {
    Ok(connection
        .query_row(
            "
            SELECT id, scope, project_id, kind, content, source, confidence, status,
                   revision, created_at, updated_at
            FROM secretary_memories WHERE id = ?1
            ",
            params![id],
            memory_from_row,
        )
        .optional()?)
}

fn find_memory_in_transaction(
    transaction: &Transaction<'_>,
    id: &str,
) -> Result<Option<SecretaryMemory>, LedgerError> {
    Ok(transaction
        .query_row(
            "
            SELECT id, scope, project_id, kind, content, source, confidence, status,
                   revision, created_at, updated_at
            FROM secretary_memories WHERE id = ?1
            ",
            params![id],
            memory_from_row,
        )
        .optional()?)
}

fn memory_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SecretaryMemory> {
    Ok(SecretaryMemory {
        id: row.get(0)?,
        scope: MemoryScope::from_database(row.get(1)?)?,
        project_id: row.get(2)?,
        kind: row.get(3)?,
        content: row.get(4)?,
        source: row.get(5)?,
        confidence: row.get(6)?,
        status: row.get(7)?,
        revision: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn upsert_fts(
    transaction: &Transaction<'_>,
    record_id: &str,
    entity_type: &str,
    project_id: Option<&str>,
    title: &str,
    content: &str,
) -> Result<(), LedgerError> {
    transaction.execute(
        "DELETE FROM secretary_fts WHERE record_id = ?1 AND entity_type = ?2",
        params![record_id, entity_type],
    )?;
    transaction.execute(
        "
        INSERT INTO secretary_fts(record_id, entity_type, project_id, title, content, normalized_cjk)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ",
        params![
            record_id,
            entity_type,
            project_id.unwrap_or(""),
            title,
            content,
            normalized_cjk_bigrams(content),
        ],
    )?;
    Ok(())
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SecretaryProject> {
    Ok(SecretaryProject {
        id: row.get(0)?,
        title: row.get(1)?,
        kind: row.get(2)?,
        story_project_id: row.get(3)?,
        chat_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        archived: row.get::<_, i64>(7)? != 0,
    })
}

fn normalize_identifier(value: String) -> Result<String, LedgerError> {
    let value = value.trim().to_string();
    if value.is_empty()
        || value.chars().count() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err(LedgerError::InvalidInput);
    }
    Ok(value)
}

fn normalize_text(value: String, maximum_chars: usize) -> Result<String, LedgerError> {
    normalize_safe_text(value, maximum_chars)
}

fn normalize_safe_text(value: String, maximum_chars: usize) -> Result<String, LedgerError> {
    let value = value.trim().to_string();
    if value.is_empty() || value.chars().count() > maximum_chars || contains_sensitive_input(&value)
    {
        return Err(LedgerError::InvalidInput);
    }
    Ok(value)
}

fn normalize_optional_text(
    value: Option<String>,
    maximum_chars: usize,
) -> Result<Option<String>, LedgerError> {
    value
        .map(|value| normalize_text(value, maximum_chars))
        .transpose()
}

fn validate_confidence(confidence: f64) -> Result<(), LedgerError> {
    if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
        return Err(LedgerError::InvalidInput);
    }
    Ok(())
}

fn build_fts_query(query: &str) -> Result<String, LedgerError> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 240 {
        return Err(LedgerError::InvalidInput);
    }
    let terms = search_terms(query);
    if terms.is_empty() || terms.len() > 32 {
        return Err(LedgerError::InvalidInput);
    }
    Ok(terms
        .iter()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND "))
}

fn search_terms(value: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut cjk_run = Vec::new();
    let mut word = String::new();

    let flush_cjk = |run: &mut Vec<char>, output: &mut Vec<String>| {
        if run.len() == 1 {
            output.push(run[0].to_string());
        } else {
            output.extend(run.windows(2).map(|pair| pair.iter().collect()));
        }
        run.clear();
    };
    let flush_word = |word: &mut String, output: &mut Vec<String>| {
        if !word.is_empty() {
            output.push(std::mem::take(word).to_lowercase());
        }
    };

    for character in value.chars() {
        if is_cjk(character) {
            flush_word(&mut word, &mut terms);
            cjk_run.push(character);
        } else if character.is_alphanumeric() || character == '_' {
            flush_cjk(&mut cjk_run, &mut terms);
            word.push(character);
        } else {
            flush_cjk(&mut cjk_run, &mut terms);
            flush_word(&mut word, &mut terms);
        }
    }
    flush_cjk(&mut cjk_run, &mut terms);
    flush_word(&mut word, &mut terms);
    terms
}

fn normalized_cjk_bigrams(value: &str) -> String {
    let mut output = Vec::new();
    let mut run = Vec::new();
    for character in value.chars() {
        if is_cjk(character) {
            run.push(character);
        } else {
            if run.len() == 1 {
                output.push(run[0].to_string());
            } else {
                output.extend(run.windows(2).map(|pair| pair.iter().collect::<String>()));
            }
            run.clear();
        }
    }
    if run.len() == 1 {
        output.push(run[0].to_string());
    } else {
        output.extend(run.windows(2).map(|pair| pair.iter().collect::<String>()));
    }
    output.join(" ")
}

fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF
    )
}

fn contains_sensitive_input(value: &str) -> bool {
    let lowered = value.to_lowercase();
    let credential_markers = [
        "password",
        "passwd",
        "api_key",
        "apikey",
        "access_token",
        "refresh_token",
        "authorization:",
        "bearer ",
        "private key",
        "secret key",
        "验证码",
        "校验码",
        "一次性密码",
        "动态口令",
        "密码",
        "访问令牌",
        "密钥",
        "授权码",
    ];
    if credential_markers
        .iter()
        .any(|marker| lowered.contains(marker))
    {
        return true;
    }

    let financial_markers = [
        "银行卡",
        "信用卡",
        "卡号",
        "银行账户",
        "银行账号",
        "account number",
        "bank account",
        "card number",
    ];
    if financial_markers
        .iter()
        .any(|marker| lowered.contains(marker))
    {
        return true;
    }

    if has_contact_address_or_long_numeric_data(&lowered) {
        return true;
    }

    value.split_whitespace().any(|token| {
        let mut parts = token.split('@');
        matches!(
            (parts.next(), parts.next(), parts.next()),
            (Some(local), Some(domain), None)
                if !local.is_empty() && domain.contains('.') && !domain.starts_with('.')
        )
    })
}

fn has_contact_address_or_long_numeric_data(value: &str) -> bool {
    let mut longest_numeric_run = 0usize;
    let mut current_numeric_run = 0usize;
    for character in value.chars() {
        if character.is_ascii_digit() {
            current_numeric_run += 1;
            longest_numeric_run = longest_numeric_run.max(current_numeric_run);
        } else if matches!(character, ' ' | '-' | '(' | ')' | '+') {
            continue;
        } else {
            current_numeric_run = 0;
        }
    }
    if longest_numeric_run >= 11 {
        return true;
    }

    let address_markers = [
        "地址",
        "住址",
        "门牌",
        "street",
        "avenue",
        "road",
        "apartment",
        "邮编",
        "postcode",
    ];
    address_markers.iter().any(|marker| value.contains(marker))
        && value.chars().any(|character| character.is_ascii_digit())
}

fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn ledger_file_size(path: &Path) -> u64 {
    [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ]
    .iter()
    .filter_map(|candidate| candidate.metadata().ok())
    .map(|metadata| metadata.len())
    .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("papyrus-secretary-ledger-{}", Uuid::new_v4()))
    }

    #[test]
    fn initializes_a_versioned_fts5_ledger_and_reports_health() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");

        let ledger = SecretaryLedger::open_at(&path).expect("ledger should initialize");
        let health = ledger.health().expect("health should inspect the ledger");

        assert_eq!(health.status, "ok");
        assert_eq!(health.schema_version, SECRETARY_LEDGER_SCHEMA_VERSION);
        assert!(health.fts_available);
        assert!(path.is_file());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn applies_project_schema_migrations_once_when_reopened() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");

        SecretaryLedger::open_at(&path).unwrap();
        SecretaryLedger::open_at(&path).unwrap();
        let connection = Connection::open(&path).unwrap();

        let migrations: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let projects_table: String = connection
            .query_row(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'secretary_projects'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(migrations, SECRETARY_LEDGER_SCHEMA_VERSION);
        assert_eq!(projects_table, "secretary_projects");

        drop(connection);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn creates_and_lists_a_project_with_secretary_metadata() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();

        let created = ledger
            .create_project(CreateProjectInput {
                id: Some("project-a".into()),
                title: "招商材料".into(),
                kind: "writing".into(),
                story_project_id: Some("story-a".into()),
                chat_id: Some("chat-a".into()),
            })
            .unwrap();

        assert_eq!(created.id, "project-a");
        assert_eq!(created.story_project_id.as_deref(), Some("story-a"));
        assert_eq!(ledger.list_projects(false).unwrap(), vec![created]);

        fs::remove_dir_all(directory).unwrap();
    }

    fn create_project(ledger: &SecretaryLedger, id: &str, title: &str) {
        ledger
            .create_project(CreateProjectInput {
                id: Some(id.into()),
                title: title.into(),
                kind: "writing".into(),
                story_project_id: None,
                chat_id: None,
            })
            .unwrap();
    }

    fn memory_input(
        scope: MemoryScope,
        project_id: Option<&str>,
        content: &str,
    ) -> CreateMemoryInput {
        CreateMemoryInput {
            id: None,
            scope,
            project_id: project_id.map(str::to_string),
            kind: "preference".into(),
            content: content.into(),
            source: "user".into(),
            confidence: 0.9,
            status: "active".into(),
        }
    }

    #[test]
    fn searches_only_personal_and_current_project_memory_by_default() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        create_project(&ledger, "project-b", "乙项目");
        let personal = ledger
            .create_memory(memory_input(
                MemoryScope::Personal,
                None,
                "偏好使用克制的工作语气",
            ))
            .unwrap();
        let active = ledger
            .create_memory(memory_input(
                MemoryScope::Project,
                Some("project-a"),
                "甲项目的工作语气需要克制",
            ))
            .unwrap();
        let foreign = ledger
            .create_memory(memory_input(
                MemoryScope::Project,
                Some("project-b"),
                "乙项目的工作语气需要热情",
            ))
            .unwrap();

        let results = ledger
            .search(SearchInput {
                query: "工作语气".into(),
                current_project_id: "project-a".into(),
                include_cross_project: false,
                limit: 20,
            })
            .unwrap();
        let ids = results
            .iter()
            .map(|result| result.id.as_str())
            .collect::<Vec<_>>();

        assert!(ids.contains(&personal.id.as_str()));
        assert!(ids.contains(&active.id.as_str()));
        assert!(!ids.contains(&foreign.id.as_str()));
        assert_eq!(
            results
                .iter()
                .find(|result| result.id == personal.id)
                .and_then(|result| result.project_title.as_deref()),
            Some("个人偏好")
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn includes_other_project_results_only_after_explicit_cross_project_request() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        create_project(&ledger, "project-b", "乙项目");
        ledger
            .create_memory(memory_input(
                MemoryScope::Project,
                Some("project-b"),
                "乙项目的采访提纲",
            ))
            .unwrap();

        let results = ledger
            .search(SearchInput {
                query: "采访提纲".into(),
                current_project_id: "project-a".into(),
                include_cross_project: true,
                limit: 20,
            })
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].project_id.as_deref(), Some("project-b"));
        assert_eq!(results[0].project_title.as_deref(), Some("乙项目"));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn recalls_chinese_content_through_normalized_bigrams() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let memory = ledger
            .create_memory(memory_input(
                MemoryScope::Project,
                Some("project-a"),
                "请准备年度合作合同草案并标注待确认条款",
            ))
            .unwrap();

        let results = ledger
            .search(SearchInput {
                query: "合同草案".into(),
                current_project_id: "project-a".into(),
                include_cross_project: false,
                limit: 20,
            })
            .unwrap();

        assert_eq!(results[0].id, memory.id);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_sensitive_memory_before_it_reaches_the_ledger_or_fts() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        let result = ledger.create_memory(memory_input(
            MemoryScope::Personal,
            None,
            "我的验证码是 123456，请记住它",
        ));

        assert!(matches!(result, Err(LedgerError::InvalidInput)));
        assert!(ledger.list_memories(None).unwrap().is_empty());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn preserves_memory_revisions_and_can_roll_back_to_a_prior_revision() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        let memory = ledger
            .create_memory(memory_input(MemoryScope::Personal, None, "第一版写作偏好"))
            .unwrap();
        let edited = ledger
            .update_memory(
                &memory.id,
                UpdateMemoryInput {
                    kind: None,
                    content: Some("第二版写作偏好".into()),
                    source: None,
                    confidence: None,
                    status: None,
                },
            )
            .unwrap();
        let rolled_back = ledger.rollback_memory(&memory.id, 1).unwrap();

        assert_eq!(edited.revision, 2);
        assert_eq!(rolled_back.content, "第一版写作偏好");
        assert_eq!(rolled_back.revision, 3);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn permanently_deletes_memory_revisions_and_fts_entries_together() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        let memory = ledger
            .create_memory(memory_input(
                MemoryScope::Personal,
                None,
                "需要永久遗忘的关键词",
            ))
            .unwrap();
        ledger.delete_memory(&memory.id).unwrap();

        assert!(ledger.get_memory(&memory.id).unwrap().is_none());
        assert!(ledger
            .search(SearchInput {
                query: "永久遗忘关键词".into(),
                current_project_id: "unused-project".into(),
                include_cross_project: false,
                limit: 20,
            })
            .unwrap()
            .is_empty());

        fs::remove_dir_all(directory).unwrap();
    }

    fn task_input(project_id: &str) -> CreateTaskInput {
        CreateTaskInput {
            id: None,
            project_id: project_id.into(),
            title: "整理本周会议材料".into(),
            request: "请整理本周会议材料并产出待办".into(),
            status: None,
            priority: Some(3),
            schedule_at: None,
            next_step: Some("收集会议纪要".into()),
            public_plan: Some("1. 收集资料\n2. 整理待办".into()),
            summary: None,
        }
    }

    #[test]
    fn rejects_new_tasks_without_a_valid_project_owner() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();

        assert!(matches!(
            ledger.create_task(task_input("missing-project")),
            Err(LedgerError::InvalidInput)
        ));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn orders_events_and_checkpoints_per_task_and_loads_the_latest_checkpoint() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let task = ledger.create_task(task_input("project-a")).unwrap();
        let first_event = ledger
            .record_event(
                &task.id,
                RecordEventInput {
                    event_type: "plan_ready".into(),
                    payload: serde_json::json!({ "summary": "已生成公开计划" }),
                },
            )
            .unwrap();
        let second_event = ledger
            .record_event(
                &task.id,
                RecordEventInput {
                    event_type: "tool_receipt".into(),
                    payload: serde_json::json!({ "summary": "已读取会议纪要" }),
                },
            )
            .unwrap();
        ledger
            .save_checkpoint(
                &task.id,
                SaveCheckpointInput {
                    context_snapshot: serde_json::json!({ "summary": "已读取两份纪要" }),
                    next_step: "整理待办".into(),
                },
            )
            .unwrap();
        let latest = ledger
            .save_checkpoint(
                &task.id,
                SaveCheckpointInput {
                    context_snapshot: serde_json::json!({ "summary": "待办已完成初稿" }),
                    next_step: "等待用户确认".into(),
                },
            )
            .unwrap();

        assert_eq!((first_event.sequence, second_event.sequence), (1, 2));
        assert_eq!(ledger.list_events(&task.id).unwrap().len(), 2);
        assert_eq!(
            ledger.load_latest_checkpoint(&task.id).unwrap(),
            Some(latest)
        );
        assert!(ledger
            .search(SearchInput {
                query: "读取会议纪要".into(),
                current_project_id: "project-a".into(),
                include_cross_project: false,
                limit: 20,
            })
            .unwrap()
            .iter()
            .any(|result| result.entity_type == "event"));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn updates_lists_and_permanently_removes_a_project_bound_task() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let task = ledger.create_task(task_input("project-a")).unwrap();
        let updated = ledger
            .update_task(
                &task.id,
                UpdateTaskInput {
                    title: None,
                    request: None,
                    status: Some("paused".into()),
                    priority: None,
                    schedule_at: None,
                    next_step: None,
                    public_plan: None,
                    summary: Some("等待会议纪要补充".into()),
                },
            )
            .unwrap();

        assert_eq!(updated.status, "paused");
        assert_eq!(ledger.list_tasks("project-a", 20).unwrap().len(), 1);
        ledger.delete_task(&task.id).unwrap();
        assert!(ledger.get_task(&task.id).unwrap().is_none());
        assert!(ledger.list_tasks("project-a", 20).unwrap().is_empty());
        assert!(ledger
            .search(SearchInput {
                query: "整理本周会议材料".into(),
                current_project_id: "project-a".into(),
                include_cross_project: false,
                limit: 20,
            })
            .unwrap()
            .is_empty());

        fs::remove_dir_all(directory).unwrap();
    }

    fn legacy_project(id: &str, title: &str) -> LegacyProjectInput {
        LegacyProjectInput {
            id: id.into(),
            title: title.into(),
            kind: "writing".into(),
            story_project_id: None,
            chat_id: None,
        }
    }

    fn legacy_memory(project_id: Option<&str>, content: &str) -> LegacyMemoryInput {
        LegacyMemoryInput {
            id: None,
            scope: MemoryScope::Project,
            project_id: project_id.map(str::to_string),
            kind: "fact".into(),
            content: content.into(),
            source: "legacy".into(),
            confidence: 0.8,
            status: "active".into(),
        }
    }

    #[test]
    fn imports_a_legacy_batch_once_and_keeps_unowned_records_out_of_project_search() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        let batch = LegacyImportBatch {
            migration_key: "legacy-local-storage-v1".into(),
            projects: vec![legacy_project("project-a", "迁移项目")],
            memories: vec![
                legacy_memory(Some("project-a"), "迁移项目的采访资料"),
                legacy_memory(None, "无归属的旧采访资料"),
            ],
            tasks: Vec::new(),
        };

        let first = ledger.import_legacy_batch(batch.clone()).unwrap();
        let second = ledger.import_legacy_batch(batch).unwrap();
        let owned = ledger
            .search(SearchInput {
                query: "采访资料".into(),
                current_project_id: "project-a".into(),
                include_cross_project: false,
                limit: 20,
            })
            .unwrap();
        let unowned = ledger
            .search(SearchInput {
                query: "无归属旧采访资料".into(),
                current_project_id: "project-a".into(),
                include_cross_project: true,
                limit: 20,
            })
            .unwrap();

        assert!(first.imported);
        assert_eq!(first.memories_imported, 2);
        assert!(!second.imported);
        assert_eq!(owned.len(), 1);
        assert!(unowned.is_empty());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_a_legacy_batch_before_partially_writing_it() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        let batch = LegacyImportBatch {
            migration_key: "legacy-failing-batch".into(),
            projects: vec![legacy_project("project-failed", "不会被导入")],
            memories: vec![
                legacy_memory(Some("project-failed"), "有效的第一条记录"),
                legacy_memory(Some("project-failed"), "验证码 123456"),
            ],
            tasks: Vec::new(),
        };

        assert!(matches!(
            ledger.import_legacy_batch(batch),
            Err(LedgerError::InvalidInput)
        ));
        assert!(ledger.list_projects(true).unwrap().is_empty());

        fs::remove_dir_all(directory).unwrap();
    }
}
