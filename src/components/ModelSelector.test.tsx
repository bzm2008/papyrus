import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ModelSelector } from './ModelSelector'
import { useAppStore } from '../stores/useAppStore'

afterEach(() => {
  useAppStore.setState({
    scallionToken: undefined,
    scallionPlan: undefined,
    scallionQuota: undefined,
    scallionModels: [],
    modelRoutingMode: 'auto',
  })
})

describe('ModelSelector Scallion entitlement display', () => {
  it('shows the live plan and points balance while disabling plan-restricted models', () => {
    const current = useAppStore.getState()
    useAppStore.setState({
      ...current,
      scallionToken: 'jwt-token',
      scallionPlan: {
        key: 'briefly',
        name: 'Briefly',
        expiresAt: '2026-08-12T00:00:00.000Z',
        availableModels: ['agnes-2.0-flash'],
        updatedAt: Date.now(),
      },
      scallionQuota: {
        remaining: 504,
        pointsBalance: 504,
        planKey: 'briefly',
        planName: 'Briefly',
        planExpiresAt: '2026-08-12T00:00:00.000Z',
        unit: '积分',
        isMember: true,
        memberPriceLabel: '9.9 元/月',
        upgradeUrl: 'https://scallion.uno/pricing',
        topUpUrl: 'https://scallion.uno/pricing',
        updatedAt: Date.now(),
      },
      scallionSync: {
        ...current.scallionSync,
        quota: { ...current.scallionSync.quota, status: 'ready' },
      },
      scallionModels: [
        {
          id: 'agnes-2.0-flash',
          label: 'Agnes 2.0 Flash',
          modelName: 'agnes-2.0-flash',
          available: true,
          planAvailable: true,
          contextWindowTokens: 1_048_576,
          updatedAt: Date.now(),
        },
        {
          id: 'nvidia/nemotron-3-ultra-550b-a55b',
          label: 'Nemotron 3 Ultra',
          modelName: 'nvidia/nemotron-3-ultra-550b-a55b',
          available: false,
          planAvailable: false,
          requiredPlan: 'deeper',
          availabilityReason: '需要 Deeper 套餐',
          contextWindowTokens: 262_144,
          updatedAt: Date.now(),
        },
      ],
    })

    render(<ModelSelector />)
    fireEvent.click(screen.getByTitle('更换模型'))

    expect(screen.getByText('Briefly')).toBeInTheDocument()
    expect(screen.getByText(/余 504 积分/)).toBeInTheDocument()
    expect(screen.getAllByText('Agnes 2.0 Flash').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/套餐不可用/)).toBeInTheDocument()
    expect(screen.getByText(/需要 Deeper 套餐/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nemotron 3 Ultra/ })).toBeDisabled()
  })

  it('labels a stale balance as cached instead of realtime', () => {
    const current = useAppStore.getState()
    useAppStore.setState({
      ...current,
      scallionToken: 'jwt-token',
      scallionQuota: {
        remaining: 503,
        pointsBalance: 503,
        planKey: 'free',
        planName: 'Free',
        unit: '积分',
        isMember: false,
        memberPriceLabel: '9.9 元/月',
        upgradeUrl: 'https://scallion.uno/pricing',
        topUpUrl: 'https://scallion.uno/pricing',
        updatedAt: Date.now(),
      },
      scallionSync: {
        ...current.scallionSync,
        quota: { ...current.scallionSync.quota, status: 'stale' },
      },
    })

    render(<ModelSelector />)
    fireEvent.click(screen.getByTitle('更换模型'))

    expect(screen.getByText(/余 503 积分 · 可能过期/)).toBeInTheDocument()
  })
})
