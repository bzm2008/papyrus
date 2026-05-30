import { invoke } from '@tauri-apps/api/core'
import { useAppStore, type MentionContextItem } from '../stores/useAppStore'

const builtInProjectItems: MentionContextItem[] = [
  {
    id: 'chapter-current-draft',
    type: 'chapter',
    label: '当前文稿',
    excerpt: '当前 Tiptap 主编辑区中的完整草稿文本。',
  },
  {
    id: 'world-memory-material-judgment',
    type: 'world',
    label: '记忆、材料与判断',
    excerpt: '围绕记忆如何转化为材料，以及材料如何支撑判断的核心世界观。',
  },
  {
    id: 'character-lead-writer',
    type: 'character',
    label: '主笔',
    excerpt: '负责结构、叙事节奏和最终落笔的调度型写作 Agent。',
  },
  {
    id: 'character-researcher',
    type: 'character',
    label: '寻根',
    excerpt: '负责事实链、来源、概念边界和外部资料检索的小 Agent。',
  },
  {
    id: 'character-critic',
    type: 'character',
    label: '刺客',
    excerpt: '负责拆穿薄弱论证、陈词滥调和逻辑跳跃的小 Agent。',
  },
]

export function searchProjectMentionItems(query: string) {
  const state = useAppStore.getState()
  const dynamicItems = extractDynamicItems(state.editorText)
  const resourceItems = state.resources
    .filter((resource) => resource.type !== 'folder')
    .map<MentionContextItem>((resource) => ({
      id: `resource-${resource.id}`,
      type: 'world',
      label: resource.name,
      excerpt: resource.content.slice(0, 240) || resource.path,
    }))
  const normalizedQuery = query.trim().toLowerCase()

  return [...dynamicItems, ...resourceItems, ...builtInProjectItems]
    .filter((item) => {
      if (!normalizedQuery) {
        return true
      }

      return `${item.label} ${item.excerpt}`.toLowerCase().includes(normalizedQuery)
    })
    .slice(0, 10)
}

export async function retrieveMentionContext(items: MentionContextItem[]) {
  if (!items.length) {
    return ''
  }

  try {
    const result = await invoke<string>('rag_query', {
      mentions: items.map((item) => item.label),
      query: items.map((item) => item.excerpt).join('\n'),
    })

    if (result.trim()) {
      return result.trim()
    }
  } catch {
    // Browser preview and unfinished local vector stores use the lightweight fallback below.
  }

  return items.map((item) => `[${item.type}] ${item.label}\n${item.excerpt}`).join('\n\n')
}

function extractDynamicItems(editorText: string): MentionContextItem[] {
  const lines = editorText.split(/\n+/).filter((line) => line.trim())

  return lines.slice(0, 6).map((line, index) => ({
    id: `chapter-line-${index}`,
    type: 'chapter',
    label: index === 0 ? line.slice(0, 24) : `段落 ${index}`,
    excerpt: line.slice(0, 180),
  }))
}
