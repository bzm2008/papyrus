import type { FlowThinkingEffort } from '../stores/useAppStore'

export type AgentSamplingPhase =
  | 'classification'
  | 'planning'
  | 'research'
  | 'agent_output'
  | 'writer'
  | 'judge'
  | 'compression'
  | 'repair'
  | 'connectivity'

export type AgentSamplingProfile = {
  temperature: number
  frequencyPenalty: number
  presencePenalty: number
  maxTokens: number
  rationale: string
}

export function getAgentSamplingProfile(
  phase: AgentSamplingPhase,
  effort: FlowThinkingEffort = 'medium',
  options: { repeatRisk?: number; creative?: boolean } = {},
): AgentSamplingProfile {
  const repeatRisk = clamp(options.repeatRisk ?? 0, 0, 1)
  const creativePhase = options.creative || phase === 'writer' || phase === 'repair'
  const stablePhase =
    phase === 'classification' ||
    phase === 'planning' ||
    phase === 'research' ||
    phase === 'judge' ||
    phase === 'compression' ||
    phase === 'connectivity'

  let temperature = creativePhase ? 0.72 : stablePhase ? 0.28 : 0.45
  let presencePenalty = creativePhase ? 0.22 : phase === 'research' ? 0.06 : 0.12
  let frequencyPenalty = repeatRisk > 0.35 ? 0.35 + repeatRisk * 0.35 : stablePhase ? 0.12 : 0.18
  let maxTokens = creativePhase ? 8192 : phase === 'compression' ? 1800 : 4096

  if (effort === 'low') {
    temperature -= 0.08
    maxTokens = Math.min(maxTokens, creativePhase ? 4096 : 2400)
  } else if (effort === 'high') {
    temperature += creativePhase ? 0.06 : 0.02
    maxTokens = Math.max(maxTokens, creativePhase ? 8192 : 5000)
  } else if (effort === 'ultra_hive') {
    temperature += creativePhase ? 0.1 : 0.03
    presencePenalty += creativePhase ? 0.12 : 0.04
    maxTokens = Math.max(maxTokens, creativePhase ? 12000 : 6000)
  }

  if (repeatRisk >= 0.6) {
    frequencyPenalty += 0.18
    temperature = Math.max(0.18, temperature - 0.06)
  }

  return {
    temperature: clamp(round2(temperature), 0, 1),
    frequencyPenalty: clamp(round2(frequencyPenalty), 0, 1.2),
    presencePenalty: clamp(round2(presencePenalty), 0, 1),
    maxTokens,
    rationale: creativePhase
      ? '创作/成稿阶段提高想象力，同时用惩罚项降低重复。'
      : '调度/检索/审查阶段保持稳重，避免发散和循环。',
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}
