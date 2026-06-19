import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  defaultProviderConfigs,
  getEffectiveContextLimit,
  getModelContextSource,
  isProviderValidated,
  mergeProviderConfigs,
  providerOrder,
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
export type FlowAgentId =
  | 'writer'
  | 'researcher'
  | 'critic'
  | 'dramatist'
  | 'stylist'
  | 'proofreader'
  | 'archivist'
export type FlowReviewMode = 'auto' | 'review'
export type ChatRole = 'user' | 'assistant' | 'system'
export type LlmRunState = 'idle' | 'running' | 'error'
export type CompressionState = 'idle' | 'running' | 'error'
export type AgentTodoStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'skipped'
export type FlowTraceStatus = 'pending' | 'running' | 'completed' | 'error'
export type FlowTraceKind = 'plan' | 'agent' | 'tool' | 'document' | 'memory'
export type AgentStepType = 'plan' | 'tool' | 'sub_agent' | 'generation'
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'error'
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

export type ScallionAuthStatus =
  | 'idle'
  | 'starting'
  | 'polling'
  | 'approved'
  | 'expired'
  | 'denied'
  | 'error'

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
  title: string
  detail: string
  status: AgentTodoStatus
  agentId: FlowAgentId
  createdAt: number
  updatedAt: number
}

export type FlowTrace = {
  id: string
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

type TokenSnapshot = {
  editorTokens: number
  conversationTokens: number
  summaryTokens: number
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
  activeAgentId: FlowAgentId
  flowReviewMode: FlowReviewMode
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
  resources: ImportedResource[]
  pendingDocumentPatch?: DocumentPatch
  llmRunState: LlmRunState
  llmStatusMessage: string
  updateStatus: UpdateStatus
  updateMessage: string
  updateProgress: number
  updateVersion?: string
  scallionUser?: ScallionUser
  scallionToken?: string
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
  providerConfigs: Record<ProviderId, LlmProviderConfig>
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
  setMode: (mode: AppMode) => void
  setColumnMode: (columnMode: ColumnMode) => void
  toggleLeftCollapsed: () => void
  setSettingsOpen: (open: boolean) => void
  setActiveProviderId: (providerId: ProviderId) => void
  setActiveAgentId: (agentId: FlowAgentId) => void
  setFlowReviewMode: (reviewMode: FlowReviewMode) => void
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
  setPendingDocumentPatch: (patch?: Omit<DocumentPatch, 'id' | 'createdAt' | 'status'>) => void
  markDocumentPatch: (status: DocumentPatchStatus) => void
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
    patch: { contextWindowTokens?: number; modelName?: string },
  ) => void
  updateProviderConfig: (
    providerId: ProviderId,
    patch: Partial<Omit<LlmProviderConfig, 'id' | 'type'>>,
  ) => void
  setScallionDevice: (deviceCode: string, userCode: string) => void
  setScallionAuthStatus: (status: ScallionAuthStatus) => void
  setScallionSession: (token: string, user: ScallionUser) => void
  clearScallionSession: () => void
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
  setFirstLaunchComplete: () => void
  setEnvReady: (ready: boolean) => void
  setMaintenanceTab: (tab: MaintenanceTab) => void
  setMaintenanceCheck: (id: MaintenanceCheckId, patch: Partial<MaintenanceCheck>) => void
  setMemoryUsageBytes: (bytes: number) => void
  resetOobe: () => void
}

const initialEditorText =
  '论记忆、材料与判断\n\n这里是 Papyrus 的主编辑区。\n\n你可以像 Word 或 WPS 一样直接编辑文稿，也可以选中文本呼出伴写菜单，让 AI 做审查、纠错、查重、降噪或按指令改写。\n\n在 Flow 模式中，主笔会根据任务拆解待办、调用子 Agent，并在需要时把正文写回文稿。'

const initialEditorHtml =
  '<h1>论记忆、材料与判断</h1><p>这里是 Papyrus 的主编辑区。</p><p>你可以像 Word 或 WPS 一样直接编辑文稿，也可以选中文本呼出伴写菜单，让 AI 做审查、纠错、查重、降噪或按指令改写。</p><p>在 Flow 模式中，主笔会根据任务拆解待办、调用子 Agent，并在需要时把正文写回文稿。</p>'

const initialFlowMessages: FlowMessage[] = [
  {
    id: 'flow-seed-1',
    role: 'assistant',
    agentId: 'writer',
    content:
      'Flow 编队已就绪。给我一个主题、材料清单或章节目标，我会协调主笔、寻根、刺客和其他专业 Agent 推进。',
    createdAt: Date.now(),
  },
]

const initialChatId = 'chat-seed-1'
const initialArticleId = 'article-seed-1'
const defaultActiveProviderId: ProviderId = 'qwen36'
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
      mode: 'companion',
      columnMode: 3,
      isLeftCollapsed: false,
      isSettingsOpen: false,
      activeProviderId: defaultActiveProviderId,
      activeAgentId: 'writer',
      flowReviewMode: 'auto',
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
      resources: [],
      pendingDocumentPatch: undefined,
      llmRunState: 'idle',
      llmStatusMessage: 'LLM 待命',
      updateStatus: 'idle',
      updateMessage: '自动更新待命',
      updateProgress: 0,
      updateVersion: undefined,
      scallionUser: undefined,
      scallionToken: undefined,
      authDeviceCode: undefined,
      authUserCode: undefined,
      authStatus: 'idle',
      remoteRelayEnabled: false,
      remoteRelayEndpoint: 'https://scallion.uno/api/papyrus/remote',
      remoteRelayChannelId: undefined,
      remoteRelayAccessKey: undefined,
      remoteRelayAllowedPlatforms: ['clawbot', 'feishu', 'wecom', 'qq', 'wechat', 'custom'],
      remoteRelayDefaultMode: 'companion',
      remoteRelayPollIntervalSeconds: 12,
      remoteRelayStatus: 'idle',
      remoteRelayMessage: '远程中继未启用',
      remoteRelayLastJobAt: undefined,
      providerConfigs: defaultProviderConfigs,
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
      ...calculateTokenSnapshot(initialEditorText, initialFlowMessages, ''),
      setMode: (mode) => set({ mode }),
      setColumnMode: (columnMode) => set({ columnMode }),
      toggleLeftCollapsed: () => set((state) => ({ isLeftCollapsed: !state.isLeftCollapsed })),
      setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
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
      setFlowReviewMode: (flowReviewMode) => set({ flowReviewMode }),
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
        set({
          agentTodos: todos.map((todo) => {
            const now = Date.now()

            return {
              ...todo,
              id: globalThis.crypto?.randomUUID?.() ?? `todo-${now}`,
              createdAt: now,
              updatedAt: now,
            }
          }),
        }),
      updateAgentTodo: (id, patch) =>
        set((state) => ({
          agentTodos: state.agentTodos.map((todo) =>
            todo.id === id ? { ...todo, ...patch, updatedAt: Date.now() } : todo,
          ),
        })),
      addFlowTrace: (trace) => {
        const flowTrace: FlowTrace = {
          ...trace,
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
        set({
          agentSteps: steps.map((step) => {
            const now = Date.now()

            return {
              ...step,
              id: globalThis.crypto?.randomUUID?.() ?? `step-${now}`,
              startedAt: now,
            }
          }),
        }),
      addAgentStep: (step) => {
        const now = Date.now()
        const agentStep: AgentStep = {
          ...step,
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
        set({ agentTodos: [], flowTraces: [], agentSteps: [], pendingDocumentPatch: undefined }),
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
      addResources: (resources) =>
        set((state) => {
          const merged = [
            ...resources,
            ...state.resources.filter(
              (existing) => !resources.some((resource) => resource.path === existing.path),
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
            serverContextWindowTokens:
              patch.contextWindowTokens ?? existing.serverContextWindowTokens,
            modelName: patch.modelName?.trim() || existing.modelName,
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
        set({
          scallionToken,
          scallionUser,
          authStatus: 'approved',
          authDeviceCode: undefined,
          authUserCode: undefined,
        }),
      clearScallionSession: () =>
        set({
          scallionToken: undefined,
          scallionUser: undefined,
          authDeviceCode: undefined,
          authUserCode: undefined,
          authStatus: 'idle',
        }),
      setRemoteRelayConfig: (patch) =>
        set((state) => ({
          remoteRelayEnabled: patch.enabled ?? state.remoteRelayEnabled,
          remoteRelayEndpoint: patch.endpoint ?? state.remoteRelayEndpoint,
          remoteRelayChannelId: patch.channelId ?? state.remoteRelayChannelId,
          remoteRelayAccessKey: patch.accessKey ?? state.remoteRelayAccessKey,
          remoteRelayAllowedPlatforms:
            patch.allowedPlatforms ?? state.remoteRelayAllowedPlatforms,
          remoteRelayDefaultMode: patch.defaultMode ?? state.remoteRelayDefaultMode,
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
        activeAgentId: state.activeAgentId,
        flowReviewMode: state.flowReviewMode,
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
        agentTodos: state.agentTodos,
        flowTraces: state.flowTraces,
        agentSteps: state.agentSteps,
        resources: state.resources,
        pendingDocumentPatch: state.pendingDocumentPatch,
        scallionUser: state.scallionUser,
        scallionToken: state.scallionToken,
        authStatus: state.authStatus,
        remoteRelayEnabled: state.remoteRelayEnabled,
        remoteRelayEndpoint: state.remoteRelayEndpoint,
        remoteRelayChannelId: state.remoteRelayChannelId,
        remoteRelayAccessKey: state.remoteRelayAccessKey,
        remoteRelayAllowedPlatforms: state.remoteRelayAllowedPlatforms,
        remoteRelayDefaultMode: state.remoteRelayDefaultMode,
        remoteRelayPollIntervalSeconds: state.remoteRelayPollIntervalSeconds,
        providerConfigs: state.providerConfigs,
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
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<AppState>
        const providerConfigs = mergeProviderConfigs(persistedState.providerConfigs)
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
          activeProviderId,
          activeArticleId,
          activeChatId,
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
          updateStatus: 'idle' as const,
          updateMessage: '自动更新待命',
          updateProgress: 0,
          authStatus: (persistedState.scallionToken ? 'approved' : 'idle') as ScallionAuthStatus,
          remoteRelayEnabled: persistedState.remoteRelayEnabled ?? current.remoteRelayEnabled,
          remoteRelayEndpoint: persistedState.remoteRelayEndpoint ?? current.remoteRelayEndpoint,
          remoteRelayChannelId: persistedState.remoteRelayChannelId ?? current.remoteRelayChannelId,
          remoteRelayAccessKey: persistedState.remoteRelayAccessKey ?? current.remoteRelayAccessKey,
          remoteRelayAllowedPlatforms:
            persistedState.remoteRelayAllowedPlatforms ?? current.remoteRelayAllowedPlatforms,
          remoteRelayDefaultMode:
            persistedState.remoteRelayDefaultMode ?? current.remoteRelayDefaultMode,
          remoteRelayPollIntervalSeconds:
            persistedState.remoteRelayPollIntervalSeconds ?? current.remoteRelayPollIntervalSeconds,
          remoteRelayStatus: 'idle' as const,
          remoteRelayMessage: persistedState.remoteRelayEnabled
            ? '远程中继等待连接'
            : '远程中继未启用',
          remoteRelayLastJobAt: persistedState.remoteRelayLastJobAt,
          providerConfigs,
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
    contextUsedTokens,
  }
}
