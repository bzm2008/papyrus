import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  defaultProviderConfigs,
  getEffectiveContextLimit,
  getModelContextSource,
  isProviderValidated,
  mergeProviderConfigs,
  providerOrder,
  providerValidationSignature,
  type CustomContextTier,
  type LlmProviderConfig,
  type ModelContextSource,
  type ProviderId,
} from '../services/modelCatalog'
import { estimateTokens } from '../services/tokenizer'
import { defaultVibeId, type VibeId } from '../services/vibeWriting'

export { providerOrder }
export type { CustomContextTier, LlmProviderConfig, ModelContextSource, ProviderId }

export type AppMode = 'companion' | 'flow'
export type ColumnMode = 1 | 2 | 3
export type StudioAgentId = string
export type FlowAgentId = StudioAgentId
export type FlowReviewMode = 'auto' | 'review'
export type FlowThinkingEffort = 'low' | 'medium' | 'high' | 'ultra_hive'
export type ModelRoutingMode = 'manual' | 'auto'
export type ModelCapabilityTier = 'T1' | 'T2' | 'T3'
export type ChatRole = 'user' | 'assistant' | 'system'
export type LlmRunState = 'idle' | 'running' | 'reconnecting' | 'error'
export type CompressionState = 'idle' | 'running' | 'error'
export type AgentTodoStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'skipped'
export type FlowTraceStatus = 'pending' | 'running' | 'completed' | 'error'
export type FlowTraceKind = 'plan' | 'agent' | 'tool' | 'document' | 'memory'
export type AgentStepType = 'plan' | 'tool' | 'sub_agent' | 'generation'
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'error'
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type AgentRunSource = 'local' | 'remote' | 'system'
export type AgentMemoryScope = 'global' | 'chat' | 'project' | 'remote'
export type AgentMemoryKind =
  | 'preference'
  | 'fact'
  | 'style'
  | 'resource'
  | 'run_summary'
  | 'remote_contact'
  | 'task_pattern'
  | 'decision'
  | 'identity'
  | 'habit'
  | 'constraint'
export type AgentMemoryStatus = 'active' | 'tentative' | 'archived'
export type MaintenanceTab = 'connections' | 'models' | 'memory'
export type MaintenanceCheckId = 'tauri' | 'sqlite' | 'llm'
export type MaintenanceCheckStatus = 'idle' | 'checking' | 'ok' | 'warning' | 'error'
export type DocumentPatchOperation =
  | 'insert_at_cursor'
  | 'append_section'
  | 'replace_selection'
  | 'replace_document'
export type DocumentPatchStatus = 'pending' | 'approved' | 'applied' | 'rejected'
export type ImportedResourceType = 'txt' | 'md' | 'docx' | 'html' | 'folder' | 'unknown'
export type StoryStrand = 'quest' | 'fire' | 'constellation'
export type StoryEventType =
  | 'character_state_changed'
  | 'relationship_changed'
  | 'world_rule_revealed'
  | 'timeline_event'
  | 'open_loop_created'
  | 'open_loop_closed'
  | 'reader_promise_created'
  | 'artifact_obtained'
  | 'scene_committed'
export type StoryMemoryCategory =
  | 'character_state'
  | 'story_fact'
  | 'world_rule'
  | 'timeline'
  | 'open_loop'
  | 'reader_promise'
  | 'relationship'
export type StoryCommitStatus = 'accepted' | 'rejected'
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'unavailable'
  | 'error'

export type RemoteRelayPlatform =
  | 'clawbot'
  | 'feishu'
  | 'wecom'
  | 'qq'
  | 'wechat'
  | 'custom'
export type RemoteRelayMode = 'companion' | 'flow'
export type RemoteRelayStatus = 'idle' | 'connecting' | 'online' | 'error'
export type RemotePlatformCredentialStatus = 'idle' | 'testing' | 'ok' | 'error'

export type RemotePlatformCredential = {
  platform: Extract<RemoteRelayPlatform, 'feishu' | 'qq' | 'wecom'>
  appId: string
  secret: string
  enabled: boolean
  status: RemotePlatformCredentialStatus
  lastError?: string
  updatedAt?: number
}

export type ScallionAuthStatus =
  | 'idle'
  | 'starting'
  | 'polling'
  | 'reconnecting'
  | 'approved'
  | 'expired'
  | 'denied'
  | 'error'

export type ScallionSyncStatus = 'idle' | 'syncing' | 'ready' | 'stale' | 'error'

export type ScallionSyncChannelState = {
  status: ScallionSyncStatus
  error?: string
  attemptedAt?: number
  updatedAt?: number
}

export type ScallionSyncState = {
  models: ScallionSyncChannelState
  quota: ScallionSyncChannelState
}

export type ScallionUser = {
  id: number | string
  username: string
  avatar_url?: string
  points?: number
  balance?: number
  is_member?: boolean
  member_type?: string
  member_expires_at?: string
  level?: number
  level_name?: string
}

export type ScallionModelMetadata = {
  id: string
  label: string
  modelName: string
  name?: string
  provider?: string
  billingMode?: string
  callPrice?: number
  contextWindowLabel?: string
  /** Whether the current plan can select this model explicitly. */
  manualAvailable?: boolean
  /** Whether the current plan's Auto pool can route to this model. */
  autoAvailable?: boolean
  /** Convenience flag returned by the gateway for Auto-only models. */
  autoOnly?: boolean
  planAvailable?: boolean
  requiredPlan?: string
  autoRequiredPlan?: string
  availabilityReason?: string
  contextWindowTokens?: number
  available: boolean
  tier?: ModelCapabilityTier
  score?: number
  rationale?: string
  updatedAt: number
}

export type ScallionPlan = {
  key: string
  name: string
  expiresAt?: string | null
  availableModels: string[]
  manualModels?: string[]
  autoModels?: string[]
  autoMonthlyCalls?: number
  autoDailyCalls?: number
  externalApi?: boolean | string
  updatedAt: number
}

export type ModelTierAssessment = {
  id: string
  providerId: ProviderId
  label: string
  modelName: string
  tier: ModelCapabilityTier
  score: number
  rationale: string
  available: boolean
  contextWindowTokens?: number
  updatedAt: number
}

export type HardwareCapabilityProfile = {
  cpuCores: number
  memoryGb?: number
  gpuLabel?: string
  tier?: 'low' | 'medium' | 'high' | 'ultra'
  maxHiveAgents: number
  maxHiveParallelAgents: number
  reason: string
  updatedAt: number
}

export type ScallionQuota = {
  remaining: number
  pointsBalance?: number
  balance?: number
  quota?: number
  unifiedPoints?: boolean
  planKey?: string
  planName?: string
  planExpiresAt?: string | null
  total?: number
  unit: string
  isMember: boolean
  manualModels?: string[]
  autoModels?: string[]
  autoMonthlyCalls?: number
  autoDailyCalls?: number
  autoMonthlyUsed?: number
  autoDailyUsed?: number
  autoMonthlyRemaining?: number
  autoDailyRemaining?: number
  externalApi?: boolean | string
  memberPriceLabel: string
  upgradeUrl: string
  topUpUrl: string
  updatedAt: number
}

export type FlowMessage = {
  id: string
  role: ChatRole
  agentId?: FlowAgentId
  content: string
  createdAt: number
}

export type CompanionMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export type ChatSession = {
  id: string
  title: string
  messages: FlowMessage[]
  articleId?: string
  articleIds: string[]
  activeArticleId?: string
  pinned?: boolean
  createdAt: number
  updatedAt: number
}

export type ArticleRecord = {
  id: string
  chatId?: string
  title: string
  text: string
  html: string
  pinned?: boolean
  createdAt: number
  updatedAt: number
}

export type AgentTodo = {
  id: string
  agentRunId?: string
  title: string
  detail: string
  status: AgentTodoStatus
  agentId: FlowAgentId
  createdAt: number
  updatedAt: number
}

export type FlowTrace = {
  id: string
  agentRunId?: string
  kind: FlowTraceKind
  title: string
  detail: string
  status: FlowTraceStatus
  agentId?: FlowAgentId
  toolName?: string
  sources?: Array<{
    title: string
    url?: string
    excerpt?: string
  }>
  startedAt: number
  endedAt?: number
}

export type AgentStep = {
  id: string
  agentRunId?: string
  type: AgentStepType
  title: string
  status: AgentStepStatus
  content?: string
  details?: string
  isExpanded: boolean
  agentId?: FlowAgentId
  toolName?: string
  sources?: Array<{
    title: string
    url?: string
    excerpt?: string
  }>
  startedAt: number
  endedAt?: number
}

export type AgentStepEvent =
  | {
      id?: string
      agentRunId?: string
      type: AgentStepType
      title: string
      content?: string
      details?: string
      agentId?: FlowAgentId
      toolName?: string
    }
  | {
      id: string
      delta: string
    }
  | {
      id: string
      status: AgentStepStatus
      content?: string
      details?: string
      sources?: AgentStep['sources']
    }

export type MaintenanceCheck = {
  id: MaintenanceCheckId
  label: string
  status: MaintenanceCheckStatus
  message: string
  latencyMs?: number
  checkedAt?: number
}

export type DocumentPatch = {
  id: string
  operation: DocumentPatchOperation
  content: string
  title: string
  status: DocumentPatchStatus
  chapterId?: string
  commitIntent?: boolean
  memoryExtractionRequired?: boolean
  targetArticleId?: string
  targetChatId?: string
  createArticle?: boolean
  createdAt: number
}

export type StoryProject = {
  id: string
  chatId: string
  title: string
  genre: string
  targetScale: string
  premise: string
  protagonist: string
  coreConflict: string
  createdAt: number
  updatedAt: number
}

export type StoryContract = {
  id: string
  projectId: string
  title: string
  genre: string
  premise: string
  tone: string
  rules: string[]
  taboos: string[]
  readerPromise: string
  createdAt: number
  updatedAt: number
}

export type ChapterContract = {
  id: string
  projectId: string
  chapterNumber: number
  title: string
  goal: string
  requiredBeats: string[]
  forbiddenZones: string[]
  activeCharacters: string[]
  endingHook: string
  strand: StoryStrand
  createdAt: number
}

export type ReviewContract = {
  id: string
  chapterId: string
  checks: string[]
  blockingRules: string[]
  createdAt: number
}

export type StoryReviewIssue = {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: 'continuity' | 'setting' | 'character' | 'timeline' | 'logic' | 'ai_flavor' | 'pacing' | 'other'
  evidence: string
  fixHint: string
  blocking: boolean
}

export type ChapterCommit = {
  id: string
  projectId: string
  chapterId: string
  articleId?: string
  status: StoryCommitStatus
  summary: string
  wordCount: number
  dominantStrand: StoryStrand
  issues: StoryReviewIssue[]
  createdAt: number
}

export type StoryEvent = {
  id: string
  projectId: string
  chapterId: string
  type: StoryEventType
  subject: string
  content: string
  createdAt: number
}

export type MemoryItem = {
  id: string
  projectId: string
  category: StoryMemoryCategory
  subject: string
  field: string
  value: string
  evidence: string
  status: 'active' | 'outdated' | 'tentative'
  sourceChapterId?: string
  updatedAt: number
}

export type OpenLoop = {
  id: string
  projectId: string
  content: string
  plantedChapterId: string
  targetChapterHint?: string
  status: 'active' | 'urgent' | 'resolved'
  urgency: number
  updatedAt: number
}

export type ReaderPromise = {
  id: string
  projectId: string
  content: string
  sourceChapterId?: string
  status: 'active' | 'paid_off'
  updatedAt: number
}

export type ImportedResource = {
  id: string
  name: string
  path: string
  type: ImportedResourceType
  content: string
  tokenCount: number
  includedInContext: boolean
  importedAt: number
  /** Original URL returned by the extractor (kept separate from the canonical key). */
  sourceUrl?: string
  /** Canonical URL used to identify repeated web archives. */
  canonicalUrl?: string
  /** Stable deduplication key; currently canonical URL for web resources. */
  dedupeKey?: string
}

export type AgentMemoryRecord = {
  id: string
  scope: AgentMemoryScope
  agentId?: FlowAgentId
  chatId?: string
  articleId?: string
  projectId?: string
  remotePlatform?: RemoteRelayPlatform
  remoteSenderId?: string
  kind: AgentMemoryKind
  content: string
  tags: string[]
  confidence: number
  source: string
  sourceRunId?: string
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  useCount: number
  status: AgentMemoryStatus
}

export type AgentRunRecord = {
  id: string
  mode: AppMode | RemoteRelayMode
  status: AgentRunStatus
  source: AgentRunSource
  prompt: string
  summary?: string
  error?: string
  remoteJobId?: string
  remotePlatform?: RemoteRelayPlatform
  remoteSenderId?: string
  startedAt: number
  endedAt?: number
  stepCount: number
  traceCount: number
  memoryIds: string[]
}

export type MentionContextItem = {
  id: string
  type: 'chapter' | 'character' | 'world' | 'file' | 'skill'
  label: string
  excerpt: string
}

export type ProjectGuidance = {
  style: string
  world: string
  loadedAt?: number
}

export type SecretaryPlanStatus = 'draft' | 'approved' | 'executing' | 'rejected'

export type SecretaryPlanDraft = {
  id: string
  request: string
  executionPrompt: string
  planText: string
  status: SecretaryPlanStatus
  feedback: string[]
  createdAt: number
  updatedAt: number
}

export type CustomAgentSkill = {
  id: string
  name: string
  shortName: string
  trigger: string
  agents: FlowAgentId[]
  keywordsText: string
  instructionsText: string
  outputRulesText: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type McpServerTransport = 'http' | 'stdio'
export type McpServerStatus = 'idle' | 'testing' | 'ok' | 'error' | 'unsupported'

export type McpServerConfig = {
  id: string
  name: string
  transport: McpServerTransport
  endpoint: string
  command: string
  headersText: string
  envText: string
  enabled: boolean
  status: McpServerStatus
  lastError?: string
  createdAt: number
  updatedAt: number
}

export type QueuedUserInputStatus = 'queued' | 'guidance' | 'sending'

export type QueuedUserInput = {
  id: string
  content: string
  status: QueuedUserInputStatus
  createdAt: number
  updatedAt: number
  guidedAt?: number
}

export type GoalJudgeVerdict = 'continue' | 'complete' | 'blocked' | 'early_stop'

export type GoalJudgeResult = {
  verdict: GoalJudgeVerdict
  summary: string
  evidence: string[]
  nextStep: string
  checkedAt: number
}

export type GoalCheckpoint = {
  id: string
  goalId: string
  title: string
  summary: string
  judge: GoalJudgeResult
  createdAt: number
}

export type SecretaryGoalStatus = 'active' | 'paused' | 'completed' | 'blocked' | 'cancelled'

export type SecretaryGoal = {
  id: string
  title: string
  request: string
  acceptanceCriteria: string[]
  phasePlan: string[]
  currentProgress: string
  status: SecretaryGoalStatus
  createdAt: number
  updatedAt: number
}

export type StudioAgentCategory =
  | 'core'
  | 'writing'
  | 'academic'
  | 'operations'
  | 'marketing'
  | 'professional'
  | 'product'
  | 'review'

export type StudioAgentOutputType =
  | 'draft'
  | 'research'
  | 'critique'
  | 'strategy'
  | 'compliance'
  | 'summary'

export type CustomStudioAgent = {
  id: StudioAgentId
  name: string
  shortName: string
  category: StudioAgentCategory
  description: string
  taskTypes: string[]
  keywords: string[]
  systemPrompt: string
  outputRules: string[]
  outputType: StudioAgentOutputType
  enabled: boolean
  builtIn: false
  createdAt: number
  updatedAt: number
}

export type UserMemoryCategory =
  | 'identity'
  | 'personality'
  | 'habit'
  | 'style'
  | 'preference'
  | 'constraint'
  | 'project'
  | 'other'

export type UserMemoryMode = 'off' | 'confirm' | 'low_risk_auto'

export type UserMemoryProfile = {
  enabled: boolean
  mode: UserMemoryMode
  displayName: string
  identity: string
  personality: string
  writingHabits: string
  stylePreferences: string
  constraints: string
  updatedAt?: number
}

export type UserMemoryRecord = {
  id: string
  category: UserMemoryCategory
  content: string
  source: 'manual' | 'agent_suggestion' | 'towrite' | 'agent_observation'
  enabled: boolean
  confidence: number
  createdAt: number
  updatedAt: number
}

export type ProjectWritingMemory = {
  id: string
  projectId?: string
  chatId?: string
  title: string
  content: string
  tags: string[]
  enabled: boolean
  source: 'manual' | 'towrite' | 'resource' | 'story' | 'agent'
  createdAt: number
  updatedAt: number
}

export type TowriteSuggestion = {
  id: string
  scope: 'global' | 'project'
  title: string
  content: string
  reason: string
  status: 'pending' | 'accepted' | 'rejected'
  sourceRunId?: string
  createdAt: number
  updatedAt: number
}

export type DocumentChangeStat = {
  id: string
  chatId?: string
  articleId?: string
  agentRunId?: string
  patchId?: string
  title: string
  operation: DocumentPatchOperation
  insertedChars: number
  deletedChars: number
  changedChars: number
  createdAt: number
}

export type AgentOutputCacheEntry = {
  id: string
  agentRunId?: string
  agentId: FlowAgentId
  outputType: 'draft' | 'research' | 'critique' | 'strategy' | 'compliance' | 'summary'
  summary: string
  keyPoints: string[]
  risks: string[]
  handoff: string
  confidence: number
  newInformation: boolean
  rawLength: number
  createdAt: number
}

export type SemanticTaskCacheEntry = {
  id: string
  taskType: string
  promptFingerprint: string
  promptExcerpt: string
  summary: string
  sources?: FlowTrace['sources']
  hitCount: number
  createdAt: number
  updatedAt: number
}

export type HiveSwarmPhase = 'router' | 'research' | 'draft' | 'review' | 'judge' | 'aggregate'

export type HiveBlackboardEntryKind =
  | 'routing'
  | 'agent_started'
  | 'agent_completed'
  | 'agent_retry'
  | 'agent_failed'
  | 'early_stop'
  | 'circuit_breaker'
  | 'timeout'
  | 'summary'

export type HiveBlackboardEntry = {
  id: string
  traceId: string
  runId?: string
  agentId?: FlowAgentId
  phase?: HiveSwarmPhase
  kind: HiveBlackboardEntryKind
  title: string
  detail: string
  attempt?: number
  elapsedMs?: number
  createdAt: number
}

export type HiveCircuitBreakerState = {
  open: boolean
  failureCount: number
  openedAt?: number
  reason?: string
}

export type HiveTelemetry = {
  enabled: boolean
  runId?: string
  topologyId?: string
  traceId?: string
  startedAt?: number
  deadlineAt?: number
  plannedAgents: number
  activeAgents: number
  completedAgents: number
  skippedAgents: number
  failedAgents: number
  retryCount?: number
  timedOut?: boolean
  circuitBreaker?: HiveCircuitBreakerState
  blackboard: HiveBlackboardEntry[]
  currentPhase?: HiveSwarmPhase
  stageLabel?: string
  updatedAt?: number
}

export type ModelCallCacheMetric = {
  id: string
  cacheKey: string
  stage: string
  cacheable: boolean
  hit: boolean
  missReason?: string
  createdAt: number
}

type CustomAgentSkillInput = Omit<CustomAgentSkill, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

type McpServerConfigInput = Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

type CustomStudioAgentInput = Omit<CustomStudioAgent, 'id' | 'createdAt' | 'updatedAt' | 'builtIn'> & {
  id?: string
  createdAt?: number
  updatedAt?: number
}

type RemotePlatformCredentialInput = Partial<RemotePlatformCredential> & {
  platform: RemotePlatformCredential['platform']
}

type UserMemoryRecordInput = Omit<UserMemoryRecord, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
  createdAt?: number
  updatedAt?: number
}

type ProjectWritingMemoryInput = Omit<ProjectWritingMemory, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
  createdAt?: number
  updatedAt?: number
}

type TowriteSuggestionInput = Omit<TowriteSuggestion, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
  id?: string
  status?: TowriteSuggestion['status']
  createdAt?: number
  updatedAt?: number
}

type DocumentChangeStatInput = Omit<DocumentChangeStat, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: number
}

type AgentOutputCacheInput = Omit<AgentOutputCacheEntry, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: number
}

type SemanticTaskCacheInput = Omit<SemanticTaskCacheEntry, 'id' | 'createdAt' | 'updatedAt' | 'hitCount'> & {
  id?: string
  createdAt?: number
  updatedAt?: number
  hitCount?: number
}

type HiveTelemetryInput = Partial<HiveTelemetry>

type HiveBlackboardEntryInput = Omit<HiveBlackboardEntry, 'id' | 'createdAt'>

type ModelCallCacheMetricInput = Omit<ModelCallCacheMetric, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: number
}

type SecretaryGoalInput = Omit<SecretaryGoal, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
  id?: string
  status?: SecretaryGoalStatus
  createdAt?: number
  updatedAt?: number
}

type GoalCheckpointInput = Omit<GoalCheckpoint, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: number
}

type TokenSnapshot = {
  editorTokens: number
  conversationTokens: number
  summaryTokens: number
  resourceTokens: number
  chatArticleTokens: number
  contextUsedTokens: number
}

type UpdateStatePatch = {
  status: UpdateStatus
  message: string
  progress?: number
  version?: string
}

type AppState = TokenSnapshot & {
  isFirstLaunch: boolean
  isEnvReady: boolean
  maintenanceTab: MaintenanceTab
  maintenanceChecks: MaintenanceCheck[]
  memoryUsageBytes: number
  mode: AppMode
  columnMode: ColumnMode
  isLeftCollapsed: boolean
  isSettingsOpen: boolean
  activeProviderId: ProviderId
  modelRoutingMode: ModelRoutingMode
  autoModelProviderIds: ProviderId[]
  modelTierWeights: Record<ModelCapabilityTier, number>
  modelTierAssessments: ModelTierAssessment[]
  activeAgentId: FlowAgentId
  flowReviewMode: FlowReviewMode
  flowThinkingEffort: FlowThinkingEffort
  activeVibeId: VibeId
  vibeIntensity: number
  contextLimitTokens: number
  effectiveContextLimitTokens: number
  modelContextSource: ModelContextSource
  compressionCount: number
  isContextCompressing: boolean
  compressionState: CompressionState
  compressionMessage: string
  compressedSummary: string
  lastAutoCompressionTokenMark: number
  autoCompressionArmed: boolean
  mentionContextItems: MentionContextItem[]
  negativeMemories: string[]
  projectGuidance: ProjectGuidance
  articleTitle: string
  activeArticleId: string
  articles: ArticleRecord[]
  documentRevision: number
  editorText: string
  editorHtml: string
  editorSelectionText: string
  flowMessages: FlowMessage[]
  companionMessages: CompanionMessage[]
  companionRunState: LlmRunState
  chatSessions: ChatSession[]
  activeChatId: string
  agentTodos: AgentTodo[]
  flowTraces: FlowTrace[]
  agentSteps: AgentStep[]
  agentMemoryRecords: AgentMemoryRecord[]
  agentRuns: AgentRunRecord[]
  activeAgentRunId?: string
  resources: ImportedResource[]
  pendingDocumentPatch?: DocumentPatch
  secretaryPlanDraft?: SecretaryPlanDraft
  queuedUserInputs: QueuedUserInput[]
  activeSecretaryGoal?: SecretaryGoal
  goalCheckpoints: GoalCheckpoint[]
  llmRunState: LlmRunState
  llmStatusMessage: string
  updateStatus: UpdateStatus
  updateMessage: string
  updateProgress: number
  updateVersion?: string
  scallionUser?: ScallionUser
  scallionToken?: string
  scallionModels: ScallionModelMetadata[]
  scallionPlan?: ScallionPlan
  scallionQuota?: ScallionQuota
  scallionSync: ScallionSyncState
  hardwareCapabilityProfile: HardwareCapabilityProfile
  authDeviceCode?: string
  authUserCode?: string
  authStatus: ScallionAuthStatus
  remoteRelayEnabled: boolean
  remoteRelayEndpoint: string
  remoteRelayChannelId?: string
  remoteRelayAccessKey?: string
  remoteRelayAllowedPlatforms: RemoteRelayPlatform[]
  remoteRelayDefaultMode: RemoteRelayMode
  remoteRelayPollIntervalSeconds: number
  remoteRelayStatus: RemoteRelayStatus
  remoteRelayMessage: string
  remoteRelayLastJobAt?: number
  remotePlatformCredentials: RemotePlatformCredential[]
  providerConfigs: Record<ProviderId, LlmProviderConfig>
  disabledBuiltInStudioAgentIds: StudioAgentId[]
  customStudioAgents: CustomStudioAgent[]
  customAgentSkills: CustomAgentSkill[]
  mcpServers: McpServerConfig[]
  userMemoryProfile: UserMemoryProfile
  userMemoryRecords: UserMemoryRecord[]
  projectWritingMemories: ProjectWritingMemory[]
  globalTowriteMarkdown: string
  projectTowriteMarkdown: string
  towriteSuggestions: TowriteSuggestion[]
  documentChangeStats: DocumentChangeStat[]
  agentOutputCache: AgentOutputCacheEntry[]
  semanticTaskCache: SemanticTaskCacheEntry[]
  modelCallCacheMetrics: ModelCallCacheMetric[]
  hiveTelemetry: HiveTelemetry
  storyProjects: StoryProject[]
  activeStoryProjectId?: string
  storyContracts: StoryContract[]
  chapterContracts: ChapterContract[]
  reviewContracts: ReviewContract[]
  chapterCommits: ChapterCommit[]
  storyEvents: StoryEvent[]
  storyMemories: MemoryItem[]
  openLoops: OpenLoop[]
  readerPromises: ReaderPromise[]
  isStoryDashboardOpen: boolean
  isUsageCollapsed: boolean
  setMode: (mode: AppMode) => void
  setColumnMode: (columnMode: ColumnMode) => void
  toggleLeftCollapsed: () => void
  setSettingsOpen: (open: boolean) => void
  setActiveProviderId: (providerId: ProviderId) => void
  setModelRoutingMode: (mode: ModelRoutingMode) => void
  setAutoModelProviderIds: (providerIds: ProviderId[]) => void
  setModelTierWeight: (tier: ModelCapabilityTier, weight: number) => void
  setModelTierAssessments: (assessments: ModelTierAssessment[]) => void
  setHardwareCapabilityProfile: (profile: HardwareCapabilityProfile) => void
  setActiveAgentId: (agentId: FlowAgentId) => void
  setFlowReviewMode: (reviewMode: FlowReviewMode) => void
  setFlowThinkingEffort: (effort: FlowThinkingEffort) => void
  setActiveVibeId: (vibeId: VibeId) => void
  setVibeIntensity: (intensity: number) => void
  setArticleTitle: (title: string) => void
  newArticle: () => void
  newArticleInChat: (chatId?: string) => void
  switchArticle: (articleId: string) => void
  switchChatArticle: (chatId: string, articleId: string) => void
  attachArticleToChat: (chatId: string, articleId: string) => void
  createArticleFromPatch: (patch: DocumentPatch) => void
  renameArticle: (articleId: string, title: string) => void
  deleteArticle: (articleId: string) => void
  toggleArticlePinned: (articleId: string) => void
  setEditorText: (editorText: string) => void
  setEditorContent: (payload: { text: string; html: string }) => void
  setEditorSelectionText: (text: string) => void
  addCompanionMessage: (message: Omit<CompanionMessage, 'id' | 'createdAt'>) => CompanionMessage
  updateCompanionMessage: (id: string, patch: Partial<Omit<CompanionMessage, 'id' | 'createdAt'>>) => void
  clearCompanionMessages: () => void
  setCompanionRunState: (runState: LlmRunState) => void
  setFlowMessages: (messages: FlowMessage[]) => void
  addFlowMessage: (message: Omit<FlowMessage, 'id' | 'createdAt'>) => FlowMessage
  updateFlowMessage: (id: string, patch: Partial<Omit<FlowMessage, 'id' | 'createdAt'>>) => void
  setAgentTodos: (todos: Array<Omit<AgentTodo, 'id' | 'createdAt' | 'updatedAt'>>) => void
  updateAgentTodo: (id: string, patch: Partial<Omit<AgentTodo, 'id'>>) => void
  addFlowTrace: (trace: Omit<FlowTrace, 'id' | 'startedAt'>) => FlowTrace
  updateFlowTrace: (id: string, patch: Partial<Omit<FlowTrace, 'id'>>) => void
  setAgentSteps: (steps: Array<Omit<AgentStep, 'id' | 'startedAt'>>) => void
  addAgentStep: (step: Omit<AgentStep, 'id' | 'startedAt'> & { id?: string }) => AgentStep
  updateAgentStep: (id: string, patch: Partial<Omit<AgentStep, 'id'>>) => void
  appendAgentStepContent: (id: string, delta: string) => void
  toggleAgentStepExpanded: (id: string) => void
  clearAgentSteps: () => void
  clearFlowRun: () => void
  startAgentRunRecord: (
    run: Omit<
      AgentRunRecord,
      'id' | 'status' | 'startedAt' | 'stepCount' | 'traceCount' | 'memoryIds'
    > & {
      id?: string
      status?: AgentRunStatus
      startedAt?: number
      memoryIds?: string[]
    },
  ) => AgentRunRecord
  finishAgentRunRecord: (
    id: string,
    patch: { status: AgentRunStatus; summary?: string; error?: string; memoryIds?: string[] },
  ) => void
  setActiveAgentRunId: (agentRunId?: string) => void
  upsertAgentMemory: (
    memory: Omit<AgentMemoryRecord, 'id' | 'createdAt' | 'updatedAt' | 'useCount'> & {
      id?: string
      createdAt?: number
      updatedAt?: number
      useCount?: number
    },
  ) => AgentMemoryRecord
  updateAgentMemory: (id: string, patch: Partial<Omit<AgentMemoryRecord, 'id'>>) => void
  forgetAgentMemory: (id: string) => void
  touchAgentMemory: (ids: string[]) => void
  clearAgentMemory: () => void
  setPendingDocumentPatch: (patch?: Omit<DocumentPatch, 'id' | 'createdAt' | 'status'>) => void
  markDocumentPatch: (status: DocumentPatchStatus) => void
  setSecretaryPlanDraft: (
    draft?: Omit<SecretaryPlanDraft, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
      id?: string
      status?: SecretaryPlanStatus
      createdAt?: number
      updatedAt?: number
    },
  ) => SecretaryPlanDraft | undefined
  reviseSecretaryPlanDraft: (
    feedback: string,
    patch?: Partial<Pick<SecretaryPlanDraft, 'planText' | 'executionPrompt'>>,
  ) => void
  approveSecretaryPlanDraft: () => void
  clearSecretaryPlanDraft: () => void
  enqueueUserInput: (content: string) => QueuedUserInput | undefined
  updateQueuedUserInput: (id: string, patch: Partial<Pick<QueuedUserInput, 'content' | 'status'>>) => void
  removeQueuedUserInput: (id: string) => void
  sendQueuedInputAsGuidance: (id: string) => QueuedUserInput | undefined
  createSecretaryGoal: (goal: SecretaryGoalInput) => SecretaryGoal
  updateSecretaryGoal: (id: string, patch: Partial<Omit<SecretaryGoal, 'id' | 'createdAt'>>) => void
  addGoalCheckpoint: (checkpoint: GoalCheckpointInput) => GoalCheckpoint
  clearSecretaryGoal: () => void
  upsertCustomAgentSkill: (skill: CustomAgentSkillInput) => CustomAgentSkill
  deleteCustomAgentSkill: (id: string) => void
  toggleCustomAgentSkill: (id: string, enabled: boolean) => void
  upsertMcpServer: (server: McpServerConfigInput) => McpServerConfig
  deleteMcpServer: (id: string) => void
  updateMcpServerStatus: (
    id: string,
    patch: Pick<McpServerConfig, 'status'> & { lastError?: string },
  ) => void
  toggleStudioAgent: (agentId: StudioAgentId, enabled: boolean) => void
  upsertCustomStudioAgent: (agent: CustomStudioAgentInput) => CustomStudioAgent
  deleteCustomStudioAgent: (id: StudioAgentId) => void
  upsertRemotePlatformCredential: (credential: RemotePlatformCredentialInput) => RemotePlatformCredential
  updateRemotePlatformCredentialStatus: (
    platform: RemotePlatformCredential['platform'],
    patch: Pick<RemotePlatformCredential, 'status'> & { lastError?: string },
  ) => void
  setUserMemoryProfile: (patch: Partial<UserMemoryProfile>) => void
  upsertUserMemoryRecord: (record: UserMemoryRecordInput) => UserMemoryRecord
  deleteUserMemoryRecord: (id: string) => void
  toggleUserMemoryRecord: (id: string, enabled: boolean) => void
  clearUserMemoryRecords: () => void
  upsertProjectWritingMemory: (memory: ProjectWritingMemoryInput) => ProjectWritingMemory
  deleteProjectWritingMemory: (id: string) => void
  clearProjectWritingMemories: () => void
  setGlobalTowriteMarkdown: (markdown: string) => void
  setProjectTowriteMarkdown: (markdown: string) => void
  addTowriteSuggestion: (suggestion: TowriteSuggestionInput) => TowriteSuggestion
  updateTowriteSuggestion: (id: string, patch: Partial<Omit<TowriteSuggestion, 'id'>>) => void
  clearTowriteSuggestions: () => void
  recordDocumentChangeStat: (stat: DocumentChangeStatInput) => DocumentChangeStat
  clearDocumentChangeStats: (chatId?: string) => void
  putAgentOutputCache: (entry: AgentOutputCacheInput) => AgentOutputCacheEntry
  clearAgentOutputCache: (agentRunId?: string) => void
  putSemanticTaskCache: (entry: SemanticTaskCacheInput) => SemanticTaskCacheEntry
  clearSemanticTaskCache: () => void
  recordModelCallCacheMetric: (metric: ModelCallCacheMetricInput) => ModelCallCacheMetric
  clearModelCallCacheMetrics: () => void
  setHiveTelemetry: (telemetry: HiveTelemetryInput) => void
  addHiveBlackboardEntry: (entry: HiveBlackboardEntryInput) => HiveBlackboardEntry
  clearHiveTelemetry: () => void
  addResources: (resources: ImportedResource[]) => void
  updateResource: (id: string, patch: Partial<ImportedResource>) => void
  deleteResource: (id: string) => void
  addMentionContextItem: (item: MentionContextItem) => void
  clearMentionContextItems: () => void
  addNegativeMemory: (memory: string) => void
  setProjectGuidance: (guidance: ProjectGuidance) => void
  clearFlowMessages: () => void
  newChatSession: () => void
  switchChatSession: (chatId: string) => void
  renameChatSession: (chatId: string, title: string) => void
  deleteChatSession: (chatId: string) => void
  toggleChatPinned: (chatId: string) => void
  setLlmRunState: (runState: LlmRunState, message: string) => void
  setContextCompressionState: (state: CompressionState, message: string) => void
  applyContextCompression: (summary: string, reason: 'manual' | 'auto') => void
  setAutoCompressionGate: (patch: {
    lastAutoCompressionTokenMark?: number
    autoCompressionArmed?: boolean
  }) => void
  setUpdateState: (patch: UpdateStatePatch) => void
  updateProviderModelMetadata: (
    providerId: ProviderId,
    patch: { contextWindowTokens?: number; modelName?: string; label?: string },
  ) => void
  updateProviderConfig: (
    providerId: ProviderId,
    patch: Partial<Omit<LlmProviderConfig, 'id' | 'type'>>,
  ) => void
  setScallionDevice: (deviceCode: string, userCode: string) => void
  setScallionAuthStatus: (status: ScallionAuthStatus) => void
  setScallionSession: (token: string, user: ScallionUser) => void
  expireScallionSession: () => void
  clearScallionSession: () => void
  setScallionModelMetadata: (models: ScallionModelMetadata[]) => void
  setScallionPlan: (plan?: ScallionPlan) => void
  setScallionQuota: (quota?: ScallionQuota) => void
  setScallionSyncState: (
    channel: keyof ScallionSyncState,
    patch: Partial<ScallionSyncChannelState>,
  ) => void
  setRemoteRelayConfig: (patch: {
    enabled?: boolean
    endpoint?: string
    channelId?: string
    accessKey?: string
    allowedPlatforms?: RemoteRelayPlatform[]
    defaultMode?: RemoteRelayMode
    pollIntervalSeconds?: number
  }) => void
  setRemoteRelayState: (patch: {
    status?: RemoteRelayStatus
    message?: string
    lastJobAt?: number
  }) => void
  upsertStoryProject: (project: Omit<StoryProject, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => StoryProject
  setActiveStoryProject: (projectId?: string) => void
  addStoryContract: (contract: Omit<StoryContract, 'id' | 'createdAt' | 'updatedAt'>) => StoryContract
  addChapterContract: (contract: Omit<ChapterContract, 'id' | 'createdAt'>) => ChapterContract
  addReviewContract: (contract: Omit<ReviewContract, 'id' | 'createdAt'>) => ReviewContract
  addChapterCommit: (commit: Omit<ChapterCommit, 'id' | 'createdAt'>) => ChapterCommit
  addStoryEvents: (events: Array<Omit<StoryEvent, 'id' | 'createdAt'>>) => void
  upsertStoryMemories: (memories: Array<Omit<MemoryItem, 'id' | 'updatedAt' | 'status'> & { status?: MemoryItem['status'] }>) => void
  upsertOpenLoops: (loops: Array<Omit<OpenLoop, 'id' | 'updatedAt'>>) => void
  upsertReaderPromises: (promises: Array<Omit<ReaderPromise, 'id' | 'updatedAt'>>) => void
  setStoryDashboardOpen: (open: boolean) => void
  setUsageCollapsed: (collapsed: boolean) => void
  setFirstLaunchComplete: () => void
  setEnvReady: (ready: boolean) => void
  setMaintenanceTab: (tab: MaintenanceTab) => void
  setMaintenanceCheck: (id: MaintenanceCheckId, patch: Partial<MaintenanceCheck>) => void
  setMemoryUsageBytes: (bytes: number) => void
  resetOobe: () => void
}

const initialEditorText =
  '论记忆、材料与判断\n\n这里是 Papyrus 的主编辑区。\n\n你可以像 Word 或 WPS 一样直接编辑文稿，也可以选中文本呼出伴写菜单，让 AI 做审查、纠错、查重、降噪或按指令改写。\n\n在秘书模式中，秘书长会根据任务拆解待办、调用工作室 Agent，并在需要时把正文写回文稿。'

const initialEditorHtml =
  '<h1>论记忆、材料与判断</h1><p>这里是 Papyrus 的主编辑区。</p><p>你可以像 Word 或 WPS 一样直接编辑文稿，也可以选中文本呼出伴写菜单，让 AI 做审查、纠错、查重、降噪或按指令改写。</p><p>在秘书模式中，秘书长会根据任务拆解待办、调用工作室 Agent，并在需要时把正文写回文稿。</p>'

const initialFlowMessages: FlowMessage[] = [
  {
    id: 'flow-seed-1',
    role: 'assistant',
    agentId: 'writer',
    content:
      '秘书编队已就绪。给我一个主题、材料清单或章节目标，我会由秘书长协调工作室 Agent 推进。',
    createdAt: Date.now(),
  },
]

const initialChatId = 'chat-seed-1'
const initialArticleId = 'article-seed-1'
const defaultActiveProviderId: ProviderId = 'qwen36'
const defaultAutoModelProviderIds: ProviderId[] = ['qwen36']
const defaultModelTierWeights: Record<ModelCapabilityTier, number> = {
  T1: 1,
  T2: 0.68,
  T3: 0.42,
}
const defaultContextLimitTokens = getEffectiveContextLimit(
  defaultProviderConfigs[defaultActiveProviderId],
)
const initialMaintenanceChecks: MaintenanceCheck[] = [
  {
    id: 'tauri',
    label: 'Tauri 后端通信',
    status: 'idle',
    message: '等待检测',
  },
  {
    id: 'sqlite',
    label: '本地 SQLite 数据库',
    status: 'idle',
    message: '等待检测',
  },
  {
    id: 'llm',
    label: '默认大模型 API',
    status: 'idle',
    message: '等待检测',
  },
]

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      isFirstLaunch: true,
      isEnvReady: false,
      maintenanceTab: 'connections',
      maintenanceChecks: initialMaintenanceChecks,
      memoryUsageBytes: 0,
      mode: 'flow',
      columnMode: 3,
      isLeftCollapsed: false,
      isSettingsOpen: false,
      activeProviderId: defaultActiveProviderId,
      modelRoutingMode: 'manual',
      autoModelProviderIds: defaultAutoModelProviderIds,
      modelTierWeights: defaultModelTierWeights,
      modelTierAssessments: [],
      activeAgentId: 'writer',
      flowReviewMode: 'auto',
      flowThinkingEffort: 'medium',
      activeVibeId: defaultVibeId,
      vibeIntensity: 58,
      contextLimitTokens: defaultContextLimitTokens,
      effectiveContextLimitTokens: defaultContextLimitTokens,
      modelContextSource: getModelContextSource(defaultProviderConfigs[defaultActiveProviderId]),
      compressionCount: 0,
      isContextCompressing: false,
      compressionState: 'idle',
      compressionMessage: '上下文余量健康',
      compressedSummary: '',
      lastAutoCompressionTokenMark: 0,
      autoCompressionArmed: true,
      mentionContextItems: [],
      negativeMemories: [],
      projectGuidance: { style: '', world: '' },
      articleTitle: '未命名文稿',
      activeArticleId: initialArticleId,
      articles: [
        {
          id: initialArticleId,
          chatId: initialChatId,
          title: '未命名文稿',
          text: initialEditorText,
          html: initialEditorHtml,
          pinned: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      documentRevision: 0,
      editorText: initialEditorText,
      editorHtml: initialEditorHtml,
      editorSelectionText: '',
      flowMessages: initialFlowMessages,
      companionMessages: [],
      companionRunState: 'idle',
      chatSessions: [
        {
          id: initialChatId,
          title: '初始对话',
          messages: initialFlowMessages,
          articleId: initialArticleId,
          articleIds: [initialArticleId],
          activeArticleId: initialArticleId,
          pinned: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      activeChatId: initialChatId,
      agentTodos: [],
      flowTraces: [],
      agentSteps: [],
      agentMemoryRecords: [],
      agentRuns: [],
      activeAgentRunId: undefined,
      resources: [],
      pendingDocumentPatch: undefined,
      secretaryPlanDraft: undefined,
      queuedUserInputs: [],
      activeSecretaryGoal: undefined,
      goalCheckpoints: [],
      llmRunState: 'idle',
      llmStatusMessage: 'LLM 待命',
      updateStatus: 'idle',
      updateMessage: '自动更新待命',
      updateProgress: 0,
      updateVersion: undefined,
      scallionUser: undefined,
      scallionToken: undefined,
      scallionModels: [],
      scallionPlan: undefined,
      scallionQuota: undefined,
      scallionSync: defaultScallionSyncState(),
      hardwareCapabilityProfile: defaultHardwareProfile(),
      authDeviceCode: undefined,
      authUserCode: undefined,
      authStatus: 'idle',
      remoteRelayEnabled: false,
      remoteRelayEndpoint: 'https://scallion.uno/api/papyrus/remote',
      remoteRelayChannelId: undefined,
      remoteRelayAccessKey: undefined,
      remoteRelayAllowedPlatforms: ['clawbot', 'feishu', 'wecom', 'qq', 'wechat', 'custom'],
      remoteRelayDefaultMode: 'flow',
      remoteRelayPollIntervalSeconds: 12,
      remoteRelayStatus: 'idle',
      remoteRelayMessage: '远程中继未启用',
      remoteRelayLastJobAt: undefined,
      remotePlatformCredentials: defaultRemotePlatformCredentials(),
      providerConfigs: defaultProviderConfigs,
      disabledBuiltInStudioAgentIds: [],
      customStudioAgents: [],
      customAgentSkills: [],
      mcpServers: [],
      userMemoryProfile: {
        enabled: true,
        mode: 'confirm',
        displayName: '',
        identity: '',
        personality: '',
        writingHabits: '',
        stylePreferences: '',
        constraints: '',
      },
      userMemoryRecords: [],
      projectWritingMemories: [],
      globalTowriteMarkdown:
        '# towrite.md\n\n## 个人记忆\n\n- 在这里记录稳定的身份、习惯、写作偏好和长期约束。\n\n## 写作默认规则\n\n- 用户声音和真实意图优先于模板化表达。\n',
      projectTowriteMarkdown:
        '# project-towrite.md\n\n## 项目规则\n\n- 在这里记录人物、术语、风格规则、来源资料和写作决策。\n\n## 待解决问题\n\n- 未确认的设定和问题要明确标注。\n',
      towriteSuggestions: [],
      documentChangeStats: [],
      agentOutputCache: [],
      semanticTaskCache: [],
      modelCallCacheMetrics: [],
      hiveTelemetry: emptyHiveTelemetry(),
      storyProjects: [],
      activeStoryProjectId: undefined,
      storyContracts: [],
      chapterContracts: [],
      reviewContracts: [],
      chapterCommits: [],
      storyEvents: [],
      storyMemories: [],
      openLoops: [],
      readerPromises: [],
      isStoryDashboardOpen: false,
      isUsageCollapsed: false,
      ...calculateTokenSnapshot(initialEditorText, initialFlowMessages, ''),
      setMode: (mode) => set({ mode }),
      setColumnMode: (columnMode) => set({ columnMode }),
      toggleLeftCollapsed: () => set((state) => ({ isLeftCollapsed: !state.isLeftCollapsed })),
      setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
      setModelRoutingMode: (modelRoutingMode) => set({ modelRoutingMode }),
      setAutoModelProviderIds: (providerIds) =>
        set({
          autoModelProviderIds: normalizeAutoModelProviderIds(providerIds),
        }),
      setModelTierWeight: (tier, weight) =>
        set((state) => ({
          modelTierWeights: {
            ...state.modelTierWeights,
            [tier]: clampNumber(Number(weight), 0.1, 2),
          },
        })),
      setModelTierAssessments: (modelTierAssessments) =>
        set({ modelTierAssessments: sanitizeModelTierAssessments(modelTierAssessments) }),
      setHardwareCapabilityProfile: (hardwareCapabilityProfile) =>
        set({ hardwareCapabilityProfile: sanitizeHardwareCapabilityProfile(hardwareCapabilityProfile) }),
      setActiveProviderId: (activeProviderId) =>
        set((state) => {
          const provider = state.providerConfigs[activeProviderId] ?? state.providerConfigs.qwen36
          const contextLimitTokens = getEffectiveContextLimit(provider)

          return {
            activeProviderId: provider.id,
            contextLimitTokens,
            effectiveContextLimitTokens: contextLimitTokens,
            modelContextSource: getModelContextSource(provider),
          }
        }),
      setActiveAgentId: (activeAgentId) => set({ activeAgentId }),
      setFlowReviewMode: () => set({ flowReviewMode: 'auto' }),
      setFlowThinkingEffort: (flowThinkingEffort) => set({ flowThinkingEffort }),
      setActiveVibeId: (activeVibeId) => set({ activeVibeId }),
      setVibeIntensity: (vibeIntensity) =>
        set({ vibeIntensity: Math.max(0, Math.min(100, Math.round(vibeIntensity))) }),
      setArticleTitle: (articleTitle) =>
        set((state) => {
          const title = articleTitle.trim() || '未命名文稿'

          return {
            articleTitle: title,
            articles: state.articles.map((article) =>
              article.id === state.activeArticleId
                ? { ...article, title, updatedAt: Date.now() }
                : article,
            ),
          }
        }),
      newArticle: () =>
        set((state) => {
          const now = Date.now()
          const articleId = globalThis.crypto?.randomUUID?.() ?? `article-${now}`
          const title = `新文章 ${new Date().toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}`
          const editorText = ''
          const editorHtml = `<h1>${title}</h1><p></p>`
          const currentArticles = upsertCurrentArticle(state)
          const article: ArticleRecord = {
            id: articleId,
            chatId: state.activeChatId,
            title,
            text: editorText,
            html: editorHtml,
            createdAt: now,
            updatedAt: now,
          }

          return {
            activeArticleId: articleId,
            articleTitle: title,
            documentRevision: state.documentRevision + 1,
            editorText,
            editorHtml,
            articles: [article, ...currentArticles].slice(0, 80),
            chatSessions: state.chatSessions.map((chat) =>
              chat.id === state.activeChatId
                ? {
                    ...chat,
                    articleId,
                    articleIds: uniqueIds([...(chat.articleIds ?? []), articleId]),
                    activeArticleId: articleId,
                    updatedAt: now,
                  }
                : chat,
            ),
            ...calculateTokenSnapshot(
              editorText,
              state.flowMessages,
              state.compressedSummary,
              state.resources,
            ),
          }
        }),
      newArticleInChat: (chatId) =>
        set((state) => {
          const now = Date.now()
          const targetChatId = chatId ?? state.activeChatId
          const articleId = globalThis.crypto?.randomUUID?.() ?? `article-${now}`
          const title = `新文章 ${new Date().toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}`
          const editorText = ''
          const editorHtml = `<h1>${title}</h1><p></p>`
          const currentArticles = upsertCurrentArticle(state)
          const article: ArticleRecord = {
            id: articleId,
            chatId: targetChatId,
            title,
            text: editorText,
            html: editorHtml,
            createdAt: now,
            updatedAt: now,
          }

          return {
            activeChatId: targetChatId,
            activeArticleId: articleId,
            articleTitle: title,
            documentRevision: state.documentRevision + 1,
            editorText,
            editorHtml,
            articles: [article, ...currentArticles].slice(0, 120),
            chatSessions: attachArticleToSessions(
              state.chatSessions,
              targetChatId,
              articleId,
              now,
            ),
            ...calculateTokenSnapshot(
              editorText,
              state.flowMessages,
              state.compressedSummary,
              state.resources,
              [article],
            ),
          }
        }),
      switchArticle: (articleId) =>
        set((state) => {
          const currentArticles = upsertCurrentArticle(state)
          const target = currentArticles.find((article) => article.id === articleId)

          if (!target) {
            return {}
          }

          return {
            activeArticleId: target.id,
            articleTitle: target.title,
            editorText: target.text,
            editorHtml: target.html,
            documentRevision: state.documentRevision + 1,
            articles: currentArticles,
            chatSessions: state.chatSessions.map((chat) =>
              chat.id === state.activeChatId
                ? {
                    ...chat,
                    articleId: target.id,
                    articleIds: uniqueIds([...(chat.articleIds ?? []), target.id]),
                    activeArticleId: target.id,
                    updatedAt: Date.now(),
                  }
                : chat,
            ),
            ...calculateTokenSnapshot(
              target.text,
              state.flowMessages,
              state.compressedSummary,
              state.resources,
            ),
          }
        }),
      switchChatArticle: (chatId, articleId) =>
        set((state) => {
          const currentArticles = upsertCurrentArticle(state)
          const target = currentArticles.find((article) => article.id === articleId)

          if (!target) {
            return {}
          }

          return {
            activeChatId: chatId,
            activeArticleId: target.id,
            articleTitle: target.title,
            editorText: target.text,
            editorHtml: target.html,
            documentRevision: state.documentRevision + 1,
            articles: currentArticles,
            chatSessions: state.chatSessions.map((chat) =>
              chat.id === chatId
                ? {
                    ...chat,
                    articleId: target.id,
                    articleIds: uniqueIds([...(chat.articleIds ?? []), target.id]),
                    activeArticleId: target.id,
                    updatedAt: Date.now(),
                  }
                : chat,
            ),
            flowMessages:
              chatId === state.activeChatId
                ? state.flowMessages
                : state.chatSessions.find((chat) => chat.id === chatId)?.messages ?? [],
            ...calculateTokenSnapshot(
              target.text,
              chatId === state.activeChatId
                ? state.flowMessages
                : state.chatSessions.find((chat) => chat.id === chatId)?.messages ?? [],
              state.compressedSummary,
              state.resources,
              getChatArticles(currentArticles, state.chatSessions, chatId, target.id),
            ),
          }
        }),
      attachArticleToChat: (chatId, articleId) =>
        set((state) => ({
          articles: state.articles.map((article) =>
            article.id === articleId ? { ...article, chatId, updatedAt: Date.now() } : article,
          ),
          chatSessions: attachArticleToSessions(state.chatSessions, chatId, articleId, Date.now()),
        })),
      createArticleFromPatch: (patch) =>
        set((state) => {
          const now = Date.now()
          const chatId = patch.targetChatId ?? state.activeChatId
          const articleId = patch.targetArticleId ?? globalThis.crypto?.randomUUID?.() ?? `article-${now}`
          const title = patch.title || `AI 文章 ${new Date().toLocaleString('zh-CN')}`
          const editorText = patch.content
          const editorHtml = textToArticleHtml(title, patch.content)
          const currentArticles = upsertCurrentArticle(state)
          const article: ArticleRecord = {
            id: articleId,
            chatId,
            title,
            text: editorText,
            html: editorHtml,
            createdAt: now,
            updatedAt: now,
          }

          return {
            activeChatId: chatId,
            activeArticleId: articleId,
            articleTitle: title,
            editorText,
            editorHtml,
            documentRevision: state.documentRevision + 1,
            articles: [article, ...currentArticles.filter((item) => item.id !== articleId)].slice(0, 120),
            chatSessions: attachArticleToSessions(state.chatSessions, chatId, articleId, now),
            ...calculateTokenSnapshot(
              editorText,
              state.flowMessages,
              state.compressedSummary,
              state.resources,
              [article],
            ),
          }
        }),
      renameArticle: (articleId, title) =>
        set((state) => {
          const normalized = title.trim()

          if (!normalized) {
            return {}
          }

          return {
            articleTitle:
              articleId === state.activeArticleId ? normalized : state.articleTitle,
            articles: state.articles.map((article) =>
              article.id === articleId
                ? { ...article, title: normalized, updatedAt: Date.now() }
                : article,
            ),
          }
        }),
      deleteArticle: (articleId) =>
        set((state) => {
          const currentArticles = upsertCurrentArticle(state)
          const remaining = currentArticles.filter((article) => article.id !== articleId)
          const fallback =
            remaining.find((article) => article.id === state.activeArticleId) ?? remaining[0]

          if (!fallback) {
            return {}
          }

          const activeChanged = articleId === state.activeArticleId

          return {
            activeArticleId: fallback.id,
            articleTitle: activeChanged ? fallback.title : state.articleTitle,
            editorText: activeChanged ? fallback.text : state.editorText,
            editorHtml: activeChanged ? fallback.html : state.editorHtml,
            documentRevision: activeChanged ? state.documentRevision + 1 : state.documentRevision,
            articles: remaining,
            chatSessions: state.chatSessions.map((chat) =>
              chat.articleId === articleId ? { ...chat, articleId: fallback.id } : chat,
            ),
            ...calculateTokenSnapshot(
              activeChanged ? fallback.text : state.editorText,
              state.flowMessages,
              state.compressedSummary,
              state.resources,
            ),
          }
        }),
      toggleArticlePinned: (articleId) =>
        set((state) => ({
          articles: state.articles.map((article) =>
            article.id === articleId
              ? { ...article, pinned: !article.pinned, updatedAt: Date.now() }
              : article,
          ),
        })),
      setEditorText: (editorText) =>
        set((state) => ({
          editorText,
          articles: upsertCurrentArticle({ ...state, editorText }),
          ...calculateTokenSnapshot(
            editorText,
            state.flowMessages,
            state.compressedSummary,
            state.resources,
          ),
        })),
      setEditorContent: ({ text, html }) =>
        set((state) => ({
          editorText: text,
          editorHtml: html,
          articles: upsertCurrentArticle({ ...state, editorText: text, editorHtml: html }),
          ...calculateTokenSnapshot(
            text,
            state.flowMessages,
            state.compressedSummary,
            state.resources,
          ),
        })),
      setEditorSelectionText: (editorSelectionText) => set({ editorSelectionText }),
      addCompanionMessage: (message) => {
        const companionMessage: CompanionMessage = {
          ...message,
          id: globalThis.crypto?.randomUUID?.() ?? `companion-${Date.now()}`,
          createdAt: Date.now(),
        }

        set((state) => ({
          companionMessages: [...state.companionMessages, companionMessage].slice(-80),
        }))

        return companionMessage
      },
      updateCompanionMessage: (id, patch) =>
        set((state) => ({
          companionMessages: state.companionMessages.map((message) =>
            message.id === id ? { ...message, ...patch } : message,
          ),
        })),
      clearCompanionMessages: () => set({ companionMessages: [] }),
      setCompanionRunState: (companionRunState) => set({ companionRunState }),
      setFlowMessages: (flowMessages) =>
        set((state) => ({
          flowMessages,
          chatSessions: upsertCurrentChat(
            state.chatSessions,
            state.activeChatId,
            flowMessages,
            state.activeArticleId,
          ),
          ...calculateTokenSnapshot(
            state.editorText,
            flowMessages,
            state.compressedSummary,
            state.resources,
          ),
        })),
      addFlowMessage: (message) => {
        const flowMessage: FlowMessage = {
          ...message,
          id: globalThis.crypto?.randomUUID?.() ?? `flow-${Date.now()}`,
          createdAt: Date.now(),
        }

        set((state) => {
          const flowMessages = [...state.flowMessages, flowMessage]

          return {
            flowMessages,
            chatSessions: upsertCurrentChat(
              state.chatSessions,
              state.activeChatId,
              flowMessages,
              state.activeArticleId,
            ),
            ...calculateTokenSnapshot(
              state.editorText,
              flowMessages,
              state.compressedSummary,
              state.resources,
            ),
          }
        })

        return flowMessage
      },
      updateFlowMessage: (id, patch) =>
        set((state) => {
          const flowMessages = state.flowMessages.map((message) =>
            message.id === id ? { ...message, ...patch } : message,
          )

          return {
            flowMessages,
            chatSessions: upsertCurrentChat(
              state.chatSessions,
              state.activeChatId,
              flowMessages,
              state.activeArticleId,
            ),
            ...calculateTokenSnapshot(
              state.editorText,
              flowMessages,
              state.compressedSummary,
              state.resources,
            ),
          }
        }),
      setAgentTodos: (todos) =>
        set((state) => ({
          agentTodos: todos.map((todo) => {
            const now = Date.now()

            return {
              ...todo,
              agentRunId: todo.agentRunId ?? state.activeAgentRunId,
              id: globalThis.crypto?.randomUUID?.() ?? `todo-${now}`,
              createdAt: now,
              updatedAt: now,
            }
          }),
        })),
      updateAgentTodo: (id, patch) =>
        set((state) => ({
          agentTodos: state.agentTodos.map((todo) =>
            todo.id === id ? { ...todo, ...patch, updatedAt: Date.now() } : todo,
          ),
        })),
      addFlowTrace: (trace) => {
        const flowTrace: FlowTrace = {
          ...trace,
          agentRunId: trace.agentRunId ?? get().activeAgentRunId,
          id: globalThis.crypto?.randomUUID?.() ?? `trace-${Date.now()}`,
          startedAt: Date.now(),
        }

        set((state) => ({
          flowTraces: [flowTrace, ...state.flowTraces].slice(0, 80),
        }))

        return flowTrace
      },
      updateFlowTrace: (id, patch) =>
        set((state) => ({
          flowTraces: state.flowTraces.map((trace) =>
            trace.id === id ? { ...trace, ...patch } : trace,
          ),
        })),
      setAgentSteps: (steps) =>
        set((state) => ({
          agentSteps: steps.map((step) => {
            const now = Date.now()

            return {
              ...step,
              agentRunId: step.agentRunId ?? state.activeAgentRunId,
              id: globalThis.crypto?.randomUUID?.() ?? `step-${now}`,
              startedAt: now,
            }
          }),
        })),
      addAgentStep: (step) => {
        const now = Date.now()
        const agentStep: AgentStep = {
          ...step,
          agentRunId: step.agentRunId ?? get().activeAgentRunId,
          id: step.id ?? globalThis.crypto?.randomUUID?.() ?? `step-${now}`,
          startedAt: now,
          isExpanded: step.status === 'running' || step.status === 'error' || step.isExpanded,
        }

        set((state) => ({
          agentSteps: [...state.agentSteps, agentStep].slice(-120),
        }))

        return agentStep
      },
      updateAgentStep: (id, patch) =>
        set((state) => ({
          agentSteps: state.agentSteps.map((step) =>
            step.id === id
              ? {
                  ...step,
                  ...patch,
                  isExpanded:
                    patch.isExpanded ??
                    (patch.status === 'running'
                      ? true
                      : patch.status === 'completed'
                        ? false
                        : patch.status === 'error'
                          ? true
                          : step.isExpanded),
                }
              : step,
          ),
        })),
      appendAgentStepContent: (id, delta) =>
        set((state) => ({
          agentSteps: state.agentSteps.map((step) =>
            step.id === id ? { ...step, content: `${step.content ?? ''}${delta}` } : step,
          ),
        })),
      toggleAgentStepExpanded: (id) =>
        set((state) => ({
          agentSteps: state.agentSteps.map((step) =>
            step.id === id ? { ...step, isExpanded: !step.isExpanded } : step,
          ),
        })),
      clearAgentSteps: () => set({ agentSteps: [] }),
      clearFlowRun: () =>
        set({
          agentTodos: [],
          flowTraces: [],
          agentSteps: [],
          pendingDocumentPatch: undefined,
          hiveTelemetry: emptyHiveTelemetry(),
        }),
      startAgentRunRecord: (input) => {
        const now = Date.now()
        const run: AgentRunRecord = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `agent-run-${now}`,
          status: input.status ?? 'running',
          startedAt: input.startedAt ?? now,
          stepCount: 0,
          traceCount: 0,
          memoryIds: input.memoryIds ?? [],
        }

        set((state) => ({
          activeAgentRunId: run.id,
          agentRuns: [run, ...state.agentRuns.filter((item) => item.id !== run.id)].slice(0, 120),
        }))

        return run
      },
      finishAgentRunRecord: (id, patch) =>
        set((state) => {
          const memoryIds = patch.memoryIds ?? []

          return {
            activeAgentRunId: state.activeAgentRunId === id ? undefined : state.activeAgentRunId,
            agentRuns: state.agentRuns.map((run) =>
              run.id === id
                ? {
                    ...run,
                    status: patch.status,
                    summary: patch.summary ?? run.summary,
                    error: patch.error ?? run.error,
                    endedAt: Date.now(),
                    stepCount: state.agentSteps.filter((step) => step.agentRunId === id).length,
                    traceCount: state.flowTraces.filter((trace) => trace.agentRunId === id).length,
                    memoryIds: uniqueIds([...run.memoryIds, ...memoryIds]),
                  }
                : run,
            ),
          }
        }),
      setActiveAgentRunId: (activeAgentRunId) => set({ activeAgentRunId }),
      upsertAgentMemory: (input) => {
        const now = Date.now()
        const memory: AgentMemoryRecord = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `agent-memory-${now}`,
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
          useCount: input.useCount ?? 0,
        }

        set((state) => ({
          agentMemoryRecords: [
            memory,
            ...state.agentMemoryRecords.filter((item) => item.id !== memory.id),
          ].slice(0, 600),
        }))

        return memory
      },
      updateAgentMemory: (id, patch) =>
        set((state) => ({
          agentMemoryRecords: state.agentMemoryRecords.map((memory) =>
            memory.id === id ? { ...memory, ...patch, updatedAt: Date.now() } : memory,
          ),
        })),
      forgetAgentMemory: (id) =>
        set((state) => ({
          agentMemoryRecords: state.agentMemoryRecords.map((memory) =>
            memory.id === id
              ? { ...memory, status: 'archived', updatedAt: Date.now() }
              : memory,
          ),
        })),
      touchAgentMemory: (ids) =>
        set((state) => {
          if (!ids.length) {
            return {}
          }

          const idSet = new Set(ids)
          const now = Date.now()

          return {
            agentMemoryRecords: state.agentMemoryRecords.map((memory) =>
              idSet.has(memory.id)
                ? {
                    ...memory,
                    lastUsedAt: now,
                    useCount: memory.useCount + 1,
                  }
                : memory,
            ),
          }
        }),
      clearAgentMemory: () =>
        set({
          agentMemoryRecords: [],
          agentRuns: [],
          activeAgentRunId: undefined,
        }),
      setPendingDocumentPatch: (patch) =>
        set({
          pendingDocumentPatch: patch
            ? {
                ...patch,
                id: globalThis.crypto?.randomUUID?.() ?? `patch-${Date.now()}`,
                status: 'pending',
                createdAt: Date.now(),
              }
            : undefined,
        }),
      markDocumentPatch: (status) =>
        set((state) => ({
          pendingDocumentPatch: state.pendingDocumentPatch
            ? { ...state.pendingDocumentPatch, status }
            : undefined,
        })),
      setSecretaryPlanDraft: (input) => {
        if (!input) {
          set({ secretaryPlanDraft: undefined })
          return undefined
        }

        const now = Date.now()
        const draft: SecretaryPlanDraft = {
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `secretary-plan-${now}`,
          request: input.request.trim(),
          executionPrompt: input.executionPrompt.trim(),
          planText: input.planText.trim(),
          status: input.status ?? 'draft',
          feedback: input.feedback ?? [],
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        }

        set({ secretaryPlanDraft: draft })
        return draft
      },
      reviseSecretaryPlanDraft: (feedback, patch) =>
        set((state) => {
          if (!state.secretaryPlanDraft) {
            return {}
          }

          const trimmed = feedback.trim()

          return {
            secretaryPlanDraft: {
              ...state.secretaryPlanDraft,
              ...patch,
              feedback: trimmed
                ? [...state.secretaryPlanDraft.feedback, trimmed].slice(-8)
                : state.secretaryPlanDraft.feedback,
              status: 'draft',
              updatedAt: Date.now(),
            },
          }
        }),
      approveSecretaryPlanDraft: () =>
        set((state) => ({
          secretaryPlanDraft: state.secretaryPlanDraft
            ? { ...state.secretaryPlanDraft, status: 'executing', updatedAt: Date.now() }
            : undefined,
        })),
      clearSecretaryPlanDraft: () => set({ secretaryPlanDraft: undefined }),
      enqueueUserInput: (content) => {
        const trimmed = content.trim()

        if (!trimmed) {
          return undefined
        }

        const now = Date.now()
        const queued: QueuedUserInput = {
          id: globalThis.crypto?.randomUUID?.() ?? `queued-input-${now}`,
          content: trimmed,
          status: 'queued',
          createdAt: now,
          updatedAt: now,
        }

        set((state) => ({
          queuedUserInputs: [...state.queuedUserInputs, queued].slice(-20),
        }))

        return queued
      },
      updateQueuedUserInput: (id, patch) =>
        set((state) => ({
          queuedUserInputs: state.queuedUserInputs.map((input) =>
            input.id === id
              ? {
                  ...input,
                  ...patch,
                  content: patch.content !== undefined ? patch.content.trim() : input.content,
                  updatedAt: Date.now(),
                }
              : input,
          ),
        })),
      removeQueuedUserInput: (id) =>
        set((state) => ({
          queuedUserInputs: state.queuedUserInputs.filter((input) => input.id !== id),
        })),
      sendQueuedInputAsGuidance: (id) => {
        let guided: QueuedUserInput | undefined

        set((state) => {
          const now = Date.now()
          const nextInputs = state.queuedUserInputs.map((input) => {
            if (input.id !== id) {
              return input
            }

            guided = {
              ...input,
              status: 'guidance',
              guidedAt: now,
              updatedAt: now,
            }
            return guided
          })

          return { queuedUserInputs: nextInputs }
        })

        if (guided) {
          get().addAgentStep({
            type: 'tool',
            title: '收到用户引导',
            status: 'completed',
            details: guided.content,
            isExpanded: true,
            agentId: 'writer',
            endedAt: Date.now(),
          })
          get().addFlowTrace({
            kind: 'memory',
            title: '用户引导已加入当前任务',
            detail: guided.content,
            status: 'completed',
            agentId: 'writer',
            endedAt: Date.now(),
          })
        }

        return guided
      },
      createSecretaryGoal: (input) => {
        const now = Date.now()
        const goal: SecretaryGoal = {
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `secretary-goal-${now}`,
          title: input.title.trim() || '长程写作目标',
          request: input.request.trim(),
          acceptanceCriteria: normalizeStringList(input.acceptanceCriteria).slice(0, 8),
          phasePlan: normalizeStringList(input.phasePlan).slice(0, 10),
          currentProgress: input.currentProgress.trim() || '目标已建立，等待秘书模式推进。',
          status: input.status ?? 'active',
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        }

        set({ activeSecretaryGoal: goal })
        return goal
      },
      updateSecretaryGoal: (id, patch) =>
        set((state) => ({
          activeSecretaryGoal:
            state.activeSecretaryGoal?.id === id
              ? {
                  ...state.activeSecretaryGoal,
                  ...patch,
                  title: patch.title?.trim() || state.activeSecretaryGoal.title,
                  request: patch.request?.trim() || state.activeSecretaryGoal.request,
                  acceptanceCriteria: patch.acceptanceCriteria
                    ? normalizeStringList(patch.acceptanceCriteria).slice(0, 8)
                    : state.activeSecretaryGoal.acceptanceCriteria,
                  phasePlan: patch.phasePlan
                    ? normalizeStringList(patch.phasePlan).slice(0, 10)
                    : state.activeSecretaryGoal.phasePlan,
                  currentProgress:
                    patch.currentProgress?.trim() || state.activeSecretaryGoal.currentProgress,
                  updatedAt: Date.now(),
                }
              : state.activeSecretaryGoal,
        })),
      addGoalCheckpoint: (input) => {
        const now = Date.now()
        const checkpoint: GoalCheckpoint = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `goal-checkpoint-${now}`,
          title: input.title.trim() || '裁判检查',
          summary: input.summary.trim(),
          judge: {
            verdict: normalizeGoalVerdict(input.judge.verdict),
            summary: input.judge.summary.trim(),
            evidence: normalizeStringList(input.judge.evidence).slice(0, 6),
            nextStep: input.judge.nextStep.trim(),
            checkedAt: input.judge.checkedAt || now,
          },
          createdAt: input.createdAt ?? now,
        }

        set((state) => ({
          goalCheckpoints: [
            checkpoint,
            ...state.goalCheckpoints.filter((item) => item.id !== checkpoint.id),
          ].slice(0, 80),
        }))

        return checkpoint
      },
      clearSecretaryGoal: () =>
        set((state) => ({
          activeSecretaryGoal: undefined,
          goalCheckpoints: state.activeSecretaryGoal
            ? state.goalCheckpoints.filter((checkpoint) => checkpoint.goalId !== state.activeSecretaryGoal?.id)
            : state.goalCheckpoints,
        })),
      toggleStudioAgent: (agentId, enabled) => {
        if (agentId === 'writer') {
          return
        }

        set((state) => {
          if (state.customStudioAgents.some((agent) => agent.id === agentId)) {
            return {
              customStudioAgents: state.customStudioAgents.map((agent) =>
                agent.id === agentId ? { ...agent, enabled, updatedAt: Date.now() } : agent,
              ),
            }
          }

          const disabled = new Set(state.disabledBuiltInStudioAgentIds)
          if (enabled) {
            disabled.delete(agentId)
          } else {
            disabled.add(agentId)
          }

          return {
            disabledBuiltInStudioAgentIds: Array.from(disabled).filter((id) => id !== 'writer'),
          }
        })
      },
      upsertCustomStudioAgent: (input) => {
        const now = Date.now()
        const existing = input.id
          ? get().customStudioAgents.find((agent) => agent.id === input.id)
          : undefined
        const name = input.name.trim()
        const agent: CustomStudioAgent = {
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `custom-agent-${now}`,
          name,
          shortName: input.shortName.trim() || name.slice(0, 6) || 'Agent',
          category: normalizeStudioAgentCategory(input.category),
          description: input.description.trim(),
          taskTypes: normalizeStringList(input.taskTypes).slice(0, 12),
          keywords: normalizeStringList(input.keywords).slice(0, 24),
          systemPrompt: input.systemPrompt.trim(),
          outputRules: normalizeStringList(input.outputRules).slice(0, 12),
          outputType: normalizeStudioAgentOutputType(input.outputType),
          enabled: input.enabled === true,
          builtIn: false,
          createdAt: existing?.createdAt ?? input.createdAt ?? now,
          updatedAt: now,
        }

        if (!agent.name) {
          return existing ?? agent
        }

        set((state) => ({
          customStudioAgents: [
            agent,
            ...state.customStudioAgents.filter((item) => item.id !== agent.id),
          ].slice(0, 80),
        }))

        return agent
      },
      deleteCustomStudioAgent: (id) =>
        set((state) => ({
          customStudioAgents: state.customStudioAgents.filter((agent) => agent.id !== id),
        })),
      upsertCustomAgentSkill: (input) => {
        const now = Date.now()
        const existing = input.id
          ? get().customAgentSkills.find((skill) => skill.id === input.id)
          : undefined
        const skill: CustomAgentSkill = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `custom-skill-${now}`,
          name: input.name.trim(),
          shortName: input.shortName.trim() || input.name.trim(),
          trigger: input.trigger.trim(),
          agents: normalizeFlowAgents(input.agents),
          keywordsText: input.keywordsText.trim(),
          instructionsText: input.instructionsText.trim(),
          outputRulesText: input.outputRulesText.trim(),
          enabled: input.enabled,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }

        set((state) => ({
          customAgentSkills: [
            skill,
            ...state.customAgentSkills.filter((item) => item.id !== skill.id),
          ].slice(0, 60),
        }))

        return skill
      },
      deleteCustomAgentSkill: (id) =>
        set((state) => ({
          customAgentSkills: state.customAgentSkills.filter((skill) => skill.id !== id),
        })),
      toggleCustomAgentSkill: (id, enabled) =>
        set((state) => ({
          customAgentSkills: state.customAgentSkills.map((skill) =>
            skill.id === id ? { ...skill, enabled, updatedAt: Date.now() } : skill,
          ),
        })),
      upsertMcpServer: (input) => {
        const now = Date.now()
        const existing = input.id
          ? get().mcpServers.find((server) => server.id === input.id)
          : undefined
        const server: McpServerConfig = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `mcp-server-${now}`,
          name: input.name.trim(),
          transport: input.transport === 'stdio' ? 'stdio' : 'http',
          endpoint: input.endpoint.trim(),
          command: input.command.trim(),
          headersText: input.headersText.trim(),
          envText: input.envText.trim(),
          enabled: input.enabled,
          status: input.status ?? 'idle',
          lastError: input.lastError,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }

        set((state) => ({
          mcpServers: [server, ...state.mcpServers.filter((item) => item.id !== server.id)].slice(0, 40),
        }))

        return server
      },
      deleteMcpServer: (id) =>
        set((state) => ({
          mcpServers: state.mcpServers.filter((server) => server.id !== id),
        })),
      updateMcpServerStatus: (id, patch) =>
        set((state) => ({
          mcpServers: state.mcpServers.map((server) =>
            server.id === id
              ? { ...server, ...patch, updatedAt: Date.now() }
              : server,
          ),
        })),
      setUserMemoryProfile: (patch) =>
        set((state) => ({
          userMemoryProfile: { ...state.userMemoryProfile, ...patch, updatedAt: Date.now() },
        })),
      upsertUserMemoryRecord: (input) => {
        const now = Date.now()
        const record: UserMemoryRecord = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `user-memory-${now}`,
          content: input.content.trim(),
          confidence: clampNumber(input.confidence, 0.1, 1),
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        }

        if (!record.content) {
          return record
        }

        set((state) => ({
          userMemoryRecords: [
            record,
            ...state.userMemoryRecords.filter((item) => item.id !== record.id),
          ].slice(0, 160),
        }))

        return record
      },
      deleteUserMemoryRecord: (id) =>
        set((state) => ({
          userMemoryRecords: state.userMemoryRecords.filter((record) => record.id !== id),
        })),
      toggleUserMemoryRecord: (id, enabled) =>
        set((state) => ({
          userMemoryRecords: state.userMemoryRecords.map((record) =>
            record.id === id ? { ...record, enabled, updatedAt: Date.now() } : record,
          ),
        })),
      clearUserMemoryRecords: () => set({ userMemoryRecords: [] }),
      upsertProjectWritingMemory: (input) => {
        const now = Date.now()
        const memory: ProjectWritingMemory = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `project-memory-${now}`,
          title: input.title.trim() || '未命名记忆',
          content: input.content.trim(),
          tags: normalizeStringList(input.tags),
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        }

        if (!memory.content) {
          return memory
        }

        set((state) => ({
          projectWritingMemories: [
            memory,
            ...state.projectWritingMemories.filter((item) => item.id !== memory.id),
          ].slice(0, 240),
        }))

        return memory
      },
      deleteProjectWritingMemory: (id) =>
        set((state) => ({
          projectWritingMemories: state.projectWritingMemories.filter((memory) => memory.id !== id),
        })),
      clearProjectWritingMemories: () => set({ projectWritingMemories: [] }),
      setGlobalTowriteMarkdown: (globalTowriteMarkdown) => set({ globalTowriteMarkdown }),
      setProjectTowriteMarkdown: (projectTowriteMarkdown) => set({ projectTowriteMarkdown }),
      addTowriteSuggestion: (input) => {
        const now = Date.now()
        const suggestion: TowriteSuggestion = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `towrite-suggestion-${now}`,
          title: input.title.trim() || '记忆建议',
          content: input.content.trim(),
          reason: input.reason.trim(),
          status: input.status ?? 'pending',
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        }

        if (!suggestion.content) {
          return suggestion
        }

        set((state) => ({
          towriteSuggestions: [
            suggestion,
            ...state.towriteSuggestions.filter((item) => item.id !== suggestion.id),
          ].slice(0, 80),
        }))

        return suggestion
      },
      updateTowriteSuggestion: (id, patch) =>
        set((state) => ({
          towriteSuggestions: state.towriteSuggestions.map((suggestion) =>
            suggestion.id === id ? { ...suggestion, ...patch, updatedAt: Date.now() } : suggestion,
          ),
        })),
      clearTowriteSuggestions: () => set({ towriteSuggestions: [] }),
      recordDocumentChangeStat: (input) => {
        const now = Date.now()
        const stat: DocumentChangeStat = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `document-change-${now}`,
          insertedChars: Math.max(0, Math.round(input.insertedChars)),
          deletedChars: Math.max(0, Math.round(input.deletedChars)),
          changedChars: Math.max(0, Math.round(input.changedChars)),
          createdAt: input.createdAt ?? now,
        }

        set((state) => ({
          documentChangeStats: [stat, ...state.documentChangeStats].slice(0, 400),
        }))

        return stat
      },
      clearDocumentChangeStats: (chatId) =>
        set((state) => ({
          documentChangeStats: chatId
            ? state.documentChangeStats.filter((stat) => stat.chatId !== chatId)
            : [],
        })),
      putAgentOutputCache: (input) => {
        const now = Date.now()
        const entry: AgentOutputCacheEntry = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `agent-output-${now}`,
          keyPoints: normalizeStringList(input.keyPoints).slice(0, 8),
          risks: normalizeStringList(input.risks).slice(0, 6),
          confidence: clampNumber(input.confidence, 0, 1),
          createdAt: input.createdAt ?? now,
        }

        set((state) => ({
          agentOutputCache: [
            entry,
            ...state.agentOutputCache.filter((item) => item.id !== entry.id),
          ].slice(0, 160),
        }))

        return entry
      },
      clearAgentOutputCache: (agentRunId) =>
        set((state) => ({
          agentOutputCache: agentRunId
            ? state.agentOutputCache.filter((entry) => entry.agentRunId !== agentRunId)
            : [],
        })),
      putSemanticTaskCache: (input) => {
        const now = Date.now()
        const existing = get().semanticTaskCache.find(
          (entry) =>
            entry.taskType === input.taskType &&
            entry.promptFingerprint === input.promptFingerprint,
        )
        const entry: SemanticTaskCacheEntry = {
          ...input,
          id: existing?.id ?? input.id ?? globalThis.crypto?.randomUUID?.() ?? `semantic-cache-${now}`,
          promptExcerpt: input.promptExcerpt.trim().slice(0, 260),
          summary: input.summary.trim(),
          hitCount: input.hitCount ?? existing?.hitCount ?? 0,
          createdAt: existing?.createdAt ?? input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        }

        if (!entry.summary) {
          return entry
        }

        set((state) => ({
          semanticTaskCache: [
            entry,
            ...state.semanticTaskCache.filter((item) => item.id !== entry.id),
          ].slice(0, 120),
        }))

        return entry
      },
      clearSemanticTaskCache: () => set({ semanticTaskCache: [] }),
      recordModelCallCacheMetric: (input) => {
        const now = Date.now()
        const metric: ModelCallCacheMetric = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `model-cache-metric-${now}`,
          createdAt: input.createdAt ?? now,
        }

        set((state) => ({
          modelCallCacheMetrics: [metric, ...state.modelCallCacheMetrics].slice(0, 400),
        }))

        return metric
      },
      clearModelCallCacheMetrics: () => set({ modelCallCacheMetrics: [] }),
      setHiveTelemetry: (telemetry) =>
        set((state) => ({
          hiveTelemetry: {
            ...state.hiveTelemetry,
            ...telemetry,
            blackboard: telemetry.blackboard ?? state.hiveTelemetry.blackboard,
            updatedAt: Date.now(),
          },
        })),
      addHiveBlackboardEntry: (input) => {
        const now = Date.now()
        const entry: HiveBlackboardEntry = {
          ...input,
          id: globalThis.crypto?.randomUUID?.() ?? `hive-blackboard-${now}`,
          detail: input.detail.trim().slice(0, 600),
          createdAt: now,
        }

        set((state) => ({
          hiveTelemetry: {
            ...state.hiveTelemetry,
            blackboard: [entry, ...state.hiveTelemetry.blackboard].slice(0, 60),
            retryCount:
              entry.kind === 'agent_retry'
                ? (state.hiveTelemetry.retryCount ?? 0) + 1
                : state.hiveTelemetry.retryCount,
            updatedAt: now,
          },
        }))

        return entry
      },
      clearHiveTelemetry: () => set({ hiveTelemetry: emptyHiveTelemetry() }),
      addResources: (resources) =>
        set((state) => {
          const resourceKey = (resource: ImportedResource) =>
            resource.dedupeKey ?? resource.canonicalUrl ?? resource.path
          const merged = [
            ...resources,
            ...state.resources.filter(
              (existing) => !resources.some((resource) => resourceKey(resource) === resourceKey(existing)),
            ),
          ].slice(0, 80)

          return {
            resources: merged,
            ...calculateTokenSnapshot(
              state.editorText,
              state.flowMessages,
              state.compressedSummary,
              merged,
            ),
          }
        }),
      updateResource: (id, patch) =>
        set((state) => {
          const resources = state.resources.map((resource) =>
            resource.id === id ? { ...resource, ...patch } : resource,
          )

          return {
            resources,
            ...calculateTokenSnapshot(
              state.editorText,
              state.flowMessages,
              state.compressedSummary,
              resources,
            ),
          }
        }),
      deleteResource: (id) =>
        set((state) => {
          const resources = state.resources.filter((resource) => resource.id !== id)

          return {
            resources,
            ...calculateTokenSnapshot(
              state.editorText,
              state.flowMessages,
              state.compressedSummary,
              resources,
            ),
          }
        }),
      addMentionContextItem: (item) =>
        set((state) => ({
          mentionContextItems: [
            item,
            ...state.mentionContextItems.filter((existing) => existing.id !== item.id),
          ].slice(0, 12),
        })),
      clearMentionContextItems: () => set({ mentionContextItems: [] }),
      addNegativeMemory: (memory) => {
        const normalized = memory.trim()

        if (!normalized) {
          return
        }

        set((state) => ({
          negativeMemories: [
            normalized,
            ...state.negativeMemories.filter((item) => item !== normalized),
          ].slice(0, 24),
        }))
      },
      setProjectGuidance: (projectGuidance) => set({ projectGuidance }),
      clearFlowMessages: () =>
        set((state) => ({
          flowMessages: [],
          chatSessions: upsertCurrentChat(
            state.chatSessions,
            state.activeChatId,
            [],
            state.activeArticleId,
          ),
          ...calculateTokenSnapshot(
            state.editorText,
            [],
            state.compressedSummary,
            state.resources,
          ),
        })),
      newChatSession: () =>
        set((state) => {
          const now = Date.now()
          const currentSessions = upsertCurrentChat(
            state.chatSessions,
            state.activeChatId,
            state.flowMessages,
            state.activeArticleId,
          )
          const chat: ChatSession = {
            id: globalThis.crypto?.randomUUID?.() ?? `chat-${now}`,
            title: `新对话 ${currentSessions.length + 1}`,
            messages: [],
            articleId: state.activeArticleId,
            articleIds: [state.activeArticleId],
            activeArticleId: state.activeArticleId,
            createdAt: now,
            updatedAt: now,
          }

          return {
            activeChatId: chat.id,
            flowMessages: [],
            agentTodos: [],
            flowTraces: [],
            agentSteps: [],
            pendingDocumentPatch: undefined,
            chatSessions: [chat, ...currentSessions].slice(0, 40),
            ...calculateTokenSnapshot(
              state.editorText,
              [],
              state.compressedSummary,
              state.resources,
            ),
          }
        }),
      switchChatSession: (chatId) =>
        set((state) => {
          const currentSessions = upsertCurrentChat(
            state.chatSessions,
            state.activeChatId,
            state.flowMessages,
            state.activeArticleId,
          )
          const target = currentSessions.find((chat) => chat.id === chatId)
          const currentArticles = upsertCurrentArticle(state)
          const targetArticleId = target?.activeArticleId ?? target?.articleId ?? target?.articleIds?.[0]
          const linkedArticle = targetArticleId
            ? currentArticles.find((article) => article.id === targetArticleId)
            : undefined

          if (!target) {
            return {}
          }

          return {
            activeChatId: target.id,
            activeArticleId: linkedArticle?.id ?? state.activeArticleId,
            articleTitle: linkedArticle?.title ?? state.articleTitle,
            editorText: linkedArticle?.text ?? state.editorText,
            editorHtml: linkedArticle?.html ?? state.editorHtml,
            documentRevision: linkedArticle ? state.documentRevision + 1 : state.documentRevision,
            flowMessages: target.messages,
            agentTodos: [],
            flowTraces: [],
            agentSteps: [],
            pendingDocumentPatch: undefined,
            chatSessions: currentSessions,
            articles: currentArticles,
            ...calculateTokenSnapshot(
              linkedArticle?.text ?? state.editorText,
              target.messages,
              state.compressedSummary,
              state.resources,
              getChatArticles(currentArticles, currentSessions, target.id, linkedArticle?.id),
            ),
          }
        }),
      renameChatSession: (chatId, title) =>
        set((state) => {
          const normalized = title.trim()

          if (!normalized) {
            return {}
          }

          return {
            chatSessions: state.chatSessions.map((chat) =>
              chat.id === chatId ? { ...chat, title: normalized, updatedAt: Date.now() } : chat,
            ),
          }
        }),
      deleteChatSession: (chatId) =>
        set((state) => {
          const remaining = state.chatSessions.filter((chat) => chat.id !== chatId)
          const fallback = remaining[0]

          if (chatId !== state.activeChatId) {
            return { chatSessions: remaining }
          }

          return {
            activeChatId: fallback?.id ?? state.activeChatId,
            flowMessages: fallback?.messages ?? [],
            chatSessions: remaining,
            agentTodos: [],
            flowTraces: [],
            agentSteps: [],
            pendingDocumentPatch: undefined,
            ...calculateTokenSnapshot(
              state.editorText,
              fallback?.messages ?? [],
              state.compressedSummary,
              state.resources,
            ),
          }
        }),
      toggleChatPinned: (chatId) =>
        set((state) => ({
          chatSessions: state.chatSessions.map((chat) =>
            chat.id === chatId ? { ...chat, pinned: !chat.pinned, updatedAt: Date.now() } : chat,
          ),
        })),
      setLlmRunState: (llmRunState, llmStatusMessage) =>
        set({ llmRunState, llmStatusMessage }),
      setContextCompressionState: (compressionState, compressionMessage) =>
        set({
          compressionState,
          compressionMessage,
          isContextCompressing: compressionState === 'running',
        }),
      applyContextCompression: (summary, reason) =>
        set((state) => {
          const recentMessages = state.flowMessages.slice(-6)
          const compressionNote: FlowMessage = {
            id: globalThis.crypto?.randomUUID?.() ?? `compression-${Date.now()}`,
            role: 'assistant',
            agentId: 'writer',
            content:
              reason === 'manual'
                ? '已手动压缩上下文，旧对话已收拢为可复用摘要。'
                : '上下文达到阈值，已自动压缩前文并保留最近工作窗口。',
            createdAt: Date.now(),
          }
          const flowMessages = [...recentMessages, compressionNote]
          const compressedSummary = [state.compressedSummary, summary].filter(Boolean).join('\n\n')

          return {
            flowMessages,
            compressedSummary,
            compressionCount: state.compressionCount + 1,
            compressionState: 'idle',
            compressionMessage: reason === 'manual' ? '手动压缩完成' : '已自动压缩上下文',
            isContextCompressing: false,
            lastAutoCompressionTokenMark:
              reason === 'auto' ? state.contextUsedTokens : state.lastAutoCompressionTokenMark,
            autoCompressionArmed: reason === 'auto' ? false : state.autoCompressionArmed,
            ...calculateTokenSnapshot(
              state.editorText,
              flowMessages,
              compressedSummary,
              state.resources,
            ),
          }
        }),
      setAutoCompressionGate: (patch) => set(patch),
      setUpdateState: ({ status, message, progress, version }) =>
        set({
          updateStatus: status,
          updateMessage: message,
          updateProgress: progress ?? get().updateProgress,
          updateVersion: version ?? get().updateVersion,
        }),
      updateProviderModelMetadata: (providerId, patch) =>
        set((state) => {
          const existing = state.providerConfigs[providerId]

          if (!existing) {
            return {}
          }

          const provider = {
            ...existing,
            label: patch.label?.trim() || existing.label,
            serverContextWindowTokens:
              patch.contextWindowTokens ?? existing.serverContextWindowTokens,
            modelName: patch.modelName?.trim() || existing.modelName,
            ...(providerId === 'qwen36' && state.scallionToken
              ? {
                  validatedAt: Date.now(),
                  lastValidatedSignature: providerValidationSignature({
                    ...existing,
                    label: patch.label?.trim() || existing.label,
                    serverContextWindowTokens:
                      patch.contextWindowTokens ?? existing.serverContextWindowTokens,
                    modelName: patch.modelName?.trim() || existing.modelName,
                  }),
                }
              : {}),
          }
          const providerConfigs = {
            ...state.providerConfigs,
            [providerId]: provider,
          }
          const isActive = state.activeProviderId === providerId
          const contextLimitTokens = isActive
            ? getEffectiveContextLimit(provider)
            : state.contextLimitTokens

          return {
            providerConfigs,
            contextLimitTokens,
            effectiveContextLimitTokens: contextLimitTokens,
            modelContextSource: isActive
              ? getModelContextSource(provider)
              : state.modelContextSource,
          }
        }),
      updateProviderConfig: (providerId, patch) =>
        set((state) => {
          const invalidatesValidation =
            'baseUrl' in patch ||
            'apiKey' in patch ||
            'modelName' in patch ||
            'customContextTier' in patch
          const provider = {
            ...state.providerConfigs[providerId],
            ...patch,
            ...(invalidatesValidation
              ? { validatedAt: undefined, lastValidatedSignature: undefined }
              : {}),
          }
          const isActive = state.activeProviderId === providerId
          const contextLimitTokens = isActive
            ? getEffectiveContextLimit(provider)
            : state.contextLimitTokens

          return {
            providerConfigs: {
              ...state.providerConfigs,
              [providerId]: provider,
            },
            contextLimitTokens,
            effectiveContextLimitTokens: contextLimitTokens,
            modelContextSource: isActive
              ? getModelContextSource(provider)
              : state.modelContextSource,
          }
        }),
      setScallionDevice: (authDeviceCode, authUserCode) =>
        set({ authDeviceCode, authUserCode, authStatus: 'polling' }),
      setScallionAuthStatus: (authStatus) => set({ authStatus }),
      setScallionSession: (scallionToken, scallionUser) =>
        set((state) => {
          const tokenChanged = state.scallionToken !== scallionToken

          return {
            scallionToken,
            scallionUser,
            ...(tokenChanged
              ? {
                  scallionModels: [],
                  scallionPlan: undefined,
                  scallionQuota: undefined,
                  scallionSync: defaultScallionSyncState(),
                  providerConfigs: {
                    ...state.providerConfigs,
                    qwen36: {
                      ...state.providerConfigs.qwen36,
                      validatedAt: undefined,
                      lastValidatedSignature: undefined,
                    },
                  },
                }
              : {}),
            authStatus: 'approved' as const,
            authDeviceCode: undefined,
            authUserCode: undefined,
          }
        }),
      expireScallionSession: () =>
        set((state) => ({
          scallionToken: undefined,
          scallionUser: undefined,
          scallionModels: [],
          scallionPlan: undefined,
          scallionQuota: undefined,
          scallionSync: defaultScallionSyncState(),
          authDeviceCode: undefined,
          authUserCode: undefined,
          authStatus: 'expired',
          providerConfigs: {
            ...state.providerConfigs,
            qwen36: {
              ...state.providerConfigs.qwen36,
              validatedAt: undefined,
              lastValidatedSignature: undefined,
            },
          },
        })),
      clearScallionSession: () =>
        set((state) => ({
          scallionToken: undefined,
          scallionUser: undefined,
          scallionModels: [],
          scallionPlan: undefined,
          scallionQuota: undefined,
          scallionSync: defaultScallionSyncState(),
          authDeviceCode: undefined,
          authUserCode: undefined,
          authStatus: 'idle',
          providerConfigs: {
            ...state.providerConfigs,
            qwen36: {
              ...state.providerConfigs.qwen36,
              validatedAt: undefined,
              lastValidatedSignature: undefined,
            },
          },
        })),
      setScallionModelMetadata: (scallionModels) =>
        set((state) => {
          const normalized = sanitizeScallionModels(scallionModels)
          const currentProvider = state.providerConfigs.qwen36
          const canRoute = (model: ScallionModelMetadata) =>
            model.available &&
            (state.modelRoutingMode === 'auto'
              ? model.autoAvailable !== false
              : model.manualAvailable !== false && model.planAvailable !== false)
          const primary =
            normalized.find(
              (model) => canRoute(model) && model.modelName === currentProvider.modelName,
            ) ??
            normalized.find(canRoute)

          if (!primary) {
            return {
              scallionModels: normalized,
              providerConfigs: {
                ...state.providerConfigs,
                qwen36: {
                  ...currentProvider,
                  validatedAt: undefined,
                  lastValidatedSignature: undefined,
                },
              },
            }
          }

          const provider = currentProvider
          const updatedProvider = {
            ...provider,
            label: primary.label || provider.label,
            modelName: primary.modelName || provider.modelName,
            serverContextWindowTokens: primary.contextWindowTokens ?? provider.serverContextWindowTokens,
            validatedAt: state.scallionToken ? Date.now() : undefined,
            lastValidatedSignature: undefined as string | undefined,
          }
          updatedProvider.lastValidatedSignature = state.scallionToken
            ? providerValidationSignature(updatedProvider)
            : undefined

          return {
            scallionModels: normalized,
            providerConfigs: {
              ...state.providerConfigs,
              qwen36: updatedProvider,
            },
            contextLimitTokens:
              state.activeProviderId === 'qwen36'
                ? getEffectiveContextLimit(updatedProvider)
                : state.contextLimitTokens,
            effectiveContextLimitTokens:
              state.activeProviderId === 'qwen36'
                ? getEffectiveContextLimit(updatedProvider)
                : state.effectiveContextLimitTokens,
            modelContextSource:
              state.activeProviderId === 'qwen36'
                ? getModelContextSource(updatedProvider)
                : state.modelContextSource,
          }
        }),
      setScallionPlan: (scallionPlan) => set({ scallionPlan }),
      setScallionQuota: (scallionQuota) => set({ scallionQuota }),
      setScallionSyncState: (channel, patch) =>
        set((state) => ({
          scallionSync: {
            ...state.scallionSync,
            [channel]: {
              ...state.scallionSync[channel],
              ...patch,
            },
          },
        })),
      setRemoteRelayConfig: (patch) =>
        set((state) => ({
          remoteRelayEnabled: patch.enabled ?? state.remoteRelayEnabled,
          remoteRelayEndpoint: patch.endpoint ?? state.remoteRelayEndpoint,
          remoteRelayChannelId: patch.channelId ?? state.remoteRelayChannelId,
          remoteRelayAccessKey: patch.accessKey ?? state.remoteRelayAccessKey,
          remoteRelayAllowedPlatforms:
            patch.allowedPlatforms ?? state.remoteRelayAllowedPlatforms,
          remoteRelayDefaultMode: 'flow',
          remoteRelayPollIntervalSeconds: Math.max(
            8,
            Math.min(120, Math.round(patch.pollIntervalSeconds ?? state.remoteRelayPollIntervalSeconds)),
          ),
        })),
      setRemoteRelayState: (patch) =>
        set((state) => ({
          remoteRelayStatus: patch.status ?? state.remoteRelayStatus,
          remoteRelayMessage: patch.message ?? state.remoteRelayMessage,
          remoteRelayLastJobAt: patch.lastJobAt ?? state.remoteRelayLastJobAt,
        })),
      upsertRemotePlatformCredential: (input) => {
        const now = Date.now()
        const existing = get().remotePlatformCredentials.find(
          (item) => item.platform === input.platform,
        )
        const credential: RemotePlatformCredential = {
          platform: input.platform,
          appId: input.appId ?? existing?.appId ?? '',
          secret: input.secret ?? existing?.secret ?? '',
          enabled: input.enabled ?? existing?.enabled ?? false,
          status: input.status ?? existing?.status ?? 'idle',
          lastError: input.lastError ?? existing?.lastError,
          updatedAt: now,
        }

        set((state) => ({
          remoteRelayEnabled:
            credential.enabled ||
            state.remotePlatformCredentials.some(
              (item) => item.platform !== credential.platform && item.enabled,
            ),
          remoteRelayAllowedPlatforms: ['feishu', 'qq', 'wecom'],
          remoteRelayDefaultMode: 'flow',
          remotePlatformCredentials: defaultRemotePlatformCredentials()
            .map((item) =>
              item.platform === credential.platform
                ? credential
                : state.remotePlatformCredentials.find((saved) => saved.platform === item.platform) ?? item,
            ),
        }))

        return credential
      },
      updateRemotePlatformCredentialStatus: (platform, patch) =>
        set((state) => ({
          remotePlatformCredentials: defaultRemotePlatformCredentials().map((item) => {
            const existing =
              state.remotePlatformCredentials.find((saved) => saved.platform === item.platform) ?? item

            return existing.platform === platform
              ? {
                  ...existing,
                  status: patch.status,
                  lastError: patch.lastError,
                  updatedAt: Date.now(),
                }
              : existing
          }),
        })),
      upsertStoryProject: (input) => {
        const now = Date.now()
        const existing = get().storyProjects.find((item) => item.id === input.id)
        const project: StoryProject = {
          ...input,
          id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `story-project-${now}`,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }

        set((state) => ({
          activeStoryProjectId: project.id,
          storyProjects: [
            project,
            ...state.storyProjects.filter((item) => item.id !== project.id),
          ].slice(0, 40),
        }))

        return project
      },
      setActiveStoryProject: (activeStoryProjectId) => set({ activeStoryProjectId }),
      addStoryContract: (input) => {
        const now = Date.now()
        const contract: StoryContract = {
          ...input,
          id: globalThis.crypto?.randomUUID?.() ?? `story-contract-${now}`,
          createdAt: now,
          updatedAt: now,
        }

        set((state) => ({
          storyContracts: [
            contract,
            ...state.storyContracts.filter((item) => item.projectId !== contract.projectId),
          ].slice(0, 80),
        }))

        return contract
      },
      addChapterContract: (input) => {
        const now = Date.now()
        const contract: ChapterContract = {
          ...input,
          id: globalThis.crypto?.randomUUID?.() ?? `chapter-contract-${now}`,
          createdAt: now,
        }

        set((state) => ({
          chapterContracts: [contract, ...state.chapterContracts].slice(0, 240),
        }))

        return contract
      },
      addReviewContract: (input) => {
        const now = Date.now()
        const contract: ReviewContract = {
          ...input,
          id: globalThis.crypto?.randomUUID?.() ?? `review-contract-${now}`,
          createdAt: now,
        }

        set((state) => ({
          reviewContracts: [contract, ...state.reviewContracts].slice(0, 240),
        }))

        return contract
      },
      addChapterCommit: (input) => {
        const now = Date.now()
        const commit: ChapterCommit = {
          ...input,
          id: globalThis.crypto?.randomUUID?.() ?? `chapter-commit-${now}`,
          createdAt: now,
        }

        set((state) => ({
          chapterCommits: [commit, ...state.chapterCommits].slice(0, 240),
        }))

        return commit
      },
      addStoryEvents: (events) =>
        set((state) => {
          const now = Date.now()
          const next = events.map((event, index) => ({
            ...event,
            id: globalThis.crypto?.randomUUID?.() ?? `story-event-${now}-${index}`,
            createdAt: now,
          }))

          return { storyEvents: [...next, ...state.storyEvents].slice(0, 800) }
        }),
      upsertStoryMemories: (memories) =>
        set((state) => {
          const now = Date.now()
          const keyed = new Map(
            state.storyMemories.map((item) => [
              `${item.projectId}:${item.category}:${item.subject}:${item.field}`,
              item,
            ]),
          )

          for (const memory of memories) {
            const key = `${memory.projectId}:${memory.category}:${memory.subject}:${memory.field}`
            keyed.set(key, {
              ...memory,
              id: keyed.get(key)?.id ?? globalThis.crypto?.randomUUID?.() ?? `memory-${now}`,
              status: memory.status ?? 'active',
              updatedAt: now,
            })
          }

          return {
            storyMemories: [...keyed.values()]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 800),
          }
        }),
      upsertOpenLoops: (loops) =>
        set((state) => {
          const now = Date.now()
          const next = loops.map((loop, index) => ({
            ...loop,
            id: globalThis.crypto?.randomUUID?.() ?? `open-loop-${now}-${index}`,
            updatedAt: now,
          }))

          return { openLoops: [...next, ...state.openLoops].slice(0, 300) }
        }),
      upsertReaderPromises: (promises) =>
        set((state) => {
          const now = Date.now()
          const next = promises.map((promise, index) => ({
            ...promise,
            id: globalThis.crypto?.randomUUID?.() ?? `reader-promise-${now}-${index}`,
            updatedAt: now,
          }))

          return { readerPromises: [...next, ...state.readerPromises].slice(0, 300) }
        }),
      setStoryDashboardOpen: (isStoryDashboardOpen) => set({ isStoryDashboardOpen }),
      setUsageCollapsed: (isUsageCollapsed) => set({ isUsageCollapsed }),
      setFirstLaunchComplete: () => set({ isFirstLaunch: false, isEnvReady: false }),
      setEnvReady: (isEnvReady) => set({ isEnvReady }),
      setMaintenanceTab: (maintenanceTab) => set({ maintenanceTab }),
      setMaintenanceCheck: (id, patch) =>
        set((state) => ({
          maintenanceChecks: state.maintenanceChecks.map((check) =>
            check.id === id
              ? {
                  ...check,
                  ...patch,
                  checkedAt: patch.status && patch.status !== 'checking' ? Date.now() : check.checkedAt,
                }
              : check,
          ),
        })),
      setMemoryUsageBytes: (memoryUsageBytes) => set({ memoryUsageBytes }),
      resetOobe: () =>
        set({
          isFirstLaunch: true,
          isEnvReady: false,
          maintenanceTab: 'connections',
          maintenanceChecks: initialMaintenanceChecks,
        }),
    }),
    {
      name: 'papyrus-workstation-settings-v1',
      partialize: (state) => ({
        isFirstLaunch: state.isFirstLaunch,
        isEnvReady: state.isEnvReady,
        mode: state.mode,
        columnMode: state.columnMode,
        isLeftCollapsed: state.isLeftCollapsed,
        activeProviderId: state.activeProviderId,
        modelRoutingMode: state.modelRoutingMode,
        autoModelProviderIds: state.autoModelProviderIds,
        modelTierWeights: state.modelTierWeights,
        modelTierAssessments: state.modelTierAssessments,
        activeAgentId: state.activeAgentId,
        flowReviewMode: 'auto' as const,
        flowThinkingEffort: state.flowThinkingEffort,
        activeVibeId: state.activeVibeId,
        vibeIntensity: state.vibeIntensity,
        compressionCount: state.compressionCount,
        compressedSummary: state.compressedSummary,
        lastAutoCompressionTokenMark: state.lastAutoCompressionTokenMark,
        autoCompressionArmed: state.autoCompressionArmed,
        mentionContextItems: state.mentionContextItems,
        negativeMemories: state.negativeMemories,
        projectGuidance: state.projectGuidance,
        articleTitle: state.articleTitle,
        activeArticleId: state.activeArticleId,
        articles: state.articles,
        documentRevision: state.documentRevision,
        editorText: state.editorText,
        editorHtml: state.editorHtml,
        editorSelectionText: state.editorSelectionText,
        flowMessages: state.flowMessages,
        companionMessages: state.companionMessages,
        chatSessions: state.chatSessions,
        activeChatId: state.activeChatId,
        agentMemoryRecords: state.agentMemoryRecords,
        agentRuns: state.agentRuns,
        resources: state.resources,
        scallionUser: state.scallionUser,
        scallionToken: state.scallionToken,
        scallionModels: state.scallionModels,
        scallionPlan: state.scallionPlan,
        scallionQuota: state.scallionQuota,
        hardwareCapabilityProfile: state.hardwareCapabilityProfile,
        authStatus: state.authStatus,
        remoteRelayEnabled: state.remoteRelayEnabled,
        remoteRelayEndpoint: state.remoteRelayEndpoint,
        remoteRelayChannelId: state.remoteRelayChannelId,
        remoteRelayAccessKey: state.remoteRelayAccessKey,
        remoteRelayAllowedPlatforms: state.remoteRelayAllowedPlatforms,
        remoteRelayDefaultMode: 'flow' as const,
        remoteRelayPollIntervalSeconds: state.remoteRelayPollIntervalSeconds,
        remotePlatformCredentials: state.remotePlatformCredentials,
        providerConfigs: state.providerConfigs,
        disabledBuiltInStudioAgentIds: state.disabledBuiltInStudioAgentIds,
        customStudioAgents: state.customStudioAgents,
        customAgentSkills: state.customAgentSkills,
        mcpServers: state.mcpServers,
        userMemoryProfile: state.userMemoryProfile,
        userMemoryRecords: state.userMemoryRecords,
        projectWritingMemories: state.projectWritingMemories,
        globalTowriteMarkdown: state.globalTowriteMarkdown,
        projectTowriteMarkdown: state.projectTowriteMarkdown,
        towriteSuggestions: state.towriteSuggestions,
        documentChangeStats: state.documentChangeStats,
        semanticTaskCache: state.semanticTaskCache,
        modelCallCacheMetrics: state.modelCallCacheMetrics,
        storyProjects: state.storyProjects,
        activeStoryProjectId: state.activeStoryProjectId,
        storyContracts: state.storyContracts,
        chapterContracts: state.chapterContracts,
        reviewContracts: state.reviewContracts,
        chapterCommits: state.chapterCommits,
        storyEvents: state.storyEvents,
        storyMemories: state.storyMemories,
        openLoops: state.openLoops,
        readerPromises: state.readerPromises,
        isUsageCollapsed: state.isUsageCollapsed,
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<AppState>
        const providerConfigs = mergeProviderConfigs(persistedState.providerConfigs)
        if (!persistedState.scallionToken) {
          providerConfigs.qwen36 = {
            ...providerConfigs.qwen36,
            validatedAt: undefined,
            lastValidatedSignature: undefined,
          }
        }
        const requestedProviderId = providerConfigs[persistedState.activeProviderId ?? 'qwen36']
          ? (persistedState.activeProviderId ?? 'qwen36')
          : 'qwen36'
        const activeProviderId = pickActiveProviderId(requestedProviderId, providerConfigs)
        const activeChatId = persistedState.activeChatId ?? current.activeChatId
        const articles = persistedState.articles?.length
          ? persistedState.articles
          : [
              {
                id: persistedState.activeArticleId ?? current.activeArticleId,
                title: persistedState.articleTitle ?? current.articleTitle,
                text: persistedState.editorText ?? current.editorText,
                html: persistedState.editorHtml ?? current.editorHtml,
                pinned: true,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ]
        const activeArticleId =
          persistedState.activeArticleId && articles.some((article) => article.id === persistedState.activeArticleId)
            ? persistedState.activeArticleId
            : articles[0].id
        const chatSessions = persistedState.chatSessions?.length
          ? persistedState.chatSessions.map((chat) => ({
              ...chat,
              articleId: chat.articleId ?? activeArticleId,
              articleIds: uniqueIds([...(chat.articleIds ?? []), chat.articleId, activeArticleId]),
              activeArticleId: chat.activeArticleId ?? chat.articleId ?? activeArticleId,
            }))
          : current.chatSessions
        const provider = providerConfigs[activeProviderId]
        const contextLimitTokens = getEffectiveContextLimit(provider)
        const merged = {
          ...current,
          ...persistedState,
          mode: 'flow' as const,
          activeProviderId,
          modelRoutingMode: normalizeModelRoutingMode(persistedState.modelRoutingMode),
          autoModelProviderIds: normalizeAutoModelProviderIds(
            persistedState.autoModelProviderIds,
          ),
          modelTierWeights: sanitizeModelTierWeights(persistedState.modelTierWeights),
          modelTierAssessments: sanitizeModelTierAssessments(
            persistedState.modelTierAssessments,
          ),
          activeArticleId,
          activeChatId,
          flowReviewMode: 'auto' as const,
          flowThinkingEffort: normalizeFlowThinkingEffort(persistedState.flowThinkingEffort),
          articles,
          chatSessions,
          articleTitle: persistedState.articleTitle ?? current.articleTitle,
          documentRevision: persistedState.documentRevision ?? current.documentRevision,
          isFirstLaunch: persistedState.isFirstLaunch ?? current.isFirstLaunch,
          isEnvReady: persistedState.isEnvReady ?? current.isEnvReady,
          maintenanceTab: 'connections' as const,
          maintenanceChecks: initialMaintenanceChecks,
          memoryUsageBytes: 0,
          activeVibeId: persistedState.activeVibeId ?? current.activeVibeId,
          vibeIntensity: persistedState.vibeIntensity ?? current.vibeIntensity,
          isSettingsOpen: false,
          llmRunState: 'idle' as const,
          llmStatusMessage: 'LLM 待命',
          companionRunState: 'idle' as const,
          agentSteps: persistedState.agentSteps ?? [],
          agentMemoryRecords: persistedState.agentMemoryRecords ?? current.agentMemoryRecords,
          agentRuns: persistedState.agentRuns ?? current.agentRuns,
          activeAgentRunId: undefined,
          queuedUserInputs: sanitizeQueuedUserInputs(persistedState.queuedUserInputs),
          activeSecretaryGoal: sanitizeSecretaryGoal(persistedState.activeSecretaryGoal),
          goalCheckpoints: sanitizeGoalCheckpoints(persistedState.goalCheckpoints),
          updateStatus: 'idle' as const,
          updateMessage: '自动更新待命',
          updateProgress: 0,
          authStatus: (persistedState.scallionToken ? 'approved' : 'idle') as ScallionAuthStatus,
          scallionModels: sanitizeScallionModels(persistedState.scallionModels),
          scallionPlan: sanitizeScallionPlan(persistedState.scallionPlan),
          scallionQuota: sanitizeScallionQuota(persistedState.scallionQuota),
          hardwareCapabilityProfile: sanitizeHardwareCapabilityProfile(
            persistedState.hardwareCapabilityProfile,
          ),
          remoteRelayEnabled: persistedState.remoteRelayEnabled ?? current.remoteRelayEnabled,
          remoteRelayEndpoint: persistedState.remoteRelayEndpoint ?? current.remoteRelayEndpoint,
          remoteRelayChannelId: persistedState.remoteRelayChannelId ?? current.remoteRelayChannelId,
          remoteRelayAccessKey: persistedState.remoteRelayAccessKey ?? current.remoteRelayAccessKey,
          remoteRelayAllowedPlatforms: ['feishu', 'qq', 'wecom'] as RemoteRelayPlatform[],
          remoteRelayDefaultMode: 'flow' as const,
          remoteRelayPollIntervalSeconds:
            persistedState.remoteRelayPollIntervalSeconds ?? current.remoteRelayPollIntervalSeconds,
          remoteRelayStatus: 'idle' as const,
          remoteRelayMessage: persistedState.remoteRelayEnabled
            ? '远程中继等待连接'
            : '远程中继未启用',
          remoteRelayLastJobAt: persistedState.remoteRelayLastJobAt,
          remotePlatformCredentials: sanitizeRemotePlatformCredentials(
            persistedState.remotePlatformCredentials,
          ),
          providerConfigs,
          disabledBuiltInStudioAgentIds: sanitizeDisabledStudioAgentIds(
            persistedState.disabledBuiltInStudioAgentIds,
          ),
          customStudioAgents: sanitizeCustomStudioAgents(persistedState.customStudioAgents),
          customAgentSkills: sanitizeCustomAgentSkills(persistedState.customAgentSkills),
          mcpServers: sanitizeMcpServers(persistedState.mcpServers),
          userMemoryProfile: sanitizeUserMemoryProfile(
            persistedState.userMemoryProfile,
            current.userMemoryProfile,
          ),
          userMemoryRecords: sanitizeUserMemoryRecords(persistedState.userMemoryRecords),
          projectWritingMemories: sanitizeProjectWritingMemories(
            persistedState.projectWritingMemories,
          ),
          globalTowriteMarkdown:
            typeof persistedState.globalTowriteMarkdown === 'string'
              ? persistedState.globalTowriteMarkdown
              : current.globalTowriteMarkdown,
          projectTowriteMarkdown:
            typeof persistedState.projectTowriteMarkdown === 'string'
              ? persistedState.projectTowriteMarkdown
              : current.projectTowriteMarkdown,
          towriteSuggestions: sanitizeTowriteSuggestions(persistedState.towriteSuggestions),
          documentChangeStats: sanitizeDocumentChangeStats(persistedState.documentChangeStats),
          agentOutputCache: sanitizeAgentOutputCache(persistedState.agentOutputCache),
          semanticTaskCache: sanitizeSemanticTaskCache(persistedState.semanticTaskCache),
          modelCallCacheMetrics: sanitizeModelCallCacheMetrics(
            persistedState.modelCallCacheMetrics,
          ),
          hiveTelemetry: emptyHiveTelemetry(),
          secretaryPlanDraft: undefined,
          storyProjects: persistedState.storyProjects ?? current.storyProjects,
          activeStoryProjectId: persistedState.activeStoryProjectId ?? current.activeStoryProjectId,
          storyContracts: persistedState.storyContracts ?? current.storyContracts,
          chapterContracts: persistedState.chapterContracts ?? current.chapterContracts,
          reviewContracts: persistedState.reviewContracts ?? current.reviewContracts,
          chapterCommits: persistedState.chapterCommits ?? current.chapterCommits,
          storyEvents: persistedState.storyEvents ?? current.storyEvents,
          storyMemories: persistedState.storyMemories ?? current.storyMemories,
          openLoops: persistedState.openLoops ?? current.openLoops,
          readerPromises: persistedState.readerPromises ?? current.readerPromises,
          isStoryDashboardOpen: false,
          isUsageCollapsed: persistedState.isUsageCollapsed ?? current.isUsageCollapsed,
          contextLimitTokens,
          effectiveContextLimitTokens: contextLimitTokens,
          modelContextSource: getModelContextSource(provider),
        }

        return {
          ...merged,
          ...calculateTokenSnapshot(
            merged.editorText,
            merged.flowMessages,
            merged.compressedSummary,
            merged.resources,
          ),
        }
      },
    },
  ),
)

function normalizeFlowAgents(agents: FlowAgentId[] = []): FlowAgentId[] {
  const valid = agents
    .map((agentId) => (typeof agentId === 'string' ? agentId.trim() : ''))
    .filter(Boolean)
  return valid.length ? Array.from(new Set(valid)) : (['writer'] as FlowAgentId[])
}

function defaultRemotePlatformCredentials(): RemotePlatformCredential[] {
  return [
    { platform: 'feishu', appId: '', secret: '', enabled: false, status: 'idle' },
    { platform: 'qq', appId: '', secret: '', enabled: false, status: 'idle' },
    { platform: 'wecom', appId: '', secret: '', enabled: false, status: 'idle' },
  ]
}

function sanitizeRemotePlatformCredentials(value: unknown): RemotePlatformCredential[] {
  if (!Array.isArray(value)) {
    return defaultRemotePlatformCredentials()
  }

  const allowed = new Set<RemotePlatformCredential['platform']>(['feishu', 'qq', 'wecom'])
  const saved = new Map<RemotePlatformCredential['platform'], Partial<RemotePlatformCredential>>()

  value
    .filter((item): item is Partial<RemotePlatformCredential> => Boolean(item && typeof item === 'object'))
    .forEach((item) => {
      if (allowed.has(item.platform as RemotePlatformCredential['platform'])) {
        saved.set(item.platform as RemotePlatformCredential['platform'], item)
      }
    })

  return defaultRemotePlatformCredentials().map((fallback) => {
    const item = saved.get(fallback.platform)
    const status: RemotePlatformCredentialStatus = ['idle', 'testing', 'ok', 'error'].includes(
      item?.status ?? '',
    )
      ? (item?.status as RemotePlatformCredentialStatus)
      : 'idle'

    return {
      platform: fallback.platform,
      appId: typeof item?.appId === 'string' ? item.appId : '',
      secret: typeof item?.secret === 'string' ? item.secret : '',
      enabled: item?.enabled === true,
      status,
      lastError: typeof item?.lastError === 'string' ? item.lastError : undefined,
      updatedAt: typeof item?.updatedAt === 'number' ? item.updatedAt : undefined,
    }
  })
}

function sanitizeDisabledStudioAgentIds(value: unknown): StudioAgentId[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item && item !== 'writer'),
    ),
  ).slice(0, 200)
}

function normalizeStudioAgentCategory(value: unknown): StudioAgentCategory {
  const allowed: StudioAgentCategory[] = [
    'core',
    'writing',
    'academic',
    'operations',
    'marketing',
    'professional',
    'product',
    'review',
  ]

  return allowed.includes(value as StudioAgentCategory) ? (value as StudioAgentCategory) : 'writing'
}

function normalizeStudioAgentOutputType(value: unknown): StudioAgentOutputType {
  const allowed: StudioAgentOutputType[] = [
    'draft',
    'research',
    'critique',
    'strategy',
    'compliance',
    'summary',
  ]

  return allowed.includes(value as StudioAgentOutputType)
    ? (value as StudioAgentOutputType)
    : 'summary'
}

function sanitizeCustomStudioAgents(value: unknown): CustomStudioAgent[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<CustomStudioAgent> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const name = typeof item.name === 'string' ? item.name.trim() : ''

      if (!name) {
        return undefined
      }

      return {
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id.trim()
            : `custom-agent-${now}-${index}`,
        name,
        shortName:
          typeof item.shortName === 'string' && item.shortName.trim()
            ? item.shortName.trim()
            : name.slice(0, 6),
        category: normalizeStudioAgentCategory(item.category),
        description: typeof item.description === 'string' ? item.description.trim() : '',
        taskTypes: normalizeStringList(item.taskTypes).slice(0, 12),
        keywords: normalizeStringList(item.keywords).slice(0, 24),
        systemPrompt: typeof item.systemPrompt === 'string' ? item.systemPrompt.trim() : '',
        outputRules: normalizeStringList(item.outputRules).slice(0, 12),
        outputType: normalizeStudioAgentOutputType(item.outputType),
        enabled: item.enabled === true,
        builtIn: false,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
      } satisfies CustomStudioAgent
    })
    .filter(Boolean)
    .slice(0, 80) as CustomStudioAgent[]
}

function sanitizeCustomAgentSkills(value: unknown): CustomAgentSkill[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<CustomAgentSkill> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const name = typeof item.name === 'string' ? item.name.trim() : ''

      if (!name) {
        return undefined
      }

      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id : `custom-skill-${now}-${index}`,
        name,
        shortName:
          typeof item.shortName === 'string' && item.shortName.trim()
            ? item.shortName.trim()
            : name,
        trigger: typeof item.trigger === 'string' ? item.trigger.trim() : '',
        agents: normalizeFlowAgents(item.agents as FlowAgentId[]),
        keywordsText: typeof item.keywordsText === 'string' ? item.keywordsText.trim() : '',
        instructionsText: typeof item.instructionsText === 'string' ? item.instructionsText.trim() : '',
        outputRulesText: typeof item.outputRulesText === 'string' ? item.outputRulesText.trim() : '',
        enabled: item.enabled !== false,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
      } satisfies CustomAgentSkill
    })
    .filter(Boolean)
    .slice(0, 60) as CustomAgentSkill[]
}

function sanitizeMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<McpServerConfig> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const name = typeof item.name === 'string' ? item.name.trim() : ''

      if (!name) {
        return undefined
      }

      const transport: McpServerTransport = item.transport === 'stdio' ? 'stdio' : 'http'
      const status: McpServerStatus = ['idle', 'testing', 'ok', 'error', 'unsupported'].includes(
        item.status ?? '',
      )
        ? (item.status as McpServerStatus)
        : 'idle'

      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id : `mcp-server-${now}-${index}`,
        name,
        transport,
        endpoint: typeof item.endpoint === 'string' ? item.endpoint.trim() : '',
        command: typeof item.command === 'string' ? item.command.trim() : '',
        headersText: typeof item.headersText === 'string' ? item.headersText.trim() : '',
        envText: typeof item.envText === 'string' ? item.envText.trim() : '',
        enabled: item.enabled !== false,
        status,
        lastError: typeof item.lastError === 'string' ? item.lastError : undefined,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
      } satisfies McpServerConfig
    })
    .filter(Boolean)
    .slice(0, 40) as McpServerConfig[]
}

function sanitizeUserMemoryProfile(
  value: unknown,
  fallback: UserMemoryProfile,
): UserMemoryProfile {
  if (!value || typeof value !== 'object') {
    return fallback
  }

  const item = value as Partial<UserMemoryProfile>
  const mode: UserMemoryMode =
    item.mode === 'off' || item.mode === 'low_risk_auto' ? item.mode : 'confirm'

  return {
    enabled: item.enabled !== false,
    mode,
    displayName: typeof item.displayName === 'string' ? item.displayName : '',
    identity: typeof item.identity === 'string' ? item.identity : '',
    personality: typeof item.personality === 'string' ? item.personality : '',
    writingHabits: typeof item.writingHabits === 'string' ? item.writingHabits : '',
    stylePreferences: typeof item.stylePreferences === 'string' ? item.stylePreferences : '',
    constraints: typeof item.constraints === 'string' ? item.constraints : '',
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : undefined,
  }
}

function sanitizeUserMemoryRecords(value: unknown): UserMemoryRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<UserMemoryRecord> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const content = typeof item.content === 'string' ? item.content.trim() : ''

      if (!content) {
        return undefined
      }

      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id : `user-memory-${now}-${index}`,
        category: normalizeUserMemoryCategory(item.category),
        content,
        source: normalizeUserMemorySource(item.source),
        enabled: item.enabled !== false,
        confidence: clampNumber(typeof item.confidence === 'number' ? item.confidence : 0.7, 0.1, 1),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
      } satisfies UserMemoryRecord
    })
    .filter(Boolean)
    .slice(0, 160) as UserMemoryRecord[]
}

function sanitizeProjectWritingMemories(value: unknown): ProjectWritingMemory[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<ProjectWritingMemory> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const content = typeof item.content === 'string' ? item.content.trim() : ''

      if (!content) {
        return undefined
      }

      return {
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id
            : `project-memory-${now}-${index}`,
        projectId: typeof item.projectId === 'string' ? item.projectId : undefined,
        chatId: typeof item.chatId === 'string' ? item.chatId : undefined,
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '未命名记忆',
        content,
        tags: normalizeStringList(item.tags),
        enabled: item.enabled !== false,
        source: normalizeProjectMemorySource(item.source),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
      } satisfies ProjectWritingMemory
    })
    .filter(Boolean)
    .slice(0, 240) as ProjectWritingMemory[]
}

function sanitizeTowriteSuggestions(value: unknown): TowriteSuggestion[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<TowriteSuggestion> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const content = typeof item.content === 'string' ? item.content.trim() : ''

      if (!content) {
        return undefined
      }

      return {
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id
            : `towrite-suggestion-${now}-${index}`,
        scope: item.scope === 'project' ? 'project' : 'global',
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '记忆建议',
        content,
        reason: typeof item.reason === 'string' ? item.reason.trim() : '',
        status:
          item.status === 'accepted' || item.status === 'rejected' ? item.status : 'pending',
        sourceRunId: typeof item.sourceRunId === 'string' ? item.sourceRunId : undefined,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
      } satisfies TowriteSuggestion
    })
    .filter(Boolean)
    .slice(0, 80) as TowriteSuggestion[]
}

function sanitizeDocumentChangeStats(value: unknown): DocumentChangeStat[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<DocumentChangeStat> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const operation = normalizePatchOperationValue(item.operation)

      return {
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id
            : `document-change-${now}-${index}`,
        chatId: typeof item.chatId === 'string' ? item.chatId : undefined,
        articleId: typeof item.articleId === 'string' ? item.articleId : undefined,
        agentRunId: typeof item.agentRunId === 'string' ? item.agentRunId : undefined,
        patchId: typeof item.patchId === 'string' ? item.patchId : undefined,
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '文稿写入',
        operation,
        insertedChars: Math.max(0, Math.round(item.insertedChars ?? 0)),
        deletedChars: Math.max(0, Math.round(item.deletedChars ?? 0)),
        changedChars: Math.max(0, Math.round(item.changedChars ?? 0)),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      } satisfies DocumentChangeStat
    })
    .slice(0, 400)
}

function normalizeModelRoutingMode(value: unknown): ModelRoutingMode {
  return value === 'auto' ? 'auto' : 'manual'
}

function normalizeAutoModelProviderIds(value: unknown): ProviderId[] {
  const ids = Array.isArray(value) ? value : defaultAutoModelProviderIds
  const normalized = ids.filter((providerId): providerId is ProviderId =>
    providerOrder.includes(providerId as ProviderId),
  )

  return normalized.length ? Array.from(new Set(normalized)) : defaultAutoModelProviderIds
}

function sanitizeModelTierWeights(value: unknown): Record<ModelCapabilityTier, number> {
  const input = value && typeof value === 'object' ? (value as Partial<Record<ModelCapabilityTier, number>>) : {}

  return {
    T1: clampNumber(Number(input.T1 ?? defaultModelTierWeights.T1), 0.1, 2),
    T2: clampNumber(Number(input.T2 ?? defaultModelTierWeights.T2), 0.1, 2),
    T3: clampNumber(Number(input.T3 ?? defaultModelTierWeights.T3), 0.1, 2),
  }
}

function sanitizeModelTierAssessments(value: unknown): ModelTierAssessment[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<ModelTierAssessment> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const providerId = providerOrder.includes(item.providerId as ProviderId)
        ? (item.providerId as ProviderId)
        : 'qwen36'
      const modelName = typeof item.modelName === 'string' ? item.modelName.trim() : ''
      const id =
        typeof item.id === 'string' && item.id.trim()
          ? item.id.trim()
          : `${providerId}:${modelName || index}`

      return {
        id,
        providerId,
        label:
          typeof item.label === 'string' && item.label.trim()
            ? item.label.trim().slice(0, 80)
            : modelName || defaultProviderConfigs[providerId].label,
        modelName: modelName || defaultProviderConfigs[providerId].modelName,
        tier: normalizeModelCapabilityTier(item.tier),
        score: clampNumber(Number(item.score ?? 50), 0, 100),
        rationale:
          typeof item.rationale === 'string' && item.rationale.trim()
            ? item.rationale.trim().slice(0, 220)
            : '按本地可解释规则评估。',
        available: item.available !== false,
        contextWindowTokens:
          typeof item.contextWindowTokens === 'number' && item.contextWindowTokens > 0
            ? Math.round(item.contextWindowTokens)
            : undefined,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
      } satisfies ModelTierAssessment
    })
    .slice(0, 80)
}

function normalizeModelCapabilityTier(value: unknown): ModelCapabilityTier {
  return value === 'T1' || value === 'T2' || value === 'T3' ? value : 'T2'
}

function defaultScallionSyncState(): ScallionSyncState {
  return {
    models: { status: 'idle' },
    quota: { status: 'idle' },
  }
}

function defaultHardwareProfile(): HardwareCapabilityProfile {
  return {
    cpuCores: 4,
    memoryGb: undefined,
    gpuLabel: undefined,
    tier: 'medium',
    maxHiveAgents: 6,
    maxHiveParallelAgents: 2,
    reason: '未检测到完整硬件信息，采用保守蜂巢限流。',
    updatedAt: Date.now(),
  }
}

function sanitizeHardwareCapabilityProfile(value: unknown): HardwareCapabilityProfile {
  if (!value || typeof value !== 'object') {
    return defaultHardwareProfile()
  }

  const item = value as Partial<HardwareCapabilityProfile>
  const cpuCores = Math.max(1, Math.round(Number(item.cpuCores ?? 4) || 4))
  const memoryGb =
    typeof item.memoryGb === 'number' && item.memoryGb > 0
      ? Math.round(item.memoryGb * 10) / 10
      : undefined
  const maxHiveAgents = Math.max(2, Math.min(12, Math.round(Number(item.maxHiveAgents ?? 6) || 6)))
  const maxHiveParallelAgents = Math.max(
    1,
    Math.min(maxHiveAgents, Math.round(Number(item.maxHiveParallelAgents ?? 2) || 2)),
  )

  return {
    cpuCores,
    memoryGb,
    gpuLabel: typeof item.gpuLabel === 'string' && item.gpuLabel.trim() ? item.gpuLabel.trim() : undefined,
    tier: normalizeHardwareTier(item.tier),
    maxHiveAgents,
    maxHiveParallelAgents,
    reason:
      typeof item.reason === 'string' && item.reason.trim()
        ? item.reason.trim().slice(0, 180)
        : '按本机配置限制 ultra+hive 的 agent 数量。',
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
  }
}

function normalizeHardwareTier(value: unknown): HardwareCapabilityProfile['tier'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'ultra'
    ? value
    : 'medium'
}

function emptyHiveTelemetry(): HiveTelemetry {
  return {
    enabled: false,
    plannedAgents: 0,
    activeAgents: 0,
    completedAgents: 0,
    skippedAgents: 0,
    failedAgents: 0,
    retryCount: 0,
    timedOut: false,
    circuitBreaker: {
      open: false,
      failureCount: 0,
    },
    blackboard: [],
  }
}

function sanitizeScallionModels(value: unknown): ScallionModelMetadata[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<ScallionModelMetadata> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const modelName = typeof item.modelName === 'string' ? item.modelName.trim() : ''
      const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : modelName

      if (!id && !modelName) {
        return undefined
      }

      return {
        id: id || `scallion-model-${index}`,
        label:
          typeof item.label === 'string' && item.label.trim()
            ? item.label.trim()
            : modelName || `内置模型 ${index + 1}`,
        modelName: modelName || id,
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined,
        provider: typeof item.provider === 'string' && item.provider.trim() ? item.provider.trim() : undefined,
        billingMode:
          typeof item.billingMode === 'string' && item.billingMode.trim()
            ? item.billingMode.trim()
            : undefined,
        callPrice:
          typeof item.callPrice === 'number' && Number.isFinite(item.callPrice) && item.callPrice >= 0
            ? item.callPrice
            : undefined,
        contextWindowLabel:
          typeof item.contextWindowLabel === 'string' && item.contextWindowLabel.trim()
            ? item.contextWindowLabel.trim()
            : undefined,
        manualAvailable:
          typeof item.manualAvailable === 'boolean' ? item.manualAvailable : item.planAvailable !== false,
        autoAvailable:
          typeof item.autoAvailable === 'boolean'
            ? item.autoAvailable
            : item.planAvailable !== false,
        autoOnly: item.autoOnly === true,
        planAvailable: item.planAvailable !== false,
        requiredPlan:
          typeof item.requiredPlan === 'string' && item.requiredPlan.trim()
            ? item.requiredPlan.trim()
            : undefined,
        autoRequiredPlan:
          typeof item.autoRequiredPlan === 'string' && item.autoRequiredPlan.trim()
            ? item.autoRequiredPlan.trim()
            : undefined,
        availabilityReason:
          typeof item.availabilityReason === 'string' && item.availabilityReason.trim()
            ? item.availabilityReason.trim()
            : undefined,
        contextWindowTokens:
          typeof item.contextWindowTokens === 'number' && item.contextWindowTokens > 0
            ? Math.round(item.contextWindowTokens)
            : undefined,
        available: item.available !== false,
        tier: item.tier ? normalizeModelCapabilityTier(item.tier) : undefined,
        score:
          typeof item.score === 'number' && Number.isFinite(item.score)
            ? clampNumber(item.score, 0, 100)
            : undefined,
        rationale:
          typeof item.rationale === 'string' && item.rationale.trim()
            ? item.rationale.trim().slice(0, 220)
            : undefined,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
      } satisfies ScallionModelMetadata
    })
    .filter(Boolean) as ScallionModelMetadata[]
}

function sanitizeScallionQuota(value: unknown): ScallionQuota | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const item = value as Partial<ScallionQuota>
  return {
    remaining: Math.max(0, Number(item.remaining ?? 0)),
    pointsBalance:
      item.pointsBalance === undefined ? undefined : Math.max(0, Number(item.pointsBalance) || 0),
    balance: item.balance === undefined ? undefined : Math.max(0, Number(item.balance) || 0),
    quota: item.quota === undefined ? undefined : Math.max(0, Number(item.quota) || 0),
    unifiedPoints: item.unifiedPoints === true,
    planKey: typeof item.planKey === 'string' ? item.planKey.trim() || undefined : undefined,
    planName: typeof item.planName === 'string' ? item.planName.trim() || undefined : undefined,
    planExpiresAt:
      typeof item.planExpiresAt === 'string' || item.planExpiresAt === null
        ? item.planExpiresAt
        : undefined,
    total:
      item.total === undefined || item.total === null
        ? undefined
        : Math.max(0, Number(item.total) || 0),
    unit: typeof item.unit === 'string' && item.unit.trim() ? item.unit.trim() : '积分',
    isMember: item.isMember === true,
    manualModels: sanitizeStringArray(item.manualModels),
    autoModels: sanitizeStringArray(item.autoModels),
    autoMonthlyCalls: sanitizeNonNegativeNumber(item.autoMonthlyCalls),
    autoDailyCalls: sanitizeNonNegativeNumber(item.autoDailyCalls),
    autoMonthlyUsed: sanitizeNonNegativeNumber(item.autoMonthlyUsed),
    autoDailyUsed: sanitizeNonNegativeNumber(item.autoDailyUsed),
    autoMonthlyRemaining: sanitizeNonNegativeNumber(item.autoMonthlyRemaining),
    autoDailyRemaining: sanitizeNonNegativeNumber(item.autoDailyRemaining),
    externalApi:
      typeof item.externalApi === 'boolean'
        ? item.externalApi
        : typeof item.externalApi === 'string' && item.externalApi.trim()
          ? item.externalApi.trim()
          : undefined,
    memberPriceLabel:
      typeof item.memberPriceLabel === 'string' && item.memberPriceLabel.trim()
        ? item.memberPriceLabel.trim()
        : '9.9 元/月',
    upgradeUrl:
      typeof item.upgradeUrl === 'string' && item.upgradeUrl.trim()
        ? item.upgradeUrl.trim()
        : 'https://scallion.uno/pricing',
    topUpUrl:
      typeof item.topUpUrl === 'string' && item.topUpUrl.trim()
        ? item.topUpUrl.trim()
        : 'https://scallion.uno/pricing',
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
  }
}

function sanitizeScallionPlan(value: unknown): ScallionPlan | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Partial<ScallionPlan>
  const key = typeof item.key === 'string' ? item.key.trim() : ''
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!key && !name) return undefined
  const list = (input: unknown) =>
    Array.isArray(input)
      ? input.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
      : []
  const number = (input: unknown) => {
    if (input === undefined || input === null || input === '') return undefined
    const parsed = typeof input === 'number' ? input : Number(input)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined
  }
  const externalApi =
    typeof item.externalApi === 'boolean'
      ? item.externalApi
      : typeof item.externalApi === 'string' && item.externalApi.trim()
        ? item.externalApi.trim()
        : undefined
  return {
    key: key || name.toLowerCase() || 'free',
    name: name || key || 'Free',
    expiresAt: typeof item.expiresAt === 'string' || item.expiresAt === null ? item.expiresAt : undefined,
    availableModels: list(item.availableModels),
    manualModels: list(item.manualModels),
    autoModels: list(item.autoModels),
    autoMonthlyCalls: number(item.autoMonthlyCalls),
    autoDailyCalls: number(item.autoDailyCalls),
    externalApi,
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
  }
}

function sanitizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : undefined
}

function sanitizeNonNegativeNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : undefined
}

function sanitizeModelCallCacheMetrics(value: unknown): ModelCallCacheMetric[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<ModelCallCacheMetric> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const cacheKey = typeof item.cacheKey === 'string' ? item.cacheKey.trim() : ''
      const stage = typeof item.stage === 'string' ? item.stage.trim() : ''

      if (!cacheKey || !stage) {
        return undefined
      }

      return {
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id.trim()
            : `model-cache-metric-${Date.now()}-${index}`,
        cacheKey: cacheKey.slice(0, 260),
        stage: stage.slice(0, 64),
        cacheable: item.cacheable !== false,
        hit: item.hit === true,
        missReason:
          typeof item.missReason === 'string' && item.missReason.trim()
            ? item.missReason.trim().slice(0, 160)
            : undefined,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
      } satisfies ModelCallCacheMetric
    })
    .filter(Boolean)
    .slice(0, 400) as ModelCallCacheMetric[]
}

function sanitizeAgentOutputCache(value: unknown): AgentOutputCacheEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<AgentOutputCacheEntry> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const summary = typeof item.summary === 'string' ? item.summary.trim() : ''

      if (!summary) {
        return undefined
      }

      return {
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id
            : `agent-output-${now}-${index}`,
        agentRunId: typeof item.agentRunId === 'string' ? item.agentRunId : undefined,
        agentId: typeof item.agentId === 'string' && item.agentId.trim() ? item.agentId : 'writer',
        outputType: normalizeAgentOutputType(item.outputType),
        summary: summary.slice(0, 1200),
        keyPoints: normalizeStringList(item.keyPoints).slice(0, 8),
        risks: normalizeStringList(item.risks).slice(0, 6),
        handoff: typeof item.handoff === 'string' ? item.handoff.trim().slice(0, 800) : '',
        confidence: clampNumber(Number(item.confidence ?? 0.65), 0, 1),
        newInformation: item.newInformation !== false,
        rawLength: Math.max(0, Math.round(Number(item.rawLength ?? summary.length))),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      } satisfies AgentOutputCacheEntry
    })
    .filter(Boolean)
    .slice(0, 160) as AgentOutputCacheEntry[]
}

function sanitizeSemanticTaskCache(value: unknown): SemanticTaskCacheEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<SemanticTaskCacheEntry> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const taskType = typeof item.taskType === 'string' ? item.taskType.trim() : ''
      const promptFingerprint =
        typeof item.promptFingerprint === 'string' ? item.promptFingerprint.trim() : ''
      const summary = typeof item.summary === 'string' ? item.summary.trim() : ''

      if (!taskType || !promptFingerprint || !summary) {
        return undefined
      }

      return {
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id
            : `semantic-cache-${now}-${index}`,
        taskType: taskType.slice(0, 80),
        promptFingerprint: promptFingerprint.slice(0, 220),
        promptExcerpt:
          typeof item.promptExcerpt === 'string'
            ? item.promptExcerpt.trim().slice(0, 260)
            : '',
        summary: summary.slice(0, taskType.startsWith('model-cache:') ? 8000 : 1400),
        sources: Array.isArray(item.sources) ? item.sources.slice(0, 8) : undefined,
        hitCount: Math.max(0, Math.round(Number(item.hitCount ?? 0))),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
      } satisfies SemanticTaskCacheEntry
    })
    .filter(Boolean)
    .slice(0, 120) as SemanticTaskCacheEntry[]
}

function normalizeAgentOutputType(value: unknown): AgentOutputCacheEntry['outputType'] {
  const allowed: AgentOutputCacheEntry['outputType'][] = [
    'draft',
    'research',
    'critique',
    'strategy',
    'compliance',
    'summary',
  ]
  return allowed.includes(value as AgentOutputCacheEntry['outputType'])
    ? (value as AgentOutputCacheEntry['outputType'])
    : 'summary'
}

function normalizeFlowThinkingEffort(value: unknown): FlowThinkingEffort {
  if (value === 'max' || value === '最高' || value === 'ultra+hive') {
    return 'ultra_hive'
  }

  const allowed: FlowThinkingEffort[] = ['low', 'medium', 'high', 'ultra_hive']
  return allowed.includes(value as FlowThinkingEffort) ? (value as FlowThinkingEffort) : 'medium'
}

function normalizeGoalVerdict(value: unknown): GoalJudgeVerdict {
  const allowed: GoalJudgeVerdict[] = ['continue', 'complete', 'blocked', 'early_stop']
  return allowed.includes(value as GoalJudgeVerdict) ? (value as GoalJudgeVerdict) : 'continue'
}

function sanitizeQueuedUserInputs(value: unknown): QueuedUserInput[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<QueuedUserInput> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const content = typeof item.content === 'string' ? item.content.trim() : ''

      if (!content) {
        return undefined
      }

      const status: QueuedUserInputStatus =
        item.status === 'guidance' || item.status === 'sending' ? item.status : 'queued'

      return {
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id
            : `queued-input-${now}-${index}`,
        content,
        status,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
        guidedAt: typeof item.guidedAt === 'number' ? item.guidedAt : undefined,
      } satisfies QueuedUserInput
    })
    .filter(Boolean)
    .slice(-20) as QueuedUserInput[]
}

function sanitizeSecretaryGoal(value: unknown): SecretaryGoal | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const item = value as Partial<SecretaryGoal>
  const request = typeof item.request === 'string' ? item.request.trim() : ''

  if (!request) {
    return undefined
  }

  const now = Date.now()
  const allowedStatus: SecretaryGoalStatus[] = ['active', 'paused', 'completed', 'blocked', 'cancelled']
  const status = allowedStatus.includes(item.status as SecretaryGoalStatus)
    ? (item.status as SecretaryGoalStatus)
    : 'active'

  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : `secretary-goal-${now}`,
    title:
      typeof item.title === 'string' && item.title.trim()
        ? item.title.trim()
        : '长程写作目标',
    request,
    acceptanceCriteria: normalizeStringList(item.acceptanceCriteria).slice(0, 8),
    phasePlan: normalizeStringList(item.phasePlan).slice(0, 10),
    currentProgress:
      typeof item.currentProgress === 'string' && item.currentProgress.trim()
        ? item.currentProgress.trim()
        : '目标已建立，等待秘书模式推进。',
    status,
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
  }
}

function sanitizeGoalCheckpoints(value: unknown): GoalCheckpoint[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Partial<GoalCheckpoint> => Boolean(item && typeof item === 'object'))
    .map((item, index) => {
      const now = Date.now()
      const goalId = typeof item.goalId === 'string' ? item.goalId.trim() : ''

      if (!goalId || !item.judge) {
        return undefined
      }

      const judge = item.judge as Partial<GoalJudgeResult>

      return {
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id
            : `goal-checkpoint-${now}-${index}`,
        goalId,
        title:
          typeof item.title === 'string' && item.title.trim()
            ? item.title.trim()
            : '裁判检查',
        summary: typeof item.summary === 'string' ? item.summary.trim() : '',
        judge: {
          verdict: normalizeGoalVerdict(judge.verdict),
          summary: typeof judge.summary === 'string' ? judge.summary.trim() : '',
          evidence: normalizeStringList(judge.evidence).slice(0, 6),
          nextStep: typeof judge.nextStep === 'string' ? judge.nextStep.trim() : '',
          checkedAt: typeof judge.checkedAt === 'number' ? judge.checkedAt : now,
        },
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      } satisfies GoalCheckpoint
    })
    .filter(Boolean)
    .slice(0, 80) as GoalCheckpoint[]
}

function normalizeUserMemoryCategory(value: unknown): UserMemoryCategory {
  const allowed: UserMemoryCategory[] = [
    'identity',
    'personality',
    'habit',
    'style',
    'preference',
    'constraint',
    'project',
    'other',
  ]
  return allowed.includes(value as UserMemoryCategory) ? (value as UserMemoryCategory) : 'other'
}

function normalizeUserMemorySource(value: unknown): UserMemoryRecord['source'] {
  const allowed: UserMemoryRecord['source'][] = [
    'manual',
    'agent_suggestion',
    'towrite',
    'agent_observation',
  ]
  return allowed.includes(value as UserMemoryRecord['source'])
    ? (value as UserMemoryRecord['source'])
    : 'manual'
}

function normalizeProjectMemorySource(value: unknown): ProjectWritingMemory['source'] {
  const allowed: ProjectWritingMemory['source'][] = ['manual', 'towrite', 'resource', 'story', 'agent']
  return allowed.includes(value as ProjectWritingMemory['source'])
    ? (value as ProjectWritingMemory['source'])
    : 'manual'
}

function normalizePatchOperationValue(value: unknown): DocumentPatchOperation {
  const allowed: DocumentPatchOperation[] = [
    'insert_at_cursor',
    'append_section',
    'replace_selection',
    'replace_document',
  ]
  return allowed.includes(value as DocumentPatchOperation)
    ? (value as DocumentPatchOperation)
    : 'append_section'
}

function pickActiveProviderId(
  providerId: ProviderId,
  providerConfigs: Record<ProviderId, LlmProviderConfig>,
) {
  const provider = providerConfigs[providerId]

  if (!provider) {
    return 'qwen36'
  }

  if (provider.type === 'scallion_proxy') {
    return provider.id
  }

  if (
    provider.baseUrl.trim() &&
    provider.modelName.trim() &&
    provider.apiKey.trim() &&
    isProviderValidated(provider)
  ) {
    return provider.id
  }

  return 'qwen36'
}

function upsertCurrentChat(
  chatSessions: ChatSession[],
  activeChatId: string,
  flowMessages: FlowMessage[],
  activeArticleId: string,
) {
  const now = Date.now()
  const firstUserMessage = flowMessages.find((message) => message.role === 'user')
  const fallbackTitle = firstUserMessage?.content.slice(0, 24) || '新对话'

  return chatSessions.map((chat) =>
    chat.id === activeChatId
      ? {
          ...chat,
          title:
            chat.title === '初始对话' || chat.title.startsWith('新对话')
              ? fallbackTitle
              : chat.title,
          messages: flowMessages,
          articleId: chat.articleId ?? activeArticleId,
          articleIds: uniqueIds([...(chat.articleIds ?? []), chat.articleId ?? activeArticleId]),
          activeArticleId: chat.activeArticleId ?? chat.articleId ?? activeArticleId,
          updatedAt: now,
        }
      : chat,
  )
}

function attachArticleToSessions(
  chatSessions: ChatSession[],
  chatId: string,
  articleId: string,
  updatedAt: number,
) {
  return chatSessions.map((chat) =>
    chat.id === chatId
      ? {
          ...chat,
          articleId,
          articleIds: uniqueIds([...(chat.articleIds ?? []), chat.articleId, articleId]),
          activeArticleId: articleId,
          updatedAt,
        }
      : chat,
  )
}

function upsertCurrentArticle(
  state: Pick<
    AppState,
    'articles' | 'activeArticleId' | 'articleTitle' | 'editorText' | 'editorHtml'
  >,
) {
  const now = Date.now()
  const existingArticle = state.articles.find((article) => article.id === state.activeArticleId)
  const articleExists = Boolean(existingArticle)
  const nextArticle: ArticleRecord = {
    id: state.activeArticleId,
    chatId: existingArticle?.chatId,
    title: state.articleTitle,
    text: state.editorText,
    html: state.editorHtml,
    createdAt: now,
    updatedAt: now,
  }

  if (!articleExists) {
    return [nextArticle, ...state.articles].slice(0, 80)
  }

  return state.articles.map((article) =>
    article.id === state.activeArticleId
      ? {
          ...article,
          title: state.articleTitle,
          text: state.editorText,
          html: state.editorHtml,
          updatedAt: now,
        }
      : article,
  )
}

function uniqueIds(ids: Array<string | undefined>) {
  return Array.from(new Set(ids.filter(Boolean) as string[]))
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 20)
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getChatArticles(
  articles: ArticleRecord[],
  chatSessions: ChatSession[],
  chatId: string,
  activeArticleId?: string,
) {
  const chat = chatSessions.find((session) => session.id === chatId)
  const ids = uniqueIds([...(chat?.articleIds ?? []), chat?.articleId, activeArticleId])

  return articles.filter((article) => article.chatId === chatId || ids.includes(article.id))
}

function textToArticleHtml(title: string, text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)

  return `<h1>${escapeHtml(title)}</h1>${paragraphs.join('') || '<p></p>'}`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function calculateTokenSnapshot(
  editorText: string,
  flowMessages: FlowMessage[],
  compressedSummary: string,
  resources: ImportedResource[] = [],
  chatArticles: ArticleRecord[] = [],
): TokenSnapshot {
  const editorTokens = estimateTokens(editorText)
  const conversationTokens = estimateTokens(
    flowMessages.map((message) => `${message.role}: ${message.content}`).join('\n'),
  )
  const summaryTokens = estimateTokens(compressedSummary)
  const resourceTokens = resources
    .filter((resource) => resource.content)
    .reduce((sum, resource) => sum + resource.tokenCount, 0)
  const chatArticleTokens = chatArticles
    .filter((article) => article.text && article.text !== editorText)
    .reduce((sum, article) => sum + estimateTokens(`${article.title}\n${article.text.slice(0, 1800)}`), 0)
  const contextUsedTokens =
    editorTokens + conversationTokens + summaryTokens + resourceTokens + chatArticleTokens + 512

  return {
    editorTokens,
    conversationTokens,
    summaryTokens,
    resourceTokens,
    chatArticleTokens,
    contextUsedTokens,
  }
}
