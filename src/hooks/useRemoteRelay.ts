import { useEffect, useRef } from 'react'
import { sendFlowMessage } from '../services/flowOrchestrator'
import {
  ackRemoteRelayJob,
  createRemotePrompt,
  pollRemoteRelayJobs,
  registerRemoteRelayChannel,
  reportRemoteRelayResult,
  type RemoteRelayJob,
} from '../services/remoteRelayService'
import { useAppStore } from '../stores/useAppStore'

export function useRemoteRelay() {
  const enabled = useAppStore((state) => state.remoteRelayEnabled)
  const token = useAppStore((state) => state.scallionToken)
  const platformCredentials = useAppStore((state) => state.remotePlatformCredentials)
  const endpoint = useAppStore((state) => state.remoteRelayEndpoint)
  const channelId = useAppStore((state) => state.remoteRelayChannelId)
  const accessKey = useAppStore((state) => state.remoteRelayAccessKey)
  const pollIntervalSeconds = useAppStore((state) => state.remoteRelayPollIntervalSeconds)
  const processingRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      useAppStore.getState().setRemoteRelayState({
        status: 'idle',
        message: '远程连接未启用',
      })
      return
    }

    const activeCredential = platformCredentials.find(
      (credential) => credential.enabled && credential.appId.trim() && credential.secret.trim(),
    )

    if (!token && !activeCredential) {
      useAppStore.getState().setRemoteRelayState({
        status: 'error',
        message: '请先在远程连接里启用一个平台，并填写 AppID 与密钥',
      })
      return
    }

    let cancelled = false

    const tick = async () => {
      if (cancelled || processingRef.current) {
        return
      }

      const state = useAppStore.getState()
      processingRef.current = true

      try {
        let activeChannelId = state.remoteRelayChannelId
        let activeAccessKey = state.remoteRelayAccessKey

        if (!activeChannelId) {
          state.setRemoteRelayState({ status: 'connecting', message: '正在准备远程连接' })
          const channel = await registerRemoteRelayChannel({
            endpoint: state.remoteRelayEndpoint,
            token: activeRemoteToken(state),
            channelId: activeChannelId,
            accessKey: activeAccessKey,
          })
          activeChannelId = channel.channelId
          activeAccessKey = channel.accessKey ?? activeAccessKey
          state.setRemoteRelayConfig({
            channelId: activeChannelId,
            accessKey: activeAccessKey,
          })
        }

        const jobs = await pollRemoteRelayJobs({
          endpoint: state.remoteRelayEndpoint,
          token: activeRemoteToken(state),
          channelId: activeChannelId,
          accessKey: activeAccessKey,
        })

        useAppStore.getState().setRemoteRelayState({
          status: 'online',
          message: jobs.length ? `收到 ${jobs.length} 条远程任务` : '远程连接在线，等待消息',
        })

        for (const job of jobs) {
          if (cancelled) {
            break
          }

          await handleRemoteJob(job, activeChannelId, activeAccessKey)
        }
      } catch (error) {
        useAppStore.getState().setRemoteRelayState({
          status: 'error',
        message: error instanceof Error ? error.message : '远程连接失败',
        })
      } finally {
        processingRef.current = false
      }
    }

    void tick()
    const timer = window.setInterval(tick, Math.max(8, pollIntervalSeconds) * 1000)

    return () => {
      cancelled = true
      if (timer) {
        window.clearInterval(timer)
      }
    }
  }, [accessKey, channelId, enabled, endpoint, platformCredentials, pollIntervalSeconds, token])
}

async function handleRemoteJob(job: RemoteRelayJob, channelId?: string, accessKey?: string) {
  const state = useAppStore.getState()
  const mode = 'flow' as const
  const enabledPlatforms = state.remotePlatformCredentials
    .filter((credential) => credential.enabled)
    .map((credential) => credential.platform)
  const allowedPlatforms = new Set(enabledPlatforms.length ? enabledPlatforms : ['feishu', 'qq', 'wecom'])
  const clientConfig = {
    endpoint: state.remoteRelayEndpoint,
    token: activeRemoteToken(state),
    channelId,
    accessKey,
  }

  await ackRemoteRelayJob(clientConfig, job.id)

  try {
    if (!allowedPlatforms.has(job.platform)) {
      throw new Error(`Remote platform is not allowed: ${job.platform}`)
    }

    const prompt = createRemotePrompt(job)
    let reply = ''
    const harnessInput = {
      source: 'remote' as const,
      remoteJobId: job.id,
      remotePlatform: job.platform,
      remoteSenderId: job.senderId,
    }

    const before = useAppStore.getState().flowMessages.length
    await sendFlowMessage(prompt, harnessInput)
    const messages = useAppStore.getState().flowMessages.slice(before)
    reply =
      [...messages].reverse().find((message) => message.role === 'assistant')?.content ||
      '秘书模式已处理该远程任务，请回到 Papyrus 查看工作流结果。'

    useAppStore.getState().setRemoteRelayState({
      status: 'online',
      message: `已用秘书模式处理来自 ${job.platform} 的远程消息`,
      lastJobAt: Date.now(),
    })
    await reportRemoteRelayResult(clientConfig, job.id, {
      status: 'completed',
      reply,
      mode,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '远程任务处理失败'
    useAppStore.getState().setRemoteRelayState({
      status: 'error',
      message,
      lastJobAt: Date.now(),
    })
    await reportRemoteRelayResult(clientConfig, job.id, {
      status: 'failed',
      reply: message,
      mode,
      error: message,
    })
  }
}

function activeRemoteToken(state: ReturnType<typeof useAppStore.getState>) {
  if (state.scallionToken) {
    return state.scallionToken
  }

  const credential = state.remotePlatformCredentials.find(
    (item) => item.enabled && item.appId.trim() && item.secret.trim(),
  )

  return credential ? `${credential.platform}:${credential.appId}:${credential.secret}` : ''
}
