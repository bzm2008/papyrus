import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardList,
  FileCheck2,
  FilePenLine,
  FolderKanban,
  History,
  LibraryBig,
  Loader2,
  RotateCcw,
  Search,
  Square,
  Undo2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type {
  AssistantApprovalChoice,
  AssistantApprovalRequest,
  AssistantToolCall,
  WorkAssistantRun,
} from '../services/workAssistantProtocol'
import {
  type AgentStep,
  type AgentTodo,
  type DocumentChangeStat,
  type DocumentPatch,
  type FlowMessage,
  type FlowTrace,
  type LlmRunState,
  type SecretaryPlanDraft,
} from '../stores/useAppStore'
import { SecretaryToolStep } from './SecretaryToolStep'

export type SecretaryContextSection = 'project' | 'materials' | 'memory' | 'history' | 'queue'

type SecretaryTimelineProps = {
  messages: FlowMessage[]
  todos?: AgentTodo[]
  steps?: AgentStep[]
  traces?: FlowTrace[]
  runState: LlmRunState
  planDraft?: SecretaryPlanDraft
  pendingPatch?: DocumentPatch
  changeStat?: DocumentChangeStat
  workAssistantRun?: WorkAssistantRun
  onExecutePlan?: () => void
  onCancelPlan?: () => void
  onApprove?: (approvalId: string, choice: AssistantApprovalChoice) => void
  onSelectTool?: (toolCallId: string) => void
  onRetryTool?: (toolCall: AssistantToolCall) => void
  onRegenerate?: () => void
  onRollback?: () => void
}

type TimelineItem =
  | { id: string; at: number; order: number; type: 'message'; message: FlowMessage }
  | { id: string; at: number; order: number; type: 'thinking' }
  | { id: string; at: number; order: number; type: 'plan'; plan: SecretaryPlanDraft }
  | { id: string; at: number; order: number; type: 'tool'; toolCall: AssistantToolCall }
  | { id: string; at: number; order: number; type: 'trace'; trace: FlowTrace }
  | { id: string; at: number; order: number; type: 'todo'; todo: AgentTodo }
  | { id: string; at: number; order: number; type: 'subagent'; title: string; status: string }
  | { id: string; at: number; order: number; type: 'patch'; patch: DocumentPatch }
  | { id: string; at: number; order: number; type: 'change'; changeStat: DocumentChangeStat }
  | { id: string; at: number; order: number; type: 'work-assistant-message'; text: string; status: WorkAssistantRun['status'] }
  | { id: string; at: number; order: number; type: 'run-status'; status: 'failed' | 'cancelled'; message?: string }

const contextSections: Array<{ id: SecretaryContextSection; label: string; Icon: typeof FolderKanban }> = [
  { id: 'project', label: '项目', Icon: FolderKanban },
  { id: 'materials', label: '资料', Icon: LibraryBig },
  { id: 'memory', label: '记忆', Icon: ClipboardList },
  { id: 'history', label: '历史与恢复', Icon: History },
  { id: 'queue', label: '后台队列', Icon: Loader2 },
]

const activityStates = new Set<LlmRunState>(['running', 'reconnecting', 'error'])

function buildSecretaryTimelineItems({
  messages,
  todos = [],
  steps = [],
  traces = [],
  runState,
  planDraft,
  pendingPatch,
  changeStat,
  workAssistantRun,
}: Omit<SecretaryTimelineProps, 'onApprove' | 'onSelectTool' | 'onRetryTool' | 'onRegenerate' | 'onRollback'>): TimelineItem[] {
  const visibleMessages = messages.filter((message) => message.role === 'user' || !message.agentId || message.agentId === 'writer')
  const items: TimelineItem[] = visibleMessages.map((message) => ({
    id: `message:${message.id}`,
    at: message.createdAt,
    order: 0,
    type: 'message',
    message,
  }))
  const latestUser = [...visibleMessages].reverse().find((message) => message.role === 'user')
  const latestAssistant = [...visibleMessages].reverse().find((message) => message.role === 'assistant')
  const hasVisibleReply = Boolean(latestAssistant && (!latestUser || latestAssistant.createdAt >= latestUser.createdAt))
  const showActivity = activityStates.has(runState) || Boolean(workAssistantRun && workAssistantRun.status !== 'idle')
  const workAssistantText = safeSecretaryDisplayText(workAssistantRun?.messageText ?? '')
  const hasWorkAssistantMessage = Boolean(
    workAssistantText
    && workAssistantRun
    && workAssistantRun.status !== 'idle'
    && !visibleMessages.some((message) => message.role === 'assistant' && sameAssistantMessage(message.content, workAssistantRun.messageText)),
  )

  if (showActivity && !hasVisibleReply && !hasWorkAssistantMessage && runState !== 'error') {
    items.push({ id: 'thinking', at: Math.max(latestUser?.createdAt ?? 0, workAssistantRun?.lastActivityAt ?? 0), order: 1, type: 'thinking' })
  }

  if (hasWorkAssistantMessage && workAssistantRun) {
    items.push({
      id: `work-assistant-message:${workAssistantRun.id}`,
      at: Math.max(latestUser?.createdAt ?? 0, workAssistantRun.lastActivityAt),
      order: 1,
      type: 'work-assistant-message',
      text: workAssistantText,
      status: workAssistantRun.status,
    })
  }

  if (planDraft && planDraft.status !== 'rejected') {
    items.push({ id: `plan:${planDraft.id}`, at: planDraft.updatedAt, order: 2, type: 'plan', plan: planDraft })
  }

  if (showActivity) {
    todos.forEach((todo) => {
      if (todo.agentId === 'writer' && todos.length === 1 && !workAssistantRun && runState === 'idle') return
      items.push({ id: `todo:${todo.id}`, at: todo.updatedAt || todo.createdAt, order: 3, type: 'todo', todo })
    })

    steps.forEach((step) => {
      if (step.type === 'sub_agent' && step.agentId !== 'writer') {
        items.push({ id: `step:${step.id}`, at: step.endedAt ?? step.startedAt, order: 4, type: 'subagent', title: step.title, status: step.status })
      }
    })

    traces
      .filter((trace) => trace.kind !== 'memory')
      .forEach((trace) => {
        items.push({ id: `trace:${trace.id}`, at: trace.endedAt ?? trace.startedAt, order: 6, type: 'trace', trace })
      })

    if (workAssistantRun) {
      Object.values(workAssistantRun.toolCalls).forEach((toolCall) => {
        items.push({ id: `tool:${toolCall.id}`, at: toolCall.endedAt ?? toolCall.startedAt, order: 5, type: 'tool', toolCall })
      })
      Object.values(workAssistantRun.subagents).forEach((subagent) => {
        items.push({
          id: `subagent:${subagent.id}`,
          at: subagent.endedAt ?? subagent.startedAt,
          order: 4,
          type: 'subagent',
          title: subagent.goal,
          status: subagent.status,
        })
      })
    }
  }

  if (pendingPatch && pendingPatch.status !== 'rejected') {
    items.push({ id: `patch:${pendingPatch.id}`, at: pendingPatch.createdAt, order: 7, type: 'patch', patch: pendingPatch })
  }
  if (changeStat) {
    items.push({ id: `change:${changeStat.id}`, at: changeStat.createdAt, order: 8, type: 'change', changeStat })
  }
  if (workAssistantRun?.status === 'failed' || workAssistantRun?.status === 'cancelled') {
    items.push({
      id: `run:${workAssistantRun.id}:${workAssistantRun.status}`,
      at: workAssistantRun.lastActivityAt,
      order: 9,
      type: 'run-status',
      status: workAssistantRun.status,
      message: safeSecretaryDisplayText(workAssistantRun.error ?? ''),
    })
  }

  return items.sort((left, right) => left.at - right.at || left.order - right.order || left.id.localeCompare(right.id))
}

export function SecretaryTimeline({
  messages,
  todos,
  steps,
  traces,
  runState,
  planDraft,
  pendingPatch,
  changeStat,
  workAssistantRun,
  onExecutePlan,
  onCancelPlan,
  onApprove,
  onSelectTool,
  onRetryTool,
  onRegenerate,
  onRollback,
}: SecretaryTimelineProps) {
  const items = useMemo(
    () => buildSecretaryTimelineItems({ messages, todos, steps, traces, runState, planDraft, pendingPatch, changeStat, workAssistantRun }),
    [changeStat, messages, pendingPatch, planDraft, runState, steps, todos, traces, workAssistantRun],
  )
  const latestAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id

  return (
    <div aria-label="秘书执行时间线" className="space-y-3">
      {items.map((item) => (
        <article key={item.id} data-testid="secretary-timeline-entry" className="relative pl-7">
          <span aria-hidden="true" className="absolute left-0 top-3 size-2.5 rounded-full border border-[#cfc6b4] bg-[#fffefa]" />
          {item.type === 'message' ? (
            <MessageEntry
              message={item.message}
              isLatestAssistant={item.message.id === latestAssistantId}
              isStreaming={item.message.id === latestAssistantId && runState !== 'idle' && runState !== 'error'}
              onRegenerate={onRegenerate}
              onRollback={onRollback}
            />
          ) : null}
          {item.type === 'thinking' ? <ThinkingEntry runState={runState} /> : null}
          {item.type === 'plan' ? <PlanEntry plan={item.plan} onExecute={onExecutePlan} onCancel={onCancelPlan} /> : null}
          {item.type === 'tool' ? (
            <SecretaryToolStep
              toolCall={publicToolCall(item.toolCall)}
              approval={approvalFor(item.toolCall)}
              defaultExpanded={item.toolCall.status === 'awaiting_approval'}
              onApprove={(choice) => item.toolCall.preview && onApprove?.(item.toolCall.preview.id, choice)}
              onSelect={() => onSelectTool?.(item.toolCall.id)}
              onRetry={item.toolCall.result?.recoverable ? () => onRetryTool?.(item.toolCall) : undefined}
            />
          ) : null}
          {item.type === 'trace' ? <TraceEntry trace={item.trace} /> : null}
          {item.type === 'todo' ? <TodoEntry todo={item.todo} /> : null}
          {item.type === 'subagent' ? <SubagentEntry title={item.title} status={item.status} /> : null}
          {item.type === 'patch' ? <PatchEntry patch={item.patch} /> : null}
          {item.type === 'change' ? <ChangeEntry changeStat={item.changeStat} /> : null}
          {item.type === 'work-assistant-message' ? <WorkAssistantMessageEntry text={item.text} status={item.status} /> : null}
          {item.type === 'run-status' ? <RunStatusEntry status={item.status} message={item.message} /> : null}
        </article>
      ))}
    </div>
  )
}

export function SecretaryContextDrawer({
  open,
  activeSection,
  onSectionChange,
  onClose,
  children,
}: {
  open: boolean
  activeSection: SecretaryContextSection
  onSectionChange: (section: SecretaryContextSection) => void
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
  }, [open])

  const close = () => {
    onClose()
    returnFocusRef.current?.focus()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-[#201f1a]/20 p-3 sm:p-4" onMouseDown={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="项目上下文"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-[420px] flex-col overflow-hidden rounded-lg border border-[#e1dccf] bg-[#fffefa] shadow-[0_24px_80px_rgba(43,34,19,0.18)]"
      >
        <header className="papyrus-toolbar flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <FolderKanban size={15} className="text-[#4f7a54]" />
          <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#20201d]">项目上下文</div>
          <button type="button" title="关闭项目上下文" aria-label="关闭项目上下文" onClick={close} className="papyrus-icon-button size-7 rounded-md">
            <X size={15} />
          </button>
        </header>
        <nav aria-label="项目上下文导航" className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#eee4d3] px-2 py-2">
          {contextSections.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={activeSection === id}
              onClick={() => onSectionChange(id)}
              className={`grid size-8 shrink-0 place-items-center rounded-md ${activeSection === id ? 'bg-[#20201d] text-[#fffefa]' : 'text-[#6f7168] hover:bg-[#f0eee7]'}`}
            >
              <Icon size={15} />
            </button>
          ))}
        </nav>
        <div className="papyrus-scrollbar min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function MessageEntry({
  message,
  isLatestAssistant,
  isStreaming,
  onRegenerate,
  onRollback,
}: {
  message: FlowMessage
  isLatestAssistant: boolean
  isStreaming: boolean
  onRegenerate?: () => void
  onRollback?: () => void
}) {
  const isUser = message.role === 'user'
  const displayContent = isUser ? message.content : safeSecretaryDisplayText(message.content)
  return (
    <div className={`max-w-[880px] rounded-lg px-3.5 py-2.5 text-sm leading-7 ${isUser ? 'ml-auto bg-[#20201d] text-[#fffefa]' : 'border border-[#e1dccf] bg-[#fffdf7] text-[#2f2b22]'}`}>
      <div className={`mb-1 flex items-center gap-2 text-[11px] font-medium ${isUser ? 'text-[#d6d0c4]' : 'text-[#6f7168]'}`}>
        <span>{isUser ? '你' : '铭荼'}</span>
        {isStreaming ? <span className="text-[#a36f20]">正在回应</span> : null}
      </div>
      <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{displayContent}</div>
      {!isUser && isLatestAssistant && !isStreaming && (onRegenerate || onRollback) ? (
        <div className="mt-2 flex items-center gap-1 border-t border-[#e8e0d1] pt-2">
          {onRegenerate ? <IconAction label="重新生成" onClick={onRegenerate}><RotateCcw size={13} /></IconAction> : null}
          {onRollback ? <IconAction label="撤回本轮" onClick={onRollback}><Undo2 size={13} /></IconAction> : null}
        </div>
      ) : null}
    </div>
  )
}

function ThinkingEntry({ runState }: { runState: LlmRunState }) {
  return (
    <div className="flex max-w-[420px] items-center gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffaf0] px-3 py-2 text-xs text-[#6b5220]">
      <Loader2 size={14} className={runState === 'reconnecting' ? '' : 'animate-spin'} />
      <span>{runState === 'reconnecting' ? '铭荼正在恢复连接' : '铭荼正在整理下一步'}</span>
    </div>
  )
}

function WorkAssistantMessageEntry({ text, status }: { text: string; status: WorkAssistantRun['status'] }) {
  const streaming = status === 'running'
  const statusLabel = status === 'cancelled'
    ? '电脑助手 · 已停止'
    : status === 'failed'
      ? '电脑助手 · 未完成'
      : status === 'completed'
        ? '电脑助手 · 已完成'
        : status === 'awaiting_approval'
          ? '电脑助手 · 等待确认'
          : '电脑助手 · 实时回应'

  return (
    <div data-testid="secretary-work-assistant-message" className={`max-w-[880px] rounded-lg border px-3.5 py-2.5 text-sm leading-7 ${status === 'cancelled' || status === 'failed' ? 'border-[#e8c9bf] bg-[#fff8f4] text-[#2f2b22]' : 'border-[#e1dccf] bg-[#fffdf7] text-[#2f2b22]'}`}>
      <div className={`mb-1 text-[11px] font-medium ${status === 'cancelled' || status === 'failed' ? 'text-[#9a4338]' : 'text-[#6f7168]'}`}>{statusLabel}</div>
      <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {text}
        {streaming ? <span data-testid="secretary-stream-cursor" aria-hidden="true" className="ml-0.5 inline-block h-4 w-1 rounded-full bg-[#d7aa4f]" /> : null}
      </div>
    </div>
  )
}

function PlanEntry({ plan, onExecute, onCancel }: { plan: SecretaryPlanDraft; onExecute?: () => void; onCancel?: () => void }) {
  return (
    <section className="max-w-[880px] border-l-2 border-[#7c9273] py-1 pl-3 text-sm text-[#2f2b22]">
      <div className="flex items-center gap-2 text-xs font-semibold text-[#3f5845]"><ClipboardList size={14} />公开计划</div>
      <div className="mt-1 text-xs text-[#6f7168]">{plan.request}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-6">{plan.planText}</div>
      {plan.status === 'draft' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#6f7168]">
          <span className="mr-auto">继续输入可修订计划，确认后才会执行。</span>
          {onCancel ? <button type="button" onClick={onCancel} className="papyrus-control h-7 rounded-md px-2 text-xs">取消计划</button> : null}
          {onExecute ? <button type="button" onClick={onExecute} className="papyrus-primary-button h-7 rounded-md px-2 text-xs">开始执行</button> : null}
        </div>
      ) : null}
    </section>
  )
}

function TraceEntry({ trace }: { trace: FlowTrace }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="max-w-[720px] border-l border-[#d9cfbd] py-1 pl-3 text-xs text-[#6f7168]">
      <button type="button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? '收起轨迹' : '展开轨迹'} className="flex w-full items-center gap-2 text-left hover:text-[#2f2b22]">
        {expanded ? <ChevronDown size={13} /> : <Search size={13} />}
        <span className="min-w-0 flex-1 truncate">{trace.title || '执行轨迹'}</span>
        <span className="shrink-0">{traceStatusLabel(trace.status)}</span>
      </button>
      {expanded ? <div className="mt-1 rounded-md bg-[#f5f2ea] px-2 py-1.5 leading-5">{safeTraceDetail(trace)}</div> : null}
    </div>
  )
}

function TodoEntry({ todo }: { todo: AgentTodo }) {
  return (
    <div className="flex max-w-[620px] items-center gap-2 border-l border-[#d9cfbd] py-1 pl-3 text-xs text-[#6f7168]">
      <TodoIcon status={todo.status} />
      <span className="min-w-0 flex-1 truncate">{todo.title}</span>
      <span className="shrink-0">{todoStatusLabel(todo.status)}</span>
    </div>
  )
}

function SubagentEntry({ title, status }: { title: string; status: string }) {
  return (
    <div className="flex max-w-[620px] items-center gap-2 border-l border-[#d9cfbd] py-1 pl-3 text-xs text-[#6f7168]">
      <Bot size={13} className="shrink-0 text-[#7c9273]" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="shrink-0">{subagentStatusLabel(status)}</span>
    </div>
  )
}

function PatchEntry({ patch }: { patch: DocumentPatch }) {
  return (
    <div className="max-w-[760px] border-l-2 border-[#4f7a54] py-1 pl-3 text-sm text-[#315d39]">
      <div className="flex items-center gap-2 text-xs font-semibold"><FilePenLine size={14} />文稿补丁{patch.status === 'applied' ? '已写入' : '待确认'}</div>
      <div className="mt-1 truncate text-xs text-[#4f5c49]">{patch.title}</div>
    </div>
  )
}

function ChangeEntry({ changeStat }: { changeStat: DocumentChangeStat }) {
  return (
    <div className="flex max-w-[620px] items-center gap-2 border-l-2 border-[#4f7a54] py-1 pl-3 text-xs text-[#315d39]">
      <FileCheck2 size={14} />
      <span className="min-w-0 flex-1 truncate">{changeStat.title || '文稿成果已保存'}</span>
      <span className="shrink-0">{formatChange(changeStat)}</span>
    </div>
  )
}

function RunStatusEntry({ status, message }: { status: 'failed' | 'cancelled'; message?: string }) {
  const cancelled = status === 'cancelled'
  return (
    <div className={`flex max-w-[720px] items-start gap-2 border-l-2 py-2 pl-3 text-sm ${cancelled ? 'border-[#9d988a] text-[#625c50]' : 'border-[#b85c4d] text-[#9a4338]'}`}>
      {cancelled ? <Square size={14} /> : <AlertCircle size={15} />}
      <div>
        <div className="font-medium">{cancelled ? '本次执行已停止' : '本次执行未完成'}</div>
        {message ? <div className="mt-1 text-xs leading-5">{message}</div> : null}
      </div>
    </div>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className="papyrus-icon-button grid size-7 place-items-center rounded-md">{children}</button>
}

function publicToolCall(toolCall: AssistantToolCall): AssistantToolCall {
  return { ...toolCall, arguments: {} }
}

const sensitiveDisplayFieldPattern = /(["']?)\b(elementtoken|token|secret|password|passcode|api(?:[_ -]?key)|authorization|cookie)\b\1\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]*)/gi
const authorizationSchemePattern = /\b(authorization)\s+(?:basic|bearer)\b[^\r\n]*/gi
const bearerCredentialPattern = /\bbearer\s+[^\r\n]*/gi

function safeSecretaryDisplayText(text: string) {
  return text
    .trim()
    .replace(sensitiveDisplayFieldPattern, (_match, _quote: string, key: string) => `${key}: [已隐藏]`)
    .replace(authorizationSchemePattern, (_match, key: string) => `${key}: [已隐藏]`)
    .replace(bearerCredentialPattern, 'Bearer [已隐藏]')
    .slice(0, 4000)
}

function sameAssistantMessage(flowText: string, workAssistantText: string) {
  return normalizeAssistantMessage(flowText) === normalizeAssistantMessage(workAssistantText)
}

function normalizeAssistantMessage(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function approvalFor(toolCall: AssistantToolCall): AssistantApprovalRequest | undefined {
  if (toolCall.status !== 'awaiting_approval' || !toolCall.preview) return undefined
  const preview = toolCall.preview as Partial<AssistantApprovalRequest>
  return {
    ...toolCall.preview,
    runId: preview.runId ?? toolCall.runId,
    toolCallId: preview.toolCallId ?? toolCall.id,
    reason: preview.reason ?? '需要你的确认后才能继续。',
    allowedChoices: preview.allowedChoices ?? ['once', 'deny'],
    action: preview.action,
    origin: preview.origin,
    pageTitle: preview.pageTitle,
    elementName: preview.elementName,
  }
}

function safeTraceDetail(trace: FlowTrace) {
  if (trace.kind === 'document') return trace.detail.slice(0, 280)
  if (trace.kind === 'tool') return '工具执行记录仅在需要时展开。'
  return trace.title
}

function traceStatusLabel(status: FlowTrace['status']) {
  return status === 'running' ? '进行中' : status === 'completed' ? '完成' : status === 'error' ? '失败' : '等待'
}

function todoStatusLabel(status: AgentTodo['status']) {
  return status === 'running' ? '进行中' : status === 'completed' ? '完成' : status === 'blocked' ? '受阻' : status === 'skipped' ? '跳过' : '等待'
}

function subagentStatusLabel(status: string) {
  return status === 'running' ? '进行中' : status === 'completed' ? '完成' : status === 'failed' ? '失败' : status === 'cancelled' ? '已停止' : status === 'skipped' ? '跳过' : '等待'
}

function formatChange(changeStat: DocumentChangeStat) {
  const inserted = changeStat.insertedChars ? `+${changeStat.insertedChars}` : ''
  const deleted = changeStat.deletedChars ? `-${changeStat.deletedChars}` : ''
  return [inserted, deleted].filter(Boolean).join(' ') || `${changeStat.changedChars} 字`
}

function TodoIcon({ status }: { status: AgentTodo['status'] }) {
  if (status === 'running') return <Loader2 size={13} className="shrink-0 animate-spin text-[#a36f20]" />
  if (status === 'completed') return <CheckCircle2 size={13} className="shrink-0 text-[#4f7a54]" />
  if (status === 'blocked') return <AlertCircle size={13} className="shrink-0 text-[#b85c4d]" />
  return <Circle size={11} className="shrink-0 text-[#9d988a]" />
}
