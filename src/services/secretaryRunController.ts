export type SecretaryRunCancellationReason = 'cancelled' | 'paused' | 'shutdown'

let active: {
  runId: string
  controller: AbortController
  cancellationReason?: SecretaryRunCancellationReason
} | undefined

export function startSecretaryRun(runId: string) {
  if (active) active.cancellationReason = 'cancelled'
  active?.controller.abort()
  const controller = new AbortController()
  active = { runId, controller }
  return controller.signal
}

export function cancelSecretaryRun(reason: SecretaryRunCancellationReason = 'cancelled') {
  if (active) active.cancellationReason = reason
  active?.controller.abort()
}

export function pauseSecretaryRun() {
  cancelSecretaryRun('paused')
}

export function finishSecretaryRun(runId: string) {
  if (active?.runId === runId) active = undefined
}

export function activeSecretaryRunId() {
  return active?.runId
}

export function getSecretaryRunCancellationReason(runId: string) {
  return active?.runId === runId ? active.cancellationReason : undefined
}

