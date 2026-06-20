import type { AgentRunPlan } from './agentOrchestrator'
import {
  useAppStore,
  type FlowAgentId,
  type HiveBlackboardEntryKind,
  type HiveSwarmPhase,
} from '../stores/useAppStore'

type HiveRuntimeSession = {
  traceId: string
  runId?: string
  startedAt: number
  deadlineAt: number
  globalTimeoutMs: number
  agentTimeoutMs: number
  maxRetries: number
  retryBaseDelayMs: number
}

type GuardedAgentCallOptions = {
  agentId: FlowAgentId
  phase?: HiveSwarmPhase
  run: () => Promise<string>
  fallback: (reason: string) => string
}

const openCircuitAgents = new Map<FlowAgentId, { openedAt: number; failureCount: number; reason: string }>()

export function startHiveRuntime(plan: AgentRunPlan): HiveRuntimeSession | undefined {
  if (!plan.hiveTopology?.enabled) {
    return undefined
  }

  const state = useAppStore.getState()
  const hardware = state.hardwareCapabilityProfile
  const now = Date.now()
  const plannedAgents = Math.max(1, plan.hiveTopology.plannedAgents)
  const parallel = Math.max(1, hardware.maxHiveParallelAgents)
  const globalTimeoutMs = clamp(90_000 + plannedAgents * 35_000 + parallel * 10_000, 150_000, 420_000)
  const agentTimeoutMs = clamp(45_000 + Math.round(120_000 / parallel), 60_000, 180_000)
  const session: HiveRuntimeSession = {
    traceId: `hive-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    runId: state.activeAgentRunId,
    startedAt: now,
    deadlineAt: now + globalTimeoutMs,
    globalTimeoutMs,
    agentTimeoutMs,
    maxRetries: 2,
    retryBaseDelayMs: 650,
  }

  state.setHiveTelemetry({
    enabled: true,
    runId: session.runId,
    topologyId: plan.hiveTopology.id,
    traceId: session.traceId,
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    plannedAgents: plan.hiveTopology.plannedAgents,
    retryCount: 0,
    timedOut: false,
    circuitBreaker: { open: false, failureCount: 0 },
    blackboard: [],
  })
  addHiveBlackboard(session, {
    kind: 'routing',
    title: 'Hive 运行时已启动',
    phase: 'router',
    detail: `traceId=${session.traceId}; 全局超时 ${Math.round(globalTimeoutMs / 1000)}s; 单 Agent 超时 ${Math.round(agentTimeoutMs / 1000)}s; 最大重试 ${session.maxRetries} 次。`,
  })

  return session
}

export async function runHiveAgentWithGuards(session: HiveRuntimeSession | undefined, options: GuardedAgentCallOptions) {
  if (!session) {
    return options.run()
  }

  const circuit = openCircuitAgents.get(options.agentId)
  if (circuit && Date.now() - circuit.openedAt < 180_000) {
    const reason = `断路器开启：${circuit.reason}`
    addHiveBlackboard(session, {
      kind: 'circuit_breaker',
      title: '跳过 Agent',
      agentId: options.agentId,
      phase: options.phase,
      detail: reason,
    })
    return options.fallback(reason)
  }

  let lastError: unknown

  for (let attempt = 1; attempt <= session.maxRetries + 1; attempt += 1) {
    if (Date.now() > session.deadlineAt) {
      const reason = 'Hive 全局超时，停止后续重试。'
      useAppStore.getState().setHiveTelemetry({ timedOut: true })
      addHiveBlackboard(session, {
        kind: 'timeout',
        title: '全局超时',
        agentId: options.agentId,
        phase: options.phase,
        attempt,
        detail: reason,
      })
      return options.fallback(reason)
    }

    const attemptStartedAt = Date.now()
    addHiveBlackboard(session, {
      kind: 'agent_started',
      title: `启动 ${options.agentId}`,
      agentId: options.agentId,
      phase: options.phase,
      attempt,
      detail: attempt === 1 ? '首次调用。' : `退火重试：第 ${attempt} 次调用。`,
    })

    try {
      const result = await withTimeout(options.run(), Math.min(session.agentTimeoutMs, session.deadlineAt - Date.now()))
      openCircuitAgents.delete(options.agentId)
      addHiveBlackboard(session, {
        kind: 'agent_completed',
        title: `完成 ${options.agentId}`,
        agentId: options.agentId,
        phase: options.phase,
        attempt,
        elapsedMs: Date.now() - attemptStartedAt,
        detail: `输出 ${result.length} 字符。`,
      })
      return result
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : '未知错误'

      if (attempt <= session.maxRetries && Date.now() < session.deadlineAt) {
        const delayMs = annealedRetryDelay(session.retryBaseDelayMs, attempt)
        addHiveBlackboard(session, {
          kind: 'agent_retry',
          title: `重试 ${options.agentId}`,
          agentId: options.agentId,
          phase: options.phase,
          attempt,
          elapsedMs: Date.now() - attemptStartedAt,
          detail: `${message}; ${delayMs}ms 后以更稳的参数重试。`,
        })
        await sleep(delayMs)
        continue
      }

      const previous = openCircuitAgents.get(options.agentId)
      const failureCount = (previous?.failureCount ?? 0) + 1
      const shouldOpen = failureCount >= 2 || /timeout|超时/i.test(message)

      if (shouldOpen) {
        openCircuitAgents.set(options.agentId, {
          openedAt: Date.now(),
          failureCount,
          reason: message,
        })
        useAppStore.getState().setHiveTelemetry({
          circuitBreaker: { open: true, failureCount, openedAt: Date.now(), reason: message },
        })
        addHiveBlackboard(session, {
          kind: 'circuit_breaker',
          title: '断路器开启',
          agentId: options.agentId,
          phase: options.phase,
          attempt,
          detail: `连续失败 ${failureCount} 次：${message}`,
        })
      } else {
        addHiveBlackboard(session, {
          kind: 'agent_failed',
          title: `失败 ${options.agentId}`,
          agentId: options.agentId,
          phase: options.phase,
          attempt,
          detail: message,
        })
      }
    }
  }

  return options.fallback(lastError instanceof Error ? lastError.message : 'Agent 调用失败')
}

export function addHiveRuntimeSummary(session: HiveRuntimeSession | undefined, detail: string) {
  if (!session) {
    return
  }

  addHiveBlackboard(session, {
    kind: 'summary',
    title: 'Hive 汇总',
    phase: 'aggregate',
    detail,
  })
}

function addHiveBlackboard(
  session: HiveRuntimeSession,
  input: {
    kind: HiveBlackboardEntryKind
    title: string
    detail: string
    agentId?: FlowAgentId
    phase?: HiveSwarmPhase
    attempt?: number
    elapsedMs?: number
  },
) {
  useAppStore.getState().addHiveBlackboardEntry({
    traceId: session.traceId,
    runId: session.runId,
    ...input,
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  if (timeoutMs <= 0) {
    return Promise.reject(new Error('timeout'))
  }

  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs)

    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timer))
  })
}

function annealedRetryDelay(baseMs: number, attempt: number) {
  return Math.round(baseMs * Math.pow(1.8, attempt - 1) + Math.random() * 180)
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
