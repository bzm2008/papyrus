export type WpsDocumentSnapshot = {
  selectionText: string
  documentExcerpt: string
  cursorAvailable: boolean
  wordCount: number
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
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  pendingPatch?: PendingPatch
}

export type PendingPatch = {
  id: string
  title: string
  content: string
  recommendedOperation: WpsPatchOperation
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
}

export type AgentRunResult = {
  reply: string
  intent: UnifiedAgentIntent
  patch?: Omit<PendingPatch, 'id'>
}
