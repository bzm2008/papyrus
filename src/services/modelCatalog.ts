export type ProviderType = 'scallion_proxy' | 'vendor_key' | 'custom'
export type CustomContextTier = '128k' | '256k' | '1m'
export type ModelContextSource = 'server' | 'preset' | 'custom_tier'

export type ProviderId =
  | 'qwen36'
  | 'openai'
  | 'siliconflow'
  | 'deepseek'
  | 'moonshot'
  | 'bailian'
  | 'doubao'
  | 'glm'
  | 'minimax'
  | 'baichuan'
  | 'hunyuan'
  | 'qianfan'
  | 'yi'
  | 'stepfun'
  | 'openrouter'
  | 'groq'
  | 'custom'

export type LlmProviderConfig = {
  id: ProviderId
  type: ProviderType
  label: string
  baseUrl: string
  apiKey: string
  modelName: string
  docsUrl: string
  setupHint: string
  contextWindowTokens: number
  serverContextWindowTokens?: number
  customContextTier?: CustomContextTier
  validatedAt?: number
  lastValidatedSignature?: string
}

export const customContextTiers: Array<{
  id: CustomContextTier
  label: string
  tokens: number
}> = [
  { id: '128k', label: '128K', tokens: 131072 },
  { id: '256k', label: '256K', tokens: 262144 },
  { id: '1m', label: '1M', tokens: 1048576 },
]

export const providerOrder: ProviderId[] = [
  'qwen36',
  'openai',
  'siliconflow',
  'deepseek',
  'moonshot',
  'bailian',
  'doubao',
  'glm',
  'minimax',
  'baichuan',
  'hunyuan',
  'qianfan',
  'yi',
  'stepfun',
  'openrouter',
  'groq',
  'custom',
]

export const defaultProviderConfigs: Record<ProviderId, LlmProviderConfig> = {
  qwen36: {
    id: 'qwen36',
    type: 'scallion_proxy',
    label: 'Scallion 内置模型',
    baseUrl: 'https://scallion.uno/api/papyrus/llm',
    apiKey: '',
    modelName: 'agnes-2.0-flash',
    docsUrl: 'https://scallion.uno',
    setupHint: 'Built-in cloud model through Scallion proxy. No upstream key is stored in the client.',
    contextWindowTokens: 131072,
  },
  openai: {
    id: 'openai',
    type: 'vendor_key',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    modelName: 'gpt-4.1',
    docsUrl: 'https://platform.openai.com/api-keys',
    setupHint: 'Create an API key in OpenAI Platform and paste it here.',
    contextWindowTokens: 1048576,
  },
  siliconflow: {
    id: 'siliconflow',
    type: 'vendor_key',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    modelName: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
    setupHint: 'Create an API key in SiliconFlow console.',
    contextWindowTokens: 131072,
  },
  deepseek: {
    id: 'deepseek',
    type: 'vendor_key',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    modelName: 'deepseek-chat',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    setupHint: 'Create an API key in DeepSeek Platform.',
    contextWindowTokens: 65536,
  },
  moonshot: {
    id: 'moonshot',
    type: 'vendor_key',
    label: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: '',
    modelName: 'kimi-k2-0711-preview',
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    setupHint: 'Create an API key in Moonshot console.',
    contextWindowTokens: 131072,
  },
  bailian: {
    id: 'bailian',
    type: 'vendor_key',
    label: 'Alibaba Bailian',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    modelName: 'qwen-plus',
    docsUrl: 'https://bailian.console.aliyun.com/',
    setupHint: 'Enable model service in Alibaba Bailian and create an API key.',
    contextWindowTokens: 131072,
  },
  doubao: {
    id: 'doubao',
    type: 'vendor_key',
    label: 'ByteDance Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    modelName: 'doubao-seed-1-6',
    docsUrl: 'https://console.volcengine.com/ark',
    setupHint: 'Create an API key in Volcano Ark and confirm the model endpoint name.',
    contextWindowTokens: 262144,
  },
  glm: {
    id: 'glm',
    type: 'vendor_key',
    label: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    modelName: 'glm-4-plus',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    setupHint: 'Create an API key in Zhipu AI Open Platform.',
    contextWindowTokens: 131072,
  },
  minimax: {
    id: 'minimax',
    type: 'vendor_key',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKey: '',
    modelName: 'MiniMax-Text-01',
    docsUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    setupHint: 'Create an API key in MiniMax Open Platform.',
    contextWindowTokens: 1048576,
  },
  baichuan: {
    id: 'baichuan',
    type: 'vendor_key',
    label: 'Baichuan',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    apiKey: '',
    modelName: 'Baichuan4',
    docsUrl: 'https://platform.baichuan-ai.com/console/apikey',
    setupHint: 'Create an API key in Baichuan platform.',
    contextWindowTokens: 32768,
  },
  hunyuan: {
    id: 'hunyuan',
    type: 'vendor_key',
    label: 'Tencent Hunyuan',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    apiKey: '',
    modelName: 'hunyuan-turbos-latest',
    docsUrl: 'https://console.cloud.tencent.com/hunyuan',
    setupHint: 'Enable Tencent Hunyuan and create credentials.',
    contextWindowTokens: 262144,
  },
  qianfan: {
    id: 'qianfan',
    type: 'vendor_key',
    label: 'Baidu Qianfan',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    apiKey: '',
    modelName: 'ernie-4.5-turbo-128k',
    docsUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application',
    setupHint: 'Create an application and API key in Baidu Qianfan console.',
    contextWindowTokens: 131072,
  },
  yi: {
    id: 'yi',
    type: 'vendor_key',
    label: '01.AI',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    apiKey: '',
    modelName: 'yi-large',
    docsUrl: 'https://platform.lingyiwanwu.com/apikeys',
    setupHint: 'Create an API key in 01.AI platform.',
    contextWindowTokens: 32768,
  },
  stepfun: {
    id: 'stepfun',
    type: 'vendor_key',
    label: 'StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    apiKey: '',
    modelName: 'step-2-16k',
    docsUrl: 'https://platform.stepfun.com/account-info/api-key',
    setupHint: 'Create an API key in StepFun platform.',
    contextWindowTokens: 32768,
  },
  openrouter: {
    id: 'openrouter',
    type: 'vendor_key',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    modelName: 'anthropic/claude-sonnet-4',
    docsUrl: 'https://openrouter.ai/settings/keys',
    setupHint: 'Create a key in OpenRouter and use any compatible model name.',
    contextWindowTokens: 200000,
  },
  groq: {
    id: 'groq',
    type: 'vendor_key',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '',
    modelName: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com/keys',
    setupHint: 'Create an API key in Groq Console.',
    contextWindowTokens: 131072,
  },
  custom: {
    id: 'custom',
    type: 'custom',
    label: 'Custom Model',
    baseUrl: '',
    apiKey: '',
    modelName: '',
    docsUrl: '',
    setupHint: 'Use any OpenAI-compatible service. Base URL, model name and key are required.',
    contextWindowTokens: 131072,
    customContextTier: '128k',
  },
}

export function contextTokensForTier(tier: CustomContextTier) {
  return customContextTiers.find((item) => item.id === tier)?.tokens ?? 131072
}

export function getEffectiveContextLimit(provider: LlmProviderConfig) {
  if (provider.type === 'scallion_proxy') {
    return provider.serverContextWindowTokens || provider.contextWindowTokens
  }

  if (provider.type === 'custom' || provider.type === 'vendor_key') {
    return contextTokensForTier(provider.customContextTier ?? '128k')
  }

  return provider.contextWindowTokens
}

export function getModelContextSource(provider: LlmProviderConfig): ModelContextSource {
  if (provider.type === 'scallion_proxy' && provider.serverContextWindowTokens) {
    return 'server'
  }

  if (provider.type === 'custom' || provider.type === 'vendor_key') {
    return 'custom_tier'
  }

  return 'preset'
}

export function mergeProviderConfigs(
  persistedProviderConfigs?: Partial<Record<ProviderId, LlmProviderConfig>>,
): Record<ProviderId, LlmProviderConfig> {
  return providerOrder.reduce(
    (configs, providerId) => {
      const defaults = defaultProviderConfigs[providerId]
      const persisted = persistedProviderConfigs?.[providerId]
      const customContextTier =
        persisted?.customContextTier && contextTokensForTier(persisted.customContextTier)
          ? persisted.customContextTier
          : defaults.customContextTier ?? contextTierForTokens(defaults.contextWindowTokens)

      configs[providerId] = {
        ...defaults,
        ...persisted,
        id: defaults.id,
        type: defaults.type,
        label:
          defaults.type === 'custom' && persisted?.label?.trim()
            ? persisted.label
            : defaults.label,
        docsUrl: defaults.docsUrl,
        setupHint: defaults.setupHint,
        baseUrl:
          defaults.type === 'vendor_key'
            ? defaults.baseUrl
            : persisted?.baseUrl?.trim()
              ? persisted.baseUrl
              : defaults.baseUrl,
        modelName:
          defaults.type === 'vendor_key'
            ? persisted?.modelName?.trim() || defaults.modelName
            : persisted?.modelName?.trim()
              ? persisted.modelName
              : defaults.modelName,
        contextWindowTokens: defaults.contextWindowTokens,
        customContextTier,
      }

      return configs
    },
    {} as Record<ProviderId, LlmProviderConfig>,
  )
}

export function contextTierForTokens(tokens: number): CustomContextTier {
  if (tokens >= 1048576) {
    return '1m'
  }

  if (tokens >= 262144) {
    return '256k'
  }

  return '128k'
}

export function providerValidationSignature(provider: LlmProviderConfig) {
  return [
    provider.type,
    provider.baseUrl.trim(),
    provider.modelName.trim(),
    provider.apiKey.trim(),
    provider.customContextTier ?? '',
  ].join('|')
}

export function isProviderValidated(provider: LlmProviderConfig) {
  return (
    Boolean(provider.validatedAt) &&
    provider.lastValidatedSignature === providerValidationSignature(provider)
  )
}
