import fs from 'node:fs'
import path from 'node:path'
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

  it('round trips the shared extension protocol fixtures on the app side', () => {
    const fixtureDir = path.resolve(process.cwd(), 'apps/browser-bridge/test-fixtures/protocol')
    for (const file of ['pair.json', 'snapshot.json', 'action-request.json', 'action-response.json']) {
      const raw = fs.readFileSync(path.join(fixtureDir, file), 'utf8')
      const decoded = decodeBrowserBridgeMessage(raw)
      expect(decoded).toBeDefined()
      expect(decodeBrowserBridgeMessage(encodeBrowserBridgeMessage(decoded!))).toEqual(decoded)
    }
  })
})

