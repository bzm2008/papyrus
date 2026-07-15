import { afterEach, describe, expect, it, vi } from 'vitest'
import { callOpenAICompatible, callOpenAICompatibleStream, fetchScallionProxyModels } from './llmClient'
import { defaultProviderConfigs } from './modelCatalog'
import { useAppStore } from '../stores/useAppStore'

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response
}

function setUsableModel(modelName = 'agnes-2.0-flash') {
  useAppStore.setState({
    scallionModels: [
      {
        id: modelName,
        label: modelName,
        modelName,
        available: true,
        planAvailable: true,
        updatedAt: Date.now(),
      },
    ],
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  useAppStore.setState({
    scallionToken: undefined,
    scallionModels: [],
    scallionQuota: undefined,
  })
})

describe('Scallion production contract', () => {
  it('maps only server-returned model ids and numeric context fields', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 'agnes-2.0-flash',
              name: 'Agnes 2.0 Flash',
              modelName: 'Agnes 2.0 Flash',
              provider: 'agnes',
              billing_mode: 'call',
              call_price: 1,
              context_window: 1048576,
              context_window_tokens: 1048576,
              context_window_label: '1M',
            },
          ],
          plan: { key: 'free', name: 'Free' },
        }),
      ),
    )

    const models = await fetchScallionProxyModels(defaultProviderConfigs.qwen36)

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      '/models?include_unavailable=1',
    )
    expect(models).toEqual([
      expect.objectContaining({
        id: 'agnes-2.0-flash',
        modelName: 'agnes-2.0-flash',
        name: 'Agnes 2.0 Flash',
        provider: 'agnes',
        billingMode: 'call',
        callPrice: 1,
        contextWindowTokens: 1048576,
        contextWindowLabel: '1M',
      }),
    ])
  })

  it('keeps server-declared plan restrictions so the UI can show unavailable models', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 'nvidia/nemotron-3-ultra-550b-a55b',
              name: 'Nemotron 3 Ultra 550B A55B',
              plan_available: false,
              required_plan: 'deeper',
              availability_reason: '需要 Deeper 套餐',
              context_window_tokens: 262144,
            },
          ],
          plan: { key: 'free', name: 'Free' },
        }),
      ),
    )

    const models = await fetchScallionProxyModels(defaultProviderConfigs.qwen36)

    expect(models[0]).toEqual(
      expect.objectContaining({
        id: 'nvidia/nemotron-3-ultra-550b-a55b',
        planAvailable: false,
        requiredPlan: 'deeper',
        availabilityReason: '需要 Deeper 套餐',
      }),
    )
  })

  it('classifies model catalog network failures as recoverable', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )

    await expect(fetchScallionProxyModels(defaultProviderConfigs.qwen36)).rejects.toMatchObject({
      code: 'network_error',
      recoverable: true,
    })
  })

  it('classifies a malformed successful model catalog response as a recoverable protocol error', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('invalid json')
          },
        }) as unknown as Response,
      ),
    )

    await expect(fetchScallionProxyModels(defaultProviderConfigs.qwen36)).rejects.toMatchObject({
      code: 'protocol_error',
      recoverable: true,
    })
  })

  it('refreshes access after a plan-model 403 and retries once with the returned model id', async () => {
    useAppStore.setState({
      scallionToken: 'jwt-token',
      scallionModels: [
        {
          id: 'nemotron-越权',
          label: 'Nemotron',
          modelName: 'nemotron-越权',
          available: true,
          updatedAt: Date.now(),
        },
      ],
    })
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              message: '当前 Free 套餐不可调用该模型',
              type: 'plan_model_forbidden',
              plan: 'free',
            },
          },
          403,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'agnes-2.0-flash',
              name: 'Agnes 2.0 Flash',
              context_window_tokens: 1048576,
              context_window_label: '1M',
            },
          ],
          plan: { key: 'free', name: 'Free' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          points_balance: 504,
          balance: 504,
          quota: 504,
          plan: { key: 'free', name: 'Free', expires_at: null },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: '已切换到套餐内模型' } }],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callOpenAICompatible(
      {
        ...defaultProviderConfigs.qwen36,
        modelName: 'nemotron-越权',
      },
      [{ role: 'user', content: '测试' }],
    )

    expect(result).toBe('已切换到套餐内模型')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).model).toBe('agnes-2.0-flash')
    expect(useAppStore.getState().providerConfigs.qwen36.modelName).toBe('agnes-2.0-flash')
    expect(useAppStore.getState().scallionModels[0]?.id).toBe('agnes-2.0-flash')
  })

  it.each([
    [401, 'unauthorized'],
    [402, 'quota_exhausted'],
  ] as const)('classifies HTTP %s without retrying as a different model', async (status, code) => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    setUsableModel()
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: '请求失败' } }, status),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatible(defaultProviderConfigs.qwen36, [{ role: 'user', content: '测试' }]),
    ).rejects.toMatchObject({ code, status })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not automatically send a second Scallion request after an uncertain network failure', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    setUsableModel()
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatible(defaultProviderConfigs.qwen36, [{ role: 'user', content: '测试' }]),
    ).rejects.toMatchObject({ code: 'request_uncertain', recoverable: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clears the Scallion session immediately when the gateway returns 401', async () => {
    useAppStore.setState({ scallionToken: 'expired-jwt', scallionModels: [] })
    setUsableModel()
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'JWT 失效', type: 'unauthorized' } }, 401),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatible(
        { ...defaultProviderConfigs.qwen36, modelName: 'agnes-2.0-flash' },
        [{ role: 'user', content: '测试' }],
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    expect(useAppStore.getState().scallionToken).toBeUndefined()
    expect(useAppStore.getState().authStatus).toBe('expired')
  })

  it('refreshes the live points balance after a successful Scallion call', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    setUsableModel()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: '完成' } }],
          _scallion_billing: { pointsCharged: 1 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          points_balance: 503,
          plan: { key: 'free', name: 'Free', expires_at: null },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatible(defaultProviderConfigs.qwen36, [{ role: 'user', content: '测试' }]),
    ).resolves.toBe('完成')

    await vi.waitFor(() => {
      expect(useAppStore.getState().scallionQuota?.pointsBalance).toBe(503)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not submit a Scallion model id that is absent from the server catalog', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token', scallionModels: [] })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatible(defaultProviderConfigs.qwen36, [{ role: 'user', content: '测试' }]),
    ).rejects.toMatchObject({ code: 'protocol_error' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not retry a stream after receiving partial content', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    setUsableModel()
    const encoder = new TextEncoder()
    const fetchMock = vi.fn(async () => {
      let reads = 0
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              if (reads++ === 0) {
                return { value: encoder.encode('data: {"choices":[{"delta":{"content":"半截"}}]}\n\n'), done: false }
              }
              throw new Error('connection reset')
            },
          }),
        },
      } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatibleStream(defaultProviderConfigs.qwen36, [{ role: 'user', content: '测试' }], {
        onToken: vi.fn(),
      }),
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
