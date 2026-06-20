import { composeMemoryContext } from './memoryEngine'
import { composeStoryContext } from './storyEngine'
import { estimateTokens } from './tokenizer'
import { composeTowriteContext } from './towriteService'
import { composeUserMemoryContext } from './userMemoryService'
import { composeWritingKnowledgeContext } from './writingKnowledgeService'
import { useAppStore, type ArticleRecord } from '../stores/useAppStore'

export type WritingContextBundle = {
  text: string
  chatArticles: ArticleRecord[]
  tokenEstimate: number
}

export function composeWritingContext(options: { includeFullCurrentArticle?: boolean } = {}) {
  const state = useAppStore.getState()
  const activeChat = state.chatSessions.find((chat) => chat.id === state.activeChatId)
  const articleIds = new Set(
    [
      ...(activeChat?.articleIds ?? []),
      activeChat?.articleId,
      activeChat?.activeArticleId,
      state.activeArticleId,
    ].filter(Boolean) as string[],
  )
  const chatArticles = state.articles.filter(
    (article) => article.chatId === state.activeChatId || articleIds.has(article.id),
  )
  const currentArticle = chatArticles.find((article) => article.id === state.activeArticleId)
  const otherArticles = chatArticles.filter((article) => article.id !== state.activeArticleId)
  const resources = state.resources
    .filter((resource) => resource.content && resource.includedInContext)
    .slice(0, 8)
    .map((resource) => `[${resource.name}]\n${resource.content.slice(0, 1200)}`)
    .join('\n\n')
  const recentMessages = state.flowMessages
    .slice(-10)
    .map((message) => `${message.role}: ${message.content.slice(0, 1000)}`)
    .join('\n')
  const articleSummaries = otherArticles
    .slice(0, 12)
    .map((article) => `[${article.title}]\n${article.text.slice(0, 1600)}`)
    .join('\n\n')
  const storyContext = composeStoryContext()
  const memoryQuery = [
    state.editorText.slice(0, 1200),
    state.flowMessages.slice(-4).map((message) => message.content).join('\n'),
    state.companionMessages.slice(-4).map((message) => message.content).join('\n'),
    state.projectGuidance.style,
    state.projectGuidance.world,
  ].join('\n')
  const memoryContext = composeMemoryContext(memoryQuery, {
    chatId: state.activeChatId,
    projectId: state.activeStoryProjectId,
    limit: 6,
    includeTentative: true,
  })
  const userMemoryContext = composeUserMemoryContext()
  const towriteContext = composeTowriteContext()
  const writingKnowledgeContext = composeWritingKnowledgeContext(memoryQuery, 8)
  const longTermSections = [
    userMemoryContext ? `User Memory:\n${userMemoryContext}` : '',
    towriteContext ? `towrite.md:\n${towriteContext}` : '',
    state.projectGuidance.style ? `STYLE.md:\n${state.projectGuidance.style}` : '',
    state.projectGuidance.world ? `WORLD.md:\n${state.projectGuidance.world}` : '',
    state.negativeMemories.length ? `负向记忆:\n${state.negativeMemories.join('\n')}` : '',
    writingKnowledgeContext.text ? `Writing Knowledge:\n${writingKnowledgeContext.text}` : '',
    memoryContext.text ? `Agent Memory:\n${memoryContext.text}` : '',
    storyContext ? `Story System:\n${storyContext}` : '',
  ].filter(Boolean)
  const shortTermSections = [
    currentArticle
      ? `当前文章:\n${
          options.includeFullCurrentArticle ? currentArticle.text : currentArticle.text.slice(0, 7000)
        }`
      : `当前文稿:\n${state.editorText.slice(0, 7000)}`,
    articleSummaries ? `同一对话下的其他文章:\n${articleSummaries}` : '',
    resources ? `导入资料:\n${resources}` : '',
    recentMessages ? `最近对话:\n${recentMessages}` : '',
    state.compressedSummary ? `压缩摘要:\n${state.compressedSummary}` : '',
  ].filter(Boolean)
  const sections = [
    longTermSections.length ? `长期记忆与项目规则\n${longTermSections.join('\n\n---\n\n')}` : '',
    shortTermSections.length ? `短期工作现场\n${shortTermSections.join('\n\n---\n\n')}` : '',
  ].filter(Boolean)
  const text = sections.join('\n\n---\n\n')

  return {
    text,
    chatArticles,
    tokenEstimate: estimateTokens(text),
  } satisfies WritingContextBundle
}
