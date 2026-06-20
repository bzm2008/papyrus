import { useAppStore, type DocumentPatch, type DocumentPatchOperation } from '../stores/useAppStore'

export type DocumentChangeInput = {
  patch: DocumentPatch
  beforeText: string
  afterText: string
  replacedText?: string
  agentRunId?: string
}

export function recordDocumentChange(input: DocumentChangeInput) {
  const { patch, beforeText, afterText, replacedText, agentRunId } = input
  const stat = calculateDocumentChange({
    operation: patch.operation,
    insertedText: insertedTextForPatch(patch, afterText, beforeText),
    beforeText,
    afterText,
    replacedText,
  })
  const state = useAppStore.getState()

  return state.recordDocumentChangeStat({
    chatId: patch.targetChatId ?? state.activeChatId,
    articleId: patch.targetArticleId ?? state.activeArticleId,
    agentRunId: agentRunId ?? state.activeAgentRunId,
    patchId: patch.id,
    title: patch.title,
    operation: patch.operation,
    ...stat,
  })
}

export function calculateDocumentChange(input: {
  operation: DocumentPatchOperation
  insertedText: string
  beforeText: string
  afterText: string
  replacedText?: string
}) {
  const insertedChars =
    input.operation === 'replace_document'
      ? countWritingChars(input.afterText)
      : countWritingChars(input.insertedText)
  const deletedChars =
    input.operation === 'replace_document'
      ? countWritingChars(input.beforeText)
      : input.operation === 'replace_selection'
        ? countWritingChars(input.replacedText ?? '')
        : 0

  return {
    insertedChars,
    deletedChars,
    changedChars: insertedChars + deletedChars,
  }
}

export function getConversationChangeTotal(chatId?: string) {
  const state = useAppStore.getState()
  const targetChatId = chatId ?? state.activeChatId

  return state.documentChangeStats
    .filter((stat) => stat.chatId === targetChatId)
    .reduce((sum, stat) => sum + stat.changedChars, 0)
}

export function getLatestChangeForRun(agentRunId?: string) {
  const state = useAppStore.getState()

  if (!agentRunId) {
    return state.documentChangeStats[0]
  }

  return state.documentChangeStats.find((stat) => stat.agentRunId === agentRunId)
}

export function formatChangeStat(insertedChars: number, deletedChars: number) {
  const parts = []
  if (insertedChars) parts.push(`新增 ${insertedChars} 字`)
  if (deletedChars) parts.push(`删除 ${deletedChars} 字`)
  return parts.length ? parts.join('，') : '未改变正文'
}

function insertedTextForPatch(patch: DocumentPatch, afterText: string, beforeText: string) {
  if (patch.operation === 'replace_document') {
    return afterText
  }

  if (afterText.length > beforeText.length) {
    return patch.content
  }

  return patch.content
}

function countWritingChars(value: string) {
  return Array.from(value.replace(/\s+/g, '')).length
}
