import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchWpsScallionRuntimeMetadata,
  formatWpsPlanName,
  getWpsModelAccess,
  mergeWpsRuntimeMetadata,
  normalizeWpsQuota,
  parseWpsModelPayload,
} from './wpsScallionMetadata'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('WPS Scallion runtime metadata', () => {
  it('keeps all server models and marks models outside the active plan', () => {
    const models = parseWpsModelPayload({
      data: [
        {
          id: 'agnes-2.0-flash',
          name: 'Agnes 2.0 Flash',
          plan_available: true,
          context_window_tokens: 1048576,
          context_window_label: '1M',
        },
        {
          id: 'nvidia/nemotron-3-ultra-550b-a55b',
          name: 'Nemotron 3 Ultra 550B A55B',
          plan_available: false,
          required_plan: 'deeper',
          availability_reason: '需要 Deeper 套餐',
          context_window_tokens: 262144,
        },
      ],
    })

    expect(models).toHaveLength(2)
    expect(models[1]).toEqual(
      expect.objectContaining({
        id: 'nvidia/nemotron-3-ultra-550b-a55b',
        planAvailable: false,
        requiredPlan: 'deeper',
        availabilityReason: '需要 Deeper 套餐',
      }),
    )
  })

  it('uses points_balance before legacy balance and quota fields', () => {
    expect(
      normalizeWpsQuota({
        balance: 999,
        points_balance: 503,
        quota: 123,
        plan: { key: 'briefly', name: 'Briefly', expires_at: null },
      }),
    ).toEqual(
      expect.objectContaining({
        pointsBalance: 503,
        planKey: 'briefly',
        planName: 'Briefly',
      }),
    )
  })

  it('keeps a successful model directory when the quota request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'agnes-2.0-flash', name: 'Agnes 2.0 Flash' }] }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ error: 'quota unavailable' }),
        }),
    )

    const metadata = await fetchWpsScallionRuntimeMetadata('jwt-token')

    expect(metadata.models).toHaveLength(1)
    expect(metadata.modelsSync).toMatchObject({ status: 'ready' })
    expect(metadata.quota).toBeUndefined()
    expect(metadata.quotaSync).toMatchObject({ status: 'error', error: expect.any(String) })
  })

  it('keeps a successful quota when the model directory request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ error: 'models unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            points_balance: 503,
            plan: { key: 'briefly', name: 'Briefly', expires_at: null },
          }),
        }),
    )

    const metadata = await fetchWpsScallionRuntimeMetadata('jwt-token')

    expect(metadata.models).toEqual([])
    expect(metadata.modelsSync).toMatchObject({ status: 'error', error: expect.any(String) })
    expect(metadata.quota).toEqual(expect.objectContaining({ pointsBalance: 503, planKey: 'briefly' }))
    expect(metadata.quotaSync).toMatchObject({ status: 'ready' })
  })

  it('preserves previous values and marks failed channels stale', () => {
    const previous = {
      models: [{ id: 'agnes', name: 'Agnes', modelName: 'agnes', planAvailable: true, available: true }],
      quota: { pointsBalance: 503, updatedAt: 100 },
      modelsSync: { status: 'ready' as const },
      quotaSync: { status: 'ready' as const },
    }
    const next = {
      models: [],
      modelsSync: { status: 'error' as const, error: '目录失败' },
      quotaSync: { status: 'error' as const, error: '额度失败' },
    }

    const merged = mergeWpsRuntimeMetadata(previous, next)

    expect(merged.models).toHaveLength(1)
    expect(merged.quota?.pointsBalance).toBe(503)
    expect(merged.modelsSync).toMatchObject({ status: 'stale', error: '目录失败' })
    expect(merged.quotaSync).toMatchObject({ status: 'stale', error: '额度失败' })
  })

  it('formats plan requirements and distinguishes temporary model outages', () => {
    expect(formatWpsPlanName('deeper')).toBe('Deeper')
    expect(
      getWpsModelAccess({
        available: true,
        planAvailable: false,
        requiredPlan: 'deeper',
      }),
    ).toEqual(expect.objectContaining({ label: '套餐不可用', detail: '需要 Deeper 套餐', usable: false }))
    expect(
      getWpsModelAccess({ available: false, planAvailable: true, availabilityReason: '模型维护中' }),
    ).toEqual(expect.objectContaining({ label: '暂不可用', detail: '模型维护中', usable: false }))
  })
})
