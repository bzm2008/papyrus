import { useAppStore, type ImportedResource } from '../stores/useAppStore'
import type { WebExtractResult } from './browserBridgeClient'
import type { AssistantToolPreview, AssistantToolResult } from './workAssistantProtocol'
import { estimateTokens } from './tokenizer'

const MAX_ARCHIVE_CHARS = 100_000

export type WebArchivePreview = AssistantToolPreview & {
  resourceName: string
  canonicalUrl: string
  characterCount: number
  replacingResourceId?: string
}

function fallbackId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Normalize URL identity without dropping meaningful query parameters. The
 * extractor's explicit canonical URL wins, while this fallback still removes
 * credentials, fragments, default ports, and tracking-only query fields.
 */
export function canonicalizeWebUrl(input: string) {
  const parsed = new URL(input)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('网页归档只支持 HTTP(S) 地址。')
  }
  parsed.username = ''
  parsed.password = ''
  parsed.hash = ''

  const trackingKeys = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid'])
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || trackingKeys.has(key.toLowerCase())) {
      parsed.searchParams.delete(key)
    }
  }

  const sortedQuery = [...parsed.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right))
  parsed.search = ''
  for (const [key, value] of sortedQuery) parsed.searchParams.append(key, value)

  // URL already removes the default port. Keep a root slash so equivalent
  // origins do not produce two resources.
  if (!parsed.pathname) parsed.pathname = '/'
  return parsed.toString()
}

function safeText(value: unknown, max: number) {
  return typeof value === 'string'
    ? value.split('\u0000').join('').trim().slice(0, max)
    : ''
}

function stableHash(value: string) {
  // FNV-1a is deterministic across browsers and sufficient for an opaque
  // local preview revision; it is not used as a security credential.
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function archiveRevision(canonicalUrl: string, text: string) {
  return `web-archive:${stableHash(`${canonicalUrl}\n${text}`)}`
}

function normalizedResult(result: WebExtractResult) {
  if (result.provenance !== 'native') {
    throw new Error('网页归档必须使用已验证的网页提取结果。')
  }
  const sourceUrl = safeText(result.url, 2_048)
  const candidate = safeText(result.canonicalUrl, 2_048) || sourceUrl
  const canonicalUrl = canonicalizeWebUrl(candidate)
  const text = safeText(result.text, MAX_ARCHIVE_CHARS)
  if (!sourceUrl || !text) throw new Error('网页正文为空，无法归档。')
  return {
    sourceUrl,
    canonicalUrl,
    text,
    title: safeText(result.title, 240),
  }
}

function resourceKey(resource: ImportedResource) {
  return resource.dedupeKey ?? resource.canonicalUrl ?? resource.path
}

export function createWebArchivePreview(
  result: WebExtractResult,
  resourceName?: string,
  at = Date.now(),
): WebArchivePreview {
  const normalized = normalizedResult(result)
  const existing = useAppStore.getState().resources.find(
    (resource) => resourceKey(resource) === normalized.canonicalUrl,
  )
  const name = safeText(resourceName, 240) || normalized.title || new URL(normalized.canonicalUrl).hostname
  const revision = archiveRevision(normalized.canonicalUrl, normalized.text)

  return {
    id: fallbackId('web-archive-preview'),
    revision,
    risk: 'reversible',
    title: existing ? `更新网页资料：${name}` : `归档网页资料：${name}`,
    targetSummary: normalized.canonicalUrl,
    impactSummary: existing
      ? `将更新现有项目资源《${existing.name}》，正文 ${normalized.text.length.toLocaleString()} 字。`
      : `将在当前项目新增 HTML 资源《${name}》，正文 ${normalized.text.length.toLocaleString()} 字。`,
    reversible: true,
    expiresAt: at + 5 * 60_000,
    resourceName: name,
    canonicalUrl: normalized.canonicalUrl,
    characterCount: normalized.text.length,
    replacingResourceId: existing?.id,
  }
}

export function toImportedWebResource(
  result: WebExtractResult,
  preview: WebArchivePreview,
  importedAt = Date.now(),
): ImportedResource {
  const normalized = normalizedResult(result)
  if (normalized.canonicalUrl !== preview.canonicalUrl) {
    throw new Error('网页地址已变化，请重新生成归档预览。')
  }
  if (normalized.text.length !== preview.characterCount || archiveRevision(normalized.canonicalUrl, normalized.text) !== preview.revision) {
    throw new Error('网页正文已变化，请重新生成归档预览。')
  }

  return {
    id: preview.replacingResourceId ?? fallbackId('web-resource'),
    name: preview.resourceName || normalized.title || new URL(normalized.canonicalUrl).hostname,
    path: normalized.canonicalUrl,
    type: 'html',
    content: normalized.text,
    tokenCount: estimateTokens(normalized.text),
    includedInContext: true,
    importedAt,
    sourceUrl: normalized.sourceUrl,
    canonicalUrl: normalized.canonicalUrl,
    dedupeKey: normalized.canonicalUrl,
  }
}

export function applyWebArchive(
  result: WebExtractResult,
  preview: WebArchivePreview,
): AssistantToolResult {
  if (preview.expiresAt <= Date.now()) {
    throw Object.assign(new Error('网页归档预览已过期，请重新提取。'), { code: 'stale_preview', recoverable: true })
  }

  const store = useAppStore.getState()
  const matchingResource = store.resources.find(
    (item) => resourceKey(item) === preview.canonicalUrl,
  )
  const effectivePreview = preview.replacingResourceId || !matchingResource
    ? preview
    : { ...preview, replacingResourceId: matchingResource.id }

  const resource = toImportedWebResource(result, effectivePreview)
  if (preview.replacingResourceId) {
    const existing = store.resources.find((item) => item.id === preview.replacingResourceId)
    if (!existing || resourceKey(existing) !== preview.canonicalUrl) {
      throw Object.assign(new Error('待更新的项目资源已变化，请重新生成归档预览。'), { code: 'stale_preview', recoverable: true })
    }
    store.updateResource(preview.replacingResourceId, resource)
  } else if (matchingResource) {
    store.updateResource(matchingResource.id, resource)
  } else {
    store.addResources([resource])
  }

  return {
    ok: true,
    summary: `${effectivePreview.replacingResourceId ? '已更新' : '已归档'}《${resource.name}》`,
    data: {
      resourceId: resource.id,
      name: resource.name,
      sourceUrl: resource.sourceUrl,
      canonicalUrl: resource.canonicalUrl,
      tokenCount: resource.tokenCount,
      characterCount: preview.characterCount,
    },
  }
}
