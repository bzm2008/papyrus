export type WpsDocumentSnapshot = {
  selectionText: string
  documentExcerpt: string
  cursorAvailable: boolean
  wordCount: number
  mode?: 'wps' | 'mock'
}

export type WpsPatchOperation =
  | 'replace_selection'
  | 'insert_at_cursor'
  | 'append_document'
  | 'copy_only'

export type UnifiedAgentIntent =
  | 'answer_only'
  | 'rewrite_selection'
  | 'write_document'
  | 'review_document'

export type AgentSkill = {
  id: string
  name: string
  shortName: string
  description: string
  systemHint: string
  keywords?: string[]
}

export type WpsAgentTodoStatus = 'pending' | 'running' | 'completed' | 'blocked'

export type WpsAgentTodo = {
  id: string
  title: string
  detail: string
  status: WpsAgentTodoStatus
}

export type WpsPlanDraft = {
  id: string
  request: string
  executionPrompt: string
  planText: string
  feedback: string[]
  createdAt: number
  updatedAt: number
}

export type WpsRetryRequest = {
  executionPrompt: string
  displayPrompt: string
  approvedPlan?: WpsPlanDraft
  snapshot?: WpsDocumentSnapshot
  assistantId: string
  selectedSkill?: AgentSkill
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  pendingPatch?: PendingPatch
  runStatus?: 'generating' | 'completed' | 'failed' | 'cancelled'
  canRetry?: boolean
  retryRequest?: WpsRetryRequest
}

export type PendingPatch = {
  id: string
  title: string
  content: string
  recommendedOperation: WpsPatchOperation
  sourceSelectionFingerprint: string
  sourceContextSummary: string
}

export type ScallionUser = {
  id: number | string
  username: string
  avatar_url?: string
  points?: number
  is_member?: boolean
}

export type ScallionSession = {
  token: string
  user: ScallionUser
}

export type AgentRunInput = {
  prompt: string
  snapshot: WpsDocumentSnapshot
  selectedSkill?: AgentSkill
  token?: string
  approvedPlan?: WpsPlanDraft
  onStatus?: (status: string) => void
  signal?: AbortSignal
  onStage?: (stage: string) => void
  onDraft?: (draft: string) => void
  onRuntime?: (runtime: { model: string; transport: 'stream' | 'non_stream'; usedFallback: boolean }) => void
}

export type AgentRunResult = {
  reply: string
  intent: UnifiedAgentIntent
  patch?: Omit<PendingPatch, 'id'>
  trace?: string[]
  todos?: WpsAgentTodo[]
  checks?: string[]
  model?: string
  transport?: 'stream' | 'non_stream'
  usedFallback?: boolean
  recoverableError?: string
}
