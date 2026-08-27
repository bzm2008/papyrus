import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Brain, CheckCircle2, ClipboardCheck, CircleX, ExternalLink, EyeOff, LoaderCircle, Pause, Sparkles, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { focusMainWindow, hideMascotWindow } from '../services/mascotWindowService'
import { getMascotSnapshot } from '../services/mascotRuntime'
import { parseMascotSnapshot, MASCOT_EVENT_STATE } from '../services/mascotProtocol'
import { useAppStore } from '../stores/useAppStore'
import { useWorkAssistantStore } from '../stores/useWorkAssistantStore'
import headSrc from '../assets/mascot/head.png'
import idleSrc from '../assets/mascot/idle.png'
import dazedSrc from '../assets/mascot/dazed.png'
import thinkingSrc from '../assets/mascot/thinking.png'
import workingSrc from '../assets/mascot/working.png'
import approvalSrc from '../assets/mascot/approval.png'
import failedSrc from '../assets/mascot/failed.png'
import completedSrc from '../assets/mascot/completed.png'

const frameByMood = { idle: idleSrc, dazed: dazedSrc, thinking: thinkingSrc, working: workingSrc, collaborating: workingSrc, awaiting_approval: approvalSrc, reconnecting: thinkingSrc, completed: completedSrc, failed: failedSrc, error: failedSrc, cancelled: dazedSrc, paused: dazedSrc, blocked: approvalSrc } as const
const glyphByMood: Record<string, LucideIcon> = {
  idle: Sparkles,
  dazed: Pause,
  thinking: Brain,
  working: LoaderCircle,
  collaborating: LoaderCircle,
  awaiting_approval: ClipboardCheck,
  reconnecting: LoaderCircle,
  completed: CheckCircle2,
  failed: CircleX,
  error: CircleX,
  cancelled: Pause,
  paused: Pause,
  blocked: ClipboardCheck,
}

export function MascotWindow() {
  const reducedMotion = useReducedMotion()
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const [externalSnapshot, setExternalSnapshot] = useState<ReturnType<typeof parseMascotSnapshot>>(null)
  const llmRunState = useAppStore((state) => state.llmRunState)
  const llmStatusMessage = useAppStore((state) => state.llmStatusMessage)
  const activeGoal = useAppStore((state) => state.activeSecretaryGoal)
  const workRunId = useWorkAssistantStore((state) => state.activeRunId)
  const workRun = useWorkAssistantStore((state) => workRunId ? state.runs[workRunId] : undefined)
  useEffect(() => {
    let disposed = false
    void import('@tauri-apps/api/event').then(async ({ listen, emit }) => {
      const unlisten = await listen(MASCOT_EVENT_STATE, (event) => {
        const next = parseMascotSnapshot(event.payload)
        if (!disposed && next) setExternalSnapshot(next)
      })
      if (!disposed) await emit('mascot-ready', { label: '铭荼', version: 1 })
      else unlisten()
    }).catch(() => undefined)
    return () => { disposed = true }
  }, [])
  const localSnapshot = useMemo(() => getMascotSnapshot({ llmRunState, llmStatusMessage, run: workRun, goal: activeGoal }), [activeGoal, llmRunState, llmStatusMessage, workRun])
  const snapshot = externalSnapshot ?? localSnapshot
  const stateImage = frameByMood[snapshot.mood as keyof typeof frameByMood] ?? headSrc
  const moodClass = `mascot-mood-${snapshot.mood.replace(/[^a-z_]/g, '')}`
  const StateGlyph = glyphByMood[snapshot.mood] ?? Sparkles

  const imageSrc = failedImage === stateImage ? headSrc : stateImage

  return (
    <main className="mascot-window flex h-full min-h-0 flex-col overflow-hidden bg-transparent p-2 text-[#242219]">
      <div className="mascot-drag-region flex items-center justify-between px-2 py-1 text-[11px] text-[#6f7168]" data-tauri-drag-region>
        <span className="inline-flex items-center gap-1.5 font-semibold"><Sparkles size={12} className="text-[#d7aa4f]" />铭荼</span>
        <button type="button" title="隐藏铭荼" aria-label="隐藏铭荼" onClick={() => void hideMascotWindow()} className="mascot-action-button"><X size={13} /></button>
      </div>
      <div className={`mascot-card ${moodClass} flex min-h-0 flex-1 flex-col items-center justify-between px-3 pb-3 pt-1`}>
        <div className="mascot-art" aria-live="polite">
          <motion.img
            key={snapshot.mood}
            src={imageSrc}
            alt="铭荼"
            className="mascot-sprite mt-1 h-32 w-32 object-contain"
            animate={reducedMotion ? undefined : snapshot.mood === 'thinking' || snapshot.mood === 'working' ? { y: [0, -3, 0] } : { y: [0, -1, 0] }}
            transition={{ duration: snapshot.mood === 'working' ? 1.8 : 3.2, repeat: reducedMotion ? 0 : Infinity, ease: 'easeInOut' }}
            onError={() => setFailedImage(stateImage)}
          />
          <span className="mascot-state-indicator" aria-hidden="true" />
          <span className="mascot-state-glyph" aria-hidden="true"><StateGlyph size={13} strokeWidth={2.2} /></span>
        </div>
        <div className="w-full text-center">
          <div className="text-[11px] font-semibold text-[#3f5845]">{snapshot.label}</div>
          <p className="mt-1 text-[12px] leading-5 text-[#4d493e]">{snapshot.message}</p>
          {snapshot.detail ? <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#8f897a]">{snapshot.detail}</p> : null}
          {snapshot.progress ? <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eee5d3]"><motion.div className="h-full bg-[#d7aa4f]" animate={{ width: `${snapshot.progress.percent}%` }} /></div> : null}
        </div>
        <div className="mt-2 flex w-full items-center gap-1.5">
          <button type="button" onClick={() => void focusMainWindow()} className="mascot-primary-button inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold"><ExternalLink size={12} />打开工作区</button>
          <button type="button" title="隐藏铭荼" aria-label="隐藏铭荼" onClick={() => void hideMascotWindow()} className="mascot-action-button rounded-md px-2 py-1.5"><EyeOff size={13} /></button>
        </div>
        <AnimatePresence initial={false}>{snapshot.mood === 'completed' ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-[#d7aa4f]/50" /> : null}</AnimatePresence>
      </div>
    </main>
  )
}
