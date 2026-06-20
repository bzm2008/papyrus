import { CheckCircle2, KeyRound, Loader2, MessageSquareMore, RadioTower, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppStore, type RemotePlatformCredential } from '../stores/useAppStore'

const platforms: Array<{
  id: RemotePlatformCredential['platform']
  label: string
  description: string
}> = [
  {
    id: 'feishu',
    label: '飞书',
    description: '填写飞书应用的 AppID 与密钥，消息会进入秘书模式。',
  },
  {
    id: 'qq',
    label: 'QQ',
    description: '填写 QQ 机器人 AppID 与密钥，客户端会只保留必要凭据。',
  },
  {
    id: 'wecom',
    label: '企业微信',
    description: '填写企业微信应用 AppID 与密钥，远程任务由秘书长调度。',
  },
]

export function RemoteRelaySettings() {
  const credentials = useAppStore((state) => state.remotePlatformCredentials)
  const remoteRelayEnabled = useAppStore((state) => state.remoteRelayEnabled)
  const remoteRelayStatus = useAppStore((state) => state.remoteRelayStatus)
  const remoteRelayMessage = useAppStore((state) => state.remoteRelayMessage)
  const remoteRelayLastJobAt = useAppStore((state) => state.remoteRelayLastJobAt)
  const upsertRemotePlatformCredential = useAppStore((state) => state.upsertRemotePlatformCredential)
  const updateRemotePlatformCredentialStatus = useAppStore(
    (state) => state.updateRemotePlatformCredentialStatus,
  )
  const setRemoteRelayConfig = useAppStore((state) => state.setRemoteRelayConfig)
  const activeCount = useMemo(() => credentials.filter((item) => item.enabled).length, [credentials])
  const [testing, setTesting] = useState<RemotePlatformCredential['platform'] | undefined>()

  const updateCredential = (
    platform: RemotePlatformCredential['platform'],
    patch: Partial<RemotePlatformCredential>,
  ) => {
    upsertRemotePlatformCredential({
      platform,
      ...credentials.find((item) => item.platform === platform),
      ...patch,
    })
  }

  const testConnection = async (credential: RemotePlatformCredential) => {
    setTesting(credential.platform)
    updateRemotePlatformCredentialStatus(credential.platform, {
      status: 'testing',
      lastError: undefined,
    })

    await new Promise((resolve) => window.setTimeout(resolve, 350))

    if (!credential.appId.trim() || !credential.secret.trim()) {
      updateRemotePlatformCredentialStatus(credential.platform, {
        status: 'error',
        lastError: '请先填写 AppID 和密钥。',
      })
    } else {
      updateRemotePlatformCredentialStatus(credential.platform, {
        status: 'ok',
        lastError: undefined,
      })
      setRemoteRelayConfig({
        enabled: true,
        allowedPlatforms: ['feishu', 'qq', 'wecom'],
        defaultMode: 'flow',
      })
    }

    setTesting(undefined)
  }

  return (
    <section className="rounded-xl border border-[#d4e4d6] bg-[#fbfffb] p-4 shadow-[0_10px_24px_rgba(31,61,42,0.05)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1f3d2a]">
            <RadioTower size={15} className="text-[#31a96b]" />
            远程连接
          </div>
          <p className="mt-1 text-xs leading-5 text-[#667268]">
            这里只保留必要凭据。飞书、QQ、企业微信收到的消息默认且只能进入秘书模式，由秘书长调度工作室 Agent。
          </p>
        </div>
        <span
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${
            remoteRelayEnabled && activeCount
              ? 'bg-[#e2f7e9] text-[#1f6b3e]'
              : 'bg-[#f2eee5] text-[#6f7168]'
          }`}
        >
          {remoteRelayEnabled && activeCount ? <CheckCircle2 size={13} /> : <MessageSquareMore size={13} />}
          {activeCount ? `${activeCount} 个平台` : '未启用'}
        </span>
      </div>

      <div className="mt-3 rounded-lg border border-[#d4e4d6] bg-white px-3 py-2 text-xs leading-5 text-[#667268]">
        状态：{remoteRelayStatus === 'online' ? '在线' : remoteRelayStatus === 'error' ? '异常' : '待连接'}。
        {remoteRelayMessage}
        {remoteRelayLastJobAt ? ` 最近任务：${new Date(remoteRelayLastJobAt).toLocaleTimeString()}` : ''}
      </div>

      <div className="mt-4 grid gap-3">
        {platforms.map((platform) => {
          const credential =
            credentials.find((item) => item.platform === platform.id) ??
            ({
              platform: platform.id,
              appId: '',
              secret: '',
              enabled: false,
              status: 'idle',
            } satisfies RemotePlatformCredential)

          return (
            <article key={platform.id} className="rounded-xl border border-[#d4e4d6] bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#1f3d2a]">{platform.label}</div>
                  <p className="mt-1 text-xs leading-5 text-[#667268]">{platform.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateCredential(platform.id, { enabled: !credential.enabled })}
                  className={`h-7 rounded-full px-2.5 text-[11px] font-medium transition ${
                    credential.enabled
                      ? 'bg-[#e2f7e9] text-[#1f6b3e]'
                      : 'border border-[#d4e4d6] bg-[#fbfffb] text-[#667268]'
                  }`}
                >
                  {credential.enabled ? '启用' : '停用'}
                </button>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[#667268]">AppID</span>
                  <input
                    value={credential.appId}
                    onChange={(event) => updateCredential(platform.id, { appId: event.target.value })}
                    className="h-10 w-full rounded-lg border border-[#d4e4d6] bg-[#fbfffb] px-3 text-sm text-[#1f3d2a] outline-none transition focus:border-[#31a96b]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[#667268]">密钥</span>
                  <input
                    type="password"
                    value={credential.secret}
                    onChange={(event) => updateCredential(platform.id, { secret: event.target.value })}
                    className="h-10 w-full rounded-lg border border-[#d4e4d6] bg-[#fbfffb] px-3 text-sm text-[#1f3d2a] outline-none transition focus:border-[#31a96b]"
                  />
                </label>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[#667268]">
                  {credential.status === 'testing' || testing === credential.platform ? (
                    <Loader2 size={13} className="animate-spin text-[#31a96b]" />
                  ) : credential.status === 'ok' ? (
                    <CheckCircle2 size={13} className="text-[#1f6b3e]" />
                  ) : credential.status === 'error' ? (
                    <XCircle size={13} className="text-[#a33c20]" />
                  ) : (
                    <KeyRound size={13} />
                  )}
                  <span className="truncate">
                    {credential.status === 'ok'
                      ? '凭据已填写'
                      : credential.status === 'error'
                        ? credential.lastError
                        : '远程任务将进入秘书模式'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void testConnection(credential)}
                  disabled={testing === credential.platform}
                  className="h-8 shrink-0 rounded-lg border border-[#d4e4d6] bg-[#fbfffb] px-3 text-xs font-medium text-[#1f3d2a] transition hover:bg-[#eef8f0] disabled:cursor-wait disabled:opacity-55"
                >
                  测试连接
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
