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
  dispatch: (event: WorkAssistantEvent) => void
  selectToolCall: (id?: string) => void
  setCapabilityStatus: (status: AssistantCapabilityStatus[]) => void
  resetRun: (runId: string) => void
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
  capabilityStatus: [],
  dispatch: (event) => set((state) => {
    const current = state.runs[event.runId] ?? createEmptyWorkAssistantRun(event.runId)
    const next = reduceWorkAssistantEvent(current, event)
    return {
      runs: retainNewestRuns({ ...state.runs, [event.runId]: next }),
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
      activeRunId: state.activeRunId === runId ? undefined : state.activeRunId,
      selectedToolCallId: undefined,
    }
  }),
}))

