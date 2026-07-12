import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  DownloadCloud,
  ExternalLink,
  KeyRound,
  Link,
  Lock,
  LogOut,
  Plus,
  RotateCcw,
  Server,
  SlidersHorizontal,
  TestTube2,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { agentSkills } from '../services/agentSkillLibrary'
import { canCallProvider } from '../services/llmClient'
import { testModelConnection } from '../services/maintenance'
import { testMcpServer } from '../services/mcpClient'
import { acceptTowriteSuggestion, rejectTowriteSuggestion, syncTowriteToMemory } from '../services/towriteService'
import { modelTierDescriptions, refreshLocalModelTierAssessments } from '../services/modelGovernanceService'
import {
  customContextTiers,
  isProviderValidated,
  providerValidationSignature,
} from '../services/modelCatalog'
import { checkAndDownloadUpdate, relaunchToInstallUpdate } from '../services/updater'
import { logoutScallion, startScallionLogin } from '../services/scallionAuth'
import { refreshScallionQuota } from '../services/scallionAccountService'
import { getModelCacheStats } from '../services/modelCallCacheService'
import {
  providerOrder,
  useAppStore,
  type CustomAgentSkill,
  type FlowAgentId,
  type ModelCapabilityTier,
  type McpServerConfig,
  type McpServerTransport,
  type ProviderId,
} from '../stores/useAppStore'
import { BrandMark } from './BrandMark'
import { RemoteRelaySettings } from './RemoteRelaySettings'
import { StudioSettingsSection } from './StudioSettingsSection'
import { ComputerAssistantSettings } from './ComputerAssistantSettings'

type SettingsSectionId =
  | 'general'
  | 'account'
  | 'models'
  | 'remote'
  | 'studio'
  | 'assistant'
  | 'memory'
  | 'skills'
  | 'mcp'
  | 'updates'

export function SettingsPanel() {
  const [checkingProviderId, setCheckingProviderId] = useState<ProviderId | null>(null)
  const [checkMessages, setCheckMessages] = useState<Partial<Record<ProviderId, string>>>({})
  const [selectedVendorId, setSelectedVendorId] = useState<ProviderId>('openai')
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general')
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
  const scallionQuota = useAppStore((state) => state.scallionQuota)
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
      const result = await testModelConnection(provider)

      if (result.status !== 'ok') {
        setCheckMessages((messages) => ({
          ...messages,
          [providerId]: result.message || '检测失败，请检查配置。',
        }))
        return
      }

      updateProviderConfig(providerId, {
        validatedAt: Date.now(),
        lastValidatedSignature: providerValidationSignature(provider),
      })
      useAppStore.getState().setActiveProviderId(providerId)
      setCheckMessages((messages) => ({
        ...messages,
        [providerId]: result.latencyMs
          ? `检测通过，可以使用。延迟 ${result.latencyMs}ms。`
          : '检测通过，可以使用。',
      }))
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
            className="fixed inset-0 z-40 bg-[#171714]/22 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSettingsOpen(false)}
          />
          <motion.aside
            className="papyrus-panel fixed right-0 top-0 z-50 flex h-screen w-[620px] max-w-[calc(100vw-20px)] flex-col rounded-l-2xl border-y-0 border-r-0"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 440, damping: 42, mass: 0.85 }}
          >
            <div className="papyrus-toolbar flex h-12 shrink-0 items-center justify-between border-b px-4">
              <div className="flex min-w-0 items-center gap-3">
                <BrandMark size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#171714]">
                    <SlidersHorizontal size={14} className="text-[#6f7f68]" />
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
                className="papyrus-icon-button size-7 rounded-md border-0 bg-transparent"
              >
                <X size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden p-3">
              <div className="grid h-full min-h-0 grid-cols-[132px_1fr] gap-3">
                <SettingsSidebar activeSection={activeSection} onSelect={setActiveSection} />
                <div className="papyrus-scrollbar min-h-0 overflow-y-auto pr-1">
                  <div className="space-y-3">
                <div id="settings-general" className={activeSection === 'general' ? '' : 'hidden'}>
                  <GeneralSettingsSection />
                </div>

                <section className={`papyrus-inset rounded-xl p-4 ${activeSection === 'account' ? '' : 'hidden'}`}>
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
                    <div className="grid gap-3 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3 text-sm text-[#2f2b22]">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{scallionUser.username}</div>
                          <div className="mt-1 text-xs text-[#8f897a]">
                            {scallionQuota?.isMember || scallionUser.is_member ? '会员账号' : '普通账号'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void refreshScallionQuota()}
                          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#e8ddc7] bg-[#fffefa] px-2 text-xs text-[#6f7168] transition hover:text-[#171714]"
                        >
                          <RotateCcw size={12} />
                          刷新额度
                        </button>
                      </div>
                      <div className="grid gap-2 rounded-lg bg-[#fffefa] p-3">
                        <div className="text-xs text-[#8f897a]">剩余内置模型额度</div>
                        <div className="text-xl font-semibold tabular-nums text-[#20201d]">
                          {scallionQuota?.remaining ?? scallionUser.points ?? scallionUser.balance ?? 0}
                          <span className="ml-1 text-xs font-normal text-[#8f897a]">
                            {scallionQuota?.unit ?? '积分'}
                          </span>
                        </div>
                        {scallionQuota?.total ? (
                          <div className="text-xs text-[#8f897a]">
                            总额度 {scallionQuota.total} {scallionQuota.unit}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={scallionQuota?.topUpUrl ?? 'https://scallion.uno/pricing'}
                          target="_blank"
                          rel="noreferrer"
                          className="papyrus-control inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs"
                        >
                          <ExternalLink size={12} />
                          获取更多额度
                        </a>
                        <a
                          href={scallionQuota?.upgradeUrl ?? 'https://scallion.uno/pricing'}
                          target="_blank"
                          rel="noreferrer"
                          className="papyrus-primary-button inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs"
                        >
                          <ExternalLink size={12} />
                          {scallionQuota?.memberPriceLabel ?? '9.9 元/月'} 成为会员
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
                      <div className="text-xs leading-5 text-[#8f897a]">
                        {authStatus === 'polling'
                          ? `已打开授权页，等待确认${authUserCode ? ` · ${authUserCode}` : ''}`
                          : authStatus === 'reconnecting'
                            ? '正在重新连接主站，授权窗口可以保持打开。'
                          : authStatus === 'error'
                            ? '登录失败，请稍后重试。'
                            : authStatus === 'expired'
                              ? '设备码已过期，请重新登录。'
                              : '点击后会打开 scallion.uno 授权页。'}
                      </div>
                      <button
                        type="button"
                        onClick={() => void startScallionLogin()}
                        disabled={authStatus === 'starting' || authStatus === 'polling' || authStatus === 'reconnecting'}
                        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#171714] px-3 text-sm font-medium text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-wait disabled:opacity-50"
                      >
                        <ExternalLink size={14} />
                        {authStatus === 'starting' || authStatus === 'polling'
                          ? '等待授权'
                          : authStatus === 'reconnecting'
                            ? '正在重连'
                            : '登录主站'}
                      </button>
                    </div>
                  )}
                </section>

                <section id="settings-models" className={`rounded-xl border border-[#d7aa4f]/45 bg-[#fff7e3] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.05)] ${activeSection === 'models' ? '' : 'hidden'}`}>
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

                <section className={`rounded-xl border border-[#e8ddc7] bg-[#fffdf7] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.05)] ${activeSection === 'updates' ? '' : 'hidden'}`}>
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

                <section className={`rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.04)] ${activeSection === 'updates' ? '' : 'hidden'}`}>
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

                <div id="settings-remote" className={activeSection === 'remote' ? '' : 'hidden'}>
                  <RemoteRelaySettings />
                </div>

                <div className={activeSection === 'studio' ? '' : 'hidden'}>
                  <StudioSettingsSection />
                </div>

                <section className={`rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.04)] ${activeSection === 'models' ? '' : 'hidden'}`}>
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

                <section className={`rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_10px_24px_rgba(43,34,19,0.04)] ${activeSection === 'models' ? '' : 'hidden'}`}>
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
                      label="模型名称"
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

                <div id="settings-memory" className={activeSection === 'memory' ? '' : 'hidden'}>
                  <MemorySettingsSection />
                </div>
                <div id="settings-assistant" className={activeSection === 'assistant' ? '' : 'hidden'}>
                  <ComputerAssistantSettings />
                </div>
                <div id="settings-skills" className={activeSection === 'skills' ? '' : 'hidden'}>
                  <SkillSettingsSection />
                </div>
                <div id="settings-mcp" className={activeSection === 'mcp' ? '' : 'hidden'}>
                  <McpSettingsSection />
                </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  )
}


function SettingsSidebar({
  activeSection,
  onSelect,
}: {
  activeSection: SettingsSectionId
  onSelect: (section: SettingsSectionId) => void
}) {
  const links: Array<{ id: SettingsSectionId; label: string }> = [
    { id: 'general', label: '常规' },
    { id: 'account', label: '账户' },
    { id: 'models', label: '模型' },
    { id: 'remote', label: '远程连接' },
    { id: 'studio', label: '工作室' },
    { id: 'assistant', label: '电脑助手' },
    { id: 'memory', label: '记忆' },
    { id: 'skills', label: '技能' },
    { id: 'mcp', label: 'MCP' },
    { id: 'updates', label: '更新' },
  ]

  return (
    <nav className="papyrus-toolbar h-full rounded-xl border p-1.5">
      {links.map((link) => (
        <button
          key={link.id}
          type="button"
          onClick={() => onSelect(link.id)}
          className={`mb-1 flex h-8 w-full items-center rounded-lg px-2 text-left text-xs font-medium transition ${
            activeSection === link.id
              ? 'bg-[#171714] text-[#fffefa]'
              : 'text-[#6f7168] hover:bg-[#fff7e3] hover:text-[#171714]'
          }`}
        >
          {link.label}
        </button>
      ))}
    </nav>
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
          label="模型名称"
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
          label="模型名称"
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

function GeneralSettingsSection() {
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const autoModelProviderIds = useAppStore((state) => state.autoModelProviderIds)
  const modelTierWeights = useAppStore((state) => state.modelTierWeights)
  const modelTierAssessments = useAppStore((state) => state.modelTierAssessments)
  const hardwareCapabilityProfile = useAppStore((state) => state.hardwareCapabilityProfile)
  const modelRoutingMode = useAppStore((state) => state.modelRoutingMode)
  const setModelRoutingMode = useAppStore((state) => state.setModelRoutingMode)
  const setAutoModelProviderIds = useAppStore((state) => state.setAutoModelProviderIds)
  const setModelTierWeight = useAppStore((state) => state.setModelTierWeight)
  const setMode = useAppStore((state) => state.setMode)
  const cacheStats = getModelCacheStats()

  const toggleAutoProvider = (providerId: ProviderId, enabled: boolean) => {
    const next = enabled
      ? [...autoModelProviderIds, providerId]
      : autoModelProviderIds.filter((id) => id !== providerId)
    setAutoModelProviderIds(next)
  }

  return (
    <SectionShell
      title="常规设置"
      description="控制默认入口、Auto 模型调度、蜂巢限流和本地缓存。所有评估都在本机用可解释规则完成，不额外消耗额度。"
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[#2f2b22]">默认入口</div>
              <div className="mt-1 text-xs leading-5 text-[#8f897a]">
                启动和新对话默认进入秘书模式；写作模式仍可在顶部切换。
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMode('flow')}
              className="papyrus-primary-button h-8 rounded-md px-3 text-xs"
            >
              切到秘书模式
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[#d7aa4f]/45 bg-[#fff7e3] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[#2f2b22]">Auto 模型调度</div>
              <div className="mt-1 text-xs leading-5 text-[#6f7168]">
                推荐开启。秘书长会按任务阶段自动选择模型：T1 处理复杂任务，T2 处理常规任务，T3 处理轻量和重复任务。
              </div>
            </div>
            <div className="inline-flex rounded-lg border border-[#dccfb9] bg-[#f8f4ea] p-1">
              {(['manual', 'auto'] as const).map((mode) => {
                const active = modelRoutingMode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setModelRoutingMode(mode)}
                    className={`h-7 rounded-md px-3 text-xs font-medium transition ${
                      active
                        ? 'bg-[#171714] text-[#fffefa]'
                        : 'text-[#6f7168] hover:bg-[#fffefa] hover:text-[#171714]'
                    }`}
                  >
                    {mode === 'auto' ? 'Auto 推荐' : '手动'}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[#2f2b22]">Auto 可调用模型</div>
              <div className="mt-1 text-xs leading-5 text-[#8f897a]">
                勾选后才会进入秘书长自动路由。未检测的用户 Key 模型可以保存配置，但不会优先选择。
              </div>
            </div>
            <button
              type="button"
              onClick={() => refreshLocalModelTierAssessments()}
              className="papyrus-control h-8 rounded-md px-3 text-xs"
            >
              重新评估
            </button>
          </div>
          <div className="grid gap-1.5">
            {providerOrder.map((providerId) => {
              const provider = providerConfigs[providerId]
              const checked = autoModelProviderIds.includes(providerId)
              const ready =
                provider.type === 'scallion_proxy' ||
                (canCallProvider(provider) && isProviderValidated(provider))
              const assessment = modelTierAssessments.find(
                (item) => item.providerId === providerId && item.available,
              )

              return (
                <label
                  key={providerId}
                  className="flex items-center gap-2 rounded-lg bg-[#fffefa] px-2.5 py-2 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggleAutoProvider(providerId, event.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-[#2f2b22]">{provider.label}</span>
                    <span className="ml-2 text-[#8f897a]">{provider.modelName || '未填写模型名'}</span>
                  </span>
                  <span className="rounded-md bg-[#f0e6d2] px-1.5 py-0.5 text-[10px] text-[#6f7168]">
                    {assessment?.tier ?? 'T2'} · {assessment?.score ?? '待评估'}
                  </span>
                  <span className={`text-[10px] ${ready ? 'text-[#315d39]' : 'text-[#9b6b30]'}`}>
                    {ready ? '可用' : '待检测'}
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="grid gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <div className="text-xs font-semibold text-[#2f2b22]">T1 / T2 / T3 权重</div>
          {(['T1', 'T2', 'T3'] as ModelCapabilityTier[]).map((tier) => (
            <div key={tier} className="rounded-lg bg-[#fffefa] p-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[#2f2b22]">{tier}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-[#8f897a]">
                    {modelTierDescriptions[tier]}
                  </div>
                </div>
                <span className="w-12 text-right text-xs tabular-nums text-[#2f2b22]">
                  {modelTierWeights[tier].toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={2}
                step={0.05}
                value={modelTierWeights[tier]}
                onChange={(event) => setModelTierWeight(tier, Number(event.target.value))}
                className="mt-2 w-full accent-[#315d39]"
              />
            </div>
          ))}
          <div className="rounded-lg bg-[#f4fbf2] p-2 text-[11px] leading-5 text-[#315d39]">
            模型分层采用本地规则：上下文窗口、可用状态、模型名称特征，以及写作/文学/agent 任务适配度。没有采用“随机 AI 在线评估所有模型”，因为那会消耗额度、结果不稳定，也难以解释。
          </div>
        </div>

        <div className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <div className="mb-2 text-xs font-semibold text-[#2f2b22]">本机蜂巢限流</div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <InfoTile label="档位" value={hardwareCapabilityProfile.tier ?? 'medium'} />
            <InfoTile label="CPU" value={`${hardwareCapabilityProfile.cpuCores} 核`} />
            <InfoTile label="最大 Agent" value={String(hardwareCapabilityProfile.maxHiveAgents)} />
            <InfoTile label="最大并行" value={String(hardwareCapabilityProfile.maxHiveParallelAgents)} />
          </div>
          <div className="mt-2 text-xs leading-5 text-[#8f897a]">
            {hardwareCapabilityProfile.reason}
          </div>
          {hardwareCapabilityProfile.gpuLabel ? (
            <div className="mt-1 truncate text-[11px] text-[#8f897a]">
              GPU：{hardwareCapabilityProfile.gpuLabel}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <div className="mb-2 text-xs font-semibold text-[#2f2b22]">模型调用缓存</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <InfoTile label="命中率" value={`${cacheStats.hitRate}%`} />
            <InfoTile label="命中" value={String(cacheStats.hits)} />
            <InfoTile label="可缓存调用" value={String(cacheStats.total)} />
          </div>
          <div className="mt-2 text-xs leading-5 text-[#8f897a]">
            目标是可缓存调用 80%+ 命中。冷启动、全新正文创作和强实时请求不计入质量目标。
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-[#fffefa] px-2.5 py-2">
      <div className="truncate text-[11px] text-[#8f897a]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-[#20201d]">{value}</div>
    </div>
  )
}


function SectionShell({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="papyrus-inset rounded-xl p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[#2f2b22]">{title}</div>
          <div className="mt-1 text-xs leading-5 text-[#8f897a]">{description}</div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

const defaultSkillDraft = {
  name: '',
  shortName: '',
  trigger: '',
  agents: ['writer'] as FlowAgentId[],
  keywordsText: '',
  instructionsText: '',
  outputRulesText: '',
  enabled: true,
}

function MemorySettingsSection() {
  const profile = useAppStore((state) => state.userMemoryProfile)
  const userMemoryRecords = useAppStore((state) => state.userMemoryRecords)
  const projectWritingMemories = useAppStore((state) => state.projectWritingMemories)
  const globalTowriteMarkdown = useAppStore((state) => state.globalTowriteMarkdown)
  const projectTowriteMarkdown = useAppStore((state) => state.projectTowriteMarkdown)
  const towriteSuggestions = useAppStore((state) => state.towriteSuggestions)
  const semanticTaskCache = useAppStore((state) => state.semanticTaskCache)
  const setUserMemoryProfile = useAppStore((state) => state.setUserMemoryProfile)
  const upsertUserMemoryRecord = useAppStore((state) => state.upsertUserMemoryRecord)
  const deleteUserMemoryRecord = useAppStore((state) => state.deleteUserMemoryRecord)
  const toggleUserMemoryRecord = useAppStore((state) => state.toggleUserMemoryRecord)
  const clearUserMemoryRecords = useAppStore((state) => state.clearUserMemoryRecords)
  const deleteProjectWritingMemory = useAppStore((state) => state.deleteProjectWritingMemory)
  const clearProjectWritingMemories = useAppStore((state) => state.clearProjectWritingMemories)
  const clearSemanticTaskCache = useAppStore((state) => state.clearSemanticTaskCache)
  const modelCallCacheMetrics = useAppStore((state) => state.modelCallCacheMetrics)
  const clearModelCallCacheMetrics = useAppStore((state) => state.clearModelCallCacheMetrics)
  const setGlobalTowriteMarkdown = useAppStore((state) => state.setGlobalTowriteMarkdown)
  const setProjectTowriteMarkdown = useAppStore((state) => state.setProjectTowriteMarkdown)
  const [manualMemory, setManualMemory] = useState('')

  const pendingSuggestions = towriteSuggestions.filter((suggestion) => suggestion.status === 'pending')
  const cacheStats = getModelCacheStats()

  return (
    <SectionShell
      title="记忆"
      description="长期记忆和跨文档记忆默认保存在本机，仅用于增强 AI 对你的写作习惯、项目设定和上下文的理解。Papyrus 不会因为此功能收集或上传用户信息。"
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-[#cfd8c7] bg-[#f4fbf2] p-3 text-xs leading-5 text-[#315d39]">
          本功能类似 Hermes / WorkBuddy 的长期记忆，但以本地写作辅助为目标。你可以随时编辑、禁用或删除每条记忆；AI 默认只提出建议，确认后才会保存。
        </div>

        <div className="grid gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-[#6f7168]">
              <input
                type="checkbox"
                checked={profile.enabled}
                onChange={(event) => setUserMemoryProfile({ enabled: event.target.checked })}
              />
              启用本地长期记忆
            </label>
            <select
              value={profile.mode}
              onChange={(event) =>
                setUserMemoryProfile({ mode: event.target.value as typeof profile.mode })
              }
              className="h-8 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2 text-xs text-[#2f2b22] outline-none"
            >
              <option value="off">关闭自动建议</option>
              <option value="confirm">建议后确认</option>
              <option value="low_risk_auto">低风险自动保存</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PlainField
              label="称呼"
              value={profile.displayName}
              placeholder="例如：张老师、林同学"
              onChange={(value) => setUserMemoryProfile({ displayName: value })}
            />
            <PlainField
              label="身份/职业"
              value={profile.identity}
              placeholder="例如：小说作者、研究生、编辑"
              onChange={(value) => setUserMemoryProfile({ identity: value })}
            />
          </div>
          <TextAreaField
            label="性格与协作方式"
            value={profile.personality}
            placeholder="例如：希望直接指出问题，少用客套话。"
            onChange={(value) => setUserMemoryProfile({ personality: value })}
          />
          <TextAreaField
            label="写作习惯"
            value={profile.writingHabits}
            placeholder="例如：先列结构，再写正文；偏好中文长文。"
            onChange={(value) => setUserMemoryProfile({ writingHabits: value })}
          />
          <TextAreaField
            label="文风偏好"
            value={profile.stylePreferences}
            placeholder="例如：克制、准确、有判断，不要营销腔。"
            onChange={(value) => setUserMemoryProfile({ stylePreferences: value })}
          />
          <TextAreaField
            label="长期约束"
            value={profile.constraints}
            placeholder="例如：不要擅自改变人物设定；资料不确定时标注待核实。"
            onChange={(value) => setUserMemoryProfile({ constraints: value })}
          />
        </div>

        <div className="grid gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <TextAreaField
            label="手动新增个人记忆"
            value={manualMemory}
            placeholder="写入一条稳定、可复用的身份、习惯、偏好或约束。"
            onChange={setManualMemory}
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!manualMemory.trim()}
              onClick={() => {
                upsertUserMemoryRecord({
                  category: 'other',
                  content: manualMemory,
                  source: 'manual',
                  enabled: true,
                  confidence: 0.9,
                })
                setManualMemory('')
              }}
              className="papyrus-primary-button h-8 rounded-md px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              保存记忆
            </button>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-[#6f7168]">个人长期记忆</div>
            <button type="button" onClick={clearUserMemoryRecords} className="text-xs text-[#9b3d30]">
              清空
            </button>
          </div>
          {userMemoryRecords.length ? (
            userMemoryRecords.map((record) => (
              <div key={record.id} className="flex items-start gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-2">
                <input
                  type="checkbox"
                  checked={record.enabled}
                  onChange={(event) => toggleUserMemoryRecord(record.id, event.target.checked)}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1 text-xs leading-5 text-[#2f2b22]">
                  <div className="font-medium">{record.category}</div>
                  <div className="break-words text-[#6f7168]">{record.content}</div>
                </div>
                <button type="button" onClick={() => deleteUserMemoryRecord(record.id)} className="text-[#9b3d30]">
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-[#e8ddc7] bg-[#fffdf7] p-3 text-xs text-[#8f897a]">
              还没有保存个人长期记忆。
            </div>
          )}
        </div>

        <div className="grid gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <TextAreaField
            label="全局 towrite.md"
            value={globalTowriteMarkdown}
            onChange={setGlobalTowriteMarkdown}
          />
          <TextAreaField
            label="项目 towrite.md"
            value={projectTowriteMarkdown}
            onChange={setProjectTowriteMarkdown}
          />
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" onClick={() => syncTowriteToMemory()} className="papyrus-control h-8 rounded-md px-3 text-xs">
              同步到记忆索引
            </button>
            <button type="button" onClick={clearProjectWritingMemories} className="text-xs text-[#9b3d30]">
              清空项目记忆
            </button>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-medium text-[#6f7168]">待确认记忆建议</div>
          {pendingSuggestions.length ? (
            pendingSuggestions.map((suggestion) => (
              <div key={suggestion.id} className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
                <div className="text-sm font-medium text-[#2f2b22]">{suggestion.title}</div>
                <div className="mt-1 text-xs leading-5 text-[#6f7168]">{suggestion.content}</div>
                <div className="mt-1 text-[11px] text-[#8f897a]">{suggestion.reason}</div>
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" onClick={() => rejectTowriteSuggestion(suggestion.id)} className="papyrus-control h-7 rounded-md px-2 text-xs">
                    忽略
                  </button>
                  <button type="button" onClick={() => acceptTowriteSuggestion(suggestion.id)} className="papyrus-primary-button h-7 rounded-md px-2 text-xs">
                    保存
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-[#e8ddc7] bg-[#fffdf7] p-3 text-xs text-[#8f897a]">
              暂无待确认建议。
            </div>
          )}
        </div>

        <details className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <summary className="cursor-pointer text-xs font-medium text-[#6f7168]">
            项目跨文档记忆 ({projectWritingMemories.length})
          </summary>
          <div className="mt-2 grid gap-2">
            {projectWritingMemories.slice(0, 20).map((memory) => (
              <div key={memory.id} className="flex items-start gap-2 rounded-md bg-[#fffefa] px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[#2f2b22]">{memory.title}</div>
                  <div className="line-clamp-2 text-xs text-[#8f897a]">{memory.content}</div>
                </div>
                <button type="button" onClick={() => deleteProjectWritingMemory(memory.id)} className="text-[#9b3d30]">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </details>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <div>
            <div className="text-xs font-medium text-[#2f2b22]">本地语义缓存</div>
            <div className="mt-1 text-xs text-[#8f897a]">
              用于复用重复资料核查和跨文档检索结果，仅保存在本机。当前 {semanticTaskCache.length} 条。
            </div>
            <div className="mt-1 text-xs text-[#8f897a]">
              可缓存模型调用命中率 {cacheStats.hitRate}% · 命中 {cacheStats.hits} / {cacheStats.total} · 目标 80%+
            </div>
            {cacheStats.hitRate < cacheStats.targetHitRate && cacheStats.total > 0 ? (
              <div className="mt-1 text-[11px] text-[#9b6b30]">
                未达标通常来自冷启动、上下文变化或实时请求；全新正文创作不计入命中率目标。
              </div>
            ) : null}
            {modelCallCacheMetrics.length ? (
              <div className="mt-1 text-[11px] text-[#8f897a]">
                最近统计 {modelCallCacheMetrics.length} 条。
              </div>
            ) : null}
            {cacheStats.lastMissReasons.length ? (
              <div className="mt-1 line-clamp-2 text-[11px] text-[#8f897a]">
                最近未命中：{Array.from(new Set(cacheStats.lastMissReasons)).join('；')}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <button type="button" onClick={clearSemanticTaskCache} className="text-xs text-[#9b3d30]">
              清空语义缓存
            </button>
            <button type="button" onClick={clearModelCallCacheMetrics} className="text-xs text-[#9b3d30]">
              清空命中率统计
            </button>
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

function SkillSettingsSection() {
  const customAgentSkills = useAppStore((state) => state.customAgentSkills)
  const upsertCustomAgentSkill = useAppStore((state) => state.upsertCustomAgentSkill)
  const deleteCustomAgentSkill = useAppStore((state) => state.deleteCustomAgentSkill)
  const toggleCustomAgentSkill = useAppStore((state) => state.toggleCustomAgentSkill)
  const [draft, setDraft] = useState(defaultSkillDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const builtinSkills = Object.values(agentSkills)

  const editSkill = (skill: CustomAgentSkill) => {
    setEditingId(skill.id)
    setDraft({
      name: skill.name,
      shortName: skill.shortName,
      trigger: skill.trigger,
      agents: skill.agents,
      keywordsText: skill.keywordsText,
      instructionsText: skill.instructionsText,
      outputRulesText: skill.outputRulesText,
      enabled: skill.enabled,
    })
  }

  const resetDraft = () => {
    setEditingId(null)
    setDraft(defaultSkillDraft)
  }

  const saveSkill = () => {
    if (!draft.name.trim()) {
      return
    }

    upsertCustomAgentSkill({ ...draft, id: editingId ?? undefined })
    resetDraft()
  }

  return (
    <SectionShell
      title="技能"
      description="内置技能只读展示。自定义技能使用安全关键词匹配，并会合并进对应 Agent 的提示词。"
      action={
        <button
          type="button"
          onClick={saveSkill}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#171714] px-2.5 text-xs font-medium text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!draft.name.trim()}
        >
          <Plus size={13} />
          {editingId ? '保存' : '添加技能'}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <div className="grid grid-cols-2 gap-2">
            <PlainField
              label="名称"
              value={draft.name}
              placeholder="场景连续性"
              onChange={(value) => setDraft((item) => ({ ...item, name: value }))}
            />
            <PlainField
              label="短名"
              value={draft.shortName}
              placeholder="连续性"
              onChange={(value) => setDraft((item) => ({ ...item, shortName: value }))}
            />
          </div>
          <PlainField
            label="触发说明"
            value={draft.trigger}
            placeholder="当用户要求检查连续性、时间线或伏笔时触发。"
            onChange={(value) => setDraft((item) => ({ ...item, trigger: value }))}
          />
          <PlainField
            label="关键词"
            value={draft.keywordsText}
            placeholder="连续性、时间线、伏笔"
            onChange={(value) => setDraft((item) => ({ ...item, keywordsText: value }))}
          />
          <TextAreaField
            label="执行规则"
            value={draft.instructionsText}
            placeholder="每行一条执行规则。"
            onChange={(value) => setDraft((item) => ({ ...item, instructionsText: value }))}
          />
          <TextAreaField
            label="输出规则"
            value={draft.outputRulesText}
            placeholder="每行一条输出规则。"
            onChange={(value) => setDraft((item) => ({ ...item, outputRulesText: value }))}
          />
          <label className="inline-flex items-center gap-2 text-xs text-[#6f7168]">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft((item) => ({ ...item, enabled: event.target.checked }))}
            />
            启用
          </label>
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-medium text-[#6f7168]">自定义技能</div>
          {customAgentSkills.length ? (
            customAgentSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] px-3 py-2"
              >
                <button type="button" onClick={() => editSkill(skill)} className="min-w-0 text-left">
                  <div className="truncate text-sm font-medium text-[#2f2b22]">{skill.name}</div>
                  <div className="truncate text-xs text-[#8f897a]">{skill.trigger || skill.keywordsText}</div>
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleCustomAgentSkill(skill.id, !skill.enabled)}
                    className="h-7 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2 text-xs text-[#6f7168] transition hover:text-[#171714]"
                  >
                    {skill.enabled ? '启用' : '停用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteCustomAgentSkill(skill.id)}
                    className="papyrus-icon-button size-7 rounded-lg border border-[#e8ddc7] bg-[#fffefa]"
                    title="删除技能"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-[#e8ddc7] bg-[#fffdf7] p-3 text-xs text-[#8f897a]">
              还没有自定义技能。
            </div>
          )}
        </div>

        <details className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <summary className="cursor-pointer text-xs font-medium text-[#6f7168]">内置技能</summary>
          <div className="mt-2 grid gap-2">
            {builtinSkills.map((skill) => (
              <div key={skill.id} className="rounded-md bg-[#fffefa] px-2 py-1.5">
                <div className="text-xs font-medium text-[#2f2b22]">{skill.name}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-[#8f897a]">{skill.trigger}</div>
              </div>
            ))}
          </div>
        </details>
      </div>
    </SectionShell>
  )
}

type McpDraft = Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>

const defaultMcpDraft: McpDraft = {
  name: '',
  transport: 'http' as McpServerTransport,
  endpoint: '',
  command: '',
  headersText: '',
  envText: '',
  enabled: true,
  status: 'idle' as const,
  lastError: undefined,
}

function McpSettingsSection() {
  const mcpServers = useAppStore((state) => state.mcpServers)
  const upsertMcpServer = useAppStore((state) => state.upsertMcpServer)
  const deleteMcpServer = useAppStore((state) => state.deleteMcpServer)
  const updateMcpServerStatus = useAppStore((state) => state.updateMcpServerStatus)
  const [draft, setDraft] = useState(defaultMcpDraft)
  const [editingId, setEditingId] = useState<string | null>(null)

  const editServer = (server: McpServerConfig) => {
    setEditingId(server.id)
    setDraft({
      name: server.name,
      transport: server.transport,
      endpoint: server.endpoint,
      command: server.command,
      headersText: server.headersText,
      envText: server.envText,
      enabled: server.enabled,
      status: server.status,
      lastError: server.lastError,
    })
  }

  const resetDraft = () => {
    setEditingId(null)
    setDraft(defaultMcpDraft)
  }

  const saveServer = () => {
    if (!draft.name.trim()) {
      return
    }

    upsertMcpServer({ ...draft, id: editingId ?? undefined, status: 'idle' })
    resetDraft()
  }

  const testServer = async (server: McpServerConfig) => {
    updateMcpServerStatus(server.id, { status: 'testing', lastError: undefined })
    const result = await testMcpServer(server)
    updateMcpServerStatus(server.id, {
      status: result.status,
      lastError: result.ok ? undefined : result.message,
    })
  }

  return (
    <SectionShell
      title="MCP"
      description="保存 HTTP MCP 端点用于检索。stdio 服务可先保存和校验命令字段，运行适配中，不会伪装成已可用。"
      action={
        <button
          type="button"
          onClick={saveServer}
          disabled={!draft.name.trim()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#171714] px-2.5 text-xs font-medium text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={13} />
          {editingId ? '保存' : '添加服务'}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <PlainField
              label="名称"
              value={draft.name}
              placeholder="知识库"
              onChange={(value) => setDraft((item) => ({ ...item, name: value }))}
            />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#6f7168]">传输方式</span>
              <select
                value={draft.transport}
                onChange={(event) =>
                  setDraft((item) => ({ ...item, transport: event.target.value as McpServerTransport }))
                }
                className="h-10 w-full rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-3 text-sm text-[#2f2b22] outline-none transition focus:border-[#d7aa4f]"
              >
                <option value="http">http</option>
                <option value="stdio">stdio</option>
              </select>
            </label>
          </div>
          {draft.transport === 'http' ? (
            <PlainField
              label="端点"
              value={draft.endpoint}
              placeholder="https://example.com/mcp"
              onChange={(value) => setDraft((item) => ({ ...item, endpoint: value }))}
            />
          ) : (
            <PlainField
              label="命令"
              value={draft.command}
              placeholder="node ./server.js"
              onChange={(value) => setDraft((item) => ({ ...item, command: value }))}
            />
          )}
          <TextAreaField
            label={draft.transport === 'http' ? '请求头' : '环境变量'}
            value={draft.transport === 'http' ? draft.headersText : draft.envText}
            placeholder="KEY=value"
            onChange={(value) =>
              setDraft((item) =>
                draft.transport === 'http' ? { ...item, headersText: value } : { ...item, envText: value },
              )
            }
          />
          <label className="inline-flex items-center gap-2 text-xs text-[#6f7168]">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft((item) => ({ ...item, enabled: event.target.checked }))}
            />
            启用
          </label>
        </div>

        <div className="grid gap-2">
          {mcpServers.length ? (
            mcpServers.map((server) => (
              <div key={server.id} className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => editServer(server)} className="min-w-0 text-left">
                    <div className="flex items-center gap-2 text-sm font-medium text-[#2f2b22]">
                      <span>{server.name}</span>
                      <span className="rounded-md bg-[#f0e6d2] px-1.5 py-0.5 text-[10px] text-[#6f7168]">
                        {server.transport}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-[#8f897a]">
                       {server.transport === 'http' ? server.endpoint : server.command || 'stdio 命令待填写'}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        upsertMcpServer({ ...server, enabled: !server.enabled, status: server.status })
                      }
                      className="h-7 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2 text-xs text-[#6f7168] transition hover:text-[#171714]"
                    >
                      {server.enabled ? '启用' : '停用'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void testServer(server)}
                      disabled={server.status === 'testing'}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-2 text-xs text-[#6f7168] transition hover:text-[#171714] disabled:cursor-wait disabled:opacity-50"
                    >
                      <TestTube2 size={12} />
                      {server.status === 'testing' ? '测试中' : '测试连接'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMcpServer(server.id)}
                      className="papyrus-icon-button size-7 rounded-lg border border-[#e8ddc7] bg-[#fffefa]"
                      title="删除 MCP 服务"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-[#8f897a]">
                  状态：{formatMcpStatus(server.status)}
                  {server.lastError ? <span className="ml-2 text-[#9b3d30]">{server.lastError}</span> : null}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-[#e8ddc7] bg-[#fffdf7] p-3 text-xs text-[#8f897a]">
              还没有配置 MCP 服务。
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  )
}

function formatMcpStatus(status: McpServerConfig['status']) {
  const labels: Record<McpServerConfig['status'], string> = {
    idle: '未测试',
    testing: '测试中',
    ok: '可用',
    error: '错误',
    unsupported: '适配中',
  }

  return labels[status] ?? '未测试'
}

function PlainField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[#6f7168]">{label}</span>
      <input
        value={value}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-3 text-sm text-[#2f2b22] outline-none transition placeholder:text-[#9d988a] focus:border-[#d7aa4f]"
      />
    </label>
  )
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[#6f7168]">{label}</span>
      <textarea
        value={value}
        rows={3}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-20 w-full resize-y rounded-lg border border-[#e8ddc7] bg-[#fffefa] px-3 py-2 text-sm leading-5 text-[#2f2b22] outline-none transition placeholder:text-[#9d988a] focus:border-[#d7aa4f]"
      />
    </label>
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
