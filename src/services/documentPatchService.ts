import type { DocumentPatchOperation } from '../stores/useAppStore'
import { useAppStore } from '../stores/useAppStore'

type CreatePatchInput = {
  operation: DocumentPatchOperation
  title: string
  content: string
  chapterId?: string
  commitIntent?: boolean
  memoryExtractionRequired?: boolean
  targetArticleId?: string
  targetChatId?: string
  createArticle?: boolean
}

const writeIntentPattern =
  /(写|写个|写一|写篇|写部|写成|写出|写下|创作|生成|起草|成稿|草稿|初稿|再稿|正文|文稿|文章|小说|中篇|长篇|章节|续写|补写|扩写|改写|重写|插入|写入|放进|放到|加入文稿|更新文稿|替换|完整章节|完整结果|append|insert|replace|draft|rewrite|continue|write|novel|chapter)/i

export function queueDocumentPatch(input: CreatePatchInput) {
  const content = input.content.trim()

  if (!content) {
    return
  }

  useAppStore.getState().setPendingDocumentPatch({
      operation: input.operation,
      title: input.title,
      content,
      chapterId: input.chapterId,
      commitIntent: input.commitIntent,
      memoryExtractionRequired: input.memoryExtractionRequired,
      targetArticleId: input.targetArticleId,
      targetChatId: input.targetChatId,
      createArticle: input.createArticle,
    })

  useAppStore.getState().addFlowTrace({
    kind: 'document',
    title: '准备写入文稿',
    detail: `${input.title}: ${content.slice(0, 160)}`,
    status: 'running',
    toolName: 'document.patch',
  })
}

export function approveDocumentPatch() {
  useAppStore.getState().markDocumentPatch('approved')
}

export function rejectDocumentPatch() {
  useAppStore.getState().markDocumentPatch('rejected')
  useAppStore.getState().addFlowTrace({
    kind: 'document',
    title: '已拒绝写入',
    detail: '用户没有把本次正文补丁写入文稿。',
    status: 'completed',
    toolName: 'document.patch',
    endedAt: Date.now(),
  })
}

export function shouldCreateDocumentPatch(prompt: string) {
  return writeIntentPattern.test(prompt)
}

export function shouldCreateArticleFromPrompt(prompt: string) {
  return /(新文章|新建文章|另起|单独成篇|新篇|完整小说|中篇|长篇|成书|完整章节|完整结果|new article|new document|novel|longform)/i.test(
    prompt,
  )
}

export function inferPatchOperation(prompt: string): DocumentPatchOperation {
  if (/(替换全文|重写全文|整篇替换|replace document)/i.test(prompt)) {
    return 'replace_document'
  }

  if (/(替换选区|替换这段|改掉选中|replace selection)/i.test(prompt)) {
    return 'replace_selection'
  }

  if (/(光标|当前位置|这里|insert at cursor)/i.test(prompt)) {
    return 'insert_at_cursor'
  }

  return 'append_section'
}

export function extractDraftText(response: string) {
  const match =
    response.match(/(?:正文|成稿|写入文稿|Draft)\s*[:：]\s*([\s\S]+)/i) ??
    response.match(/```(?:text|markdown|md)?\s*([\s\S]*?)```/i)

  return (match?.[1] ?? response).trim()
}
