import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeQuota, quotaFromUser, refreshScallionModels, refreshScallionQuota } from './scallionAccountService'
import { useAppStore } from '../stores/useAppStore'

afterEach(() => {
  vi.restoreAllMocks()
  useAppStore.setState({
    scallionToken: undefined,
    scallionQuota: undefined,
    scallionModels: [],
    scallionSync: { models: { status: 'idle' }, quota: { status: 'idle' } },
    authStatus: 'idle',
  })
})

describe('normalizeQuota', () => {
  it('falls back to the Free plan when legacy account data has no plan fields', () => {
    const quota = normalizeQuota({ balance: 12 })

    expect(quota.planKey).toBe('free')
    expect(quota.planName).toBe('Free')
    expect(quota.pointsBalance).toBe(12)
  })

  it('normalizes the legacy none entitlement to the Free display name', () => {
    expect(
      quotaFromUser({ id: 1, username: 'demo', points: 4, member_type: 'none' }),
    ).toEqual(expect.objectContaining({ planKey: 'free', planName: 'Free' }))
  })

  it('preserves member type and expiry as a plan fallback', () => {
    expect(
      quotaFromUser({
        id: 1,
        username: 'demo',
        points: 321,
        member_type: 'briefly',
        member_expires_at: '2026-08-12T00:00:00.000Z',
      }),
    ).toEqual(
      expect.objectContaining({
        pointsBalance: 321,
        planKey: 'briefly',
        planName: 'Briefly',
        planExpiresAt: '2026-08-12T00:00:00.000Z',
      }),
    )
  })

  it('uses points_balance as the canonical client balance and preserves plan metadata', () => {
    expect(
      normalizeQuota({
        balance: 999,
        points_balance: 504,
        quota: 123,
        unified_points: true,
        plan: {
          key: 'briefly',
          name: 'Briefly',
          expires_at: '2026-08-12T00:00:00.000Z',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        remaining: 504,
        pointsBalance: 504,
        balance: 999,
        quota: 123,
        unifiedPoints: true,
        planKey: 'briefly',
        planName: 'Briefly',
        planExpiresAt: '2026-08-12T00:00:00.000Z',
      }),
    )
  })

  it('marks the session expired when the quota endpoint returns 401', async () => {
    useAppStore.setState({ scallionToken: 'expired-jwt' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'JWT 失效' } }),
      }) as Response),
    )

    await expect(refreshScallionQuota()).resolves.toBeUndefined()
    expect(useAppStore.getState().authStatus).toBe('expired')
    expect(useAppStore.getState().scallionQuota).toBeUndefined()
  })

  it('does not clear the model catalog when quota refresh returns the same session', async () => {
    useAppStore.setState({
      scallionToken: 'jwt-token',
      scallionModels: [
        {
          id: 'agnes-2.0-flash',
          label: 'Agnes 2.0 Flash',
          modelName: 'agnes-2.0-flash',
          available: true,
          updatedAt: Date.now(),
        },
      ],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          user: { id: 1, username: 'demo' },
          points_balance: 503,
          plan: { key: 'free', name: 'Free', expires_at: null },
        }),
      }) as Response),
    )

    await refreshScallionQuota()

    expect(useAppStore.getState().scallionModels).toHaveLength(1)
    expect(useAppStore.getState().scallionQuota?.pointsBalance).toBe(503)
    expect(useAppStore.getState().scallionSync.quota.status).toBe('ready')
  })

  it('calls the canonical quota endpoint with the active Scallion JWT', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          points_balance: 504,
          plan: { key: 'free', name: 'Free', expires_at: null },
        }),
      }) as Response,
    )
    vi.stubGlobal('fetch', fetchMock)

    await refreshScallionQuota()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://scallion.uno/api/papyrus/llm/quota',
      expect.objectContaining({
        headers: { Authorization: 'Bearer jwt-token' },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('preserves the last successful quota when a later refresh is temporarily unavailable', async () => {
    useAppStore.setState({
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
        updatedAt: 100,
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: '暂不可用' } }),
      }) as Response),
    )

    await expect(refreshScallionQuota()).resolves.toEqual(expect.objectContaining({ pointsBalance: 503, updatedAt: 100 }))
    expect(useAppStore.getState().scallionQuota?.updatedAt).toBe(100)
    expect(useAppStore.getState().scallionSync.quota).toEqual(
      expect.objectContaining({ status: 'stale', error: expect.any(String), updatedAt: 100 }),
    )
  })

  it('uses legacy balance fields only when the canonical points balance is absent', () => {
    expect(
      normalizeQuota({
        points_balance: null as unknown as number,
        balance: 502,
        quota: 501,
        user: { id: 1, username: 'demo', member_type: 'briefly' },
      }),
    ).toEqual(
      expect.objectContaining({
        pointsBalance: 502,
        planKey: 'briefly',
        planName: 'Briefly',
      }),
    )
  })

  it('preserves a top-level member type from legacy quota responses', () => {
    expect(
      normalizeQuota({
        points_balance: 88,
        member_type: 'briefly',
        is_member: true,
      }),
    ).toEqual(
      expect.objectContaining({
        pointsBalance: 88,
        planKey: 'briefly',
        planName: 'Briefly',
        isMember: true,
      }),
    )
  })
})

describe('refreshScallionModels', () => {
  it('keeps the full catalog and marks plan-restricted models as non-callable', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'agnes-2.0-flash',
                name: 'Agnes 2.0 Flash',
                plan_available: true,
                context_window_tokens: 1048576,
              },
              {
                id: 'nemotron',
                name: 'Nemotron',
                plan_available: false,
                required_plan: 'deeper',
                availability_reason: '当前 Free 套餐不可用',
              },
            ],
          }),
        }) as Response,
      ),
    )

    const models = await refreshScallionModels()

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('/models?include_unavailable=1')
    expect(models).toHaveLength(2)
    expect(models[0]).toEqual(expect.objectContaining({ id: 'agnes-2.0-flash', available: true }))
    expect(models[1]).toEqual(
      expect.objectContaining({
        id: 'nemotron',
        available: false,
        planAvailable: false,
        requiredPlan: 'deeper',
        availabilityReason: '当前 Free 套餐不可用',
      }),
    )
    expect(useAppStore.getState().scallionModels).toHaveLength(2)
    expect(useAppStore.getState().scallionSync.models).toEqual(
      expect.objectContaining({ status: 'ready', error: undefined }),
    )
  })

  it('exposes an error state when the catalog has no previous successful value', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token', scallionModels: [] })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: false,
          status: 503,
          json: async () => ({ error: { message: '模型目录维护中' } }),
        }) as Response,
      ),
    )

    await expect(refreshScallionModels()).rejects.toThrow()
    expect(useAppStore.getState().scallionSync.models).toEqual(
      expect.objectContaining({ status: 'error', error: expect.any(String) }),
    )
  })
})
