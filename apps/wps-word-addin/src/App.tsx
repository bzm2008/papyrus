import {
  Check,
  CheckCircle2,
  Circle,
  Clipboard,
  FileText,
  Loader2,
  LogIn,
  LogOut,
  PenLine,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { agentSkills, searchSkills } from './skills'
import { createWpsDocumentBridge, type WpsDocumentBridge } from './services/wpsDocumentBridge'
import {
  clearSession,
  createLoginDevice,
  loadStoredSession,
  pollLoginDevice,
  saveSession,
  type LoginDevice,
} from './services/wpsScallionSession'
import { createWpsPlanDraft, runUnifiedAgent } from './services/wpsUnifiedAgent'
import type {
  AgentSkill,
  ChatMessage,
  PendingPatch,
  ScallionSession,
  WpsAgentTodo,
  WpsDocumentSnapshot,
  WpsPatchOperation,
  WpsPlanDraft,
} from './types'

const emptySnapshot: WpsDocumentSnapshot = {
  selectionText: '',
  documentExcerpt: '',
  cursorAvailable: false,
  wordCount: 0,
}

const addinVersion = import.meta.env.VITE_PAPYRUS_WPS_VERSION || 'dev'

export default function App() {
  const bridgeRef = useRef<WpsDocumentBridge | undefined>(undefined)
  const [session, setSession] = useState<ScallionSession | undefined>(() => loadStoredSession())
  const [loginDevice, setLoginDevice] = useState<LoginDevice | undefined>()
  const [loginStatus, setLoginStatus] = useState<'idle' | 'creating' | 'polling' | 'error'>('idle')
  const [snapshot, setSnapshot] = useState<WpsDocumentSnapshot>(emptySnapshot)
  const [snapshotMessage, setSnapshotMessage] = useState('正在连接 WPS 文档')
  const [bridgeMode, setBridgeMode] = useState('WPS')
  const [prompt, setPrompt] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<AgentSkill | undefined>()
  const [skillOpen, setSkillOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: createId(),
      role: 'assistant',
      content: '选中文档片段后直接告诉我想怎么改，或把写作问题发给我。',
      createdAt: Date.now(),
    },
  ])
  const [pendingPatch, setPendingPatch] = useState<PendingPatch | undefined>()
  const [runState, setRunState] = useState<'idle' | 'running' | 'error'>('idle')
  const [lastError, setLastError] = useState('')
  const [writeNotice, setWriteNotice] = useState('')
  const [planDraft, setPlanDraft] = useState<WpsPlanDraft | undefined>()
  const [agentTodos, setAgentTodos] = useState<WpsAgentTodo[]>([])
  const [agentTrace, setAgentTrace] = useState<string[]>([])

  const skillQuery = getSkillQuery(prompt)
  const visibleSkills = useMemo(() => searchSkills(skillQuery ?? ''), [skillQuery])
  const contextLabel = snapshot.selectionText
    ? `已选 ${snapshot.selectionText.length} 字`
    : snapshot.cursorAvailable
      ? '未选中文本'
      : '等待文档'
  const runtimeNotice =
    writeNotice ||
    lastError ||
    (!session ? '登录后可使用内置模型' : '') ||
    (runState === 'running' ? '正在处理' : `${contextLabel} · ${snapshot.wordCount} 字上下文`)
  const healthItems = [
    { label: bridgeMode, tone: bridgeMode === 'WPS' ? 'ok' : 'warn' },
    { label: session ? '已登录' : '未登录', tone: session ? 'ok' : 'warn' },
    { label: snapshot.cursorAvailable ? contextLabel : '未连接文档', tone: snapshot.cursorAvailable ? 'ok' : 'warn' },
    { label: `v${addinVersion}`, tone: 'neutral' },
  ] as const

  const refreshSnapshot = useCallback(async () => {
    try {
      const bridge = bridgeRef.current ?? createWpsDocumentBridge()
      bridgeRef.current = bridge
      setBridgeMode(bridge.isMock ? '预览' : 'WPS')
      const next = await bridge.getSnapshot()
      setSnapshot(next)
      setSnapshotMessage(next.selectionText ? '正在使用当前选区' : '正在使用文档上下文')
    } catch (error) {
      setSnapshot(emptySnapshot)
      setSnapshotMessage(error instanceof Error ? error.message : '无法读取 WPS 文档')
    }
  }, [])

  useEffect(() => {
    bridgeRef.current = createWpsDocumentBridge()
    const timer = window.setTimeout(() => {
      void refreshSnapshot()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [refreshSnapshot])

  useEffect(() => {
    if (!loginDevice || loginStatus !== 'polling') {
      return
    }

    const timer = window.setInterval(async () => {
      try {
        const payload = await pollLoginDevice(loginDevice.deviceCode)

        if (payload.status === 'pending') {
          return
        }

        window.clearInterval(timer)

        if (payload.status === 'approved') {
          const nextSession = { token: payload.token, user: payload.user }
          saveSession(nextSession)
          setSession(nextSession)
          setLoginStatus('idle')
          setLoginDevice(undefined)
          setLastError('')
          return
        }

        setLoginStatus('error')
        setLastError('授权未完成，请重新登录。')
      } catch (error) {
        window.clearInterval(timer)
        setLoginStatus('error')
        setLastError(error instanceof Error ? error.message : 'Scallion 授权失败')
      }
    }, Math.max(1, loginDevice.interval) * 1000)

    return () => window.clearInterval(timer)
  }, [loginDevice, loginStatus])

  const startLogin = async () => {
    setLoginStatus('creating')
    setLastError('')

    try {
      const device = await createLoginDevice()
      setLoginDevice(device)
      setLoginStatus('polling')
      setLastError('已打开浏览器，请在 Scallion 主站同意授权。')
      openLoginPage(device.verificationUrl)
    } catch (error) {
      setLoginStatus('error')
      setLastError(error instanceof Error ? error.message : '无法创建 Scallion 授权')
    }
  }

  const openLoginPage = (url = loginDevice?.verificationUrl) => {
    if (!url) {
      return
    }

    try {
      const popup = window.open(url, '_blank', 'noopener,noreferrer')
      if (!popup) {
        window.location.href = url
      }
    } catch {
      setLastError('WPS 未能打开浏览器，请复制授权链接后手动打开。')
    }
  }

  const logout = () => {
    clearSession()
    setSession(undefined)
  }

  const submitPrompt = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()

    const value = prompt.trim()

    if (!value || runState === 'running') {
      return
    }

    if (planDraft) {
      await revisePlan(value)
      return
    }

    const resolved = resolveWpsCommand(value)

    if (resolved.isPlan) {
      await createPlan(resolved.argumentsText || resolved.displayPrompt)
      return
    }

    await runPrompt(resolved.executionPrompt, resolved.displayPrompt)
  }

  const createPlan = async (request: string) => {
    if (!request.trim() || runState === 'running') {
      return
    }

    setRunState('running')
    setLastError('正在生成规划')

    try {
      const latestSnapshot = await (bridgeRef.current ?? createWpsDocumentBridge()).getSnapshot()
      setSnapshot(latestSnapshot)
      const draft = await createWpsPlanDraft({
        request,
        snapshot: latestSnapshot,
        selectedSkill,
        token: session?.token,
      })
      setPlanDraft(draft)
      setMessages((items) => [
        ...items,
        { id: createId(), role: 'user', content: `/plan ${request}`, createdAt: Date.now() },
        { id: createId(), role: 'assistant', content: draft.planText, createdAt: Date.now() },
      ])
      setPrompt('')
      setRunState('idle')
      setLastError('规划已生成，确认后再执行')
    } catch (error) {
      setRunState('error')
      setLastError(error instanceof Error ? error.message : '规划生成失败')
    }
  }

  const revisePlan = async (feedback: string) => {
    if (!planDraft || !feedback.trim()) {
      return
    }

    setRunState('running')
    setLastError('正在修订规划')

    try {
      const latestSnapshot = await (bridgeRef.current ?? createWpsDocumentBridge()).getSnapshot()
      const draft = await createWpsPlanDraft({
        request: planDraft.request,
        snapshot: latestSnapshot,
        selectedSkill,
        token: session?.token,
        previousPlan: planDraft,
        feedback,
      })
      setPlanDraft(draft)
      setMessages((items) => [
        ...items,
        { id: createId(), role: 'user', content: feedback, createdAt: Date.now() },
        { id: createId(), role: 'assistant', content: draft.planText, createdAt: Date.now() },
      ])
      setPrompt('')
      setRunState('idle')
      setLastError('规划已修订')
    } catch (error) {
      setRunState('error')
      setLastError(error instanceof Error ? error.message : '规划修订失败')
    }
  }

  const executePlan = async () => {
    const draft = planDraft

    if (!draft || runState === 'running') {
      return
    }

    setPlanDraft(undefined)
    setPrompt(draft.executionPrompt)
    await runPrompt(draft.executionPrompt, draft.request, draft)
  }

  const runPrompt = async (executionPrompt: string, displayPrompt = executionPrompt, approvedPlan?: WpsPlanDraft) => {
    if (!executionPrompt.trim() || runState === 'running') {
      return
    }

    if (!session?.token) {
      setLastError('登录后可使用内置模型，我已为你打开 Scallion 授权页。')
      setMessages((items) => [
        ...items,
        {
          id: createId(),
          role: 'assistant',
          content: '内置模型需要登录后使用。你的输入已保留，完成授权后再发送即可。',
          createdAt: Date.now(),
        },
      ])
      if (loginStatus !== 'creating' && loginStatus !== 'polling') {
        void startLogin()
      }
      return
    }

    setPrompt('')
    setSkillOpen(false)
    setRunState('running')
    setLastError('')
    setWriteNotice('')
    setAgentTodos([])
    setAgentTrace([])

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: displayPrompt,
      createdAt: Date.now(),
    }
    const assistantId = createId()
    setMessages((items) => [
      ...items,
      userMessage,
      {
        id: assistantId,
        role: 'assistant',
        content: '正在读取选区和文档上下文...',
        createdAt: Date.now(),
      },
    ])

    try {
      const latestSnapshot = await (bridgeRef.current ?? createWpsDocumentBridge()).getSnapshot()
      setSnapshot(latestSnapshot)
      const result = await runUnifiedAgent({
        prompt: executionPrompt,
        snapshot: latestSnapshot,
        selectedSkill,
        token: session?.token,
        approvedPlan,
        onStatus: (status) => {
          setAgentTrace((items) => [...items, status].slice(-8))
          setMessages((items) =>
            items.map((item) =>
              item.id === assistantId ? { ...item, content: `正在${status}...` } : item,
            ),
          )
          setLastError(status)
        },
      })
      setAgentTodos(result.todos ?? [])
      setAgentTrace(result.trace ?? [])
      const patch = result.patch
        ? {
            id: createId(),
            ...result.patch,
          }
        : undefined

      if (patch) {
        setPendingPatch(patch)
      }

      setMessages((items) =>
        items.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: result.reply,
                pendingPatch: patch,
              }
            : message,
        ),
      )
      setRunState('idle')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Papyrus 处理失败'
      setRunState('error')
      setLastError(message)
      setMessages((items) =>
        items.map((item) => (item.id === assistantId ? { ...item, content: message } : item)),
      )
    }
  }
  const runShortcut = (label: string) => {
    const skill = agentSkills.find((item) => item.shortName === label)
    setSelectedSkill(skill)
    setPrompt(`@${label} ${snapshot.selectionText ? '处理当前选区' : '结合当前文档'}`)
  }

  const pickSkill = (skill: AgentSkill) => {
    const query = getSkillQuery(prompt)
    const next = query === undefined ? `${prompt} @${skill.shortName} ` : replaceSkillQuery(prompt, skill)
    setSelectedSkill(skill)
    setPrompt(next)
    setSkillOpen(false)
  }

  const applyPatch = async (operation: WpsPatchOperation) => {
    if (!pendingPatch || operation === 'copy_only') {
      await navigator.clipboard?.writeText(pendingPatch?.content ?? '')
      setWriteNotice('结果已复制')
      return
    }

    try {
      await (bridgeRef.current ?? createWpsDocumentBridge()).applyPatch(operation, pendingPatch.content)
      setWriteNotice(writeNoticeFor(operation))
      setPendingPatch(undefined)
      await refreshSnapshot()
    } catch (error) {
      setWriteNotice(error instanceof Error ? error.message : '写入 WPS 文档失败')
    }
  }

  return (
    <main className="wps-shell">
      <header className="wps-header">
        <div className="brand-lockup">
          <span className="brand-mark">
            <PenLine size={16} />
          </span>
          <div className="brand-copy">
            <strong>Papyrus</strong>
            <span>
              {bridgeMode} · {snapshotMessage}
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-button" type="button" title="刷新文档" onClick={() => void refreshSnapshot()}>
            <RefreshCw size={15} />
          </button>
          {session ? (
            <button className="icon-button" type="button" title={`退出 ${session.user.username}`} onClick={logout}>
              <LogOut size={15} />
            </button>
          ) : (
            <button
              className={`icon-button ${loginStatus === 'polling' ? 'is-listening' : ''}`}
              type="button"
              title="登录 Scallion"
              disabled={loginStatus === 'creating'}
              onClick={() => void startLogin()}
            >
              {loginStatus === 'creating' ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}
            </button>
          )}
        </div>
      </header>

      <section className="health-strip" aria-label="插件状态">
        {healthItems.map((item) => (
          <span key={item.label} className={`health-pill ${item.tone}`}>
            {item.label}
          </span>
        ))}
      </section>

      {planDraft ? <PlanDraftCard draft={planDraft} running={runState === 'running'} onExecute={executePlan} onCancel={() => setPlanDraft(undefined)} /> : null}

      {(agentTodos.length || agentTrace.length) ? <AgentRunPanel todos={agentTodos} trace={agentTrace} /> : null}

      <section className="conversation">
        {messages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <div className="message-meta">
              <span>{message.role === 'user' ? '你' : 'Papyrus'}</span>
              <button type="button" title="复制" onClick={() => void navigator.clipboard?.writeText(message.content)}>
                <Clipboard size={12} />
              </button>
            </div>
            <div className="message-content">{message.content}</div>
            {message.pendingPatch ? <PatchPreview patch={message.pendingPatch} onApply={applyPatch} /> : null}
          </article>
        ))}
      </section>

      {pendingPatch ? (
        <aside className="floating-patch">
          <div>
            <span>待应用</span>
            <strong>{pendingPatch.title}</strong>
          </div>
          <div className="patch-actions">
            <button type="button" disabled={!snapshot.selectionText} onClick={() => void applyPatch('replace_selection')}>
              替换选区
            </button>
            <button type="button" onClick={() => void applyPatch('insert_at_cursor')}>
              插入
            </button>
            <button type="button" onClick={() => void applyPatch('append_document')}>
              追加
            </button>
          </div>
        </aside>
      ) : null}

      <form className="composer" onSubmit={(event) => void submitPrompt(event)}>
        {skillOpen || skillQuery !== undefined ? (
          <div className="skill-menu">
            {visibleSkills.slice(0, 6).map((skill) => (
              <button key={skill.id} type="button" onClick={() => pickSkill(skill)}>
                <Sparkles size={14} />
                <span>
                  <strong>{skill.name}</strong>
                  <small>{skill.description}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {messages.length <= 1 ? (
          <div className="quick-actions" aria-label="常用动作">
            {['润色', '缩写', '扩写'].map((label) => (
              <button key={label} type="button" onClick={() => label === '/plan' ? setPrompt('/plan ') : runShortcut(label)}>
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {selectedSkill ? (
          <button className="selected-skill" type="button" onClick={() => setSelectedSkill(undefined)}>
            <Sparkles size={13} />
            {selectedSkill.name}
          </button>
        ) : null}

        <div className="composer-box">
          <textarea
            value={prompt}
            rows={2}
            onChange={(event) => {
              setPrompt(event.target.value)
              if (getSkillQuery(event.target.value) !== undefined) {
                setSkillOpen(true)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submitPrompt()
              }
            }}
            placeholder={session ? '向 Papyrus 发送消息...' : '登录后使用内置模型...'}
          />
          <button className="skill-button" type="button" title="选择技能" onClick={() => setSkillOpen((open) => !open)}>
            <Sparkles size={15} />
          </button>
          <button className="send-button" type="submit" disabled={runState === 'running' || !prompt.trim()}>
            {!session ? (
              <LogIn size={15} />
            ) : runState === 'running' ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Send size={15} />
            )}
          </button>
        </div>

        <footer className={`runtime-line ${loginStatus === 'error' || runState === 'error' ? 'error' : ''}`}>
          <span>{runtimeNotice}</span>
        </footer>
      </form>
    </main>
  )
}

function PlanDraftCard({
  draft,
  running,
  onExecute,
  onCancel,
}: {
  draft: WpsPlanDraft
  running: boolean
  onExecute: () => void
  onCancel: () => void
}) {
  return (
    <section className="plan-card">
      <div className="plan-card-head">
        <div>
          <strong>WPS 秘书规划</strong>
          <span>{draft.request}</span>
        </div>
        <button type="button" title="取消规划" onClick={onCancel}>
          <X size={14} />
        </button>
      </div>
      <pre>{draft.planText}</pre>
      <div className="plan-card-actions">
        <span>继续输入会修订规划，确认后才会执行。</span>
        <button type="button" disabled={running} onClick={onExecute}>
          {running ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
          开始执行
        </button>
      </div>
    </section>
  )
}

function AgentRunPanel({ todos, trace }: { todos: WpsAgentTodo[]; trace: string[] }) {
  return (
    <section className="agent-run-panel">
      {todos.length ? (
        <div className="todo-list">
          {todos.map((todo) => (
            <div key={todo.id} className={`todo-item ${todo.status}`}>
              {todo.status === 'completed' ? <CheckCircle2 size={13} /> : <Circle size={11} />}
              <span>
                <strong>{todo.title}</strong>
                <small>{todo.detail}</small>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {trace.length ? (
        <div className="trace-list">
          <strong>执行轨迹</strong>
          {trace.map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function resolveWpsCommand(value: string) {
  const trimmed = value.trim()
  const match = trimmed.match(/^\/([\p{L}\p{N}_-]+)(?:\s+([\s\S]*))?$/u)
  const command = match?.[1]
  const argumentsText = match?.[2]?.trim() ?? ''

  if (command === 'plan') {
    return {
      displayPrompt: trimmed,
      executionPrompt: argumentsText || trimmed,
      argumentsText,
      isPlan: true,
    }
  }

  if (command === 'solo' || command === 'secretary') {
    return {
      displayPrompt: trimmed,
      executionPrompt: ['进入 WPS 秘书模式自动执行。', argumentsText].filter(Boolean).join('\n\n用户补充：'),
      argumentsText,
      isPlan: false,
    }
  }

  return { displayPrompt: trimmed, executionPrompt: trimmed, argumentsText: '', isPlan: false }
}
function PatchPreview({
  patch,
  onApply,
}: {
  patch: PendingPatch
  onApply: (operation: WpsPatchOperation) => Promise<void>
}) {
  return (
    <div className="patch-preview">
      <div className="patch-preview-head">
        <FileText size={14} />
        <strong>{patch.title}</strong>
      </div>
      <p>{patch.content}</p>
      <div className="patch-actions">
        <button type="button" onClick={() => void onApply(patch.recommendedOperation)}>
          <Check size={13} />
          应用
        </button>
        <button type="button" onClick={() => void onApply('copy_only')}>
          复制
        </button>
      </div>
    </div>
  )
}

function getSkillQuery(value: string) {
  const match = value.match(/(?:^|\s)@([\p{L}\p{N}_\-.\u4e00-\u9fa5]*)$/u)
  return match?.[1]
}

function replaceSkillQuery(value: string, skill: AgentSkill) {
  return value.replace(/(?:^|\s)@([\p{L}\p{N}_\-.\u4e00-\u9fa5]*)$/u, ` @${skill.shortName} `).trimStart()
}

function writeNoticeFor(operation: WpsPatchOperation) {
  if (operation === 'replace_selection') {
    return '已替换当前选区'
  }

  if (operation === 'append_document') {
    return '已追加到文末'
  }

  return '已插入到光标位置'
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
