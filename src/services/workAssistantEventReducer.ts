import type {
  AssistantSubagent,
  AssistantToolCall,
  WorkAssistantEvent,
  WorkAssistantRun,
} from './workAssistantProtocol'

const isTerminalSubagent = (subagent: AssistantSubagent) =>
  subagent.status === 'completed' || subagent.status === 'failed' || subagent.status === 'cancelled'

const isTerminalToolCall = (toolCall: AssistantToolCall) =>
  toolCall.status === 'completed' || toolCall.status === 'failed' || toolCall.status === 'cancelled'

const isTerminalRun = (state: WorkAssistantRun) =>
  state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled'

const clearsPendingApproval = (state: WorkAssistantRun, toolCall: AssistantToolCall) =>
  state.pendingApprovalId !== undefined && toolCall.preview?.id === state.pendingApprovalId

export function reduceWorkAssistantEvent(
  state: WorkAssistantRun,
  event: WorkAssistantEvent,
): WorkAssistantRun {
  if (event.runId !== state.id || isTerminalRun(state)) {
    return state
  }

  switch (event.type) {
    case 'run.started':
      return { ...state, status: 'running', lastActivityAt: event.at }

    case 'message.delta':
      return { ...state, messageText: state.messageText + event.delta, lastActivityAt: event.at }

    case 'stage.changed':
      return { ...state, stage: event.stage, lastActivityAt: event.at }

    case 'tool.started': {
      if (state.toolCalls[event.toolCall.id]) {
        return state
      }

      const toolCall = { ...event.toolCall, status: 'running' as const }
      return {
        ...state,
        status: 'running',
        toolCalls: { ...state.toolCalls, [toolCall.id]: toolCall },
        lastActivityAt: event.at,
      }
    }

    case 'approval.required': {
      const toolCall = state.toolCalls[event.request.toolCallId]
      if (!toolCall || isTerminalToolCall(toolCall)) {
        return state
      }

      return {
        ...state,
        status: 'awaiting_approval',
        pendingApprovalId: event.request.id,
        toolCalls: {
          ...state.toolCalls,
          [toolCall.id]: { ...toolCall, status: 'awaiting_approval', preview: event.request },
        },
        lastActivityAt: event.at,
      }
    }

    case 'tool.progress': {
      const toolCall = state.toolCalls[event.toolCallId]
      if (!toolCall || isTerminalToolCall(toolCall)) {
        return state
      }

      const shouldClearApproval = clearsPendingApproval(state, toolCall)
      return {
        ...state,
        ...(shouldClearApproval ? { status: 'running' as const, pendingApprovalId: undefined } : {}),
        toolCalls: {
          ...state.toolCalls,
          [toolCall.id]: {
            ...toolCall,
            status: 'running',
            progress: { message: event.message, completed: event.completed, total: event.total },
          },
        },
        lastActivityAt: event.at,
      }
    }

    case 'tool.completed': {
      const toolCall = state.toolCalls[event.toolCallId]
      if (!toolCall || isTerminalToolCall(toolCall)) {
        return state
      }

      const shouldClearApproval = clearsPendingApproval(state, toolCall)
      return {
        ...state,
        ...(shouldClearApproval ? { status: 'running' as const, pendingApprovalId: undefined } : {}),
        toolCalls: {
          ...state.toolCalls,
          [toolCall.id]: {
            ...toolCall,
            status: event.result.ok ? 'completed' : 'failed',
            result: event.result,
            endedAt: event.at,
          },
        },
        lastActivityAt: event.at,
      }
    }

    case 'subagent.started':
      if (state.subagents[event.subagent.id]) {
        return state
      }

      return {
        ...state,
        subagents: {
          ...state.subagents,
          [event.subagent.id]: { ...event.subagent, status: 'running' },
        },
        lastActivityAt: event.at,
      }

    case 'subagent.progress': {
      const subagent = state.subagents[event.subagentId]
      if (!subagent || isTerminalSubagent(subagent)) {
        return state
      }

      return {
        ...state,
        subagents: {
          ...state.subagents,
          [subagent.id]: {
            ...subagent,
            status: 'running',
            ...(event.currentTool === undefined ? {} : { currentTool: event.currentTool }),
            progress: [...subagent.progress, event.message].slice(-24),
          },
        },
        lastActivityAt: event.at,
      }
    }

    case 'subagent.completed': {
      const subagent = state.subagents[event.subagentId]
      if (!subagent || isTerminalSubagent(subagent)) {
        return state
      }

      return {
        ...state,
        subagents: {
          ...state.subagents,
          [subagent.id]: {
            ...subagent,
            status: event.failed ? 'failed' : 'completed',
            summary: event.summary,
            currentTool: undefined,
            endedAt: event.at,
          },
        },
        lastActivityAt: event.at,
      }
    }

    case 'run.completed':
      return { ...state, status: 'completed', messageText: event.response, lastActivityAt: event.at }

    case 'run.failed':
      return { ...state, status: 'failed', error: event.message, lastActivityAt: event.at }

    case 'run.cancelled': {
      const toolCalls = Object.fromEntries(
        Object.entries(state.toolCalls).map(([id, toolCall]) => [
          id,
          toolCall.status === 'completed' || toolCall.status === 'failed'
            ? toolCall
            : { ...toolCall, status: 'cancelled' as const, endedAt: event.at },
        ]),
      )
      const subagents = Object.fromEntries(
        Object.entries(state.subagents).map(([id, subagent]) => [
          id,
          isTerminalSubagent(subagent)
            ? subagent
            : { ...subagent, status: 'cancelled' as const, endedAt: event.at },
        ]),
      )

      return { ...state, status: 'cancelled', pendingApprovalId: undefined, toolCalls, subagents, lastActivityAt: event.at }
    }
  }
}

export const reduceWorkAssistantEvents = (state: WorkAssistantRun, events: WorkAssistantEvent[]) =>
  events.reduce(reduceWorkAssistantEvent, state)
