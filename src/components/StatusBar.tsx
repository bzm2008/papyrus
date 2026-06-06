import { Columns3, LogIn, PanelLeft, PanelRight, Radio, Sparkles } from 'lucide-react'
import { type ColumnMode, useAppStore } from '../stores/useAppStore'

const columnControls: Array<{
  value: ColumnMode
  label: string
  title: string
  icon: typeof PanelLeft
}> = [
  { value: 1, label: '一栏', title: '只显示主编辑区', icon: PanelLeft },
  { value: 2, label: '二栏', title: '显示主编辑区和右侧文学秘书', icon: PanelRight },
  { value: 3, label: '三栏', title: '显示项目导航、主编辑区和右侧文学秘书', icon: Columns3 },
]

export function StatusBar() {
  const columnMode = useAppStore((state) => state.columnMode)
  const setColumnMode = useAppStore((state) => state.setColumnMode)
  const mode = useAppStore((state) => state.mode)
  const activeProviderId = useAppStore((state) => state.activeProviderId)
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const contextUsedTokens = useAppStore((state) => state.contextUsedTokens)
  const effectiveContextLimitTokens = useAppStore((state) => state.effectiveContextLimitTokens)
  const modelContextSource = useAppStore((state) => state.modelContextSource)
  const updateStatus = useAppStore((state) => state.updateStatus)
  const updateMessage = useAppStore((state) => state.updateMessage)
  const scallionUser = useAppStore((state) => state.scallionUser)
  const authStatus = useAppStore((state) => state.authStatus)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const activeProvider = providerConfigs[activeProviderId]
  const contextPercent = Math.min(
    999,
    Math.round((contextUsedTokens / Math.max(1, effectiveContextLimitTokens)) * 100),
  )
  const contextSourceLabel =
    modelContextSource === 'server'
      ? '服务端'
      : modelContextSource === 'custom_tier'
        ? '自定义'
        : '预设'

  return (
    <footer className="flex h-9 shrink-0 items-center justify-between border-t border-[#e1dccf] bg-[#fffefa]/92 px-3 text-xs text-[#6f7168] backdrop-blur">
      <div className="flex items-center gap-1">
        {columnControls.map((item) => {
          const Icon = item.icon
          const active = columnMode === item.value

          return (
            <button
              key={item.value}
              type="button"
              title={item.title}
              aria-pressed={active}
              onClick={() => setColumnMode(item.value)}
              className={`flex h-7 items-center gap-1 rounded-lg px-2 transition ${
                active
                  ? 'bg-[#171714] text-[#fffefa] shadow-[0_8px_18px_rgba(23,23,20,0.14)]'
                  : 'text-[#6f7168] hover:bg-[#edf6eb] hover:text-[#171714]'
              }`}
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex min-w-0 items-center gap-4">
        <span className="truncate">模式: {mode === 'companion' ? '秘书' : 'Flow'}</span>
        <span className="truncate">
          模型: {activeProvider.label} /{' '}
          {activeProvider.type === 'scallion_proxy' ? '代理' : activeProvider.modelName || '未设置'}
        </span>
        <span className="truncate">
          Context: {contextPercent}% · {Math.round(effectiveContextLimitTokens / 1024)}K ·{' '}
          {contextSourceLabel}
        </span>
        {updateStatus !== 'idle' ? <span className="truncate">更新: {updateMessage}</span> : null}
        {scallionUser ? (
          <span className="truncate">Scallion: {scallionUser.username}</span>
        ) : (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-[#dfe4d6] bg-[#fffdf7] px-2 text-[#5f6159] transition hover:border-[#31a96b] hover:text-[#171714]"
          >
            <LogIn size={12} />
            {authStatus === 'polling' ? '等待主站授权' : '登录 Scallion'}
          </button>
        )}
        <span className="flex items-center gap-1 text-[#315d39]">
          <Radio size={14} />
          本地工作台就绪
        </span>
        <Sparkles size={13} className="text-[#31a96b]" />
      </div>
    </footer>
  )
}
