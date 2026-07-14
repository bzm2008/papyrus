import { describe, expect, it } from 'vitest'
import { formatScallionPlanName, getScallionModelAccess } from './scallionModelCatalog'

describe('Scallion model access presentation', () => {
  it('distinguishes a model blocked by the active plan', () => {
    expect(
      getScallionModelAccess({
        available: true,
        planAvailable: false,
        requiredPlan: 'deeper',
      }),
    ).toEqual({
      status: 'plan_unavailable',
      usable: false,
      label: '套餐不可用',
      detail: '需要 Deeper 套餐',
    })
  })

  it('keeps a server outage separate from a plan restriction', () => {
    expect(
      getScallionModelAccess({
        available: false,
        planAvailable: true,
        availabilityReason: '模型维护中',
      }),
    ).toEqual({
      status: 'temporarily_unavailable',
      usable: false,
      label: '暂不可用',
      detail: '模型维护中',
    })
  })

  it('marks a listed model as callable', () => {
    expect(getScallionModelAccess({ available: true, planAvailable: true }).usable).toBe(true)
  })

  it('treats the legacy none entitlement as the Free plan', () => {
    expect(formatScallionPlanName('none')).toBe('Free')
  })
})
