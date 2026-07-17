use rusqlite::{
    params, Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    fmt, fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use uuid::Uuid;

pub const SECRETARY_LEDGER_SCHEMA_VERSION: i64 = 6;
const LEGACY_PROJECT_ID: &str = "__papyrus_legacy__";
const MAX_LIST_RESULTS: u32 = 100;
const MAX_LEGACY_IMPORT_RECORDS: usize = 100;
const MAX_SAFE_JSON_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_SAFE_JSON_CHARS: usize = 16_000;
const MAX_SAFE_JSON_DEPTH: usize = 12;
const MAX_SAFE_JSON_KEYS: usize = 100;
const MAX_SAFE_JSON_NODES: usize = 1_000;
const MAX_TASK_PROGRESS_EVENTS: usize = 8;

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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAccess {
    pub current_project_id: String,
    #[serde(default)]
    pub include_cross_project: bool,
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
    #[serde(default)]
    pub schedule_at: TaskFieldPatch<i64>,
    #[serde(default)]
    pub next_step: TaskFieldPatch<String>,
    #[serde(default)]
    pub public_plan: TaskFieldPatch<String>,
    #[serde(default)]
    pub summary: TaskFieldPatch<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskFieldPatch<T> {
    Unchanged,
    Clear,
    Set(T),
}

impl<T> Default for TaskFieldPatch<T> {
    fn default() -> Self {
        Self::Unchanged
    }
}

impl<'de, T> Deserialize<'de> for TaskFieldPatch<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Option::<T>::deserialize(deserializer)
            .map(|value| value.map(Self::Set).unwrap_or(Self::Clear))
    }
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistTaskProgressInput {
    pub task: UpdateTaskInput,
    pub events: Vec<RecordEventInput>,
    pub checkpoint: SaveCheckpointInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTaskInput {
    pub task: CreateTaskInput,
    pub events: Vec<RecordEventInput>,
    pub checkpoint: SaveCheckpointInput,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretaryTaskProgress {
    pub task: SecretaryTask,
    pub events: Vec<TaskEvent>,
    pub checkpoint: SecretaryCheckpoint,
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

    /// Flush the WAL before the application is replaced by an updater. The
    /// ledger remains usable when a checkpoint is blocked, but callers must
    /// treat that as a failed update preparation rather than copying a
    /// potentially incomplete database snapshot.
    pub fn checkpoint_for_update(&self) -> Result<LedgerHealth, LedgerError> {
        let connection = self.connection()?;
        let busy = connection.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            row.get::<_, i64>(0)
        })?;
        if busy != 0 {
            return Err(LedgerError::Unavailable);
        }
        drop(connection);
        self.health()
    }

    pub fn create_project(
        &self,
        input: CreateProjectInput,
    ) -> Result<SecretaryProject, LedgerError> {
        let id = normalize_identifier(input.id.unwrap_or_else(|| Uuid::new_v4().to_string()))?;
        if id == LEGACY_PROJECT_ID {
            return Err(LedgerError::InvalidInput);
        }
        let title = normalize_text(input.title, 240)?;
        let kind = normalize_text(input.kind, 64)?;
        let story_project_id = normalize_optional_identifier(input.story_project_id)?;
        let chat_id = normalize_optional_identifier(input.chat_id)?;
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
        limit: u32,
    ) -> Result<Vec<SecretaryProject>, LedgerError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "
            SELECT id, title, kind, story_project_id, chat_id, created_at, updated_at, archived
            FROM secretary_projects
            WHERE id != ?1
              AND (?2 = 1 OR archived = 0)
            ORDER BY updated_at DESC, id ASC
            LIMIT ?3
            ",
        )?;
        let projects = statement
            .query_map(
                params![
                    LEGACY_PROJECT_ID,
                    if include_archived { 1 } else { 0 },
                    bounded_limit(limit),
                ],
                project_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(projects)
    }

    pub fn create_memory(
        &self,
        access: &ProjectAccess,
        input: CreateMemoryInput,
    ) -> Result<SecretaryMemory, LedgerError> {
        let memory = normalized_new_memory(input)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        authorize_project_write(&access, memory.project_id.as_deref())?;
        ensure_memory_owner(&transaction, &memory, false)?;
        insert_memory(&transaction, &memory)?;
        transaction.commit()?;
        Ok(memory)
    }

    pub fn get_memory(
        &self,
        access: &ProjectAccess,
        id: &str,
    ) -> Result<Option<SecretaryMemory>, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let connection = self.connection()?;
        let access = validate_project_access(&connection, access)?;
        let memory = find_memory(&connection, &id)?;
        if let Some(memory) = memory.as_ref() {
            authorize_project_read(&access, memory.project_id.as_deref())?;
        }
        Ok(memory)
    }

    pub fn list_memories(
        &self,
        access: Option<&ProjectAccess>,
        limit: u32,
    ) -> Result<Vec<SecretaryMemory>, LedgerError> {
        let access = access.ok_or(LedgerError::InvalidInput)?;
        let connection = self.connection()?;
        let access = validate_project_access(&connection, access)?;
        let mut statement = connection.prepare(
            "
            SELECT id, scope, project_id, kind, content, source, confidence, status,
                   revision, created_at, updated_at
            FROM secretary_memories
            WHERE project_id IS NULL
               OR project_id = ?1
               OR (?2 = 1 AND project_id != ?3)
            ORDER BY updated_at DESC, id ASC
            LIMIT ?4
            ",
        )?;
        let memories = statement
            .query_map(
                params![
                    access.current_project_id,
                    if access.include_cross_project { 1 } else { 0 },
                    LEGACY_PROJECT_ID,
                    bounded_limit(limit),
                ],
                memory_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(memories)
    }

    pub fn update_memory(
        &self,
        access: &ProjectAccess,
        id: &str,
        input: UpdateMemoryInput,
    ) -> Result<SecretaryMemory, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        let existing =
            find_memory_in_transaction(&transaction, &id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_write(&access, existing.project_id.as_deref())?;
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

    pub fn rollback_memory(
        &self,
        access: &ProjectAccess,
        id: &str,
        revision: i64,
    ) -> Result<SecretaryMemory, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        if revision < 1 {
            return Err(LedgerError::InvalidInput);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        let existing =
            find_memory_in_transaction(&transaction, &id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_write(&access, existing.project_id.as_deref())?;
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
            kind: normalize_safe_text(prior.0, 64)?,
            content: normalize_safe_text(prior.1, 16_000)?,
            source: normalize_safe_text(prior.2, 96)?,
            confidence: prior.3,
            status: normalize_safe_text(prior.4, 32)?,
            revision: existing.revision + 1,
            created_at: existing.created_at,
            updated_at: unix_millis(),
        };
        validate_confidence(restored.confidence)?;
        update_memory_record(&transaction, &restored)?;
        transaction.commit()?;
        Ok(restored)
    }

    pub fn delete_memory(&self, access: &ProjectAccess, id: &str) -> Result<(), LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        let existing =
            find_memory_in_transaction(&transaction, &id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_write(&access, existing.project_id.as_deref())?;
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
        let access = ProjectAccess {
            current_project_id: input.current_project_id,
            include_cross_project: input.include_cross_project,
        };
        let query = build_fts_query(&input.query)?;
        let connection = self.connection()?;
        let access = validate_project_access(&connection, &access)?;
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
                    access.current_project_id,
                    if access.include_cross_project { 1 } else { 0 },
                    bounded_limit(input.limit),
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

    pub fn create_task(
        &self,
        access: &ProjectAccess,
        input: CreateTaskInput,
    ) -> Result<SecretaryTask, LedgerError> {
        let task = normalized_new_task(input)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        authorize_project_write(&access, Some(&task.project_id))?;
        ensure_task_project(&transaction, &task.project_id, false)?;
        insert_task(&transaction, &task)?;
        transaction.commit()?;
        Ok(task)
    }

    pub fn get_task(
        &self,
        access: &ProjectAccess,
        id: &str,
    ) -> Result<Option<SecretaryTask>, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let connection = self.connection()?;
        let access = validate_project_access(&connection, access)?;
        let task = find_task(&connection, &id)?;
        if let Some(task) = task.as_ref() {
            authorize_project_read(&access, Some(&task.project_id))?;
        }
        Ok(task)
    }

    pub fn list_tasks(
        &self,
        access: &ProjectAccess,
        limit: u32,
    ) -> Result<Vec<SecretaryTask>, LedgerError> {
        let connection = self.connection()?;
        let access = validate_project_access(&connection, access)?;
        let mut statement = connection.prepare(
            "
            SELECT id, project_id, title, request, status, priority, schedule_at, next_step,
                   public_plan, summary, created_at, updated_at
            FROM secretary_tasks
            WHERE project_id = ?1
               OR (?2 = 1 AND project_id != ?3)
            ORDER BY updated_at DESC, id ASC
            LIMIT ?4
            ",
        )?;
        let tasks = statement
            .query_map(
                params![
                    access.current_project_id,
                    if access.include_cross_project { 1 } else { 0 },
                    LEGACY_PROJECT_ID,
                    bounded_limit(limit),
                ],
                task_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    pub fn update_task(
        &self,
        access: &ProjectAccess,
        id: &str,
        input: UpdateTaskInput,
    ) -> Result<SecretaryTask, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        let existing =
            find_task_in_transaction(&transaction, &id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_write(&access, Some(&existing.project_id))?;
        let task = updated_task_from_input(existing, input)?;
        update_task_record(&transaction, &task)?;
        transaction.commit()?;
        Ok(task)
    }

    /// Creates a direct user-started task, its public start event, and its first recovery
    /// checkpoint in one transaction. No agent work starts until this record is durable.
    pub fn start_task(
        &self,
        access: &ProjectAccess,
        input: StartTaskInput,
    ) -> Result<SecretaryTaskProgress, LedgerError> {
        let StartTaskInput {
            task: task_input,
            events,
            checkpoint,
        } = input;
        validate_task_progress_events(&events)?;
        let mut task = normalized_new_task(task_input)?;
        if !matches!(task.status.as_str(), "queued" | "running") {
            return Err(LedgerError::InvalidInput);
        }
        task.status = "running".into();
        task.schedule_at = None;
        task.updated_at = unix_millis();

        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        authorize_project_write(&access, Some(&task.project_id))?;
        ensure_task_project(&transaction, &task.project_id, false)?;
        insert_task(&transaction, &task)?;
        let events = events
            .into_iter()
            .map(|event| append_task_event(&transaction, &task, event))
            .collect::<Result<Vec<_>, _>>()?;
        let checkpoint = append_task_checkpoint(&transaction, &task, checkpoint)?;
        transaction.commit()?;
        Ok(SecretaryTaskProgress {
            task,
            events,
            checkpoint,
        })
    }

    /// Atomically claims a queued or paused task. The status compare-and-set and the first
    /// durable progress event/checkpoint share a transaction, preventing both double starts and
    /// stranded running tasks when the initial checkpoint cannot be written.
    pub fn claim_task(
        &self,
        access: &ProjectAccess,
        id: &str,
        input: PersistTaskProgressInput,
    ) -> Result<Option<SecretaryTaskProgress>, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let PersistTaskProgressInput {
            mut task,
            events,
            checkpoint,
        } = input;
        validate_task_progress_events(&events)?;
        if task
            .status
            .as_deref()
            .is_some_and(|status| status != "running")
        {
            return Err(LedgerError::InvalidInput);
        }
        task.status = Some("running".into());
        task.schedule_at = TaskFieldPatch::Clear;

        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        let existing =
            find_task_in_transaction(&transaction, &id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_write(&access, Some(&existing.project_id))?;
        if !matches!(existing.status.as_str(), "queued" | "paused") {
            return Ok(None);
        }
        let task = updated_task_from_input(existing, task)?;
        if !update_task_record_if_claimable(&transaction, &task)? {
            return Ok(None);
        }
        let events = events
            .into_iter()
            .map(|event| append_task_event(&transaction, &task, event))
            .collect::<Result<Vec<_>, _>>()?;
        let checkpoint = append_task_checkpoint(&transaction, &task, checkpoint)?;
        transaction.commit()?;
        Ok(Some(SecretaryTaskProgress {
            task,
            events,
            checkpoint,
        }))
    }

    /// Commits a task transition, its observable event(s), and the recovery checkpoint together.
    /// Any validation or SQLite failure rolls the entire transaction back rather than reporting a
    /// partially durable task state as resumable progress.
    pub fn persist_task_progress(
        &self,
        access: &ProjectAccess,
        id: &str,
        input: PersistTaskProgressInput,
    ) -> Result<SecretaryTaskProgress, LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let PersistTaskProgressInput {
            task: task_input,
            events,
            checkpoint,
        } = input;
        validate_task_progress_events(&events)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        let existing =
            find_task_in_transaction(&transaction, &id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_write(&access, Some(&existing.project_id))?;
        let task = updated_task_from_input(existing, task_input)?;
        update_task_record(&transaction, &task)?;
        let events = events
            .into_iter()
            .map(|event| append_task_event(&transaction, &task, event))
            .collect::<Result<Vec<_>, _>>()?;
        let checkpoint = append_task_checkpoint(&transaction, &task, checkpoint)?;
        transaction.commit()?;
        Ok(SecretaryTaskProgress {
            task,
            events,
            checkpoint,
        })
    }

    pub fn delete_task(&self, access: &ProjectAccess, id: &str) -> Result<(), LedgerError> {
        let id = normalize_identifier(id.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        let existing =
            find_task_in_transaction(&transaction, &id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_write(&access, Some(&existing.project_id))?;
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
        access: &ProjectAccess,
        task_id: &str,
        input: RecordEventInput,
    ) -> Result<TaskEvent, LedgerError> {
        let task_id = normalize_identifier(task_id.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        let task =
            find_task_in_transaction(&transaction, &task_id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_write(&access, Some(&task.project_id))?;
        let event = append_task_event(&transaction, &task, input)?;
        transaction.commit()?;
        Ok(event)
    }

    pub fn list_events(
        &self,
        access: &ProjectAccess,
        task_id: &str,
        limit: u32,
    ) -> Result<Vec<TaskEvent>, LedgerError> {
        let task_id = normalize_identifier(task_id.to_string())?;
        let connection = self.connection()?;
        let access = validate_project_access(&connection, access)?;
        let task = find_task(&connection, &task_id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_read(&access, Some(&task.project_id))?;
        let mut statement = connection.prepare(
            "
            SELECT task_id, sequence, event_type, payload, created_at
            FROM secretary_task_events
            WHERE task_id = ?1
            ORDER BY sequence ASC
            LIMIT ?2
            ",
        )?;
        let events = statement
            .query_map(params![task_id, bounded_limit(limit)], event_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(events)
    }

    pub fn save_checkpoint(
        &self,
        access: &ProjectAccess,
        task_id: &str,
        input: SaveCheckpointInput,
    ) -> Result<SecretaryCheckpoint, LedgerError> {
        let task_id = normalize_identifier(task_id.to_string())?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let access = validate_project_access_in_transaction(&transaction, access)?;
        let task =
            find_task_in_transaction(&transaction, &task_id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_write(&access, Some(&task.project_id))?;
        let checkpoint = append_task_checkpoint(&transaction, &task, input)?;
        transaction.commit()?;
        Ok(checkpoint)
    }

    pub fn load_latest_checkpoint(
        &self,
        access: &ProjectAccess,
        task_id: &str,
    ) -> Result<Option<SecretaryCheckpoint>, LedgerError> {
        let task_id = normalize_identifier(task_id.to_string())?;
        let connection = self.connection()?;
        let access = validate_project_access(&connection, access)?;
        let task = find_task(&connection, &task_id)?.ok_or(LedgerError::InvalidInput)?;
        authorize_project_read(&access, Some(&task.project_id))?;
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

        for project in &prepared.projects {
            ensure_import_project_is_new(&transaction, &project.id)?;
        }

        let mut projects_imported = 0u32;
        for project in &prepared.projects {
            insert_project(&transaction, project)?;
            projects_imported += 1;
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

    pub fn clear(&self) -> Result<u64, LedgerError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "
            DELETE FROM secretary_fts;
            DELETE FROM secretary_task_events;
            DELETE FROM secretary_task_checkpoints;
            DELETE FROM secretary_memory_revisions;
            DELETE FROM secretary_tasks;
            DELETE FROM secretary_memories;
            DELETE FROM secretary_projects;
            DELETE FROM secretary_legacy_imports;
            ",
        )?;
        transaction.commit()?;
        // The deletion is durable once the transaction commits. Compaction may be blocked by
        // another reader, but must not turn a completed clear into a reported failure.
        let _ = connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
        drop(connection);
        Ok(ledger_file_size(&self.path))
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
    limit: u32,
) -> Result<Vec<SecretaryProject>, String> {
    with_app_ledger(app, |ledger| ledger.list_projects(include_archived, limit))
}

#[tauri::command]
pub fn secretary_ledger_create_memory(
    app: tauri::AppHandle,
    access: ProjectAccess,
    input: CreateMemoryInput,
) -> Result<SecretaryMemory, String> {
    with_app_ledger(app, |ledger| ledger.create_memory(&access, input))
}

#[tauri::command]
pub fn secretary_ledger_get_memory(
    app: tauri::AppHandle,
    access: ProjectAccess,
    id: String,
) -> Result<Option<SecretaryMemory>, String> {
    with_app_ledger(app, |ledger| ledger.get_memory(&access, &id))
}

#[tauri::command]
pub fn secretary_ledger_list_memories(
    app: tauri::AppHandle,
    access: ProjectAccess,
    limit: u32,
) -> Result<Vec<SecretaryMemory>, String> {
    with_app_ledger(app, |ledger| ledger.list_memories(Some(&access), limit))
}

#[tauri::command]
pub fn secretary_ledger_update_memory(
    app: tauri::AppHandle,
    access: ProjectAccess,
    id: String,
    input: UpdateMemoryInput,
) -> Result<SecretaryMemory, String> {
    with_app_ledger(app, |ledger| ledger.update_memory(&access, &id, input))
}

#[tauri::command]
pub fn secretary_ledger_rollback_memory(
    app: tauri::AppHandle,
    access: ProjectAccess,
    id: String,
    revision: i64,
) -> Result<SecretaryMemory, String> {
    with_app_ledger(app, |ledger| ledger.rollback_memory(&access, &id, revision))
}

#[tauri::command]
pub fn secretary_ledger_delete_memory(
    app: tauri::AppHandle,
    access: ProjectAccess,
    id: String,
) -> Result<(), String> {
    with_app_ledger(app, |ledger| ledger.delete_memory(&access, &id))
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
    access: ProjectAccess,
    input: CreateTaskInput,
) -> Result<SecretaryTask, String> {
    with_app_ledger(app, |ledger| ledger.create_task(&access, input))
}

#[tauri::command]
pub fn secretary_ledger_start_task(
    app: tauri::AppHandle,
    access: ProjectAccess,
    input: StartTaskInput,
) -> Result<SecretaryTaskProgress, String> {
    with_app_ledger(app, |ledger| ledger.start_task(&access, input))
}

#[tauri::command]
pub fn secretary_ledger_claim_task(
    app: tauri::AppHandle,
    access: ProjectAccess,
    id: String,
    input: PersistTaskProgressInput,
) -> Result<Option<SecretaryTaskProgress>, String> {
    with_app_ledger(app, |ledger| ledger.claim_task(&access, &id, input))
}

#[tauri::command]
pub fn secretary_ledger_persist_task_progress(
    app: tauri::AppHandle,
    access: ProjectAccess,
    id: String,
    input: PersistTaskProgressInput,
) -> Result<SecretaryTaskProgress, String> {
    with_app_ledger(app, |ledger| {
        ledger.persist_task_progress(&access, &id, input)
    })
}

#[tauri::command]
pub fn secretary_ledger_get_task(
    app: tauri::AppHandle,
    access: ProjectAccess,
    id: String,
) -> Result<Option<SecretaryTask>, String> {
    with_app_ledger(app, |ledger| ledger.get_task(&access, &id))
}

#[tauri::command]
pub fn secretary_ledger_list_tasks(
    app: tauri::AppHandle,
    access: ProjectAccess,
    limit: u32,
) -> Result<Vec<SecretaryTask>, String> {
    with_app_ledger(app, |ledger| ledger.list_tasks(&access, limit))
}

#[tauri::command]
pub fn secretary_ledger_update_task(
    app: tauri::AppHandle,
    access: ProjectAccess,
    id: String,
    input: UpdateTaskInput,
) -> Result<SecretaryTask, String> {
    with_app_ledger(app, |ledger| ledger.update_task(&access, &id, input))
}

#[tauri::command]
pub fn secretary_ledger_delete_task(
    app: tauri::AppHandle,
    access: ProjectAccess,
    id: String,
) -> Result<(), String> {
    with_app_ledger(app, |ledger| ledger.delete_task(&access, &id))
}

#[tauri::command]
pub fn secretary_ledger_record_event(
    app: tauri::AppHandle,
    access: ProjectAccess,
    task_id: String,
    input: RecordEventInput,
) -> Result<TaskEvent, String> {
    with_app_ledger(app, |ledger| ledger.record_event(&access, &task_id, input))
}

#[tauri::command]
pub fn secretary_ledger_list_events(
    app: tauri::AppHandle,
    access: ProjectAccess,
    task_id: String,
    limit: u32,
) -> Result<Vec<TaskEvent>, String> {
    with_app_ledger(app, |ledger| ledger.list_events(&access, &task_id, limit))
}

#[tauri::command]
pub fn secretary_ledger_save_checkpoint(
    app: tauri::AppHandle,
    access: ProjectAccess,
    task_id: String,
    input: SaveCheckpointInput,
) -> Result<SecretaryCheckpoint, String> {
    with_app_ledger(app, |ledger| {
        ledger.save_checkpoint(&access, &task_id, input)
    })
}

#[tauri::command]
pub fn secretary_ledger_load_latest_checkpoint(
    app: tauri::AppHandle,
    access: ProjectAccess,
    task_id: String,
) -> Result<Option<SecretaryCheckpoint>, String> {
    with_app_ledger(app, |ledger| {
        ledger.load_latest_checkpoint(&access, &task_id)
    })
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
    let sixth_migration_applied = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_schema_migrations WHERE version = 6)",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if sixth_migration_applied == 0 {
        transaction.execute(
            "
            UPDATE secretary_tasks
            SET schedule_at = NULL
            WHERE schedule_at IS NOT NULL
              AND (schedule_at < 0 OR schedule_at > ?1)
            ",
            params![MAX_SAFE_JSON_INTEGER],
        )?;
        transaction.execute(
            "INSERT INTO secretary_schema_migrations(version, applied_at) VALUES (6, unixepoch())",
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
    let total_records = batch
        .projects
        .len()
        .saturating_add(batch.memories.len())
        .saturating_add(batch.tasks.len());
    if batch.projects.len() > MAX_LEGACY_IMPORT_RECORDS
        || batch.memories.len() > MAX_LEGACY_IMPORT_RECORDS
        || batch.tasks.len() > MAX_LEGACY_IMPORT_RECORDS
        || total_records > MAX_LEGACY_IMPORT_RECORDS
    {
        return Err(LedgerError::InvalidInput);
    }
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
            story_project_id: normalize_optional_identifier(project.story_project_id)?,
            chat_id: normalize_optional_identifier(project.chat_id)?,
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
            (MemoryScope::Project, Some(project_id)) => {
                let project_id = normalize_identifier(project_id)?;
                if project_ids.contains(&project_id) {
                    Some(project_id)
                } else {
                    needs_legacy_project = true;
                    Some(LEGACY_PROJECT_ID.into())
                }
            }
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
            Some(project_id) => {
                let project_id = normalize_identifier(project_id)?;
                if project_ids.contains(&project_id) {
                    project_id
                } else {
                    needs_legacy_project = true;
                    LEGACY_PROJECT_ID.into()
                }
            }
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

fn ensure_import_project_is_new(
    transaction: &Transaction<'_>,
    project_id: &str,
) -> Result<(), LedgerError> {
    let exists = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_projects WHERE id = ?1)",
        params![project_id],
        |row| row.get::<_, i64>(0),
    )?;
    if exists != 0 {
        return Err(LedgerError::InvalidInput);
    }
    Ok(())
}

fn insert_project(
    transaction: &Transaction<'_>,
    project: &SecretaryProject,
) -> Result<(), LedgerError> {
    transaction.execute(
        "
        INSERT INTO secretary_projects(
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
    Ok(())
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
        schedule_at: input.schedule_at.map(normalize_schedule_at).transpose()?,
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

fn updated_task_from_input(
    mut task: SecretaryTask,
    input: UpdateTaskInput,
) -> Result<SecretaryTask, LedgerError> {
    let UpdateTaskInput {
        title,
        request,
        status,
        priority,
        schedule_at,
        next_step,
        public_plan,
        summary,
    } = input;
    if let Some(value) = title {
        task.title = normalize_safe_text(value, 240)?;
    }
    if let Some(value) = request {
        task.request = normalize_safe_text(value, 16_000)?;
    }
    if let Some(value) = status {
        task.status = normalize_task_status(value)?;
    }
    if let Some(value) = priority {
        task.priority = value;
    }
    task.schedule_at = match schedule_at {
        TaskFieldPatch::Unchanged => task.schedule_at,
        TaskFieldPatch::Clear => None,
        TaskFieldPatch::Set(value) => Some(normalize_schedule_at(value)?),
    };
    task.next_step = match next_step {
        TaskFieldPatch::Unchanged => task.next_step,
        TaskFieldPatch::Clear => None,
        TaskFieldPatch::Set(value) => Some(normalize_safe_text(value, 4_000)?),
    };
    task.public_plan = match public_plan {
        TaskFieldPatch::Unchanged => task.public_plan,
        TaskFieldPatch::Clear => None,
        TaskFieldPatch::Set(value) => Some(normalize_safe_text(value, 16_000)?),
    };
    task.summary = match summary {
        TaskFieldPatch::Unchanged => task.summary,
        TaskFieldPatch::Clear => None,
        TaskFieldPatch::Set(value) => Some(normalize_safe_text(value, 4_000)?),
    };
    validate_priority(task.priority)?;
    task.updated_at = unix_millis();
    Ok(task)
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

fn normalize_schedule_at(value: i64) -> Result<i64, LedgerError> {
    if !(0..=MAX_SAFE_JSON_INTEGER).contains(&value) {
        return Err(LedgerError::InvalidInput);
    }
    Ok(value)
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
    let changed = transaction.execute(
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
    if changed != 1 {
        return Err(LedgerError::InvalidInput);
    }
    index_task(transaction, task)
}

fn update_task_record_if_claimable(
    transaction: &Transaction<'_>,
    task: &SecretaryTask,
) -> Result<bool, LedgerError> {
    let changed = transaction.execute(
        "
        UPDATE secretary_tasks
        SET title = ?2, request = ?3, status = ?4, priority = ?5, schedule_at = ?6,
            next_step = ?7, public_plan = ?8, summary = ?9, updated_at = ?10
        WHERE id = ?1 AND status IN ('queued', 'paused')
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
    if changed == 0 {
        return Ok(false);
    }
    if changed != 1 {
        return Err(LedgerError::Unavailable);
    }
    index_task(transaction, task)?;
    Ok(true)
}

fn validate_task_progress_events(events: &[RecordEventInput]) -> Result<(), LedgerError> {
    if events.is_empty() || events.len() > MAX_TASK_PROGRESS_EVENTS {
        return Err(LedgerError::InvalidInput);
    }
    Ok(())
}

fn append_task_event(
    transaction: &Transaction<'_>,
    task: &SecretaryTask,
    input: RecordEventInput,
) -> Result<TaskEvent, LedgerError> {
    let event = TaskEvent {
        task_id: task.id.clone(),
        sequence: next_sequence(transaction, "secretary_task_events", &task.id)?,
        event_type: normalize_safe_text(input.event_type, 64)?,
        payload: normalize_safe_json(input.payload, 16_000)?,
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
        transaction,
        &format!("event:{}:{}", event.task_id, event.sequence),
        "event",
        Some(&task.project_id),
        &event.event_type,
        &payload_text,
    )?;
    Ok(event)
}

fn append_task_checkpoint(
    transaction: &Transaction<'_>,
    task: &SecretaryTask,
    input: SaveCheckpointInput,
) -> Result<SecretaryCheckpoint, LedgerError> {
    let checkpoint = SecretaryCheckpoint {
        task_id: task.id.clone(),
        sequence: next_sequence(transaction, "secretary_task_checkpoints", &task.id)?,
        context_snapshot: normalize_safe_json(input.context_snapshot, 16_000)?,
        next_step: normalize_safe_text(input.next_step, 4_000)?,
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
        transaction,
        &format!("checkpoint:{}:{}", checkpoint.task_id, checkpoint.sequence),
        "checkpoint",
        Some(&task.project_id),
        "任务检查点",
        &format!("{} {}", checkpoint.next_step, snapshot_text),
    )?;
    Ok(checkpoint)
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
        "secretary_task_events" => {
            "SELECT COALESCE(MAX(sequence), 0) FROM secretary_task_events WHERE task_id = ?1"
        }
        "secretary_task_checkpoints" => {
            "SELECT COALESCE(MAX(sequence), 0) FROM secretary_task_checkpoints WHERE task_id = ?1"
        }
        _ => return Err(LedgerError::InvalidInput),
    };
    let current: i64 = transaction.query_row(query, params![task_id], |row| row.get(0))?;
    if !(0..MAX_SAFE_JSON_INTEGER).contains(&current) {
        return Err(LedgerError::InvalidInput);
    }
    Ok(current + 1)
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
    let mut budget = SafeJsonBudget {
        remaining_chars: maximum_chars.min(MAX_SAFE_JSON_CHARS),
        remaining_nodes: MAX_SAFE_JSON_NODES,
    };
    validate_safe_json_value(&value, 0, &mut budget)?;
    let serialized = serialize_json(&value)?;
    normalize_safe_text(serialized, maximum_chars)?;
    Ok(value)
}

struct SafeJsonBudget {
    remaining_chars: usize,
    remaining_nodes: usize,
}

fn validate_safe_json_value(
    value: &serde_json::Value,
    depth: usize,
    budget: &mut SafeJsonBudget,
) -> Result<(), LedgerError> {
    if depth > MAX_SAFE_JSON_DEPTH || budget.remaining_nodes == 0 {
        return Err(LedgerError::InvalidInput);
    }
    budget.remaining_nodes -= 1;

    match value {
        serde_json::Value::Null | serde_json::Value::Bool(_) => Ok(()),
        serde_json::Value::Number(number) => {
            let is_safe = number
                .as_i64()
                .map(|value| (-MAX_SAFE_JSON_INTEGER..=MAX_SAFE_JSON_INTEGER).contains(&value))
                .or_else(|| {
                    number
                        .as_u64()
                        .map(|value| value <= MAX_SAFE_JSON_INTEGER as u64)
                })
                .or_else(|| {
                    number.as_f64().map(|value| {
                        value.is_finite() && value.abs() <= MAX_SAFE_JSON_INTEGER as f64
                    })
                })
                .unwrap_or(false);
            is_safe.then_some(()).ok_or(LedgerError::InvalidInput)
        }
        serde_json::Value::String(value) => consume_safe_json_chars(value.chars().count(), budget),
        serde_json::Value::Array(values) => {
            if values.len() > MAX_LIST_RESULTS as usize {
                return Err(LedgerError::InvalidInput);
            }
            for item in values {
                validate_safe_json_value(item, depth + 1, budget)?;
            }
            Ok(())
        }
        serde_json::Value::Object(values) => {
            if values.len() > MAX_SAFE_JSON_KEYS {
                return Err(LedgerError::InvalidInput);
            }
            for (key, item) in values {
                if key.chars().count() > 128
                    || matches!(key.as_str(), "__proto__" | "constructor" | "prototype")
                {
                    return Err(LedgerError::InvalidInput);
                }
                consume_safe_json_chars(key.chars().count(), budget)?;
                validate_safe_json_value(item, depth + 1, budget)?;
            }
            Ok(())
        }
    }
}

fn consume_safe_json_chars(count: usize, budget: &mut SafeJsonBudget) -> Result<(), LedgerError> {
    if count > budget.remaining_chars {
        return Err(LedgerError::InvalidInput);
    }
    budget.remaining_chars -= count;
    Ok(())
}

#[derive(Clone, Debug)]
struct ValidatedProjectAccess {
    current_project_id: String,
    include_cross_project: bool,
}

fn validate_project_access(
    connection: &Connection,
    access: &ProjectAccess,
) -> Result<ValidatedProjectAccess, LedgerError> {
    let access = normalize_project_access(access)?;
    let exists = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_projects WHERE id = ?1)",
        params![access.current_project_id],
        |row| row.get::<_, i64>(0),
    )?;
    if exists == 0 {
        return Err(LedgerError::InvalidInput);
    }
    Ok(access)
}

fn validate_project_access_in_transaction(
    transaction: &Transaction<'_>,
    access: &ProjectAccess,
) -> Result<ValidatedProjectAccess, LedgerError> {
    let access = normalize_project_access(access)?;
    let exists = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM secretary_projects WHERE id = ?1)",
        params![access.current_project_id],
        |row| row.get::<_, i64>(0),
    )?;
    if exists == 0 {
        return Err(LedgerError::InvalidInput);
    }
    Ok(access)
}

fn normalize_project_access(access: &ProjectAccess) -> Result<ValidatedProjectAccess, LedgerError> {
    let current_project_id = normalize_identifier(access.current_project_id.clone())?;
    if current_project_id == LEGACY_PROJECT_ID {
        return Err(LedgerError::InvalidInput);
    }
    Ok(ValidatedProjectAccess {
        current_project_id,
        include_cross_project: access.include_cross_project,
    })
}

fn authorize_project_read(
    access: &ValidatedProjectAccess,
    owner_project_id: Option<&str>,
) -> Result<(), LedgerError> {
    match owner_project_id {
        None => Ok(()),
        Some(LEGACY_PROJECT_ID) => Err(LedgerError::InvalidInput),
        Some(project_id) if project_id == access.current_project_id => Ok(()),
        Some(_) if access.include_cross_project => Ok(()),
        Some(_) => Err(LedgerError::InvalidInput),
    }
}

fn authorize_project_write(
    access: &ValidatedProjectAccess,
    owner_project_id: Option<&str>,
) -> Result<(), LedgerError> {
    match owner_project_id {
        None => Ok(()),
        Some(LEGACY_PROJECT_ID) => Err(LedgerError::InvalidInput),
        Some(project_id) if project_id == access.current_project_id => Ok(()),
        Some(_) => Err(LedgerError::InvalidInput),
    }
}

fn bounded_limit(limit: u32) -> i64 {
    i64::from(limit.clamp(1, MAX_LIST_RESULTS))
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
    let uuid_candidate = is_uuid_candidate_identifier(&value);
    let canonical_uuid = is_canonical_uuid_identifier(&value);
    if value.is_empty()
        || value.chars().count() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
        || (uuid_candidate && !canonical_uuid)
        || (contains_sensitive_input(&value) && !canonical_uuid)
    {
        return Err(LedgerError::InvalidInput);
    }
    Ok(value)
}

fn is_uuid_candidate_identifier(value: &str) -> bool {
    if has_canonical_uuid_layout(value) {
        return true;
    }

    let bytes = value.as_bytes();
    if !bytes
        .iter()
        .all(|byte| byte.is_ascii_hexdigit() || *byte == b'-')
    {
        return false;
    }
    let hex_digits = bytes.iter().filter(|byte| byte.is_ascii_hexdigit()).count();
    let hyphens = bytes.iter().filter(|byte| **byte == b'-').count();
    hex_digits == 32
        || ((28..32).contains(&hex_digits)
            && (3..=5).contains(&hyphens)
            && (32..=40).contains(&bytes.len()))
}

fn has_canonical_uuid_layout(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_alphanumeric()
            }
        })
}

fn is_canonical_uuid_identifier(value: &str) -> bool {
    if !has_canonical_uuid_layout(value) {
        return false;
    }
    let Ok(uuid) = Uuid::parse_str(value) else {
        return false;
    };
    value.eq_ignore_ascii_case(&uuid.hyphenated().to_string())
        && uuid.get_variant() == uuid::Variant::RFC4122
        && uuid.get_version().is_some()
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

fn normalize_optional_identifier(value: Option<String>) -> Result<Option<String>, LedgerError> {
    value.map(normalize_identifier).transpose()
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
        "pwd=",
        "pwd:",
        "api key",
        "api-key",
        "api_key",
        "apikey",
        "x-api-key",
        "access_token",
        "access-token",
        "accesstoken",
        "refresh_token",
        "refresh-token",
        "refreshtoken",
        "id_token",
        "id-token",
        "idtoken",
        "authorization:",
        "bearer ",
        "private key",
        "secret key",
        "otp",
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

    if has_token_assignment(&lowered) {
        return true;
    }

    if has_unlabelled_secret_token(value) {
        return true;
    }

    let financial_markers = [
        "银行卡",
        "信用卡",
        "卡号",
        "银行账户",
        "银行账号",
        "账号",
        "账户",
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

fn has_token_assignment(value: &str) -> bool {
    ["token", "session", "credential", "secret"]
        .iter()
        .any(|name| {
            let quoted = format!("\"{name}\"");
            value.contains(&format!("{name}="))
                || value.contains(&format!("{name}:"))
                || value.contains(&format!("{name} ="))
                || value.contains(&format!("{name} :"))
                || value.contains(&format!("{quoted}:"))
        })
}

fn has_unlabelled_secret_token(value: &str) -> bool {
    has_api_key_like_token(value)
        || has_jwt_like_token(value)
        || has_high_entropy_access_token(value)
        || has_standalone_six_digit_otp(value)
}

fn has_api_key_like_token(value: &str) -> bool {
    value
        .split(|character: char| !is_access_token_character(character))
        .any(|candidate| {
            let suffix = candidate
                .strip_prefix("sk-proj-")
                .or_else(|| candidate.strip_prefix("sk-"));
            suffix.is_some_and(|suffix| {
                suffix.len() >= 16 && suffix.chars().all(is_access_token_character)
            })
        })
}

fn has_jwt_like_token(value: &str) -> bool {
    value
        .split(|character: char| !(is_base64url_character(character) || character == '.'))
        .any(|candidate| {
            let parts = candidate.split('.').collect::<Vec<_>>();
            parts.len() == 3
                && parts[0].starts_with("eyJ")
                && parts
                    .iter()
                    .all(|part| part.len() >= 8 && part.chars().all(is_base64url_character))
        })
}

fn has_high_entropy_access_token(value: &str) -> bool {
    value
        .split(|character: char| !is_access_token_character(character))
        .any(|candidate| {
            if candidate.len() < 32 {
                return false;
            }

            let mut has_letter = false;
            let mut has_digit = false;
            for byte in candidate
                .bytes()
                .filter(|byte| byte.is_ascii_alphanumeric())
            {
                has_letter |= byte.is_ascii_alphabetic();
                has_digit |= byte.is_ascii_digit();
            }
            has_letter && has_digit
        })
}

fn has_standalone_six_digit_otp(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index - start != 6 {
            continue;
        }
        let starts_at_boundary = start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
        let ends_at_boundary = index == bytes.len() || !bytes[index].is_ascii_alphanumeric();
        if starts_at_boundary && ends_at_boundary {
            return true;
        }
    }
    false
}

fn is_access_token_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
}

fn is_base64url_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
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
    if longest_numeric_run >= 10 {
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
    if address_markers.iter().any(|marker| value.contains(marker))
        && value.chars().any(|character| character.is_ascii_digit())
    {
        return true;
    }

    let chinese_address_parts = [
        "省", "市", "区", "县", "镇", "乡", "街", "路", "巷", "号", "栋", "室",
    ];
    let chinese_address_matches = chinese_address_parts
        .iter()
        .filter(|marker| value.contains(**marker))
        .count();
    chinese_address_matches >= 2 && value.chars().any(|character| character.is_ascii_digit())
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
    use std::sync::{Arc, Barrier};
    use std::thread;
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
        assert_eq!(ledger.list_projects(false, 20).unwrap(), vec![created]);

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
        let project_a = access("project-a", false);
        let project_b = access("project-b", false);
        let personal = ledger
            .create_memory(
                &project_a,
                memory_input(MemoryScope::Personal, None, "偏好使用克制的工作语气"),
            )
            .unwrap();
        let active = ledger
            .create_memory(
                &project_a,
                memory_input(
                    MemoryScope::Project,
                    Some("project-a"),
                    "甲项目的工作语气需要克制",
                ),
            )
            .unwrap();
        let foreign = ledger
            .create_memory(
                &project_b,
                memory_input(
                    MemoryScope::Project,
                    Some("project-b"),
                    "乙项目的工作语气需要热情",
                ),
            )
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
        let project_b = access("project-b", false);
        ledger
            .create_memory(
                &project_b,
                memory_input(MemoryScope::Project, Some("project-b"), "乙项目的采访提纲"),
            )
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
        let project_a = access("project-a", false);
        let memory = ledger
            .create_memory(
                &project_a,
                memory_input(
                    MemoryScope::Project,
                    Some("project-a"),
                    "请准备年度合作合同草案并标注待确认条款",
                ),
            )
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
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let result = ledger.create_memory(
            &project_a,
            memory_input(MemoryScope::Personal, None, "我的验证码是 123456，请记住它"),
        );

        assert!(matches!(result, Err(LedgerError::InvalidInput)));
        assert!(ledger
            .list_memories(Some(&project_a), 20)
            .unwrap()
            .is_empty());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn preserves_memory_revisions_and_can_roll_back_to_a_prior_revision() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let memory = ledger
            .create_memory(
                &project_a,
                memory_input(MemoryScope::Personal, None, "第一版写作偏好"),
            )
            .unwrap();
        let edited = ledger
            .update_memory(
                &project_a,
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
        let rolled_back = ledger.rollback_memory(&project_a, &memory.id, 1).unwrap();

        assert_eq!(edited.revision, 2);
        assert_eq!(rolled_back.content, "第一版写作偏好");
        assert_eq!(rolled_back.revision, 3);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn permanently_deletes_memory_revisions_and_fts_entries_together() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let memory = ledger
            .create_memory(
                &project_a,
                memory_input(MemoryScope::Personal, None, "需要永久遗忘的关键词"),
            )
            .unwrap();
        ledger.delete_memory(&project_a, &memory.id).unwrap();

        assert!(ledger.get_memory(&project_a, &memory.id).unwrap().is_none());
        let connection = Connection::open(&path).unwrap();
        let revisions: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_memory_revisions WHERE memory_id = ?1",
                params![memory.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(revisions, 0);
        drop(connection);
        assert!(ledger
            .search(SearchInput {
                query: "永久遗忘关键词".into(),
                current_project_id: "project-a".into(),
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

    fn progress_input(phase: &str) -> PersistTaskProgressInput {
        PersistTaskProgressInput {
            task: UpdateTaskInput {
                title: None,
                request: None,
                status: Some("running".into()),
                priority: None,
                schedule_at: TaskFieldPatch::Clear,
                next_step: TaskFieldPatch::Set("继续整理已保存的资料。".into()),
                public_plan: TaskFieldPatch::Unchanged,
                summary: TaskFieldPatch::Set("秘书任务正在安全推进。".into()),
            },
            events: vec![RecordEventInput {
                event_type: phase.into(),
                payload: serde_json::json!({ "phase": phase, "summary": "秘书任务正在安全推进。" }),
            }],
            checkpoint: SaveCheckpointInput {
                context_snapshot: serde_json::json!({ "phase": phase, "summary": "秘书任务正在安全推进。" }),
                next_step: "继续整理已保存的资料。".into(),
            },
        }
    }

    #[test]
    fn rejects_new_tasks_without_a_valid_project_owner() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);

        assert!(matches!(
            ledger.create_task(&project_a, task_input("missing-project")),
            Err(LedgerError::InvalidInput)
        ));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn atomically_claims_a_queued_task_for_only_one_concurrent_scheduler() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();

        let barrier = Arc::new(Barrier::new(3));
        let first_ledger = ledger.clone();
        let first_access = project_a.clone();
        let first_task_id = task.id.clone();
        let first_barrier = barrier.clone();
        let first = thread::spawn(move || {
            first_barrier.wait();
            first_ledger.claim_task(&first_access, &first_task_id, progress_input("started"))
        });

        let second_ledger = ledger.clone();
        let second_access = project_a.clone();
        let second_task_id = task.id.clone();
        let second_barrier = barrier.clone();
        let second = thread::spawn(move || {
            second_barrier.wait();
            second_ledger.claim_task(&second_access, &second_task_id, progress_input("started"))
        });

        barrier.wait();
        let claims = [
            first.join().unwrap().unwrap(),
            second.join().unwrap().unwrap(),
        ];
        assert_eq!(claims.iter().filter(|claim| claim.is_some()).count(), 1);
        assert_eq!(claims.iter().filter(|claim| claim.is_none()).count(), 1);
        assert_eq!(
            ledger
                .get_task(&project_a, &task.id)
                .unwrap()
                .unwrap()
                .status,
            "running"
        );
        assert_eq!(
            ledger.list_events(&project_a, &task.id, 10).unwrap().len(),
            1
        );
        assert!(ledger
            .load_latest_checkpoint(&project_a, &task.id)
            .unwrap()
            .is_some());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rolls_back_task_transition_when_progress_event_cannot_be_durably_appended() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();

        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "INSERT INTO secretary_task_events(task_id, sequence, event_type, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![task.id, MAX_SAFE_JSON_INTEGER, "seed", "{}", 1_i64],
            )
            .unwrap();
        drop(connection);

        assert!(matches!(
            ledger.persist_task_progress(&project_a, &task.id, progress_input("planned")),
            Err(LedgerError::InvalidInput)
        ));
        let persisted = ledger.get_task(&project_a, &task.id).unwrap().unwrap();
        assert_eq!(persisted.status, "queued");
        assert!(ledger
            .load_latest_checkpoint(&project_a, &task.id)
            .unwrap()
            .is_none());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rolls_back_a_new_task_start_when_its_initial_checkpoint_is_not_persistable() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);

        assert!(matches!(
            ledger.start_task(
                &project_a,
                StartTaskInput {
                    task: task_input("project-a"),
                    events: vec![RecordEventInput {
                        event_type: "started".into(),
                        payload: serde_json::json!({ "phase": "started", "summary": "任务开始" }),
                    }],
                    checkpoint: SaveCheckpointInput {
                        context_snapshot: serde_json::json!({ "token": "must-not-persist" }),
                        next_step: "继续整理。".into(),
                    },
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(ledger.list_tasks(&project_a, 10).unwrap().is_empty());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn orders_events_and_checkpoints_per_task_and_loads_the_latest_checkpoint() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();
        let first_event = ledger
            .record_event(
                &project_a,
                &task.id,
                RecordEventInput {
                    event_type: "plan_ready".into(),
                    payload: serde_json::json!({ "summary": "已生成公开计划" }),
                },
            )
            .unwrap();
        let second_event = ledger
            .record_event(
                &project_a,
                &task.id,
                RecordEventInput {
                    event_type: "tool_receipt".into(),
                    payload: serde_json::json!({ "summary": "已读取会议纪要" }),
                },
            )
            .unwrap();
        ledger
            .save_checkpoint(
                &project_a,
                &task.id,
                SaveCheckpointInput {
                    context_snapshot: serde_json::json!({ "summary": "已读取两份纪要" }),
                    next_step: "整理待办".into(),
                },
            )
            .unwrap();
        let latest = ledger
            .save_checkpoint(
                &project_a,
                &task.id,
                SaveCheckpointInput {
                    context_snapshot: serde_json::json!({ "summary": "待办已完成初稿" }),
                    next_step: "等待用户确认".into(),
                },
            )
            .unwrap();

        assert_eq!((first_event.sequence, second_event.sequence), (1, 2));
        assert_eq!(
            ledger.list_events(&project_a, &task.id, 20).unwrap().len(),
            2
        );
        assert_eq!(
            ledger.load_latest_checkpoint(&project_a, &task.id).unwrap(),
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
        let project_a = access("project-a", false);
        let task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();
        let updated = ledger
            .update_task(
                &project_a,
                &task.id,
                UpdateTaskInput {
                    title: None,
                    request: None,
                    status: Some("paused".into()),
                    priority: None,
                    schedule_at: TaskFieldPatch::Unchanged,
                    next_step: TaskFieldPatch::Unchanged,
                    public_plan: TaskFieldPatch::Unchanged,
                    summary: TaskFieldPatch::Set("等待会议纪要补充".into()),
                },
            )
            .unwrap();

        assert_eq!(updated.status, "paused");
        assert_eq!(ledger.list_tasks(&project_a, 20).unwrap().len(), 1);
        ledger.delete_task(&project_a, &task.id).unwrap();
        assert!(ledger.get_task(&project_a, &task.id).unwrap().is_none());
        assert!(ledger.list_tasks(&project_a, 20).unwrap().is_empty());
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

    #[test]
    fn rejects_unacknowledgeable_task_schedule_timestamps_before_writing() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let mut invalid_create = task_input("project-a");
        invalid_create.schedule_at = Some(-1);

        assert!(matches!(
            ledger.create_task(&project_a, invalid_create),
            Err(LedgerError::InvalidInput)
        ));
        assert!(ledger.list_tasks(&project_a, 20).unwrap().is_empty());

        let task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();
        assert!(matches!(
            ledger.update_task(
                &project_a,
                &task.id,
                UpdateTaskInput {
                    title: None,
                    request: None,
                    status: None,
                    priority: None,
                    schedule_at: TaskFieldPatch::Set(MAX_SAFE_JSON_INTEGER + 1),
                    next_step: TaskFieldPatch::Unchanged,
                    public_plan: TaskFieldPatch::Unchanged,
                    summary: TaskFieldPatch::Unchanged,
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert_eq!(
            ledger
                .get_task(&project_a, &task.id)
                .unwrap()
                .unwrap()
                .schedule_at,
            None
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn distinguishes_missing_and_null_task_patch_fields_and_clears_nullable_values() {
        let missing: UpdateTaskInput = serde_json::from_value(serde_json::json!({})).unwrap();
        let clear: UpdateTaskInput = serde_json::from_value(serde_json::json!({
            "scheduleAt": null,
            "nextStep": null,
            "publicPlan": null,
            "summary": null,
        }))
        .unwrap();
        assert!(matches!(&missing.schedule_at, TaskFieldPatch::Unchanged));
        assert!(matches!(&clear.schedule_at, TaskFieldPatch::Clear));
        assert!(matches!(&clear.next_step, TaskFieldPatch::Clear));

        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let mut input = task_input("project-a");
        input.schedule_at = Some(1_780_000_000_000);
        input.summary = Some("待清空摘要".into());
        let task = ledger.create_task(&project_a, input).unwrap();

        let updated = ledger.update_task(&project_a, &task.id, clear).unwrap();
        assert_eq!(updated.schedule_at, None);
        assert_eq!(updated.next_step, None);
        assert_eq!(updated.public_plan, None);
        assert_eq!(updated.summary, None);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_unparseable_event_and_checkpoint_json_before_committing() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();
        let overlong_array = serde_json::json!({ "entries": vec!["x"; 101] });

        assert!(matches!(
            ledger.record_event(
                &project_a,
                &task.id,
                RecordEventInput {
                    event_type: "plan".into(),
                    payload: overlong_array.clone(),
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.save_checkpoint(
                &project_a,
                &task.id,
                SaveCheckpointInput {
                    context_snapshot: overlong_array,
                    next_step: "不应写入".into(),
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(ledger
            .list_events(&project_a, &task.id, 20)
            .unwrap()
            .is_empty());
        assert!(ledger
            .load_latest_checkpoint(&project_a, &task.id)
            .unwrap()
            .is_none());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_event_and_checkpoint_sequences_past_the_javascript_safe_range_before_committing() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();

        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "
                INSERT INTO secretary_task_events(task_id, sequence, event_type, payload, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                params![
                    &task.id,
                    MAX_SAFE_JSON_INTEGER,
                    "plan",
                    r#"{"summary":"已存在的最大序号事件"}"#,
                    1_i64,
                ],
            )
            .unwrap();
        connection
            .execute(
                "
                INSERT INTO secretary_task_checkpoints(task_id, sequence, context_snapshot, next_step, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                params![
                    &task.id,
                    MAX_SAFE_JSON_INTEGER,
                    r#"{"summary":"已存在的最大序号检查点"}"#,
                    "继续整理",
                    1_i64,
                ],
            )
            .unwrap();
        drop(connection);

        assert!(matches!(
            ledger.record_event(
                &project_a,
                &task.id,
                RecordEventInput {
                    event_type: "plan".into(),
                    payload: serde_json::json!({ "summary": "不应写入" }),
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.save_checkpoint(
                &project_a,
                &task.id,
                SaveCheckpointInput {
                    context_snapshot: serde_json::json!({ "summary": "不应写入" }),
                    next_step: "不应写入".into(),
                },
            ),
            Err(LedgerError::InvalidInput)
        ));

        let connection = Connection::open(&path).unwrap();
        let event_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_task_events WHERE task_id = ?1",
                params![&task.id],
                |row| row.get(0),
            )
            .unwrap();
        let checkpoint_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_task_checkpoints WHERE task_id = ?1",
                params![&task.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(event_rows, 1);
        assert_eq!(checkpoint_rows, 1);
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn round_trips_event_and_checkpoint_payloads_at_the_serialized_json_limit() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();
        let empty_payload = serde_json::json!({ "summary": "" });
        let overhead = serialize_json(&empty_payload).unwrap().chars().count();
        let payload = serde_json::json!({
            "summary": "x".repeat(MAX_SAFE_JSON_CHARS - overhead),
        });
        assert_eq!(
            serialize_json(&payload).unwrap().chars().count(),
            MAX_SAFE_JSON_CHARS
        );

        let event = ledger
            .record_event(
                &project_a,
                &task.id,
                RecordEventInput {
                    event_type: "plan".into(),
                    payload: payload.clone(),
                },
            )
            .unwrap();
        let checkpoint = ledger
            .save_checkpoint(
                &project_a,
                &task.id,
                SaveCheckpointInput {
                    context_snapshot: payload.clone(),
                    next_step: "继续整理".into(),
                },
            )
            .unwrap();

        assert_eq!(event.payload, payload);
        assert_eq!(
            ledger.list_events(&project_a, &task.id, 20).unwrap()[0].payload,
            payload
        );
        assert_eq!(checkpoint.context_snapshot, payload);
        assert_eq!(
            ledger
                .load_latest_checkpoint(&project_a, &task.id)
                .unwrap()
                .unwrap()
                .context_snapshot,
            payload
        );

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

    fn legacy_task(project_id: Option<&str>) -> LegacyTaskInput {
        LegacyTaskInput {
            id: None,
            project_id: project_id.map(str::to_string),
            title: "迁移任务".into(),
            request: "整理迁移任务的资料".into(),
            status: Some("queued".into()),
            priority: Some(3),
            schedule_at: None,
            next_step: None,
            public_plan: None,
            summary: None,
        }
    }

    #[test]
    fn normal_project_apis_reject_and_hide_the_internal_legacy_project() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();

        assert!(matches!(
            ledger.create_project(CreateProjectInput {
                id: Some(LEGACY_PROJECT_ID.into()),
                title: "伪造旧记录".into(),
                kind: "writing".into(),
                story_project_id: None,
                chat_id: None,
            }),
            Err(LedgerError::InvalidInput)
        ));

        create_project(&ledger, "project-a", "甲项目");
        ledger
            .import_legacy_batch(LegacyImportBatch {
                migration_key: "legacy-hidden-project".into(),
                projects: Vec::new(),
                memories: vec![legacy_memory(None, "没有归属的旧记录")],
                tasks: Vec::new(),
            })
            .unwrap();

        for include_archived in [false, true] {
            assert!(ledger
                .list_projects(include_archived, 20)
                .unwrap()
                .iter()
                .all(|project| project.id != LEGACY_PROJECT_ID));
        }

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn legacy_import_rejects_existing_project_collisions_without_writes() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-existing", "现有项目");

        assert!(matches!(
            ledger.import_legacy_batch(LegacyImportBatch {
                migration_key: "foreign-existing-project".into(),
                projects: vec![legacy_project("project-existing", "伪造迁移项目")],
                memories: vec![legacy_memory(Some("project-existing"), "不应写入现有项目")],
                tasks: vec![legacy_task(Some("project-existing"))],
            }),
            Err(LedgerError::InvalidInput)
        ));

        let connection = Connection::open(&path).unwrap();
        let project_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM secretary_projects", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(project_count, 1);
        for table in [
            "secretary_memories",
            "secretary_tasks",
            "secretary_legacy_imports",
        ] {
            let rows: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, 0, "{table} should have no import rows");
        }
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn legacy_import_remaps_foreign_record_owners_to_the_hidden_legacy_project() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-existing", "现有项目");

        ledger
            .import_legacy_batch(LegacyImportBatch {
                migration_key: "remap-foreign-record-owner".into(),
                projects: vec![legacy_project("project-imported", "迁移项目")],
                memories: vec![legacy_memory(Some("project-existing"), "不应归属现有项目")],
                tasks: vec![legacy_task(Some("project-existing"))],
            })
            .unwrap();

        let connection = Connection::open(&path).unwrap();
        let memory_owner: String = connection
            .query_row("SELECT project_id FROM secretary_memories", [], |row| {
                row.get(0)
            })
            .unwrap();
        let task_owner: String = connection
            .query_row("SELECT project_id FROM secretary_tasks", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(memory_owner, LEGACY_PROJECT_ID);
        assert_eq!(task_owner, LEGACY_PROJECT_ID);
        drop(connection);
        assert!(ledger
            .list_projects(true, 20)
            .unwrap()
            .iter()
            .all(|project| project.id != LEGACY_PROJECT_ID));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn legacy_import_caps_the_batch_before_any_write() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        let projects = (0..101)
            .map(|index| legacy_project(&format!("project-{index}"), "过大的迁移项目"))
            .collect();

        assert!(matches!(
            ledger.import_legacy_batch(LegacyImportBatch {
                migration_key: "oversized-legacy-batch".into(),
                projects,
                memories: Vec::new(),
                tasks: Vec::new(),
            }),
            Err(LedgerError::InvalidInput)
        ));
        let connection = Connection::open(&path).unwrap();
        for table in [
            "secretary_projects",
            "secretary_memories",
            "secretary_tasks",
            "secretary_legacy_imports",
        ] {
            let rows: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, 0, "{table} should be empty");
        }
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn legacy_import_rolls_back_after_a_duplicate_memory_insert_attempt() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        let mut first = legacy_memory(Some("project-rollback"), "第一条迁移记录");
        first.id = Some("duplicate-memory".into());
        let mut second = legacy_memory(Some("project-rollback"), "第二条迁移记录");
        second.id = Some("duplicate-memory".into());

        assert!(ledger
            .import_legacy_batch(LegacyImportBatch {
                migration_key: "rollback-after-sql-insert".into(),
                projects: vec![legacy_project("project-rollback", "回滚项目")],
                memories: vec![first, second],
                tasks: Vec::new(),
            })
            .is_err());

        let connection = Connection::open(&path).unwrap();
        for table in [
            "secretary_projects",
            "secretary_memories",
            "secretary_tasks",
            "secretary_legacy_imports",
        ] {
            let rows: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, 0, "{table} should have been rolled back");
        }
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
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
        assert!(ledger.list_projects(true, 20).unwrap().is_empty());
        let connection = Connection::open(ledger.path()).unwrap();
        for table in [
            "secretary_projects",
            "secretary_memories",
            "secretary_tasks",
            "secretary_legacy_imports",
        ] {
            let rows: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, 0, "{table} should have no partial import rows");
        }
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    fn access(project_id: &str, include_cross_project: bool) -> ProjectAccess {
        ProjectAccess {
            current_project_id: project_id.into(),
            include_cross_project,
        }
    }

    #[test]
    fn project_scoped_apis_reject_foreign_records_without_explicit_cross_project_access() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        create_project(&ledger, "project-b", "乙项目");
        let project_a = access("project-a", false);
        let project_b = access("project-b", false);
        let cross_project_a = access("project-a", true);
        let personal = ledger
            .create_memory(
                &project_a,
                memory_input(MemoryScope::Personal, None, "个人写作偏好"),
            )
            .unwrap();
        let foreign_memory = ledger
            .create_memory(
                &project_b,
                memory_input(MemoryScope::Project, Some("project-b"), "乙项目资料"),
            )
            .unwrap();
        let foreign_task = ledger
            .create_task(&project_b, task_input("project-b"))
            .unwrap();
        ledger
            .record_event(
                &project_b,
                &foreign_task.id,
                RecordEventInput {
                    event_type: "receipt".into(),
                    payload: serde_json::json!({ "summary": "乙项目工具回执" }),
                },
            )
            .unwrap();
        ledger
            .save_checkpoint(
                &project_b,
                &foreign_task.id,
                SaveCheckpointInput {
                    context_snapshot: serde_json::json!({ "summary": "乙项目检查点" }),
                    next_step: "继续乙项目".into(),
                },
            )
            .unwrap();

        assert!(matches!(
            ledger.list_memories(None, 20),
            Err(LedgerError::InvalidInput)
        ));
        let default_memories = ledger.list_memories(Some(&project_a), 20).unwrap();
        assert_eq!(default_memories.len(), 1);
        assert_eq!(default_memories[0].id, personal.id);
        assert!(matches!(
            ledger.get_memory(&project_a, &foreign_memory.id),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.update_memory(
                &project_a,
                &foreign_memory.id,
                UpdateMemoryInput {
                    kind: None,
                    content: Some("越权修改".into()),
                    source: None,
                    confidence: None,
                    status: None,
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.delete_memory(&project_a, &foreign_memory.id),
            Err(LedgerError::InvalidInput)
        ));
        assert_eq!(
            ledger
                .get_memory(&cross_project_a, &foreign_memory.id)
                .unwrap()
                .unwrap()
                .id,
            foreign_memory.id
        );
        assert!(ledger
            .list_memories(Some(&cross_project_a), 20)
            .unwrap()
            .iter()
            .any(|memory| memory.id == foreign_memory.id));
        assert!(matches!(
            ledger.create_memory(
                &cross_project_a,
                memory_input(MemoryScope::Project, Some("project-b"), "跨项目新增资料"),
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.update_memory(
                &cross_project_a,
                &foreign_memory.id,
                UpdateMemoryInput {
                    kind: None,
                    content: Some("跨项目修改".into()),
                    source: None,
                    confidence: None,
                    status: None,
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.rollback_memory(&cross_project_a, &foreign_memory.id, 1),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.delete_memory(&cross_project_a, &foreign_memory.id),
            Err(LedgerError::InvalidInput)
        ));
        assert_eq!(
            ledger
                .update_memory(
                    &cross_project_a,
                    &personal.id,
                    UpdateMemoryInput {
                        kind: None,
                        content: Some("更新后的个人写作偏好".into()),
                        source: None,
                        confidence: None,
                        status: None,
                    },
                )
                .unwrap()
                .content,
            "更新后的个人写作偏好"
        );

        assert!(matches!(
            ledger.get_task(&project_a, &foreign_task.id),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.update_task(
                &project_a,
                &foreign_task.id,
                UpdateTaskInput {
                    title: None,
                    request: None,
                    status: Some("paused".into()),
                    priority: None,
                    schedule_at: TaskFieldPatch::Unchanged,
                    next_step: TaskFieldPatch::Unchanged,
                    public_plan: TaskFieldPatch::Unchanged,
                    summary: TaskFieldPatch::Unchanged,
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.delete_task(&project_a, &foreign_task.id),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.record_event(
                &project_a,
                &foreign_task.id,
                RecordEventInput {
                    event_type: "receipt".into(),
                    payload: serde_json::json!({ "summary": "越权" }),
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.list_events(&project_a, &foreign_task.id, 20),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.save_checkpoint(
                &project_a,
                &foreign_task.id,
                SaveCheckpointInput {
                    context_snapshot: serde_json::json!({ "summary": "越权" }),
                    next_step: "越权".into(),
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.load_latest_checkpoint(&project_a, &foreign_task.id),
            Err(LedgerError::InvalidInput)
        ));
        assert!(ledger
            .get_task(&cross_project_a, &foreign_task.id)
            .unwrap()
            .is_some());
        assert!(ledger
            .list_tasks(&cross_project_a, 20)
            .unwrap()
            .iter()
            .any(|task| task.id == foreign_task.id));
        assert_eq!(
            ledger
                .list_events(&cross_project_a, &foreign_task.id, 20)
                .unwrap()
                .len(),
            1
        );
        assert!(ledger
            .load_latest_checkpoint(&cross_project_a, &foreign_task.id)
            .unwrap()
            .is_some());
        assert!(matches!(
            ledger.create_task(&cross_project_a, task_input("project-b")),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.update_task(
                &cross_project_a,
                &foreign_task.id,
                UpdateTaskInput {
                    title: None,
                    request: None,
                    status: Some("paused".into()),
                    priority: None,
                    schedule_at: TaskFieldPatch::Unchanged,
                    next_step: TaskFieldPatch::Unchanged,
                    public_plan: TaskFieldPatch::Unchanged,
                    summary: TaskFieldPatch::Unchanged,
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.delete_task(&cross_project_a, &foreign_task.id),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.record_event(
                &cross_project_a,
                &foreign_task.id,
                RecordEventInput {
                    event_type: "receipt".into(),
                    payload: serde_json::json!({ "summary": "跨项目回执" }),
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.save_checkpoint(
                &cross_project_a,
                &foreign_task.id,
                SaveCheckpointInput {
                    context_snapshot: serde_json::json!({ "summary": "跨项目检查点" }),
                    next_step: "越权".into(),
                },
            ),
            Err(LedgerError::InvalidInput)
        ));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_sensitive_content_before_memory_task_event_or_checkpoint_persistence() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        for sensitive in [
            "api-key=sk-secret",
            "token=super-secret",
            "password: secret",
            "OTP 123456",
            "银行卡 6222021234567890123",
            "身份证 11010519491231002X",
            "联系电话 13800138000",
            "alice@example.com",
            "北京市朝阳区望京街10号",
        ] {
            assert!(matches!(
                ledger.create_memory(
                    &project_a,
                    memory_input(MemoryScope::Project, Some("project-a"), sensitive),
                ),
                Err(LedgerError::InvalidInput)
            ));
        }
        for task in [
            CreateTaskInput {
                request: "api-key=sk-secret".into(),
                ..task_input("project-a")
            },
            CreateTaskInput {
                title: "token=secret".into(),
                ..task_input("project-a")
            },
            CreateTaskInput {
                public_plan: Some("请发送 alice@example.com".into()),
                ..task_input("project-a")
            },
            CreateTaskInput {
                summary: Some("北京市朝阳区望京街10号".into()),
                ..task_input("project-a")
            },
            CreateTaskInput {
                next_step: Some("拨打 13800138000".into()),
                ..task_input("project-a")
            },
        ] {
            assert!(matches!(
                ledger.create_task(&project_a, task),
                Err(LedgerError::InvalidInput)
            ));
        }
        let safe_task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();
        assert!(matches!(
            ledger.record_event(
                &project_a,
                &safe_task.id,
                RecordEventInput {
                    event_type: "receipt".into(),
                    payload: serde_json::json!({ "accessToken": "secret" }),
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.save_checkpoint(
                &project_a,
                &safe_task.id,
                SaveCheckpointInput {
                    context_snapshot: serde_json::json!({ "email": "alice@example.com" }),
                    next_step: "北京市朝阳区望京街10号".into(),
                },
            ),
            Err(LedgerError::InvalidInput)
        ));

        let connection = Connection::open(&path).unwrap();
        for table in [
            "secretary_memories",
            "secretary_tasks",
            "secretary_task_events",
            "secretary_task_checkpoints",
        ] {
            let rows: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, if table == "secretary_tasks" { 1 } else { 0 });
        }
        let rejected_history_fts: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_fts WHERE entity_type IN ('event', 'checkpoint')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rejected_history_fts, 0);
        let rejected_memory_fts: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_fts WHERE entity_type = 'memory'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let accepted_task_fts: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_fts WHERE entity_type = 'task'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rejected_memory_fts, 0);
        assert_eq!(accepted_task_fts, 1);
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_unlabelled_sensitive_values_from_every_persistent_record_kind() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let values = [
            "sk-5rU7mX9qL2vN8cR4yH1dF6pK3sT0wB",
            "sk-proj-M5Zt8q2Ln9Rvx4Hy7CwDa1Kb6Pf3Qs",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLWxvbmc",
            "Qm7pK9xR2vL8nS4dF1hJ6wC3aT5yU0bE",
            "4a1f9c2e7b0d8f3c6e5a1b9d0f2c7e4a8b6d3f1c9e0a5b7d2f8c4e6a1b0d9f3c",
            "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
            "123456",
        ];

        for value in values {
            assert!(matches!(
                ledger.create_memory(
                    &project_a,
                    memory_input(MemoryScope::Project, Some("project-a"), value),
                ),
                Err(LedgerError::InvalidInput)
            ));
            assert!(matches!(
                ledger.create_task(
                    &project_a,
                    CreateTaskInput {
                        request: value.into(),
                        ..task_input("project-a")
                    },
                ),
                Err(LedgerError::InvalidInput)
            ));
        }

        let safe_task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();
        for value in values {
            assert!(matches!(
                ledger.record_event(
                    &project_a,
                    &safe_task.id,
                    RecordEventInput {
                        event_type: "receipt".into(),
                        payload: serde_json::json!({ "summary": value }),
                    },
                ),
                Err(LedgerError::InvalidInput)
            ));
            assert!(matches!(
                ledger.save_checkpoint(
                    &project_a,
                    &safe_task.id,
                    SaveCheckpointInput {
                        context_snapshot: serde_json::json!({ "summary": value }),
                        next_step: "等待确认".into(),
                    },
                ),
                Err(LedgerError::InvalidInput)
            ));
        }

        let connection = Connection::open(&path).unwrap();
        for table in [
            "secretary_memories",
            "secretary_task_events",
            "secretary_task_checkpoints",
        ] {
            let rows: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, 0, "{table} must not retain rejected input");
        }
        let task_rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM secretary_tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(task_rows, 1);
        let fts_rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM secretary_fts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fts_rows, 1, "only the safe task may be indexed");
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_separator_obscured_compact_tokens_before_any_persistence_or_fts_write() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let dash_token = "AbcDefGhIjKlMnOpQrStUvWxYz-1A2B3C4D";
        let underscore_token = "AbcDefGhIjKlMnOpQrStUvWxYz_1A2B3C4D";
        let ordinary_app_id = "papyrus-agent-1";

        assert!(!contains_sensitive_input(ordinary_app_id));
        ledger
            .create_memory(
                &project_a,
                memory_input(MemoryScope::Project, Some("project-a"), ordinary_app_id),
            )
            .unwrap();
        let safe_task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();

        for token in [dash_token, underscore_token] {
            assert!(matches!(
                ledger.create_memory(
                    &project_a,
                    memory_input(MemoryScope::Project, Some("project-a"), token),
                ),
                Err(LedgerError::InvalidInput)
            ));
            assert!(matches!(
                ledger.create_task(
                    &project_a,
                    CreateTaskInput {
                        request: token.into(),
                        ..task_input("project-a")
                    },
                ),
                Err(LedgerError::InvalidInput)
            ));
            assert!(matches!(
                ledger.record_event(
                    &project_a,
                    &safe_task.id,
                    RecordEventInput {
                        event_type: "receipt".into(),
                        payload: serde_json::json!({ "summary": token }),
                    },
                ),
                Err(LedgerError::InvalidInput)
            ));
            assert!(matches!(
                ledger.save_checkpoint(
                    &project_a,
                    &safe_task.id,
                    SaveCheckpointInput {
                        context_snapshot: serde_json::json!({ "summary": token }),
                        next_step: "等待确认".into(),
                    },
                ),
                Err(LedgerError::InvalidInput)
            ));
        }

        let connection = Connection::open(&path).unwrap();
        for table in [
            "secretary_memories",
            "secretary_tasks",
            "secretary_task_events",
            "secretary_task_checkpoints",
            "secretary_fts",
        ] {
            let rows: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(
                rows,
                match table {
                    "secretary_memories" | "secretary_tasks" => 1,
                    "secretary_fts" => 2,
                    _ => 0,
                },
                "{table} must not retain a separator-obscured compact token"
            );
        }
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rollback_rejects_seeded_separator_obscured_token_revision_without_changing_memory_or_fts() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let memory = ledger
            .create_memory(
                &project_a,
                memory_input(MemoryScope::Project, Some("project-a"), "初始安全内容"),
            )
            .unwrap();
        let current = ledger
            .update_memory(
                &project_a,
                &memory.id,
                UpdateMemoryInput {
                    kind: None,
                    content: Some("当前安全内容".into()),
                    source: None,
                    confidence: None,
                    status: None,
                },
            )
            .unwrap();

        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "UPDATE secretary_memory_revisions SET content = ?3 WHERE memory_id = ?1 AND revision = ?2",
                params![
                    memory.id,
                    1,
                    "AbcDefGhIjKlMnOpQrStUvWxYz_1A2B3C4D"
                ],
            )
            .unwrap();
        let revisions_before: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_memory_revisions WHERE memory_id = ?1",
                params![memory.id],
                |row| row.get(0),
            )
            .unwrap();
        let fts_before: String = connection
            .query_row(
                "SELECT content FROM secretary_fts WHERE entity_type = 'memory' AND record_id = ?1",
                params![memory.id],
                |row| row.get(0),
            )
            .unwrap();
        drop(connection);

        assert!(matches!(
            ledger.rollback_memory(&project_a, &memory.id, 1),
            Err(LedgerError::InvalidInput)
        ));
        let after = ledger.get_memory(&project_a, &memory.id).unwrap().unwrap();
        assert_eq!(after.content, current.content);
        assert_eq!(after.revision, current.revision);

        let connection = Connection::open(&path).unwrap();
        let revisions_after: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_memory_revisions WHERE memory_id = ?1",
                params![memory.id],
                |row| row.get(0),
            )
            .unwrap();
        let fts_after: String = connection
            .query_row(
                "SELECT content FROM secretary_fts WHERE entity_type = 'memory' AND record_id = ?1",
                params![memory.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(revisions_after, revisions_before);
        assert_eq!(fts_after, fts_before);
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_sensitive_client_identifiers_before_database_or_fts_write() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        let canonical_uuid = Uuid::new_v4().to_string();
        assert_eq!(
            normalize_identifier(canonical_uuid.clone()).unwrap(),
            canonical_uuid
        );
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let api_key_id = "sk-5rU7mX9qL2vN8cR4yH1dF6pK3sT0wB";
        let project_api_key_id = "sk-proj-M5Zt8q2Ln9Rvx4Hy7CwDa1Kb6Pf3Qs";
        let jwt_id = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLWxvbmc";
        let hex_id = "4a1f9c2e7b0d8f3c6e5a1b9d0f2c7e4a8b6d3f1c9e0a5b7d2f8c4e6a1b0d9f3c";
        let uuid_shaped_token = "4a1f9c2e-7b0d-8f3c-6e5a-1b9d0f2c7e4a";
        let nil_uuid_id = "00000000-0000-0000-0000-000000000000";
        let versionless_uuid_id = "4a1f9c2e-7b0d-0f3c-8e5a-1b9d0f2c7e4a";
        let otp_id = "123456";

        for identifier in [
            api_key_id,
            project_api_key_id,
            jwt_id,
            hex_id,
            uuid_shaped_token,
            nil_uuid_id,
            versionless_uuid_id,
            otp_id,
        ] {
            assert!(matches!(
                normalize_identifier(identifier.into()),
                Err(LedgerError::InvalidInput)
            ));
        }
        assert!(matches!(
            ledger.create_memory(
                &project_a,
                CreateMemoryInput {
                    id: Some(api_key_id.into()),
                    ..memory_input(MemoryScope::Project, Some("project-a"), "不应写入的记忆")
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.create_task(
                &project_a,
                CreateTaskInput {
                    id: Some(jwt_id.into()),
                    ..task_input("project-a")
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.create_project(CreateProjectInput {
                id: Some(hex_id.into()),
                title: "不应写入的项目".into(),
                kind: "writing".into(),
                story_project_id: None,
                chat_id: None,
            }),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.import_legacy_batch(LegacyImportBatch {
                migration_key: "sensitive-import-id".into(),
                projects: vec![legacy_project(otp_id, "不应导入的项目")],
                memories: Vec::new(),
                tasks: Vec::new(),
            }),
            Err(LedgerError::InvalidInput)
        ));

        let connection = Connection::open(&path).unwrap();
        let projects: i64 = connection
            .query_row("SELECT COUNT(*) FROM secretary_projects", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(projects, 1);
        for table in [
            "secretary_memories",
            "secretary_tasks",
            "secretary_fts",
            "secretary_legacy_imports",
        ] {
            let rows: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, 0, "{table} must not retain a sensitive identifier");
        }
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_compact_or_mislaid_uuid_candidates_before_project_memory_task_or_fts_write() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        let compact_candidate = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let malformed_candidate = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa-";
        let truncated_candidate = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa";
        let non_hex_uuid_shape = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaag";
        let canonical_uuid = Uuid::new_v4().to_string();
        assert_eq!(
            normalize_identifier(canonical_uuid.clone()).unwrap(),
            canonical_uuid
        );
        assert_eq!(
            normalize_identifier("project-a".into()).unwrap(),
            "project-a"
        );
        for identifier in [
            compact_candidate,
            malformed_candidate,
            truncated_candidate,
            non_hex_uuid_shape,
        ] {
            assert!(matches!(
                normalize_identifier(identifier.into()),
                Err(LedgerError::InvalidInput)
            ));
        }

        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        assert!(matches!(
            ledger.create_project(CreateProjectInput {
                id: Some(compact_candidate.into()),
                title: "不应写入的项目".into(),
                kind: "writing".into(),
                story_project_id: None,
                chat_id: None,
            }),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.create_memory(
                &project_a,
                CreateMemoryInput {
                    id: Some(truncated_candidate.into()),
                    ..memory_input(MemoryScope::Project, Some("project-a"), "不应写入的记忆")
                },
            ),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.create_task(
                &project_a,
                CreateTaskInput {
                    id: Some(non_hex_uuid_shape.into()),
                    ..task_input("project-a")
                },
            ),
            Err(LedgerError::InvalidInput)
        ));

        let connection = Connection::open(&path).unwrap();
        let projects: i64 = connection
            .query_row("SELECT COUNT(*) FROM secretary_projects", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(projects, 1);
        for table in ["secretary_memories", "secretary_tasks", "secretary_fts"] {
            let rows: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, 0, "{table} must not retain a UUID candidate");
        }
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn project_link_identifiers_reject_uuid_candidates_in_normal_and_legacy_imports() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        let version_zero_uuid = "4a1f9c2e-7b0d-0f3c-8e5a-1b9d0f2c7e4a";
        let malformed_candidate = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa-";
        let truncated_candidate = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa";
        let non_hex_uuid_shape = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaag";

        assert!(matches!(
            ledger.create_project(CreateProjectInput {
                id: Some("normal-story-invalid".into()),
                title: "无效 story 链接".into(),
                kind: "writing".into(),
                story_project_id: Some(non_hex_uuid_shape.into()),
                chat_id: None,
            }),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.create_project(CreateProjectInput {
                id: Some("normal-chat-invalid".into()),
                title: "无效 chat 链接".into(),
                kind: "writing".into(),
                story_project_id: None,
                chat_id: Some(truncated_candidate.into()),
            }),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.import_legacy_batch(LegacyImportBatch {
                migration_key: "legacy-story-invalid".into(),
                projects: vec![LegacyProjectInput {
                    id: "legacy-story-invalid".into(),
                    title: "无效迁移 story 链接".into(),
                    kind: "writing".into(),
                    story_project_id: Some(malformed_candidate.into()),
                    chat_id: None,
                }],
                memories: Vec::new(),
                tasks: Vec::new(),
            }),
            Err(LedgerError::InvalidInput)
        ));
        assert!(matches!(
            ledger.import_legacy_batch(LegacyImportBatch {
                migration_key: "legacy-chat-invalid".into(),
                projects: vec![LegacyProjectInput {
                    id: "legacy-chat-invalid".into(),
                    title: "无效迁移 chat 链接".into(),
                    kind: "writing".into(),
                    story_project_id: None,
                    chat_id: Some(version_zero_uuid.into()),
                }],
                memories: Vec::new(),
                tasks: Vec::new(),
            }),
            Err(LedgerError::InvalidInput)
        ));

        let imported = ledger
            .import_legacy_batch(LegacyImportBatch {
                migration_key: "legacy-safe-links".into(),
                projects: vec![LegacyProjectInput {
                    id: "legacy-safe-project".into(),
                    title: "安全迁移链接".into(),
                    kind: "writing".into(),
                    story_project_id: Some("legacy-story-a".into()),
                    chat_id: Some("legacy-chat-a".into()),
                }],
                memories: Vec::new(),
                tasks: Vec::new(),
            })
            .unwrap();
        assert!(imported.imported);
        let safe_project = ledger
            .list_projects(false, 20)
            .unwrap()
            .into_iter()
            .find(|project| project.id == "legacy-safe-project")
            .unwrap();
        assert_eq!(
            safe_project.story_project_id.as_deref(),
            Some("legacy-story-a")
        );
        assert_eq!(safe_project.chat_id.as_deref(), Some("legacy-chat-a"));

        let connection = Connection::open(&path).unwrap();
        let projects: i64 = connection
            .query_row("SELECT COUNT(*) FROM secretary_projects", [], |row| {
                row.get(0)
            })
            .unwrap();
        let imports: i64 = connection
            .query_row("SELECT COUNT(*) FROM secretary_legacy_imports", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(projects, 1);
        assert_eq!(imports, 1);
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rollback_rejects_tampered_sensitive_revisions_before_changing_memory_or_fts() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let memory = ledger
            .create_memory(
                &project_a,
                memory_input(MemoryScope::Project, Some("project-a"), "初始安全内容"),
            )
            .unwrap();
        let current = ledger
            .update_memory(
                &project_a,
                &memory.id,
                UpdateMemoryInput {
                    kind: None,
                    content: Some("当前安全内容".into()),
                    source: None,
                    confidence: None,
                    status: None,
                },
            )
            .unwrap();

        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "UPDATE secretary_memory_revisions SET content = ?3 WHERE memory_id = ?1 AND revision = ?2",
                params![memory.id, 1, "sk-proj-M5Zt8q2Ln9Rvx4Hy7CwDa1Kb6Pf3Qs"],
            )
            .unwrap();
        let revisions_before: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_memory_revisions WHERE memory_id = ?1",
                params![memory.id],
                |row| row.get(0),
            )
            .unwrap();
        let fts_before: String = connection
            .query_row(
                "SELECT content FROM secretary_fts WHERE entity_type = 'memory' AND record_id = ?1",
                params![memory.id],
                |row| row.get(0),
            )
            .unwrap();
        drop(connection);

        assert!(matches!(
            ledger.rollback_memory(&project_a, &memory.id, 1),
            Err(LedgerError::InvalidInput)
        ));
        let after = ledger.get_memory(&project_a, &memory.id).unwrap().unwrap();
        assert_eq!(after.content, current.content);
        assert_eq!(after.revision, current.revision);

        let connection = Connection::open(&path).unwrap();
        let revisions_after: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_memory_revisions WHERE memory_id = ?1",
                params![memory.id],
                |row| row.get(0),
            )
            .unwrap();
        let fts_after: String = connection
            .query_row(
                "SELECT content FROM secretary_fts WHERE entity_type = 'memory' AND record_id = ?1",
                params![memory.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(revisions_after, revisions_before);
        assert_eq!(fts_after, fts_before);
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn clear_removes_ledger_records_and_retains_a_usable_schema() {
        let directory = test_dir();
        let path = directory.join("papyrus-secretary.sqlite3");
        let ledger = SecretaryLedger::open_at(&path).unwrap();
        create_project(&ledger, "project-a", "甲项目");
        let project_a = access("project-a", false);
        let memory = ledger
            .create_memory(
                &project_a,
                memory_input(MemoryScope::Project, Some("project-a"), "待清空资料"),
            )
            .unwrap();
        let task = ledger
            .create_task(&project_a, task_input("project-a"))
            .unwrap();
        ledger
            .record_event(
                &project_a,
                &task.id,
                RecordEventInput {
                    event_type: "receipt".into(),
                    payload: serde_json::json!({ "summary": "待清空事件" }),
                },
            )
            .unwrap();
        ledger
            .save_checkpoint(
                &project_a,
                &task.id,
                SaveCheckpointInput {
                    context_snapshot: serde_json::json!({ "summary": "待清空检查点" }),
                    next_step: "清空".into(),
                },
            )
            .unwrap();
        ledger
            .import_legacy_batch(LegacyImportBatch {
                migration_key: "clear-test-import".into(),
                projects: Vec::new(),
                memories: Vec::new(),
                tasks: Vec::new(),
            })
            .unwrap();

        let bytes = ledger.clear().unwrap();
        assert_eq!(bytes, ledger_file_size(&path));
        let connection = Connection::open(&path).unwrap();
        for table in [
            "secretary_projects",
            "secretary_memories",
            "secretary_memory_revisions",
            "secretary_tasks",
            "secretary_task_events",
            "secretary_task_checkpoints",
            "secretary_fts",
            "secretary_legacy_imports",
        ] {
            let rows: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, 0, "{table} should be empty");
        }
        let migrations: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM secretary_schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migrations, SECRETARY_LEDGER_SCHEMA_VERSION);
        drop(connection);
        assert!(ledger.health().unwrap().bytes > 0);
        create_project(&ledger, "project-after-clear", "仍可用");
        assert_eq!(ledger.list_projects(false, 20).unwrap().len(), 1);
        assert_eq!(memory.revision, 1);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn list_operations_cap_each_response_at_one_hundred_records() {
        let directory = test_dir();
        let ledger = SecretaryLedger::open_at(directory.join("papyrus-secretary.sqlite3")).unwrap();
        for index in 0..101 {
            create_project(
                &ledger,
                &format!("project-{index}"),
                &format!("项目 {index}"),
            );
        }
        let project_a = access("project-0", false);
        for index in 0..101 {
            ledger
                .create_memory(
                    &project_a,
                    memory_input(
                        MemoryScope::Project,
                        Some("project-0"),
                        &format!("资料 {index}"),
                    ),
                )
                .unwrap();
            ledger
                .create_task(
                    &project_a,
                    CreateTaskInput {
                        title: format!("任务 {index}"),
                        ..task_input("project-0")
                    },
                )
                .unwrap();
        }
        let event_task = ledger
            .create_task(&project_a, task_input("project-0"))
            .unwrap();
        for index in 0..101 {
            ledger
                .record_event(
                    &project_a,
                    &event_task.id,
                    RecordEventInput {
                        event_type: "receipt".into(),
                        payload: serde_json::json!({ "summary": format!("事件 {index}") }),
                    },
                )
                .unwrap();
        }

        assert_eq!(ledger.list_projects(false, 999).unwrap().len(), 100);
        assert_eq!(
            ledger.list_memories(Some(&project_a), 999).unwrap().len(),
            100
        );
        assert_eq!(ledger.list_tasks(&project_a, 999).unwrap().len(), 100);
        assert_eq!(
            ledger
                .list_events(&project_a, &event_task.id, 999)
                .unwrap()
                .len(),
            100
        );

        fs::remove_dir_all(directory).unwrap();
    }
}
