import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  PenLine,
  Search,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { type AgentStep, useAppStore } from '../stores/useAppStore'

export function AgentTraceRenderer({ steps }: { steps: AgentStep[] }) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const streamSignal = useMemo(
    () => steps.map((step) => `${step.id}:${step.status}:${step.content?.length ?? 0}`).join('|'),
    [steps],
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [steps.length, streamSignal])

  if (!steps.length) {
    return null
  }

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="mt-3 max-h-[360px] overflow-y-auto rounded-xl border border-[#e8ddc7] bg-[#fffdf7] p-3 shadow-[0_10px_26px_rgba(43,34,19,0.04)]"
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#2f2b22]">
        <Sparkles size={15} className="text-[#d7aa4f]" />
        Solo execution
      </div>
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {steps.map((step) => (
            <AgentStepCard key={step.id} step={step} />
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>
    </motion.section>
  )
}

function AgentStepCard({ step }: { step: AgentStep }) {
  const toggleAgentStepExpanded = useAppStore((state) => state.toggleAgentStepExpanded)
  const expanded = step.status === 'running' || step.isExpanded
  const content = [step.details, step.content].filter(Boolean).join('\n\n')

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-lg border bg-[#fffefa] ${
        step.status === 'running'
          ? 'border-[#d7aa4f]/70 shadow-[0_10px_24px_rgba(215,170,79,0.12)]'
          : step.status === 'error'
            ? 'border-[#d37b6d]/60'
            : 'border-[#efe5d1]'
      }`}
    >
      <button
        type="button"
        onClick={() => step.status !== 'running' && toggleAgentStepExpanded(step.id)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <StepStatusIcon step={step} />
        <StepTypeIcon step={step} />
        <span
          className={`min-w-0 flex-1 truncate text-xs font-medium ${
            step.status === 'pending' ? 'text-[#9d988a]' : 'text-[#2f2b22]'
          }`}
        >
          {step.title}
        </span>
        <span className="shrink-0 text-[11px] text-[#8f897a]">{statusLabel(step.status)}</span>
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.18 }}
          className={step.status === 'running' ? 'opacity-40' : ''}
        >
          <ChevronDown size={14} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && content ? (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="max-h-[240px] overflow-y-auto border-t border-[#efe5d1] px-3 py-2 text-xs leading-5 text-[#6f7168]">
              <MarkdownLite text={content} isStreaming={step.status === 'running'} />
              {step.sources?.length ? (
                <div className="mt-2 space-y-1 text-[11px] text-[#3f5845]">
                  {step.sources.slice(0, 5).map((source) => (
                    <div key={source.url ?? source.title} className="truncate">
                      {source.url ? (
                        <a href={source.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {source.title}
                        </a>
                      ) : (
                        source.title
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  )
}

function StepStatusIcon({ step }: { step: AgentStep }) {
  if (step.status === 'running') {
    return <Loader2 size={14} className="shrink-0 animate-spin text-[#d7aa4f]" />
  }

  if (step.status === 'completed') {
    return <CheckCircle2 size={14} className="shrink-0 text-[#4f7a54]" />
  }

  if (step.status === 'error') {
    return <AlertCircle size={14} className="shrink-0 text-[#b85c4d]" />
  }

  return <Circle size={12} className="shrink-0 text-[#b9b09e]" />
}

function StepTypeIcon({ step }: { step: AgentStep }) {
  const className = 'shrink-0 text-[#8f897a]'

  if (step.type === 'tool') {
    return <Search size={13} className={className} />
  }

  if (step.type === 'sub_agent') {
    return <Wand2 size={13} className={className} />
  }

  if (step.type === 'generation') {
    return <PenLine size={13} className={className} />
  }

  return <Sparkles size={13} className={className} />
}

function MarkdownLite({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return (
    <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {text}
      {isStreaming ? (
        <motion.span
          aria-hidden="true"
          className="ml-0.5 inline-block h-3 w-1 rounded-full bg-[#d7aa4f]"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      ) : null}
    </div>
  )
}

function statusLabel(status: AgentStep['status']) {
  const labels: Record<AgentStep['status'], string> = {
    pending: 'pending',
    running: 'running',
    completed: 'done',
    error: 'error',
  }

  return labels[status]
}
