import { describe, expect, it } from 'vitest'
import {
  defaultProviderConfigs,
  isProviderValidated,
  mergeProviderConfigs,
  providerValidationSignature,
} from './modelCatalog'

describe('Scallion provider validation', () => {
  it('does not treat the built-in provider as ready without a JWT-backed validation', () => {
    expect(isProviderValidated(defaultProviderConfigs.qwen36)).toBe(false)
  })

  it('accepts a validation signature created after the server model list succeeds', () => {
    const provider = {
      ...defaultProviderConfigs.qwen36,
      validatedAt: Date.now(),
    }
    const validatedProvider = {
      ...provider,
      lastValidatedSignature: providerValidationSignature(provider),
    }

    expect(isProviderValidated(validatedProvider)).toBe(true)
  })

  it('drops stale persisted built-in Scallion base URLs while preserving custom endpoints', () => {
    const merged = mergeProviderConfigs({
      qwen36: {
        ...defaultProviderConfigs.qwen36,
        baseUrl: 'https://scallion.uno/api/papyrus/llm/models',
      },
      custom: {
        ...defaultProviderConfigs.custom,
        baseUrl: 'https://custom.example/v1',
        modelName: 'my-model',
      },
    })

    expect(merged.qwen36.baseUrl).toBe('https://api.sca-hub.cn/api/papyrus/llm')
    expect(merged.custom.baseUrl).toBe('https://custom.example/v1')
    expect(merged.custom.modelName).toBe('my-model')
  })
})
