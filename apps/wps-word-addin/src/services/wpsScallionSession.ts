import type { ScallionSession, ScallionUser } from '../types'

const AUTH_API = 'https://scallion.uno/api/papyrus/auth'
const STORAGE_KEY = 'papyrus.wps.scallion.session'

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

export type PollResponse = {
  status?: 'pending' | 'expired' | 'denied' | 'error' | 'approved'
  error?: string
  token?: string
  accessToken?: string
  access_token?: string
  user?: ScallionUser
  account?: ScallionUser
  data?: Partial<PollResponse>
}

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
  const payload = await requestJson<Partial<DeviceResponse> & { data?: Partial<DeviceResponse> }>(`${AUTH_API}/device`, {
    method: 'POST',
  })
  const device = normalizeDeviceResponse(payload)

  if (!device) {
    throw new Error('无法创建 Scallion 登录设备码。')
  }

  return device
}

export async function pollLoginDevice(deviceCode: string) {
  const payload = await requestJson<PollResponse>(`${AUTH_API}/device/${encodeURIComponent(deviceCode)}`)
  return normalizePollResponse(payload)
}

export function sessionFromPollResponse(payload: PollResponse): ScallionSession | undefined {
  if (payload.status !== 'approved') {
    return undefined
  }

  const token = payload.token ?? payload.accessToken ?? payload.access_token

  if (!token) {
    return undefined
  }

  return {
    token,
    user: normalizeScallionUser(payload.user ?? payload.account),
  }
}

async function requestJson<T>(url: string, options: { method?: string } = {}): Promise<T> {
  if (typeof fetch === 'function') {
    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
        },
      })
      const payload = (await response.json().catch(() => ({}))) as T

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      return payload
    } catch (error) {
      if (typeof XMLHttpRequest !== 'function') {
        throw networkError(error)
      }
    }
  }

  try {
    return await requestJsonWithXhr<T>(url, options.method ?? 'GET')
  } catch (error) {
    throw networkError(error)
  }
}

function requestJsonWithXhr<T>(url: string, method: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url, true)
    xhr.timeout = 12000
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) {
        return
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`HTTP ${xhr.status || 'network error'}`))
        return
      }

      try {
        resolve(JSON.parse(xhr.responseText || '{}') as T)
      } catch {
        reject(new Error('Scallion 返回了不可解析的授权响应。'))
      }
    }
    xhr.onerror = () => reject(new Error('HTTP network error'))
    xhr.ontimeout = () => reject(new Error('HTTP request timeout'))
    xhr.send()
  })
}

function networkError(error: unknown) {
  const message = error instanceof Error ? error.message : ''

  if (/network|failed to fetch|timeout/i.test(message)) {
    return new Error('无法连接 Scallion。WPS 当前可能被跨域策略拦截，我会改用服务器放行后再试。')
  }

  return error instanceof Error ? error : new Error('Scallion 授权请求失败。')
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
