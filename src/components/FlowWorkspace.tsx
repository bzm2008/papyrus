import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Clipboard,
  Copy,
  FileText,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useAgentStream } from '../hooks/useAgentStream'
import { createSecretaryPlanDraft, reviseSecretaryPlanDraft } from '../services/agentOrchestrator'
import { formatChangeStat } from '../services/documentChangeStatsService'
import { sendFlowMessage } from '../services/flowOrchestrator'
import { getModelCacheStats } from '../services/modelCallCacheService'
import { createSecretaryGoalFromRequest } from '../services/secretaryGoalService'
import {
  type AgentStep,
  type AgentTodo,
  type FlowMessage,
  type FlowThinkingEffort,
  type GoalCheckpoint,
  type QueuedUserInput,
  type SecretaryGoal,
  type SecretaryPlanDraft,
  useAppStore,
} from '../stores/useAppStore'
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
  const processingQueuedIdRef = useRef<string | null>(null)
  const flowMessages = useAppStore((state) => state.flowMessages)
  const setFlowMessages = useAppStore((state) => state.setFlowMessages)
  const agentTodos = useAppStore((state) => state.agentTodos)
  const agentSteps = useAppStore((state) => state.agentSteps)
  const llmRunState = useAppStore((state) => state.llmRunState)
  const pendingDocumentPatch = useAppStore((state) => state.pendingDocumentPatch)
  const documentChangeStats = useAppStore((state) => state.documentChangeStats)
  const secretaryPlanDraft = useAppStore((state) => state.secretaryPlanDraft)
  const approveSecretaryPlanDraft = useAppStore((state) => state.approveSecretaryPlanDraft)
  const clearSecretaryPlanDraft = useAppStore((state) => state.clearSecretaryPlanDraft)
  const flowThinkingEffort = useAppStore((state) => state.flowThinkingEffort)
  const setFlowThinkingEffort = useAppStore((state) => state.setFlowThinkingEffort)
  const hiveTelemetry = useAppStore((state) => state.hiveTelemetry)
  const isUsageCollapsed = useAppStore((state) => state.isUsageCollapsed)
  const setUsageCollapsed = useAppStore((state) => state.setUsageCollapsed)
  const queuedUserInputs = useAppStore((state) => state.queuedUserInputs)
  const enqueueUserInput = useAppStore((state) => state.enqueueUserInput)
  const updateQueuedUserInput = useAppStore((state) => state.updateQueuedUserInput)
  const removeQueuedUserInput = useAppStore((state) => state.removeQueuedUserInput)
  const sendQueuedInputAsGuidance = useAppStore((state) => state.sendQueuedInputAsGuidance)
  const activeSecretaryGoal = useAppStore((state) => state.activeSecretaryGoal)
  const updateSecretaryGoal = useAppStore((state) => state.updateSecretaryGoal)
  const clearSecretaryGoal = useAppStore((state) => state.clearSecretaryGoal)
  const goalCheckpoints = useAppStore((state) => state.goalCheckpoints)
  useAgentStream()

  const visibleMessages = flowMessages.filter(
    (message) => message.role === 'user' || !message.agentId || message.agentId === 'writer',
  )
  const latestAssistantId = [...visibleMessages]
    .reverse()
    .find((message) => message.role === 'assistant')?.id
  const latestChangeStat = documentChangeStats[0]

  const dispatchPrompt = useCallback(async (rawPrompt: string, options: { queuedInputId?: string } = {}) => {
    const cleanPrompt = rawPrompt.trim()

    if (!cleanPrompt) {
      return
    }

    const resolved = resolveSlashCommandPrompt(cleanPrompt)

    if (secretaryPlanDraft && secretaryPlanDraft.status === 'draft') {
      await reviseSecretaryPlanDraft(resolved.displayPrompt)
      return
    }

    if (resolved.isPlanCommand) {
      const request = resolved.argumentsText || '请先写出需要规划的任务'
      await createSecretaryPlanDraft(resolved.displayPrompt || '/plan', request)
      return
    }

    if (resolved.isGoalCommand) {
      const request = resolved.argumentsText || '请描述长程写作目标'
      const goal = createSecretaryGoalFromRequest(request)
      await sendFlowMessage(request, {
        displayPrompt: resolved.displayPrompt || `/goal ${request}`,
        thinkingEffort: flowThinkingEffort === 'low' ? 'high' : flowThinkingEffort,
        goalId: goal.id,
        queuedInputId: options.queuedInputId,
      })
      return
    }

    await sendFlowMessage(resolved.executionPrompt, {
      displayPrompt: resolved.displayPrompt,
      thinkingEffort: flowThinkingEffort,
      goalId: activeSecretaryGoal?.status === 'active' ? activeSecretaryGoal.id : undefined,
      queuedInputId: options.queuedInputId,
    })
  }, [activeSecretaryGoal, flowThinkingEffort, secretaryPlanDraft])

  useEffect(() => {
    if (llmRunState !== 'idle' || processingQueuedIdRef.current) {
      return
    }

    const nextQueued = queuedUserInputs.find((input) => input.status === 'queued')

    if (!nextQueued) {
      return
    }

    processingQueuedIdRef.current = nextQueued.id
    updateQueuedUserInput(nextQueued.id, { status: 'sending' })
    void dispatchPrompt(nextQueued.content, { queuedInputId: nextQueued.id }).finally(() => {
      removeQueuedUserInput(nextQueued.id)
      processingQueuedIdRef.current = null
    })
  }, [dispatchPrompt, llmRunState, queuedUserInputs, removeQueuedUserInput, updateQueuedUserInput])

  const submitFlowPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanPrompt = prompt.trim()

    if (!cleanPrompt) {
      return
    }

    setPrompt('')

    if (llmRunState === 'running') {
      enqueueUserInput(cleanPrompt)
      return
    }

    void dispatchPrompt(cleanPrompt)
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
    void dispatchPrompt(promptMessage.content)
  }

  const rollbackLast = () => {
    if (llmRunState === 'running') {
      return
    }

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
      thinkingEffort: flowThinkingEffort,
      goalId: activeSecretaryGoal?.status === 'active' ? activeSecretaryGoal.id : undefined,
    }).finally(() => {
      useAppStore.getState().clearSecretaryPlanDraft()
    })
  }

  const continueGoal = (goal: SecretaryGoal) => {
    if (llmRunState === 'running') {
      enqueueUserInput(`继续推进目标：${goal.title}`)
      return
    }

    void sendFlowMessage(`继续推进目标：${goal.request}`, {
      displayPrompt: `/goal 继续 ${goal.title}`,
      thinkingEffort: flowThinkingEffort === 'low' ? 'high' : flowThinkingEffort,
      goalId: goal.id,
    })
  }

  return (
    <section className="flex h-full min-h-0 bg-transparent">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="papyrus-toolbar flex h-11 shrink-0 items-center justify-between border-b px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid size-7 place-items-center rounded-md bg-[#20201d] text-[#fffefa]">
              <PenLine size={14} />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] font-semibold text-[#20201d]">秘书模式</div>
              <div className="truncate text-[11px] text-[#6f7168]">
                规划、检索、写作和校对在同一条执行线上推进
              </div>
            </div>
          </div>

          <button
            type="button"
            title={sidebarVisible ? '隐藏文稿' : '显示文稿'}
            onClick={() => setSidebarVisible((visible) => !visible)}
            className="papyrus-control inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px]"
          >
            {sidebarVisible ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            <span>{sidebarVisible ? '隐藏文稿' : '显示文稿'}</span>
          </button>
        </header>

        <div className="papyrus-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col">
            {secretaryPlanDraft ? (
              <SecretaryPlanCard
                draft={secretaryPlanDraft}
                onExecute={executePlan}
                onCancel={clearSecretaryPlanDraft}
              />
            ) : null}
            {activeSecretaryGoal ? (
              <SecretaryGoalCard
                goal={activeSecretaryGoal}
                checkpoints={goalCheckpoints.filter(
                  (checkpoint) => checkpoint.goalId === activeSecretaryGoal.id,
                )}
                running={llmRunState === 'running'}
                onContinue={() => continueGoal(activeSecretaryGoal)}
                onPause={() =>
                  updateSecretaryGoal(activeSecretaryGoal.id, {
                    status: activeSecretaryGoal.status === 'paused' ? 'active' : 'paused',
                  })
                }
                onCancel={clearSecretaryGoal}
              />
            ) : null}
            {pendingDocumentPatch ? <PendingPatchReview /> : null}
            <SecretaryUsageOverview
              collapsed={isUsageCollapsed}
              onToggle={() => setUsageCollapsed(!isUsageCollapsed)}
            />

            <div className="flex-1 space-y-3">
              <AnimatePresence initial={false}>
                {visibleMessages.map((message) => (
                  <ChatBubble
                    key={message.id}
                    message={message}
                    showTrace={message.id === latestAssistantId}
                    steps={agentSteps}
                    changeStat={
                      message.id === latestAssistantId && latestChangeStat?.createdAt >= message.createdAt
                        ? latestChangeStat
                        : undefined
                    }
                    isLatestAssistant={message.id === latestAssistantId}
                    actionsDisabled={llmRunState === 'running'}
                    onRegenerate={regenerateLast}
                    onRollback={rollbackLast}
                  />
                ))}
                {llmRunState === 'running' && !latestAssistantId ? (
                  <ThinkingBubble key="thinking" todos={agentTodos} steps={agentSteps} />
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-[#e1dccf] bg-[#fffefa]/70 px-4 py-3 backdrop-blur">
          {queuedUserInputs.length ? (
            <QueuedInputBar
              inputs={queuedUserInputs}
              onRemove={removeQueuedUserInput}
              onEdit={(id, content) => updateQueuedUserInput(id, { content })}
              onGuide={(id) => sendQueuedInputAsGuidance(id)}
            />
          ) : null}
          <form onSubmit={submitFlowPrompt} className="papyrus-command-bar mx-auto max-w-[920px] rounded-xl p-2">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1">
              <ModelSelector compact />
              <ThinkingEffortControl value={flowThinkingEffort} onChange={setFlowThinkingEffort} hiveTelemetry={hiveTelemetry} />
              <span className="ml-auto text-[11px] text-[#8f897a]">/ 命令 · @ 技能 · # 文件</span>
            </div>
            <div className="relative flex items-end gap-2">
              <SlashCommandMenu scope="flow" value={prompt} onPick={pickCommand} />
              <PromptAssistMenu value={prompt} onChange={setPrompt} />
              <textarea
                aria-label="秘书模式指令"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  llmRunState === 'running'
                    ? 'AI 工作中，输入后按 Enter 加入队列...'
                    : '写章节、改作文、查资料，或输入 /plan、/goal...'
                }
                rows={1}
                className="max-h-32 min-h-9 min-w-0 flex-1 resize-none border-none bg-transparent px-2 py-1.5 text-sm leading-6 text-[#2f2b22] outline-none placeholder:text-[#8f897a]"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <button
                type="submit"
                title={llmRunState === 'running' ? '加入队列' : '发送给秘书长'}
                disabled={!prompt.trim()}
                className="papyrus-primary-button grid size-9 shrink-0 place-items-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={15} />
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
            animate={{ width: 440, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 42, mass: 0.8 }}
            className="min-h-0 shrink-0 overflow-hidden border-l border-[#e1dccf] bg-[#fffefa]/86 backdrop-blur"
          >
            <div className="papyrus-toolbar flex h-11 items-center gap-2 border-b px-3 text-[13px] font-semibold text-[#20201d]">
              <FileText size={15} className="text-[#315d39]" />
              文稿
            </div>
            <div className="h-[calc(100%-2.75rem)] min-h-0">
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
    <section className="mb-3 rounded-lg border border-[#cfd8c7] bg-[#f4fbf2]/86 p-3 text-[#315d39]">
      <div className="flex items-start gap-2">
        <PenLine size={15} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {patch.status === 'applied' ? '已写入文稿' : '正在写入文稿'}
          </div>
          <p className="mt-1 text-xs leading-5 text-[#4f5c49]">
            {patch.title} · {patch.operation}
          </p>
          <p className="mt-1 max-h-12 overflow-hidden text-xs leading-5 text-[#6f7168]">{patch.content}</p>
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
  draft: SecretaryPlanDraft
  onExecute: () => void
  onCancel: () => void
}) {
  const llmRunState = useAppStore((state) => state.llmRunState)

  return (
    <section className="papyrus-panel mb-4 overflow-hidden rounded-xl">
      <div className="flex items-start justify-between gap-3 border-b border-[#eee4d3] px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#20201d]">秘书规划</div>
          <div className="mt-1 truncate text-xs text-[#8f897a]">{draft.request}</div>
        </div>
        <span className="shrink-0 rounded-md bg-[#edf6eb] px-2 py-1 text-[11px] text-[#315d39]">/plan</span>
      </div>
      <div className="max-h-[300px] overflow-y-auto px-4 py-3 text-sm leading-7 text-[#2f2b22]">
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{draft.planText}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eee4d3] bg-[#fffdf7]/76 px-4 py-3">
        <span className="mr-auto text-xs text-[#8f897a]">
          确认后才会自动执行；继续输入会修订这份计划。
        </span>
        <button type="button" onClick={onCancel} className="papyrus-control h-8 rounded-md px-3 text-xs">
          取消
        </button>
        <button
          type="button"
          onClick={onExecute}
          disabled={llmRunState === 'running'}
          className="papyrus-primary-button h-8 rounded-md px-3 text-xs font-medium disabled:cursor-wait disabled:opacity-50"
        >
          开始执行
        </button>
      </div>
    </section>
  )
}

function SecretaryGoalCard({
  goal,
  checkpoints,
  running,
  onContinue,
  onPause,
  onCancel,
}: {
  goal: SecretaryGoal
  checkpoints: GoalCheckpoint[]
  running: boolean
  onContinue: () => void
  onPause: () => void
  onCancel: () => void
}) {
  const latestJudge = checkpoints.at(-1)?.judge

  return (
    <section className="papyrus-panel mb-4 overflow-hidden rounded-xl">
      <div className="flex items-start justify-between gap-3 border-b border-[#eee4d3] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#20201d]">
            <Sparkles size={14} className="text-[#d7aa4f]" />
            {goal.title || '长程目标'}
          </div>
          <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#8f897a]">{goal.request}</div>
        </div>
        <span className="shrink-0 rounded-md bg-[#fff6df] px-2 py-1 text-[11px] text-[#5b4a24]">
          /goal · {goal.status}
        </span>
      </div>
      <div className="grid gap-3 px-4 py-3 text-xs text-[#6f7168]">
        <div>
          <div className="mb-1 font-medium text-[#2f2b22]">验收标准</div>
          <div className="space-y-1">
            {(goal.acceptanceCriteria.length ? goal.acceptanceCriteria : ['等待秘书长补全验收标准']).map((item) => (
              <div key={item} className="flex gap-2">
                <span className="mt-2 size-1 rounded-full bg-[#d7aa4f]" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 font-medium text-[#2f2b22]">阶段计划</div>
          <div className="space-y-1">
            {(goal.phasePlan.length ? goal.phasePlan : ['等待秘书长生成下一阶段计划']).map((item, index) => (
              <div key={`${item}-${index}`} className="flex gap-2">
                <span className="tabular-nums text-[#9d988a]">{index + 1}.</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-[#fffdf7] p-2">
          <div className="font-medium text-[#2f2b22]">当前进度</div>
          <div className="mt-1 leading-5">{goal.currentProgress}</div>
          {latestJudge ? (
            <div className="mt-2 rounded-md border border-[#e8ddc7] bg-[#fffefa] p-2">
              <div className="font-medium text-[#2f2b22]">裁判检查：{latestJudge.verdict}</div>
              <div className="mt-1 leading-5">{latestJudge.summary}</div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eee4d3] bg-[#fffdf7]/76 px-4 py-3">
        <button type="button" onClick={onCancel} className="papyrus-control h-8 rounded-md px-3 text-xs">
          取消目标
        </button>
        <button type="button" onClick={onPause} className="papyrus-control h-8 rounded-md px-3 text-xs">
          {goal.status === 'paused' ? '继续' : '暂停'}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={running || goal.status === 'completed' || goal.status === 'cancelled'}
          className="papyrus-primary-button h-8 rounded-md px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          推进下一步
        </button>
      </div>
    </section>
  )
}

function QueuedInputBar({
  inputs,
  onRemove,
  onEdit,
  onGuide,
}: {
  inputs: QueuedUserInput[]
  onRemove: (id: string) => void
  onEdit: (id: string, content: string) => void
  onGuide: (id: string) => void
}) {
  return (
    <div className="mx-auto mb-2 max-w-[920px] rounded-xl border border-[#e8ddc7] bg-[#fffdf7]/92 p-2 text-xs text-[#6f7168]">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="font-medium text-[#2f2b22]">排队输入</span>
        <span>{inputs.length} 条</span>
      </div>
      <div className="grid gap-1.5">
        {inputs.map((input) => (
          <div key={input.id} className="flex items-center gap-2 rounded-lg bg-[#fffefa] px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate">{input.content}</span>
            <span className="shrink-0 rounded-md bg-[#f5f2ea] px-1.5 py-0.5 text-[10px]">
              {input.status === 'guidance' ? '已引导' : input.status === 'sending' ? '发送中' : '排队'}
            </span>
            <button
              type="button"
              title="编辑"
              onClick={() => {
                const next = window.prompt('编辑排队内容', input.content)
                if (next !== null) {
                  onEdit(input.id, next)
                }
              }}
              className="papyrus-icon-button size-6 rounded-md"
            >
              <PenLine size={12} />
            </button>
            <button
              type="button"
              title="作为引导发送"
              onClick={() => onGuide(input.id)}
              disabled={input.status !== 'queued'}
              className="papyrus-icon-button size-6 rounded-md disabled:opacity-40"
            >
              <Play size={12} />
            </button>
            <button
              type="button"
              title="删除"
              onClick={() => onRemove(input.id)}
              className="papyrus-icon-button size-6 rounded-md text-[#9b3d30]"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
function SecretaryUsageOverview({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  const chatSessions = useAppStore((state) => state.chatSessions)
  const flowMessages = useAppStore((state) => state.flowMessages)
  const contextUsedTokens = useAppStore((state) => state.contextUsedTokens)
  const effectiveContextLimitTokens = useAppStore((state) => state.effectiveContextLimitTokens)
  const activeProviderId = useAppStore((state) => state.activeProviderId)
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const modelRoutingMode = useAppStore((state) => state.modelRoutingMode)
  const scallionQuota = useAppStore((state) => state.scallionQuota)
  const scallionUser = useAppStore((state) => state.scallionUser)
  const documentChangeStats = useAppStore((state) => state.documentChangeStats)
  const hiveTelemetry = useAppStore((state) => state.hiveTelemetry)
  const cacheStats = getModelCacheStats()
  const contextPercent = Math.min(
    100,
    Math.round((contextUsedTokens / Math.max(1, effectiveContextLimitTokens)) * 100),
  )
  const totalChanged = documentChangeStats.reduce((sum, stat) => sum + stat.changedChars, 0)
  const modelLabel =
    modelRoutingMode === 'auto'
      ? 'Auto 调度'
      : providerConfigs[activeProviderId]?.label ?? '未选择'
  const quotaValue =
    scallionQuota?.remaining ?? scallionUser?.points ?? scallionUser?.balance ?? 0
  const quotaUnit = scallionQuota?.unit ?? '积分'

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-[#e8ddc7] bg-[#fffdf7]/88 shadow-[0_10px_26px_rgba(43,34,19,0.04)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-10 w-full items-center justify-between gap-3 border-b border-[#eee4d3] px-4 text-left"
      >
        <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[#20201d]">
          <Sparkles size={14} className="text-[#d7aa4f]" />
          会话概览
          {hiveTelemetry.enabled ? (
            <span className="rounded-md border border-[#d7aa4f]/45 bg-[#fff6df] px-1.5 py-0.5 text-[10px] font-medium text-[#5b4a24]">
              Hive {hiveTelemetry.activeAgents}/{hiveTelemetry.plannedAgents}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[11px] text-[#8f897a]">
          {collapsed ? '展开' : '收起'}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.div
            key="secretary-usage-overview"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-4">
              <UsageMetric label="会话" value={String(chatSessions.length)} />
              <UsageMetric label="消息" value={String(flowMessages.length)} />
              <UsageMetric label="本轮 Token" value={formatCompactNumber(contextUsedTokens)} />
              <UsageMetric label="上下文" value={`${contextPercent}%`} />
              <UsageMetric label="当前模型" value={modelLabel} />
              <UsageMetric label="内置额度" value={`${quotaValue} ${quotaUnit}`} />
              <UsageMetric label="缓存命中" value={`${cacheStats.hitRate}%`} />
              <UsageMetric label="累计修改" value={formatCompactNumber(totalChanged)} />
            </div>
            <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-[#eee4d3] bg-[#fffefa] p-2">
              <div className="mb-1 flex items-center justify-between text-[11px] text-[#8f897a]">
                <span>上下文窗口</span>
                <span>{formatCompactNumber(contextUsedTokens)} / {formatCompactNumber(effectiveContextLimitTokens)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#f0e6d2]">
                <motion.div
                  className="h-full rounded-full bg-[#315d39]"
                  initial={false}
                  animate={{ width: `${contextPercent}%` }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}

function UsageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-[#f0eee7] px-2.5 py-2">
      <div className="truncate text-[11px] text-[#8f897a]">{label}</div>
      <div className="mt-1 truncate text-[15px] font-semibold tabular-nums text-[#20201d]">{value}</div>
    </div>
  )
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

function ThinkingEffortControl({
  value,
  onChange,
  hiveTelemetry,
}: {
  value: FlowThinkingEffort
  onChange: (value: FlowThinkingEffort) => void
  hiveTelemetry: ReturnType<typeof useAppStore.getState>['hiveTelemetry']
}) {
  const shouldReduceMotion = useReducedMotion()
  const options: Array<{ value: FlowThinkingEffort; label: string }> = [
    { value: 'low', label: 'low' },
    { value: 'medium', label: 'medium' },
    { value: 'high', label: 'high' },
    { value: 'ultra_hive', label: 'ultra+hive' },
  ]
  const hiveActive = value === 'ultra_hive'
  const hiveTitle =
    'ultra+hive 蜂巢模式：最大思考强度，会调度多个专长 Agent 小队，适合长文、研究、合规、跨文档、复杂运营和 /goal；优先完成质量，并用缓存和摘要减少重复消耗。'

  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`relative grid h-8 w-[326px] grid-cols-4 items-center overflow-hidden rounded-xl border p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_1px_2px_rgba(43,34,19,0.05)] ${
          hiveActive ? 'border-[#d7aa4f]/75 bg-[#fff6df]' : 'border-[#dccfb9] bg-[#f8f4ea]'
        }`}
        title={hiveActive ? hiveTitle : undefined}
      >
      {hiveActive ? (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-xl opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(215,170,79,0.32) 1px, transparent 0)',
            backgroundSize: '8px 8px',
          }}
          animate={shouldReduceMotion ? { opacity: 0.5 } : { opacity: [0.38, 0.72, 0.38] }}
          transition={{ duration: 2.4, repeat: shouldReduceMotion ? 0 : Infinity, ease: 'easeInOut' }}
        />
      ) : null}
      {options.map((option) => {
        const active = value === option.value
        const isHive = option.value === 'ultra_hive'

        return (
          <motion.button
            key={option.value}
            type="button"
            title={isHive ? hiveTitle : `思考强度：${option.label}`}
            onClick={() => onChange(option.value)}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
            className={`relative z-10 h-6 min-w-0 rounded-lg px-1.5 text-[11px] font-semibold tracking-normal transition-colors ${
              active ? 'text-[#fffefa]' : 'text-[#6f7168] hover:text-[#20201d]'
            }`}
          >
            {active ? (
              <motion.span
                layoutId="thinking-effort-active"
                className={`absolute inset-0 rounded-lg shadow-[0_4px_12px_rgba(32,32,29,0.18)] ${
                  isHive ? 'bg-[#2f2a1a] ring-1 ring-[#d7aa4f]/70' : 'bg-[#20201d]'
                }`}
                transition={{ type: 'spring', stiffness: 540, damping: 36, mass: 0.62 }}
              />
            ) : (
              <motion.span
                className="absolute inset-0 rounded-lg bg-[#fffefa]"
                initial={false}
                animate={{ opacity: 0 }}
                whileHover={{ opacity: 0.86 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            <motion.span
              className="relative z-10 block truncate"
              animate={shouldReduceMotion ? undefined : { y: active ? -0.5 : 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              {option.label}
            </motion.span>
          </motion.button>
        )
      })}
      </div>
      {hiveActive && hiveTelemetry.enabled ? (
        <span className="shrink-0 rounded-lg border border-[#d7aa4f]/45 bg-[#fffefa]/82 px-2 py-1 text-[10px] font-medium text-[#5b4a24]">
          Hive 运行中 {hiveTelemetry.activeAgents} / {hiveTelemetry.plannedAgents}
        </span>
      ) : null}
    </div>
  )
}
function ChatBubble({
  message,
  showTrace,
  steps,
  changeStat,
  isLatestAssistant,
  actionsDisabled,
  onRegenerate,
  onRollback,
}: {
  message: FlowMessage
  showTrace: boolean
  steps: AgentStep[]
  changeStat?: ReturnType<typeof useAppStore.getState>['documentChangeStats'][number]
  isLatestAssistant: boolean
  actionsDisabled: boolean
  onRegenerate: () => void
  onRollback: () => void
}) {
  const isUser = message.role === 'user'
  const shouldShowTrace = !isUser && showTrace && steps.length > 0

  return (
    <motion.div
      layout
      exit={{ opacity: 0, y: -6, scale: 0.995 }}
      className={`group flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <motion.article
        initial={{ opacity: 0, y: 6, scale: 0.995 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className={`min-w-0 rounded-xl px-3.5 py-2.5 text-sm leading-7 ${
          isUser
            ? 'max-w-[76%] bg-[#20201d] text-[#fffefa] shadow-[0_8px_22px_rgba(23,23,20,0.12)]'
            : 'w-full max-w-[880px] border border-[#e8ddc7]/82 bg-[#fffefa]/82 text-[#2f2b22]'
        }`}
      >
        <div
          className={`mb-1 flex items-center justify-between gap-3 text-[11px] font-medium ${
            isUser ? 'text-[#d6d0c4]' : 'text-[#315d39]'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            {isUser ? <MessageSquare size={12} /> : <PenLine size={12} />}
            {isUser ? '你' : '秘书长'}
          </span>
          <button
            type="button"
            title="复制"
            onClick={() => void navigator.clipboard?.writeText(message.content)}
            className={`rounded-md p-1 opacity-0 group-hover:opacity-100 ${
              isUser ? 'hover:bg-white/10' : 'hover:bg-[#edf6eb]'
            }`}
          >
            <Clipboard size={12} />
          </button>
        </div>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
        {!isUser && changeStat ? (
          <div className="mt-2 inline-flex rounded-md bg-[#edf6eb] px-2 py-1 text-[11px] font-medium text-[#315d39]">
            本轮修改 {changeStat.changedChars} 字 ·{' '}
            {formatChangeStat(changeStat.insertedChars, changeStat.deletedChars)}
          </div>
        ) : null}
        {shouldShowTrace ? <AgentTraceRenderer steps={steps} /> : null}
        {!isUser && isLatestAssistant ? (
          <MessageActionBar
            disabled={actionsDisabled}
            onRegenerate={onRegenerate}
            onRollback={onRollback}
            content={message.content}
          />
        ) : null}
      </motion.article>
    </motion.div>
  )
}

function MessageActionBar({
  disabled,
  onRegenerate,
  onRollback,
  content,
}: {
  disabled: boolean
  onRegenerate: () => void
  onRollback: () => void
  content: string
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[#eee4d3] pt-2 text-xs text-[#6f7168]">
      <button
        type="button"
        onClick={onRegenerate}
        disabled={disabled}
        className="papyrus-control inline-flex h-7 items-center gap-1.5 rounded-md px-2 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <RotateCcw size={13} />
        重新生成
      </button>
      <button
        type="button"
        onClick={onRollback}
        disabled={disabled}
        className="papyrus-control inline-flex h-7 items-center gap-1.5 rounded-md px-2 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Undo2 size={13} />
        回退
      </button>
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(content)}
        className="papyrus-control inline-flex h-7 items-center gap-1.5 rounded-md px-2"
      >
        <Copy size={13} />
        复制
      </button>
      <span className="ml-auto text-[11px] text-[#8f897a]">查看轨迹在本轮回复内展开</span>
    </div>
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
      initial={{ opacity: 0, y: 8, scale: 0.995 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.995 }}
      className="flex justify-start"
    >
      <div className="w-full max-w-[720px] rounded-xl border border-[#e8ddc7]/82 bg-[#fffefa]/82 px-3.5 py-3 text-sm text-[#6f7168]">
        <div className="flex items-start justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-[#2f2b22]">
            <Sparkles size={14} className="animate-pulse text-[#31a96b]" />
            秘书长正在执行
            <TypingDots />
          </span>
          <span className="shrink-0 rounded-md bg-[#f5f2ea] px-2 py-0.5 text-[11px] tabular-nums text-[#8f897a]">
            {formatElapsed(elapsed)}
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-[#e1dccf] bg-[#fffdf7]/82">
          <motion.div
            className="h-0.5 bg-[#315d39]"
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="grid gap-1.5 p-3">
            <AnimatePresence mode="wait">
              <motion.div
                key={stageIndex}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="text-xs font-semibold text-[#20201d]"
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



