import { create } from 'zustand'

import { reduceWorkAssistantEvent } from '../services/workAssistantEventReducer'
import {
  createEmptyWorkAssistantRun,
  type AssistantCapabilityStatus,
  type WorkAssistantEvent,
  type WorkAssistantRun,
} from '../services/workAssistantProtocol'

type WorkAssistantStore = {
  runs: Record<string, WorkAssistantRun>
  activeRunId?: string
  selectedToolCallId?: string
  capabilityStatus: AssistantCapabilityStatus[]
  retiredRunIds: Record<string, true>
  dispatch: (event: WorkAssistantEvent) => void
  selectToolCall: (id?: string) => void
  setCapabilityStatus: (status: AssistantCapabilityStatus[]) => void
  resetRun: (runId: string) => void
  resetAllRuns: () => void
}

const MAX_RETAINED_RUNS = 20

function retainNewestRuns(runs: Record<string, WorkAssistantRun>) {
  return Object.fromEntries(
    Object.entries(runs)
      .sort(([, left], [, right]) => right.lastActivityAt - left.lastActivityAt)
      .slice(0, MAX_RETAINED_RUNS),
  )
}

export const useWorkAssistantStore = create<WorkAssistantStore>((set) => ({
  runs: {},
  retiredRunIds: {},
  capabilityStatus: [],
  dispatch: (event) => set((state) => {
    if (state.retiredRunIds[event.runId]) return state

    const current = state.runs[event.runId]
    if (!current && event.type !== 'run.started') return state

    const base = current ?? createEmptyWorkAssistantRun(event.runId)
    const next = reduceWorkAssistantEvent(base, event)
    if (next === base) return state

    const combined = { ...state.runs, [event.runId]: next }
    const runs = retainNewestRuns(combined)
    const retiredRunIds = { ...state.retiredRunIds }
    for (const runId of Object.keys(combined)) {
      if (!runs[runId]) retiredRunIds[runId] = true
    }

    return {
      runs,
      retiredRunIds,
      activeRunId: event.runId,
    }
  }),
  selectToolCall: (id) => set({ selectedToolCallId: id }),
  setCapabilityStatus: (capabilityStatus) => set({ capabilityStatus }),
  resetRun: (runId) => set((state) => {
    const runs = { ...state.runs }
    delete runs[runId]
    return {
      runs,
      retiredRunIds: { ...state.retiredRunIds, [runId]: true },
      activeRunId: state.activeRunId === runId ? undefined : state.activeRunId,
      selectedToolCallId: undefined,
    }
  }),
  resetAllRuns: () => set((state) => ({
    runs: {},
    retiredRunIds: {
      ...state.retiredRunIds,
      ...Object.fromEntries(Object.keys(state.runs).map((runId) => [runId, true as const])),
      ...(state.activeRunId ? { [state.activeRunId]: true } : {}),
    },
    activeRunId: undefined,
    selectedToolCallId: undefined,
  })),
}))
