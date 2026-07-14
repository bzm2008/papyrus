import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  extractPublicWebPage,
  resetWebExtractInvokerForTests,
  setWebExtractInvokerForTests,
  WebExtractError,
} from './webExtractService'

afterEach(() => resetWebExtractInvokerForTests())

describe('web extract service', () => {
  it('passes run id and preserves typed extraction metadata', async () => {
    setWebExtractInvokerForTests(vi.fn(async (command, args) => {
      expect(command).toBe('work_assistant_web_extract')
      expect(args).toEqual({ url: 'https://example.com/article', runId: 'run-1' })
      return { url: 'https://example.com/article', title: 'Example', text: '正文', excerpt: '正文', language: 'zh', links: [], truncated: false }
    }))

    await expect(extractPublicWebPage('https://example.com/article', 'run-1')).resolves.toMatchObject({
      title: 'Example',
      excerpt: '正文',
      language: 'zh',
    })
  })

  it('cancels the native run and rejects promptly', async () => {
    const invoke = vi.fn((command: string) => command === 'work_assistant_cancel_run'
      ? Promise.resolve(undefined)
      : new Promise(() => undefined))
    setWebExtractInvokerForTests(invoke)
    const controller = new AbortController()
    const promise = extractPublicWebPage('https://example.com', 'run-2', controller.signal)
    controller.abort()

    await expect(promise).rejects.toMatchObject({ code: 'user_cancelled', recoverable: true })
    expect(invoke).toHaveBeenCalledWith('work_assistant_cancel_run', { run: 'run-2' })
  })

  it.each([
    ['blocked', '网页地址被阻止', 'blocked'],
    ['timeout', 'request timed out', 'timeout'],
    ['unsupported_content_type', 'unsupported content type', 'unsupported_content_type'],
    ['response_too_large', 'response too large', 'response_too_large'],
  ] as const)('maps %s errors to recoverable metadata', async (code, message, expected) => {
    setWebExtractInvokerForTests(async () => { throw { code, message } })
    await expect(extractPublicWebPage('https://example.com', 'run-3')).rejects.toMatchObject({
      code: expected,
      name: 'WebExtractError',
    })
  })

  it('rejects an empty URL before invoking native code', async () => {
    const invoke = vi.fn()
    setWebExtractInvokerForTests(invoke)
    await expect(extractPublicWebPage('  ', 'run-4')).rejects.toBeInstanceOf(WebExtractError)
    expect(invoke).not.toHaveBeenCalled()
  })
})

