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
  it('keeps the user-selected Auto model instead of always taking the first pool entry', () => {
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
      ],
    })

    expect(selectModelForRole('agent', { complexity: 'simple' }).provider.modelName).toBe('preferred-auto')
  })

  it('skips cached Auto models that the live plan marks unavailable', () => {
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

    expect(selectModelForRole('agent', { complexity: 'simple' }).provider.modelName).toBe('allowed-auto')
  })
})
