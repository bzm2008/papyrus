import {
  BookOpenText,
  ChevronDown,
  ClipboardList,
  Clock3,
  FileStack,
  History,
  LibraryBig,
  Loader2,
  Pencil,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  createSecretaryTaskCenterMemory,
  deleteSecretaryTaskCenterMemory,
  loadSecretaryTaskCenterSnapshot,
  queueSecretaryLedgerTask,
  rollbackSecretaryTaskCenterMemory,
  updateSecretaryTaskCenterMemory,
  updateSecretaryTaskCenterStatus,
  type SecretaryLedgerRecoveryItem,
  type SecretaryTaskCenterSnapshot,
} from '../services/secretaryLedgerRuntime'
import {
  searchSecretaryLedger,
  type SecretaryLedgerMemory,
  type SecretaryLedgerSearchResult,
  type SecretaryLedgerTask,
} from '../services/secretaryLedgerClient'
import { useAppStore } from '../stores/useAppStore'

type SecretaryTaskCenterProps = {
  onStartTask: (task: SecretaryLedgerTask, recovery?: SecretaryLedgerRecoveryItem) => void
  onOpenMaterials: () => void
  onPauseActiveTask?: () => void
  onCancelActiveTask?: () => void
  onClose?: () => void
  compact?: boolean
}

type ComposerMode = 'task' | 'memory' | undefined

type SecretaryTaskCenterProject = SecretaryTaskCenterSnapshot['projects'][number]

const taskStatusLabel: Record<SecretaryLedgerTask['status'], string> = {
  queued: '待开始',
  running: '进行中',
  awaiting_approval: '待确认',
  paused: '已暂停',
  completed: '已完成',
  failed: '需重试',
  cancelled: '已取消',
}

const taskStatusClass: Record<SecretaryLedgerTask['status'], string> = {
  queued: 'bg-[#f6f0e2] text-[#745d2e]',
  running: 'bg-[#edf6eb] text-[#315d39]',
  awaiting_approval: 'bg-[#fff1e9] text-[#8b4138]',
  paused: 'bg-[#f0eee7] text-[#6f7168]',
  completed: 'bg-[#edf6eb] text-[#315d39]',
  failed: 'bg-[#fcede9] text-[#9b3d30]',
  cancelled: 'bg-[#f0eee7] text-[#6f7168]',
}

export function SecretaryTaskCenter({ onStartTask, onOpenMaterials, onPauseActiveTask, onCancelActiveTask, onClose, compact = false }: SecretaryTaskCenterProps) {
  const [snapshot, setSnapshot] = useState<SecretaryTaskCenterSnapshot>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [composer, setComposer] = useState<ComposerMode>()
  const [taskDraft, setTaskDraft] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')
  const [memoryDraft, setMemoryDraft] = useState('')
  const [memoryScope, setMemoryScope] = useState<'project' | 'personal'>('project')
  const [editingMemoryId, setEditingMemoryId] = useState<string>()
  const [editingMemoryContent, setEditingMemoryContent] = useState('')
  const [query, setQuery] = useState('')
  const [crossProject, setCrossProject] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SecretaryLedgerSearchResult[]>([])
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const resources = useAppStore((state) => state.resources)
  const activeStoryProjectId = useAppStore((state) => state.activeStoryProjectId)
  const activeChatId = useAppStore((state) => state.activeChatId)
  const switchChatSession = useAppStore((state) => state.switchChatSession)
  const setActiveStoryProject = useAppStore((state) => state.setActiveStoryProject)

  const refresh = useCallback(async () => {
    setLoading(true)
    const next = await loadSecretaryTaskCenterSnapshot()
    setSnapshot(next)
    setLoading(false)
  }, [])

  useEffect(() => {
    let disposed = false
    // Defer the initial external read so React does not synchronously cascade
    // state updates during the effect commit phase.
    const timer = window.setTimeout(() => {
      void loadSecretaryTaskCenterSnapshot().then((next) => {
        if (disposed) return
        setSnapshot(next)
        setLoading(false)
      })
    }, 0)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [activeChatId, activeStoryProjectId])

  const recoveryByTaskId = useMemo(
    () => new Map(snapshot?.recovery.map((item) => [item.task.id, item]) ?? []),
    [snapshot?.recovery],
  )
  const visibleTasks = useMemo(
    () => [...(snapshot?.tasks ?? [])].sort((left, right) => right.updatedAt - left.updatedAt),
    [snapshot?.tasks],
  )
  const projects = snapshot?.projects

  const submitTask = async () => {
    const request = taskDraft.trim()
    if (!request) return
    const scheduled = scheduleAt ? new Date(scheduleAt).getTime() : null
    const hasSchedule = scheduled !== null
    if (hasSchedule && (!Number.isSafeInteger(scheduled) || scheduled < Date.now() - 60_000)) {
      setError('请填写当前或未来的定时时间。')
      return
    }
    const result = await queueSecretaryLedgerTask({
      title: request.slice(0, 48),
      request,
      scheduleAt: hasSchedule ? scheduled : null,
    })
    if (!result.ok) {
      setError(result.message)
      return
    }
    setTaskDraft('')
    setScheduleAt('')
    setComposer(undefined)
    setError('')
    await refresh()
  }

  const submitMemory = async () => {
    const content = memoryDraft.trim()
    if (!content) return
    const result = await createSecretaryTaskCenterMemory({ content, scope: memoryScope })
    if (!result.ok) {
      setError(result.message)
      return
    }
    setMemoryDraft('')
    setComposer(undefined)
    setError('')
    await refresh()
  }

  const updateMemory = async () => {
    if (!editingMemoryId || !editingMemoryContent.trim()) return
    const result = await updateSecretaryTaskCenterMemory(editingMemoryId, editingMemoryContent)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setEditingMemoryId(undefined)
    setEditingMemoryContent('')
    setError('')
    await refresh()
  }

  const removeMemory = async (memory: SecretaryLedgerMemory) => {
    if (!window.confirm(`永久删除这条${memory.scope === 'personal' ? '个人' : '项目'}记忆？此操作不可撤销。`)) return
    const result = await deleteSecretaryTaskCenterMemory(memory.id)
    if (!result.ok) setError(result.message)
    else await refresh()
  }

  const rollbackMemory = async (memory: SecretaryLedgerMemory) => {
    if (memory.revision <= 1) return
    if (!window.confirm('回退到上一版记忆？当前内容会保留在修订历史中。')) return
    const result = await rollbackSecretaryTaskCenterMemory(memory.id, memory.revision - 1)
    if (!result.ok) setError(result.message)
    else await refresh()
  }

  const changeTaskStatus = async (task: SecretaryLedgerTask, status: 'queued' | 'paused' | 'cancelled') => {
    if (task.status === 'running' || task.status === 'awaiting_approval') {
      if (status === 'paused') onPauseActiveTask?.()
      if (status === 'cancelled') onCancelActiveTask?.()
    }
    const result = await updateSecretaryTaskCenterStatus(task.id, status)
    if (!result.ok) setError(result.message)
    else await refresh()
  }

  const retryTask = async (task: SecretaryLedgerTask) => {
    const result = await updateSecretaryTaskCenterStatus(task.id, 'queued')
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError('')
    onStartTask(result.value, recoveryByTaskId.get(task.id))
    await refresh()
  }

  const runSearch = async () => {
    const trimmed = query.trim()
    if (!trimmed || !snapshot?.project) {
      setSearchResults([])
      return
    }
    setSearching(true)
    const result = await searchSecretaryLedger({
      query: trimmed,
      currentProjectId: snapshot.project.id,
      includeCrossProject: crossProject,
      limit: 20,
    })
    setSearching(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError('')
    setSearchResults(result.value)
  }

  const beginTask = (task: SecretaryLedgerTask) => {
    const recovery = recoveryByTaskId.get(task.id)
    onStartTask(task, recovery)
  }

  const selectProject = (project: SecretaryTaskCenterProject) => {
    if (!project.storyProjectId && !project.chatId) {
      setError('这条旧记录没有关联可切换的本地项目，只能用于检索。')
      return
    }

    if (project.chatId) {
      switchChatSession(project.chatId)
    }

    setActiveStoryProject(project.storyProjectId ?? undefined)
    setProjectPickerOpen(false)
    setError('')
  }

  return (
    <aside className={`papyrus-scrollbar flex min-h-0 flex-col overflow-y-auto bg-[#fffefa]/78 ${compact ? 'w-full' : 'w-[264px] shrink-0 border-r border-[#e1dccf]'}`}>
      <header className="papyrus-toolbar flex min-h-11 shrink-0 items-center gap-2 border-b px-3">
        <LibraryBig size={15} className="text-[#6f7f68]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[#20201d]">项目现场</div>
          <div className="truncate text-[10px] text-[#8f897a]">{snapshot?.project?.title ?? '正在读取项目账本'}</div>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            title="切换项目"
            aria-label="切换项目"
            aria-haspopup="menu"
            aria-expanded={projectPickerOpen}
            onClick={() => setProjectPickerOpen((open) => !open)}
            disabled={!projects?.length}
            className="papyrus-icon-button size-7 rounded-md disabled:opacity-40"
          >
            <ChevronDown size={13} />
          </button>
          {projectPickerOpen ? (
            <div role="menu" aria-label="项目列表" className="papyrus-scrollbar absolute right-0 top-full z-30 mt-1 max-h-56 w-52 overflow-y-auto rounded-md border border-[#e1dccf] bg-[#fffefa] p-1 shadow-[0_14px_32px_rgba(43,34,19,0.14)]">
              {projects?.map((project) => {
                const canSwitch = Boolean(project.storyProjectId || project.chatId)
                const active = project.id === snapshot?.project?.id
                return (
                  <button
                    key={project.id}
                    role="menuitem"
                    type="button"
                    disabled={!canSwitch}
                    title={canSwitch ? `切换到${project.title}` : '旧记录仅支持检索'}
                    onClick={() => selectProject(project)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] disabled:cursor-not-allowed disabled:opacity-45 ${active ? 'bg-[#edf6eb] text-[#315d39]' : 'text-[#3e3a31] hover:bg-[#fffdf7]'}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{project.title}</span>
                    <span className="shrink-0 text-[10px] text-[#8f897a]">{project.kind === 'writing' ? '写作' : '对话'}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <button type="button" title="刷新项目现场" onClick={() => void refresh()} className="papyrus-icon-button size-7 rounded-md">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
        {onClose ? (
          <button type="button" title="关闭项目现场" onClick={onClose} className="papyrus-icon-button size-7 rounded-md">
            <X size={13} />
          </button>
        ) : null}
      </header>

      <div className="space-y-4 p-3">
        {error ? <p role="alert" className="rounded-md bg-[#fcede9] px-2.5 py-2 text-[11px] leading-5 text-[#8b4138]">{error}</p> : null}
        {!snapshot?.state.available && !loading ? (
          <section className="text-xs leading-5 text-[#6f7168]">{snapshot?.state.reason ?? '当前环境不能使用本地秘书账本。'}</section>
        ) : null}

        <TaskCenterSection title="资料" icon={FileStack} action={<button type="button" className="papyrus-icon-button size-6 rounded-md" title="查看资料" onClick={onOpenMaterials}><ChevronDown size={13} /></button>}>
          {resources.length ? (
            <div className="space-y-1">
              {resources.slice(0, 4).map((resource) => (
                <div key={resource.id} className="flex min-w-0 items-center gap-2 py-1 text-[11px] text-[#6f7168]">
                  <BookOpenText size={13} className="shrink-0 text-[#6f7f68]" />
                  <span className="min-w-0 flex-1 truncate">{resource.name}</span>
                  {resource.includedInContext ? <span className="shrink-0 text-[10px] text-[#315d39]">已引用</span> : null}
                </div>
              ))}
            </div>
          ) : <EmptyLine text="尚未导入项目资料" />}
        </TaskCenterSection>

        <TaskCenterSection
          title="项目记忆"
          icon={BookOpenText}
          action={<button type="button" title="新增记忆" onClick={() => setComposer(composer === 'memory' ? undefined : 'memory')} className="papyrus-icon-button size-6 rounded-md"><Plus size={13} /></button>}
        >
          {composer === 'memory' ? (
            <div className="space-y-2 rounded-md border border-[#e8ddc7] bg-[#fffdf7] p-2">
              <div className="inline-flex rounded-md border border-[#e8ddc7] bg-[#fffefa] p-0.5 text-[10px]">
                {(['project', 'personal'] as const).map((scope) => (
                  <button key={scope} type="button" onClick={() => setMemoryScope(scope)} className={`h-5 rounded px-1.5 ${memoryScope === scope ? 'bg-[#20201d] text-[#fffefa]' : 'text-[#6f7168]'}`}>{scope === 'project' ? '本项目' : '个人偏好'}</button>
                ))}
              </div>
              <textarea aria-label="新增记忆" value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} rows={3} placeholder="仅保存稳定、低风险的偏好或已确认事实" className="w-full resize-none border-0 bg-transparent text-xs leading-5 text-[#2f2b22] outline-none placeholder:text-[#9d988a]" />
              <div className="flex justify-end gap-1.5"><button type="button" onClick={() => setComposer(undefined)} className="papyrus-control h-6 rounded-md px-2 text-[10px]">取消</button><button type="button" onClick={() => void submitMemory()} className="papyrus-primary-button h-6 rounded-md px-2 text-[10px]">保存</button></div>
            </div>
          ) : null}
          {snapshot?.memories.length ? (
            <div className="space-y-2">
              {snapshot.memories.slice(0, 6).map((memory) => editingMemoryId === memory.id ? (
                <div key={memory.id} className="rounded-md border border-[#e8ddc7] bg-[#fffdf7] p-2">
                  <textarea aria-label="编辑记忆" value={editingMemoryContent} onChange={(event) => setEditingMemoryContent(event.target.value)} rows={3} className="w-full resize-none border-0 bg-transparent text-xs leading-5 outline-none" />
                  <div className="mt-1.5 flex justify-end gap-1"><button type="button" className="papyrus-control h-6 rounded-md px-2 text-[10px]" onClick={() => setEditingMemoryId(undefined)}>取消</button><button type="button" className="papyrus-primary-button h-6 rounded-md px-2 text-[10px]" onClick={() => void updateMemory()}>更新</button></div>
                </div>
              ) : (
                <MemoryRow key={memory.id} memory={memory} onEdit={() => { setEditingMemoryId(memory.id); setEditingMemoryContent(memory.content) }} onRollback={() => void rollbackMemory(memory)} onDelete={() => void removeMemory(memory)} />
              ))}
            </div>
          ) : <EmptyLine text="尚无已确认记忆" />}
        </TaskCenterSection>

        <TaskCenterSection title="任务队列" icon={ClipboardList} action={<button type="button" title="新增待办任务" onClick={() => setComposer(composer === 'task' ? undefined : 'task')} className="papyrus-icon-button size-6 rounded-md"><Plus size={13} /></button>}>
          {composer === 'task' ? (
            <div className="space-y-2 rounded-md border border-[#e8ddc7] bg-[#fffdf7] p-2">
              <textarea aria-label="待办任务" value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} rows={3} placeholder="例如：周五下午整理访谈摘要并写邮件初稿" className="w-full resize-none border-0 bg-transparent text-xs leading-5 outline-none placeholder:text-[#9d988a]" />
              <label className="flex items-center gap-1.5 text-[10px] text-[#6f7168]"><Clock3 size={11} /> 定时 <input aria-label="定时开始" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-[10px] outline-none" /></label>
              <div className="flex justify-end gap-1.5"><button type="button" onClick={() => setComposer(undefined)} className="papyrus-control h-6 rounded-md px-2 text-[10px]">取消</button><button type="button" onClick={() => void submitTask()} className="papyrus-primary-button h-6 rounded-md px-2 text-[10px]">加入队列</button></div>
            </div>
          ) : null}
          {visibleTasks.length ? (
            <div className="space-y-2">
              {visibleTasks.slice(0, 8).map((task) => <TaskRow key={task.id} task={task} onStart={() => beginTask(task)} onRetry={() => void retryTask(task)} onPause={() => void changeTaskStatus(task, 'paused')} onCancel={() => void changeTaskStatus(task, 'cancelled')} />)}
            </div>
          ) : <EmptyLine text="没有待恢复或排队任务" />}
        </TaskCenterSection>

        <TaskCenterSection title="历史检索" icon={History}>
          <div className="flex gap-1.5">
            <input aria-label="项目历史检索" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch() } }} placeholder="检索当前项目" className="min-w-0 flex-1 rounded-md border border-[#e8ddc7] bg-[#fffefa] px-2 py-1 text-[11px] outline-none placeholder:text-[#9d988a]" />
            <button type="button" title="检索项目历史" onClick={() => void runSearch()} className="papyrus-icon-button size-7 rounded-md"><Search size={13} /></button>
          </div>
          <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[#8f897a]"><input type="checkbox" checked={crossProject} onChange={(event) => setCrossProject(event.target.checked)} /> 跨项目检索并标明来源</label>
          {searching ? <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#8f897a]"><Loader2 size={12} className="animate-spin" /> 检索中</div> : null}
          {searchResults.length ? <div className="mt-2 space-y-2">{searchResults.slice(0, 5).map((result) => <div key={`${result.entityType}-${result.id}`} className="border-l-2 border-[#e8ddc7] pl-2"><div className="truncate text-[11px] font-medium text-[#2f2b22]">{result.title}</div><p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[#6f7168]">{result.content}</p>{result.projectTitle ? <span className="text-[10px] text-[#8f897a]">{result.projectTitle}</span> : null}</div>)}</div> : null}
        </TaskCenterSection>
      </div>
    </aside>
  )
}

function TaskCenterSection({ title, icon: Icon, action, children }: { title: string; icon: typeof BookOpenText; action?: ReactNode; children: ReactNode }) {
  return <section><div className="mb-1.5 flex items-center gap-1.5 px-0.5"><Icon size={13} className="text-[#6f7f68]" /><span className="min-w-0 flex-1 text-[11px] font-semibold text-[#6f7168]">{title}</span>{action}</div>{children}</section>
}

function EmptyLine({ text }: { text: string }) {
  return <p className="px-0.5 text-[11px] leading-5 text-[#9d988a]">{text}</p>
}

function MemoryRow({ memory, onEdit, onRollback, onDelete }: { memory: SecretaryLedgerMemory; onEdit: () => void; onRollback: () => void; onDelete: () => void }) {
  return <article className="group border-b border-[#eee4d3] pb-2 last:border-b-0 last:pb-0"><p className="line-clamp-3 text-[11px] leading-5 text-[#3e3a31]">{memory.content}</p><div className="mt-1 flex items-center gap-1 text-[10px] text-[#9d988a]"><span>{memory.scope === 'personal' ? '个人偏好' : '项目事实'}</span><span>v{memory.revision}</span><span className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100"><button type="button" title="编辑记忆" onClick={onEdit} className="papyrus-icon-button size-5 rounded"><Pencil size={10} /></button>{memory.revision > 1 ? <button type="button" title="回退上一版" onClick={onRollback} className="papyrus-icon-button ml-1 size-5 rounded"><RotateCcw size={10} /></button> : null}<button type="button" title="永久删除记忆" onClick={onDelete} className="papyrus-icon-button ml-1 size-5 rounded text-[#9b3d30]"><Trash2 size={10} /></button></span></div></article>
}

function TaskRow({ task, onStart, onRetry, onPause, onCancel }: { task: SecretaryLedgerTask; onStart: () => void; onRetry: () => void; onPause: () => void; onCancel: () => void }) {
  const startable = task.status === 'queued' || task.status === 'paused'
  return <article className="rounded-md border border-[#e8ddc7]/82 bg-[#fffdf7]/72 p-2"><div className="flex items-start gap-1.5"><div className="min-w-0 flex-1"><div className="line-clamp-2 text-[11px] font-medium leading-4 text-[#2f2b22]">{task.title}</div>{task.scheduleAt ? <div className="mt-1 flex items-center gap-1 text-[10px] text-[#8f897a]"><Clock3 size={10} />{formatTime(task.scheduleAt)}</div> : null}</div><span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${taskStatusClass[task.status]}`}>{taskStatusLabel[task.status]}</span></div>{task.nextStep ? <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#8f897a]">{task.nextStep}</p> : null}<div className="mt-2 flex justify-end gap-1">{startable ? <button type="button" title="开始或继续任务" onClick={onStart} className="papyrus-icon-button size-6 rounded-md text-[#315d39]"><Play size={11} fill="currentColor" /></button> : null}{task.status === 'failed' || task.status === 'cancelled' ? <button type="button" title="重新排队并重试" onClick={onRetry} className="papyrus-icon-button size-6 rounded-md text-[#315d39]"><RotateCcw size={11} /></button> : null}{task.status === 'queued' || task.status === 'running' || task.status === 'awaiting_approval' ? <button type="button" title="暂停任务" onClick={onPause} className="papyrus-icon-button size-6 rounded-md"><Pause size={11} /></button> : null}{task.status !== 'completed' && task.status !== 'cancelled' ? <button type="button" title="取消任务" onClick={onCancel} className="papyrus-icon-button size-6 rounded-md text-[#9b3d30]"><Square size={10} fill="currentColor" /></button> : null}</div></article>
}

function formatTime(timestamp: number) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp)
  } catch {
    return new Date(timestamp).toLocaleString()
  }
}

