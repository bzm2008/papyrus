import type { ScallionSession, ScallionUser } from '../types'

const AUTH_API = 'https://scallion.uno/api/papyrus/auth'
const STORAGE_KEY = 'papyrus.wps.scallion.session'

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

export type LoginDevice = DeviceResponse

export function loadStoredSession(): ScallionSession | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return undefined
    }

    const parsed = JSON.parse(raw) as ScallionSession
    return parsed.token && parsed.user ? parsed : undefined
  } catch {
    return undefined
  }
}

export function saveSession(session: ScallionSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY)
}

export async function createLoginDevice() {
  const response = await fetch(`${AUTH_API}/device`, { method: 'POST' })
  const device = (await response.json().catch(() => ({}))) as Partial<DeviceResponse>

  if (!response.ok || !device.deviceCode || !device.verificationUrl) {
    throw new Error('无法创建 Scallion 登录设备码。')
  }

  return {
    deviceCode: device.deviceCode,
    userCode: device.userCode ?? '',
    verificationUrl: device.verificationUrl,
    expiresIn: device.expiresIn ?? 600,
    interval: device.interval ?? 2,
  }
}

export async function pollLoginDevice(deviceCode: string) {
  const response = await fetch(`${AUTH_API}/device/${encodeURIComponent(deviceCode)}`)
  const payload = (await response.json().catch(() => ({}))) as PollResponse

  if (!response.ok) {
    throw new Error('Scallion 授权轮询失败。')
  }

  return payload
}
