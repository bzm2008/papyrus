import { invoke } from '@tauri-apps/api/core'

export type WebSearchResult = {
  title: string
  url: string
  excerpt: string
}

const SEARCH_PROXY_ENDPOINT = 'https://scallion.uno/api/papyrus/search'

export async function searchWeb(query: string) {
  const normalized = query.trim()

  if (!normalized) {
    return []
  }

  try {
    return await invoke<WebSearchResult[]>('web_search', { query: normalized })
  } catch (tauriError) {
    const proxyResults = await searchViaScallionProxy(normalized)

    if (proxyResults.length) {
      return proxyResults
    }

    throw tauriError instanceof Error
      ? tauriError
      : new Error('联网搜索暂不可用，且代理没有返回可用结果。')
  }
}

async function searchViaScallionProxy(query: string) {
  const response = await fetch(`${SEARCH_PROXY_ENDPOINT}?q=${encodeURIComponent(query)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })
  const payload = (await response.json().catch(() => ({}))) as
    | WebSearchResult[]
    | { results?: WebSearchResult[]; error?: string }

  if (!response.ok) {
    const message = Array.isArray(payload) ? '' : payload.error
    throw new Error(message || `搜索代理请求失败：HTTP ${response.status}`)
  }

  return Array.isArray(payload) ? payload : (payload.results ?? [])
}
