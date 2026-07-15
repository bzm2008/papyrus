import { describe, expect, it } from 'vitest'

import {
  decodeBrowserBridgeMessage,
  encodeBrowserBridgeMessage,
  type BrowserBridgeMessage,
} from './browserBridgeProtocol'

describe('browser bridge protocol', () => {
  it('round trips pair, request, and response frames', () => {
    const frames: BrowserBridgeMessage[] = [
      { type: 'pair', payload: { token: 't', nonce: 'n', extensionId: 'ext', tabId: 4, origin: 'https://example.com' } },
      { type: 'request', requestId: 'r1', action: 'snapshot', payload: {} },
      { type: 'response', requestId: 'r1', payload: { ok: true } },
    ]
    for (const frame of frames) expect(decodeBrowserBridgeMessage(encodeBrowserBridgeMessage(frame))).toEqual(frame)
  })

  it('rejects malformed and incomplete frames', () => {
    expect(decodeBrowserBridgeMessage('{')).toBeUndefined()
    expect(decodeBrowserBridgeMessage(JSON.stringify({ type: 'request', action: 'snapshot', payload: {} }))).toBeUndefined()
    expect(decodeBrowserBridgeMessage(JSON.stringify({ type: 'response', payload: {} }))).toBeUndefined()
  })
})

