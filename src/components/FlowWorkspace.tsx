import { AnimatePresence, motion } from 'framer-motion'
import {
  Clipboard,
  FileText,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAgentStream } from '../hooks/useAgentStream'
import { createSecretaryPlanDraft, reviseSecretaryPlanDraft } from '../services/agentOrchestrator'
import { sendFlowMessage } from '../services/flowOrchestrator'
import { type AgentStep, type AgentTodo, type FlowMessage, useAppStore } from '../stores/useAppStore'
import { AgentTodoList, AgentTraceRenderer } from './AgentTraceRenderer'
import { EditorPane } from './EditorPane'
import { ModelSelector } from './ModelSelector'
import { PromptAssistMenu } from './PromptAssistMenu'
import { SlashCommandMenu } from './SlashCommandMenu'
import { applySlashCommand, resolveSlashCommandPrompt, type SlashCommand } from './slashCommands'

type AgentTodos = AgentTodo[]

export function FlowWorkspace() {
  const [prompt, setPrompt] = useState('')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const flowMessages = useAppStore((state) => state.flowMessages)
  const setFlowMessages = useAppStore((state) => state.setFlowMessages)
  const agentTodos = useAppStore((state) => state.agentTodos)
  const agentSteps = useAppStore((state) => state.agentSteps)
  const llmRunState = useAppStore((state) => state.llmRunState)
  const pendingDocumentPatch = useAppStore((state) => state.pendingDocumentPatch)
  const secretaryPlanDraft = useAppStore((state) => state.secretaryPlanDraft)
  const approveSecretaryPlanDraft = useAppStore((state) => state.approveSecretaryPlanDraft)
  const clearSecretaryPlanDraft = useAppStore((state) => state.clearSecretaryPlanDraft)
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
    const resolved = resolveSlashCommandPrompt(value)
    setPrompt('')

    if (secretaryPlanDraft && secretaryPlanDraft.status === 'draft') {
      void reviseSecretaryPlanDraft(resolved.displayPrompt)
      return
    }

    if (resolved.isPlanCommand) {
      const request = resolved.argumentsText || '请先写出要规划的任务'
      void createSecretaryPlanDraft(resolved.displayPrompt || '/plan', request)
      return
    }

    void sendFlowMessage(resolved.executionPrompt, { displayPrompt: resolved.displayPrompt })
  }

  const pickCommand = (command: SlashCommand) => {
    if (command.id === 'story-health') {
      useAppStore.getState().setStoryDashboardOpen(true)
    }
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

  const executePlan = () => {
    const draft = useAppStore.getState().secretaryPlanDraft

    if (!draft || llmRunState === 'running') {
      return
    }

    approveSecretaryPlanDraft()
    void sendFlowMessage(draft.executionPrompt, {
      displayPrompt: draft.request,
      approvedPlanId: draft.id,
    }).finally(() => {
      useAppStore.getState().clearSecretaryPlanDraft()
    })
  }

  return (
    <section className="flex h-full min-h-0 bg-[#fbfaf6]">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#e1dccf] bg-[#fffefa] px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-8 place-items-center rounded-lg bg-[#20201d] text-[#fffefa]">
              <PenLine size={16} />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-[#20201d]">秘书模式</div>
              <div className="truncate text-xs text-[#6f7168]">
                小说、作文、论证、资料和文学常识都可以交给主笔分流
              </div>
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
            {secretaryPlanDraft ? (
              <SecretaryPlanCard draft={secretaryPlanDraft} onExecute={executePlan} onCancel={clearSecretaryPlanDraft} />
            ) : null}
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

        <div className="shrink-0 border-t border-[#e1dccf] bg-[#fffefa] px-4 py-3">
          <form
            onSubmit={submitFlowPrompt}
            className="mx-auto max-w-[900px] rounded-xl border border-[#dfe4d6] bg-white p-2 shadow-[0_8px_24px_rgba(43,34,19,0.045)]"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
              <ModelSelector compact />
              <button
                type="button"
                title="重新生成上一轮"
                onClick={regenerateLast}
                disabled={llmRunState === 'running'}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dfe4d6] bg-[#fffefa] px-2 text-xs text-[#6f7168] transition hover:text-[#171714] disabled:opacity-50"
              >
                <RotateCcw size={13} />
                重生成
              </button>
              <button
                type="button"
                title="回退上一轮"
                onClick={rollbackLast}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dfe4d6] bg-[#fffefa] px-2 text-xs text-[#6f7168] transition hover:text-[#171714]"
              >
                <Undo2 size={13} />
                回退
              </button>
              <span className="rounded-full bg-[#edf6eb] px-2 py-1 text-[11px] text-[#315d39]">
                / 命令  @ 技能  # 文件
              </span>
            </div>
            <div className="relative flex items-end gap-2">
              <SlashCommandMenu scope="flow" value={prompt} onPick={pickCommand} />
              <PromptAssistMenu value={prompt} onChange={setPrompt} />
              <textarea
                aria-label="秘书模式指令"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="交给主笔：写章节、改作文、查资料、做论证。输入 / 命令，@ 技能，# 文件..."
                rows={1}
                className="max-h-32 min-h-10 min-w-0 flex-1 resize-none border-none bg-transparent px-2 py-2 text-sm leading-6 text-[#2f2b22] outline-none placeholder:text-[#8f897a]"
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
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#20201d] text-[#fffefa] transition hover:bg-[#315d39] disabled:cursor-wait disabled:opacity-50"
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
            className="min-h-0 shrink-0 overflow-hidden border-l border-[#e1dccf] bg-[#fffefa]"
          >
            <div className="flex h-12 items-center gap-2 border-b border-[#e1dccf] px-3 text-sm font-medium text-[#20201d]">
              <FileText size={16} className="text-[#315d39]" />
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

  if (!patch || patch.status === 'rejected') {
    return null
  }

  return (
    <section className="mb-4 rounded-lg border border-[#cfd8c7] bg-[#f4fbf2] p-3 text-[#315d39]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <PenLine size={15} />
            {patch.status === 'applied' ? '已写入文稿' : '正在写入文稿'}
          </div>
          <p className="mt-1 text-sm leading-6 text-[#4f5c49]">
            {patch.title} · {patch.operation}
          </p>
          <p className="mt-2 max-h-16 overflow-hidden text-xs leading-5 text-[#6f7168]">
            {patch.content}
          </p>
        </div>
      </div>
    </section>
  )
}

function SecretaryPlanCard({
  draft,
  onExecute,
  onCancel,
}: {
  draft: NonNullable<ReturnType<typeof useAppStore.getState>['secretaryPlanDraft']>
  onExecute: () => void
  onCancel: () => void
}) {
  const llmRunState = useAppStore((state) => state.llmRunState)

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-[#d8cfbd] bg-[#fffefa] shadow-[0_10px_28px_rgba(43,34,19,0.06)]">
      <div className="border-b border-[#eee4d3] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#20201d]">秘书规划</div>
            <div className="mt-1 truncate text-xs text-[#8f897a]">{draft.request}</div>
          </div>
          <span className="shrink-0 rounded-md bg-[#edf6eb] px-2 py-1 text-[11px] text-[#315d39]">
            /plan
          </span>
        </div>
      </div>
      <div className="max-h-[320px] overflow-y-auto px-4 py-3 text-sm leading-7 text-[#2f2b22]">
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{draft.planText}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eee4d3] bg-[#fffdf7] px-4 py-3">
        <span className="mr-auto text-xs text-[#8f897a]">确认后才会开始自动执行</span>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-lg border border-[#e1dccf] bg-[#fffefa] px-3 text-xs text-[#6f7168] transition hover:text-[#171714]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onExecute}
          disabled={llmRunState === 'running'}
          className="h-8 rounded-lg bg-[#20201d] px-3 text-xs font-medium text-[#fffefa] transition hover:bg-[#315d39] disabled:cursor-wait disabled:opacity-50"
        >
          开始执行
        </button>
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
        className={`min-w-0 overflow-hidden rounded-xl border px-4 py-3 text-sm leading-7 shadow-[0_8px_24px_rgba(43,34,19,0.045)] ${
          isUser
            ? 'max-w-[78%] border-[#20201d] bg-[#20201d] text-[#fffefa]'
            : 'w-full max-w-[860px] border-[#e1dccf] bg-white text-[#2f2b22]'
        }`}
      >
        <div
          className={`mb-1 flex items-center justify-between gap-3 text-xs font-medium ${
            isUser ? 'text-[#d6d0c4]' : 'text-[#315d39]'
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
              isUser ? 'hover:bg-white/10' : 'hover:bg-[#edf6eb]'
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
  const stages = useMemo(() => ['规划', '检索', '结构', '起草', '审阅', '清稿'], [])

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
      <div className="max-w-[78%] rounded-xl border border-[#e1dccf] bg-white px-4 py-3 text-sm text-[#6f7168] shadow-[0_8px_24px_rgba(43,34,19,0.045)]">
        <div className="flex items-start justify-between gap-4">
          <span className="inline-flex items-center gap-2">
            <Sparkles size={14} className="animate-pulse text-[#31a96b]" />
            主笔正在执行
            <TypingDots />
          </span>
          <span className="shrink-0 rounded-full bg-[#f5f2ea] px-2 py-0.5 text-[11px] text-[#8f897a]">
            {formatElapsed(elapsed)}
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-[#e1dccf] bg-[#fffefa]">
          <motion.div
            className="h-1 bg-[#315d39]"
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
                className="text-xs font-medium text-[#20201d]"
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
        <AgentTodoList todos={todos} />
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
          className="size-1 rounded-full bg-[#31a96b]"
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
