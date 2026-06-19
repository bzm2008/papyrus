import { composeSystemPrompt } from './agentPromptContext'
import { failAgentRun, finishAgentRun, startAgentRun, type AgentHarnessRunInput } from './agentHarness'
import { composeWritingContext } from './contextComposer'
import {
  extractDraftText,
  inferPatchOperation,
  queueDocumentPatch,
  shouldCreateDocumentPatch,
} from './documentPatchService'
import { callOpenAICompatible, canCallProvider } from './llmClient'
import { retrieveMentionContext } from './projectContext'
import { searchWeb } from './webSearchService'
import { composeWritingTaskPrompt } from './writingTaskTypes'
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

export async function sendCompanionMessage(
  prompt: string,
  harnessInput: Partial<Omit<AgentHarnessRunInput, 'prompt' | 'mode'>> = {},
): Promise<CompanionAgentResult> {
  const content = prompt.trim()

  if (!content) {
    return { reply: '', mode: 'advice' }
  }

  const store = useAppStore.getState()
  const provider = store.providerConfigs[store.activeProviderId]
  const selectedText = store.editorSelectionText.trim()
  const writeIntent = shouldCreateDocumentPatch(content)
  const run = startAgentRun({
    prompt: content,
    mode: 'companion',
    source: harnessInput.source ?? 'local',
    remoteJobId: harnessInput.remoteJobId,
    remotePlatform: harnessInput.remotePlatform,
    remoteSenderId: harnessInput.remoteSenderId,
  })
  const userMessage = store.addCompanionMessage({ role: 'user', content })
  const assistantMessage = store.addCompanionMessage({
    role: 'assistant',
    content: selectedText ? '正在处理选区...' : '正在阅读文稿与资料...',
  })

  store.setCompanionRunState('running')
  store.setLlmRunState('running', '文学秘书正在处理')

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
    useAppStore.getState().setLlmRunState('idle', '文学秘书已完成')

    finishAgentRun(run, {
      status: 'completed',
      response: result.reply,
      patchContent: result.patch?.content ?? result.replacement,
      summary: summarizeCompanionRun(content, result),
    })

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : '文学秘书处理失败'
    useAppStore.getState().updateCompanionMessage(assistantMessage.id, { content: message })
    useAppStore.getState().setCompanionRunState('error')
    useAppStore.getState().setLlmRunState('error', message)
    failAgentRun(run, error)

    return { reply: message, mode: 'advice' }
  } finally {
    if (!userMessage.content.trim()) {
      useAppStore.getState().updateCompanionMessage(userMessage.id, { content })
    }
  }

  async function runSelectedTextAgent(
    instruction: string,
    selection: string,
  ): Promise<CompanionAgentResult> {
    const replacement = await callOrMock(
      [
        companionSystemBase(),
        '用户给出了局部选区和处理指令。',
        '只返回可直接替换选区的正文，不要解释，不要加标题。',
      ].join('\n'),
      [
        composeWritingTaskPrompt(instruction),
        `指令:\n${instruction}`,
        `选区:\n${selection}`,
        await contextBlock(instruction),
      ].join('\n\n'),
      createSelectionMock(selection, instruction),
    )

    const patch = {
      operation: 'replace_selection' as const,
      title: '文学秘书选区改写',
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
    const response = await callOrMock(
      [
        companionSystemBase(),
        '用户希望生成、续写、补写或改写文稿。',
        '输出格式必须是：答复: 一句话说明。然后“正文:”后面给出可写入文稿的内容。',
        '不要把执行过程、来源解释、计划或工具轨迹写入正文。',
      ].join('\n'),
      [composeWritingTaskPrompt(instruction), `指令:\n${instruction}`, await contextBlock(instruction)].join(
        '\n\n',
      ),
      `答复: 已准备好可写入文稿的内容。\n\n正文: ${instruction}`,
    )
    const draft = extractDraftText(response)
    const patch = {
      operation: inferPatchOperation(instruction),
      title: '文学秘书文稿补丁',
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
    const reply = await callOrMock(
      [
        companionSystemBase(),
        '用户现在需要对话式协助：文学常识、写作知识、作文建议、结构诊断、资料整理、文件解读或作业辅导。',
        '只在对话里回答，不要生成文稿补丁。回答要直接、具体、可执行。',
      ].join('\n'),
      [composeWritingTaskPrompt(instruction), `问题:\n${instruction}`, await contextBlock(instruction)].join(
        '\n\n',
      ),
      '我会先判断任务类型，再给出最小可执行建议：概念边界、可用材料、结构路径和下一步写法。',
    )

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
}

function companionSystemBase() {
  return [
    '你是 Papyrus 的文学秘书 Agent。',
    'Papyrus 不是单一网文助手，而是文学、写作、作业、说明文、议论文、记叙文、非虚构与网文连载的全能文字工作台。',
    '你可以解释文学常识、回答写作问题、诊断结构、批改作文、整理素材、搜索资料、解读文件、生成或改写正文。',
    '事实、推断、创作设定和写作建议必须分开。不要编造来源。',
    '当用户要求写作或改写时，保留作者原意和声音；当用户要求知识解释时，先直接回答，再给例子和可迁移写法。',
  ].join('\n')
}

function summarizeCompanionRun(prompt: string, result: CompanionAgentResult) {
  return [
    `Prompt: ${prompt.slice(0, 220)}`,
    `Mode: ${result.mode}`,
    `Reply: ${result.reply.replace(/\s+/g, ' ').slice(0, 360)}`,
    result.patch?.content || result.replacement
      ? `Patch: ${(result.patch?.content ?? result.replacement ?? '').replace(/\s+/g, ' ').slice(0, 220)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function contextBlock(instruction: string) {
  const state = useAppStore.getState()
  const context = composeWritingContext({ includeFullCurrentArticle: true })
  const mentionContext = state.mentionContextItems.length
    ? await retrieveMentionContext(state.mentionContextItems)
    : ''
  const searchContext = shouldSearch(instruction) ? await safeSearch(instruction) : ''

  return [
    context.text,
    mentionContext ? `提及上下文:\n${mentionContext}` : '',
    searchContext ? `联网资料:\n${searchContext}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function shouldSearch(prompt: string) {
  return /(搜索|联网|资料|来源|最新|今天|最近|查证|引用|背景|新闻|政策|现实|例子|案例|research|source|latest)/i.test(
    prompt,
  )
}

async function safeSearch(prompt: string) {
  try {
    const results = await searchWeb(prompt)

    return results
      .slice(0, 5)
      .map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.excerpt}`)
      .join('\n\n')
  } catch (error) {
    return `搜索暂不可用：${error instanceof Error ? error.message : '未知错误'}`
  }
}
