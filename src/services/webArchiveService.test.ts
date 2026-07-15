import { afterEach, describe, expect, it } from 'vitest'

import type { WebExtractResult } from './browserBridgeClient'
import {
  applyWebArchive,
  canonicalizeWebUrl,
  createWebArchivePreview,
} from './webArchiveService'
import { useAppStore } from '../stores/useAppStore'

const result = (overrides: Partial<WebExtractResult> = {}): WebExtractResult => ({
  url: 'https://example.com/article?utm_source=test&b=2&a=1#section',
  canonicalUrl: 'https://example.com/article?b=2&a=1',
  title: '原始标题',
  text: '第一段正文。\n\n第二段正文。',
  links: [],
  truncated: false,
  provenance: 'native',
  ...overrides,
})

afterEach(() => {
  useAppStore.setState({ resources: [] })
})

describe('web archive service', () => {
  it('normalizes URL identity without discarding meaningful query values', () => {
    expect(canonicalizeWebUrl('https://example.com/a?utm_campaign=x&b=2&a=1#part'))
      .toBe('https://example.com/a?a=1&b=2')
  })

  it('creates an html ImportedResource with source URL, canonical URL, tokens, and dedupe key', () => {
    const preview = createWebArchivePreview(result(), '研究资料')
    const applied = applyWebArchive(result(), preview)
    const resource = useAppStore.getState().resources[0]

    expect(applied).toMatchObject({ ok: true })
    expect(resource).toMatchObject({
      name: '研究资料',
      type: 'html',
      sourceUrl: result().url,
      canonicalUrl: 'https://example.com/article?a=1&b=2',
      dedupeKey: 'https://example.com/article?a=1&b=2',
      path: 'https://example.com/article?a=1&b=2',
      content: result().text,
      includedInContext: true,
    })
    expect(resource.tokenCount).toBeGreaterThan(0)
  })

  it('updates an existing resource when the canonical URL is archived again', () => {
    const first = result()
    const firstPreview = createWebArchivePreview(first, '旧标题')
    applyWebArchive(first, firstPreview)
    const originalId = useAppStore.getState().resources[0]?.id

    const second = result({
      url: 'https://example.com/article?utm_medium=email&a=1&b=2',
      canonicalUrl: 'https://example.com/article?a=1&b=2',
      title: '新标题',
      text: '更新后的正文。',
    })
    const secondPreview = createWebArchivePreview(second, '新标题')

    expect(secondPreview.replacingResourceId).toBe(originalId)
    applyWebArchive(second, secondPreview)

    const resources = useAppStore.getState().resources
    expect(resources).toHaveLength(1)
    expect(resources[0]).toMatchObject({ id: originalId, name: '新标题', content: '更新后的正文。' })
  })

  it('rejects applying a changed extraction after preview creation', () => {
    const preview = createWebArchivePreview(result())
    expect(() => applyWebArchive(result({ text: '正文被替换。' }), preview)).toThrow('正文已变化')
    expect(useAppStore.getState().resources).toHaveLength(0)
  })

  it('rejects archive previews without a native extraction provenance marker', () => {
    expect(() => createWebArchivePreview(result({ provenance: undefined }))).toThrow('已验证的网页提取结果')
  })

  it('uses a unique preview id for concurrent approvals of identical content', () => {
    const first = createWebArchivePreview(result())
    const second = createWebArchivePreview(result())
    expect(second.id).not.toBe(first.id)
  })

  it('rechecks the canonical key at apply time to avoid a duplicate resource', () => {
    const preview = createWebArchivePreview(result(), '待归档')
    useAppStore.setState({
      resources: [{
        id: 'arrived-during-approval',
        name: '已先到达',
        path: preview.canonicalUrl,
        type: 'html',
        content: '旧内容',
        tokenCount: 1,
        includedInContext: true,
        importedAt: Date.now(),
        canonicalUrl: preview.canonicalUrl,
        dedupeKey: preview.canonicalUrl,
      }],
    })

    const applied = applyWebArchive(result(), preview)
    expect(applied.summary).toContain('已更新')
    expect(useAppStore.getState().resources).toHaveLength(1)
    expect(useAppStore.getState().resources[0]).toMatchObject({ id: 'arrived-during-approval', content: result().text })
  })
})
