let active: { runId: string; controller: AbortController } | undefined

export function startSecretaryRun(runId: string) {
  active?.controller.abort()
  const controller = new AbortController()
  active = { runId, controller }
  return controller.signal
}

export function cancelSecretaryRun() {
  active?.controller.abort()
}

export function finishSecretaryRun(runId: string) {
  if (active?.runId === runId) active = undefined
}

export function activeSecretaryRunId() {
  return active?.runId
}

