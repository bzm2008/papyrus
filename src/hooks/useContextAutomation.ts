import { useEffect } from 'react'
import { compressCurrentContext } from '../services/contextCompression'
import { useAppStore } from '../stores/useAppStore'

export function useContextAutomation() {
  const contextUsedTokens = useAppStore((state) => state.contextUsedTokens)
  const contextLimitTokens = useAppStore((state) => state.effectiveContextLimitTokens)
  const isContextCompressing = useAppStore((state) => state.isContextCompressing)
  const lastAutoCompressionTokenMark = useAppStore(
    (state) => state.lastAutoCompressionTokenMark,
  )
  const autoCompressionArmed = useAppStore((state) => state.autoCompressionArmed)
  const setAutoCompressionGate = useAppStore((state) => state.setAutoCompressionGate)

  useEffect(() => {
    const threshold = contextLimitTokens * 0.9
    const rearmThreshold = contextLimitTokens * 0.8
    const incrementalThreshold = Math.max(4000, contextLimitTokens * 0.05)

    if (!autoCompressionArmed && contextUsedTokens < rearmThreshold) {
      setAutoCompressionGate({ autoCompressionArmed: true })
      return
    }

    if (
      contextUsedTokens >= threshold &&
      !isContextCompressing &&
      autoCompressionArmed &&
      contextUsedTokens - lastAutoCompressionTokenMark >= incrementalThreshold
    ) {
      setAutoCompressionGate({
        autoCompressionArmed: false,
        lastAutoCompressionTokenMark: contextUsedTokens,
      })
      void compressCurrentContext('auto')
    }
  }, [
    autoCompressionArmed,
    contextLimitTokens,
    contextUsedTokens,
    isContextCompressing,
    lastAutoCompressionTokenMark,
    setAutoCompressionGate,
  ])
}
