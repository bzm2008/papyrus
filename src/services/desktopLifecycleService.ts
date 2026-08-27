import { invoke } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { pauseActiveSecretaryLedgerRuns } from './secretaryLedgerRuntime'
import { cancelSecretaryRun, pauseSecretaryRun } from './secretaryRunController'
import { closeMascotWindow } from './mascotWindowService'

const EVENT_PAUSE = 'papyrus://pause-tasks'
const EVENT_CANCEL = 'papyrus://cancel-tasks'
const EVENT_PREPARE_EXIT = 'papyrus://prepare-exit'

export function installDesktopLifecycleHandlers() {
  if (!isTauriRuntime()) return () => undefined

  let disposed = false
  const unlisten: UnlistenFn[] = []
  void import('@tauri-apps/api/event').then(({ listen }) => Promise.all([
    listen(EVENT_PAUSE, async () => {
      await pauseActiveSecretaryLedgerRuns()
      pauseSecretaryRun()
    }),
    listen(EVENT_CANCEL, () => {
      cancelSecretaryRun()
    }),
    listen(EVENT_PREPARE_EXIT, async () => {
      await pauseActiveSecretaryLedgerRuns()
      cancelSecretaryRun('shutdown')
      await closeMascotWindow()
      await invoke('complete_explicit_exit')
    }),
  ])).then((handlers) => {
    if (disposed) {
      handlers.forEach((handler) => handler())
      return
    }
    unlisten.push(...handlers)
  }).catch(() => {
    // A partially initialized or browser runtime must not turn lifecycle setup
    // into an application error. No browser persistence is created here.
  })

  return () => {
    disposed = true
    unlisten.splice(0).forEach((handler) => handler())
  }
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
