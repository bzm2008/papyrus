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
  const payload = await requestJson<Partial<DeviceResponse>>(`${AUTH_API}/device`, {
    method: 'POST',
  })

  if (!payload.deviceCode || !payload.verificationUrl) {
    throw new Error('无法创建 Scallion 登录设备码。')
  }

  return {
    deviceCode: payload.deviceCode,
    userCode: payload.userCode ?? '',
    verificationUrl: payload.verificationUrl,
    expiresIn: payload.expiresIn ?? 600,
    interval: payload.interval ?? 2,
  }
}

export async function pollLoginDevice(deviceCode: string) {
  return requestJson<PollResponse>(`${AUTH_API}/device/${encodeURIComponent(deviceCode)}`)
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
