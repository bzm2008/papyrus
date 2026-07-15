import { Check, ChevronDown, Cpu, Route, Settings2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { canCallProvider } from '../services/llmClient'
import { getEffectiveContextLimit, isProviderValidated } from '../services/modelCatalog'
import { formatScallionPlanName, getScallionModelAccess } from '../services/scallionModelCatalog'
import { getScallionQuotaDisplay, refreshScallionRuntimeMetadata } from '../services/scallionAccountService'
import {
  providerOrder,
  useAppStore,
  type ProviderId,
  type ScallionModelMetadata,
  type ScallionQuota,
  type ScallionUser,
} from '../stores/useAppStore'

type PopoverRect = {
  left: number
  top: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

export function ModelSelector({ compact = false }: { compact?: boolean }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [popoverRect, setPopoverRect] = useState<PopoverRect | null>(null)
  const activeProviderId = useAppStore((state) => state.activeProviderId)
  const setActiveProviderId = useAppStore((state) => state.setActiveProviderId)
  const modelRoutingMode = useAppStore((state) => state.modelRoutingMode)
  const setModelRoutingMode = useAppStore((state) => state.setModelRoutingMode)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const scallionModels = useAppStore((state) => state.scallionModels)
  const scallionPlan = useAppStore((state) => state.scallionPlan)
  const scallionQuota = useAppStore((state) => state.scallionQuota)
  const scallionSync = useAppStore((state) => state.scallionSync)
  const scallionUser = useAppStore((state) => state.scallionUser)
  const scallionToken = useAppStore((state) => state.scallionToken)
  const updateProviderModelMetadata = useAppStore((state) => state.updateProviderModelMetadata)
  const activeProvider = providerConfigs[activeProviderId] ?? providerConfigs.qwen36
  const currentScallionModel = useMemo(
    () =>
      scallionModels.find(
        (model) =>
          model.available &&
          model.planAvailable !== false &&
          model.modelName === providerConfigs.qwen36.modelName,
      ) ?? scallionModels.find((model) => model.available && model.planAvailable !== false),
    [providerConfigs.qwen36.modelName, scallionModels],
  )
  const activeLabel =
    modelRoutingMode === 'auto'
      ? 'Auto 推荐'
      : activeProvider.type === 'scallion_proxy'
        ? currentScallionModel?.label || (scallionToken ? '套餐模型加载中' : '登录后选择模型')
        : activeProvider.label
  const activeSubLabel =
    modelRoutingMode === 'auto'
      ? '秘书长自动选择模型'
      : activeProvider.type === 'scallion_proxy'
        ? currentScallionModel
          ? `${currentScallionModel.modelName} · ${contextLabel(currentScallionModel.contextWindowTokens)}`
          : scallionQuota?.planName || scallionQuota?.planKey || scallionPlan?.name || scallionPlan?.key || scallionUser?.member_type
            ? `${scallionQuota?.planName || scallionQuota?.planKey || scallionPlan?.name || scallionPlan?.key || formatScallionPlanName(scallionUser?.member_type ?? '')} · ${formatPoints(scallionQuota, scallionSync.quota.status, scallionUser, scallionToken)}`
            : '套餐模型尚未获取'
        : activeProvider.modelName
  const groups = useMemo(
    () => [
      {
        title: '厂商 Key',
        providers: providerOrder
          .map((providerId) => providerConfigs[providerId])
          .filter((provider) => provider.type === 'vendor_key'),
      },
      {
        title: '自定义模型',
        providers: providerOrder
          .map((providerId) => providerConfigs[providerId])
          .filter((provider) => provider.type === 'custom'),
      },
    ],
    [providerConfigs],
  )

  const close = () => setOpen(false)
  const openSettings = () => {
    setSettingsOpen(true)
    close()
  }

  const updatePopoverRect = () => {
    const button = buttonRef.current

    if (!button) {
      return
    }

    const trigger = button.getBoundingClientRect()
    const width = Math.min(380, window.innerWidth - 24)
    const left = Math.min(Math.max(12, trigger.right - width), window.innerWidth - width - 12)
    const spaceBelow = window.innerHeight - trigger.bottom - 12
    const spaceAbove = trigger.top - 12
    const placement = spaceBelow >= 260 || spaceBelow >= spaceAbove ? 'bottom' : 'top'
    const availableHeight = placement === 'bottom' ? spaceBelow : spaceAbove
    const maxHeight = Math.max(220, Math.min(390, availableHeight))
    const top =
      placement === 'bottom'
        ? trigger.bottom + 8
        : Math.max(12, trigger.top - maxHeight - 8)

    setPopoverRect({ left, top, width, maxHeight, placement })
  }

  useEffect(() => {
    if (!open) {
      return undefined
    }

    updatePopoverRect()

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      const popover = document.getElementById('papyrus-model-selector-popover')

      if (buttonRef.current?.contains(target) || popover?.contains(target)) {
        return
      }

      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    const onViewportChange = () => updatePopoverRect()

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open])

  const selectProvider = (providerId: ProviderId) => {
    const provider = providerConfigs[providerId]
    const usable = canCallProvider(provider) && isProviderValidated(provider)

    if (!usable) {
      openSettings()
      return
    }

    setModelRoutingMode('manual')
    setActiveProviderId(providerId)
    close()
  }

  const selectScallionModel = (model: ScallionModelMetadata) => {
    const access = getScallionModelAccess(model)
    if (!access.usable) {
      return
    }

    updateProviderModelMetadata('qwen36', {
      label: model.label,
      modelName: model.modelName,
      contextWindowTokens: model.contextWindowTokens,
    })
    setModelRoutingMode('manual')
    setActiveProviderId('qwen36')
    close()
  }

  const selectAuto = () => {
    setModelRoutingMode('auto')
    close()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffefa] text-left text-xs text-[#5f6159] shadow-[0_4px_14px_rgba(43,34,19,0.04)] transition hover:border-[#d7aa4f]/70 hover:text-[#171714] ${
          compact ? 'h-8 px-2' : 'h-10 px-3'
        }`}
        title="更换模型"
      >
        <Cpu size={14} className="text-[#3f5845]" />
        <span className="min-w-0">
          <span className="block max-w-36 truncate font-medium text-[#2f2b22]">
            {activeLabel}
          </span>
          {!compact ? (
            <span className="block max-w-44 truncate text-[11px] text-[#8f897a]">
              {activeSubLabel}
            </span>
          ) : null}
        </span>
        <ChevronDown size={13} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && popoverRect
        ? createPortal(
            <div
              id="papyrus-model-selector-popover"
              role="menu"
              className="fixed z-[90] overflow-hidden rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-2 shadow-[0_18px_60px_rgba(43,34,19,0.16)] papyrus-window-enter"
              style={{
                left: popoverRect.left,
                top: popoverRect.top,
                width: popoverRect.width,
                maxHeight: popoverRect.maxHeight,
              }}
            >
              <div className="mb-2 flex items-center justify-between px-2 py-1">
                <div className="text-xs font-semibold text-[#2f2b22]">选择写作模型</div>
                <button
                  type="button"
                  onClick={openSettings}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#6f7168] transition hover:bg-[#f4ead8] hover:text-[#171714]"
                >
                  <Settings2 size={12} />
                  设置
                </button>
              </div>

              <div
                className="papyrus-scrollbar space-y-3 overflow-y-auto p-1"
                style={{ maxHeight: popoverRect.maxHeight - 44 }}
              >
                <section>
                  <button
                    type="button"
                    onClick={selectAuto}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                      modelRoutingMode === 'auto'
                        ? 'border-[#171714] bg-[#171714] text-[#fffefa]'
                        : 'border-[#d7aa4f]/45 bg-[#fff9ed] text-[#4f4a3d] hover:border-[#d7aa4f]/80'
                    }`}
                  >
                    <span className="flex min-w-0 items-start gap-2">
                      <Route size={15} className="mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">Auto 推荐</span>
                        <span className={`block truncate text-xs ${modelRoutingMode === 'auto' ? 'text-[#d6d0c4]' : 'text-[#8f897a]'}`}>
                          推荐开启：规划、执行、审查会自动匹配可用模型
                        </span>
                      </span>
                    </span>
                    {modelRoutingMode === 'auto' ? <Check size={15} /> : <ShieldCheck size={15} />}
                  </button>
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[#2f2b22]">
                        {scallionQuota?.planName || scallionQuota?.planKey || scallionPlan?.name || scallionPlan?.key || (scallionUser?.member_type ? formatScallionPlanName(scallionUser.member_type) : scallionToken ? '套餐读取中' : '未登录 Scallion')}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-[#8f897a]">
                        {scallionToken
                          ? formatPoints(scallionQuota, scallionSync.quota.status, scallionUser, scallionToken)
                          : '登录后同步套餐和积分'}
                        {(scallionQuota?.planExpiresAt ?? scallionPlan?.expiresAt) ? ` · 到期 ${formatExpiry((scallionQuota?.planExpiresAt ?? scallionPlan?.expiresAt) as string)}` : ''}
                        {scallionQuota?.updatedAt ? ` · ${formatSyncTime(scallionQuota.updatedAt)}` : ''}
                        {scallionSync.quota.error ? ` · ${scallionSync.quota.error}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (scallionToken) {
                          void refreshScallionRuntimeMetadata()
                        } else {
                          openSettings()
                        }
                      }}
                      className="shrink-0 rounded-md border border-[#e8ddc7] px-2 py-1 text-[11px] text-[#6f7168] hover:text-[#171714]"
                    >
                      {scallionToken ? '刷新' : '登录'}
                    </button>
                  </div>
                </section>

                {scallionModels.length ? (
                  <section>
                    {(() => {
                      const restrictedCount = scallionModels.filter((model) => !getScallionModelAccess(model).usable).length
                      const availableCount = scallionModels.length - restrictedCount

                      return (
                        <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-medium uppercase text-[#9d988a]">
                          <span>主站模型目录</span>
                          <span>
                            可用 {availableCount} · 受限 {restrictedCount}
                          </span>
                        </div>
                      )
                    })()}
                    <div className="space-y-1">
                      {scallionModels.map((model) => {
                        const access = getScallionModelAccess(model)
                        const active =
                          access.usable &&
                          modelRoutingMode === 'manual' &&
                          activeProviderId === 'qwen36' &&
                          providerConfigs.qwen36.modelName === model.modelName
                        const disabled = !access.usable

                        return (
                          <button
                            key={model.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => selectScallionModel(model)}
                            title={disabled ? `${model.label}：${access.detail}` : `${model.label}：当前套餐可调用`}
                            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              active
                                ? 'border-[#171714] bg-[#171714] text-[#fffefa]'
                                : 'border-transparent text-[#5f6159] hover:border-[#e8ddc7] hover:bg-[#fffdf7]'
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">{model.label}</span>
                              <span className={`block break-words text-xs leading-4 ${active ? 'text-[#d6d0c4]' : 'text-[#8f897a]'}`}>
                                {model.modelName} · {contextLabel(model.contextWindowTokens)}
                                {model.tier ? ` · ${model.tier}` : ''}
                              </span>
                              <span
                                className={`mt-1 block break-words text-[11px] leading-4 ${
                                  active
                                    ? 'text-[#f0d99b]'
                                    : access.status === 'available'
                                      ? 'text-[#416746]'
                                      : 'text-[#9a4338]'
                                }`}
                              >
                                {access.label}
                                {disabled ? ` · ${access.detail}` : ''}
                              </span>
                            </span>
                            {active ? (
                              <Check size={15} />
                            ) : access.status !== 'available' ? (
                              <TriangleAlert size={15} className="text-[#b7791f]" />
                            ) : (
                              <ShieldCheck size={15} />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ) : (
                  <div className="rounded-lg border border-dashed border-[#e8ddc7] px-3 py-3 text-xs leading-5 text-[#8f897a]">
                    {scallionToken ? '当前套餐模型列表为空，请刷新账户或检查主站。' : '登录 Scallion 后显示套餐模型。'}
                  </div>
                )}

                {groups.map((group) => (
                  <section key={group.title}>
                    <div className="mb-1 px-1 text-[11px] font-medium uppercase text-[#9d988a]">
                      {group.title}
                    </div>
                    <div className="space-y-1">
                      {group.providers.map((provider) => {
                        const active = modelRoutingMode === 'manual' && provider.id === activeProviderId
                        const usable = canCallProvider(provider) && isProviderValidated(provider)

                        return (
                          <button
                            key={provider.id}
                            type="button"
                            onClick={() => selectProvider(provider.id)}
                            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                              active
                                ? 'border-[#171714] bg-[#171714] text-[#fffefa]'
                                : 'border-transparent text-[#5f6159] hover:border-[#e8ddc7] hover:bg-[#fffdf7]'
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">
                                {provider.id === 'qwen36' ? currentScallionModel?.label || provider.label : provider.label}
                              </span>
                              <span className={`block truncate text-xs ${active ? 'text-[#d6d0c4]' : 'text-[#8f897a]'}`}>
                                {provider.modelName || '未填写模型名'} · {contextLabel(getEffectiveContextLimit(provider))}
                              </span>
                            </span>
                            {active ? (
                              <Check size={15} />
                            ) : usable ? (
                              <ShieldCheck size={15} />
                            ) : (
                              <TriangleAlert size={15} />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <div
                aria-hidden="true"
                className={`absolute right-5 size-3 rotate-45 border-[#e8ddc7] bg-[#fffefa] ${
                  popoverRect.placement === 'top'
                    ? '-bottom-1.5 border-b border-r'
                    : '-top-1.5 border-l border-t'
                }`}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function contextLabel(tokens?: number) {
  if (!tokens || tokens <= 0) return '上下文未知'
  if (tokens >= 1048576) return '1M'
  if (tokens >= 262144) return '256K'
  if (tokens >= 131072) return '128K'
  return `${Math.round(tokens / 1024)}K`
}

function formatPoints(
  quota: ScallionQuota | undefined,
  status: 'idle' | 'syncing' | 'ready' | 'stale' | 'error' = 'idle',
  user?: ScallionUser,
  token?: string,
) {
  const display = getScallionQuotaDisplay({ token, quota, user, syncStatus: status })
  const value = display.value
  if (value === undefined) return status === 'error' ? '积分同步失败' : '积分同步中'
  const freshness =
    display.source === 'realtime'
      ? ''
      : status === 'syncing'
      ? ' · 更新中'
      : status === 'stale'
        ? ' · 可能过期'
        : status === 'error'
          ? ' · 同步失败'
          : ''
  const source = display.source === 'cached' && status !== 'syncing' && status !== 'stale' && status !== 'error'
    ? ' · 登录缓存'
    : ''
  return `余 ${value} ${quota?.unit ?? '积分'}${freshness}${source}`
}

function formatExpiry(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN')
}

function formatSyncTime(value: number) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : `同步 ${date.toLocaleTimeString('zh-CN')}`
}
