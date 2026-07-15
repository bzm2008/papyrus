import { describe, expect, it } from 'vitest'

import { getAgentSamplingProfile, type AgentSamplingPhase } from './agentSamplingService'

describe('agent sampling strategy', () => {
  it('keeps a non-writing final reply below the creative writer temperature', () => {
    const creative = getAgentSamplingProfile('writer', 'medium', { creative: true })
    const practicalReply = getAgentSamplingProfile('writer', 'medium', { creative: false })

    expect(practicalReply.temperature).toBeLessThan(creative.temperature)
    expect(practicalReply.maxTokens).toBeLessThan(creative.maxTokens)
  })

  it('uses a stable low-temperature profile for tool-decision JSON', () => {
    const profile = getAgentSamplingProfile('tool_json' as AgentSamplingPhase, 'high')

    expect(profile.temperature).toBe(0.3)
    expect(profile.maxTokens).toBe(5000)
  })
})
