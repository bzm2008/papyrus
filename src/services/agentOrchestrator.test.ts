import { afterEach, describe, expect, it } from 'vitest'

import {
  canUseSecretarySubAgents,
  isLightweightSecretaryTask,
  planAgentRun,
  sendFlowMessage,
  shouldContinueSecretaryGoalCycle,
} from './agentOrchestrator'
import { activeSecretaryRunId, cancelSecretaryRun, finishSecretaryRun } from './secretaryRunController'
import { useAppStore } from '../stores/useAppStore'

afterEach(() => {
  cancelSecretaryRun()
  const runId = activeSecretaryRunId()
  if (runId) {
    finishSecretaryRun(runId)
  }
  useAppStore.getState().clearFlowRun()
})

describe('secretary goal cycle cancellation', () => {
  it('keeps a greeting out of the planner and tool todo path', async () => {
    const plan = await planAgentRun('你好', 'high')

    expect(plan.taskType).toBe('conversation')
    expect(plan.toolCalls).toEqual([])
    expect(plan.subAgents).toEqual([])
    expect(plan.writeIntent).toBe(false)
  })

  it('keeps lightweight edits on the direct response path', async () => {
    expect(isLightweightSecretaryTask('帮我润色这句话')).toBe(true)
    const plan = await planAgentRun('帮我润色这句话', 'high')

    expect(plan.taskType).toBe('conversation')
    expect(plan.toolCalls).toEqual([])
    expect(plan.subAgents).toEqual([])
    expect(plan.writeIntent).toBe(false)
  })

  it('answers a greeting without creating todos, tools, traces, or patches', async () => {
    useAppStore.getState().clearFlowMessages()
    useAppStore.getState().clearFlowRun()

    const outcome = await sendFlowMessage('你好')
    const state = useAppStore.getState()

    expect(outcome?.status).toBe('completed')
    expect(outcome?.result?.response).toBeTruthy()
    expect(state.agentTodos).toEqual([])
    expect(state.agentSteps).toEqual([])
    expect(state.flowTraces).toEqual([])
    expect(state.pendingDocumentPatch).toBeUndefined()
    expect(state.flowMessages).toHaveLength(2)
    expect(state.flowMessages[1]?.role).toBe('assistant')
    expect(state.flowMessages[1]?.content).toBe(outcome?.result?.response)
  })

  it('answers a lightweight edit without creating execution scaffolding', async () => {
    useAppStore.getState().clearFlowMessages()
    useAppStore.getState().clearFlowRun()

    const outcome = await sendFlowMessage('帮我润色这句话')
    const state = useAppStore.getState()

    expect(outcome?.status).toBe('completed')
    expect(outcome?.conversationOnly).toBe(true)
    expect(state.agentTodos).toEqual([])
    expect(state.agentSteps).toEqual([])
    expect(state.flowTraces).toEqual([])
    expect(state.flowMessages).toHaveLength(2)
  })

  it('keeps low effort in single-agent mode', () => {
    expect(canUseSecretarySubAgents('low')).toBe(false)
    expect(canUseSecretarySubAgents('medium')).toBe(true)
    expect(canUseSecretarySubAgents('high')).toBe(true)
  })

  it('does not advance the goal cycle after a cancelled run', () => {
    expect(shouldContinueSecretaryGoalCycle({ status: 'cancelled' })).toBe(false)
  })

  it('only advances after a completed run', () => {
    expect(shouldContinueSecretaryGoalCycle({ status: 'completed' })).toBe(true)
    expect(shouldContinueSecretaryGoalCycle({ status: 'completed', conversationOnly: true })).toBe(false)
    expect(shouldContinueSecretaryGoalCycle({ status: 'failed' })).toBe(false)
    expect(shouldContinueSecretaryGoalCycle(undefined)).toBe(false)
  })

  it('returns a cancelled outcome when sendFlowMessage is cancelled before work starts', async () => {
    const pending = sendFlowMessage('写一段短文')

    cancelSecretaryRun()

    await expect(pending).resolves.toMatchObject({ status: 'cancelled' })
  })
})
