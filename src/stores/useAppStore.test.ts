import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from './useAppStore'

afterEach(() => {
  useAppStore.setState({
    scallionToken: undefined,
    scallionModels: [],
    scallionQuota: undefined,
  })
})

describe('Scallion model metadata', () => {
  it('retains the complete server model catalog without a local count cap', () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    const models = Array.from({ length: 30 }, (_, index) => ({
      id: `model-${index}`,
      label: `模型 ${index}`,
      modelName: `model-${index}`,
      available: true,
      planAvailable: true,
      updatedAt: Date.now(),
    }))

    useAppStore.getState().setScallionModelMetadata(models)

    expect(useAppStore.getState().scallionModels).toHaveLength(30)
  })

  it('does not auto-select a model that the active plan cannot use', () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    useAppStore.getState().setScallionModelMetadata([
      {
        id: 'nemotron',
        label: 'Nemotron',
        modelName: 'nemotron',
        planAvailable: false,
        available: false,
        requiredPlan: 'deeper',
        updatedAt: Date.now(),
      },
      {
        id: 'agnes-2.0-flash',
        label: 'Agnes 2.0 Flash',
        modelName: 'agnes-2.0-flash',
        planAvailable: true,
        available: true,
        updatedAt: Date.now(),
      },
    ])

    expect(useAppStore.getState().providerConfigs.qwen36.modelName).toBe('agnes-2.0-flash')
    expect(useAppStore.getState().scallionModels[0]?.planAvailable).toBe(false)
  })

  it('fully clears an expired Scallion session instead of leaving a stale account visible', () => {
    useAppStore.setState({
      scallionToken: 'jwt-token',
      scallionUser: { id: 1, username: 'demo', points: 500 },
      scallionQuota: {
        remaining: 500,
        pointsBalance: 500,
        unit: '积分',
        isMember: false,
        memberPriceLabel: '9.9 元/月',
        upgradeUrl: 'https://scallion.uno/pricing',
        topUpUrl: 'https://scallion.uno/pricing',
        updatedAt: Date.now(),
      },
    })

    useAppStore.getState().expireScallionSession()

    expect(useAppStore.getState()).toEqual(expect.objectContaining({
      scallionToken: undefined,
      scallionUser: undefined,
      scallionQuota: undefined,
      scallionModels: [],
      authStatus: 'expired',
    }))
  })
})
