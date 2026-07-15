import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  snapshot: vi.fn(),
  startPairing: vi.fn(),
  disconnect: vi.fn(),
}))

vi.mock('../services/browserBridgeClient', () => ({
  getBrowserBridgeStatus: mocks.getStatus,
  browserSnapshot: mocks.snapshot,
  startBrowserBridgePairing: mocks.startPairing,
  disconnectBrowserBridge: mocks.disconnect,
  deriveBrowserBridgeState: (status: { running: boolean; paired: boolean; sessionId?: string; error?: string }) =>
    status.error ? 'error' : status.paired ? 'connected' : status.running && status.sessionId ? 'pairing' : status.running ? 'listening' : 'disabled',
}))

import { SecretaryBrowserWorkbench } from './SecretaryBrowserWorkbench'

describe('SecretaryBrowserWorkbench', () => {
  beforeEach(() => {
    mocks.getStatus.mockReset()
    mocks.snapshot.mockReset()
    mocks.startPairing.mockReset()
    mocks.disconnect.mockReset()
  })

  it('renders the disconnected state without exposing raw page data', async () => {
    mocks.getStatus.mockResolvedValue({ running: false, paired: false })
    render(<SecretaryBrowserWorkbench />)
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalled())
    expect(screen.getByText('未启动')).toBeInTheDocument()
    expect(screen.getByText(/配对后可查看/)).toBeInTheDocument()
  })

  it('renders a restricted snapshot as a bounded warning', async () => {
    mocks.getStatus.mockResolvedValue({ running: true, paired: true, origin: 'https://example.com' })
    mocks.snapshot.mockResolvedValue({
      url: 'https://example.com/security',
      title: 'Account security',
      text: 'bounded summary',
      elements: [],
      sensitive: true,
      sensitiveReason: '检测到账号安全内容',
      pageRevision: 'r1',
    })
    render(<SecretaryBrowserWorkbench />)
    await waitFor(() => expect(screen.getByText('已连接')).toBeInTheDocument())
    expect(screen.getByText('检测到账号安全内容')).toBeInTheDocument()
    expect(screen.getByText('bounded summary')).toBeInTheDocument()
  })

  it('renders pairing and stale/error states without exposing secrets', async () => {
    mocks.getStatus.mockResolvedValueOnce({ running: true, paired: false, sessionId: 'session-1' })
    const { unmount } = render(<SecretaryBrowserWorkbench />)
    await waitFor(() => expect(screen.getByText('配对中')).toBeInTheDocument())
    unmount()

    mocks.getStatus.mockResolvedValue({ running: true, paired: false, error: '页面来源已变化，请重新配对' })
    render(<SecretaryBrowserWorkbench />)
    await waitFor(() => expect(screen.getByText('错误')).toBeInTheDocument())
    expect(screen.getByText(/页面来源已变化/)).toBeInTheDocument()
  })
})
