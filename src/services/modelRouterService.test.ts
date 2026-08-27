import { afterEach, describe, expect, it } from 'vitest'

import { defaultProviderConfigs } from './modelCatalog'
import { selectModelForRole } from './modelRouterService'
import { useAppStore } from '../stores/useAppStore'

afterEach(() => {
  useAppStore.setState({
    modelRoutingMode: 'manual',
    scallionToken: undefined,
    scallionModels: [],
    providerConfigs: defaultProviderConfigs,
  })
})

describe('model routing preferences', () => {
  it('leaves Auto model selection to the gateway instead of pinning a local model', () => {
    useAppStore.setState({
      modelRoutingMode: 'auto',
      scallionToken: 'jwt-token',
      providerConfigs: {
        ...defaultProviderConfigs,
        qwen36: { ...defaultProviderConfigs.qwen36, modelName: 'preferred-auto' },
      },
      scallionModels: [
        { id: 'first-auto', modelName: 'first-auto', label: 'First', available: true, autoAvailable: true, updatedAt: Date.now() },
        { id: 'preferred-auto', modelName: 'preferred-auto', label: 'Preferred', available: true, autoAvailable: true, updatedAt: Date.now() },
        { id: 'agnes-2.0-flash', modelName: 'agnes-2.0-flash', label: 'Agnes', available: true, autoAvailable: true, updatedAt: Date.now() },
      ],
    })

    const decision = selectModelForRole('agent', { complexity: 'simple' })
    expect(decision.provider.modelName).toBe('preferred-auto')
    expect(decision.reason).toContain('主站')
  })

  it('does not replace the persisted model when Auto is selected', () => {
    useAppStore.setState({
      modelRoutingMode: 'auto',
      scallionToken: 'jwt-token',
      providerConfigs: {
        ...defaultProviderConfigs,
        qwen36: { ...defaultProviderConfigs.qwen36, modelName: 'qwen/qwen3.5-122b-a10b' },
      },
      scallionModels: [
        { id: 'qwen/qwen3.5-122b-a10b', modelName: 'qwen/qwen3.5-122b-a10b', label: 'Retired', available: true, autoAvailable: true, updatedAt: Date.now() },
        { id: 'allowed-auto', modelName: 'allowed-auto', label: 'Allowed', available: true, autoAvailable: true, updatedAt: Date.now() },
      ],
    })

    expect(selectModelForRole('agent', { complexity: 'simple' }).provider.modelName).toBe('qwen/qwen3.5-122b-a10b')
  })

  it('keeps Auto available when the local catalogue is stale', () => {
    useAppStore.setState({
      modelRoutingMode: 'auto',
      scallionToken: 'jwt-token',
      providerConfigs: {
        ...defaultProviderConfigs,
        qwen36: { ...defaultProviderConfigs.qwen36, modelName: 'restricted-auto' },
      },
      scallionModels: [
        { id: 'restricted-auto', modelName: 'restricted-auto', label: 'Restricted', available: true, planAvailable: false, updatedAt: Date.now() },
        { id: 'allowed-auto', modelName: 'allowed-auto', label: 'Allowed', available: true, autoAvailable: true, updatedAt: Date.now() },
      ],
    })

    const decision = selectModelForRole('agent', { complexity: 'simple' })
    expect(decision.provider.modelName).toBe('restricted-auto')
    expect(decision.reason).toContain('主站')
  })
})
