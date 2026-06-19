import {
  Bot,
  Check,
  Clipboard,
  MessageSquareMore,
  RadioTower,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  createAdapterCurlExample,
  createAdapterWebhookPayloadExample,
  registerRemoteRelayChannel,
  normalizeRelayEndpoint,
} from '../services/remoteRelayService'
import {
  useAppStore,
  type RemoteRelayMode,
  type RemoteRelayPlatform,
  type RemoteRelayStatus,
} from '../stores/useAppStore'

const platformLabels: Record<RemoteRelayPlatform, string> = {
  clawbot: 'Clawbot',
  feishu: '飞书',
  wecom: '企业微信',
  qq: 'QQ',
  wechat: '微信',
  custom: '自定义',
}

const statusLabels: Record<RemoteRelayStatus, string> = {
  idle: '未启用',
  connecting: '连接中',
  online: '在线',
  error: '异常',
}

export function RemoteRelaySettings() {
  const [busy, setBusy] = useState(false)
  const [samplePlatform, setSamplePlatform] = useState<RemoteRelayPlatform>('clawbot')
  const scallionToken = useAppStore((state) => state.scallionToken)
  const enabled = useAppStore((state) => state.remoteRelayEnabled)
  const endpoint = useAppStore((state) => state.remoteRelayEndpoint)
  const channelId = useAppStore((state) => state.remoteRelayChannelId)
  const accessKey = useAppStore((state) => state.remoteRelayAccessKey)
  const allowedPlatforms = useAppStore((state) => state.remoteRelayAllowedPlatforms)
  const defaultMode = useAppStore((state) => state.remoteRelayDefaultMode)
  const pollIntervalSeconds = useAppStore((state) => state.remoteRelayPollIntervalSeconds)
  const status = useAppStore((state) => state.remoteRelayStatus)
  const message = useAppStore((state) => state.remoteRelayMessage)
  const lastJobAt = useAppStore((state) => state.remoteRelayLastJobAt)
  const setRemoteRelayConfig = useAppStore((state) => state.setRemoteRelayConfig)
  const setRemoteRelayState = useAppStore((state) => state.setRemoteRelayState)

  const webhookUrl = useMemo(() => {
    if (!channelId) {
      return '启用后自动生成'
    }

    return `${normalizeRelayEndpoint(endpoint)}/webhook/${channelId}`
  }, [channelId, endpoint])
  const adapterPayload = useMemo(
    () => JSON.stringify(createAdapterWebhookPayloadExample(samplePlatform), null, 2),
    [samplePlatform],
  )
  const curlExample = useMemo(
    () => createAdapterCurlExample(webhookUrl, accessKey, samplePlatform),
    [accessKey, samplePlatform, webhookUrl],
  )

  const connect = async () => {
    if (!scallionToken) {
      setRemoteRelayState({
        status: 'error',
        message: '请先登录 Scallion 账号，再创建远程中继频道',
      })
      return
    }

    setBusy(true)
    setRemoteRelayState({ status: 'connecting', message: '正在创建远程中继频道' })

    try {
      const channel = await registerRemoteRelayChannel({
        endpoint,
        token: scallionToken,
        channelId,
        accessKey,
      })
      setRemoteRelayConfig({
        enabled: true,
        channelId: channel.channelId,
        accessKey: channel.accessKey ?? accessKey,
      })
      setRemoteRelayState({
        status: channel.status ?? 'online',
        message: '远程中继频道已就绪',
      })
    } catch (error) {
      setRemoteRelayState({
        status: 'error',
        message: error instanceof Error ? error.message : '远程中继频道创建失败',
      })
    } finally {
      setBusy(false)
    }
  }

  const togglePlatform = (platform: RemoteRelayPlatform) => {
    const next = allowedPlatforms.includes(platform)
      ? allowedPlatforms.filter((item) => item !== platform)
      : [...allowedPlatforms, platform]

    setRemoteRelayConfig({ allowedPlatforms: next.length ? next : ['custom'] })
  }

  const copyWebhook = async () => {
    if (!channelId) {
      return
    }

    await navigator.clipboard?.writeText(webhookUrl)
    setRemoteRelayState({ message: 'Webhook 地址已复制' })
  }

  const copyAdapterPayload = async () => {
    await navigator.clipboard?.writeText(adapterPayload)
    setRemoteRelayState({ message: 'Adapter payload example copied' })
  }

  const copyCurlExample = async () => {
    await navigator.clipboard?.writeText(curlExample)
    setRemoteRelayState({ message: 'Webhook curl example copied' })
  }

  return (
    <section className="rounded-xl border border-[#d4e4d6] bg-[#fbfffb] p-4 shadow-[0_10px_24px_rgba(31,61,42,0.05)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1f3d2a]">
            <RadioTower size={15} className="text-[#31a96b]" />
            远程通讯中继
          </div>
          <div className="mt-1 text-xs leading-5 text-[#667268]">
            让飞书、企业微信、QQ/微信 Clawbot 或自定义机器人把消息转给 Papyrus，不需要单独做移动端应用。
          </div>
        </div>
        <span
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${
            status === 'online'
              ? 'bg-[#e2f7e9] text-[#1f6b3e]'
              : status === 'error'
                ? 'bg-[#fff0ea] text-[#a33c20]'
                : 'bg-[#f2eee5] text-[#6f7168]'
          }`}
        >
          {status === 'online' ? <Check size={13} /> : <Bot size={13} />}
          {statusLabels[status]}
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d4e4d6] bg-white p-3">
          <div>
            <div className="text-xs font-medium text-[#1f3d2a]">Relay 开关</div>
            <div className="mt-1 text-xs text-[#667268]">
              {message}
              {lastJobAt ? `，最近任务 ${new Date(lastJobAt).toLocaleTimeString()}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRemoteRelayConfig({ enabled: !enabled })}
            className={`h-9 rounded-lg px-3 text-xs font-medium transition ${
              enabled
                ? 'bg-[#1f3d2a] text-white'
                : 'border border-[#d4e4d6] bg-[#fbfffb] text-[#667268] hover:text-[#1f3d2a]'
            }`}
          >
            {enabled ? '已启用' : '启用'}
          </button>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[#667268]">Scallion Relay Endpoint</span>
          <input
            value={endpoint}
            onChange={(event) => setRemoteRelayConfig({ endpoint: event.target.value })}
            className="h-10 w-full rounded-lg border border-[#d4e4d6] bg-white px-3 text-sm text-[#1f3d2a] outline-none transition focus:border-[#31a96b]"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <InfoTile label="频道 ID" value={channelId || '未创建'} />
          <InfoTile label="中继密钥" value={accessKey ? maskSecret(accessKey) : '由服务器生成'} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#1f3d2a] px-3 text-xs font-medium text-white transition hover:bg-[#2f6041] disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            创建或刷新频道
          </button>
          <button
            type="button"
            onClick={() => void copyWebhook()}
            disabled={!channelId}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d4e4d6] bg-white px-3 text-xs font-medium text-[#667268] transition hover:text-[#1f3d2a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Clipboard size={14} />
            复制 Webhook
          </button>
        </div>

        <div className="rounded-lg border border-[#d4e4d6] bg-white p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#1f3d2a]">
            <MessageSquareMore size={14} />
            默认处理模式
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['companion', 'flow'] as RemoteRelayMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRemoteRelayConfig({ defaultMode: mode })}
                className={`h-9 rounded-lg text-xs font-medium transition ${
                  defaultMode === mode
                    ? 'bg-[#1f3d2a] text-white'
                    : 'border border-[#d4e4d6] bg-[#fbfffb] text-[#667268] hover:text-[#1f3d2a]'
                }`}
              >
                {mode === 'companion' ? '文学秘书' : 'Flow 工作流'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#667268]">
            <ShieldCheck size={14} />
            接入平台
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(platformLabels) as RemoteRelayPlatform[]).map((platform) => (
              <button
                key={platform}
                type="button"
                onClick={() => togglePlatform(platform)}
                className={`h-8 rounded-full px-3 text-xs transition ${
                  allowedPlatforms.includes(platform)
                    ? 'bg-[#e2f7e9] text-[#1f6b3e]'
                    : 'border border-[#d4e4d6] bg-white text-[#667268]'
                }`}
              >
                {platformLabels[platform]}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[#667268]">轮询间隔，秒</span>
          <input
            type="number"
            min={8}
            max={120}
            value={pollIntervalSeconds}
            onChange={(event) =>
              setRemoteRelayConfig({ pollIntervalSeconds: Number(event.target.value) })
            }
            className="h-10 w-full rounded-lg border border-[#d4e4d6] bg-white px-3 text-sm text-[#1f3d2a] outline-none transition focus:border-[#31a96b]"
          />
        </label>

        <div className="rounded-lg border border-[#d4e4d6] bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-[#1f3d2a]">
              <Clipboard size={14} />
              Adapter contract
            </div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(platformLabels) as RemoteRelayPlatform[]).map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => setSamplePlatform(platform)}
                  className={`h-7 rounded-full px-2 text-[11px] transition ${
                    samplePlatform === platform
                      ? 'bg-[#1f3d2a] text-white'
                      : 'border border-[#d4e4d6] bg-[#fbfffb] text-[#667268]'
                  }`}
                >
                  {platformLabels[platform]}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-2 text-xs leading-5 text-[#667268]">
            WeChat/QQ should come through Clawbot or a user-owned adapter. Feishu and WeCom
            should post official bot callbacks to the same Scallion webhook.
          </div>
          <pre className="max-h-40 overflow-auto rounded-lg bg-[#f5fbf6] p-3 text-[11px] leading-5 text-[#1f3d2a]">
            {adapterPayload}
          </pre>
          <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-[#f9f6ee] p-3 text-[11px] leading-5 text-[#4f6253]">
            {curlExample}
          </pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyAdapterPayload()}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#d4e4d6] bg-[#fbfffb] px-3 text-xs font-medium text-[#667268] transition hover:text-[#1f3d2a]"
            >
              <Clipboard size={13} />
              Copy payload
            </button>
            <button
              type="button"
              onClick={() => void copyCurlExample()}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#d4e4d6] bg-[#fbfffb] px-3 text-xs font-medium text-[#667268] transition hover:text-[#1f3d2a]"
            >
              <Clipboard size={13} />
              Copy curl
            </button>
          </div>
        </div>

        <div className="rounded-lg bg-[#eef8f0] p-3 text-xs leading-5 text-[#4f6253]">
          Webhook: <span className="break-all font-medium text-[#1f3d2a]">{webhookUrl}</span>
          <br />
          Clawbot 负责连接微信/QQ，飞书和企业微信使用官方机器人回调；Papyrus 只处理经过 Scallion Relay
          转发的文本任务和附件摘要。
        </div>
      </div>
    </section>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#d4e4d6] bg-white p-3">
      <div className="text-[11px] font-medium text-[#667268]">{label}</div>
      <div className="mt-1 truncate text-xs text-[#1f3d2a]">{value}</div>
    </div>
  )
}

function maskSecret(value: string) {
  if (value.length <= 8) {
    return '已生成'
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`
}
