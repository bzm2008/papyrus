import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  FolderOpen,
  Loader2,
  PanelRightClose,
  Pin,
  PinOff,
  Sparkles,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { formatChangeStat } from '../services/documentChangeStatsService'
import { getModelCacheStats } from '../services/modelCallCacheService'
import {
  type AgentStep,
  type AgentTodo,
  type FlowTrace,
  type LlmRunState,
  useAppStore,
} from '../stores/useAppStore'

export type WorkbenchView = 'run' | 'files' | 'browser' | 'manuscript'

type WorkbenchProps = {
  todos: AgentTodo[]
  steps: AgentStep[]
  traces: FlowTrace[]
  runState: LlmRunState
  pinned: boolean
  activeView: WorkbenchView
  onViewChange: (view: WorkbenchView) => void
  onPinnedChange: (pinned: boolean) => void
  onClose: () => void
  manuscript: ReactNode
  files: ReactNode
  browser?: ReactNode
  changeStat?: ReturnType<typeof useAppStore.getState>['documentChangeStats'][number]
}

type ExecutionReceiptProps = {
  todos: AgentTodo[]
  steps: AgentStep[]
  traces: FlowTrace[]
  runState: LlmRunState
  changeStat?: ReturnType<typeof useAppStore.getState>['documentChangeStats'][number]
}

type ThoughtSummaryBlockProps = {
  steps: AgentStep[]
  running: boolean
}

type DelegationPreviewProps = {
  steps: AgentStep[]
}

type ToolItem = {
  id: string
  title: string
  detail: string
  status: 'pending' | 'running' | 'completed' | 'error'
  toolName?: string
  sources?: FlowTrace['sources']
  startedAt: number
  endedAt?: number
}

type AgentActivity = {
  id: string
  name: string
  detail: string
  status: AgentStep['status']
  colorClass: string
  startedAt: number
  endedAt?: number
}

const statusLabels: Record<ToolItem['status'], string> = {
  pending: '等待',
  running: '运行中',
  completed: '完成',
  error: '失败',
}

export function SecretaryWorkbenchPanel({
  todos,
  steps,
  traces,
  runState,
  pinned,
  activeView,
  onViewChange,
  onPinnedChange,
  onClose,
  manuscript,
  files,
  browser,
  changeStat,
}: WorkbenchProps) {
  const snapshot = useWorkbenchSnapshot(todos, steps, traces, changeStat)
  const desktopPlacement = pinned
    ? 'lg:static lg:inset-auto lg:z-auto lg:h-auto lg:w-[348px] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-[inset_1px_0_0_rgba(255,255,255,0.72)]'
    : 'lg:fixed lg:inset-y-3 lg:left-auto lg:right-3 lg:z-40 lg:h-auto lg:w-[348px] lg:rounded-2xl lg:border lg:shadow-[0_24px_80px_rgba(43,34,19,0.18)]'

  return (
    <motion.aside
      key="secretary-workbench"
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={{ type: 'spring', stiffness: 420, damping: 42, mass: 0.8 }}
      className={`fixed inset-x-3 bottom-3 z-40 h-[70vh] min-h-0 w-[calc(100vw-1.5rem)] shrink-0 overflow-hidden rounded-2xl border border-[#e1dccf] bg-[#fffefa]/86 shadow-[0_24px_80px_rgba(43,34,19,0.18)] backdrop-blur-xl ${desktopPlacement}`}
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="papyrus-toolbar flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <div className="grid size-7 place-items-center rounded-lg bg-[#20201d] text-[#fffefa]">
            {activeView === 'run' ? <Sparkles size={14} /> : activeView === 'files' ? <FolderOpen size={14} /> : <FileText size={14} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-[#20201d]">
              {activeView === 'run' ? '执行工作台' : activeView === 'files' ? '文件工作台' : activeView === 'browser' ? '浏览器工作台' : '文稿'}
            </div>
            <div className="truncate text-[11px] text-[#8f897a]">
              {activeView === 'run'
                ? runState === 'running'
                  ? '实时跟踪本轮协作'
                  : '本轮执行记录'
                : activeView === 'files' ? '预览与执行回执' : activeView === 'browser' ? '当前标签页与受控动作' : '当前作品内容'}
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-[#e8ddc7] bg-[#f8f4ea] p-0.5">
            <button
              type="button"
              onClick={() => onViewChange('run')}
              className={`h-6 rounded-md px-2 text-[11px] font-medium ${
                activeView === 'run'
                  ? 'bg-[#20201d] text-[#fffefa]'
                  : 'text-[#6f7168] hover:bg-[#fffefa] hover:text-[#20201d]'
              }`}
            >
              工作台
            </button>
            <button
              type="button"
              onClick={() => onViewChange('files')}
              className={`h-6 rounded-md px-2 text-[11px] font-medium ${activeView === 'files' ? 'bg-[#20201d] text-[#fffefa]' : 'text-[#6f7168] hover:bg-[#fffefa] hover:text-[#20201d]'}`}
            >
              文件
            </button>
            <button
              type="button"
              onClick={() => onViewChange('browser')}
              className={`h-6 rounded-md px-2 text-[11px] font-medium ${activeView === 'browser' ? 'bg-[#20201d] text-[#fffefa]' : 'text-[#6f7168] hover:bg-[#fffefa] hover:text-[#20201d]'}`}
            >
              浏览器
            </button>
            <button
              type="button"
              onClick={() => onViewChange('manuscript')}
              className={`h-6 rounded-md px-2 text-[11px] font-medium ${
                activeView === 'manuscript'
                  ? 'bg-[#20201d] text-[#fffefa]'
                  : 'text-[#6f7168] hover:bg-[#fffefa] hover:text-[#20201d]'
              }`}
            >
              文稿
            </button>
          </div>
          <button
            type="button"
            title={pinned ? '任务结束后自动收起' : '固定工作台'}
            onClick={() => onPinnedChange(!pinned)}
            className={`papyrus-icon-button size-7 rounded-md ${pinned ? 'text-[#315d39]' : ''}`}
          >
            {pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
          <button
            type="button"
            title="收起右栏"
            onClick={onClose}
            className="papyrus-icon-button size-7 rounded-md"
          >
            <PanelRightClose size={13} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {activeView === 'run' ? (
              <motion.div
                key="workbench-view"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="papyrus-scrollbar flex h-full min-h-0 flex-col overflow-y-auto px-3 py-3 [scrollbar-gutter:stable]"
              >
                <WorkbenchTodoList todos={todos} />
                <ToolCallCapsules items={snapshot.tools} />
                <AgentActivityList activities={snapshot.agents} />
                <ExecutionSummary snapshot={snapshot} runState={runState} />
              </motion.div>
            ) : activeView === 'files' ? (
              <motion.div key="files-view" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="h-full min-h-0">
                {files}
              </motion.div>
            ) : activeView === 'browser' ? (
              <motion.div key="browser-view" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="h-full min-h-0">
                {browser ?? <div className="p-4 text-sm text-[#817a6d]">浏览器工作台尚未连接。</div>}
              </motion.div>
            ) : (
              <motion.div
                key="manuscript-view"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="h-full min-h-0"
              >
                {manuscript}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.aside>
  )
}

export function ExecutionReceipt({ todos, steps, traces, runState, changeStat }: ExecutionReceiptProps) {
  const [expanded, setExpanded] = useState(false)
  const snapshot = useWorkbenchSnapshot(todos, steps, traces, changeStat)
  const hasActivity = snapshot.totalTodos > 0 || snapshot.tools.length > 0 || snapshot.agents.length > 0 || steps.length > 0

  if (!hasActivity) {
    return null
  }

  return (
    <section className="mt-3 overflow-hidden rounded-lg border border-[#e8ddc7]/78 bg-[#fffdf7]/74 text-xs text-[#6f7168]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ReceiptStatusIcon runState={runState} hasErrors={snapshot.hasErrors} />
        <span className="min-w-0 flex-1 truncate font-medium text-[#2f2b22]">
          执行回执 · {snapshot.completedTodos}/{Math.max(1, snapshot.actionableTodos)} 项 · {snapshot.tools.length} 工具 · {snapshot.agents.length} Agent
        </span>
        <span className="hidden shrink-0 tabular-nums text-[#8f897a] sm:inline">
          {formatDuration(snapshot.elapsedMs)}
        </span>
        {changeStat ? (
          <span className="shrink-0 rounded-md bg-[#edf6eb] px-1.5 py-0.5 text-[10px] font-medium text-[#315d39]">
            改 {changeStat.changedChars} 字
          </span>
        ) : null}
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.16 }}>
          <ChevronDown size={13} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="receipt-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-[#eee4d3]"
          >
            <div className="grid gap-2 p-2">
              <WorkbenchTodoList todos={todos} compact />
              <ToolCallCapsules items={snapshot.tools.slice(0, 8)} compact />
              <AgentActivityList activities={snapshot.agents.slice(0, 8)} compact />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}

export function ThoughtSummaryBlock({ steps, running }: ThoughtSummaryBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const thought = [...steps]
    .reverse()
    .find((step) => step.type === 'plan' || step.type === 'generation' || step.status === 'running')
  const content = publicStepSummary(thought)

  if (!running && !content) {
    return null
  }

  const preview = running && !content ? '思考中...' : truncateText(content, 15)

  return (
    <section className="mt-2 overflow-hidden rounded-lg border border-[#e8ddc7]/72 bg-[#fffdf7]/72 text-xs text-[#6f7168]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Brain size={13} className="shrink-0 text-[#d7aa4f]" />
        <span className="min-w-0 flex-1 truncate">{preview}</span>
        <span className="shrink-0 text-[11px] text-[#8f897a]">{expanded ? '收起' : '展开'}</span>
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.16 }}>
          <ChevronDown size={13} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && content ? (
          <motion.div
            key="thought-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-[#eee4d3]"
          >
            <div className="max-h-48 overflow-y-auto px-3 py-2 leading-5 text-[#5f6159]">
              {content}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}

export function DelegationPreview({ steps }: DelegationPreviewProps) {
  const agents = buildAgentActivities(steps).slice(0, 4)

  if (!agents.length) {
    return null
  }

  return (
    <section className="mt-2 space-y-1.5">
      {agents.map((agent) => (
        <div key={agent.id} className="rounded-lg bg-[#fffdf7]/76 px-3 py-2 text-xs text-[#6f7168]">
          <div className="flex items-center gap-2">
            <span className={`h-4 w-1 rounded-full ${agent.colorClass}`} />
            <span className="min-w-0 flex-1 truncate font-medium text-[#2f2b22]">
              → {agent.status === 'running' ? '正在委派给' : '已委派给'} {agent.name}
            </span>
            <AgentStatusPill status={agent.status} />
          </div>
          {agent.detail ? (
            <div className="mt-1 line-clamp-2 border-l border-[#e8ddc7] pl-3 leading-5">
              {agent.detail}
            </div>
          ) : null}
        </div>
      ))}
    </section>
  )
}

export function MarkdownMessage({ text, inverted = false }: { text: string; inverted?: boolean }) {
  const blocks = useMemo(() => parseMarkdownLite(text), [text])

  return (
    <div className={`space-y-2 break-words [overflow-wrap:anywhere] ${inverted ? 'text-[#fffefa]' : 'text-[#2f2b22]'}`}>
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <pre
              key={`${block.type}-${index}`}
              className={`papyrus-scrollbar overflow-x-auto rounded-lg px-3 py-2 text-xs leading-5 ${
                inverted ? 'bg-white/10 text-[#fffefa]' : 'bg-[#20201d] text-[#fffefa]'
              }`}
            >
              <code>{block.content}</code>
            </pre>
          )
        }

        if (block.type === 'quote') {
          return (
            <blockquote
              key={`${block.type}-${index}`}
              className={`border-l-2 pl-3 leading-7 ${inverted ? 'border-white/35 text-[#ece6d8]' : 'border-[#d7aa4f] text-[#5f6159]'}`}
            >
              {block.content}
            </blockquote>
          )
        }

        if (block.type === 'list') {
          return (
            <ul key={`${block.type}-${index}`} className="space-y-1 pl-4 leading-7">
              {block.items.map((item) => (
                <li key={item} className="list-disc">
                  {item}
                </li>
              ))}
            </ul>
          )
        }

        return (
          <p key={`${block.type}-${index}`} className="whitespace-pre-wrap leading-7">
            {block.content}
          </p>
        )
      })}
    </div>
  )
}

function WorkbenchTodoList({ todos, compact = false }: { todos: AgentTodo[]; compact?: boolean }) {
  const shouldReduceMotion = useReducedMotion()
  const actionable = todos.filter((todo) => todo.status !== 'skipped')
  const completed = actionable.filter((todo) => todo.status === 'completed').length
  const percent = actionable.length ? Math.round((completed / actionable.length) * 100) : 0

  if (!todos.length) {
    return (
      <section className="rounded-xl border border-[#e8ddc7]/72 bg-[#fffdf7]/72 p-3">
        <div className="text-xs font-semibold text-[#2f2b22]">任务清单</div>
        <div className="mt-2 text-xs text-[#8f897a]">等待秘书长生成执行步骤。</div>
      </section>
    )
  }

  return (
    <section className={`rounded-xl border border-[#e8ddc7]/72 bg-[#fffdf7]/72 ${compact ? 'p-2' : 'p-3'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#2f2b22]">任务清单</div>
        <div className="text-[11px] tabular-nums text-[#8f897a]">{completed}/{actionable.length || todos.length}</div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f0e6d2]">
        <motion.div
          className="h-full rounded-full bg-[#315d39]"
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className={`mt-2 grid ${compact ? 'gap-1' : 'gap-1.5'}`}>
        {todos.slice(0, compact ? 5 : 10).map((todo) => (
          <motion.div
            key={todo.id}
            layout
            animate={
              shouldReduceMotion || todo.status !== 'running'
                ? undefined
                : { boxShadow: ['0 0 0 rgba(49,93,57,0)', '0 0 0 1px rgba(49,93,57,0.14)', '0 0 0 rgba(49,93,57,0)'] }
            }
            transition={{ duration: 1.4, repeat: shouldReduceMotion || todo.status !== 'running' ? 0 : Infinity }}
            className={`relative flex items-start gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-xs ${
              todo.status === 'running'
                ? 'bg-[#edf6eb] text-[#20201d]'
                : todo.status === 'blocked'
                  ? 'bg-[#fff7f4] text-[#9b3d30]'
                  : todo.status === 'skipped'
                    ? 'text-[#aaa394]'
                    : 'text-[#6f7168]'
            }`}
          >
            {todo.status === 'running' && !shouldReduceMotion ? (
              <motion.span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-transparent via-white/45 to-transparent"
                initial={{ x: '-120%' }}
                animate={{ x: '520%' }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              />
            ) : null}
            <TodoStatusIcon status={todo.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{todo.title}</div>
              {!compact && todo.detail ? (
                <div className="line-clamp-2 text-[11px] leading-4 text-[#8f897a]">{todo.detail}</div>
              ) : null}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function ToolCallCapsules({ items, compact = false }: { items: ToolItem[]; compact?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = items.find((item) => item.id === selectedId)
  const shouldReduceMotion = useReducedMotion()

  return (
    <section className={`mt-3 rounded-xl border border-[#e8ddc7]/72 bg-[#fffdf7]/72 ${compact ? 'p-2' : 'p-3'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#2f2b22]">工具调用</div>
        <div className="text-[11px] tabular-nums text-[#8f897a]">{items.length}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.length ? (
          items.map((item) => (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => setSelectedId((value) => (value === item.id ? null : item.id))}
              animate={
                shouldReduceMotion || item.status !== 'running'
                  ? undefined
                  : { scale: [1, 1.015, 1] }
              }
              transition={{ duration: 1.2, repeat: shouldReduceMotion || item.status !== 'running' ? 0 : Infinity }}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] ${
                item.status === 'running'
                  ? 'border-[#d7aa4f]/45 bg-[#fff6df] text-[#5b4a24]'
                  : item.status === 'error'
                    ? 'border-[#d37b6d]/42 bg-[#fff7f4] text-[#9b3d30]'
                    : 'border-[#dce7d7] bg-[#edf6eb] text-[#315d39]'
              }`}
            >
              <ToolStatusIcon status={item.status} />
              <span className="truncate">{toolLabel(item)}</span>
              {!compact ? (
                <span className="shrink-0 text-[10px] opacity-70">
                  {statusLabels[item.status]}
                </span>
              ) : null}
            </motion.button>
          ))
        ) : (
          <div className="text-xs text-[#8f897a]">本轮暂未调用工具。</div>
        )}
      </div>
      <AnimatePresence initial={false}>
        {selected ? (
          <motion.div
            key={selected.id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-lg border border-[#eee4d3] bg-[#fffefa]/86 p-2 text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-[#2f2b22]">{selected.title}</span>
                <span className="tabular-nums text-[#8f897a]">{formatDuration(durationOf(selected))}</span>
              </div>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap leading-5 text-[#6f7168]">
                {selected.detail || '没有更多参数。'}
              </div>
              {selected.sources?.length ? (
                <div className="mt-2 space-y-1 border-t border-[#eee4d3] pt-2">
                  <div className="text-[11px] font-medium text-[#2f2b22]">来源</div>
                  {selected.sources.slice(0, 5).map((source) => (
                    <div key={source.url ?? source.title} className="truncate text-[11px] text-[#315d39]">
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
    </section>
  )
}

function AgentActivityList({ activities, compact = false }: { activities: AgentActivity[]; compact?: boolean }) {
  const hiveTelemetry = useAppStore((state) => state.hiveTelemetry)
  const shouldReduceMotion = useReducedMotion()

  return (
    <section className={`mt-3 rounded-xl border border-[#e8ddc7]/72 bg-[#fffdf7]/72 ${compact ? 'p-2' : 'p-3'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#2f2b22]">Agent 活动</div>
        <div className="text-[11px] tabular-nums text-[#8f897a]">{activities.length}</div>
      </div>
      {hiveTelemetry.enabled && !compact ? (
        <div className="mt-2 grid grid-cols-5 gap-1">
          {[
            ['计划', hiveTelemetry.plannedAgents],
            ['活跃', hiveTelemetry.activeAgents],
            ['完成', hiveTelemetry.completedAgents],
            ['跳过', hiveTelemetry.skippedAgents],
            ['失败', hiveTelemetry.failedAgents],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-[#fffefa]/78 px-1 py-1 text-center">
              <div className="text-[10px] text-[#8f897a]">{label}</div>
              <div className="text-xs font-semibold tabular-nums text-[#20201d]">{value}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2 grid gap-1.5">
        {activities.length ? (
          activities.map((activity) => (
            <motion.div
              key={activity.id}
              layout
              animate={
                shouldReduceMotion || activity.status !== 'running'
                  ? undefined
                  : { backgroundColor: ['rgba(255,254,250,0.7)', 'rgba(237,246,235,0.86)', 'rgba(255,254,250,0.7)'] }
              }
              transition={{ duration: 1.6, repeat: shouldReduceMotion || activity.status !== 'running' ? 0 : Infinity }}
              className="flex items-start gap-2 rounded-lg bg-[#fffefa]/70 px-2 py-1.5 text-xs"
            >
              <motion.span
                className={`mt-1 h-4 w-1 rounded-full ${activity.colorClass}`}
                animate={
                  shouldReduceMotion || activity.status !== 'running'
                    ? undefined
                    : { opacity: [0.55, 1, 0.55], scaleY: [0.75, 1.15, 0.75] }
                }
                transition={{ duration: 1, repeat: shouldReduceMotion || activity.status !== 'running' ? 0 : Infinity }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-[#2f2b22]">{activity.name}</span>
                  <AgentStatusPill status={activity.status} />
                </div>
                {!compact && activity.detail ? (
                  <div className="line-clamp-2 text-[11px] leading-4 text-[#8f897a]">{activity.detail}</div>
                ) : null}
              </div>
            </motion.div>
          ))
        ) : (
          <div className="text-xs text-[#8f897a]">本轮暂未委派子 Agent。</div>
        )}
      </div>
    </section>
  )
}

function ExecutionSummary({
  snapshot,
  runState,
}: {
  snapshot: ReturnType<typeof useWorkbenchSnapshot>
  runState: LlmRunState
}) {
  const contextUsedTokens = useAppStore((state) => state.contextUsedTokens)
  const effectiveContextLimitTokens = useAppStore((state) => state.effectiveContextLimitTokens)
  const activeProviderId = useAppStore((state) => state.activeProviderId)
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const modelRoutingMode = useAppStore((state) => state.modelRoutingMode)
  const documentChangeStats = useAppStore((state) => state.documentChangeStats)
  const cacheStats = getModelCacheStats()
  const totalChanged = documentChangeStats.reduce((sum, stat) => sum + stat.changedChars, 0)
  const contextPercent = Math.min(
    100,
    Math.round((contextUsedTokens / Math.max(1, effectiveContextLimitTokens)) * 100),
  )
  const modelLabel =
    modelRoutingMode === 'auto'
      ? 'Auto 调度'
      : providerConfigs[activeProviderId]?.label ?? '未选择'

  return (
    <section className="mt-3 rounded-xl border border-[#e8ddc7]/72 bg-[#fffdf7]/72 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-[#2f2b22]">执行摘要</div>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
            runState === 'running'
              ? 'bg-[#fff6df] text-[#5b4a24]'
              : snapshot.hasErrors
                ? 'bg-[#fff7f4] text-[#9b3d30]'
                : 'bg-[#edf6eb] text-[#315d39]'
          }`}
        >
          {runState === 'running' ? '运行中' : snapshot.hasErrors ? '有异常' : '已收束'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <SummaryMetric label="耗时" value={formatDuration(snapshot.elapsedMs)} />
        <SummaryMetric label="模型" value={modelLabel} />
        <SummaryMetric label="上下文" value={`${contextPercent}%`} />
        <SummaryMetric label="缓存" value={`${cacheStats.hitRate}%`} />
        <SummaryMetric label="本轮改字" value={snapshot.changeStat ? String(snapshot.changeStat.changedChars) : '0'} />
        <SummaryMetric label="累计改字" value={formatCompactNumber(totalChanged)} />
      </div>
      {snapshot.changeStat ? (
        <div className="mt-2 rounded-lg bg-[#edf6eb]/72 px-2 py-1.5 text-[11px] font-medium text-[#315d39]">
          {formatChangeStat(snapshot.changeStat.insertedChars, snapshot.changeStat.deletedChars)}
        </div>
      ) : null}
    </section>
  )
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-[#fffefa]/78 px-2 py-1.5">
      <div className="truncate text-[10px] text-[#8f897a]">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold tabular-nums text-[#20201d]">{value}</div>
    </div>
  )
}

function useWorkbenchSnapshot(
  todos: AgentTodo[],
  steps: AgentStep[],
  traces: FlowTrace[],
  changeStat?: ReturnType<typeof useAppStore.getState>['documentChangeStats'][number],
) {
  return useMemo(() => {
    const tools = buildToolItems(steps, traces)
    const agents = buildAgentActivities(steps)
    const actionableTodos = todos.filter((todo) => todo.status !== 'skipped').length
    const completedTodos = todos.filter((todo) => todo.status === 'completed').length
    const hasErrors =
      todos.some((todo) => todo.status === 'blocked') ||
      steps.some((step) => step.status === 'error') ||
      traces.some((trace) => trace.status === 'error')
    const timestamps = [
      ...todos.flatMap((todo) => [todo.createdAt, todo.updatedAt]),
      ...steps.flatMap((step) => [step.startedAt, step.endedAt ?? 0]),
      ...traces.flatMap((trace) => [trace.startedAt, trace.endedAt ?? 0]),
    ].filter((value) => value > 0)
    const startedAt = timestamps.length ? Math.min(...timestamps) : 0
    const endedAt = timestamps.length ? Math.max(...timestamps) : 0

    return {
      tools,
      agents,
      actionableTodos,
      completedTodos,
      totalTodos: todos.length,
      hasErrors,
      startedAt,
      endedAt,
      elapsedMs: Math.max(0, endedAt - startedAt),
      changeStat,
    }
  }, [todos, steps, traces, changeStat])
}

function buildToolItems(steps: AgentStep[], traces: FlowTrace[]): ToolItem[] {
  const traceItems = traces
    .filter((trace) => trace.kind === 'tool')
    .map((trace) => ({
      id: trace.id,
      title: normalizeToolTitle(trace.title, trace.toolName),
      detail: trace.detail,
      status: trace.status,
      toolName: trace.toolName,
      sources: trace.sources,
      startedAt: trace.startedAt,
      endedAt: trace.endedAt,
    }))
  const stepItems = steps
    .filter((step) => step.type === 'tool' && !traceItems.some((item) => item.toolName && item.toolName === step.toolName))
    .map((step) => ({
      id: step.id,
      title: normalizeToolTitle(step.title, step.toolName),
      detail: [step.details, step.content].filter(Boolean).join('\n\n'),
      status: step.status,
      toolName: step.toolName,
      sources: step.sources,
      startedAt: step.startedAt,
      endedAt: step.endedAt,
    }))

  return [...traceItems, ...stepItems].sort((a, b) => a.startedAt - b.startedAt)
}

function buildAgentActivities(steps: AgentStep[]): AgentActivity[] {
  return steps
    .filter((step) => step.type === 'sub_agent' && step.agentId && step.agentId !== 'writer')
    .map((step) => ({
      id: step.id,
      name: agentDisplayName(step.title, step.agentId),
      detail: [step.details, step.content].filter(Boolean).join('\n\n'),
      status: step.status,
      colorClass: agentColorClass(step.agentId ?? step.id),
      startedAt: step.startedAt,
      endedAt: step.endedAt,
    }))
    .sort((a, b) => a.startedAt - b.startedAt)
}

function publicStepSummary(step?: AgentStep) {
  if (!step) {
    return ''
  }

  const text = [step.details, step.content].filter(Boolean).join('\n\n').trim()

  if (!text) {
    return step.title
  }

  return text
}

function normalizeToolTitle(title: string, toolName?: string) {
  if (toolName === 'web_search') {
    return '联网搜索'
  }
  if (toolName === 'project_context') {
    return '项目上下文'
  }
  if (toolName === 'document_patch') {
    return '文稿写入'
  }
  if (/web search/i.test(title)) {
    return '联网搜索'
  }
  if (/project context/i.test(title)) {
    return '项目上下文'
  }

  return title || '工具调用'
}

function toolLabel(item: ToolItem) {
  if (item.toolName === 'web_search') {
    const query = item.detail.match(/查询[:：]\s*(.+)/)?.[1] ?? item.detail.match(/Query:\s*(.+)/)?.[1]
    return query ? `搜索：${truncateText(query, 18)}` : '联网搜索'
  }

  return item.title
}

function agentDisplayName(title: string, agentId?: string) {
  return title
    .replace(/^调用\s*Agent[:：]\s*/, '')
    .replace(/^调用/, '')
    .replace(/^准备\s*/, '')
    .trim() || agentId || '子 Agent'
}

function agentColorClass(agentId: string) {
  const colors = ['bg-[#315d39]', 'bg-[#d7aa4f]', 'bg-[#9b3d30]', 'bg-[#6f7f68]', 'bg-[#8b6f47]']
  const code = Array.from(agentId).reduce((sum, char) => sum + char.charCodeAt(0), 0)

  return colors[code % colors.length]
}

function durationOf(item: { startedAt: number; endedAt?: number }) {
  return Math.max(0, (item.endedAt ?? item.startedAt) - item.startedAt)
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0s'
  }

  const seconds = Math.max(1, Math.round(ms / 1000))

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60

  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

function truncateText(text: string, length: number) {
  const clean = text.replace(/\s+/g, ' ').trim()

  return clean.length > length ? `${clean.slice(0, length)}...` : clean
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) {
    return '0'
  }

  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`
  }

  return String(Math.round(value))
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

  return <span className="mt-1.5 size-2.5 shrink-0 rounded-full border border-[#b9b09e]" />
}

function ToolStatusIcon({ status }: { status: ToolItem['status'] }) {
  if (status === 'running') {
    return <Loader2 size={11} className="shrink-0 animate-spin" />
  }
  if (status === 'error') {
    return <AlertCircle size={11} className="shrink-0" />
  }
  if (status === 'completed') {
    return <CheckCircle2 size={11} className="shrink-0" />
  }

  return <Clock3 size={11} className="shrink-0" />
}

function AgentStatusPill({ status }: { status: AgentStep['status'] }) {
  return (
    <span
      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${
        status === 'running'
          ? 'bg-[#fff6df] text-[#5b4a24]'
          : status === 'error'
            ? 'bg-[#fff7f4] text-[#9b3d30]'
            : status === 'completed'
              ? 'bg-[#edf6eb] text-[#315d39]'
              : 'bg-[#f5f2ea] text-[#8f897a]'
      }`}
    >
      {status === 'running' ? '运行中' : status === 'completed' ? '完成' : status === 'error' ? '失败' : '等待'}
    </span>
  )
}

function ReceiptStatusIcon({ runState, hasErrors }: { runState: LlmRunState; hasErrors: boolean }) {
  if (runState === 'running') {
    return <Loader2 size={13} className="shrink-0 animate-spin text-[#d7aa4f]" />
  }
  if (hasErrors || runState === 'error') {
    return <AlertCircle size={13} className="shrink-0 text-[#b85c4d]" />
  }

  return <CheckCircle2 size={13} className="shrink-0 text-[#4f7a54]" />
}

function parseMarkdownLite(text: string): Array<
  | { type: 'paragraph'; content: string }
  | { type: 'code'; content: string }
  | { type: 'quote'; content: string }
  | { type: 'list'; items: string[] }
> {
  const lines = text.split('\n')
  const blocks: ReturnType<typeof parseMarkdownLite> = []
  let buffer: string[] = []
  let listBuffer: string[] = []
  let codeBuffer: string[] = []
  let inCode = false

  const flushParagraph = () => {
    if (buffer.length) {
      blocks.push({ type: 'paragraph', content: buffer.join('\n') })
      buffer = []
    }
  }
  const flushList = () => {
    if (listBuffer.length) {
      blocks.push({ type: 'list', items: listBuffer })
      listBuffer = []
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        blocks.push({ type: 'code', content: codeBuffer.join('\n') })
        codeBuffer = []
        inCode = false
      } else {
        flushParagraph()
        flushList()
        inCode = true
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph()
      listBuffer.push(line.replace(/^\s*[-*]\s+/, ''))
      continue
    }

    if (line.trim().startsWith('>')) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'quote', content: line.replace(/^\s*>\s?/, '') })
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    buffer.push(line)
  }

  if (inCode && codeBuffer.length) {
    blocks.push({ type: 'code', content: codeBuffer.join('\n') })
  }
  flushParagraph()
  flushList()

  return blocks.length ? blocks : [{ type: 'paragraph', content: text }]
}
