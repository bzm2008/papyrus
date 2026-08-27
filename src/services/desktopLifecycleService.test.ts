import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const events = vi.hoisted(() => {
  const handlers = new Map<string, () => void | Promise<void>>()
  return {
    handlers,
    listen: vi.fn(async (name: string, handler: () => void | Promise<void>) => {
      handlers.set(name, handler)
      return vi.fn()
    }),
  }
})
const native = vi.hoisted(() => ({ invoke: vi.fn() }))
const ledger = vi.hoisted(() => ({ pauseActiveSecretaryLedgerRuns: vi.fn() }))
const runs = vi.hoisted(() => ({ cancelSecretaryRun: vi.fn(), pauseSecretaryRun: vi.fn() }))
const mascot = vi.hoisted(() => ({ closeMascotWindow: vi.fn() }))

vi.mock('@tauri-apps/api/event', () => events)
vi.mock('@tauri-apps/api/core', () => native)
vi.mock('./secretaryLedgerRuntime', () => ledger)
vi.mock('./secretaryRunController', () => runs)
vi.mock('./mascotWindowService', () => mascot)

import { installDesktopLifecycleHandlers } from './desktopLifecycleService'

function setTauriRuntime(value: unknown) {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value })
}

async function flushListeners() {
  await vi.dynamicImportSettled()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  events.handlers.clear()
  vi.resetAllMocks()
  ledger.pauseActiveSecretaryLedgerRuns.mockResolvedValue(1)
  native.invoke.mockResolvedValue(undefined)
  mascot.closeMascotWindow.mockResolvedValue(true)
})

afterEach(() => setTauriRuntime(undefined))

describe('desktop lifecycle bridge', () => {
  it('does not install Tauri listeners in a browser runtime', () => {
    setTauriRuntime(undefined)

    installDesktopLifecycleHandlers()

    expect(events.listen).not.toHaveBeenCalled()
  })

  it('persists a pause checkpoint before aborting the active run', async () => {
    setTauriRuntime({})
    const dispose = installDesktopLifecycleHandlers()
    await flushListeners()

    await events.handlers.get('papyrus://pause-tasks')?.()

    expect(ledger.pauseActiveSecretaryLedgerRuns).toHaveBeenCalledTimes(1)
    expect(runs.pauseSecretaryRun).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('confirms explicit exit only after pausing the active task', async () => {
    setTauriRuntime({})
    const dispose = installDesktopLifecycleHandlers()
    await flushListeners()

    await events.handlers.get('papyrus://prepare-exit')?.()

    expect(ledger.pauseActiveSecretaryLedgerRuns).toHaveBeenCalledTimes(1)
    expect(runs.cancelSecretaryRun).toHaveBeenCalledWith('shutdown')
    expect(mascot.closeMascotWindow).toHaveBeenCalledTimes(1)
    expect(native.invoke).toHaveBeenCalledWith('complete_explicit_exit')
    dispose()
  })
})
