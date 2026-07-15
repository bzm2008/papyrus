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
  RotateCcw,
  Send,
  Square,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { agentSkills, searchSkills } from './skills'
import {
  createSelectionFingerprint,
  createWpsDocumentBridge,
  type WpsDocumentBridge,
} from './services/wpsDocumentBridge'
import {
  clearSession,
  createLoginDevice,
  loadStoredSession,
  pollLoginDevice,
  saveSession,
  sessionFromPollResponse,
  type LoginDevice,
} from './services/wpsScallionSession'
import { createWpsPlanDraft, runUnifiedAgent } from './services/wpsUnifiedAgent'
import { shouldRefreshWpsQuotaAfterError } from './services/wpsAgentRuntime'
import {
  beginWpsRuntimeMetadataRefresh,
  fetchWpsScallionRuntimeMetadata,
  getWpsModelAccess,
  mergeWpsRuntimeMetadata,
} from './services/wpsScallionMetadata'
import type {
  AgentSkill,
  ChatMessage,
  PendingPatch,
  ScallionSession,
  WpsAgentTodo,
  WpsDocumentSnapshot,
  WpsPatchOperation,
  WpsPlanDraft,
  WpsRetryRequest,
  WpsScallionRuntimeMetadata,
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
  const abortControllerRef = useRef<AbortController | undefined>(undefined)
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
  const [runState, setRunState] = useState<'idle' | 'running' | 'error' | 'cancelled'>('idle')
  const [lastError, setLastError] = useState('')
  const [writeNotice, setWriteNotice] = useState('')
  const [planDraft, setPlanDraft] = useState<WpsPlanDraft | undefined>()
  const [agentTodos, setAgentTodos] = useState<WpsAgentTodo[]>([])
  const [agentTrace, setAgentTrace] = useState<string[]>([])
  const [runtimeDetail, setRuntimeDetail] = useState('')
  const [runtimeMetadata, setRuntimeMetadata] = useState<WpsScallionRuntimeMetadata | undefined>()
  const [selectedModel, setSelectedModel] = useState('')

  const beginRuntimeMetadataRefresh = useCallback(() => {
    setRuntimeMetadata((previous) => beginWpsRuntimeMetadataRefresh(previous))
  }, [])
  const applyRuntimeMetadata = useCallback((metadata: WpsScallionRuntimeMetadata) => {
    setRuntimeMetadata((previous) => mergeWpsRuntimeMetadata(previous, metadata))
    if (metadata.modelsSync.status === 'ready') {
      setSelectedModel((current) =>
        metadata.models.some((model) => model.id === current && model.available && model.planAvailable !== false)
          ? current
          : metadata.models.find((model) => model.available && model.planAvailable !== false)?.id ?? '',
      )
    }
  }, [])

  const quotaSyncStatus = runtimeMetadata?.quotaSync.status
  const quotaSyncSuffix =
    quotaSyncStatus === 'syncing'
      ? ' · 更新中'
      : quotaSyncStatus === 'stale'
        ? ' · 可能过期'
        : quotaSyncStatus === 'error'
          ? ' · 同步失败'
          : ''
  const quotaHealthTone = quotaSyncStatus === 'ready' ? 'ok' : 'warn'

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
    ...(runtimeDetail ? [{ label: runtimeDetail, tone: 'neutral' as const }] : []),
    ...(runtimeMetadata?.quota?.planName || runtimeMetadata?.quota?.planKey || runtimeMetadata?.plan?.name || runtimeMetadata?.plan?.key
      ? [{ label: runtimeMetadata.quota?.planName || runtimeMetadata.quota?.planKey || runtimeMetadata.plan?.name || runtimeMetadata.plan?.key || '套餐', tone: 'neutral' as const }]
      : []),
    ...(runtimeMetadata?.quotaSync
      ? [{
          label: runtimeMetadata.quota
            ? `余 ${runtimeMetadata.quota.pointsBalance} 积分${quotaSyncSuffix}`
            : quotaSyncStatus === 'error'
              ? '积分同步失败'
              : '积分同步中',
          tone: quotaHealthTone as 'ok' | 'warn',
        }]
      : []),
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
    if (!session?.token) {
      const timer = window.setTimeout(() => {
        setRuntimeMetadata(undefined)
        setSelectedModel('')
      }, 0)
      return () => window.clearTimeout(timer)
    }

    let cancelled = false
    const refresh = async () => {
      beginRuntimeMetadataRefresh()
      try {
        const metadata = await fetchWpsScallionRuntimeMetadata(session.token)
        if (cancelled) return
        applyRuntimeMetadata(metadata)
      } catch (error) {
        if (cancelled) return
        const typed = error as Error & { code?: string }
        if (typed.code === 'unauthorized') {
          clearSession()
          setSession(undefined)
        }
        setLastError(typed.message || '无法同步 Scallion 套餐信息')
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [applyRuntimeMetadata, beginRuntimeMetadataRefresh, session?.token])

  useEffect(() => {
    if (!loginDevice || loginStatus !== 'polling') {
      return
    }

    let cancelled = false
    let transientFailures = 0
    const startedAt = Date.now()
    const intervalMs = Math.max(1, loginDevice.interval) * 1000
    let timer: number | undefined

    const schedule = (delayMs = intervalMs) => {
      if (!cancelled) {
        timer = window.setTimeout(tick, delayMs)
      }
    }

    const tick = async () => {
      try {
        const payload = await pollLoginDevice(loginDevice.deviceCode)
        const nextSession = sessionFromPollResponse(payload)

        transientFailures = 0

        if (nextSession) {
          saveSession(nextSession)
          setSession(nextSession)
          setLoginStatus('idle')
          setLoginDevice(undefined)
          setLastError('')
          return
        }

        if (payload.status === 'pending') {
          if (Date.now() - startedAt > (loginDevice.expiresIn || 600) * 1000) {
            setLoginStatus('error')
            setLastError('授权码已过期，请重新登录。')
            return
          }

          schedule()
          return
        }

        setLoginStatus('error')
        setLastError(payload.status === 'denied' ? '你已取消授权，请重新登录。' : '授权未完成，请重新登录。')
      } catch (error) {
        transientFailures += 1

        if (Date.now() - startedAt > (loginDevice.expiresIn || 600) * 1000 || transientFailures >= 8) {
          setLoginStatus('error')
          setLastError(error instanceof Error ? error.message : 'Scallion 授权失败')
          return
        }

        setLastError('正在重新连接 Scallion 授权服务...')
        schedule(Math.min(12000, intervalMs * (1 + transientFailures)))
      }
    }

    schedule(0)

    return () => {
      cancelled = true
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
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
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const latestSnapshot = await (bridgeRef.current ?? createWpsDocumentBridge()).getSnapshot()
      setSnapshot(latestSnapshot)
      const draft = await createWpsPlanDraft({
        request,
        snapshot: latestSnapshot,
        selectedSkill,
        token: session?.token,
        model: selectedModel || undefined,
        signal: controller.signal,
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
      const cancelled = controller.signal.aborted
      if (!cancelled && session?.token) {
        beginRuntimeMetadataRefresh()
        void fetchWpsScallionRuntimeMetadata(session.token)
          .then((metadata) => applyRuntimeMetadata(metadata))
          .catch(() => undefined)
      }
      setRunState(cancelled ? 'cancelled' : 'error')
      setLastError(cancelled ? '已取消规划生成。' : error instanceof Error ? error.message : '规划生成失败')
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = undefined
      }
    }
  }

  const revisePlan = async (feedback: string) => {
    if (!planDraft || !feedback.trim()) {
      return
    }

    setRunState('running')
    setLastError('正在修订规划')
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const latestSnapshot = await (bridgeRef.current ?? createWpsDocumentBridge()).getSnapshot()
      const draft = await createWpsPlanDraft({
        request: planDraft.request,
        snapshot: latestSnapshot,
        selectedSkill,
        token: session?.token,
        model: selectedModel || undefined,
        previousPlan: planDraft,
        feedback,
        signal: controller.signal,
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
      const cancelled = controller.signal.aborted
      if (!cancelled && session?.token) {
        beginRuntimeMetadataRefresh()
        void fetchWpsScallionRuntimeMetadata(session.token)
          .then((metadata) => applyRuntimeMetadata(metadata))
          .catch(() => undefined)
      }
      setRunState(cancelled ? 'cancelled' : 'error')
      setLastError(cancelled ? '已取消规划修订。' : error instanceof Error ? error.message : '规划修订失败')
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = undefined
      }
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

  const runPrompt = async (
    executionPrompt: string,
    displayPrompt = executionPrompt,
    approvedPlan?: WpsPlanDraft,
    retry?: WpsRetryRequest,
  ) => {
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
    setRuntimeDetail('准备请求')
    const controller = new AbortController()
    abortControllerRef.current = controller
    const assistantId = retry?.assistantId ?? createId()
    const selectedSkillForRun = retry?.selectedSkill ?? selectedSkill
    const modelForRun = retry?.model ?? selectedModel
    const baseRetry: WpsRetryRequest = {
      executionPrompt,
      displayPrompt,
      approvedPlan,
      assistantId,
      selectedSkill: selectedSkillForRun,
      model: modelForRun || undefined,
    }

    if (retry) {
      setMessages((items) => items.map((item) =>
        item.id === assistantId
          ? { ...item, content: '正在重试并读取原始上下文...', runStatus: 'generating', canRetry: false, pendingPatch: undefined, retryRequest: undefined }
          : item,
      ))
    } else {
      setMessages((items) => [
        ...items,
        { id: createId(), role: 'user', content: displayPrompt, createdAt: Date.now() },
        { id: assistantId, role: 'assistant', content: '正在读取选区和文档上下文...', createdAt: Date.now(), runStatus: 'generating' },
      ])
    }

    try {
      const latestSnapshot = retry?.snapshot ?? await (bridgeRef.current ?? createWpsDocumentBridge()).getSnapshot()
      setSnapshot(latestSnapshot)
      const retryRequest = { ...baseRetry, snapshot: latestSnapshot }
      const result = await runUnifiedAgent({
        prompt: executionPrompt,
        snapshot: latestSnapshot,
        selectedSkill: selectedSkillForRun,
        model: modelForRun || undefined,
        token: session?.token,
        approvedPlan,
        signal: controller.signal,
        onStatus: (status) => {
          setAgentTrace((items) => [...items, status].slice(-8))
          setRuntimeDetail(status)
        },
        onDraft: (draft) => {
          setMessages((items) => items.map((item) =>
            item.id === assistantId ? { ...item, content: draft, runStatus: 'generating' } : item,
          ))
        },
        onRuntime: (runtime) => {
          setRuntimeDetail(`${runtime.model} · ${runtime.transport === 'stream' ? '流式' : '非流式'}${runtime.usedFallback ? ' · 已降级' : ''}`)
        },
      })
      if (session?.token) {
        beginRuntimeMetadataRefresh()
        void fetchWpsScallionRuntimeMetadata(session.token)
          .then((metadata) => {
            applyRuntimeMetadata(metadata)
          })
          .catch(() => undefined)
      }
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

      const failed = Boolean(result.recoverableError)

      setMessages((items) =>
        items.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: result.reply,
                pendingPatch: patch,
                runStatus: failed ? 'failed' : 'completed',
                canRetry: failed,
                retryRequest: failed ? retryRequest : undefined,
              }
            : message,
        ),
      )
      setRunState(failed ? 'error' : 'idle')
      setLastError(result.recoverableError ?? '')
      setRuntimeDetail(result.model ? `${result.model} · ${result.transport === 'stream' ? '流式' : '非流式'}${result.usedFallback ? ' · 已降级' : ''}` : '')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Papyrus 处理失败'
      const typedError = error as Error & { code?: string; status?: number; retryable?: boolean }
      const authExpired = typedError.code === 'unauthorized' || typedError.status === 401
      const cancelled = abortControllerRef.current?.signal.aborted
      const sessionToken = session?.token
      if (authExpired) {
        clearSession()
        setSession(undefined)
      }
      if (!cancelled && !authExpired && shouldRefreshWpsQuotaAfterError(error) && sessionToken) {
        beginRuntimeMetadataRefresh()
        void fetchWpsScallionRuntimeMetadata(sessionToken)
          .then((metadata) => {
            applyRuntimeMetadata(metadata)
          })
          .catch(() => undefined)
      }
      const displayMessage = cancelled
        ? '已取消本次生成。'
        : authExpired
          ? '登录已过期，请重新登录 Scallion。'
          : typedError.code === 'plan_model_forbidden'
            ? '当前套餐不可用该模型，已刷新模型目录，请选择套餐内模型后重试。'
            : message
      setRunState(cancelled ? 'cancelled' : 'error')
      setLastError(displayMessage)
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: displayMessage,
                runStatus: cancelled ? 'cancelled' : 'failed',
                canRetry: !cancelled,
                retryRequest: cancelled ? undefined : baseRetry,
              }
            : item,
        ),
      )
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = undefined
      }
    }
  }

  const cancelRun = () => abortControllerRef.current?.abort()

  const retryLastRun = (retry: WpsRetryRequest | undefined) => {
    if (retry && runState !== 'running') {
      void runPrompt(retry.executionPrompt, retry.displayPrompt, retry.approvedPlan, retry)
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
      const patchId = pendingPatch.id
      await (bridgeRef.current ?? createWpsDocumentBridge()).applyPatch(
        operation,
        pendingPatch.content,
        operation === 'replace_selection' ? pendingPatch.sourceSelectionFingerprint : undefined,
      )
      setWriteNotice(writeNoticeFor(operation))
      await refreshSnapshot()
      setPendingPatch((current) => current?.id === patchId ? undefined : current)
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

      <section className="runtime-strip" aria-label="Scallion 套餐和模型">
        <div className="runtime-account">
          <strong>
            {runtimeMetadata?.quota?.planName || runtimeMetadata?.quota?.planKey || runtimeMetadata?.plan?.name || runtimeMetadata?.plan?.key || (session ? '套餐同步中' : '未登录 Scallion')}
            {runtimeMetadata?.plan?.expiresAt ? ` · 到期 ${new Date(runtimeMetadata.plan.expiresAt).toLocaleDateString('zh-CN')}` : ''}
            {runtimeMetadata?.quota && quotaSyncStatus && quotaSyncStatus !== 'ready' ? ' · 可能过期' : ''}
          </strong>
          <span>
            {runtimeMetadata?.quota
              ? `剩余 ${runtimeMetadata.quota.pointsBalance} 积分${quotaSyncSuffix}`
              : session
                ? quotaSyncStatus === 'error'
                  ? `积分同步失败${runtimeMetadata?.quotaSync.error ? `：${runtimeMetadata.quotaSync.error}` : ''}`
                  : '套餐与实时积分同步中'
                : '登录后同步套餐与实时积分'}
          </span>
        </div>
        <label className="runtime-model-picker">
          <span>模型</span>
          <select
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            disabled={!runtimeMetadata || runtimeMetadata.models.length === 0}
          >
            <option value="">自动选择套餐内模型</option>
            {(runtimeMetadata?.models ?? []).map((model) => {
              const access = getWpsModelAccess(model)
              return (
                <option key={model.id} value={model.id} disabled={!access.usable}>
                  {model.name || model.id}{access.usable ? '' : ` · ${access.label} · ${access.detail}`}
                </option>
              )
            })}
          </select>
          {runtimeMetadata?.modelsSync.status === 'stale' || runtimeMetadata?.modelsSync.status === 'error' ? (
            <span className="runtime-model-status">
              {runtimeMetadata?.modelsSync.error || '模型目录可能已过期'}
            </span>
          ) : null}
        </label>
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
              {message.canRetry ? (
                <button type="button" title="重试" onClick={() => retryLastRun(message.retryRequest)}>
                  <RotateCcw size={12} />
                </button>
              ) : null}
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
            <button
              type="button"
              disabled={!snapshot.selectionText || createSelectionFingerprint(snapshot.selectionText) !== pendingPatch.sourceSelectionFingerprint}
              onClick={() => void applyPatch('replace_selection')}
            >
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
          <button
            className="send-button"
            type={runState === 'running' ? 'button' : 'submit'}
            title={runState === 'running' ? '取消生成' : '发送'}
            disabled={runState !== 'running' && !prompt.trim()}
            onClick={runState === 'running' ? cancelRun : undefined}
          >
            {!session ? (
              <LogIn size={15} />
            ) : runState === 'running' ? (
              <Square size={14} />
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
