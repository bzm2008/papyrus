export const MASCOT_LABEL = 'mascot'
export const MASCOT_PREFERENCE_KEY = 'papyrus.mascot.visible'
export const MASCOT_POSITION_KEY = 'papyrus.mascot.position'

const MASCOT_URL = 'index.html?window=mascot'

type MascotWindowHandle = {
  show: () => Promise<void>
  hide: () => Promise<void>
  setFocus: () => Promise<void>
  setAlwaysOnTop: (value: boolean) => Promise<void>
  getPosition?: () => Promise<{ x: number; y: number }>
  setPosition?: (position: { x: number; y: number }) => Promise<void>
  listen?: (event: string, callback: (event: { payload?: { x?: number; y?: number } }) => void) => Promise<unknown>
  close?: () => Promise<void>
  destroy?: () => Promise<void>
  once?: (event: string, callback: (event?: { payload?: unknown }) => void) => Promise<unknown>
}

type WebviewWindowConstructor = {
  new (label: string, options: Record<string, unknown>): MascotWindowHandle
  getByLabel: (label: string) => Promise<MascotWindowHandle | null>
}

export async function emitMascotState(snapshot: unknown) {
  if (!isTauriRuntime()) return false
  try {
    const { emitTo } = await import('@tauri-apps/api/event')
    await emitTo(MASCOT_LABEL, 'mascot-state', snapshot)
    return true
  } catch {
    return false
  }
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

export async function showMascotWindow() {
  if (!isTauriRuntime()) return false

  const mascot = await getMascotWindow(true)
  if (!mascot) return false

  // Always-on-top is optional on Linux window managers. Failure here must not
  // make the secretary workflow appear broken.
  await ignoreWindowError(() => mascot.setAlwaysOnTop(true))

  try {
    await mascot.show()
    await restoreMascotPosition(mascot)
    await ignoreWindowError(() => mascot.setFocus())
    rememberMascotVisibility(true)
    void installPositionPersistence(mascot)
    return true
  } catch {
    return false
  }
}

export async function hideMascotWindow() {
  if (!isTauriRuntime()) return false
  const mascot = await getMascotWindow(false)
  if (!mascot) return false

  try {
    await mascot.hide()
    rememberMascotVisibility(false)
    return true
  } catch {
    return false
  }
}

export async function closeMascotWindow() {
  if (!isTauriRuntime()) return false
  const mascot = await getMascotWindow(false)
  if (!mascot) return false

  try {
    if (mascot.destroy) await mascot.destroy()
    else if (mascot.close) await mascot.close()
    return true
  } catch {
    // Explicit exit can race with the native destroy event. The caller should
    // continue shutting down even if the handle has already disappeared.
    return false
  }
}

/** Re-show the mascot only when the user explicitly left it visible last time. */
export async function restoreMascotWindowPreference() {
  if (!isMascotPreferredVisible()) return false
  return showMascotWindow()
}

export function isMascotPreferredVisible() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(MASCOT_PREFERENCE_KEY) === 'true'
  } catch {
    return false
  }
}

export async function focusMainWindow() {
  if (!isTauriRuntime()) return false

  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const WindowClass = WebviewWindow as unknown as WebviewWindowConstructor
    const main = await WindowClass.getByLabel('main')
    if (!main) return false
    await main.show()
    await main.setFocus()
    return true
  } catch {
    return false
  }
}

async function getMascotWindow(create: boolean) {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const WindowClass = WebviewWindow as unknown as WebviewWindowConstructor
    const existing = await WindowClass.getByLabel(MASCOT_LABEL)
    if (existing || !create) return existing

    const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
    const created = new WindowClass(MASCOT_LABEL, {
      url: MASCOT_URL,
      title: 'Papyrus 秘书悬浮窗',
      width: 180,
      height: 220,
      minWidth: 180,
      minHeight: 220,
      maxWidth: 180,
      maxHeight: 220,
      resizable: false,
      decorations: false,
      // macOS transparency requires Tauri's private API, which Papyrus does
      // not enable. The mascot card has its own opaque fallback styling.
      transparent: !isMac,
      alwaysOnTop: true,
      skipTaskbar: true,
      visible: false,
      focus: false,
      shadow: false,
      visibleOnAllWorkspaces: true,
    })

    await waitForCreation(created)
    return created
  } catch {
    return null
  }
}

function rememberMascotVisibility(visible: boolean) {
  try {
    window.localStorage.setItem(MASCOT_PREFERENCE_KEY, String(visible))
  } catch {
    // Private browsing or a locked profile may disable local storage.
  }
}

async function restoreMascotPosition(windowHandle: MascotWindowHandle) {
  if (!windowHandle.setPosition || typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(MASCOT_POSITION_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown }
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return
    await windowHandle.setPosition({ x: Math.round(parsed.x), y: Math.round(parsed.y) })
  } catch {
    // A stale monitor position should never block showing the assistant.
  }
}

async function installPositionPersistence(windowHandle: MascotWindowHandle) {
  if (!windowHandle.listen) return
  try {
    await windowHandle.listen('tauri://move', (event) => {
      const point = event.payload
      if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return
      try {
        window.localStorage.setItem(MASCOT_POSITION_KEY, JSON.stringify({ x: Math.round(point.x), y: Math.round(point.y) }))
      } catch {
        // Position memory is optional.
      }
    })
  } catch {
    // Older WebView runtimes may not expose move events.
  }
}

async function waitForCreation(windowHandle: MascotWindowHandle) {
  if (typeof windowHandle.once !== 'function' || typeof window === 'undefined') return

  await new Promise<void>((resolve) => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      resolve()
    }

    void windowHandle.once?.('tauri://created', settle)
    void windowHandle.once?.('tauri://error', settle)
    window.setTimeout(settle, 1500)
  })
}

async function ignoreWindowError(action: () => Promise<void>) {
  try {
    await action()
  } catch {
    // Optional focus/always-on-top polish is never a task blocker.
  }
}
