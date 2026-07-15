import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronRight,
  Database,
  HardDrive,
  Loader2,
  MemoryStick,
  Network,
  Play,
  RefreshCw,
  ScrollText,
  Server,
  Settings2,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  checkBackendCommunication,
  checkDefaultModelLatency,
  checkSqliteStatus,
  clearGlobalMemory,
  getMemoryUsage,
  rebuildProjectIndex,
  testModelConnection,
} from '../services/maintenance'
import { getMaintenanceReadiness } from '../services/maintenanceReadiness'
import {
  customContextTiers,
  isProviderValidated,
  providerValidationSignature,
} from '../services/modelCatalog'
import {
  useAppStore,
  type MaintenanceCheck,
  type MaintenanceCheckId,
  type MaintenanceTab,
  type ProviderId,
} from '../stores/useAppStore'
import { BrandMark } from './BrandMark'

const tabs: Array<{
  id: MaintenanceTab
  label: string
  caption: string
}> = [
  { id: 'connections', label: '连接状态', caption: '后端、存储、模型' },
  { id: 'models', label: '模型管理', caption: '云端或本地引擎' },
  { id: 'memory', label: '存储与记忆', caption: '索引、缓存、RAG' },
]

export function MaintenanceConsole() {
  const [checkingAll, setCheckingAll] = useState(false)
  const [testingProviderId, setTestingProviderId] = useState<ProviderId | null>(null)
  const [confirmAction, setConfirmAction] = useState<'clear' | 'rebuild' | null>(null)
  const maintenanceTab = useAppStore((state) => state.maintenanceTab)
  const setMaintenanceTab = useAppStore((state) => state.setMaintenanceTab)
  const maintenanceChecks = useAppStore((state) => state.maintenanceChecks)
  const setMaintenanceCheck = useAppStore((state) => state.setMaintenanceCheck)
  const setMemoryUsageBytes = useAppStore((state) => state.setMemoryUsageBytes)
  const setEnvReady = useAppStore((state) => state.setEnvReady)
  const memoryUsageBytes = useAppStore((state) => state.memoryUsageBytes)
  const agentMemoryRecords = useAppStore((state) => state.agentMemoryRecords)
  const agentRuns = useAppStore((state) => state.agentRuns)
  const clearAgentMemory = useAppStore((state) => state.clearAgentMemory)
  const activeProviderId = useAppStore((state) => state.activeProviderId)
  const setActiveProviderId = useAppStore((state) => state.setActiveProviderId)
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const updateProviderConfig = useAppStore((state) => state.updateProviderConfig)
  const activeProvider = providerConfigs[activeProviderId]
  const cloudProvider = providerConfigs.qwen36
  const customProvider = providerConfigs.custom
  const readiness = useMemo(
    () => getMaintenanceReadiness(maintenanceChecks),
    [maintenanceChecks],
  )

  const runAllChecks = async () => {
    setCheckingAll(true)

    await Promise.all([
      runSingleCheck('tauri', checkBackendCommunication()),
      runSingleCheck('sqlite', checkSqliteStatus()),
      runSingleCheck('llm', checkDefaultModelLatency(activeProvider)),
      getMemoryUsage().then((result) => {
        setMemoryUsageBytes(result.bytes ?? 0)
      }),
    ])

    setCheckingAll(false)
  }

  const runSingleCheck = async (
    id: MaintenanceCheckId,
    probe: Promise<{
      status: MaintenanceCheck['status']
      message: string
      latencyMs?: number
      bytes?: number
    }>,
  ) => {
    setMaintenanceCheck(id, { status: 'checking', message: '正在检测...' })
    const result = await probe

    setMaintenanceCheck(id, {
      status: result.status,
      message: result.message,
      latencyMs: result.latencyMs,
    })
  }

  const handleTestProvider = async (providerId: ProviderId) => {
    const provider = useAppStore.getState().providerConfigs[providerId]

    setTestingProviderId(providerId)
    setMaintenanceCheck('llm', { status: 'checking', message: '正在测试模型连通性...' })

    try {
      const result = await testModelConnection(provider)

      if (result.status === 'ok') {
        updateProviderConfig(providerId, {
          validatedAt: Date.now(),
          lastValidatedSignature: providerValidationSignature(provider),
        })
      }

      setMaintenanceCheck('llm', {
        status: result.status,
        message: result.message,
        latencyMs: result.latencyMs,
      })
    } catch (error) {
      setMaintenanceCheck('llm', {
        status: 'error',
        message: error instanceof Error ? error.message : String(error || '模型连通性测试失败。'),
      })
    } finally {
      setTestingProviderId(null)
    }
  }

  const handleConfirmDanger = async () => {
    if (!confirmAction) {
      return
    }

    const result = confirmAction === 'clear' ? await clearGlobalMemory() : await rebuildProjectIndex()

    if (confirmAction === 'clear') {
      clearAgentMemory()
    }

    if (typeof result.bytes === 'number') {
      setMemoryUsageBytes(result.bytes)
    }

    setConfirmAction(null)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runAllChecks()
    }, 0)

    return () => window.clearTimeout(timer)
    // The first pass should reflect the currently selected provider only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="papyrus-grain flex h-screen min-h-0 overflow-hidden bg-[#fbfaf6] text-[#171714]">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-[#eee8dc] bg-[#fffefa]">
        <div className="flex h-16 items-center gap-3 border-b border-[#eee8dc] px-4">
          <BrandMark size="sm" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">Papyrus Engine Room</div>
            <div className="truncate text-xs text-[#7d7a70]">首次自检与系统维护</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {tabs.map((tab) => {
            const active = maintenanceTab === tab.id

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMaintenanceTab(tab.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-left transition ${
                  active
                    ? 'bg-[#171714] text-[#fffefa]'
                    : 'text-[#5f6159] hover:bg-[#f4eddf] hover:text-[#171714]'
                }`}
              >
                <span>
                  <span className="block text-sm font-medium">{tab.label}</span>
                  <span className={`block text-xs ${active ? 'text-[#d8d1c2]' : 'text-[#9d988a]'}`}>
                    {tab.caption}
                  </span>
                </span>
                <ChevronRight size={16} />
              </button>
            )
          })}
        </nav>

        <div className="border-t border-[#eee8dc] p-4">
          <button
            type="button"
            onClick={() => setEnvReady(true)}
            disabled={!readiness.canEnter}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#171714] text-sm font-medium text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-not-allowed disabled:bg-[#c9c0ae]"
          >
            <Play size={15} />
            进入 Papyrus
          </button>
          <p className="mt-2 text-center text-xs leading-5 text-[#8f897a]">
            {readiness.limitedMode
              ? '将以受限模式进入；登录或配置模型后可启用 AI 能力'
              : '桌面后端与本地存储通过后即可进入工作站'}
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <div className="flex h-16 items-center justify-between border-b border-[#eee8dc] bg-[#fffefa]/86 px-6">
          <div>
            <div className="text-sm font-semibold">系统维护控制台</div>
            <div className="text-xs text-[#7d7a70]">让写作引擎在进入正文前先安静热身</div>
          </div>
          <button
            type="button"
            onClick={() => void runAllChecks()}
            disabled={checkingAll}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-3 text-sm text-[#5f6159] transition hover:text-[#171714] disabled:cursor-wait disabled:opacity-55"
          >
            {checkingAll ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            重新检测
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={maintenanceTab}
            className="papyrus-scrollbar h-[calc(100vh-64px)] overflow-y-auto p-6"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {maintenanceTab === 'connections' ? (
              <ConnectionsPanel checks={maintenanceChecks} checkingAll={checkingAll} onRetest={runAllChecks} />
            ) : null}
            {maintenanceTab === 'models' ? (
              <ModelsPanel
                activeProviderId={activeProviderId}
                cloudProviderId="qwen36"
                customProviderId="custom"
                cloudProviderLabel={cloudProvider.label}
                customProviderLabel={customProvider.label}
                testingProviderId={testingProviderId}
                onSetActiveProvider={setActiveProviderId}
                onTestProvider={handleTestProvider}
              />
            ) : null}
            {maintenanceTab === 'memory' ? (
              <MemoryPanel
                memoryUsageBytes={memoryUsageBytes}
                agentMemoryRecords={agentMemoryRecords}
                agentRuns={agentRuns}
                onClear={() => setConfirmAction('clear')}
                onRebuild={() => setConfirmAction('rebuild')}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </main>

      <ConfirmDangerDialog
        action={confirmAction}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirmDanger}
      />
    </div>
  )
}

function ConnectionsPanel({
  checks,
  checkingAll,
  onRetest,
}: {
  checks: MaintenanceCheck[]
  checkingAll: boolean
  onRetest: () => Promise<void>
}) {
  return (
    <section className="mx-auto max-w-4xl">
      <PanelHeading
        icon={Network}
        title="连接状态"
        description="桌面后端、写作存储和默认模型需要先进入可用状态。"
      />
      <div className="mt-5 space-y-3">
        {checks.map((check) => (
          <StatusRow key={check.id} check={check} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => void onRetest()}
        disabled={checkingAll}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[#171714] px-4 text-sm font-medium text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-wait disabled:opacity-55"
      >
        {checkingAll ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        重新检测
      </button>
    </section>
  )
}

function ModelsPanel({
  activeProviderId,
  cloudProviderId,
  customProviderId,
  cloudProviderLabel,
  customProviderLabel,
  testingProviderId,
  onSetActiveProvider,
  onTestProvider,
}: {
  activeProviderId: ProviderId
  cloudProviderId: ProviderId
  customProviderId: ProviderId
  cloudProviderLabel: string
  customProviderLabel: string
  testingProviderId: ProviderId | null
  onSetActiveProvider: (providerId: ProviderId) => void
  onTestProvider: (providerId: ProviderId) => Promise<void>
}) {
  return (
    <section className="mx-auto max-w-4xl">
      <PanelHeading
        icon={Settings2}
        title="模型管理"
        description="默认使用内置云模型，也可以接入本地 vLLM、Ollama 或兼容 OpenAI 的服务。"
      />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <ModelCard
          providerId={cloudProviderId}
          title={cloudProviderLabel}
          badge="内置云模型"
          active={activeProviderId === cloudProviderId}
          testing={testingProviderId === cloudProviderId}
          readonly
          onUse={onSetActiveProvider}
          onTest={onTestProvider}
        />
        <ModelCard
          providerId={customProviderId}
          title={customProviderLabel}
          badge="本地 / 自定义"
          active={activeProviderId === customProviderId}
          testing={testingProviderId === customProviderId}
          onUse={onSetActiveProvider}
          onTest={onTestProvider}
        />
      </div>
    </section>
  )
}

function ModelCard({
  providerId,
  title,
  badge,
  active,
  testing,
  readonly = false,
  onUse,
  onTest,
}: {
  providerId: ProviderId
  title: string
  badge: string
  active: boolean
  testing: boolean
  readonly?: boolean
  onUse: (providerId: ProviderId) => void
  onTest: (providerId: ProviderId) => Promise<void>
}) {
  const provider = useAppStore((state) => state.providerConfigs[providerId])
  const updateProviderConfig = useAppStore((state) => state.updateProviderConfig)
  const ready = isProviderValidated(provider)

  return (
    <div className="rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_8px_24px_rgba(43,34,19,0.04)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex rounded-full border border-[#e8ddc7] px-2.5 py-1 text-xs text-[#7d7a70]">
            {badge}
          </div>
          <div className="mt-3 text-base font-semibold text-[#171714]">{title}</div>
          <p className="mt-1 text-xs leading-5 text-[#7d7a70]">{provider.setupHint}</p>
        </div>
        {active ? <Check size={18} className="text-[#3f5845]" /> : null}
      </div>

      <div className="space-y-3">
        {!readonly ? (
          <MaintenanceField
            label="显示名称"
            value={provider.label}
            onChange={(value) => updateProviderConfig(providerId, { label: value })}
          />
        ) : null}
        <MaintenanceField
          label="Base URL"
          value={provider.baseUrl}
          readOnly={readonly}
          placeholder="http://localhost:11434/v1"
          onChange={(value) => updateProviderConfig(providerId, { baseUrl: value })}
        />
        <MaintenanceField
          label="Model Name"
          value={provider.modelName}
          readOnly={readonly}
          placeholder="deepseek-v4-flash 或 llama3.1"
          onChange={(value) => updateProviderConfig(providerId, { modelName: value })}
        />
        {!readonly ? (
          <MaintenanceField
            label="API Key"
            value={provider.apiKey}
            type="password"
            placeholder="本地服务可留空"
            onChange={(value) => updateProviderConfig(providerId, { apiKey: value })}
          />
        ) : null}
        {!readonly ? <MaintenanceContextTiers providerId={providerId} /> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${ready ? 'text-[#3f5845]' : 'text-[#8f897a]'}`}>
          {ready ? '已可用于工作站' : '测试通过后可设为当前模型'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void onTest(providerId)}
            disabled={testing}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-3 text-sm text-[#5f6159] transition hover:text-[#171714] disabled:cursor-wait disabled:opacity-55"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
            测试联通性
          </button>
          <button
            type="button"
            onClick={() => onUse(providerId)}
            disabled={!ready}
            className="h-9 rounded-lg bg-[#171714] px-3 text-sm font-medium text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-not-allowed disabled:bg-[#c9c0ae]"
          >
            使用
          </button>
        </div>
      </div>
    </div>
  )
}

function MemoryPanel({
  memoryUsageBytes,
  agentMemoryRecords,
  agentRuns,
  onClear,
  onRebuild,
}: {
  memoryUsageBytes: number
  agentMemoryRecords: ReturnType<typeof useAppStore.getState>['agentMemoryRecords']
  agentRuns: ReturnType<typeof useAppStore.getState>['agentRuns']
  onClear: () => void
  onRebuild: () => void
}) {
  const activeMemories = agentMemoryRecords.filter((memory) => memory.status !== 'archived')
  const recentMemories = activeMemories.slice(0, 5)
  const recentRuns = agentRuns.slice(0, 5)

  return (
    <section className="mx-auto max-w-4xl">
      <PanelHeading
        icon={MemoryStick}
        title="存储与记忆"
        description="查看本地向量库占用，并管理长期记忆和项目索引。"
      />

      <div className="mt-5 rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-5 shadow-[0_8px_24px_rgba(43,34,19,0.04)]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-[#f4eddf] text-[#3f5845]">
              <HardDrive size={19} />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#171714]">向量数据库占用</div>
              <div className="text-xs text-[#7d7a70]">本地 RAG、摘要和长期记忆缓存</div>
            </div>
          </div>
          <div className="text-2xl font-semibold text-[#171714]">{formatBytes(memoryUsageBytes)}</div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <MemoryMetricCard
            icon={MemoryStick}
            label="Agent memories"
            value={String(activeMemories.length)}
            caption="Run summaries, preferences, remote contacts"
          />
          <MemoryMetricCard
            icon={ScrollText}
            label="Harness runs"
            value={String(agentRuns.length)}
            caption="Flow, Companion, and remote executions"
          />
          <DangerButton
            icon={Trash2}
            title="清空全局记忆"
            description="删除长期记忆缓存，保留文章和历史对话。"
            onClick={onClear}
          />
          <DangerButton
            icon={Database}
            title="重建项目索引"
            description="重新扫描项目文件，刷新 RAG 检索入口。"
            onClick={onRebuild}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <MemoryList
          title="Recent agent memories"
          empty="No local agent memories yet."
          items={recentMemories.map((memory) => ({
            id: memory.id,
            title: `${memory.kind} / ${memory.scope}`,
            body: memory.content,
            meta: `${memory.status} · confidence ${Math.round(memory.confidence * 100)}% · used ${memory.useCount}`,
          }))}
        />
        <MemoryList
          title="Recent harness runs"
          empty="No harness runs yet."
          items={recentRuns.map((run) => ({
            id: run.id,
            title: `${run.mode} / ${run.source} / ${run.status}`,
            body: run.summary || run.prompt,
            meta: `${run.stepCount} steps · ${run.traceCount} traces · ${new Date(run.startedAt).toLocaleString()}`,
          }))}
        />
      </div>
    </section>
  )
}

function MemoryMetricCard({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: typeof MemoryStick
  label: string
  value: string
  caption: string
}) {
  return (
    <div className="rounded-xl border border-[#e8ddc7] bg-[#fffdf7] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="grid size-9 place-items-center rounded-lg bg-[#f4eddf] text-[#3f5845]">
          <Icon size={17} />
        </div>
        <div className="text-2xl font-semibold text-[#171714]">{value}</div>
      </div>
      <div className="text-sm font-semibold text-[#171714]">{label}</div>
      <div className="mt-1 text-xs leading-5 text-[#7d7a70]">{caption}</div>
    </div>
  )
}

function MemoryList({
  title,
  empty,
  items,
}: {
  title: string
  empty: string
  items: Array<{ id: string; title: string; body: string; meta: string }>
}) {
  return (
    <div className="rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_8px_24px_rgba(43,34,19,0.04)]">
      <div className="mb-3 text-sm font-semibold text-[#171714]">{title}</div>
      {items.length ? (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-[#efe5d1] bg-[#fffdf7] p-3">
              <div className="text-xs font-semibold text-[#2f2b22]">{item.title}</div>
              <div className="mt-1 line-clamp-3 text-xs leading-5 text-[#6f7168]">{item.body}</div>
              <div className="mt-2 text-[11px] text-[#9d988a]">{item.meta}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[#d8d1c2] bg-[#fffdf7] p-4 text-xs text-[#8f897a]">
          {empty}
        </div>
      )}
    </div>
  )
}

function StatusRow({ check }: { check: MaintenanceCheck }) {
  const status = statusTheme(check.status)

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_8px_24px_rgba(43,34,19,0.04)]">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`relative grid size-3 place-items-center rounded-full ${status.dot}`}>
          {check.status === 'checking' ? (
            <span className="absolute size-5 animate-ping rounded-full bg-[#d7aa4f]/35" />
          ) : null}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#171714]">{check.label}</div>
          <div className="mt-1 truncate text-xs text-[#7d7a70]">{check.message}</div>
        </div>
      </div>
      <div className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.badge}`}>
        {status.label}
        {typeof check.latencyMs === 'number' ? ` · ${check.latencyMs}ms` : ''}
      </div>
    </div>
  )
}

function PanelHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Network
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-11 place-items-center rounded-xl border border-[#e8ddc7] bg-[#fffefa] text-[#3f5845]">
        <Icon size={20} />
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-[#171714]">{title}</h1>
        <p className="mt-1 text-sm leading-6 text-[#7d7a70]">{description}</p>
      </div>
    </div>
  )
}

function MaintenanceField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  readOnly = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  readOnly?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[#6f7168]">{label}</span>
      <input
        value={value}
        type={type}
        readOnly={readOnly}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-[#e8ddc7] bg-[#fffdf7] px-3 text-sm text-[#2f2b22] outline-none transition placeholder:text-[#9d988a] read-only:text-[#7d7a70] focus:border-[#d7aa4f]"
      />
    </label>
  )
}

function MaintenanceContextTiers({ providerId }: { providerId: ProviderId }) {
  const provider = useAppStore((state) => state.providerConfigs[providerId])
  const updateProviderConfig = useAppStore((state) => state.updateProviderConfig)

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-[#6f7168]">上下文上限</div>
      <div className="grid grid-cols-3 gap-2">
        {customContextTiers.map((tier) => {
          const active = (provider.customContextTier ?? '128k') === tier.id

          return (
            <button
              key={tier.id}
              type="button"
              onClick={() => updateProviderConfig(providerId, { customContextTier: tier.id })}
              className={`h-9 rounded-lg border text-sm transition ${
                active
                  ? 'border-[#171714] bg-[#171714] text-[#fffefa]'
                  : 'border-[#e8ddc7] bg-[#fffdf7] text-[#6f7168] hover:text-[#171714]'
              }`}
            >
              {tier.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DangerButton({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof Trash2
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-xl border border-[#ead4c9] bg-[#fffafa] p-4 text-left transition hover:border-[#d9a595]"
    >
      <Icon size={18} className="mt-0.5 text-[#a34e38]" />
      <span>
        <span className="block text-sm font-semibold text-[#2f2b22]">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-[#8f897a]">{description}</span>
      </span>
    </button>
  )
}

function ConfirmDangerDialog({
  action,
  onCancel,
  onConfirm,
}: {
  action: 'clear' | 'rebuild' | null
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const copy =
    action === 'clear'
      ? {
          title: '清空全局记忆？',
          body: '这会删除本地长期记忆缓存，但不会删除文章与聊天记录。',
        }
      : {
          title: '重建项目索引？',
          body: '系统会重新扫描项目材料，并覆盖旧的索引缓存。',
        }

  return (
    <AnimatePresence>
      {action ? (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-[#171714]/28 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-sm rounded-2xl border border-[#e8ddc7] bg-[#fffefa] p-5 shadow-[0_24px_70px_rgba(43,34,19,0.18)]"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
          >
            <div className="flex items-start gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-[#fff0eb] text-[#a34e38]">
                <ShieldAlert size={19} />
              </div>
              <div>
                <div className="text-base font-semibold text-[#171714]">{copy.title}</div>
                <p className="mt-1 text-sm leading-6 text-[#7d7a70]">{copy.body}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="h-9 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-3 text-sm text-[#5f6159] transition hover:text-[#171714]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void onConfirm()}
                className="h-9 rounded-lg bg-[#a34e38] px-3 text-sm font-medium text-white transition hover:bg-[#8e3f2d]"
              >
                确认执行
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function statusTheme(status: MaintenanceCheck['status']) {
  switch (status) {
    case 'ok':
      return { dot: 'bg-[#3f5845]', badge: 'bg-[#edf5e9] text-[#3f5845]', label: '正常' }
    case 'warning':
      return { dot: 'bg-[#d7aa4f]', badge: 'bg-[#fff7e3] text-[#7b5d18]', label: '注意' }
    case 'error':
      return { dot: 'bg-[#a34e38]', badge: 'bg-[#fff0eb] text-[#a34e38]', label: '失败' }
    case 'checking':
      return { dot: 'bg-[#d7aa4f]', badge: 'bg-[#fff7e3] text-[#7b5d18]', label: '检测中' }
    default:
      return { dot: 'bg-[#c9c0ae]', badge: 'bg-[#f4eddf] text-[#7d7a70]', label: '等待' }
  }
}

function formatBytes(bytes: number) {
  if (bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}
