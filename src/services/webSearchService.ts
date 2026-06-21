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

  const errors: string[] = []

  try {
    return await retrySearch(() => invoke<WebSearchResult[]>('web_search', { query: normalized }))
  } catch (tauriError) {
    errors.push(errorMessage(tauriError, '本机搜索失败'))
  }

  try {
    const proxyResults = await retrySearch(() => searchViaScallionProxy(normalized))

    if (proxyResults.length) {
      return proxyResults
    }
    errors.push('主站搜索代理没有返回可用结果')
  } catch (proxyError) {
    errors.push(errorMessage(proxyError, '主站搜索代理失败'))
  }

  throw new Error(`联网搜索暂不可用：${errors.join('；')}`)
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

async function retrySearch<T>(run: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await delay(500 * attempt)
      }
    }
  }

  throw lastError
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
