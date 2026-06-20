import {
  BookOpenText,
  FilePenLine,
  Flag,
  Globe2,
  Gauge,
  ListChecks,
  MessageSquareText,
  NotebookPen,
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
    id: 'knowledge',
    label: '文学常识',
    description: '解释概念、流派、修辞和写作知识。',
    prompt:
      '请用文学秘书模式回答：先直接解释这个文学或写作概念，再给出例子、常见误区和可迁移到写作中的方法。',
    icon: MessageSquareText,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'research',
    label: '联网资料',
    description: '搜索资料、整理来源、提炼可写素材。',
    prompt:
      '请在需要时联网搜索资料，区分可靠信息、待核实线索、可写材料和引用风险，并给出适合写入文章的素材摘要。',
    icon: Globe2,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'continue',
    label: '续写',
    description: '沿着当前文稿继续写一段。',
    prompt:
      '续写当前文稿，保持已有语气、节奏和信息密度。需要写入文稿时，请把正文作为文稿补丁输出。',
    icon: FilePenLine,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'rewrite-selection',
    label: '改选区',
    description: '选中文本后按指令替换。',
    prompt: '改写选中文本，保留原意和作者声音，让句子更清楚、更有节奏。',
    icon: Sparkles,
    scopes: ['companion'],
  },
  {
    id: 'essay-upgrade',
    label: '作文升格',
    description: '提升立意、结构、细节和表达。',
    prompt:
      '请对当前作文进行升格：保留原意，优化立意、结构、细节、论证或说明顺序，并列出修改依据。',
    icon: Wand2,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'narrative',
    label: '记叙素材',
    description: '事件、细节、转折和首尾照应。',
    prompt:
      '请为记叙文准备素材：给出可写事件、细节描写、人物动作、环境烘托、转折位置和首尾照应方式。',
    icon: Sparkles,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'expository',
    label: '说明结构',
    description: '对象、特征、顺序、方法和例子。',
    prompt:
      '请为说明文建立结构：明确说明对象、核心特征、说明顺序、说明方法、生活案例和语言准确性注意点。',
    icon: BookOpenText,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'argument',
    label: '议论文论证',
    description: '论点、论据、反驳和段落闭环。',
    prompt:
      '请为议论文锻造论证：给出中心命题、递进分论点、事实论据、道理论据、反方观点与回应方式。',
    icon: SearchCheck,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'commentary',
    label: '评论写作',
    description: '事实、判断、价值尺度和反例。',
    prompt:
      '请按评论写作处理：区分事实、判断和价值尺度，给出核心观点、材料分析、反例风险和可写段落。',
    icon: SearchCheck,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'story-init',
    label: '小说设定',
    description: '作品圣经、题材包、主角和冲突。',
    prompt:
      '请为这个作品执行深度初始化：建立作品圣经、题材类型、目标规模、主角欲望与缺陷、核心冲突、世界观规则、读者承诺，并给出第一卷规划。',
    icon: BookOpenText,
    scopes: ['flow'],
  },
  {
    id: 'write-chapter',
    label: '章节生成',
    description: '按任务书、审查、提交链写一章。',
    prompt:
      '请按 Papyrus Story System 写下一章：先建立章节合同和写作任务书，再起草、审查、二稿，最后生成可写入文稿的正文。',
    icon: FilePenLine,
    scopes: ['flow'],
  },
  {
    id: 'story-health',
    label: '连载体检',
    description: '章节库存、伏笔、读者承诺和节奏风险。',
    prompt:
      '请打开或总结连载控制台：章节提交链、开放式伏笔、读者承诺、角色状态、节奏风险和发布准备度。',
    icon: Gauge,
    scopes: ['flow'],
  },
  {
    id: 'outline',
    label: '结构诊断',
    description: '拆解大纲、段落、场景或论证结构。',
    prompt:
      '请诊断当前文稿结构：指出目标、阻力、转折、后果或论证闭环中的问题，并给出可执行改法。',
    icon: ListChecks,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'polish',
    label: '润色降噪',
    description: '清理 AI 腔、空泛表达和病句。',
    prompt:
      '润色这段文字：保留作者原意和声音，让表达更自然、克制、有文学质感，并减少模板感。',
    icon: Wand2,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'final-pass',
    label: '终校清稿',
    description: '错别字、病句、标点和术语一致性。',
    prompt:
      '请做终校清稿：检查错别字、病句、标点、术语一致性、重复表达和可能的误读，并给出清稿版本。',
    icon: SearchCheck,
    scopes: ['companion', 'flow'],
  },
  {
    id: 'advice',
    label: '只给建议',
    description: '只在聊天里回答，不写入文稿。',
    prompt:
      '只给我写作建议，不要写入文稿。请指出最值得修改的问题，并给出下一步做法。',
    icon: MessageSquareText,
    scopes: ['companion'],
  },
  {
    id: 'plan',
    label: '规划',
    description: '先生成规划书，确认后再执行。',
    prompt:
      '请先生成一份可协商的执行规划书，等待用户确认后再开始执行。规划应包含目标、步骤、风险和需要用户确认的点。',
    icon: NotebookPen,
    scopes: ['flow'],
  },
  {
    id: 'goal',
    label: '目标',
    description: '长篇写作、连续章节或研究报告的长程目标模式。',
    prompt:
      '进入目标模式：请建立长程写作目标、验收标准、阶段计划和裁判检查机制。裁判确认完成前，不要把任务视为结束。',
    icon: Flag,
    scopes: ['flow'],
  },
  {
    id: 'solo',
    label: '自主执行',
    description: '让秘书长规划、调度工作室 Agent 并完成结果。',
    prompt:
      '进入秘书模式自动执行：请自主规划、调查、立大纲、初稿、审查、再稿，并给出完整可用结果。',
    icon: ListChecks,
    scopes: ['flow'],
  },
]

export function applySlashCommand(value: string, command: SlashCommand) {
  const query = getSlashQuery(value)
  const token = `/${command.id} `

  if (query === null) {
    return token
  }

  const index = value.lastIndexOf('/')
  const prefix = value.slice(0, index)
  const suffix = value.slice(index + query.length + 1)
  const glue = prefix && !prefix.endsWith('\n') ? '\n' : ''

  return `${prefix}${glue}${token}${suffix.trimStart()}`.trimStart()
}

export function getSlashQuery(value: string) {
  const match = value.match(/(?:^|\n)\/([\p{L}\p{N}_-]*)$/u)
  return match ? match[1] : null
}

export function resolveSlashCommandPrompt(value: string) {
  const trimmed = value.trim()
  const match = trimmed.match(/^\/([\p{L}\p{N}_-]+)(?:\s+([\s\S]*))?$/u)

  if (!match) {
    return {
      displayPrompt: trimmed,
      executionPrompt: trimmed,
      command: undefined,
      isPlanCommand: false,
      isGoalCommand: false,
      argumentsText: '',
    }
  }

  const command = slashCommands.find((item) => item.id === match[1])
  const argumentsText = match[2]?.trim() ?? ''

  if (!command) {
    return {
      displayPrompt: trimmed,
      executionPrompt: trimmed,
      command: undefined,
      isPlanCommand: false,
      isGoalCommand: false,
      argumentsText,
    }
  }

  const executionPrompt = [command.prompt, argumentsText]
    .filter(Boolean)
    .join('\n\n用户补充：')

  return {
    displayPrompt: trimmed,
    executionPrompt,
    command,
    isPlanCommand: command.id === 'plan',
    isGoalCommand: command.id === 'goal',
    argumentsText,
  }
}
