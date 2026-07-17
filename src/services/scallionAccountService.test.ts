import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getScallionQuotaDisplay,
  normalizeQuota,
  quotaFromUser,
  refreshScallionModels,
  refreshScallionQuota,
} from './scallionAccountService'
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

  it('preserves plan manual/Auto catalog and live Auto quota fields', () => {
    expect(
      normalizeQuota({
        points_balance: 504,
        plan: {
          key: 'free',
          name: 'Free',
          manual_models: [],
          auto_models: ['agnes-2.0-flash'],
          auto_monthly_calls: 300,
          auto_daily_calls: 10,
          external_api: false,
        },
        auto: {
          monthly_used: 4,
          daily_used: 2,
          monthly_remaining: 296,
          daily_remaining: 8,
        },
      }),
    ).toEqual(
      expect.objectContaining({
        manualModels: [],
        autoModels: ['agnes-2.0-flash'],
        autoMonthlyCalls: 300,
        autoDailyCalls: 10,
        autoMonthlyUsed: 4,
        autoDailyUsed: 2,
        autoMonthlyRemaining: 296,
        autoDailyRemaining: 8,
        externalApi: false,
      }),
    )
  })

  it('accepts Auto quota nested under the quota object for gateway variants', () => {
    expect(
      normalizeQuota({
        points_balance: 12,
        quota: {
          points_balance: 12,
          auto: { monthly_remaining: 4, daily_remaining: 1 },
          plan: { key: 'free', name: 'Free' },
        } as never,
      }),
    ).toEqual(expect.objectContaining({ autoMonthlyRemaining: 4, autoDailyRemaining: 1 }))
  })

  it('accepts top-level Auto entitlement fields and external API labels', () => {
    expect(
      normalizeQuota({
        points_balance: 10,
        manual_models: [],
        auto_models: ['agnes-2.0-flash'],
        auto_monthly_calls: 300,
        auto_daily_calls: 10,
        auto_monthly_remaining: 299,
        auto_daily_remaining: 9,
        external_api: 'deeper',
      }),
    ).toEqual(
      expect.objectContaining({
        manualModels: [],
        autoModels: ['agnes-2.0-flash'],
        autoMonthlyCalls: 300,
        autoDailyCalls: 10,
        autoMonthlyRemaining: 299,
        autoDailyRemaining: 9,
        externalApi: 'deeper',
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

describe('getScallionQuotaDisplay', () => {
  it('labels only a ready authenticated points balance as realtime', () => {
    expect(getScallionQuotaDisplay({
      token: 'jwt',
      quota: {
        remaining: 10,
        pointsBalance: 10,
        unit: '积分',
        isMember: false,
        memberPriceLabel: '',
        upgradeUrl: '',
        topUpUrl: '',
        updatedAt: 1,
      },
      syncStatus: 'ready',
    })).toEqual({ value: 10, source: 'realtime', status: 'ready' })
  })

  it('labels a stale account value as cached', () => {
    expect(getScallionQuotaDisplay({
      token: 'jwt',
      quota: {
        remaining: 9,
        pointsBalance: 9,
        unit: '积分',
        isMember: false,
        memberPriceLabel: '',
        upgradeUrl: '',
        topUpUrl: '',
        updatedAt: 1,
      },
      syncStatus: 'stale',
    })).toEqual({ value: 9, source: 'cached', status: 'stale' })
  })
})

describe('refreshScallionModels', () => {
  it('does not commit a stale catalog after the Scallion account changes', async () => {
    let resolveResponse!: (response: Response) => void
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    useAppStore.setState({
      scallionToken: 'old-jwt',
      scallionPlan: {
        key: 'briefly',
        name: 'Briefly',
        availableModels: ['old-model'],
        updatedAt: Date.now(),
      },
    })
    vi.stubGlobal('fetch', vi.fn(() => responsePromise))

    const refresh = refreshScallionModels()
    useAppStore.setState({
      scallionToken: 'new-jwt',
      scallionPlan: {
        key: 'deeper',
        name: 'Deeper',
        availableModels: ['new-model'],
        updatedAt: Date.now(),
      },
    })
    resolveResponse({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'old-model', name: '旧账号模型' }],
        plan: { key: 'briefly', name: 'Briefly' },
      }),
    } as Response)

    await expect(refresh).resolves.toEqual([])
    expect(useAppStore.getState().scallionPlan?.key).toBe('deeper')
    expect(useAppStore.getState().scallionModels).toEqual([])
  })

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
