import { Activity, ChevronDown, ChevronUp, Database, FileText, Radio } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'

export function UsageBubble() {
  const activeProviderId = useAppStore((state) => state.activeProviderId)
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const contextUsedTokens = useAppStore((state) => state.contextUsedTokens)
  const effectiveContextLimitTokens = useAppStore((state) => state.effectiveContextLimitTokens)
  const editorTokens = useAppStore((state) => state.editorTokens)
  const conversationTokens = useAppStore((state) => state.conversationTokens)
  const resources = useAppStore((state) => state.resources)
  const llmRunState = useAppStore((state) => state.llmRunState)
  const companionRunState = useAppStore((state) => state.companionRunState)
  const isUsageCollapsed = useAppStore((state) => state.isUsageCollapsed)
  const setUsageCollapsed = useAppStore((state) => state.setUsageCollapsed)
  const activeProvider = providerConfigs[activeProviderId]
  const contextPercent = Math.min(
    100,
    Math.round((contextUsedTokens / Math.max(1, effectiveContextLimitTokens)) * 100),
  )
  const isRunning = llmRunState === 'running' || companionRunState === 'running'

  if (isUsageCollapsed) {
    return (
      <aside className="fixed bottom-12 right-4 z-40 hidden rounded-xl border border-[#dfe4d6] bg-[#fffefa]/96 p-2 text-xs text-[#5f6159] shadow-[0_14px_38px_rgba(36,45,29,0.12)] backdrop-blur md:block">
        <button
          type="button"
          onClick={() => setUsageCollapsed(false)}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#f7f8f3]"
          title="展开用量"
        >
          <Activity size={13} className={isRunning ? 'text-[#31a96b]' : 'text-[#315d39]'} />
          <span>上下文 {contextPercent}%</span>
          <span className="max-w-24 truncate text-[#8f897a]">{activeProvider.label}</span>
          <ChevronUp size={13} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="fixed bottom-12 right-4 z-40 hidden w-[260px] rounded-xl border border-[#dfe4d6] bg-[#fffefa]/96 p-3 text-xs text-[#5f6159] shadow-[0_14px_38px_rgba(36,45,29,0.12)] backdrop-blur md:block">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 font-medium text-[#20201d]">
          <Activity size={13} className={isRunning ? 'text-[#31a96b]' : 'text-[#315d39]'} />
          用量
        </span>
        <button
          type="button"
          onClick={() => setUsageCollapsed(true)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[#8f897a] hover:bg-[#f7f8f3]"
          title="收起用量"
        >
          <span className={isRunning ? 'text-[#31a96b]' : 'text-[#8f897a]'}>
            {isRunning ? '运行中' : '待命'}
          </span>
          <ChevronDown size={13} />
        </button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#e8e1d3]">
        <div
          className="h-full rounded-full bg-[#315d39] transition-[width] duration-300"
          style={{ width: `${contextPercent}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric icon={FileText} label="文稿" value={formatNumber(editorTokens)} />
        <Metric icon={Radio} label="对话" value={formatNumber(conversationTokens)} />
        <Metric icon={Database} label="资料" value={String(resources.length)} />
      </div>
      <div className="mt-3 truncate border-t border-[#ebe5d7] pt-2 text-[#6f7168]">
        {activeProvider.label} · {activeProvider.modelName || '未设置模型'} · {contextPercent}%
      </div>
    </aside>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg bg-[#f7f8f3] px-2 py-1.5">
      <div className="mb-1 flex items-center gap-1 text-[#6f7168]">
        <Icon size={12} />
        {label}
      </div>
      <div className="font-semibold text-[#20201d]">{value}</div>
    </div>
  )
}

function formatNumber(value: number) {
  if (value >= 1000) {
    return `${Math.round(value / 100) / 10}k`
  }

  return String(value)
}
