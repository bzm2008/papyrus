let active: { runId: string; controller: AbortController; pauseRequested: boolean } | undefined

export function startSecretaryRun(runId: string) {
  active?.controller.abort()
  const controller = new AbortController()
  active = { runId, controller, pauseRequested: false }
  return controller.signal
}

export function cancelSecretaryRun() {
  active?.controller.abort()
}

/** Abort at the same safety boundary as cancel, but preserve a resumable task. */
export function pauseSecretaryRun() {
  if (!active) return
  active.pauseRequested = true
  active.controller.abort()
}

export function secretaryRunPauseRequested(runId: string) {
  return active?.runId === runId && active.pauseRequested
}

export function finishSecretaryRun(runId: string) {
  if (active?.runId === runId) active = undefined
}

export function activeSecretaryRunId() {
  return active?.runId
}

