import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  callOpenAICompatible,
  callOpenAICompatibleStream,
  fetchScallionProxyModelCatalog,
  fetchScallionProxyModels,
} from './llmClient'
import { defaultProviderConfigs } from './modelCatalog'
import { useAppStore } from '../stores/useAppStore'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

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

afterEach(async () => {
  // Let the post-call quota refresh scheduled by the client settle before
  // the next contract test replaces its fetch mock.
  await new Promise((resolve) => setTimeout(resolve, 0))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(invoke).mockReset()
  useAppStore.setState({
    scallionToken: undefined,
    scallionModels: [],
    scallionPlan: undefined,
    scallionQuota: undefined,
    modelRoutingMode: 'manual',
  })
})

describe('desktop sampling parity', () => {
  beforeEach(() => {
    useAppStore.setState({
      scallionToken: 'jwt-token',
      scallionPlan: {
        key: 'deeper',
        name: 'Deeper',
        availableModels: [],
        externalApi: true,
        updatedAt: Date.now(),
      },
    })
  })

  it('preserves every sampling option when a non-streaming request falls back to Tauri', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    vi.mocked(invoke).mockResolvedValue('native reply')

    await expect(
      callOpenAICompatible(
        { ...defaultProviderConfigs.openai, apiKey: 'test-key' },
        [{ role: 'user', content: '请写一段文字' }],
        undefined,
        {
          temperature: 0.31,
          maxTokens: 1234,
          frequencyPenalty: 0.48,
          presencePenalty: 0.22,
        },
      ),
    ).resolves.toBe('native reply')

    expect(invoke).toHaveBeenCalledWith('llm_chat', {
      request: expect.objectContaining({
        temperature: 0.31,
        maxTokens: 1234,
        frequencyPenalty: 0.48,
        presencePenalty: 0.22,
      }),
    })
  })

  it('keeps sampling options when an empty streaming body falls back to a regular request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: null } as Response)
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'fallback reply' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatibleStream(
        { ...defaultProviderConfigs.openai, apiKey: 'test-key' },
        [{ role: 'user', content: '请写一段文字' }],
        {
          onToken: vi.fn(),
          sampling: {
            temperature: 0.31,
            maxTokens: 1234,
            frequencyPenalty: 0.48,
            presencePenalty: 0.22,
          },
        },
      ),
    ).resolves.toBe('fallback reply')

    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toMatchObject({
      stream: false,
      temperature: 0.31,
      max_tokens: 1234,
      frequency_penalty: 0.48,
      presence_penalty: 0.22,
    })
  })

  it('downgrades a zero-token readable stream only once with the same sampling options', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({ read: async () => ({ done: true }) }),
        },
      } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'zero token fallback' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatibleStream(
        { ...defaultProviderConfigs.openai, apiKey: 'test-key' },
        [{ role: 'user', content: '请写一段文字' }],
        {
          onToken: vi.fn(),
          sampling: {
            temperature: 0.31,
            maxTokens: 1234,
            frequencyPenalty: 0.48,
            presencePenalty: 0.22,
          },
        },
      ),
    ).resolves.toBe('zero token fallback')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toMatchObject({
      stream: false,
      temperature: 0.31,
      max_tokens: 1234,
      frequency_penalty: 0.48,
      presence_penalty: 0.22,
    })
  })

  it('downgrades a DONE-only SSE stream without trying to parse its marker as JSON', async () => {
    const encoder = new TextEncoder()
    let readCount = 0
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              if (readCount++ === 0) return { value: encoder.encode('data: [DONE]\n\n'), done: false }
              return { done: true }
            },
          }),
        },
      } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'done marker fallback' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatibleStream(
        { ...defaultProviderConfigs.openai, apiKey: 'test-key' },
        [{ role: 'user', content: '请写一段文字' }],
        {
          onToken: vi.fn(),
          sampling: { temperature: 0.31, maxTokens: 1234, frequencyPenalty: 0.48, presencePenalty: 0.22 },
        },
      ),
    ).resolves.toBe('done marker fallback')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not send a fallback request after a whitespace token was received', async () => {
    const encoder = new TextEncoder()
    let readCount = 0
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (readCount++ === 0) {
              return { value: encoder.encode('data: {"choices":[{"delta":{"content":" "}}]}\n\n'), done: false }
            }
            return { done: true }
          },
        }),
      },
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatibleStream(
        { ...defaultProviderConfigs.openai, apiKey: 'test-key' },
        [{ role: 'user', content: '请写一段文字' }],
        { onToken: vi.fn(), sampling: { temperature: 0.31, maxTokens: 1234 } },
      ),
    ).rejects.toMatchObject({ code: 'protocol_error', recoverable: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('makes only one non-streaming attempt after an empty stream fallback fails transiently', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: { getReader: () => ({ read: async () => ({ done: true }) }) },
      } as unknown as Response)
      .mockResolvedValue(jsonResponse({ error: { message: 'temporary upstream error' } }, 503))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatibleStream(
        { ...defaultProviderConfigs.openai, apiKey: 'test-key' },
        [{ role: 'user', content: '请写一段文字' }],
        { onToken: vi.fn(), sampling: { temperature: 0.31, maxTokens: 1234 } },
      ),
    ).rejects.toMatchObject({ code: 'server_error' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
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

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'https://scallion.uno/api/papyrus/llm/models',
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

  it('retries once without routing_mode for an older gateway validation response', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token', modelRoutingMode: 'auto' })
    setUsableModel()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: 'Validation: Unsupported parameter(s): `routing_mode`', type: 'Bad Request', code: 400 } },
          400,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '已兼容回复' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatible(defaultProviderConfigs.qwen36, [{ role: 'user', content: '测试' }]),
    ).resolves.toBe('已兼容回复')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveProperty('routing_mode', 'auto')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('routing_mode')
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

  it('normalizes manual/Auto permissions, plan quotas and removes duplicate catalog ids', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 'agnes-2.0-flash',
              name: 'Agnes 2.0 Flash',
              manual_available: false,
              auto_available: true,
              auto_only: true,
              context_window_tokens: 1048576,
            },
            {
              id: 'agnes-2.0-flash',
              context_window_label: '1M',
            },
          ],
          plan: {
            key: 'free',
            name: 'Free',
            manual_models: [],
            auto_models: ['agnes-2.0-flash'],
            auto_monthly_calls: 300,
            auto_daily_calls: 10,
            external_api: 'deeper',
          },
        }),
      ),
    )

    const catalog = await fetchScallionProxyModelCatalog(defaultProviderConfigs.qwen36)

    expect(catalog.models).toHaveLength(1)
    expect(catalog.models[0]).toEqual(
      expect.objectContaining({
        id: 'agnes-2.0-flash',
        manualAvailable: false,
        autoAvailable: true,
        autoOnly: true,
        contextWindowTokens: 1048576,
        contextWindowLabel: '1M',
      }),
    )
    expect(catalog.plan).toEqual(
      expect.objectContaining({
        manualModels: [],
        autoModels: ['agnes-2.0-flash'],
        autoMonthlyCalls: 300,
        autoDailyCalls: 10,
        externalApi: 'deeper',
      }),
    )
  })

  it('sends Auto routing for a legacy manual-mode Free client when no manual models exist', async () => {
    useAppStore.setState({
      scallionToken: 'jwt-token',
      modelRoutingMode: 'manual',
      scallionPlan: {
        key: 'free',
        name: 'Free',
        availableModels: ['agnes-2.0-flash'],
        manualModels: [],
        autoModels: ['agnes-2.0-flash'],
        updatedAt: Date.now(),
      },
      scallionModels: [
        {
          id: 'agnes-2.0-flash',
          label: 'Agnes 2.0 Flash',
          modelName: 'agnes-2.0-flash',
          manualAvailable: false,
          autoAvailable: true,
          autoOnly: true,
          available: true,
          planAvailable: true,
          updatedAt: Date.now(),
        },
      ],
    })
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '完成' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatible(
        { ...defaultProviderConfigs.qwen36, modelName: 'agnes-2.0-flash' },
        [{ role: 'user', content: '测试' }],
      ),
    ).resolves.toBe('完成')

    const requestInit = (fetchMock.mock.calls as unknown as Array<[RequestInfo, RequestInit]>)[0]?.[1]
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      model: 'agnes-2.0-flash',
      routing_mode: 'auto',
    })
  })

  it('classifies auto quota exhaustion regardless of HTTP status', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token', modelRoutingMode: 'auto' })
    setUsableModel()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { message: 'Auto 次数已用尽', type: 'auto_quota_exhausted' } },
          429,
        ),
      ),
    )

    await expect(
      callOpenAICompatible(defaultProviderConfigs.qwen36, [{ role: 'user', content: '测试' }]),
    ).rejects.toMatchObject({ code: 'auto_quota_exhausted', status: 429 })
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

  it('preserves the top-level plan metadata alongside the full model directory', async () => {
    useAppStore.setState({ scallionToken: 'jwt-token' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [{ id: 'agnes-2.0-flash', name: 'Agnes 2.0 Flash' }],
          plan: {
            key: 'briefly',
            name: 'Briefly',
            expires_at: '2026-08-12T00:00:00.000Z',
            available_models: ['agnes-2.0-flash'],
          },
        }),
      ),
    )

    const catalog = await fetchScallionProxyModelCatalog(defaultProviderConfigs.qwen36)

    expect(catalog.plan).toEqual(
      expect.objectContaining({
        key: 'briefly',
        name: 'Briefly',
        expiresAt: '2026-08-12T00:00:00.000Z',
        availableModels: ['agnes-2.0-flash'],
      }),
    )
    expect(catalog.models).toHaveLength(1)
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
      modelRoutingMode: 'auto',
      scallionPlan: {
        key: 'free',
        name: 'Free',
        availableModels: [],
        manualModels: [],
        autoModels: ['agnes-2.0-flash'],
        updatedAt: Date.now(),
      },
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
          plan: {
            key: 'free',
            name: 'Free',
            manual_models: [],
            auto_models: ['agnes-2.0-flash'],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          points_balance: 504,
          balance: 504,
          quota: 504,
          plan: {
            key: 'free',
            name: 'Free',
            manual_models: [],
            auto_models: ['agnes-2.0-flash'],
            expires_at: null,
          },
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
          plan: {
            key: 'free',
            name: 'Free',
            manual_models: [],
            auto_models: ['agnes-2.0-flash'],
            expires_at: null,
          },
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

  it('blocks external providers without a Deeper entitlement before network access', async () => {
    useAppStore.setState({
      scallionToken: 'jwt-token',
      scallionPlan: {
        key: 'free',
        name: 'Free',
        availableModels: [],
        externalApi: false,
        updatedAt: Date.now(),
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatible(
        { ...defaultProviderConfigs.openai, apiKey: 'legacy-key' },
        [{ role: 'user', content: '测试' }],
      ),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows a user-configured custom model on every Scallion plan', async () => {
    useAppStore.setState({
      scallionToken: 'jwt-token',
      scallionPlan: {
        key: 'free',
        name: 'Free',
        availableModels: [],
        externalApi: false,
        updatedAt: Date.now(),
      },
    })
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '自定义模型回复' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callOpenAICompatible(
        { ...defaultProviderConfigs.custom, baseUrl: 'https://custom.example/v1', apiKey: 'custom-key', modelName: 'my-model' },
        [{ role: 'user', content: '测试' }],
      ),
    ).resolves.toBe('自定义模型回复')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allows external providers only when the gateway explicitly grants Deeper access', async () => {
    useAppStore.setState({
      scallionToken: 'jwt-token',
      scallionPlan: {
        key: 'deeper',
        name: 'Deeper',
        availableModels: [],
        externalApi: true,
        updatedAt: Date.now(),
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ choices: [{ message: { content: '完成' } }] })),
    )

    await expect(
      callOpenAICompatible(
        { ...defaultProviderConfigs.openai, apiKey: 'deeper-key' },
        [{ role: 'user', content: '测试' }],
      ),
    ).resolves.toBe('完成')
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
