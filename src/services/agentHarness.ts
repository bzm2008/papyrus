import { observeAgentRun } from './memoryEngine'
import {
  useAppStore,
  type AgentRunRecord,
  type AgentRunSource,
  type AgentRunStatus,
  type AppMode,
  type RemoteRelayMode,
  type RemoteRelayPlatform,
} from '../stores/useAppStore'

export type AgentHarnessRunInput = {
  prompt: string
  mode: AppMode | RemoteRelayMode
  source?: AgentRunSource
  remoteJobId?: string
  remotePlatform?: RemoteRelayPlatform
  remoteSenderId?: string
}

export type AgentHarnessFinishInput = {
  status: AgentRunStatus
  response?: string
  patchContent?: string
  summary?: string
  error?: string
}

export function startAgentRun(input: AgentHarnessRunInput) {
  return useAppStore.getState().startAgentRunRecord({
    mode: input.mode,
    source: input.source ?? 'local',
    prompt: input.prompt,
    remoteJobId: input.remoteJobId,
    remotePlatform: input.remotePlatform,
    remoteSenderId: input.remoteSenderId,
  })
}

export function finishAgentRun(run: AgentRunRecord | undefined, input: AgentHarnessFinishInput) {
  if (!run) {
    return []
  }

  const memoryRecords = observeAgentRun({
    run: {
      ...run,
      status: input.status,
      summary: input.summary,
      error: input.error,
      endedAt: Date.now(),
    },
    response: input.response,
    patchContent: input.patchContent,
    remotePlatform: run.remotePlatform,
    remoteSenderId: run.remoteSenderId,
  })

  useAppStore.getState().finishAgentRunRecord(run.id, {
    status: input.status,
    summary: input.summary ?? summarizeHarnessResult(input),
    error: input.error,
    memoryIds: memoryRecords.map((memory) => memory.id),
  })

  return memoryRecords
}

export function failAgentRun(run: AgentRunRecord | undefined, error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown agent run error'

  finishAgentRun(run, {
    status: 'failed',
    response: message,
    summary: message,
    error: message,
  })
}

function summarizeHarnessResult(input: AgentHarnessFinishInput) {
  const text = input.summary || input.response || input.patchContent || input.error || ''

  return text.replace(/\s+/g, ' ').trim().slice(0, 360)
}
