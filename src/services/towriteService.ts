import { useAppStore, type ProjectWritingMemory } from '../stores/useAppStore'
import { inferUserMemoryCategory } from './userMemoryService'

export function composeTowriteContext() {
  const state = useAppStore.getState()
  const sections = [
    state.globalTowriteMarkdown.trim()
      ? `全局 towrite.md:\n${state.globalTowriteMarkdown.trim()}`
      : '',
    state.projectTowriteMarkdown.trim()
      ? `项目 towrite.md:\n${state.projectTowriteMarkdown.trim()}`
      : '',
  ].filter(Boolean)

  return sections.join('\n\n---\n\n')
}

export function appendToTowrite(scope: 'global' | 'project', title: string, content: string) {
  const state = useAppStore.getState()
  const block = [`\n## ${title.trim() || '记忆'}`, content.trim()].filter(Boolean).join('\n\n')

  if (scope === 'global') {
    state.setGlobalTowriteMarkdown(`${state.globalTowriteMarkdown.trim()}\n${block}`.trim())
    return
  }

  state.setProjectTowriteMarkdown(`${state.projectTowriteMarkdown.trim()}\n${block}`.trim())
}

export function syncTowriteToMemory() {
  const state = useAppStore.getState()
  const globalItems = parseMarkdownMemoryItems(state.globalTowriteMarkdown)
  const projectItems = parseMarkdownMemoryItems(state.projectTowriteMarkdown)

  for (const item of globalItems) {
    state.upsertUserMemoryRecord({
      category: inferUserMemoryCategory(item.content),
      content: item.content,
      source: 'towrite',
      enabled: true,
      confidence: 0.82,
    })
  }

  for (const item of projectItems) {
    state.upsertProjectWritingMemory({
      title: item.title,
      content: item.content,
      tags: inferProjectTags(item.content),
      enabled: true,
      source: 'towrite',
      projectId: state.activeStoryProjectId,
      chatId: state.activeChatId,
    })
  }
}

export function acceptTowriteSuggestion(id: string) {
  const state = useAppStore.getState()
  const suggestion = state.towriteSuggestions.find((item) => item.id === id)

  if (!suggestion || suggestion.status !== 'pending') {
    return
  }

  appendToTowrite(suggestion.scope, suggestion.title, `- ${suggestion.content}`)
  state.updateTowriteSuggestion(id, { status: 'accepted' })

  if (suggestion.scope === 'global') {
    state.upsertUserMemoryRecord({
      category: inferUserMemoryCategory(suggestion.content),
      content: suggestion.content,
      source: 'towrite',
      enabled: true,
      confidence: 0.82,
    })
  } else {
    state.upsertProjectWritingMemory({
      title: suggestion.title,
      content: suggestion.content,
      tags: inferProjectTags(suggestion.content),
      enabled: true,
      source: 'towrite',
      projectId: state.activeStoryProjectId,
      chatId: state.activeChatId,
    })
  }
}

export function rejectTowriteSuggestion(id: string) {
  useAppStore.getState().updateTowriteSuggestion(id, { status: 'rejected' })
}

function parseMarkdownMemoryItems(markdown: string): Array<Pick<ProjectWritingMemory, 'title' | 'content'>> {
  const lines = markdown.split(/\r?\n/)
  const items: Array<Pick<ProjectWritingMemory, 'title' | 'content'>> = []
  let currentTitle = 'towrite.md'

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/)
    if (heading) {
      currentTitle = heading[1].trim()
      continue
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)/)
    if (bullet?.[1]?.trim()) {
      items.push({ title: currentTitle, content: bullet[1].trim() })
    }
  }

  return items.slice(0, 80)
}

function inferProjectTags(content: string) {
  const tags: string[] = []

  if (/(人物|角色|主角|配角|对白|口吻)/.test(content)) tags.push('character')
  if (/(设定|世界观|地点|时间线|规则)/.test(content)) tags.push('world')
  if (/(论点|观点|证据|引用|来源|资料)/.test(content)) tags.push('research')
  if (/(风格|文风|语气|节奏)/.test(content)) tags.push('style')
  if (/(伏笔|悬念|开放问题|待解决)/.test(content)) tags.push('open-loop')

  return tags.length ? tags : ['towrite']
}
