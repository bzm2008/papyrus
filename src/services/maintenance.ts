import { invoke } from '@tauri-apps/api/core'
import { callOpenAICompatible, canCallProvider } from './llmClient'
import type {
  LlmProviderConfig,
  MaintenanceCheckId,
  MaintenanceCheckStatus,
} from '../stores/useAppStore'
import { useAppStore } from '../stores/useAppStore'

export type MaintenanceProbeResult = {
  status: Exclude<MaintenanceCheckStatus, 'idle' | 'checking'>
  message: string
  latencyMs?: number
  bytes?: number
}

type NativeMaintenancePayload = {
  status?: MaintenanceProbeResult['status']
  message?: string
  latencyMs?: number
  latency_ms?: number
  bytes?: number
}

const previewResults: Record<MaintenanceCheckId, MaintenanceProbeResult> = {
  tauri: {
    status: 'ok',
    message: '浏览器预览模式：已使用前端降级检查。',
    latencyMs: 0,
  },
  sqlite: {
    status: 'ok',
    message: '浏览器预览模式：本地存储由桌面端接管。',
  },
  llm: {
    status: 'warning',
    message: '浏览器预览模式：已跳过真实模型延迟测试。',
  },
}

export async function checkBackendCommunication() {
  return invokeMaintenance('health_check_backend', undefined, previewResults.tauri)
}

export async function checkSqliteStatus() {
  return invokeMaintenance('check_sqlite_status', undefined, previewResults.sqlite)
}

export async function checkDefaultModelLatency(provider: LlmProviderConfig) {
  if (!canCallProvider(provider)) {
    return {
      status: 'error',
      message: '当前模型配置不完整，请先填写 Base URL、模型名称和 API Key。',
    } satisfies MaintenanceProbeResult
  }

  if (!isTauriRuntime()) {
    try {
      return await testModelConnectionInBrowser(provider)
    } catch (error) {
      return {
        status: 'error',
        message: errorToMessage(error, '浏览器预览模式下模型测试失败。'),
      } satisfies MaintenanceProbeResult
    }
  }

  return testModelConnection(provider)
}

export async function testModelConnection(provider: LlmProviderConfig) {
  if (!canCallProvider(provider)) {
    return {
      status: 'error',
      message: '请先填写 Base URL、模型名称和 API Key。本地 OpenAI-compatible 服务可留空 API Key。',
    } satisfies MaintenanceProbeResult
  }

  return invokeMaintenance(
    'test_model_connection',
    {
      request: {
        baseUrl: provider.baseUrl,
        modelName: provider.modelName,
        apiKey: resolveMaintenanceApiKey(provider),
        providerType: provider.type,
      },
    },
    async () => testModelConnectionInBrowser(provider),
  )
}

export async function getMemoryUsage() {
  return invokeMaintenance('get_memory_usage', undefined, {
    status: 'ok',
    message: '浏览器预览模式：记忆目录将在桌面端统计。',
    bytes: 0,
  })
}

export async function clearGlobalMemory() {
  return invokeMaintenance('clear_global_memory', undefined, {
    status: 'ok',
    message: '浏览器预览模式：已跳过真实清理。',
    bytes: 0,
  })
}

export async function rebuildProjectIndex() {
  return invokeMaintenance('rebuild_project_index', undefined, {
    status: 'warning',
    message: '项目索引任务已加入预留队列，真实向量库接入后会执行重建。',
  })
}

async function invokeMaintenance(
  command: string,
  args: Record<string, unknown> | undefined,
  fallback:
    | MaintenanceProbeResult
    | (() => Promise<MaintenanceProbeResult>)
    | (() => MaintenanceProbeResult),
) {
  try {
    const payload = args
      ? await invoke<NativeMaintenancePayload>(command, args)
      : await invoke<NativeMaintenancePayload>(command)

    return normalizeNativePayload(payload)
  } catch (error) {
    if (!isTauriRuntime()) {
      return typeof fallback === 'function' ? await fallback() : fallback
    }

    return {
      status: 'error',
      message: errorToMessage(error, `${command} 执行失败。`),
    } satisfies MaintenanceProbeResult
  }
}

async function testModelConnectionInBrowser(provider: LlmProviderConfig) {
  const startedAt = performance.now()
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 15_000)

  try {
    await callOpenAICompatible(
      provider,
      [
        {
          role: 'system',
          content: 'You are a connectivity checker. Reply with exactly: OK',
        },
        { role: 'user', content: 'OK' },
      ],
      controller.signal,
      { temperature: 0, maxTokens: 8 },
    )
  } finally {
    globalThis.clearTimeout(timeoutId)
  }

  return {
    status: 'ok',
    message: '模型连通性检测通过。',
    latencyMs: Math.round(performance.now() - startedAt),
  } satisfies MaintenanceProbeResult
}

function normalizeNativePayload(payload: NativeMaintenancePayload): MaintenanceProbeResult {
  return {
    status: payload.status ?? 'warning',
    message: payload.message ?? '检测已完成。',
    latencyMs: payload.latencyMs ?? payload.latency_ms,
    bytes: payload.bytes,
  }
}

function isTauriRuntime() {
  return Boolean(
    typeof window !== 'undefined' &&
      (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  )
}

function errorToMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return fallback
}

function resolveMaintenanceApiKey(provider: LlmProviderConfig) {
  if (provider.type === 'scallion_proxy') {
    return useAppStore.getState().scallionToken?.trim() ?? ''
  }

  return provider.apiKey.trim()
}
