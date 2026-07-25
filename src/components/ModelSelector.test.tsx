import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useAppStore } from '../stores/useAppStore'
import { ModelSelector } from './ModelSelector'

type SelectorState = Pick<ReturnType<typeof useAppStore.getState>,
  'activeProviderId' | 'modelRoutingMode' | 'providerConfigs' | 'scallionModels' | 'scallionToken' | 'scallionQuota' | 'scallionPlan'
>

describe('ModelSelector', () => {
  let previous: SelectorState

  beforeEach(() => {
    const state = useAppStore.getState()
    previous = {
      activeProviderId: state.activeProviderId,
      modelRoutingMode: state.modelRoutingMode,
      providerConfigs: state.providerConfigs,
      scallionModels: state.scallionModels,
      scallionToken: state.scallionToken,
      scallionQuota: state.scallionQuota,
      scallionPlan: state.scallionPlan,
    }

    useAppStore.setState({
      activeProviderId: 'qwen36',
      modelRoutingMode: 'auto',
      scallionToken: 'test-token',
      scallionPlan: {
        key: 'free',
        name: 'Free',
        availableModels: ['agnes-2.0-flash', 'step-3.7-flash'],
        manualModels: [],
        autoModels: ['agnes-2.0-flash', 'step-3.7-flash'],
        updatedAt: Date.now(),
      },
      scallionModels: [
        {
          id: 'agnes-2.0-flash',
          label: 'Agnes 2.0 Flash',
          modelName: 'agnes-2.0-flash',
          available: true,
          manualAvailable: false,
          autoAvailable: true,
          autoOnly: true,
          updatedAt: Date.now(),
        },
        {
          id: 'step-3.7-flash',
          label: 'Step 3.7 Flash',
          modelName: 'step-3.7-flash',
          available: true,
          manualAvailable: false,
          autoAvailable: true,
          autoOnly: true,
          updatedAt: Date.now(),
        },
        {
          id: 'nvidia/nemotron-3-ultra-550b-a55b',
          label: 'Nemotron 3 Ultra 550B',
          modelName: 'nvidia/nemotron-3-ultra-550b-a55b',
          available: true,
          manualAvailable: false,
          autoAvailable: false,
          requiredPlan: 'deeper',
          updatedAt: Date.now(),
        },
      ],
    })
  })

  afterEach(() => useAppStore.setState(previous))

  it('keeps the gateway in control of the Auto model while showing the full pool', () => {
    render(<ModelSelector compact />)
    fireEvent.click(screen.getByTitle('更换模型'))

    const autoPoolModel = screen.getByRole('button', { name: /Step 3\.7 Flash/ })
    expect(autoPoolModel).toBeDisabled()
    expect(autoPoolModel).toHaveTextContent('Auto 可用')
    expect(autoPoolModel).toHaveTextContent('由主站自动选择')
    expect(screen.getByRole('button', { name: /Nemotron 3 Ultra 550B/ })).toHaveTextContent('需要 Deeper 套餐')

    fireEvent.click(autoPoolModel)
    expect(useAppStore.getState().providerConfigs.qwen36.modelName).toBe('agnes-2.0-flash')
    expect(useAppStore.getState().modelRoutingMode).toBe('auto')
  })
})
