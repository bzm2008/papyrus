import { invoke } from '@tauri-apps/api/core'
import { useAppStore, type ScallionUser } from '../stores/useAppStore'

const SCALLION_API = 'https://scallion.uno/api/papyrus/auth'

type DeviceResponse = {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

type PollResponse =
  | { status: 'pending' | 'expired' | 'denied' | 'error'; error?: string }
  | { status: 'approved'; token: string; user: ScallionUser }

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
  const timer = window.setInterval(async () => {
    try {
      const response = await fetch(`${SCALLION_API}/device/${encodeURIComponent(deviceCode)}`)
      const data = (await response.json().catch(() => ({}))) as PollResponse

      if (data.status === 'pending') {
        if (Date.now() - startedAt > 10 * 60 * 1000) {
          window.clearInterval(timer)
          useAppStore.getState().setScallionAuthStatus('expired')
        }
        return
      }

      window.clearInterval(timer)

      if (data.status === 'approved') {
        useAppStore.getState().setScallionSession(data.token, data.user)
        return
      }

      useAppStore.getState().setScallionAuthStatus(data.status === 'denied' ? 'denied' : 'expired')
    } catch {
      window.clearInterval(timer)
      useAppStore.getState().setScallionAuthStatus('error')
    }
  }, Math.max(1, intervalSeconds) * 1000)
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
