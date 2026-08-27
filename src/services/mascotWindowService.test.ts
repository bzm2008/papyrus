import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => {
  class MockWebviewWindow {
    static getByLabel = vi.fn(async (label: string) => native.windows.get(label) ?? null)
    static instances: MockWebviewWindow[] = []
    label: string
    show = vi.fn(async () => undefined)
    hide = vi.fn(async () => undefined)
    close = vi.fn(async () => undefined)
    destroy = vi.fn(async () => {
      native.windows.delete(this.label)
    })
    setFocus = vi.fn(async () => undefined)
    setAlwaysOnTop = vi.fn(async () => undefined)
    once = vi.fn(async (_event: string, handler: () => void) => {
      handler()
      return vi.fn()
    })

    constructor(label: string) {
      this.label = label
      MockWebviewWindow.instances.push(this)
      native.windows.set(label, this)
    }
  }

  return {
    WebviewWindow: MockWebviewWindow,
    windows: new Map<string, MockWebviewWindow>(),
  }
})

vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: native.WebviewWindow }))

import {
  closeMascotWindow,
  focusMainWindow,
  hideMascotWindow,
  showMascotWindow,
} from './mascotWindowService'

function setTauriRuntime(value: unknown) {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value })
}

beforeEach(() => {
  native.windows.clear()
  native.WebviewWindow.instances = []
  vi.clearAllMocks()
})

afterEach(async () => {
  setTauriRuntime({})
  await closeMascotWindow()
  setTauriRuntime(undefined)
})

describe('mascot window bridge', () => {
  it('falls back without importing or calling native APIs in a browser', async () => {
    setTauriRuntime(undefined)

    await expect(showMascotWindow()).resolves.toBe(false)
    await expect(hideMascotWindow()).resolves.toBe(false)
    await expect(focusMainWindow()).resolves.toBe(false)
    await expect(closeMascotWindow()).resolves.toBe(false)
    expect(native.WebviewWindow.instances).toHaveLength(0)
  })

  it('creates the mascot once and reuses it on subsequent show calls', async () => {
    setTauriRuntime({})

    await expect(showMascotWindow()).resolves.toBe(true)
    await expect(showMascotWindow()).resolves.toBe(true)

    expect(native.WebviewWindow.instances).toHaveLength(1)
    expect(native.WebviewWindow.instances[0].show).toHaveBeenCalledTimes(2)
    expect(native.WebviewWindow.instances[0].setAlwaysOnTop).toHaveBeenCalledWith(true)
  })

  it('hides and destroys the existing mascot window', async () => {
    setTauriRuntime({})
    await showMascotWindow()
    const mascot = native.WebviewWindow.instances[0]

    await expect(hideMascotWindow()).resolves.toBe(true)
    await expect(closeMascotWindow()).resolves.toBe(true)

    expect(mascot.hide).toHaveBeenCalledTimes(1)
    expect(mascot.destroy).toHaveBeenCalledTimes(1)
    expect(native.windows.has('mascot')).toBe(false)
  })

  it('shows and focuses the main window without creating a mascot', async () => {
    setTauriRuntime({})
    const main = new native.WebviewWindow('main')

    await expect(focusMainWindow()).resolves.toBe(true)

    expect(main.show).toHaveBeenCalledTimes(1)
    expect(main.setFocus).toHaveBeenCalledTimes(1)
    expect(native.WebviewWindow.instances).toHaveLength(1)
  })

  it('uses the opaque fallback on macOS without changing the window contract', async () => {
    setTauriRuntime({})
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    await showMascotWindow()
    expect(native.WebviewWindow.instances[0]).toBeTruthy()
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' })
  })
})
