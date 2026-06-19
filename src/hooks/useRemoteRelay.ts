import { useEffect, useRef } from 'react'
import { sendCompanionMessage } from '../services/companionAgent'
import { sendFlowMessage } from '../services/flowOrchestrator'
import {
  ackRemoteRelayJob,
  createRemotePrompt,
  pollRemoteRelayJobs,
  registerRemoteRelayChannel,
  reportRemoteRelayResult,
  type RemoteRelayJob,
} from '../services/remoteRelayService'
import { useAppStore, type RemoteRelayMode } from '../stores/useAppStore'

export function useRemoteRelay() {
  const enabled = useAppStore((state) => state.remoteRelayEnabled)
  const token = useAppStore((state) => state.scallionToken)
  const endpoint = useAppStore((state) => state.remoteRelayEndpoint)
  const channelId = useAppStore((state) => state.remoteRelayChannelId)
  const accessKey = useAppStore((state) => state.remoteRelayAccessKey)
  const pollIntervalSeconds = useAppStore((state) => state.remoteRelayPollIntervalSeconds)
  const processingRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      useAppStore.getState().setRemoteRelayState({
        status: 'idle',
        message: '远程中继未启用',
      })
      return
    }

    if (!token) {
      useAppStore.getState().setRemoteRelayState({
        status: 'error',
        message: '请先登录 Scallion 账号，再启用远程中继',
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
          state.setRemoteRelayState({ status: 'connecting', message: '正在注册远程中继频道' })
          const channel = await registerRemoteRelayChannel({
            endpoint: state.remoteRelayEndpoint,
            token: state.scallionToken ?? '',
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
          token: state.scallionToken ?? '',
          channelId: activeChannelId,
          accessKey: activeAccessKey,
        })

        useAppStore.getState().setRemoteRelayState({
          status: 'online',
          message: jobs.length ? `收到 ${jobs.length} 条远程任务` : '远程中继在线，等待消息',
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
          message: error instanceof Error ? error.message : '远程中继连接失败',
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
  }, [accessKey, channelId, enabled, endpoint, pollIntervalSeconds, token])
}

async function handleRemoteJob(job: RemoteRelayJob, channelId?: string, accessKey?: string) {
  const state = useAppStore.getState()
  const mode = pickMode(job.mode, state.remoteRelayDefaultMode)
  const allowedPlatforms = new Set(state.remoteRelayAllowedPlatforms)
  const clientConfig = {
    endpoint: state.remoteRelayEndpoint,
    token: state.scallionToken ?? '',
    channelId,
    accessKey,
  }

  await ackRemoteRelayJob(clientConfig, job.id)

  try {
    if (!allowedPlatforms.has(job.platform)) {
      throw new Error(`Remote platform is not allowed: ${job.platform}`)
    }

    const prompt = createRemotePrompt(job, mode)
    let reply = ''
    const harnessInput = {
      source: 'remote' as const,
      remoteJobId: job.id,
      remotePlatform: job.platform,
      remoteSenderId: job.senderId,
    }

    if (mode === 'flow') {
      const before = useAppStore.getState().flowMessages.length
      await sendFlowMessage(prompt, harnessInput)
      const messages = useAppStore.getState().flowMessages.slice(before)
      reply =
        [...messages].reverse().find((message) => message.role === 'assistant')?.content ||
        'Flow 已处理该远程任务，请回到 Papyrus 查看工作流结果。'
    } else {
      const result = await sendCompanionMessage(prompt, harnessInput)
      reply = result.reply || '文学秘书已处理该远程任务。'
    }

    useAppStore.getState().setRemoteRelayState({
      status: 'online',
      message: `已处理来自 ${job.platform} 的远程消息`,
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

function pickMode(input: RemoteRelayMode | undefined, fallback: RemoteRelayMode) {
  return input === 'flow' || input === 'companion' ? input : fallback
}
