import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  DownloadCloud,
  ExternalLink,
  KeyRound,
  Link,
  Lock,
  LogOut,
  RotateCcw,
  Server,
  SlidersHorizontal,
  TestTube2,
  UserRound,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { callOpenAICompatible, canCallProvider } from '../services/llmClient'
import {
  customContextTiers,
  isProviderValidated,
  providerValidationSignature,
} from '../services/modelCatalog'
import { checkAndDownloadUpdate, relaunchToInstallUpdate } from '../services/updater'
import { logoutScallion, startScallionLogin } from '../services/scallionAuth'
import { providerOrder, useAppStore, type ProviderId } from '../stores/useAppStore'
import { BrandMark } from './BrandMark'

export function SettingsPanel() {
  const [checkingProviderId, setCheckingProviderId] = useState<ProviderId | null>(null)
  const [checkMessages, setCheckMessages] = useState<Partial<Record<ProviderId, string>>>({})
  const [selectedVendorId, setSelectedVendorId] = useState<ProviderId>('openai')
  const isOpen = useAppStore((state) => state.isSettingsOpen)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const resetOobe = useAppStore((state) => state.resetOobe)
  const activeProviderId = useAppStore((state) => state.activeProviderId)
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const updateProviderConfig = useAppStore((state) => state.updateProviderConfig)
  const updateStatus = useAppStore((state) => state.updateStatus)
  const updateMessage = useAppStore((state) => state.updateMessage)
  const updateProgress = useAppStore((state) => state.updateProgress)
  const updateVersion = useAppStore((state) => state.updateVersion)
  const scallionUser = useAppStore((state) => state.scallionUser)
  const authStatus = useAppStore((state) => state.authStatus)
  const authUserCode = useAppStore((state) => state.authUserCode)
  const cloudProvider = providerConfigs.qwen36
  const customProvider = providerConfigs.custom
  const vendorProviders = providerOrder
    .map((providerId) => providerConfigs[providerId])
    .filter((provider) => provider.type === 'vendor_key')

  const validateProvider = async (providerId: ProviderId) => {
    const provider = useAppStore.getState().providerConfigs[providerId]

    if (!canCallProvider(provider)) {
      setCheckMessages((messages) => ({
        ...messages,
        [providerId]: '请先填写 API Key、模型名和 Base URL。',
      }))
      return
    }

    setCheckingProviderId(providerId)
    setCheckMessages((messages) => ({ ...messages, [providerId]: '正在检测模型连通性...' }))

    try {
      await callOpenAICompatible(provider, [
        {
          role: 'system',
          content: 'You are a connectivity checker. Reply with exactly: OK',
        },
        { role: 'user', content: 'OK' },
      ])
      updateProviderConfig(providerId, {
        validatedAt: Date.now(),
        lastValidatedSignature: providerValidationSignature(provider),
      })
      useAppStore.getState().setActiveProviderId(providerId)
      setCheckMessages((messages) => ({ ...messages, [providerId]: '检测通过，可以使用。' }))
    } catch (error) {
      setCheckMessages((messages) => ({
        ...messages,
        [providerId]: error instanceof Error ? error.message : '检测失败，请检查配置。',
      }))
    } finally {
      setCheckingProviderId(null)
    }
  }

  return (
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.button
            type="button"
            aria-label="关闭设置面板"
            className="fixed inset-0 z-40 bg-[#171714]/24 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSettingsOpen(false)}
          />
          <motion.aside
            className="fixed right-0 top-0 z-50 flex h-screen w-[560px] max-w-[calc(100vw-24px)] flex-col border-l border-[#e8ddc7] bg-[#fffefa] shadow-[0_24px_80px_rgba(43,34,19,0.22)]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#e8ddc7] px-4">
              <div className="flex min-w-0 items-center gap-3">
                <BrandMark size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#171714]">
                    <SlidersHorizontal size={15} className="text-[#6f7f68]" />
                    模型与全局设置
                  </div>
                  <div className="truncate text-xs text-[#8f897a]">
                    内置代理不保存上游密钥；用户密钥仅保存在本机
                  </div>
                </div>
              </div>
              <button
                type="button"
                title="关闭设置"
                onClick={() => setSettingsOpen(false)}
                className="papyrus-icon-button size-8 rounded-lg border-0 bg-transparent"
              >
                <X size={18} />
              </button>
            </div>

            <div className="papyrus-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                <section className="rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.04)]">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#2f2b22]">
                        <UserRound size={15} className="text-[#6f7f68]" />
                        Scallion 账号
                      </div>
                      <div className="mt-1 text-xs leading-5 text-[#8f897a]">
                        通过主站授权登录 Papyrus，用于内置模型、会员状态和后续同步。
                      </div>
                    </div>
                    {scallionUser ? (
                      <button
                        type="button"
                        onClick={() => logoutScallion()}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2.5 text-xs text-[#6f7168] transition hover:text-[#171714]"
                      >
                        <LogOut size={13} />
                        退出
                      </button>
                    ) : null}
                  </div>

                  {scallionUser ? (
                    <div className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3 text-sm text-[#2f2b22]">
                      <div className="font-medium">{scallionUser.username}</div>
                      <div className="mt-1 text-xs text-[#8f897a]">
                        {scallionUser.is_member ? '会员账号' : '普通账号'} · 积分 {scallionUser.points ?? 0}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
                      <div className="text-xs leading-5 text-[#8f897a]">
                        {authStatus === 'polling'
                          ? `已打开授权页，等待确认${authUserCode ? ` · ${authUserCode}` : ''}`
                          : authStatus === 'error'
                            ? '登录失败，请稍后重试。'
                            : authStatus === 'expired'
                              ? '设备码已过期，请重新登录。'
                              : '点击后会打开 scallion.uno 授权页。'}
                      </div>
                      <button
                        type="button"
                        onClick={() => void startScallionLogin()}
                        disabled={authStatus === 'starting' || authStatus === 'polling'}
                        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#171714] px-3 text-sm font-medium text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-wait disabled:opacity-50"
                      >
                        <ExternalLink size={14} />
                        {authStatus === 'starting' || authStatus === 'polling' ? '等待授权' : '登录主站'}
                      </button>
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-[#d7aa4f]/45 bg-[#fff7e3] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.05)]">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#2f2b22]">内置云模型</div>
                      <div className="mt-1 text-xs leading-5 text-[#6f7168]">
                        {cloudProvider.setupHint}
                      </div>
                    </div>
                    <ProviderUseButton providerId="qwen36" />
                  </div>
                  <div className="grid gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffefa] p-3 text-xs text-[#6f7168]">
                    <InfoRow label="显示名称" value={cloudProvider.label} />
                    <InfoRow label="代理入口" value={cloudProvider.baseUrl} />
                    <InfoRow label="实际模型" value={cloudProvider.modelName} />
                    <InfoRow label="上下文" value="128K" />
                  </div>
                </section>

                <section className="rounded-xl border border-[#e8ddc7] bg-[#fffdf7] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.05)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#2f2b22]">自动更新</div>
                      <div className="mt-1 text-xs text-[#8f897a]">
                        Endpoint: https://scallion.uno/api/papyrus/update
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void checkAndDownloadUpdate()}
                      disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#171714] px-3 text-sm font-medium text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-wait disabled:opacity-50"
                    >
                      <DownloadCloud size={15} />
                      检查更新
                    </button>
                  </div>

                  <div className="rounded-lg border border-[#e8ddc7] bg-[#fffefa] p-3">
                    <div className="flex items-center justify-between text-xs text-[#6f7168]">
                      <span>{updateMessage}</span>
                      <span>{updateVersion ? `v${updateVersion}` : `${updateProgress}%`}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f0e6d2]">
                      <motion.div
                        className="h-full rounded-full bg-[#6f7f68]"
                        initial={false}
                        animate={{
                          width:
                            updateStatus === 'checking'
                              ? '18%'
                              : updateStatus === 'not-available'
                                ? '100%'
                                : `${updateProgress}%`,
                        }}
                      />
                    </div>
                    {updateStatus === 'ready' ? (
                      <button
                        type="button"
                        onClick={() => void relaunchToInstallUpdate()}
                        className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border border-[#d7aa4f]/45 bg-[#fff7e3] px-3 text-xs font-medium text-[#3f5845] transition hover:border-[#d7aa4f]"
                      >
                        <RotateCcw size={14} />
                        重启并应用更新
                      </button>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.04)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#2f2b22]">初始化向导</div>
                      <div className="mt-1 text-xs leading-5 text-[#8f897a]">
                        重新查看功能展示页，并回到环境初始化控制台。
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        resetOobe()
                        setSettingsOpen(false)
                      }}
                      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-3 text-xs font-medium text-[#6f7168] transition hover:text-[#171714]"
                    >
                      <RotateCcw size={14} />
                      重新初始化
                    </button>
                  </div>
                </section>

                <section className="rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.04)]">
                  <div className="mb-3">
                    <div className="text-sm font-semibold text-[#2f2b22]">厂商 Key</div>
                    <div className="mt-1 text-xs leading-5 text-[#8f897a]">
                      选择厂商后填写 API Key、模型名和上下文档位；检测通过后才可切换使用。
                    </div>
                  </div>
                  <VendorUnifiedCard
                    providerIds={vendorProviders.map((provider) => provider.id)}
                    selectedProviderId={selectedVendorId}
                    activeProviderId={activeProviderId}
                    checking={checkingProviderId === selectedVendorId}
                    message={checkMessages[selectedVendorId]}
                    onSelect={setSelectedVendorId}
                    onValidate={validateProvider}
                  />
                </section>

                <section className="rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.04)]">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#2f2b22]">自定义模型</div>
                      <div className="mt-1 text-xs leading-5 text-[#8f897a]">
                        适合任意 OpenAI-compatible 服务。检测通过后才可使用。
                      </div>
                    </div>
                    <ProviderUseButton providerId="custom" />
                  </div>

                  <div className="space-y-3">
                    <Field
                      icon={Lock}
                      label="显示名称"
                      value={customProvider.label}
                      placeholder="例如：我的本地模型"
                      onChange={(value) => updateProviderConfig('custom', { label: value })}
                    />
                    <Field
                      icon={Server}
                      label="Base URL"
                      value={customProvider.baseUrl}
                      placeholder="https://example.com/v1"
                      onChange={(value) => updateProviderConfig('custom', { baseUrl: value })}
                    />
                    <Field
                      icon={Lock}
                      label="Model Name"
                      value={customProvider.modelName}
                      placeholder="your-model-name"
                      onChange={(value) => updateProviderConfig('custom', { modelName: value })}
                    />
                    <Field
                      icon={KeyRound}
                      label="API Key"
                      value={customProvider.apiKey}
                      placeholder="sk-..."
                      type="password"
                      onChange={(value) => updateProviderConfig('custom', { apiKey: value })}
                    />
                    <ContextTierButtons providerId="custom" />
                    <ProviderCheckRow
                      providerId="custom"
                      checking={checkingProviderId === 'custom'}
                      message={checkMessages.custom}
                      onValidate={validateProvider}
                    />
                  </div>
                </section>
              </div>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  )
}

function VendorUnifiedCard({
  providerIds,
  selectedProviderId,
  activeProviderId,
  checking,
  message,
  onSelect,
  onValidate,
}: {
  providerIds: ProviderId[]
  selectedProviderId: ProviderId
  activeProviderId: ProviderId
  checking: boolean
  message?: string
  onSelect: (providerId: ProviderId) => void
  onValidate: (providerId: ProviderId) => void
}) {
  const provider = useAppStore((state) => state.providerConfigs[selectedProviderId])
  const updateProviderConfig = useAppStore((state) => state.updateProviderConfig)
  const setActiveProviderId = useAppStore((state) => state.setActiveProviderId)
  const ready = isProviderValidated(provider)

  return (
    <div className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[#6f7168]">平台</span>
        <select
          value={selectedProviderId}
          onChange={(event) => onSelect(event.target.value as ProviderId)}
          className="h-10 w-full rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-3 text-sm text-[#2f2b22] outline-none transition focus:border-[#d7aa4f]"
        >
          {providerIds.map((providerId) => {
            const item = useAppStore.getState().providerConfigs[providerId]
            return (
              <option key={providerId} value={providerId}>
                {item.label}
              </option>
            )
          })}
        </select>
      </label>

      <div className="mt-3 grid gap-3">
        <div className="flex items-center gap-2">
          <SecretInput
            value={provider.apiKey}
            placeholder="粘贴 API Key"
            onChange={(value) => updateProviderConfig(provider.id, { apiKey: value })}
          />
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2.5 text-xs text-[#6f7168] transition hover:text-[#171714]"
          >
            <ExternalLink size={13} />
            开发平台
          </a>
        </div>
        <Field
          icon={Lock}
          label="Model Name"
          value={provider.modelName}
          placeholder="请输入模型名"
          onChange={(value) => updateProviderConfig(provider.id, { modelName: value })}
        />
        <ContextTierButtons providerId={provider.id} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`text-xs ${ready ? 'text-[#3f5845]' : 'text-[#8f897a]'}`}>
            {message || (ready ? '检测通过，可以使用。' : '检测令牌与模型有效后会自动保存。')}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onValidate(provider.id)}
              disabled={checking}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2.5 text-xs text-[#6f7168] transition hover:text-[#171714] disabled:cursor-wait disabled:opacity-50"
            >
              <TestTube2 size={13} />
              {checking ? '检测中' : '检测并保存'}
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={() => setActiveProviderId(provider.id)}
              className={`h-8 rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
                activeProviderId === provider.id
                  ? 'bg-[#171714] text-[#fffefa]'
                  : 'border border-[#e8ddc7] bg-[#fffefa] text-[#6f7168] hover:text-[#171714]'
              }`}
            >
              {activeProviderId === provider.id ? '使用中' : '使用'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProviderCard({
  providerId,
  active,
  checking,
  message,
  onValidate,
}: {
  providerId: ProviderId
  active: boolean
  checking: boolean
  message?: string
  onValidate: (providerId: ProviderId) => void
}) {
  const provider = useAppStore((state) => state.providerConfigs[providerId])
  const updateProviderConfig = useAppStore((state) => state.updateProviderConfig)

  return (
    <div className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-[#2f2b22]">
            {active ? <Check size={14} className="text-[#3f5845]" /> : null}
            {provider.label}
          </div>
          <div className="mt-1 text-xs leading-5 text-[#8f897a]">{provider.setupHint}</div>
        </div>
        <ProviderUseButton providerId={provider.id} />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <SecretInput
            value={provider.apiKey}
            placeholder="粘贴 API Key"
            onChange={(value) => updateProviderConfig(provider.id, { apiKey: value })}
          />
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2.5 text-xs text-[#6f7168] transition hover:text-[#171714]"
          >
            <ExternalLink size={13} />
            平台
          </a>
        </div>
        <Field
          icon={Lock}
          label="Model Name"
          value={provider.modelName}
          placeholder="请输入模型名"
          onChange={(value) => updateProviderConfig(provider.id, { modelName: value })}
        />
        <ContextTierButtons providerId={provider.id} />
        <ProviderCheckRow
          providerId={provider.id}
          checking={checking}
          message={message}
          onValidate={onValidate}
        />
      </div>
    </div>
  )
}

void ProviderCard

function ProviderCheckRow({
  providerId,
  checking,
  message,
  onValidate,
}: {
  providerId: ProviderId
  checking: boolean
  message?: string
  onValidate: (providerId: ProviderId) => void
}) {
  const provider = useAppStore((state) => state.providerConfigs[providerId])
  const ready = isProviderValidated(provider)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={`text-xs ${ready ? 'text-[#3f5845]' : 'text-[#8f897a]'}`}>
        {message || (ready ? '已检测，可以使用。' : '修改配置后需要重新检测。')}
      </span>
      <button
        type="button"
        onClick={() => onValidate(providerId)}
        disabled={checking}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2.5 text-xs text-[#6f7168] transition hover:text-[#171714] disabled:cursor-wait disabled:opacity-50"
      >
        <TestTube2 size={13} />
        {checking ? '检测中' : '检测'}
      </button>
    </div>
  )
}

function ProviderUseButton({ providerId }: { providerId: ProviderId }) {
  const activeProviderId = useAppStore((state) => state.activeProviderId)
  const setActiveProviderId = useAppStore((state) => state.setActiveProviderId)
  const provider = useAppStore((state) => state.providerConfigs[providerId])
  const canUse =
    provider.type === 'scallion_proxy' ||
    (canCallProvider(provider) && isProviderValidated(provider))
  const active = activeProviderId === providerId

  return (
    <button
      type="button"
      disabled={!canUse}
      onClick={() => setActiveProviderId(providerId)}
      className={`h-8 shrink-0 rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
        active
          ? 'bg-[#171714] text-[#fffefa]'
          : 'border border-[#e8ddc7] bg-[#fffefa] text-[#6f7168] hover:text-[#171714]'
      }`}
    >
      {active ? '使用中' : '使用'}
    </button>
  )
}

function ContextTierButtons({ providerId }: { providerId: ProviderId }) {
  const provider = useAppStore((state) => state.providerConfigs[providerId])
  const updateProviderConfig = useAppStore((state) => state.updateProviderConfig)

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-[#6f7168]">
        <Link size={14} />
        上下文上限
      </div>
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

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <KeyRound
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9d988a]"
      />
      <input
        value={value}
        type="password"
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-[#e8ddc7] bg-[#fffefa] pl-9 pr-3 text-sm text-[#2f2b22] outline-none transition placeholder:text-[#9d988a] focus:border-[#d7aa4f]"
      />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="shrink-0 text-[#8f897a]">{label}</span>
      <span className="min-w-0 truncate text-right text-[#2f2b22]">{value}</span>
    </div>
  )
}

function Field({
  icon: Icon,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  icon: LucideIcon
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-[#6f7168]">
        <Icon size={14} />
        {label}
      </span>
      <input
        value={value}
        type={type}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-[#e8ddc7] bg-[#fffdf7] px-3 text-sm text-[#2f2b22] outline-none transition placeholder:text-[#9d988a] focus:border-[#d7aa4f]"
      />
    </label>
  )
}
