import { useEffect } from 'react'
import { type AgentStep, type AgentStepEvent, useAppStore } from '../stores/useAppStore'

type StepStartEvent = Extract<AgentStepEvent, { title: string }>
type StepStreamEvent = Extract<AgentStepEvent, { delta: string }>
type StepEndEvent = Extract<AgentStepEvent, { status: AgentStep['status'] }>

export function useAgentStream() {
  useEffect(() => {
    let cleanup: Array<() => void> = []
    let cancelled = false

    async function bindTauriEvents() {
      if (!('__TAURI_INTERNALS__' in window)) {
        return
      }

      const { listen } = await import('@tauri-apps/api/event')

      if (cancelled) {
        return
      }

      const unlistenStart = await listen<StepStartEvent>('agent_step_start', (event) => {
        useAppStore.getState().addAgentStep({
          ...event.payload,
          status: 'running',
          isExpanded: true,
        })
      })
      const unlistenStream = await listen<StepStreamEvent>('agent_step_stream', (event) => {
        useAppStore.getState().appendAgentStepContent(event.payload.id, event.payload.delta)
      })
      const unlistenEnd = await listen<StepEndEvent>('agent_step_end', (event) => {
        useAppStore.getState().updateAgentStep(event.payload.id, {
          ...event.payload,
          endedAt: Date.now(),
        })
      })

      cleanup = [unlistenStart, unlistenStream, unlistenEnd]
    }

    void bindTauriEvents()

    return () => {
      cancelled = true
      cleanup.forEach((unlisten) => unlisten())
    }
  }, [])
}
