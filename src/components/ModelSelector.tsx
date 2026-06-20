import { Check, ChevronDown, Cpu, Route, Settings2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { canCallProvider } from '../services/llmClient'
import { getEffectiveContextLimit, isProviderValidated } from '../services/modelCatalog'
import { providerOrder, useAppStore, type ProviderId } from '../stores/useAppStore'

export function ModelSelector({ compact = false }: { compact?: boolean }) {
  const activeProviderId = useAppStore((state) => state.activeProviderId)
  const setActiveProviderId = useAppStore((state) => state.setActiveProviderId)
  const modelRoutingMode = useAppStore((state) => state.modelRoutingMode)
  const setModelRoutingMode = useAppStore((state) => state.setModelRoutingMode)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const activeProvider = providerConfigs[activeProviderId]
  const groups = useMemo(
    () => [
      {
        title: '内置云模型',
        providers: providerOrder
          .map((providerId) => providerConfigs[providerId])
          .filter((provider) => provider.type === 'scallion_proxy'),
      },
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

  const selectProvider = (providerId: ProviderId) => {
    const provider = providerConfigs[providerId]
    const usable =
      provider.type === 'scallion_proxy' || (canCallProvider(provider) && isProviderValidated(provider))

    if (!usable) {
      setSettingsOpen(true)
      closeOpenDetails()
      return
    }

    setModelRoutingMode('manual')
    setActiveProviderId(providerId)
    closeOpenDetails()
  }

  const selectAuto = () => {
    setModelRoutingMode('auto')
    closeOpenDetails()
  }

  return (
    <details className="group/model-selector relative inline-flex shrink-0">
      <summary
        className={`inline-flex list-none items-center gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffefa] text-left text-xs text-[#5f6159] shadow-[0_4px_14px_rgba(43,34,19,0.04)] transition hover:border-[#d7aa4f]/70 hover:text-[#171714] [&::-webkit-details-marker]:hidden ${
          compact ? 'h-8 px-2' : 'h-10 px-3'
        }`}
        title="更换模型"
      >
        <Cpu size={14} className="text-[#3f5845]" />
        <span className="min-w-0">
          <span className="block max-w-36 truncate font-medium text-[#2f2b22]">
            {modelRoutingMode === 'auto' ? 'Auto 推荐' : activeProvider.label}
          </span>
          {!compact ? (
            <span className="block max-w-40 truncate text-[11px] text-[#8f897a]">
              {modelRoutingMode === 'auto'
                ? '秘书长自动选择模型'
                : activeProvider.type === 'scallion_proxy'
                  ? '内置代理'
                  : activeProvider.modelName}
            </span>
          ) : null}
        </span>
        <ChevronDown size={13} />
      </summary>

      <div className="absolute right-0 bottom-[calc(100%+10px)] z-50 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-2 shadow-[0_18px_60px_rgba(43,34,19,0.16)]">
        <div className="mb-2 flex items-center justify-between px-2 py-1">
          <div className="text-xs font-semibold text-[#2f2b22]">选择写作模型</div>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(true)
              closeOpenDetails()
            }}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#6f7168] transition hover:bg-[#f4ead8] hover:text-[#171714]"
          >
            <Settings2 size={12} />
            设置
          </button>
        </div>

        <div className="max-h-[min(360px,calc(100vh-180px))] space-y-3 overflow-y-auto p-1">
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

          {groups.map((group) => (
            <section key={group.title}>
              <div className="mb-1 px-1 text-[11px] font-medium uppercase text-[#9d988a]">
                {group.title}
              </div>
              <div className="space-y-1">
                {group.providers.map((provider) => {
                  const active = modelRoutingMode === 'manual' && provider.id === activeProviderId
                  const usable =
                    provider.type === 'scallion_proxy' ||
                    (canCallProvider(provider) && isProviderValidated(provider))

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
                        <span className="block truncate text-sm font-medium">{provider.label}</span>
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
      </div>
    </details>
  )
}

function closeOpenDetails() {
  document.querySelectorAll('details[open]').forEach((node) => {
    node.removeAttribute('open')
  })
}

function contextLabel(tokens: number) {
  if (tokens >= 1048576) return '1M'
  if (tokens >= 262144) return '256K'
  if (tokens >= 131072) return '128K'
  return `${Math.round(tokens / 1024)}K`
}
