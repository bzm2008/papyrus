import type { FlowAgentId, HiveSwarmPhase } from '../stores/useAppStore'
import { useAppStore } from '../stores/useAppStore'
import type { AgentRunPlan } from './agentOrchestrator'
import type { SecretaryTaskClassification } from './secretaryTaskClassifier'
import { getStudioAgent } from './studioAgentLibrary'

export type HiveSwarmNodeRole = 'router' | 'worker' | 'reviewer' | 'judge' | 'aggregator'

export type HiveSwarmNode = {
  id: string
  role: HiveSwarmNodeRole
  phase: HiveSwarmPhase
  agentId: FlowAgentId
  label: string
}

export type HiveSwarmTopology = {
  id: string
  enabled: boolean
  rationale: string
  flow: string
  nodes: HiveSwarmNode[]
  plannedAgents: number
}

export function shouldUseHiveSwarm(
  effort: string | undefined,
  classification: Pick<SecretaryTaskClassification, 'complexity' | 'hiveRecommended'>,
) {
  return effort === 'ultra_hive' && classification.hiveRecommended !== false && classification.complexity !== 'simple'
}

export function buildHiveSwarmTopology(
  plan: AgentRunPlan,
  classification: SecretaryTaskClassification,
): HiveSwarmTopology {
  const hardwareLimit = useAppStore.getState().hardwareCapabilityProfile.maxHiveAgents
  const targetWorkers = Math.max(3, classification.expectedAgentCount ?? 5)
  const workerAgents = plan.subAgents.slice(0, Math.min(hardwareLimit, targetWorkers))
  const reviewerAgents = selectReviewerAgents(workerAgents)
  const nodes: HiveSwarmNode[] = [
    node('router', 'router', 'writer', '秘书长 Router'),
    ...workerAgents.map((agentId, index) =>
      node(`worker-${index + 1}`, workerPhaseForAgent(agentId), agentId, agentLabel(agentId)),
    ),
    ...reviewerAgents.map((agentId, index) =>
      node(`reviewer-${index + 1}`, 'review', agentId, `${agentLabel(agentId)} Reviewer`),
    ),
    node('judge', 'judge', 'writer', '裁判检查'),
    node('aggregator', 'aggregate', 'writer', '秘书长 Aggregator'),
  ]

  return {
    id: `hive-${Date.now()}`,
    enabled: true,
    rationale:
      'ultra+hive 启用：采用秘书长 Router -> Worker 小队 -> Reviewer/Judge -> 秘书长 Aggregator 的蜂巢拓扑。参考 Swarms 的 Sequential/Concurrent/Graph/Mixture-of-Agents 和 Ruflo 的共享记忆、统一协调器、模型路由思想，但在 Papyrus 本地会话内执行。',
    flow:
      'Router -> Sequential/Concurrent Workers -> Graph Review -> Judge -> Mixture-of-Agents Aggregator',
    nodes,
    plannedAgents: new Set(nodes.map((item) => item.agentId)).size,
  }
}

export function formatHiveTopology(topology?: HiveSwarmTopology) {
  if (!topology?.enabled) {
    return ''
  }

  return [
    `Hive 拓扑：${topology.flow}`,
    `计划 Agent：${topology.plannedAgents}`,
    `小队：${topology.nodes.map((item) => `${item.label}/${phaseLabel(item.phase)}`).join(' · ')}`,
  ].join('\n')
}

function selectReviewerAgents(workerAgents: FlowAgentId[]) {
  const explicitReviewers = workerAgents
    .filter((agentId) => /checker|proof|critic|compliance|arguer|editor|review/.test(agentId))
    .slice(0, 2)

  if (explicitReviewers.length >= 2) {
    return explicitReviewers
  }

  const fallbackReviewers = ['citation-checker', 'proofreader', 'humanities-arguer'].filter(
    (agentId) => workerAgents.includes(agentId) && !explicitReviewers.includes(agentId),
  )

  return [...explicitReviewers, ...fallbackReviewers].slice(0, 2)
}

function node(id: string, phase: HiveSwarmPhase, agentId: FlowAgentId, label: string): HiveSwarmNode {
  const role: HiveSwarmNodeRole = id.startsWith('reviewer')
    ? 'reviewer'
    : id === 'router' || id === 'judge' || id === 'aggregator'
      ? id
      : 'worker'

  return {
    id,
    role,
    phase,
    agentId,
    label,
  }
}

function workerPhaseForAgent(agentId: FlowAgentId): HiveSwarmPhase {
  if (/citation|research|historian|trend|academic|archivist/.test(agentId)) {
    return 'research'
  }

  if (/checker|proof|critic|compliance|arguer|editor|review/.test(agentId)) {
    return 'review'
  }

  return 'draft'
}

function phaseLabel(phase: HiveSwarmPhase) {
  const labels: Record<HiveSwarmPhase, string> = {
    router: '路由',
    research: '研究',
    draft: '成稿',
    review: '审查',
    judge: '裁判',
    aggregate: '整合',
  }

  return labels[phase]
}

function agentLabel(agentId: FlowAgentId) {
  return getStudioAgent(agentId)?.shortName ?? agentId
}
