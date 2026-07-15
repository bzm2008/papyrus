import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getStatus = vi.hoisted(() => vi.fn())
vi.mock('../services/browserBridgeClient', () => ({
  getBrowserBridgeStatus: getStatus,
  startBrowserBridgePairing: vi.fn(),
  disconnectBrowserBridge: vi.fn(),
  deriveBrowserBridgeState: (status: { running: boolean; paired: boolean; sessionId?: string }) =>
    status.paired ? 'connected' : status.running && status.sessionId ? 'pairing' : status.running ? 'listening' : 'disabled',
}))

import { BrowserBridgeSettings } from './BrowserBridgeSettings'

describe('BrowserBridgeSettings', () => {
  beforeEach(() => getStatus.mockReset())

  it('shows the disconnected health state', async () => {
    getStatus.mockResolvedValue({ running: false, paired: false })
    render(<BrowserBridgeSettings />)
    await waitFor(() => expect(getStatus).toHaveBeenCalled())
    expect(screen.getByText('未启动')).toBeInTheDocument()
    expect(screen.getByText(/仅监听 127.0.0.1/)).toBeInTheDocument()
    expect(screen.getByText(/扩展目录：dist-browser-bridge/)).toBeInTheDocument()
  })

  it('shows the connected tab and hides pairing secrets after pairing', async () => {
    getStatus.mockResolvedValue({ running: true, paired: true, sessionId: 'session-1', tabId: 7, origin: 'https://example.com' })
    render(<BrowserBridgeSettings />)
    await waitFor(() => expect(screen.getByText('已连接')).toBeInTheDocument())
    expect(screen.getByText('当前标签页：7')).toBeInTheDocument()
    expect(screen.getByText('来源：https://example.com')).toBeInTheDocument()
    expect(screen.queryByText(/Token：/)).not.toBeInTheDocument()
  })
})
