import { invoke } from '@tauri-apps/api/core'
import { useAppStore, type ScallionUser } from '../stores/useAppStore'
import { refreshScallionRuntimeMetadata } from './scallionAccountService'

const SCALLION_API = 'https://scallion.uno/api/papyrus/auth'

type DeviceResponse = {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

type PollResponse =
  | {
      status?: 'pending' | 'expired' | 'denied' | 'error' | 'approved'
      error?: string
      token?: string
      accessToken?: string
      access_token?: string
      user?: ScallionUser
      account?: ScallionUser
    }

export async function startScallionLogin() {
  const store = useAppStore.getState()
  store.setScallionAuthStatus('starting')

  const response = await fetch(`${SCALLION_API}/device`, { method: 'POST' })
  const device = (await response.json().catch(() => ({}))) as Partial<DeviceResponse>

  if (!response.ok || !device.deviceCode || !device.verificationUrl) {
    store.setScallionAuthStatus('error')
    throw new Error('无法创建 Scallion 登录设备码')
  }

  store.setScallionDevice(device.deviceCode, device.userCode ?? '')
  await openExternalUrl(device.verificationUrl)
  pollScallionLogin(device.deviceCode, device.interval ?? 2)
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
      const data = (await response.json().catch(() => ({}))) as PollResponse
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
      const user = data.user ?? data.account

      if (data.status === 'approved' && token && user) {
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
