import { describe, expect, it } from 'vitest'

import { isSecretaryWorkbenchActive, shouldAutoOpenSecretaryWorkbench } from './secretaryWorkspaceLayout'

describe('shouldAutoOpenSecretaryWorkbench', () => {
  it('opens the safety workbench as soon as a computer action awaits approval', () => {
    expect(shouldAutoOpenSecretaryWorkbench({
      activeGoalStatus: undefined,
      workAssistantStatus: 'awaiting_approval',
      thinkingEffort: 'low',
      agentStepCount: 0,
      traceCount: 0,
      todoCount: 0,
    })).toBe(true)
  })

  it('stays closed for an otherwise idle lightweight request', () => {
    expect(shouldAutoOpenSecretaryWorkbench({
      activeGoalStatus: undefined,
      workAssistantStatus: undefined,
      thinkingEffort: 'low',
      agentStepCount: 0,
      traceCount: 0,
      todoCount: 0,
    })).toBe(false)
  })
})

describe('isSecretaryWorkbenchActive', () => {
  it('keeps the workbench active while a safety approval awaits even after stream generation is idle', () => {
    expect(isSecretaryWorkbenchActive('idle', 'awaiting_approval')).toBe(true)
  })
})
