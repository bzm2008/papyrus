import { invoke } from '@tauri-apps/api/core'
import type { ProjectGuidance } from '../stores/useAppStore'

type GuidancePayload = {
  style?: string
  world?: string
}

export async function loadProjectGuidance(): Promise<ProjectGuidance> {
  try {
    const payload = await invoke<GuidancePayload>('read_project_guidance')

    return {
      style: payload.style ?? '',
      world: payload.world ?? '',
      loadedAt: Date.now(),
    }
  } catch {
    return {
      style: '',
      world: '',
      loadedAt: Date.now(),
    }
  }
}
