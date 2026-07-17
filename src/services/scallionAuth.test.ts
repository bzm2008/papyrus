import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}))

vi.mock('./scallionAccountService', () => ({
  refreshScallionRuntimeMetadata: vi.fn(() => Promise.resolve()),
}))

import { startScallionLogin } from './scallionAuth'
import { useAppStore } from '../stores/useAppStore'

describe('Scallion desktop authorization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useAppStore.setState({
      scallionToken: undefined,
      scallionUser: undefined,
      scallionModels: [],
      scallionPlan: undefined,
      scallionQuota: undefined,
      authStatus: 'idle',
      authDeviceCode: undefined,
      authUserCode: undefined,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stores a token when the approved poll response uses nested data and snake-case fields', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          device_code: 'device-1',
          user_code: 'ABCD23',
          verification_url: 'https://scallion.uno/papyrus/authorize?device=device-1',
          interval: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            status: 'approved',
            access_token: 'jwt-from-scallion',
            user: { id: 42, name: '授权用户' },
          },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await startScallionLogin()
    await vi.advanceTimersByTimeAsync(1000)

    expect(useAppStore.getState()).toEqual(expect.objectContaining({
      scallionToken: 'jwt-from-scallion',
      scallionUser: expect.objectContaining({ id: 42, username: '授权用户' }),
      authStatus: 'approved',
    }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps polling after a transient non-OK response instead of marking the session expired', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          deviceCode: 'device-2',
          userCode: 'EFGH45',
          verificationUrl: 'https://scallion.uno/papyrus/authorize?device=device-2',
          interval: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ error: 'gateway restart' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'approved', token: 'jwt-after-retry' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await startScallionLogin()
    await vi.advanceTimersByTimeAsync(1000)

    expect(useAppStore.getState().authStatus).toBe('reconnecting')
    expect(useAppStore.getState().scallionToken).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1500)
    expect(useAppStore.getState()).toEqual(expect.objectContaining({
      scallionToken: 'jwt-after-retry',
      authStatus: 'approved',
    }))
  })
})
