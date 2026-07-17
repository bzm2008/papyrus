import { classifySecretaryTask } from './secretaryTaskClassifier'
import type { SecretaryLedgerTask } from './secretaryLedgerClient'

/**
 * A scheduled task is an explicit user instruction, but automatic start is
 * intentionally narrower than manual start. Only a writing/model task may
 * begin in the background; local files, desktop applications and browser
 * actions always wait for the user to return and approve their next step.
 */
export function isAutoStartEligibleSecretaryTask(task: SecretaryLedgerTask, now = Date.now()) {
  if (task.status !== 'queued' || task.scheduleAt === null || task.scheduleAt > now) return false
  return classifySecretaryTask(task.request).domain === 'writing'
}

export function selectNextAutoStartSecretaryTask(tasks: readonly SecretaryLedgerTask[], now = Date.now()) {
  return tasks
    .filter((task) => isAutoStartEligibleSecretaryTask(task, now))
    .sort((left, right) => {
      const bySchedule = (left.scheduleAt ?? Number.MAX_SAFE_INTEGER) - (right.scheduleAt ?? Number.MAX_SAFE_INTEGER)
      if (bySchedule !== 0) return bySchedule
      const byPriority = right.priority - left.priority
      return byPriority !== 0 ? byPriority : left.createdAt - right.createdAt
    })[0]
}

