import { composeSystemPrompt } from './agentPromptContext'
import { callOpenAICompatible, canCallProvider } from './llmClient'
import { retrieveMentionContext } from './projectContext'
import { useAppStore, type LlmProviderConfig } from '../stores/useAppStore'

export type WritingAction = '指令' | '审查' | '纠错' | '查重' | '降噪'

export async function runCompanionRewrite({
  action,
  selectedText,
  customPrompt,
  provider,
}: {
  action: WritingAction
  selectedText: string
  customPrompt?: string
  provider: LlmProviderConfig
}) {
  const text = selectedText.trim() || '这段文字'

  if (!canCallProvider(provider)) {
    return createMockReplacement(action, text, customPrompt)
  }

  const mentionContext = await retrieveMentionContext(useAppStore.getState().mentionContextItems)

  return callOpenAICompatible(provider, [
    {
      role: 'system',
      content: composeSystemPrompt(
        '你是 Papyrus 的伴写助手。只返回改写后的正文，不要解释。保留作者的核心意思、语气和当前写作氛围，避免过度扩写。',
      ),
    },
    {
      role: 'user',
      content: [
        mentionContext ? `@ 提及对象检索结果：\n${mentionContext}` : '',
        buildActionPrompt(action, text, customPrompt),
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ])
}

function buildActionPrompt(action: WritingAction, text: string, customPrompt?: string) {
  if (action === '指令') {
    return `请按这个指令处理选中文本：${customPrompt || '优化表达'}\n\n选中文本：\n${text}`
  }

  const prompts: Record<Exclude<WritingAction, '指令'>, string> = {
    审查: '请审查这段文字的逻辑、事实风险和论证薄弱处，并把文本改成更稳妥的版本。',
    纠错: '请修正错别字、病句和标点问题。',
    查重: '请降低通用表达和重复表达，保留原意。',
    降噪: '请去除明显 AI 腔、模板化表达和空泛修饰。',
  }

  return `${prompts[action]}\n\n选中文本：\n${text}`
}

function createMockReplacement(action: WritingAction, selectedText: string, prompt?: string) {
  const text = selectedText || '这段文字'

  if (action === '指令') {
    return `${text}（已按“${prompt?.trim() || '自定义指令'}”进行模拟改写）`
  }

  const replacements: Record<Exclude<WritingAction, '指令'>, string> = {
    审查: `${text}（审查提示：这里已补上一处论证压力测试，请后续核实材料来源。）`,
    纠错: `${text}（已完成模拟纠错）`,
    查重: `${text}（查重摘要：当前片段疑似通用表达偏高，建议加入更具体的案例或出处。）`,
    降噪: `${text}（已降低模板化表达）`,
  }

  return replacements[action]
}
