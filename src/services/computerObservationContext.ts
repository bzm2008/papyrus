export type EphemeralComputerObservationContext = {
  observationId: string
  windowFingerprint: string
  expiresAt: number
  targets: Array<{ id: string; role?: string; name?: string; fingerprint: string }>
}

const sensitiveTarget = /password|passcode|otp|one-time code|verification|captcha|payment|checkout|card|cvv|bank|登录|密码|验证码|支付|结账|银行卡|证件/i
const MAX_TARGETS = 24
const MAX_LABEL_LENGTH = 96

function boundedText(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_LABEL_LENGTH) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function createEphemeralComputerObservationContext(value: unknown): EphemeralComputerObservationContext | undefined {
  if (!isRecord(value) || !isRecord(value.window)) return undefined
  const observationId = boundedText(value.id)
  const windowFingerprint = boundedText(value.window.fingerprint)
  const expiresAt = typeof value.expiresAt === 'number' ? value.expiresAt : Number.NaN
  if (!observationId || !windowFingerprint || !Number.isFinite(expiresAt)) return undefined

  const targets = Array.isArray(value.targets) ? value.targets : []
  return {
    observationId,
    windowFingerprint,
    expiresAt,
    targets: targets.flatMap((value) => {
      if (!isRecord(value)) return []
      const id = boundedText(value.id)
      const fingerprint = boundedText(value.fingerprint)
      const role = boundedText(value.role)
      const name = boundedText(value.name)
      if (!id || !fingerprint || sensitiveTarget.test(`${role} ${name}`)) return []
      return [{ id, fingerprint, ...(role ? { role } : {}), ...(name ? { name } : {}) }]
    }).slice(0, MAX_TARGETS),
  }
}

const contexts = new WeakMap<object, EphemeralComputerObservationContext>()

export function attachEphemeralComputerObservationContext(result: object, context: EphemeralComputerObservationContext | undefined) {
  if (context) contexts.set(result, context)
  return result
}

export function getEphemeralComputerObservationContext(result: object) {
  return contexts.get(result)
}
