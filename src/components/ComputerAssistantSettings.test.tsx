import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import * as client from '../services/workAssistantClient'
import { ComputerAssistantSettings } from './ComputerAssistantSettings'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => 'C:/Work') }))
vi.mock('../services/workAssistantClient', () => ({
  getWorkAssistantCapabilities: vi.fn(async () => [{ name: 'workspace_scan', toolset: 'workspace', available: true, platform: 'windows' }, { name: 'desktop_open_app', toolset: 'desktop', available: false, reason: '未注册应用', platform: 'windows' }]),
  listWorkAssistantRoots: vi.fn(async () => [{ id: 'root-1', label: 'Work', path: 'C:/Work', kind: 'workspace', createdAt: 1 }]),
  addWorkAssistantRoot: vi.fn(async () => undefined), removeWorkAssistantRoot: vi.fn(async () => undefined),
  listRegisteredApplications: vi.fn(async () => [{ id: 'app-1', label: 'Editor', executablePath: 'C:/Editor.exe', platform: 'windows', createdAt: 1 }]),
  registerApplicationFromPicker: vi.fn(async () => undefined), removeRegisteredApplication: vi.fn(async () => undefined),
  listWorkAssistantAudit: vi.fn(async () => [{ id: 'audit-1', event: 'workspace_scan', detail: 'ok', at: 1 }]), clearWorkAssistantAudit: vi.fn(async () => undefined),
}))

describe('ComputerAssistantSettings', () => {
  it('shows capability reasons, authorized roots, applications, and audit records', async () => {
    render(<ComputerAssistantSettings />)
    expect(await screen.findByText('未注册应用')).toBeInTheDocument()
    expect(screen.getByText(/^Work · 工作区$/)).toBeInTheDocument()
    expect(screen.getByText('Editor')).toBeInTheDocument()
    expect(screen.getAllByText('workspace_scan')).toHaveLength(2)
  })

  it('adds a picker-authorized root and confirms audit clearing', async () => {
    render(<ComputerAssistantSettings />)
    await screen.findByText(/^Work · 工作区$/)
    fireEvent.change(screen.getByRole('combobox', { name: '授权目录类型' }), { target: { value: 'downloads' } })
    fireEvent.click(screen.getByRole('button', { name: '添加授权目录' }))
    await waitFor(() => expect(client.addWorkAssistantRoot).toHaveBeenCalledWith('Work', 'C:/Work', 'downloads'))
    fireEvent.click(screen.getByRole('button', { name: '清空审计记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认清空' }))
    await waitFor(() => expect(client.clearWorkAssistantAudit).toHaveBeenCalled())
  })
})
