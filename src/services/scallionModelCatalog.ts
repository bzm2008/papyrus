import type { ScallionModelMetadata } from '../stores/useAppStore'

export type ScallionModelAccessStatus = 'available' | 'plan_unavailable' | 'temporarily_unavailable'

export type ScallionModelAccess = {
  status: ScallionModelAccessStatus
  usable: boolean
  label: string
  detail: string
}

export function getScallionModelAccess(model: Pick<
  ScallionModelMetadata,
  'available' | 'planAvailable' | 'requiredPlan' | 'availabilityReason'
>): ScallionModelAccess {
  if (model.planAvailable === false) {
    return {
      status: 'plan_unavailable',
      usable: false,
      label: '套餐不可用',
      detail:
        model.availabilityReason ||
        (model.requiredPlan ? `需要 ${formatScallionPlanName(model.requiredPlan)} 套餐` : '当前套餐不可用'),
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
