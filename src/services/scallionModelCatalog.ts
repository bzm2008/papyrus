import type { ModelRoutingMode, ScallionModelMetadata } from '../stores/useAppStore'

export type ScallionModelAccessStatus = 'available' | 'plan_unavailable' | 'temporarily_unavailable'

export type ScallionModelAccess = {
  status: ScallionModelAccessStatus
  usable: boolean
  label: string
  detail: string
}

export function getScallionModelAccess(model: Pick<
  ScallionModelMetadata,
  | 'available'
  | 'planAvailable'
  | 'requiredPlan'
  | 'autoRequiredPlan'
  | 'manualAvailable'
  | 'autoAvailable'
  | 'autoOnly'
  | 'availabilityReason'
>, routingMode: ModelRoutingMode = 'manual'): ScallionModelAccess {
  const hasExplicitRoutingAccess =
    model.manualAvailable !== undefined || model.autoAvailable !== undefined || model.autoOnly === true
  if (model.planAvailable === false && !hasExplicitRoutingAccess) {
    return {
      status: 'plan_unavailable',
      usable: false,
      label: '套餐不可用',
      detail: model.availabilityReason || requiredPlanDetail(model, routingMode),
    }
  }

  const modeAvailable =
    routingMode === 'auto'
      ? model.autoAvailable !== false
      : model.manualAvailable !== false && model.autoOnly !== true

  if (!modeAvailable) {
    return {
      status: 'plan_unavailable',
      usable: false,
      label: model.planAvailable === false && routingMode === 'manual' ? '套餐不可用' : routingMode === 'auto' ? 'Auto 不可用' : '手动不可用',
      detail: requiredPlanDetail(model, routingMode),
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
      detail: routingMode === 'auto' ? '当前套餐可通过 Auto 调用' : '当前套餐可手动调用',
  }
}

function requiredPlanDetail(
  model: Pick<ScallionModelMetadata, 'requiredPlan' | 'autoRequiredPlan' | 'availabilityReason'>,
  routingMode: ModelRoutingMode,
) {
  if (model.availabilityReason) {
    return model.availabilityReason
  }

  const requiredPlan = routingMode === 'auto' ? model.autoRequiredPlan || model.requiredPlan : model.requiredPlan
  return requiredPlan ? `需要 ${formatScallionPlanName(requiredPlan)} 套餐` : '当前套餐不可用'
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
