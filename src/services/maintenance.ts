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

type NativeMaintenanceCommand =
  | 'health_check_backend'
  | 'check_sqlite_status'
  | 'test_model_connection'
  | 'get_memory_usage'
  | 'clear_global_memory'
  | 'rebuild_project_index'

type NativeMaintenanceStatus = MaintenanceProbeResult['status']

type ValidatedNativeMaintenancePayload = {
  status: NativeMaintenanceStatus
  latencyMs?: number
  bytes?: number
}

const MAX_NATIVE_LATENCY_MS = 120_000
const MAX_NATIVE_BYTES = 1_099_511_627_776
const invalidNumericField = Symbol('invalidNumericField')

const previewResults: Record<MaintenanceCheckId, MaintenanceProbeResult> = {
  tauri: {
    status: 'warning',
    message: '当前环境未执行桌面后端检测。',
  },
  sqlite: {
    status: 'warning',
    message: '当前环境未执行本地存储检测。',
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
    } catch {
      return {
        status: 'error',
        message: '浏览器预览模式下模型测试失败。',
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
    status: 'warning',
    message: '当前环境未执行本地记忆统计。',
  })
}

export async function clearGlobalMemory() {
  return invokeMaintenance('clear_global_memory', undefined, {
    status: 'warning',
    message: '当前环境未执行本地记忆清理。',
  })
}

export async function rebuildProjectIndex() {
  return invokeMaintenance('rebuild_project_index', undefined, {
    status: 'warning',
    message: '项目索引任务已加入预留队列，真实向量库接入后会执行重建。',
  })
}

async function invokeMaintenance(
  command: NativeMaintenanceCommand,
  args: Record<string, unknown> | undefined,
  fallback:
    | MaintenanceProbeResult
    | (() => Promise<MaintenanceProbeResult>)
    | (() => MaintenanceProbeResult),
) {
  if (!isTauriRuntime()) {
    try {
      return typeof fallback === 'function' ? await fallback() : fallback
    } catch {
      return maintenanceFailureResult(command)
    }
  }

  try {
    const payload = args
      ? await invoke<unknown>(command, args)
      : await invoke<unknown>(command)

    return normalizeNativePayload(payload, command)
  } catch {
    return maintenanceFailureResult(command)
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

function normalizeNativePayload(payload: unknown, command: NativeMaintenanceCommand): MaintenanceProbeResult {
  const validated = validateNativeMaintenancePayload(payload)
  if (!validated) {
    return maintenanceFailureResult(command)
  }

  if (command === 'get_memory_usage' && validated.status === 'ok' && typeof validated.bytes !== 'number') {
    return {
      status: 'warning',
      message: maintenanceFailureMessage(command),
      latencyMs: validated.latencyMs,
      bytes: undefined,
    }
  }

  return {
    status: validated.status,
    message: maintenanceResultMessage(command, validated.status),
    latencyMs: validated.latencyMs,
    bytes: validated.bytes,
  }
}

function isTauriRuntime() {
  return Boolean(
    typeof window !== 'undefined' &&
      (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  )
}

function validateNativeMaintenancePayload(payload: unknown): ValidatedNativeMaintenancePayload | null {
  if (!isRecord(payload) || !isNativeMaintenanceStatus(payload.status)) {
    return null
  }

  const latencyMs = readBoundedNumericField(payload, ['latencyMs', 'latency_ms'], MAX_NATIVE_LATENCY_MS)
  const bytes = readBoundedNumericField(payload, ['bytes'], MAX_NATIVE_BYTES)
  if (latencyMs === invalidNumericField || bytes === invalidNumericField) {
    return null
  }

  return {
    status: payload.status,
    latencyMs,
    bytes,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNativeMaintenanceStatus(value: unknown): value is NativeMaintenanceStatus {
  return value === 'ok' || value === 'warning' || value === 'error'
}

function readBoundedNumericField(
  payload: Record<string, unknown>,
  keys: string[],
  maximum: number,
): number | undefined | typeof invalidNumericField {
  const values = keys
    .filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
    .map((key) => payload[key])
    // Rust Option fields are serialized as JSON null when they are absent.
    .filter((value) => value !== null)
  if (!values.length) {
    return undefined
  }

  if (
    values.some((value) =>
      typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum,
    ) ||
    (values.length > 1 && values.some((value) => value !== values[0]))
  ) {
    return invalidNumericField
  }

  return values[0] as number
}

function maintenanceFailureResult(command: NativeMaintenanceCommand): MaintenanceProbeResult {
  return {
    status: 'error',
    message: maintenanceFailureMessage(command),
  }
}

function maintenanceResultMessage(command: NativeMaintenanceCommand, status: NativeMaintenanceStatus) {
  if (status !== 'ok') {
    return maintenanceFailureMessage(command)
  }

  switch (command) {
    case 'health_check_backend':
      return '桌面后端检测通过。'
    case 'check_sqlite_status':
      return '本地存储检测通过。'
    case 'test_model_connection':
      return '模型连通性检测通过。'
    case 'get_memory_usage':
      return '本地记忆统计完成。'
    case 'clear_global_memory':
      return '本地记忆已清理。'
    case 'rebuild_project_index':
      return '项目索引已重建。'
  }
}

function maintenanceFailureMessage(command: NativeMaintenanceCommand) {
  switch (command) {
    case 'health_check_backend':
      return '桌面后端检测未完成。'
    case 'check_sqlite_status':
      return '本地存储检测未完成。'
    case 'get_memory_usage':
      return '本地记忆统计未完成。'
    case 'clear_global_memory':
      return '本地记忆清理未完成。'
    case 'rebuild_project_index':
      return '项目索引重建未完成。'
    case 'test_model_connection':
      return '模型连通性测试未完成。'
    default:
      return '维护检查未完成。'
  }
}

function resolveMaintenanceApiKey(provider: LlmProviderConfig) {
  if (provider.type === 'scallion_proxy') {
    return useAppStore.getState().scallionToken?.trim() ?? ''
  }

  return provider.apiKey.trim()
}
