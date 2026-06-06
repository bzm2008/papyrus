export type WritingTaskType =
  | 'novel'
  | 'narrative'
  | 'expository'
  | 'argumentative'
  | 'commentary'
  | 'prose'
  | 'knowledge'
  | 'research'

export type WritingTaskPreset = {
  id: WritingTaskType
  label: string
  description: string
  prompt: string
  checks: string[]
}

export const writingTaskPresets: Record<WritingTaskType, WritingTaskPreset> = {
  novel: {
    id: 'novel',
    label: '网文与长篇小说',
    description: '章节生产、角色推进、伏笔回收和连载节奏。',
    prompt: '按长篇小说任务处理：先明确章节目标、人物行动、冲突升级、读者承诺和伏笔风险，再给出可写入正文或连载计划。',
    checks: ['人物动机稳定', '情节有因果推进', '章节结尾有承诺或变化', '不违背已有设定'],
  },
  narrative: {
    id: 'narrative',
    label: '记叙文',
    description: '事件选择、细节描写、首尾照应和立意升格。',
    prompt: '按记叙文任务处理：围绕一个具体事件建立起因、经过、转折和余波，细节要服务立意，不写空泛抒情。',
    checks: ['事件具体', '细节可感', '转折自然', '结尾回扣立意'],
  },
  expository: {
    id: 'expository',
    label: '说明文',
    description: '说明对象、顺序、方法、例子和准确表达。',
    prompt: '按说明文任务处理：明确说明对象、核心特征、说明顺序、说明方法和可验证例子，语言准确克制。',
    checks: ['对象明确', '顺序清楚', '方法合适', '术语准确'],
  },
  argumentative: {
    id: 'argumentative',
    label: '议论文',
    description: '中心论点、分论点、证据链和反驳预案。',
    prompt: '按议论文任务处理：先压缩中心命题，再组织分论点、论据、解释路径、反方观点和回扣句。',
    checks: ['命题可争辩', '证据能支撑判断', '解释不是重复观点', '反驳有对象'],
  },
  commentary: {
    id: 'commentary',
    label: '评论与批评',
    description: '观点判断、材料辨析、价值尺度和风险说明。',
    prompt: '按评论任务处理：区分事实、判断和价值尺度，给出可争辩观点、材料分析、限制条件和反例。',
    checks: ['事实与判断分开', '尺度明确', '有反例意识', '语言不过度绝对'],
  },
  prose: {
    id: 'prose',
    label: '散文',
    description: '经验、意象、节奏、转折和克制收束。',
    prompt: '按散文任务处理：从具体经验进入，保持意象和判断的张力，避免空泛抒情和廉价升华。',
    checks: ['经验真实', '意象不堆砌', '节奏有变化', '收束克制'],
  },
  knowledge: {
    id: 'knowledge',
    label: '文学常识与写作问答',
    description: '概念解释、文学史常识、写作知识和作业答疑。',
    prompt: '按知识问答任务处理：先直接回答，再解释概念边界、常见误区和可用于写作的例子。',
    checks: ['回答直接', '概念边界清楚', '例子可迁移', '不编造来源'],
  },
  research: {
    id: 'research',
    label: '资料搜集',
    description: '联网检索、文件引用、素材整理和事实核验。',
    prompt: '按资料搜集任务处理：区分可靠信息、待核实线索、可写材料和引用风险；需要实时信息时主动搜索。',
    checks: ['来源可追踪', '事实不混同推断', '材料能服务写作', '标明不确定性'],
  },
}

export function inferWritingTaskType(prompt: string): WritingTaskType {
  if (/小说|章节|连载|角色|剧情|伏笔|网文|长篇|设定/.test(prompt)) return 'novel'
  if (/记叙文|叙事|经历|事件|首尾照应/.test(prompt)) return 'narrative'
  if (/说明文|说明对象|说明方法|科普|介绍/.test(prompt)) return 'expository'
  if (/议论文|论点|论据|论证|反驳|分论点/.test(prompt)) return 'argumentative'
  if (/评论|批评|影评|书评|时评|观点/.test(prompt)) return 'commentary'
  if (/散文|随笔|抒情|意象/.test(prompt)) return 'prose'
  if (/常识|解释|什么是|怎么理解|答疑|作业/.test(prompt)) return 'knowledge'
  if (/搜索|资料|来源|引用|查证|联网|素材/.test(prompt)) return 'research'

  return 'knowledge'
}

export function composeWritingTaskPrompt(prompt: string) {
  const preset = writingTaskPresets[inferWritingTaskType(prompt)]

  return [
    `任务类型: ${preset.label}`,
    preset.prompt,
    `验收标准: ${preset.checks.join('；')}`,
  ].join('\n')
}
