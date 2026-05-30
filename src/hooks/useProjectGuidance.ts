import { useEffect } from 'react'
import { loadProjectGuidance } from '../services/projectGuidance'
import { useAppStore } from '../stores/useAppStore'

export function useProjectGuidance() {
  const setProjectGuidance = useAppStore((state) => state.setProjectGuidance)

  useEffect(() => {
    let cancelled = false

    void loadProjectGuidance().then((guidance) => {
      if (!cancelled) {
        setProjectGuidance(guidance)
      }
    })

    return () => {
      cancelled = true
    }
  }, [setProjectGuidance])
}
