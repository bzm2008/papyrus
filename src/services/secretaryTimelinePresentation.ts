import type { AssistantToolCall, WorkAssistantRun } from './workAssistantProtocol'

export type SecretaryToolTimelinePresentation = {
  visible: AssistantToolCall[]
  folded: AssistantToolCall[]
}

/**
 * Keep live approvals and failures in the conversation. Completed background
 * steps move into one compact disclosure only after the run itself is final.
 */
export function partitionSecretaryToolTimeline(
  run: WorkAssistantRun | undefined,
): SecretaryToolTimelinePresentation {
  const tools = run ? Object.values(run.toolCalls) : []
  if (!run || !isTerminalRun(run.status)) return { visible: tools, folded: [] }

  return {
    visible: tools.filter((tool) => tool.status === 'failed' || tool.status === 'awaiting_approval' || tool.status === 'running' || tool.status === 'queued'),
    folded: tools.filter((tool) => tool.status === 'completed' || tool.status === 'cancelled'),
  }
}

function isTerminalRun(status: WorkAssistantRun['status']) {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}
