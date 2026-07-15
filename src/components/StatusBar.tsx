import { Columns3, LogIn, PanelLeft, PanelRight, Radio, Sparkles } from 'lucide-react'
import { formatScallionPlanName } from '../services/scallionModelCatalog'
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
  const modelRoutingMode = useAppStore((state) => state.modelRoutingMode)
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const contextUsedTokens = useAppStore((state) => state.contextUsedTokens)
  const editorTokens = useAppStore((state) => state.editorTokens)
  const conversationTokens = useAppStore((state) => state.conversationTokens)
  const summaryTokens = useAppStore((state) => state.summaryTokens)
  const resourceTokens = useAppStore((state) => state.resourceTokens)
  const chatArticleTokens = useAppStore((state) => state.chatArticleTokens)
  const effectiveContextLimitTokens = useAppStore((state) => state.effectiveContextLimitTokens)
  const modelContextSource = useAppStore((state) => state.modelContextSource)
  const updateStatus = useAppStore((state) => state.updateStatus)
  const updateMessage = useAppStore((state) => state.updateMessage)
  const scallionUser = useAppStore((state) => state.scallionUser)
  const scallionQuota = useAppStore((state) => state.scallionQuota)
  const scallionSync = useAppStore((state) => state.scallionSync)
  const scallionToken = useAppStore((state) => state.scallionToken)
  const authStatus = useAppStore((state) => state.authStatus)
  const activeChatId = useAppStore((state) => state.activeChatId)
  const documentChangeStats = useAppStore((state) => state.documentChangeStats)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const activeProvider = providerConfigs[activeProviderId]
  const quotaPointsBalance = scallionQuota?.pointsBalance ?? scallionQuota?.remaining
  const visiblePointsBalance = quotaPointsBalance ?? scallionUser?.points ?? scallionUser?.balance
  const pointsAreCached = quotaPointsBalance === undefined || !scallionToken
  const conversationChangedChars = documentChangeStats
    .filter((stat) => stat.chatId === activeChatId)
    .reduce((sum, stat) => sum + stat.changedChars, 0)
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
  const contextTitle = [
    `已用 ${(contextUsedTokens / 1000).toFixed(1)}K / 上限 ${Math.round(effectiveContextLimitTokens / 1024)}K tokens`,
    `正文 ${(editorTokens / 1000).toFixed(1)}K`,
    `对话 ${(conversationTokens / 1000).toFixed(1)}K`,
    `摘要 ${(summaryTokens / 1000).toFixed(1)}K`,
    `资源 ${(resourceTokens / 1000).toFixed(1)}K`,
    `关联文稿 ${(chatArticleTokens / 1000).toFixed(1)}K`,
  ].join('\n')

  return (
    <footer className="papyrus-toolbar flex h-8 shrink-0 items-center justify-between gap-3 border-t px-2.5 text-[11px] text-[#6f7168]">
      <div className="flex shrink-0 items-center gap-1">
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
              className={`flex h-6 items-center gap-1 rounded-md px-2 ${
                active
                  ? 'bg-[#171714] text-[#fffefa] shadow-[0_5px_14px_rgba(23,23,20,0.12)]'
                  : 'text-[#6f7168] hover:bg-[#edf6eb] hover:text-[#171714]'
              }`}
            >
              <Icon size={13} />
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3 overflow-hidden">
        <span className="truncate">模式: {mode === 'companion' ? '写作' : '秘书'}</span>
        <span className="truncate">
          {modelRoutingMode === 'auto'
            ? `Auto 调度 · ${activeProvider.label} 兜底`
            : `${activeProvider.label} · ${
                activeProvider.type === 'scallion_proxy' ? '代理' : activeProvider.modelName || '未设置'
              }`}
        </span>
        <span
          className="truncate tabular-nums"
          title={contextTitle}
        >
          上下文 {contextPercent}% · {Math.round(effectiveContextLimitTokens / 1024)}K ·{' '}
          {contextSourceLabel}
        </span>
        <span className="truncate tabular-nums">累计修改 {conversationChangedChars} 字</span>
        {updateStatus !== 'idle' ? <span className="truncate">更新: {updateMessage}</span> : null}
        {scallionUser || scallionToken || scallionQuota ? (
          <span
            className="truncate tabular-nums"
            title={[
              scallionQuota?.planName || scallionQuota?.planKey || (scallionUser?.member_type ? formatScallionPlanName(scallionUser.member_type) : 'Scallion 套餐'),
              scallionQuota?.updatedAt ? `最近同步 ${formatSyncTime(scallionQuota.updatedAt)}` : '',
              scallionSync.quota.error || '',
            ]
            .filter(Boolean)
              .join(' · ')}
          >
            {scallionQuota?.planName || scallionQuota?.planKey || (scallionUser?.member_type ? formatScallionPlanName(scallionUser.member_type) : 'Scallion')} ·{' '}
            {visiblePointsBalance !== undefined
              ? `${pointsAreCached ? '缓存余' : '余'} ${visiblePointsBalance} ${scallionQuota?.unit ?? '积分'}`
              : scallionSync.quota.status === 'error'
                ? '积分同步失败'
                : '积分同步中'}
            {visiblePointsBalance !== undefined && scallionSync.quota.status === 'syncing' ? ' · 更新中' : ''}
            {visiblePointsBalance !== undefined && scallionSync.quota.status === 'stale' ? ' · 可能过期' : ''}
            {visiblePointsBalance !== undefined && scallionSync.quota.status === 'error' ? ' · 同步失败' : ''}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="papyrus-control inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2"
          >
            <LogIn size={12} />
            {authStatus === 'polling'
              ? '等待主站授权'
              : authStatus === 'reconnecting'
                ? '正在重连'
                : authStatus === 'expired'
                  ? '登录过期'
                  : '登录'}
          </button>
        )}
        <span className="hidden items-center gap-1 text-[#315d39] md:flex">
          <Radio size={13} />
          就绪
        </span>
        <Sparkles size={12} className="shrink-0 text-[#31a96b]" />
      </div>
    </footer>
  )
}

function formatSyncTime(value: number) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知时间' : date.toLocaleTimeString('zh-CN')
}
