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
  /(写|写一|写个|写成|写出|写下|创作|生成|起草|成稿|草稿|初稿|正文|文稿|文章|小说|中篇|长篇|章节|续写|补写|扩写|改写|重写|插入|写入|放进|放到|加入文稿|更新文稿|替换|完整章节|完整结果|append|insert|replace|draft|rewrite|continue|write|novel|chapter)/i

const reviewOnlyPattern =
  /(?:审阅|审查|检查|评审|评估|点评|批评|找问题|问题清单|review|critique|proofread|check|evaluate|assess)/i

const explicitRewritePattern =
  /(?:重写|改写|润色|修订|改成|替换|插入|写入|生成|起草|补写|续写|扩写|rewrite|revise|polish|replace|insert|draft|write)/i

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
  if (isReviewOnlyRequest(prompt)) {
    return false
  }

  return writeIntentPattern.test(prompt)
}

/**
 * Resolve a model-proposed write intent against the local safety boundary. A review-only request
 * is never allowed to become a document patch merely because the model or a broad article noun
 * requested one.
 */
export function resolveDocumentWriteIntent(prompt: string, requested = false) {
  if (isReviewOnlyRequest(prompt)) {
    return false
  }

  return requested || shouldCreateDocumentPatch(prompt)
}

export function isReviewOnlyRequest(prompt: string) {
  return reviewOnlyPattern.test(prompt) && !explicitRewritePattern.test(prompt)
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
