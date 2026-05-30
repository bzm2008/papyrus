import { composeStoryContext } from './storyEngine'
import { estimateTokens } from './tokenizer'
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
    .filter((resource) => resource.content)
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
  const sections = [
    state.projectGuidance.style ? `STYLE.md:\n${state.projectGuidance.style}` : '',
    state.projectGuidance.world ? `WORLD.md:\n${state.projectGuidance.world}` : '',
    state.negativeMemories.length ? `负向记忆:\n${state.negativeMemories.join('\n')}` : '',
    currentArticle
      ? `当前文章:\n${
          options.includeFullCurrentArticle ? currentArticle.text : currentArticle.text.slice(0, 7000)
        }`
      : `当前文稿:\n${state.editorText.slice(0, 7000)}`,
    articleSummaries ? `同一聊天下的其他文章:\n${articleSummaries}` : '',
    storyContext ? `Story System:\n${storyContext}` : '',
    resources ? `导入资料:\n${resources}` : '',
    recentMessages ? `最近对话:\n${recentMessages}` : '',
    state.compressedSummary ? `压缩摘要:\n${state.compressedSummary}` : '',
  ].filter(Boolean)
  const text = sections.join('\n\n---\n\n')

  return {
    text,
    chatArticles,
    tokenEstimate: estimateTokens(text),
  } satisfies WritingContextBundle
}
