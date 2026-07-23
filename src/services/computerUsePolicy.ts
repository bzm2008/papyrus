import type { AssistantRiskLevel } from './workAssistantProtocol'

export type ComputerRect = { x: number; y: number; width: number; height: number }

export type ComputerTarget = {
  id: string
  role?: string
  name?: string
  fingerprint: string
  bounds?: ComputerRect
}

export type ComputerObservation = {
  id: string
  window: { appId?: string; title?: string; fingerprint: string }
  targets: ComputerTarget[]
  expiresAt: number
}

export type ComputerActionReference = {
  observationId: string
  windowFingerprint: string
  targetId: string
  targetFingerprint: string
}

export type ComputerReferenceValidation =
  | { ok: true }
  | { ok: false; code: 'observation_expired' | 'window_changed' | 'target_missing' | 'target_changed' }

export type ComputerActionAssessment = {
  risk: AssistantRiskLevel
  requiresOneTimeApproval: boolean
  allowsTaskGrant: boolean
}

const sensitiveSurface = /password|passcode|otp|verification|captcha|payment|card|cvv|bank|登录|密码|验证码|支付|银行卡|证件/i
const highImpactAction = /submit|send|publish|delete|remove|download|install|login|sign.?in|发送|提交|发布|删除|下载|安装|登录/i

export function isComputerObservationFresh(observation: Pick<ComputerObservation, 'expiresAt'>, now = Date.now()) {
  return Number.isFinite(observation.expiresAt) && observation.expiresAt > now
}

export function validateComputerActionReference(
  observation: ComputerObservation,
  reference: ComputerActionReference,
  now = Date.now(),
): ComputerReferenceValidation {
  if (!isComputerObservationFresh(observation, now)) return { ok: false, code: 'observation_expired' }
  if (observation.window.fingerprint !== reference.windowFingerprint) return { ok: false, code: 'window_changed' }
  const target = observation.targets.find((candidate) => candidate.id === reference.targetId)
  if (!target) return { ok: false, code: 'target_missing' }
  if (target.fingerprint !== reference.targetFingerprint) return { ok: false, code: 'target_changed' }
  return { ok: true }
}

export function assessComputerAction(input: { action: string; role?: string; name?: string }): ComputerActionAssessment {
  const summary = `${input.action} ${input.role ?? ''} ${input.name ?? ''}`
  if (sensitiveSurface.test(summary)) {
    return { risk: 'blocked', requiresOneTimeApproval: false, allowsTaskGrant: false }
  }
  if (highImpactAction.test(summary)) {
    return { risk: 'high', requiresOneTimeApproval: true, allowsTaskGrant: false }
  }
  return { risk: 'reversible', requiresOneTimeApproval: false, allowsTaskGrant: true }
}
