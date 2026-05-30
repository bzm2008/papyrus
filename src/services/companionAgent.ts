import { composeSystemPrompt } from './agentPromptContext'
import { composeWritingContext } from './contextComposer'
import { extractDraftText, inferPatchOperation, queueDocumentPatch, shouldCreateDocumentPatch } from './documentPatchService'
import { callOpenAICompatible, canCallProvider } from './llmClient'
import { retrieveMentionContext } from './projectContext'
import { useAppStore, type DocumentPatchOperation } from '../stores/useAppStore'

export type CompanionAgentResult = {
  reply: string
  replacement?: string
  patch?: {
    operation: DocumentPatchOperation
    title: string
    content: string
  }
  mode: 'advice' | 'replacement' | 'patch'
}

export async function sendCompanionMessage(prompt: string): Promise<CompanionAgentResult> {
  const content = prompt.trim()

  if (!content) {
    return { reply: '', mode: 'advice' }
  }

  const store = useAppStore.getState()
  const provider = store.providerConfigs[store.activeProviderId]
  const selectedText = store.editorSelectionText.trim()
  const writeIntent = shouldCreateDocumentPatch(content)
  const userMessage = store.addCompanionMessage({ role: 'user', content })
  const assistantMessage = store.addCompanionMessage({
    role: 'assistant',
    content: selectedText ? '正在处理选区...' : '正在阅读文稿...',
  })

  store.setCompanionRunState('running')
  store.setLlmRunState('running', '伴写 Agent 正在处理')

  try {
    const result = selectedText
      ? await runSelectedTextAgent(content, selectedText)
      : writeIntent
        ? await runPatchAgent(content)
        : await runAdviceAgent(content)

    useAppStore.getState().updateCompanionMessage(assistantMessage.id, {
      content: result.reply,
    })
    useAppStore.getState().setCompanionRunState('idle')
    useAppStore.getState().setLlmRunState('idle', '伴写 Agent 已完成')

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : '伴写 Agent 处理失败'
    useAppStore.getState().updateCompanionMessage(assistantMessage.id, { content: message })
    useAppStore.getState().setCompanionRunState('error')
    useAppStore.getState().setLlmRunState('error', message)

    return { reply: message, mode: 'advice' }
  } finally {
    if (!userMessage.content.trim()) {
      useAppStore.getState().updateCompanionMessage(userMessage.id, { content })
    }
  }

  async function runSelectedTextAgent(instruction: string, selection: string): Promise<CompanionAgentResult> {
    const replacement = await callOrMock([
      '你是 Papyrus 的伴写 Agent。',
      '用户给出了一个局部选区和处理指令。',
      '只返回可直接替换选区的正文，不要解释，不要加标题。',
    ].join('\n'), [
      `指令：${instruction}`,
      `选区：\n${selection}`,
      contextBlock(),
    ].join('\n\n'), createSelectionMock(selection, instruction))

    const patch = {
      operation: 'replace_selection' as const,
      title: '伴写选区改写',
      content: replacement,
    }

    queueDocumentPatch(patch)

    return {
      reply:
        useAppStore.getState().flowReviewMode === 'auto'
          ? '已按指令改写选区。'
          : '已生成选区改写，等待写入文稿。',
      replacement,
      patch,
      mode: 'replacement',
    }
  }

  async function runPatchAgent(instruction: string): Promise<CompanionAgentResult> {
    const response = await callOrMock([
      '你是 Papyrus 的伴写 Agent。',
      '用户希望生成、续写、补写或改写文稿。',
      '输出格式必须是：答复: 一句话说明。然后 正文: 后面给出可写入文稿的内容。',
      '不要把执行过程、来源解释或计划写入正文。',
    ].join('\n'), [
      `指令：${instruction}`,
      contextBlock(),
    ].join('\n\n'), `答复: 已准备好可写入文稿的内容。\n\n正文: ${instruction}`)
    const draft = extractDraftText(response)
    const patch = {
      operation: inferPatchOperation(instruction),
      title: '伴写 Agent 文稿补丁',
      content: draft,
    }

    queueDocumentPatch(patch)

    return {
      reply:
        useAppStore.getState().flowReviewMode === 'auto'
          ? '已生成并写入文稿。'
          : '已生成文稿补丁，等待写入文稿。',
      patch,
      mode: 'patch',
    }
  }

  async function runAdviceAgent(instruction: string): Promise<CompanionAgentResult> {
    const reply = await callOrMock([
      '你是 Papyrus 的伴写 Agent。',
      '用户现在需要写作建议、诊断、方向或解释。',
      '只在对话里回答，不要生成文稿补丁。回答要简洁、具体、可执行。',
    ].join('\n'), [
      `问题：${instruction}`,
      contextBlock(),
    ].join('\n\n'), '我会先看结构、语气和事实风险，再给出最小可执行修改建议。')

    return { reply, mode: 'advice' }
  }

  async function callOrMock(system: string, user: string, fallback: string) {
    if (!canCallProvider(provider)) {
      return fallback
    }

    return callOpenAICompatible(provider, [
      { role: 'system', content: composeSystemPrompt(system) },
      { role: 'user', content: user },
    ])
  }

  function createSelectionMock(selection: string, instruction: string) {
    return `${selection}（已按“${instruction}”调整）`
  }

  function contextBlock() {
    const state = useAppStore.getState()
    const mentionContextPromise = retrieveMentionContext(state.mentionContextItems)
    void mentionContextPromise
    const context = composeWritingContext({ includeFullCurrentArticle: true })

    return [
      context.text,
      state.mentionContextItems.length
        ? `@ mentions:\n${state.mentionContextItems.map((item) => `${item.label}: ${item.excerpt}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    const resources = state.resources
      .filter((resource) => resource.content)
      .slice(0, 5)
      .map((resource) => `[${resource.name}]\n${resource.content.slice(0, 900)}`)
      .join('\n\n')

    return [
      state.projectGuidance.style ? `STYLE.md:\n${state.projectGuidance.style}` : '',
      state.projectGuidance.world ? `WORLD.md:\n${state.projectGuidance.world}` : '',
      state.negativeMemories.length ? `负向记忆:\n${state.negativeMemories.join('\n')}` : '',
      resources ? `项目资料:\n${resources}` : '',
      `当前文稿:\n${state.editorText.slice(0, 6000)}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }
}
