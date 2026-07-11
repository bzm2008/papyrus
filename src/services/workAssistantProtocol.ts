export type DesktopPlatform = 'windows' | 'macos' | 'linux'
export type AssistantRiskLevel = 'read' | 'reversible' | 'high' | 'blocked'
export type AssistantToolStatus = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'
export type AssistantApprovalChoice = 'once' | 'run' | 'deny'

export type AssistantCapabilityStatus = { name: string; toolset: 'workspace' | 'desktop' | 'browser' | 'project'; available: boolean; reason?: string; platform: DesktopPlatform }
export type NativePreviewRequest = { runId: string; toolCallId: string; toolName: string; arguments: Record<string, unknown> }
export type AssistantToolCall = { id: string; runId: string; name: string; intent: string; arguments: Record<string, unknown>; status: AssistantToolStatus; startedAt: number; endedAt?: number; preview?: AssistantToolPreview; progress?: { message: string; completed?: number; total?: number }; result?: AssistantToolResult }
export type AssistantToolPreview = { id: string; revision: string; risk: AssistantRiskLevel; title: string; targetSummary: string; impactSummary: string; reversible: boolean; expiresAt: number }
export type AssistantApprovalRequest = AssistantToolPreview & { runId: string; toolCallId: string; reason: string; allowedChoices: AssistantApprovalChoice[] }
export type AssistantToolResult = { ok: boolean; summary: string; data?: Record<string, unknown>; errorCode?: string; recoverable?: boolean }
export type AssistantSubagent = { id: string; parentId?: string; goal: string; model?: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; currentTool?: string; progress: string[]; startedAt: number; endedAt?: number; summary?: string }
export type WorkAssistantRun = { id: string; status: 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'; messageText: string; stage: string; toolCalls: Record<string, AssistantToolCall>; subagents: Record<string, AssistantSubagent>; pendingApprovalId?: string; lastActivityAt: number; error?: string }
export type WorkAssistantEvent =
  | { type: 'run.started'; runId: string; at: number }
  | { type: 'message.delta'; runId: string; messageId: string; delta: string; at: number }
  | { type: 'stage.changed'; runId: string; stage: string; detail?: string; at: number }
  | { type: 'tool.started'; runId: string; toolCall: AssistantToolCall; at: number }
  | { type: 'tool.progress'; runId: string; toolCallId: string; message: string; completed?: number; total?: number; at: number }
  | { type: 'approval.required'; runId: string; request: AssistantApprovalRequest; at: number }
  | { type: 'tool.completed'; runId: string; toolCallId: string; result: AssistantToolResult; at: number }
  | { type: 'subagent.started'; runId: string; subagent: AssistantSubagent; at: number }
  | { type: 'subagent.progress'; runId: string; subagentId: string; message: string; currentTool?: string; at: number }
  | { type: 'subagent.completed'; runId: string; subagentId: string; summary: string; failed?: boolean; at: number }
  | { type: 'run.completed'; runId: string; response: string; at: number }
  | { type: 'run.failed'; runId: string; code: string; message: string; recoverable: boolean; at: number }
  | { type: 'run.cancelled'; runId: string; at: number }

export function createEmptyWorkAssistantRun(id: string): WorkAssistantRun {
  return { id, status: 'idle', messageText: '', stage: '', toolCalls: {}, subagents: {}, lastActivityAt: Date.now() }
}
