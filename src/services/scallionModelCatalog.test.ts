import { describe, expect, it } from 'vitest'
import {
  formatScallionPlanName,
  getScallionExternalApiAccess,
  getScallionModelAccess,
} from './scallionModelCatalog'

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

  it('labels an Auto-only model clearly when manual selection is unavailable', () => {
    expect(
      getScallionModelAccess({
        available: true,
        planAvailable: true,
        manualAvailable: false,
        autoAvailable: true,
        autoOnly: true,
      }),
    ).toEqual(
      expect.objectContaining({
        label: '仅 Auto 可用',
        usable: false,
      }),
    )
  })

  it('treats the legacy none entitlement as the Free plan', () => {
    expect(formatScallionPlanName('none')).toBe('Free')
  })

  it('does not treat the string false as an external API grant', () => {
    expect(
      getScallionExternalApiAccess({
        token: 'jwt',
        planKey: 'free',
        quotaExternalApi: 'false',
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        source: 'denied',
      }),
    )
  })

  it('requires the current Deeper entitlement label and denies unknown labels', () => {
    expect(
      getScallionExternalApiAccess({
        token: 'jwt',
        planKey: 'deeper',
        planExternalApi: 'deeper',
      }).allowed,
    ).toBe(true)
    expect(
      getScallionExternalApiAccess({
        token: 'jwt',
        planKey: 'deeper',
        planExternalApi: 'future_plan',
      }).allowed,
    ).toBe(false)
  })

  it('requires an authenticated, explicit entitlement before opening external API', () => {
    expect(getScallionExternalApiAccess({ planKey: 'deeper', planExternalApi: true }).allowed).toBe(false)
    expect(getScallionExternalApiAccess({ token: 'jwt', planKey: 'deeper' }).allowed).toBe(false)
  })

  it('does not trust a true flag for a non-Deeper plan', () => {
    expect(
      getScallionExternalApiAccess({
        token: 'jwt',
        planKey: 'briefly',
        quotaExternalApi: true,
      }).allowed,
    ).toBe(false)
  })
})
