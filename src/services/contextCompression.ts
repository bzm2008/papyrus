import { callOpenAICompatible, canCallProvider } from './llmClient'
import { useAppStore } from '../stores/useAppStore'

export async function compressCurrentContext(reason: 'manual' | 'auto') {
  const store = useAppStore.getState()

  if (store.isContextCompressing) {
    return
  }

  store.setContextCompressionState(
    'running',
    reason === 'manual' ? '正在手动压缩上下文' : '上下文达到阈值，正在自动压缩',
  )

  const provider = store.providerConfigs[store.activeProviderId]

  try {
    const summary = canCallProvider(provider)
      ? await callOpenAICompatible(provider, [
          {
            role: 'system',
            content:
              '你是 Papyrus 的上下文压缩器。把长文稿和对话压缩为结构化摘要，保留任务目标、关键事实、人物/概念设定、未解决问题和下一步。',
          },
          {
            role: 'user',
            content: [
              store.compressedSummary ? `既有摘要：\n${store.compressedSummary}` : '',
              `文稿：\n${store.editorText}`,
              `Flow 对话：\n${store.flowMessages
                .map((message) => `${message.role}: ${message.content}`)
                .join('\n')}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ])
      : createLocalSummary(store.editorText, store.flowMessages.map((message) => message.content))

    useAppStore.getState().applyContextCompression(summary, reason)
  } catch (error) {
    useAppStore
      .getState()
      .setContextCompressionState(
        'error',
        `压缩失败：${error instanceof Error ? error.message : '未知错误'}`,
      )
  }
}

function createLocalSummary(editorText: string, flowMessages: string[]) {
  const excerpt = editorText.replace(/\s+/g, ' ').slice(0, 360)
  const recent = flowMessages.slice(-4).join(' / ').replace(/\s+/g, ' ').slice(0, 360)

  return [
    '本地压缩摘要：',
    `文稿核心：${excerpt || '暂无文稿内容'}`,
    `近期对话：${recent || '暂无 Flow 对话'}`,
    '下一步：继续围绕文稿结构、材料核验和表达审查推进。',
  ].join('\n')
}
