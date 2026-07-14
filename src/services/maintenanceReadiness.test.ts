import { describe, expect, it } from 'vitest'
import { getMaintenanceReadiness } from './maintenanceReadiness'

describe('getMaintenanceReadiness', () => {
  it('allows the workspace in limited mode when core services pass but the model is unavailable', () => {
    expect(
      getMaintenanceReadiness([
        { id: 'tauri', label: 'Tauri', status: 'ok', message: 'ok' },
        { id: 'sqlite', label: 'SQLite', status: 'ok', message: 'ok' },
        { id: 'llm', label: 'LLM', status: 'error', message: 'login required' },
      ]),
    ).toEqual({ canEnter: true, limitedMode: true })
  })

  it('blocks the workspace when a core desktop service is unavailable', () => {
    expect(
      getMaintenanceReadiness([
        { id: 'tauri', label: 'Tauri', status: 'error', message: 'offline' },
        { id: 'sqlite', label: 'SQLite', status: 'ok', message: 'ok' },
        { id: 'llm', label: 'LLM', status: 'ok', message: 'ok' },
      ]),
    ).toEqual({ canEnter: false, limitedMode: false })
  })

  it('allows the full workspace when every service passes', () => {
    expect(
      getMaintenanceReadiness([
        { id: 'tauri', label: 'Tauri', status: 'ok', message: 'ok' },
        { id: 'sqlite', label: 'SQLite', status: 'ok', message: 'ok' },
        { id: 'llm', label: 'LLM', status: 'ok', message: 'ok' },
      ]),
    ).toEqual({ canEnter: true, limitedMode: false })
  })
})
