import type {
  AppMode,
  ColumnMode,
  FlowThinkingEffort,
  LlmRunState,
  SecretaryGoal,
} from '../stores/useAppStore'
import type { WorkAssistantRun } from '../services/workAssistantProtocol'

export function shouldShowLegacyLeftSidebar(mode: AppMode, columnMode: ColumnMode) {
  return mode !== 'flow' && columnMode === 3
}

export function shouldAutoOpenSecretaryWorkbench({
  activeGoalStatus,
  workAssistantStatus,
  thinkingEffort,
  agentStepCount,
  traceCount,
  todoCount,
}: {
  activeGoalStatus?: SecretaryGoal['status']
  workAssistantStatus?: WorkAssistantRun['status']
  thinkingEffort: FlowThinkingEffort
  agentStepCount: number
  traceCount: number
  todoCount: number
}) {
  return activeGoalStatus === 'active'
    || workAssistantStatus === 'awaiting_approval'
    || thinkingEffort === 'ultra_hive'
    || agentStepCount >= 2
    || traceCount >= 2
    || todoCount >= 4
}

export function isSecretaryWorkbenchActive(
  llmRunState: LlmRunState,
  workAssistantStatus?: WorkAssistantRun['status'],
) {
  return llmRunState === 'running'
    || llmRunState === 'reconnecting'
    || workAssistantStatus === 'awaiting_approval'
}

