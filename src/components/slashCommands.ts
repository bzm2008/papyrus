import {
  BookOpenText,
  FilePenLine,
  Globe2,
  Gauge,
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
    id: 'story-init',
    label: '初始化作品',
    description: '建立作品圣经、题材包、主角和核心冲突',
    prompt:
      '请为这个作品执行深度初始化：建立作品圣经、题材类型、目标规模、主角欲望与缺陷、核心冲突、世界规则、读者承诺，并给出第一卷规划。',
    icon: BookOpenText,
    scopes: ['flow'],
  },
  {
    id: 'volume-plan',
    label: '规划卷纲',
    description: '生成卷级节拍、时间线和章节目标',
    prompt:
      '请基于当前作品记忆规划下一卷：卷目标、节拍表、时间线、章节清单、伏笔埋设与回收安排。',
    icon: ListChecks,
    scopes: ['flow'],
  },
  {
    id: 'write-chapter',
    label: '写章节',
    description: '按合同-任务书-审查-提交链写一章',
    prompt:
      '请按 Papyrus Story System 写下一章：先建立章节合同和写作任务书，再起草、审查、二稿，最后生成可写入文稿的正文。',
    icon: FilePenLine,
    scopes: ['flow'],
  },
  {
    id: 'review-chapter',
    label: '审查章节',
    description: '做设定、时间线、人物、逻辑和 AI 味审查',
    prompt:
      '请审查当前章节：检查设定一致性、时间线、人物动机、因果逻辑、节奏、AI 味，并列出阻断问题和修复建议。',
    icon: SearchCheck,
    scopes: ['flow', 'companion'],
  },
  {
    id: 'query-lore',
    label: '查询设定',
    description: '从作品记忆中查询人物、规则、伏笔和摘要',
    prompt: '请查询当前作品记忆，回答这个设定/人物/伏笔问题：',
    icon: Globe2,
    scopes: ['flow', 'companion'],
  },
  {
    id: 'story-health',
    label: '作品体检',
    description: '查看章节提交、伏笔、节奏和长期记忆',
    prompt: '请打开或总结作品体检：章节提交链、开放伏笔、节奏比例、长期记忆和当前风险。',
    icon: Gauge,
    scopes: ['flow'],
  },
  {
    id: 'middle-school-essay',
    label: '中学作文',
    description: '按记叙文/说明文/议论文生成提纲与正文',
    prompt:
      '请进入中学作文辅助模式：先判断题型，再给出结构、可用素材、避坑提醒，并生成适合中学生的提纲或正文。',
    icon: BookOpenText,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'university-writing',
    label: '大学写作',
    description: '处理大学散文、科普说明、评论与议论文',
    prompt:
      '请进入大学写作辅助模式：先明确问题意识、材料来源和结构，再给出克制、清晰、有论证层次的写作结果。',
    icon: FilePenLine,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'narrative-materials',
    label: '记叙文素材',
    description: '提供细节、场景和首尾照应素材',
    prompt:
      '请为记叙文准备素材：给出可写事件、细节描写、人物动作、环境烘托、首尾照应方式，并避开空泛套话。',
    icon: Sparkles,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'expository-materials',
    label: '说明文素材',
    description: '整理对象特征、说明顺序和说明方法',
    prompt:
      '请为说明文准备素材：明确说明对象、核心特征、说明顺序、说明方法、生活案例和语言准确性注意点。',
    icon: Globe2,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'argument-materials',
    label: '议论文论据',
    description: '生成论点、分论点、事实与道理论据',
    prompt:
      '请为议论文准备论据：给出中心论点、递进分论点、事实论据、道理论据、反方观点与回应方式。',
    icon: SearchCheck,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'essay-upgrade',
    label: '作文升格',
    description: '把普通作文改成更高分的结构和表达',
    prompt:
      '请对当前作文进行升格：保留原意，优化立意、结构、细节、论证或说明顺序，并列出修改依据。',
    icon: Wand2,
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
