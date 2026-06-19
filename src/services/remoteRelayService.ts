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
const knownPlatforms: RemoteRelayPlatform[] = ['clawbot', 'feishu', 'wecom', 'qq', 'wechat', 'custom']

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

export function normalizeRemoteRelayJob(input: unknown): RemoteRelayJob | undefined {
  if (!input || typeof input !== 'object') {
    return undefined
  }

  const payload = input as Record<string, unknown>
  const platform = normalizePlatform(payload.platform ?? payload.source ?? payload.adapter)
  const content = pickString(
    payload.content,
    payload.text,
    payload.message,
    payload.raw_message,
    payload.rawMessage,
    nestedString(payload.event, 'text'),
    nestedString(payload.message, 'text'),
  )

  if (!content) {
    return undefined
  }

  return {
    id: pickString(payload.id, payload.jobId, payload.messageId, payload.msg_id) || createLocalJobId(),
    platform,
    senderId: pickString(
      payload.senderId,
      payload.userId,
      payload.openId,
      payload.unionId,
      payload.from,
      nestedString(payload.sender, 'id'),
      nestedString(payload.user, 'id'),
    ),
    senderName: pickString(
      payload.senderName,
      payload.userName,
      payload.nickname,
      nestedString(payload.sender, 'name'),
      nestedString(payload.user, 'name'),
    ),
    content,
    mode: normalizeMode(payload.mode),
    createdAt: pickString(payload.createdAt, payload.timestamp, payload.createTime) || Date.now(),
    threadId: pickString(payload.threadId, payload.conversationId, payload.chatId, payload.groupId),
    attachments: normalizeAttachments(payload.attachments),
  }
}

export function createAdapterWebhookPayloadExample(platform: RemoteRelayPlatform) {
  const base = {
    platform,
    senderId: `${platform}-user-123`,
    senderName: 'Remote User',
    content: '请帮我把这段文字润色，并指出最需要改的一处。',
    mode: 'companion' as RemoteRelayMode,
    threadId: `${platform}-thread-001`,
    attachments: [
      {
        name: 'draft.txt',
        text: '可选：由适配器提取出的附件文本。',
      },
    ],
  }

  if (platform === 'clawbot' || platform === 'qq' || platform === 'wechat') {
    return {
      ...base,
      platform: platform === 'clawbot' ? 'clawbot' : platform,
      adapter: 'clawbot',
      messageId: 'clawbot-msg-001',
      groupId: 'optional-group-id',
    }
  }

  if (platform === 'feishu') {
    return {
      ...base,
      openId: 'ou_xxx',
      chatId: 'oc_xxx',
      messageId: 'om_xxx',
    }
  }

  if (platform === 'wecom') {
    return {
      ...base,
      userId: 'wm-user-id',
      conversationId: 'wecom-conversation-id',
      messageId: 'wecom-msg-001',
    }
  }

  return base
}

export function createAdapterCurlExample(webhookUrl: string, accessKey?: string, platform: RemoteRelayPlatform = 'custom') {
  const headers = ['-H "Content-Type: application/json"']

  if (accessKey) {
    headers.push(`-H "X-Papyrus-Relay-Key: ${accessKey}"`)
  }

  return [
    `curl -X POST "${webhookUrl}" \\`,
    `  ${headers.join(' \\\n  ')} \\`,
    `  -d '${JSON.stringify(createAdapterWebhookPayloadExample(platform))}'`,
  ].join('\n')
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

  const payload = await parseRelayResponse<{ jobs?: unknown[] } | unknown[]>(response)
  const jobs = Array.isArray(payload) ? payload : payload.jobs ?? []

  return jobs.map(normalizeRemoteRelayJob).filter(Boolean) as RemoteRelayJob[]
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

function normalizePlatform(input: unknown): RemoteRelayPlatform {
  const value = typeof input === 'string' ? input.toLowerCase() : ''

  if (knownPlatforms.includes(value as RemoteRelayPlatform)) {
    return value as RemoteRelayPlatform
  }

  if (value.includes('wx') || value.includes('wechat')) {
    return 'wechat'
  }

  if (value.includes('qq')) {
    return 'qq'
  }

  if (value.includes('feishu') || value.includes('lark')) {
    return 'feishu'
  }

  if (value.includes('wecom') || value.includes('workwechat')) {
    return 'wecom'
  }

  return 'custom'
}

function normalizeMode(input: unknown): RemoteRelayMode | undefined {
  return input === 'flow' || input === 'companion' ? input : undefined
}

function normalizeAttachments(input: unknown): RemoteRelayJob['attachments'] {
  if (!Array.isArray(input)) {
    return undefined
  }

  return input
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return undefined
      }

      const attachment = item as Record<string, unknown>
      const name = pickString(attachment.name, attachment.filename, attachment.title) || 'attachment'
      const url = pickString(attachment.url, attachment.href)
      const text = pickString(attachment.text, attachment.content, attachment.summary)

      return { name, url, text }
    })
    .filter(Boolean) as RemoteRelayJob['attachments']
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }

    if (typeof value === 'number') {
      return String(value)
    }
  }

  return undefined
}

function nestedString(input: unknown, key: string) {
  if (!input || typeof input !== 'object') {
    return undefined
  }

  return (input as Record<string, unknown>)[key]
}

function createLocalJobId() {
  return globalThis.crypto?.randomUUID?.() ?? `remote-job-${Date.now()}`
}
