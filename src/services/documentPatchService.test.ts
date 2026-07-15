import { describe, expect, it } from 'vitest'

import { resolveDocumentWriteIntent, shouldCreateDocumentPatch } from './documentPatchService'

describe('document patch intent', () => {
  it.each([
    '审阅这篇文章，列出结构和事实问题',
    '请检查正文并给出问题清单',
    'review the manuscript and explain the issues',
  ])('does not create a patch for review-only requests: %s', (prompt) => {
    expect(shouldCreateDocumentPatch(prompt)).toBe(false)
  })

  it('still creates a patch when the user explicitly asks for a rewrite', () => {
    expect(shouldCreateDocumentPatch('审阅这篇文章后重写正文')).toBe(true)
  })

  it('keeps explicit writing requests that mention an article writable', () => {
    expect(shouldCreateDocumentPatch('写一篇文章并放进文稿')).toBe(true)
  })

  it('does not let a model write intent override review-only safety', () => {
    expect(resolveDocumentWriteIntent('审阅这篇正文并列出问题', true)).toBe(false)
    expect(resolveDocumentWriteIntent('写一篇文章', false)).toBe(true)
  })
})
