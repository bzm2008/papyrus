import { invoke } from '@tauri-apps/api/core'
import { agentSkills } from './agentSkillLibrary'
import { useAppStore, type MentionContextItem } from '../stores/useAppStore'

const builtInProjectItems: MentionContextItem[] = [
  {
    id: 'chapter-current-draft',
    type: 'chapter',
    label: '当前文稿',
    excerpt: '主编辑区中正在写作的完整草稿文本。',
  },
  {
    id: 'world-literary-workbench',
    type: 'world',
    label: '文学工作台',
    excerpt: 'Papyrus 面向小说、作文、说明文、议论文、评论、散文、文学常识和资料搜集的统一写作工作台。',
  },
  {
    id: 'character-lead-writer',
    type: 'character',
    label: '主笔',
    excerpt: '负责理解目标、拆解任务、协调子 Agent，并把结果整合成可直接使用的文本。',
  },
  {
    id: 'character-researcher',
    type: 'character',
    label: '检索',
    excerpt: '负责事实链、来源、概念边界、外部资料和项目文件检索。',
  },
  {
    id: 'character-critic',
    type: 'character',
    label: '审校',
    excerpt: '负责发现薄弱论证、结构断裂、事实风险、文风噪声和表达问题。',
  },
]

export function searchProjectMentionItems(query: string) {
  const state = useAppStore.getState()
  const dynamicItems = extractDynamicItems(state.editorText)
  const resourceItems = state.resources
    .filter((resource) => resource.type !== 'folder')
    .map<MentionContextItem>((resource) => ({
      id: `resource-${resource.id}`,
      type: 'file',
      label: resource.name,
      excerpt: resource.content.slice(0, 1200) || resource.path,
    }))
  const skillItems = Object.values(agentSkills).map<MentionContextItem>((skill) => ({
    id: `skill-${skill.id}`,
    type: 'skill',
    label: skill.name,
    excerpt: [skill.trigger, ...skill.instructions.slice(0, 3)].join('\n'),
  }))
  const normalizedQuery = query.trim().toLowerCase()

  return [...dynamicItems, ...resourceItems, ...skillItems, ...builtInProjectItems]
    .filter((item) => {
      if (!normalizedQuery) {
        return true
      }

      return `${item.label} ${item.excerpt}`.toLowerCase().includes(normalizedQuery)
    })
    .slice(0, 12)
}

export function searchFileMentionItems(query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  return useAppStore
    .getState()
    .resources.filter((resource) => resource.type !== 'folder')
    .filter((resource) => {
      if (!normalizedQuery) {
        return true
      }

      return `${resource.name} ${resource.path}`.toLowerCase().includes(normalizedQuery)
    })
    .slice(0, 12)
    .map<MentionContextItem>((resource) => ({
      id: `resource-${resource.id}`,
      type: 'file',
      label: resource.name,
      excerpt: resource.content.slice(0, 1600) || resource.path,
    }))
}

export async function retrieveMentionContext(items: MentionContextItem[]) {
  if (!items.length) {
    return ''
  }

  const directContext = items
    .filter((item) => item.type === 'file' || item.type === 'skill')
    .map(formatMentionItem)
    .join('\n\n')

  try {
    const result = await invoke<string>('rag_query', {
      mentions: items.map((item) => item.label),
      query: items.map((item) => item.excerpt).join('\n'),
    })

    if (result.trim()) {
      return [directContext, result.trim()].filter(Boolean).join('\n\n')
    }
  } catch {
    // Browser preview and unfinished local vector stores use the lightweight fallback below.
  }

  return items.map(formatMentionItem).join('\n\n')
}

function extractDynamicItems(editorText: string): MentionContextItem[] {
  const lines = editorText.split(/\n+/).filter((line) => line.trim())

  return lines.slice(0, 6).map((line, index) => ({
    id: `chapter-line-${index}`,
    type: 'chapter',
    label: index === 0 ? line.slice(0, 24) : `段落 ${index}`,
    excerpt: line.slice(0, 240),
  }))
}

function formatMentionItem(item: MentionContextItem) {
  const labels: Record<MentionContextItem['type'], string> = {
    chapter: '文稿',
    character: '角色',
    world: '设定',
    file: '文件',
    skill: '技能',
  }

  return `[${labels[item.type]}] ${item.label}\n${item.excerpt}`
}
