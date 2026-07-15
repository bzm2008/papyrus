import type { WorkAssistantRun } from './workAssistantProtocol'

export function shouldShowSecretaryPartialReply(
  run: Pick<WorkAssistantRun, 'id' | 'status' | 'messageText'> | undefined,
  activeAgentRunId: string | undefined,
) {
  return run?.status === 'cancelled'
    && run.id === activeAgentRunId
    && run.messageText.trim().length > 0
}
