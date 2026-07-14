import { describe, expect, it } from 'vitest'
import {
  defaultProviderConfigs,
  isProviderValidated,
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
})
