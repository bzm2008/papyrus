import {
  Check,
  ChevronDown,
  Clipboard,
  FileText,
  Loader2,
  LogIn,
  LogOut,
  PenLine,
  RefreshCw,
  Send,
  Sparkles,
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
import { runUnifiedAgent } from './services/wpsUnifiedAgent'
import type {
  AgentSkill,
  ChatMessage,
  PendingPatch,
  ScallionSession,
  WpsDocumentSnapshot,
  WpsPatchOperation,
} from './types'

const actionShortcuts = [
  '解释',
  '润色',
  '扩写',
  '缩写',
  '改成议论文',
  '改成说明文',
  '提纲',
  '审阅',
  '续写',
]

const emptySnapshot: WpsDocumentSnapshot = {
  selectionText: '',
  documentExcerpt: '',
  cursorAvailable: false,
  wordCount: 0,
}

export default function App() {
  const bridgeRef = useRef<WpsDocumentBridge | undefined>(undefined)
  const [session, setSession] = useState<ScallionSession | undefined>(() => loadStoredSession())
  const [loginDevice, setLoginDevice] = useState<LoginDevice | undefined>()
  const [loginStatus, setLoginStatus] = useState<'idle' | 'creating' | 'polling' | 'error'>('idle')
  const [snapshot, setSnapshot] = useState<WpsDocumentSnapshot>(emptySnapshot)
  const [snapshotMessage, setSnapshotMessage] = useState('正在连接 WPS 文档')
  const [bridgeMode, setBridgeMode] = useState('WPS 文字')
  const [prompt, setPrompt] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<AgentSkill | undefined>()
  const [skillOpen, setSkillOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: createId(),
      role: 'assistant',
      content:
        '我是 Papyrus 文学秘书。选中文档片段后可以润色、缩写、扩写，也可以直接问文学常识、写作结构和作业思路。',
      createdAt: Date.now(),
    },
  ])
  const [pendingPatch, setPendingPatch] = useState<PendingPatch | undefined>()
  const [runState, setRunState] = useState<'idle' | 'running' | 'error'>('idle')
  const [lastError, setLastError] = useState('')
  const [writeNotice, setWriteNotice] = useState('')

  const selectionLabel = snapshot.selectionText
    ? `已选 ${snapshot.selectionText.length} 字`
    : snapshot.cursorAvailable
      ? '未选中文本'
      : '等待文档'
  const skillQuery = getSkillQuery(prompt)
  const visibleSkills = useMemo(() => searchSkills(skillQuery ?? ''), [skillQuery])

  const refreshSnapshot = useCallback(async () => {
    try {
      const bridge = bridgeRef.current ?? createWpsDocumentBridge()
      bridgeRef.current = bridge
      setBridgeMode(bridge.isMock ? '浏览器预览' : 'WPS 文字')
      const next = await bridge.getSnapshot()
      setSnapshot(next)
      setSnapshotMessage(
        bridge.isMock
          ? '当前是浏览器预览，写入会进入模拟文档'
          : next.selectionText
            ? '已读取当前选区'
            : '已读取文档摘要',
      )
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
          return
        }

        setLoginStatus('error')
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
      window.open(device.verificationUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setLoginStatus('error')
      setLastError(error instanceof Error ? error.message : '无法打开 Scallion 授权')
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

    setPrompt('')
    setSkillOpen(false)
    setRunState('running')
    setLastError('')
    setWriteNotice('')

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: value,
      createdAt: Date.now(),
    }
    const assistantId = createId()
    setMessages((items) => [
      ...items,
      userMessage,
      {
        id: assistantId,
        role: 'assistant',
        content: '正在阅读选区和文档摘要...',
        createdAt: Date.now(),
      },
    ])

    try {
      const latestSnapshot = await (bridgeRef.current ?? createWpsDocumentBridge()).getSnapshot()
      setSnapshot(latestSnapshot)
      const result = await runUnifiedAgent({
        prompt: value,
        snapshot: latestSnapshot,
        selectedSkill,
        token: session?.token,
      })
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
    const prefix = label.startsWith('改成') ? label : `@${label}`
    const target = snapshot.selectionText ? '处理当前选区' : '结合当前文档'
    setSelectedSkill(agentSkills.find((skill) => label.includes(skill.shortName)))
    setPrompt(`${prefix} ${target}`)
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
          <div className="brand-mark">
            <PenLine size={16} />
          </div>
          <div className="brand-copy">
            <strong>Papyrus</strong>
            <span>WPS 文学秘书</span>
          </div>
        </div>
        <button className="icon-button" type="button" title="刷新文档状态" onClick={() => void refreshSnapshot()}>
          <RefreshCw size={15} />
        </button>
      </header>

      <section className="status-strip">
        <div>
          <span className="status-label">{bridgeMode}</span>
          <strong>{selectionLabel}</strong>
          <small>{snapshotMessage}</small>
        </div>
        <div>
          <span className="status-label">模型</span>
          <strong>mimo2.5pro</strong>
          <small>qwen3.6 兜底</small>
        </div>
      </section>

      <section className="account-bar">
        {session ? (
          <>
            <div className="account-text">
              <span>Scallion</span>
              <strong>{session.user.username}</strong>
            </div>
            <button className="text-button" type="button" onClick={logout}>
              <LogOut size={13} />
              退出
            </button>
          </>
        ) : (
          <>
            <div className="account-text">
              <span>{loginStatus === 'polling' ? '等待授权' : '未登录'}</span>
              <strong>{loginDevice?.userCode || '登录后使用云端模型'}</strong>
            </div>
            <button className="primary-mini" type="button" disabled={loginStatus === 'creating'} onClick={() => void startLogin()}>
              {loginStatus === 'creating' ? <Loader2 size={13} className="spin" /> : <LogIn size={13} />}
              登录
            </button>
          </>
        )}
      </section>

      <section className="shortcut-row" aria-label="常用动作">
        {actionShortcuts.map((label) => (
          <button key={label} type="button" onClick={() => runShortcut(label)}>
            {label}
          </button>
        ))}
      </section>

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
              插入光标
            </button>
            <button type="button" onClick={() => void applyPatch('append_document')}>
              追加文末
            </button>
          </div>
        </aside>
      ) : null}

      <form className="composer" onSubmit={(event) => void submitPrompt(event)}>
        {skillOpen || skillQuery !== undefined ? (
          <div className="skill-menu">
            {visibleSkills.slice(0, 7).map((skill) => (
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

        {selectedSkill ? (
          <button className="selected-skill" type="button" onClick={() => setSelectedSkill(undefined)}>
            <Sparkles size={13} />
            {selectedSkill.name}
            <span>清除</span>
          </button>
        ) : null}

        <div className="composer-box">
          <button className="icon-button" type="button" title="@skill" onClick={() => setSkillOpen((open) => !open)}>
            <ChevronDown size={14} />
          </button>
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
            placeholder="问写作问题，或输入 @技能 后处理选区..."
          />
          <button className="send-button" type="submit" disabled={runState === 'running' || !prompt.trim()}>
            {runState === 'running' ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          </button>
        </div>

        <footer className="runtime-line">
          <span>{runState === 'running' ? '处理中' : runState === 'error' ? '处理失败' : '就绪'}</span>
          <span>{writeNotice || lastError || `${snapshot.wordCount} 字上下文`}</span>
        </footer>
      </form>
    </main>
  )
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
          推荐应用
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
