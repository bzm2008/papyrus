import type { MaintenanceCheck } from '../stores/useAppStore'

export function getMaintenanceReadiness(checks: MaintenanceCheck[]) {
  const coreReady = (['tauri', 'sqlite'] as const).every(
    (id) => checks.find((check) => check.id === id)?.status === 'ok',
  )
  const modelReady = checks.find((check) => check.id === 'llm')?.status === 'ok'

  return {
    canEnter: coreReady,
    limitedMode: coreReady && !modelReady,
  }
}
