import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2,
  Clipboard,
  FileText,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  RotateCcw,
  Send,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Undo2,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAgentStream } from '../hooks/useAgentStream'
import { approveDocumentPatch, rejectDocumentPatch } from '../services/documentPatchService'
import { sendFlowMessage } from '../services/flowOrchestrator'
import { type AgentStep, type FlowMessage, type FlowReviewMode, useAppStore } from '../stores/useAppStore'
import { AgentTraceRenderer } from './AgentTraceRenderer'
import { EditorPane } from './EditorPane'
import { ModelSelector } from './ModelSelector'
import { SlashCommandMenu } from './SlashCommandMenu'
import { applySlashCommand, type SlashCommand } from './slashCommands'

type AgentTodos = ReturnType<typeof useAppStore.getState>['agentTodos']

export function FlowWorkspace() {
  const [prompt, setPrompt] = useState('')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const flowMessages = useAppStore((state) => state.flowMessages)
  const setFlowMessages = useAppStore((state) => state.setFlowMessages)
  const agentTodos = useAppStore((state) => state.agentTodos)
  const agentSteps = useAppStore((state) => state.agentSteps)
  const llmRunState = useAppStore((state) => state.llmRunState)
  const pendingDocumentPatch = useAppStore((state) => state.pendingDocumentPatch)
  useAgentStream()
  const visibleMessages = flowMessages.filter(
    (message) => message.role === 'user' || !message.agentId || message.agentId === 'writer',
  )
  const latestAssistantId = [...visibleMessages]
    .reverse()
    .find((message) => message.role === 'assistant')?.id

  const submitFlowPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!prompt.trim() || llmRunState === 'running') {
      return
    }

    const value = prompt
    setPrompt('')
    void sendFlowMessage(value)
  }

  const pickCommand = (command: SlashCommand) => {
    setPrompt((value) => applySlashCommand(value, command))
  }

  const regenerateLast = () => {
    if (llmRunState === 'running') {
      return
    }

    const lastAssistantIndex = findLastVisibleAssistantIndex(flowMessages)
    const promptIndex = findUserBeforeIndex(
      flowMessages,
      lastAssistantIndex < 0 ? flowMessages.length : lastAssistantIndex,
    )
    const promptMessage = promptIndex >= 0 ? flowMessages[promptIndex] : undefined

    if (!promptMessage) {
      return
    }

    setFlowMessages(flowMessages.slice(0, promptIndex))
    void sendFlowMessage(promptMessage.content)
  }

  const rollbackLast = () => {
    const lastAssistantIndex = findLastVisibleAssistantIndex(flowMessages)

    if (lastAssistantIndex >= 0) {
      const promptIndex = findUserBeforeIndex(flowMessages, lastAssistantIndex)
      setFlowMessages(flowMessages.slice(0, promptIndex >= 0 ? promptIndex : lastAssistantIndex))
    }
  }

  return (
    <section className="flex h-full min-h-0 bg-[#fbfaf6]">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#eee8dc] bg-[#fffefa] px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-8 place-items-center rounded-lg bg-[#20201d] text-[#fffefa]">
              <PenLine size={16} />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-[#20201d]">Flow</div>
              <div className="truncate text-xs text-[#86857c]">主笔自主规划，必要时调用工具和子 Agent</div>
            </div>
          </div>

          <button
            type="button"
            title={sidebarVisible ? '隐藏文稿' : '显示文稿'}
            onClick={() => setSidebarVisible((visible) => !visible)}
            className="papyrus-icon-button inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm"
          >
            {sidebarVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            <span>{sidebarVisible ? '隐藏文稿' : '显示文稿'}</span>
          </button>
        </header>

        <div className="papyrus-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto flex min-h-full w-full max-w-[900px] flex-col">
            {pendingDocumentPatch ? <PendingPatchReview /> : null}

            <div className="flex-1 space-y-4">
              <AnimatePresence initial={false}>
                {visibleMessages.map((message) => (
                  <ChatBubble
                    key={message.id}
                    message={message}
                    showTrace={message.id === latestAssistantId}
                    steps={agentSteps}
                  />
                ))}
                {llmRunState === 'running' && !latestAssistantId ? (
                  <ThinkingBubble key="thinking" todos={agentTodos} steps={agentSteps} />
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-[#eee8dc] bg-[#fffefa] px-4 py-3">
          <form
            onSubmit={submitFlowPrompt}
            className="mx-auto max-w-[900px] rounded-xl border border-[#e8ddc7] bg-white p-2 shadow-[0_8px_24px_rgba(43,34,19,0.05)]"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
              <ModelSelector compact />
              <ReviewModeInline />
              <button
                type="button"
                title="重新生成上一轮"
                onClick={regenerateLast}
                disabled={llmRunState === 'running'}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2 text-xs text-[#6f7168] transition hover:text-[#171714] disabled:opacity-50"
              >
                <RotateCcw size={13} />
                重生成
              </button>
              <button
                type="button"
                title="回退上一轮"
                onClick={rollbackLast}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2 text-xs text-[#6f7168] transition hover:text-[#171714]"
              >
                <Undo2 size={13} />
                回退
              </button>
            </div>
            <div className="relative flex items-end gap-2">
              <SlashCommandMenu scope="flow" value={prompt} onPick={pickCommand} />
              <textarea
                aria-label="Flow 指令"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="把写作目标交给主笔，输入 / 唤起指令..."
                rows={1}
                className="max-h-32 min-h-10 min-w-0 flex-1 resize-none border-none bg-transparent px-2 py-2 text-sm leading-6 text-[#2f2b22] outline-none placeholder:text-[#aaa398]"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <button
                type="submit"
                title="发送给主笔"
                disabled={llmRunState === 'running'}
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#20201d] text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-wait disabled:opacity-50"
              >
                <Send size={16} />
              </button>
            </div>
          </form>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {sidebarVisible ? (
          <motion.aside
            key="flow-manuscript-sidebar"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 460, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="min-h-0 shrink-0 overflow-hidden border-l border-[#eee8dc] bg-[#fffefa]"
          >
            <div className="flex h-12 items-center gap-2 border-b border-[#eee8dc] px-3 text-sm font-medium text-[#2f2b22]">
              <FileText size={16} className="text-[#6f7f68]" />
              文稿
            </div>
            <div className="h-[calc(100%-3rem)] min-h-0">
              <EditorPane />
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </section>
  )
}

function PendingPatchReview() {
  const patch = useAppStore((state) => state.pendingDocumentPatch)
  const flowReviewMode = useAppStore((state) => state.flowReviewMode)

  if (!patch || patch.status === 'rejected') {
    return null
  }

  return (
    <section className="mb-4 rounded-lg border border-[#ded5c5] bg-[#fffaf0] p-3 text-[#3f5845]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <PenLine size={15} />
            {patch.status === 'applied'
              ? '正文已写入文稿'
              : flowReviewMode === 'auto'
                ? 'Auto 正在写入文稿'
                : '待写入文稿'}
          </div>
          <p className="mt-1 text-sm leading-6 text-[#4f5c49]">
            {patch.title} · {patch.operation}
          </p>
          <p className="mt-2 max-h-16 overflow-hidden text-xs leading-5 text-[#6f7168]">
            {patch.content}
          </p>
        </div>
        {patch.status === 'pending' && flowReviewMode === 'review' ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={approveDocumentPatch}
              className="h-8 rounded-lg bg-[#20201d] px-3 text-xs font-medium text-[#fffefa] transition hover:bg-[#3f5845]"
            >
              写入文稿
            </button>
            <button
              type="button"
              onClick={rejectDocumentPatch}
              className="h-8 rounded-lg border border-[#d9c69c] px-3 text-xs font-medium text-[#6f7168] transition hover:bg-[#fffefa]"
            >
              拒绝
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function ChatBubble({
  message,
  showTrace,
  steps,
}: {
  message: FlowMessage
  showTrace: boolean
  steps: AgentStep[]
}) {
  const isUser = message.role === 'user'
  const shouldShowTrace = !isUser && showTrace && steps.length > 0

  return (
    <motion.div
      layout
      exit={{ opacity: 0, y: -8, scale: 0.99 }}
      className={`group flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className={`min-w-0 overflow-hidden rounded-xl border px-4 py-3 text-sm leading-7 shadow-[0_8px_24px_rgba(43,34,19,0.05)] ${
          isUser
            ? 'max-w-[78%] border-[#20201d] bg-[#20201d] text-[#fffefa]'
            : 'w-full max-w-[860px] border-[#eee8dc] bg-white text-[#2f2b22]'
        }`}
      >
        <div
          className={`mb-1 flex items-center justify-between gap-3 text-xs font-medium ${
            isUser ? 'text-[#d6d0c4]' : 'text-[#3f5845]'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            {isUser ? <MessageSquare size={13} /> : <PenLine size={13} />}
            {isUser ? '你' : '主笔'}
          </span>
          <button
            type="button"
            title="复制"
            onClick={() => void navigator.clipboard?.writeText(message.content)}
            className={`rounded-md p-1 opacity-0 transition group-hover:opacity-100 ${
              isUser ? 'hover:bg-white/10' : 'hover:bg-[#f4ead8]'
            }`}
          >
            <Clipboard size={13} />
          </button>
        </div>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
        {shouldShowTrace ? <AgentTraceRenderer steps={steps} /> : null}
      </motion.div>
    </motion.div>
  )
}

function ThinkingBubble({ todos, steps }: { todos: AgentTodos; steps: AgentStep[] }) {
  const [elapsed, setElapsed] = useState(0)
  const [stageIndex, setStageIndex] = useState(0)
  const activeTodo = todos.find((todo) => todo.status === 'running') ?? todos.find((todo) => todo.status === 'pending')
  const latestStep = [...steps].reverse().find((step) => step.status === 'running') ?? steps.at(-1)
  const stages = useMemo(() => ['规划', '检索', '结构', '起草', '审阅', '润色'], [])

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000)
    const stageTimer = window.setInterval(
      () => setStageIndex((value) => (value + 1) % stages.length),
      1800,
    )

    return () => {
      window.clearInterval(timer)
      window.clearInterval(stageTimer)
    }
  }, [stages.length])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.99 }}
      className="flex justify-start"
    >
      <div className="max-w-[78%] rounded-xl border border-[#eee8dc] bg-white px-4 py-3 text-sm text-[#6f7168] shadow-[0_8px_24px_rgba(43,34,19,0.05)]">
        <div className="flex items-start justify-between gap-4">
          <span className="inline-flex items-center gap-2">
            <Sparkles size={14} className="animate-pulse text-[#d7aa4f]" />
            主笔正在执行
            <TypingDots />
          </span>
          <span className="shrink-0 rounded-full bg-[#f5f2ea] px-2 py-0.5 text-[11px] text-[#8f897a]">
            {formatElapsed(elapsed)}
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-[#eee8dc] bg-[#fffefa]">
          <motion.div
            className="h-1 bg-[#6f7f68]"
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="grid gap-2 p-3">
            <AnimatePresence mode="wait">
              <motion.div
                key={stageIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="text-xs font-medium text-[#2f2b22]"
              >
                {stages[stageIndex]}
              </motion.div>
            </AnimatePresence>
            <div className="text-xs leading-5 text-[#6f7168]">
              {activeTodo?.title || latestStep?.title || '正在生成可用结果'}
            </div>
            {latestStep?.details || latestStep?.content ? (
              <div className="line-clamp-2 text-[11px] leading-5 text-[#8f897a]">
                {latestStep.details || latestStep.content}
              </div>
            ) : null}
          </div>
        </div>
        {steps.length ? <AgentTraceRenderer steps={steps} /> : null}
      </div>
    </motion.div>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex w-5 items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="size-1 rounded-full bg-[#d7aa4f]"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.14 }}
        />
      ))}
    </span>
  )
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60

  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

function ReviewModeInline() {
  const flowReviewMode = useAppStore((state) => state.flowReviewMode)
  const setFlowReviewMode = useAppStore((state) => state.setFlowReviewMode)
  const modes: Array<{ value: FlowReviewMode; label: string; icon: typeof ToggleLeft }> = [
    { value: 'auto', label: 'Auto', icon: ToggleLeft },
    { value: 'review', label: '审阅', icon: ToggleRight },
  ]

  return (
    <div className="flex h-8 items-center rounded-lg border border-[#e8ddc7] bg-[#fffefa] p-0.5">
      {modes.map((mode) => {
        const Icon = mode.icon
        const active = flowReviewMode === mode.value

        return (
          <button
            key={mode.value}
            type="button"
            aria-pressed={active}
            onClick={() => setFlowReviewMode(mode.value)}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition ${
              active ? 'bg-[#20201d] text-[#fffefa]' : 'text-[#6f7168] hover:text-[#171714]'
            }`}
          >
            {active ? <CheckCircle2 size={13} /> : <Icon size={13} />}
            {mode.label}
          </button>
        )
      })}
    </div>
  )
}

function findLastVisibleAssistantIndex(messages: FlowMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message.role === 'assistant' && (!message.agentId || message.agentId === 'writer')) {
      return index
    }
  }

  return -1
}

function findUserBeforeIndex(messages: FlowMessage[], beforeIndex: number) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return index
    }
  }

  return -1
}
