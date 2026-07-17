import type { ScallionModelMetadata } from '../stores/useAppStore'

export type ScallionModelAccessStatus = 'available' | 'plan_unavailable' | 'temporarily_unavailable'

export type ScallionModelAccess = {
  status: ScallionModelAccessStatus
  usable: boolean
  label: string
  detail: string
}

export type ScallionExternalApiValue = boolean | string | undefined

export type ScallionExternalApiAccess = {
  allowed: boolean
  reason: string
  source: 'quota' | 'plan' | 'missing' | 'denied'
}

/**
 * Resolve the gateway's external API entitlement without relying on string
 * truthiness. The quota response is newer than the model catalogue, so it is
 * authoritative whenever it contains an explicit value.
 */
export function getScallionExternalApiAccess(input: {
  token?: string
  planKey?: string
  planExternalApi?: ScallionExternalApiValue
  quotaExternalApi?: ScallionExternalApiValue
}): ScallionExternalApiAccess {
  if (!input.token?.trim()) {
    return {
      allowed: false,
      reason: '请先登录 Scallion；外部 API 仅对主站明确授权的套餐开放。',
      source: 'missing',
    }
  }

  // The gateway currently exposes external_api only for Deeper. Keep the
  // entitlement check strict even when an older response omits the field.
  const plan = normalizePlanKey(input.planKey)
  if (plan !== 'deeper' && input.planExternalApi === undefined && input.quotaExternalApi === undefined) {
    return {
      allowed: false,
      reason: '当前套餐未开放外部 API；请升级到 Deeper 套餐。',
      source: 'missing',
    }
  }

  const source = input.quotaExternalApi !== undefined ? 'quota' : input.planExternalApi !== undefined ? 'plan' : 'missing'
  const entitlement = input.quotaExternalApi !== undefined ? input.quotaExternalApi : input.planExternalApi

  if (entitlement === undefined) {
    return {
      allowed: false,
      reason: '主站尚未返回外部 API 权限，请刷新套餐信息后重试。',
      source,
    }
  }

  if (typeof entitlement === 'boolean') {
    if (!entitlement) {
      return {
        allowed: false,
        reason: '当前套餐未开放外部 API；请升级到主站允许的套餐。',
        source: 'denied',
      }
    }

    return isDeeperPlan(input.planKey)
      ? { allowed: true, reason: '主站已授权外部 API。', source }
      : {
          allowed: false,
          reason: '外部 API 仅 Deeper 套餐可用。',
          source: 'denied',
        }
  }

  const normalized = entitlement.trim().toLowerCase()
  if (!normalized || ['false', 'no', 'none', 'disabled', 'off', '0', 'deny', 'denied'].includes(normalized)) {
    return {
      allowed: false,
      reason: '当前套餐未开放外部 API；请升级到主站允许的套餐。',
      source: 'denied',
    }
  }

  if (['true', 'yes', 'enabled', 'on', '1', 'allow', 'allowed', 'all'].includes(normalized)) {
    return isDeeperPlan(input.planKey)
      ? { allowed: true, reason: '主站已授权外部 API。', source }
      : { allowed: false, reason: '外部 API 仅 Deeper 套餐可用。', source: 'denied' }
  }

  // The current gateway contract has one external-API tier: Deeper. Treat
  // other labels as informational/legacy data, never as a broader grant.
  if (normalized !== 'deeper') {
    return {
      allowed: false,
      reason: '主站返回了无法识别的外部 API 权限，请刷新套餐信息后重试。',
      source: 'denied',
    }
  }

  if (isDeeperPlan(plan)) {
    return { allowed: true, reason: '主站已授权外部 API。', source }
  }

  return {
    allowed: false,
    reason: '外部 API 仅 Deeper 套餐可用。',
    source: 'denied',
  }
}

export function isScallionExternalApiAllowed(input: Parameters<typeof getScallionExternalApiAccess>[0]) {
  return getScallionExternalApiAccess(input).allowed
}

function normalizePlanKey(value: unknown) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return normalized && normalized !== 'none' ? normalized : undefined
}

function isDeeperPlan(value: unknown) {
  return normalizePlanKey(value) === 'deeper'
}

export function getScallionModelAccess(model: Pick<
  ScallionModelMetadata,
  | 'available'
  | 'planAvailable'
  | 'manualAvailable'
  | 'autoAvailable'
  | 'autoOnly'
  | 'requiredPlan'
  | 'autoRequiredPlan'
  | 'availabilityReason'
>): ScallionModelAccess {
  if (model.manualAvailable === false || model.planAvailable === false) {
    const hasExplicitRoutingAccess = model.manualAvailable !== undefined || model.autoAvailable !== undefined
    return {
      status: 'plan_unavailable',
      usable: false,
      label: hasExplicitRoutingAccess && model.autoAvailable ? '仅 Auto 可用' : '套餐不可用',
      detail:
        model.availabilityReason ||
        (hasExplicitRoutingAccess && model.autoAvailable
          ? '当前套餐只能通过 Auto 路由使用'
          : model.requiredPlan
            ? `需要 ${formatScallionPlanName(model.requiredPlan)} 套餐`
            : '当前套餐不可用'),
    }
  }

  if (model.available === false) {
    return {
      status: 'temporarily_unavailable',
      usable: false,
      label: '暂不可用',
      detail: model.availabilityReason || '主站暂时不可用，请稍后刷新',
    }
  }

  return {
    status: 'available',
    usable: true,
    label: '可用',
    detail: '当前套餐可调用',
  }
}

export function getScallionModelAccessForMode(
  model: Pick<ScallionModelMetadata, 'available' | 'planAvailable' | 'manualAvailable' | 'autoAvailable' | 'autoOnly' | 'requiredPlan' | 'autoRequiredPlan' | 'availabilityReason'>,
  mode: 'manual' | 'auto',
): ScallionModelAccess {
  if (model.available === false) {
    return {
      status: 'temporarily_unavailable',
      usable: false,
      label: '暂不可用',
      detail: model.availabilityReason || '主站暂时不可用，请稍后刷新',
    }
  }

  const usable = mode === 'auto'
    ? model.autoAvailable ?? model.planAvailable !== false
    : model.manualAvailable ?? model.planAvailable !== false
  if (usable) {
    return {
      status: 'available',
      usable: true,
      label: mode === 'auto' ? 'Auto 可用' : '手动可用',
      detail: mode === 'auto' ? '当前套餐可由 Auto 路由' : '当前套餐可手动调用',
    }
  }

  const requiredPlan = mode === 'auto' ? model.autoRequiredPlan || model.requiredPlan : model.requiredPlan
  if (
    mode === 'manual' &&
    ((model.autoOnly === true && model.manualAvailable === undefined) ||
      (model.autoAvailable === true && model.manualAvailable === false))
  ) {
    return {
      status: 'plan_unavailable',
      usable: false,
      label: '仅 Auto 可用',
      detail: model.availabilityReason || '当前套餐只能通过 Auto 路由使用',
    }
  }
  return {
    status: 'plan_unavailable',
    usable: false,
    label: mode === 'auto' ? 'Auto 不可用' : '手动不可用',
    detail: model.availabilityReason || (requiredPlan ? `需要 ${formatScallionPlanName(requiredPlan)} 套餐` : '当前套餐不可用'),
  }
}

export function getScallionRoutingAccess(
  model: Pick<ScallionModelMetadata, 'available' | 'manualAvailable' | 'autoAvailable' | 'planAvailable'>,
  mode: 'manual' | 'auto',
) {
  if (model.available === false) return false
  if (mode === 'auto') return model.autoAvailable ?? model.planAvailable !== false
  return model.manualAvailable ?? model.planAvailable !== false
}

export function formatScallionPlanName(value: string) {
  const names: Record<string, string> = {
    free: 'Free',
    briefly: 'Briefly',
    futher: 'Futher',
    deeper: 'Deeper',
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === 'none') return 'Free'
  return names[normalized] ?? value.trim()
}
