import type { AssistantApprovalChoice, AssistantRiskLevel } from './workAssistantProtocol'

export type AssistantApprovalScope = {
  toolName: string
  rootId: string
  targetParent: string
  conflictPolicy: string
  operationKind: string
  maxOperations: number
}

export const RUN_SCOPED_DENYLIST = new Set([
  'trash',
  'overwrite',
  'desktop_open_app',
  'browser_download',
  'external_navigation',
  'send',
  'publish',
  'submit',
  'delete',
])

const riskRank: Record<AssistantRiskLevel, number> = {
  read: 0,
  reversible: 1,
  high: 2,
  blocked: 3,
}

function normalizeRisk(risk: unknown): AssistantRiskLevel {
  return typeof risk === 'string' && risk in riskRank ? risk as AssistantRiskLevel : 'blocked'
}

export function effectiveRisk(defaultRisk: unknown, previewRisk?: unknown): AssistantRiskLevel {
  const normalizedDefault = normalizeRisk(defaultRisk)
  const normalizedPreview = previewRisk === undefined ? normalizedDefault : normalizeRisk(previewRisk)

  return riskRank[normalizedPreview] > riskRank[normalizedDefault] ? normalizedPreview : normalizedDefault
}

export function approvalChoices(risk: unknown): AssistantApprovalChoice[] {
  switch (normalizeRisk(risk)) {
    case 'read':
      return []
    case 'reversible':
      return ['once', 'run', 'deny']
    case 'high':
      return ['once', 'deny']
    case 'blocked':
      return ['deny']
  }
}

function isRunScopedDanger(scope: AssistantApprovalScope): boolean {
  return RUN_SCOPED_DENYLIST.has(scope.toolName)
    || RUN_SCOPED_DENYLIST.has(scope.conflictPolicy)
    || RUN_SCOPED_DENYLIST.has(scope.operationKind)
}

export function scopeAllows(grant: AssistantApprovalScope, request: AssistantApprovalScope): boolean {
  return !isRunScopedDanger(grant)
    && !isRunScopedDanger(request)
    && grant.toolName === request.toolName
    && grant.rootId === request.rootId
    && grant.targetParent === request.targetParent
    && grant.conflictPolicy === request.conflictPolicy
    && grant.operationKind === request.operationKind
    && Number.isSafeInteger(grant.maxOperations)
    && Number.isSafeInteger(request.maxOperations)
    && grant.maxOperations >= 0
    && request.maxOperations >= 0
    && request.maxOperations <= grant.maxOperations
}
