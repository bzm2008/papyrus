import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  snapshot: vi.fn(),
  startPairing: vi.fn(),
  disconnect: vi.fn(),
  presentation: vi.fn(),
}))

vi.mock('../services/browserBridgeClient', () => ({
  getBrowserBridgeStatus: mocks.getStatus,
  browserSnapshot: mocks.snapshot,
  startBrowserBridgePairing: mocks.startPairing,
  disconnectBrowserBridge: mocks.disconnect,
  getBrowserBridgeConnectionPresentation: mocks.presentation,
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
    mocks.presentation.mockImplementation((status: { running: boolean; paired: boolean; error?: string }) => ({
      state: status.error ? 'error' : status.paired ? 'connected' : status.running ? 'pairing' : 'disabled',
      title: status.error ? '浏览器连接暂不可用' : status.paired ? '正在协助当前标签页' : status.running ? '等待浏览器确认' : '浏览器连接未启动',
      detail: status.error || (status.paired ? 'https://example.com。本次授权约 60 秒后失效。' : '请在浏览器中确认当前标签页。'),
      action: status.paired ? 'disconnect' : 'pair',
      actionLabel: status.paired ? '停止并断开' : '准备浏览器连接',
    }))
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

  it('makes the active browser lease visible and lets the user stop it', async () => {
    mocks.getStatus.mockResolvedValue({ running: true, paired: true, origin: 'https://example.com', expiresAt: Math.floor(Date.now() / 1000) + 60 })
    render(<SecretaryBrowserWorkbench />)

    await waitFor(() => expect(screen.getByText('正在协助当前标签页')).toBeInTheDocument())
    expect(screen.getByText(/本次授权约 60 秒后失效/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停止并断开' })).toBeInTheDocument()
  })

  it('never exposes pairing material in the regular workbench', async () => {
    const user = userEvent.setup()
    mocks.getStatus.mockResolvedValue({ running: false, paired: false })
    mocks.startPairing.mockResolvedValue({ sessionId: 'session-1', token: 'token-secret', nonce: 'nonce-secret', wsUrl: 'ws://127.0.0.1:1234/bridge', expiresAt: 999 })
    render(<SecretaryBrowserWorkbench />)

    await waitFor(() => expect(screen.getByRole('button', { name: '准备浏览器连接' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '准备浏览器连接' }))

    expect(screen.queryByText(/一次性 Token/)).not.toBeInTheDocument()
    expect(screen.queryByText('token-secret')).not.toBeInTheDocument()
    expect(screen.queryByText('nonce-secret')).not.toBeInTheDocument()
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
