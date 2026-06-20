import { useAppStore, type HardwareCapabilityProfile } from '../stores/useAppStore'

type NavigatorWithMemory = Navigator & {
  deviceMemory?: number
}

type PerformanceWithMemory = Performance & {
  memory?: {
    jsHeapSizeLimit?: number
    totalJSHeapSize?: number
    usedJSHeapSize?: number
  }
}

export function detectHardwareCapabilityProfile(): HardwareCapabilityProfile {
  const now = Date.now()
  const nav = typeof navigator !== 'undefined' ? (navigator as NavigatorWithMemory) : undefined
  const perf = typeof performance !== 'undefined' ? (performance as PerformanceWithMemory) : undefined
  const cpuCores = Math.max(1, Math.round(nav?.hardwareConcurrency ?? 4))
  const deviceMemoryGb = normalizeMemoryGb(nav?.deviceMemory ?? estimateMemoryFromHeap(perf))
  const gpuLabel = detectGpuLabel()
  const tier = classifyHardwareTier(cpuCores, deviceMemoryGb, gpuLabel)
  const limits = limitsForTier(tier)

  return {
    cpuCores,
    memoryGb: deviceMemoryGb,
    gpuLabel,
    tier,
    maxHiveAgents: limits.maxHiveAgents,
    maxHiveParallelAgents: limits.maxHiveParallelAgents,
    reason: buildHardwareReason(tier, cpuCores, deviceMemoryGb, gpuLabel),
    updatedAt: now,
  }
}

export function refreshHardwareCapabilityProfile() {
  const profile = detectHardwareCapabilityProfile()
  useAppStore.getState().setHardwareCapabilityProfile(profile)
  return profile
}

function estimateMemoryFromHeap(perf?: PerformanceWithMemory) {
  const heapLimit = perf?.memory?.jsHeapSizeLimit

  if (!heapLimit || !Number.isFinite(heapLimit)) {
    return undefined
  }

  const heapGb = heapLimit / 1024 / 1024 / 1024
  if (heapGb >= 3.5) return 16
  if (heapGb >= 2) return 8
  return 4
}

function normalizeMemoryGb(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return undefined
  }

  return Math.max(1, Math.round(value * 10) / 10)
}

function detectGpuLabel() {
  if (typeof document === 'undefined') {
    return '未检测到 GPU 信息'
  }

  try {
    const canvas = document.createElement('canvas')
    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)

    if (!gl) {
      return '浏览器未暴露 WebGL'
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
    if (!debugInfo) {
      return 'GPU 已检测，型号未暴露'
    }

    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    return typeof renderer === 'string' && renderer.trim() ? renderer.trim() : 'GPU 已检测，型号未暴露'
  } catch {
    return 'GPU 检测不可用'
  }
}

function classifyHardwareTier(
  cpuCores: number,
  memoryGb?: number,
  gpuLabel?: string,
): HardwareCapabilityProfile['tier'] {
  const gpu = (gpuLabel ?? '').toLowerCase()
  const hasDiscreteGpu = /nvidia|geforce|rtx|gtx|radeon|rx |arc/.test(gpu)
  const hasHighEndGpu = /rtx 40|rtx 50|4090|4080|4070|5090|5080|7900|7800|arc b/.test(gpu)

  if (cpuCores >= 16 && (memoryGb ?? 0) >= 32 && hasHighEndGpu) {
    return 'ultra'
  }

  if (cpuCores >= 10 && (memoryGb ?? 12) >= 16 && hasDiscreteGpu) {
    return 'high'
  }

  if (cpuCores >= 6 && (memoryGb ?? 8) >= 8) {
    return 'medium'
  }

  return 'low'
}

function limitsForTier(tier: HardwareCapabilityProfile['tier']) {
  if (tier === 'ultra') {
    return { maxHiveAgents: 12, maxHiveParallelAgents: 4 }
  }

  if (tier === 'high') {
    return { maxHiveAgents: 9, maxHiveParallelAgents: 3 }
  }

  if (tier === 'medium') {
    return { maxHiveAgents: 6, maxHiveParallelAgents: 2 }
  }

  return { maxHiveAgents: 4, maxHiveParallelAgents: 1 }
}

function buildHardwareReason(
  tier: HardwareCapabilityProfile['tier'],
  cpuCores: number,
  memoryGb?: number,
  gpuLabel?: string,
) {
  const memory = memoryGb ? `${memoryGb}GB 内存线索` : '内存信息未暴露'
  const gpu = gpuLabel && !gpuLabel.includes('未检测') ? `，${gpuLabel}` : ''

  return `本机画像为 ${tier}：${cpuCores} 核 CPU、${memory}${gpu}。蜂巢模式会按此限制最大 Agent 数和并行数，避免本机资源被打满。`
}
