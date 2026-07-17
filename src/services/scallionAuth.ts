import { invoke } from '@tauri-apps/api/core'
import { useAppStore, type ScallionUser } from '../stores/useAppStore'
import { refreshScallionRuntimeMetadata } from './scallionAccountService'

const SCALLION_API = 'https://scallion.uno/api/papyrus/auth'

type DeviceResponse = {
  deviceCode: string
  device_code?: string
  userCode: string
  user_code?: string
  verificationUrl: string
  verification_url?: string
  expiresIn: number
  expires_in?: number
  interval: number
}

type PollResponse = {
  status?: 'pending' | 'expired' | 'denied' | 'error' | 'approved'
  error?: string
  token?: string
  accessToken?: string
  access_token?: string
  user?: ScallionUser
  account?: ScallionUser
  data?: Partial<PollResponse>
}

export async function startScallionLogin() {
  const store = useAppStore.getState()
  store.setScallionAuthStatus('starting')

  try {
    const response = await fetch(`${SCALLION_API}/device`, { method: 'POST' })
    const payload = (await response.json().catch(() => ({}))) as Partial<DeviceResponse> & {
      data?: Partial<DeviceResponse>
    }
    const device = normalizeDeviceResponse(payload)

    if (!response.ok || !device?.deviceCode || !device.verificationUrl) {
      throw new Error('无法创建 Scallion 登录设备码')
    }

    store.setScallionDevice(device.deviceCode, device.userCode ?? '')
    await openExternalUrl(device.verificationUrl)
    pollScallionLogin(device.deviceCode, device.interval ?? 2)
  } catch (error) {
    store.setScallionAuthStatus('error')
    throw error instanceof Error ? error : new Error('无法创建 Scallion 登录设备码')
  }
}

export function pollScallionLogin(deviceCode: string, intervalSeconds = 2) {
  const store = useAppStore.getState()
  store.setScallionAuthStatus('polling')

  const startedAt = Date.now()
  let transientFailures = 0
  let nextDelay = Math.max(1, intervalSeconds) * 1000
  let stopped = false
  let timer: number | undefined

  const schedule = () => {
    if (stopped) {
      return
    }

    timer = window.setTimeout(tick, nextDelay)
  }

  const stop = () => {
    stopped = true
    if (timer !== undefined) {
      window.clearTimeout(timer)
    }
  }

  const tick = async () => {
    try {
      const response = await fetch(`${SCALLION_API}/device/${encodeURIComponent(deviceCode)}`)
      const payload = (await response.json().catch(() => ({}))) as PollResponse
      if (!response.ok) {
        throw new Error(`Scallion 授权轮询失败（HTTP ${response.status}）`)
      }
      const data = normalizePollResponse(payload)
      transientFailures = 0
      nextDelay = Math.max(1, intervalSeconds) * 1000

      if (data.status === 'pending') {
        if (Date.now() - startedAt > 10 * 60 * 1000) {
          stop()
          useAppStore.getState().setScallionAuthStatus('expired')
        }
        schedule()
        return
      }

      stop()

      const token = data.token ?? data.accessToken ?? data.access_token
      const user = normalizeScallionUser(data.user ?? data.account)

      if (data.status === 'approved' && token) {
        useAppStore.getState().setScallionSession(token, user)
        void refreshScallionRuntimeMetadata()
        return
      }

      useAppStore.getState().setScallionAuthStatus(data.status === 'denied' ? 'denied' : 'expired')
    } catch {
      transientFailures += 1

      if (Date.now() - startedAt > 10 * 60 * 1000) {
        stop()
        useAppStore.getState().setScallionAuthStatus('expired')
        return
      }

      if (transientFailures >= 8) {
        stop()
        useAppStore.getState().setScallionAuthStatus('error')
        return
      }

      useAppStore.getState().setScallionAuthStatus('reconnecting')
      nextDelay = Math.min(12000, Math.max(1200, nextDelay * 1.45))
      schedule()
    }
  }

  schedule()
}

export function logoutScallion() {
  useAppStore.getState().clearScallionSession()
}

async function openExternalUrl(url: string) {
  try {
    await invoke('open_external_url', { url })
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

function normalizeDeviceResponse(payload: Partial<DeviceResponse> & { data?: Partial<DeviceResponse> }) {
  const source = payload.data ?? payload
  const deviceCode = source.deviceCode ?? source.device_code
  const verificationUrl = source.verificationUrl ?? source.verification_url

  if (!deviceCode || !verificationUrl) {
    return undefined
  }

  return {
    deviceCode,
    userCode: source.userCode ?? source.user_code ?? '',
    verificationUrl,
    expiresIn: source.expiresIn ?? source.expires_in ?? 600,
    interval: source.interval ?? 2,
  }
}

function normalizePollResponse(payload: PollResponse): PollResponse {
  return payload.data ? { ...payload, ...payload.data } : payload
}

function normalizeScallionUser(user?: ScallionUser): ScallionUser {
  if (!user) {
    return { id: 'scallion', username: 'Scallion 用户' }
  }

  const source = user as ScallionUser & { name?: string; email?: string }

  return {
    ...user,
    id: source.id ?? 'scallion',
    username: source.username || source.name || source.email || 'Scallion 用户',
  }
}
