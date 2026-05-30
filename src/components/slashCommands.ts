import {
  BookOpenText,
  FilePenLine,
  Globe2,
  ListChecks,
  MessageSquareText,
  SearchCheck,
  Sparkles,
  Wand2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type SlashCommandScope = 'companion' | 'flow'

export type SlashCommand = {
  id: string
  label: string
  description: string
  prompt: string
  icon: LucideIcon
  scopes: SlashCommandScope[]
}

export const slashCommands: SlashCommand[] = [
  {
    id: 'continue',
    label: '续写',
    description: '沿着当前文稿继续写一段',
    prompt: '续写当前文稿，保持已有语气和节奏。',
    icon: FilePenLine,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'polish',
    label: '润色',
    description: '优化表达，减少生硬感',
    prompt: '润色这段文字，让表达更自然、克制、有文学质感。',
    icon: Wand2,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'review',
    label: '审查',
    description: '指出逻辑、节奏和事实风险',
    prompt: '审查当前文稿，指出最值得修改的问题，并给出可执行建议。',
    icon: SearchCheck,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'outline',
    label: '大纲',
    description: '拆解章节结构和推进顺序',
    prompt: '为这个写作目标制定章节大纲，并说明每一节的叙事功能。',
    icon: BookOpenText,
    scopes: ['flow'],
  },
  {
    id: 'solo',
    label: '自主执行',
    description: '让主笔规划、调度子 Agent 并完成结果',
    prompt: '进入 Auto 执行：请自主规划、调查、立大纲、初稿、审查、再稿，并给出完整可用结果。',
    icon: ListChecks,
    scopes: ['flow'],
  },
  {
    id: 'news',
    label: '联网素材',
    description: '需要实时资料时自动搜索',
    prompt: '请在需要时联网搜索资料，整理来源链路，并基于最新信息完成写作任务。',
    icon: Globe2,
    scopes: ['flow'],
  },
  {
    id: 'advice',
    label: '给建议',
    description: '只在聊天里回复，不写入文稿',
    prompt: '只给我写作建议，不要写入文稿。',
    icon: MessageSquareText,
    scopes: ['companion'],
  },
  {
    id: 'rewrite-selection',
    label: '改选区',
    description: '选中文本后按指令替换',
    prompt: '改写选中文本，保留原意，但让句子更清楚、更有节奏。',
    icon: Sparkles,
    scopes: ['companion'],
  },
]

export function applySlashCommand(value: string, command: SlashCommand) {
  const query = getSlashQuery(value)

  if (query === null) {
    return command.prompt
  }

  const index = value.lastIndexOf('/')
  const prefix = value.slice(0, index)
  const suffix = value.slice(index + query.length + 1)
  const glue = prefix && !prefix.endsWith('\n') ? '\n' : ''

  return `${prefix}${glue}${command.prompt}${suffix ? ` ${suffix.trimStart()}` : ''}`.trimStart()
}

export function getSlashQuery(value: string) {
  const match = value.match(/(?:^|\n)\/([\p{L}\p{N}_-]*)$/u)
  return match ? match[1] : null
}
