import type {
  RemoteRelayMode,
  RemoteRelayPlatform,
  RemoteRelayStatus,
} from '../stores/useAppStore'

export type RemoteRelayChannel = {
  channelId: string
  accessKey?: string
  webhookUrl?: string
  status?: RemoteRelayStatus
}

export type RemoteRelayJob = {
  id: string
  platform: RemoteRelayPlatform
  senderId?: string
  senderName?: string
  content: string
  mode?: RemoteRelayMode
  createdAt?: string | number
  threadId?: string
  attachments?: Array<{
    name: string
    url?: string
    text?: string
  }>
}

export type RemoteRelayClientConfig = {
  endpoint: string
  token: string
  channelId?: string
  accessKey?: string
}

export type RemoteRelayResultPayload = {
  status: 'completed' | 'failed'
  reply: string
  mode: RemoteRelayMode
  error?: string
}

const defaultEndpoint = 'https://scallion.uno/api/papyrus/remote'

export function normalizeRelayEndpoint(endpoint?: string) {
  const value = endpoint?.trim() || defaultEndpoint
  return value.replace(/\/+$/, '')
}

export function createRemotePrompt(job: RemoteRelayJob, mode: RemoteRelayMode) {
  const sender = [job.senderName, job.senderId].filter(Boolean).join(' / ') || 'unknown sender'
  const createdAt = job.createdAt ? new Date(job.createdAt).toLocaleString() : 'unknown time'
  const attachments = job.attachments?.length
    ? job.attachments
        .map((item, index) => {
          const body = item.text || item.url || 'no readable content'
          return `${index + 1}. ${item.name}\n${body}`
        })
        .join('\n\n')
    : ''

  return [
    '远程消息任务',
    `来源平台: ${job.platform}`,
    `发送者: ${sender}`,
    `时间: ${createdAt}`,
    `目标模式: ${mode === 'flow' ? 'Flow 工作流' : '文学秘书'}`,
    '',
    '用户消息:',
    job.content,
    attachments ? `\n附件与资料:\n${attachments}` : '',
    '',
    '请像 Papyrus 文学秘书一样处理。若需要写入文稿，请生成可审阅的文稿补丁；若只是问答，请直接给出清楚、可执行的回复。',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function registerRemoteRelayChannel(config: RemoteRelayClientConfig) {
  const response = await relayFetch(config, '/channels', {
    method: 'POST',
    body: JSON.stringify({
      channelId: config.channelId,
      accessKey: config.accessKey,
      client: 'papyrus-desktop',
    }),
  })

  return parseRelayResponse<RemoteRelayChannel>(response)
}

export async function pollRemoteRelayJobs(config: RemoteRelayClientConfig) {
  if (!config.channelId) {
    return []
  }

  const response = await relayFetch(config, `/channels/${encodeURIComponent(config.channelId)}/jobs`, {
    method: 'GET',
  })

  const payload = await parseRelayResponse<{ jobs?: RemoteRelayJob[] } | RemoteRelayJob[]>(response)
  return Array.isArray(payload) ? payload : payload.jobs ?? []
}

export async function ackRemoteRelayJob(config: RemoteRelayClientConfig, jobId: string) {
  await relayFetch(config, `/jobs/${encodeURIComponent(jobId)}/ack`, {
    method: 'POST',
    body: JSON.stringify({ channelId: config.channelId }),
  })
}

export async function reportRemoteRelayResult(
  config: RemoteRelayClientConfig,
  jobId: string,
  payload: RemoteRelayResultPayload,
) {
  await relayFetch(config, `/jobs/${encodeURIComponent(jobId)}/result`, {
    method: 'POST',
    body: JSON.stringify({
      channelId: config.channelId,
      ...payload,
    }),
  })
}

async function relayFetch(
  config: RemoteRelayClientConfig,
  path: string,
  init: RequestInit,
) {
  const response = await fetch(`${normalizeRelayEndpoint(config.endpoint)}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
      ...(config.accessKey ? { 'X-Papyrus-Relay-Key': config.accessKey } : {}),
      ...init.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Remote relay request failed: ${response.status}`)
  }

  return response
}

async function parseRelayResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return {} as T
  }

  return (await response.json()) as T
}
