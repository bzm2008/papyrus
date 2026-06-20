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
import { type AgentStep, type AgentTodo, useAppStore } from '../stores/useAppStore'

export function AgentTraceRenderer({ steps }: { steps: AgentStep[] }) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const hiveTelemetry = useAppStore((state) => state.hiveTelemetry)
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
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="mt-3 max-h-[340px] overflow-y-auto rounded-lg border border-[#e8ddc7]/78 bg-[#fffefa]/74 p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#2f2b22]">
          <Sparkles size={13} className="text-[#d7aa4f]" />
          执行轨迹
        </div>
        <span className="text-[11px] tabular-nums text-[#8f897a]">{steps.length} steps</span>
      </div>
      {hiveTelemetry.enabled ? <HiveTelemetryStrip /> : null}
      <div className="relative space-y-0.5 before:absolute before:left-[9px] before:top-2 before:h-[calc(100%-12px)] before:w-px before:bg-[#eadfcb]">
        <AnimatePresence initial={false}>
          {steps.map((step) => (
            <AgentStepRow key={step.id} step={step} />
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>
    </motion.section>
  )
}

export function AgentTodoList({ todos }: { todos: AgentTodo[] }) {
  const hiveTelemetry = useAppStore((state) => state.hiveTelemetry)
  if (!todos.length) {
    return null
  }

  return (
    <div className="mt-3 rounded-lg border border-[#e8ddc7]/76 bg-[#fffefa]/72 p-2">
      <div className="mb-1 flex items-center justify-between gap-2 px-1 text-[11px] font-semibold text-[#6f7168]">
        <span>To do</span>
        {hiveTelemetry.enabled ? (
          <span className="rounded-md bg-[#fff6df] px-1.5 py-0.5 text-[#5b4a24]">
            {hiveTelemetry.stageLabel ?? 'Hive'} {hiveTelemetry.activeAgents}/{hiveTelemetry.plannedAgents}
          </span>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {todos.map((todo) => (
          <div
            key={todo.id}
            className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs ${
              todo.status === 'running'
                ? 'bg-[#edf6eb] text-[#20201d]'
                : todo.status === 'blocked'
                  ? 'bg-[#fff7f4] text-[#9b3d30]'
                  : 'text-[#6f7168]'
            }`}
          >
            <TodoStatusIcon status={todo.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{todo.title}</div>
              <div className="line-clamp-1 text-[11px] text-[#8f897a]">{todo.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HiveTelemetryStrip() {
  const telemetry = useAppStore((state) => state.hiveTelemetry)
  const items: Array<[string, number]> = [
    ['计划', telemetry.plannedAgents],
    ['活跃', telemetry.activeAgents],
    ['完成', telemetry.completedAgents],
    ['跳过', telemetry.skippedAgents],
    ['失败', telemetry.failedAgents],
  ]

  return (
    <div className="mb-2 grid grid-cols-5 gap-1 rounded-lg border border-[#d7aa4f]/35 bg-[#fff6df]/82 p-1.5">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md bg-[#fffefa]/76 px-1.5 py-1 text-center">
          <div className="text-[10px] text-[#8f897a]">{label}</div>
          <div className="text-xs font-semibold tabular-nums text-[#2f2b22]">{value}</div>
        </div>
      ))}
    </div>
  )
}

function AgentStepRow({ step }: { step: AgentStep }) {
  const toggleAgentStepExpanded = useAppStore((state) => state.toggleAgentStepExpanded)
  const expanded = step.status === 'running' || step.isExpanded
  const content = [step.details, step.content].filter(Boolean).join('\n\n')

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className="relative pl-7"
    >
      <span className="absolute left-0 top-2 z-10 grid size-5 place-items-center rounded-full bg-[#fffefa]">
        <StepStatusIcon step={step} />
      </span>
      <div
        className={`rounded-md px-2.5 py-2 ${
          step.status === 'running'
            ? 'bg-[#fff8e8] ring-1 ring-[#d7aa4f]/55'
            : step.status === 'error'
              ? 'bg-[#fff7f4] ring-1 ring-[#d37b6d]/48'
              : 'hover:bg-[#fffdf7]'
        }`}
      >
        <button
          type="button"
          onClick={() => step.status !== 'running' && toggleAgentStepExpanded(step.id)}
          className="flex w-full items-center gap-2 text-left"
        >
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
            transition={{ duration: 0.16 }}
            className={step.status === 'running' ? 'opacity-40' : ''}
          >
            <ChevronDown size={13} />
          </motion.span>
        </button>

        <AnimatePresence initial={false}>
          {expanded && content ? (
            <motion.div
              key="content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-2 max-h-[200px] overflow-y-auto rounded-md bg-[#fffefa]/88 px-2 py-2 text-xs leading-5 text-[#6f7168]">
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
      </div>
    </motion.article>
  )
}

function StepStatusIcon({ step }: { step: AgentStep }) {
  if (step.status === 'running') {
    return <Loader2 size={12} className="animate-spin text-[#d7aa4f]" />
  }

  if (step.status === 'completed') {
    return <CheckCircle2 size={12} className="text-[#4f7a54]" />
  }

  if (step.status === 'error') {
    return <AlertCircle size={12} className="text-[#b85c4d]" />
  }

  return <Circle size={10} className="text-[#b9b09e]" />
}

function TodoStatusIcon({ status }: { status: AgentTodo['status'] }) {
  if (status === 'running') {
    return <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin text-[#d7aa4f]" />
  }

  if (status === 'completed') {
    return <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[#4f7a54]" />
  }

  if (status === 'blocked') {
    return <AlertCircle size={12} className="mt-0.5 shrink-0 text-[#b85c4d]" />
  }

  return <Circle size={10} className="mt-1 shrink-0 text-[#b9b09e]" />
}

function StepTypeIcon({ step }: { step: AgentStep }) {
  const className = 'shrink-0 text-[#8f897a]'

  if (step.type === 'tool') {
    return <Search size={12} className={className} />
  }

  if (step.type === 'sub_agent') {
    return <Wand2 size={12} className={className} />
  }

  if (step.type === 'generation') {
    return <PenLine size={12} className={className} />
  }

  return <Sparkles size={12} className={className} />
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
