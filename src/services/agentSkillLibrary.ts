import { useAppStore, type CustomAgentSkill, type FlowAgentId } from '../stores/useAppStore'

export type AgentSkillId =
  | 'literary-drafting'
  | 'structure-room'
  | 'research-and-critique'
  | 'style-continuity'
  | 'copyediting-final-pass'
  | 'archival-memory'
  | 'humanities-argument'
  | 'character-voice'
  | 'scene-cinematography'
  | 'publication-polish'

export type AgentSkill = {
  id: string
  name: string
  shortName: string
  trigger: string
  agents: FlowAgentId[]
  keywords: RegExp
  instructions: string[]
  outputRules: string[]
}

export type ResolvedAgentSkill = AgentSkill & {
  custom?: boolean
  keywordTerms?: string[]
}

export const agentSkills: Record<AgentSkillId, AgentSkill> = {
  'literary-drafting': {
    id: 'literary-drafting',
    name: '文学正文起草',
    shortName: '正文起草',
    trigger: '续写、扩写、改写、生成正文、把想法落成段落时使用。',
    agents: ['writer', 'stylist', 'dramatist'],
    keywords: /正文|成稿|写一段|续写|扩写|改写|落笔|写入|插入|段落|章节|作文|文章/,
    instructions: [
      '先判断写作意图：叙事、说明、论证、抒情、人物塑造、场景推进或章节衔接。',
      '正文必须具体，有动作、感官细节、判断推进或可验证材料，不用抽象概念堆叠。',
      '保留作者原声，不把文稿改成营销腔、套路网文腔或过度华丽的展示性辞藻。',
      '需要写入文稿时，把可写入内容放在“正文:”之后，便于文稿补丁提取。',
    ],
    outputRules: [
      '若用户要求写入正文，输出必须包含“正文:”。',
      '不要解释自己是 AI，不要用“以下是”开场。',
    ],
  },
  'structure-room': {
    id: 'structure-room',
    name: '结构诊断室',
    shortName: '结构诊断',
    trigger: '处理大纲、章节节奏、场景推进、人物行动线、叙事张力或文章结构修复时使用。',
    agents: ['writer', 'dramatist', 'critic'],
    keywords: /结构|大纲|章节|节奏|场景|叙事|张力|行动线|转折|铺垫|高潮|承接|开头|结尾/,
    instructions: [
      '把文本拆成目标、阻力、转折、后果四个结构单元。',
      '检查每段是否推动情节、推进论证或改变读者认知；无推进的段落要标出。',
      '给出可执行的章节、场景或段落顺序，不只给抽象建议。',
      '优先修复因果链、视角位置、信息释放顺序和段落承接。',
    ],
    outputRules: [
      '输出“结构判断 / 待修复点 / 可执行改法”。',
      '复杂任务必须给出按顺序执行的步骤。',
    ],
  },
  'research-and-critique': {
    id: 'research-and-critique',
    name: '检索与反证',
    shortName: '检索反证',
    trigger: '涉及事实、来源、资料、联网搜索、反例、漏洞、审查、论证风险时使用。',
    agents: ['researcher', 'critic', 'archivist'],
    keywords: /搜索|联网|资料|来源|事实|引用|查证|核验|反例|漏洞|审查|论证|风险|批判|最新|背景/,
    instructions: [
      '先区分事实、推断、创作设定和作者判断，不把推断伪装成事实。',
      '需要外部资料时调用搜索；批判任务优先寻找反例、争议、边界案例和反方论据。',
      '来源链必须保留标题、链接和摘要；无法确认的内容明确标为“待核实”。',
      '审查时指出问题位置、为什么有问题、如何改，而不只给评价词。',
    ],
    outputRules: [
      '输出“可靠信息 / 风险与反例 / 可用材料 / 待核实”。',
      '引用来源时使用简短标题，不堆砌链接。',
    ],
  },
  'style-continuity': {
    id: 'style-continuity',
    name: '文风连续性',
    shortName: '文风连续',
    trigger: '涉及 STYLE.md、文风、语气、作者原声、节奏、句法、降噪或长期一致性时使用。',
    agents: ['writer', 'stylist', 'proofreader'],
    keywords: /文风|风格|语气|作者原声|节奏|句法|STYLE|降噪|AIGC|润色|统一|像我/,
    instructions: [
      '把 STYLE.md 和负向记忆视为高优先级约束。',
      '识别作者常用句长、转折方式、意象密度和抽象/具体比例。',
      '润色时保留句子的判断结构，不把作者声音抹平。',
      '降噪优先处理模板句、空泛形容词、过度对称排比和廉价总结句。',
    ],
    outputRules: [
      '输出“保留项 / 调整项 / 改写稿”。',
      '不要为了显得文学化而增加不必要的比喻。',
    ],
  },
  'copyediting-final-pass': {
    id: 'copyediting-final-pass',
    name: '终校清稿',
    shortName: '终校',
    trigger: '涉及错别字、病句、术语一致性、重复表达、标点和最终清稿时使用。',
    agents: ['proofreader', 'stylist'],
    keywords: /校对|错别字|病句|纠错|标点|术语|重复|清稿|终校|一致性|语病/,
    instructions: [
      '先做低风险修正：错别字、标点、重复词、搭配不当。',
      '再做中风险修正：病句、指代不清、术语前后不一致。',
      '高风险改写必须说明理由，避免擅自改变含义、节奏或视角。',
      '保留专名、人物语气和特殊句式，除非它明显造成误读。',
    ],
    outputRules: [
      '输出“修改清单 / 清稿版本”。',
      '不确定的地方标为“需作者确认”。',
    ],
  },
  'archival-memory': {
    id: 'archival-memory',
    name: '档案与长期记忆',
    shortName: '档案记忆',
    trigger: '涉及资源树、人物卡、设定卡、摘要、导入资料、上下文压缩或长期记忆时使用。',
    agents: ['archivist', 'researcher'],
    keywords: /资源|文件|导入|设定|世界观|人物卡|记忆|摘要|档案|上下文|压缩|入库|#file/,
    instructions: [
      '把导入资源整理为人物、地点、事件、术语、时间线和待核实事实。',
      '摘要要保留可复用约束，不保留临时寒暄。',
      '人物卡必须包含欲望、恐惧、禁忌、行动习惯和语言习惯。',
      '世界观设定必须区分硬规则、软倾向和未确认假设。',
    ],
    outputRules: [
      '输出“可入库摘要 / 卡片候选 / 未决问题”。',
      '长期记忆只记录会影响未来生成的稳定偏好或事实。',
    ],
  },
  'humanities-argument': {
    id: 'humanities-argument',
    name: '文科论证锻造',
    shortName: '论证锻造',
    trigger: '写议论文、评论、随笔、批评文章、观点段落、材料分析和概念辨析时使用。',
    agents: ['writer', 'critic', 'researcher'],
    keywords: /议论文|评论|观点|论证|概念|辨析|材料分析|命题|反驳|立论|随笔|批评|作文/,
    instructions: [
      '把核心判断压缩成一句可争辩命题，而不是主题词。',
      '为每个判断匹配材料、解释路径、反驳对象和限制条件。',
      '检查概念是否偷换，例证是否只是在重复观点。',
      '段落推进遵循“判断、证据、解释、回扣命题”的最小闭环。',
    ],
    outputRules: [
      '输出“中心命题 / 证据链 / 反驳预案 / 可写段落”。',
      '不要只罗列观点，必须展示推理过程。',
    ],
  },
  'character-voice': {
    id: 'character-voice',
    name: '人物声纹',
    shortName: '人物声纹',
    trigger: '写人物对白、独白、人物卡、口吻统一、人物 OOC 检查时使用。',
    agents: ['dramatist', 'stylist', 'archivist'],
    keywords: /人物|对白|独白|口吻|声纹|人设|OOC|角色|动机|台词/,
    instructions: [
      '先确认人物的欲望、恐惧、遮掩方式、社会位置和说话禁忌。',
      '对白必须让人物试图达成某个目的，而不是解释设定。',
      '人物语言的用词、句长、停顿和回避方式要稳定。',
      '发现 OOC 时指出偏离哪条人设约束，并给出替代写法。',
    ],
    outputRules: [
      '输出“人物约束 / 语言特征 / 对白或改写稿”。',
      '不要让所有角色使用同一种聪明腔。',
    ],
  },
  'scene-cinematography': {
    id: 'scene-cinematography',
    name: '场景镜头调度',
    shortName: '镜头调度',
    trigger: '写场景、动作、空间、氛围、镜头感、转场和戏剧推进时使用。',
    agents: ['dramatist', 'writer'],
    keywords: /场景|动作|空间|氛围|镜头|转场|画面|调度|冲突|戏剧/,
    instructions: [
      '先确认场景目标：揭示信息、制造冲突、改变关系或推进决定。',
      '用空间位置、动作顺序和感官焦点组织段落，不只写心理说明。',
      '每个镜头必须服务人物选择或信息释放。',
      '转场要保留因果或情绪钩子，避免硬切成说明文。',
    ],
    outputRules: [
      '输出“场景目标 / 镜头顺序 / 正文”。',
      '正文里不要写分镜术语，除非用户明确要求。',
    ],
  },
  'publication-polish': {
    id: 'publication-polish',
    name: '发表前编辑',
    shortName: '发表编辑',
    trigger: '投稿、发布、公众号、专栏、标题、摘要、开头结尾和最终润色时使用。',
    agents: ['writer', 'stylist', 'proofreader'],
    keywords: /投稿|发布|发表|专栏|公众号|标题|摘要|开头|结尾|收束|编辑/,
    instructions: [
      '先判断发布场景：文学、评论、学术、专栏、项目说明或公开演讲。',
      '开头要建立问题压力或感知入口，不能只有背景介绍。',
      '结尾要形成判断余波，不用廉价口号或过度升华。',
      '标题应准确、有张力，不做标题党。',
    ],
    outputRules: [
      '输出“标题候选 / 开头修订 / 结尾修订 / 发布风险”。',
      '保留作者立场的复杂度，不把表达压扁成单一卖点。',
    ],
  },
}

export const agentSkillAssignments: Record<FlowAgentId, AgentSkillId[]> = {
  writer: [
    'literary-drafting',
    'structure-room',
    'style-continuity',
    'humanities-argument',
    'publication-polish',
  ],
  researcher: ['research-and-critique', 'archival-memory', 'humanities-argument'],
  critic: ['research-and-critique', 'structure-room', 'humanities-argument'],
  dramatist: ['structure-room', 'literary-drafting', 'character-voice', 'scene-cinematography'],
  stylist: ['style-continuity', 'literary-drafting', 'character-voice', 'publication-polish'],
  proofreader: ['copyediting-final-pass', 'style-continuity', 'publication-polish'],
  archivist: ['archival-memory', 'research-and-critique', 'character-voice'],
}

export function searchAgentSkills(query: string, limit = 8) {
  const normalized = query.trim().toLowerCase()

  return getAllAgentSkills()
    .filter((skill) => {
      if (!normalized) {
        return true
      }

      return `${skill.name} ${skill.shortName} ${skill.trigger} ${skill.id} ${skill.keywordTerms?.join(' ') ?? ''}`
        .toLowerCase()
        .includes(normalized)
    })
    .slice(0, limit)
}

export function findMentionedSkills(prompt: string) {
  return getAllAgentSkills().filter((skill) =>
    new RegExp(`@\\s*${escapeRegExp(skill.name)}|@\\s*${escapeRegExp(skill.shortName)}`).test(
      prompt,
    ),
  )
}

export function inferSkillsForPrompt(prompt: string, agentId?: FlowAgentId) {
  const baseIds = agentId ? agentSkillAssignments[agentId] : []
  const explicitIds = findMentionedSkills(prompt).map((skill) => skill.id)
  const allSkills = getAllAgentSkills()
  const matchedIds = allSkills
    .filter((skill) => skillMatchesPrompt(skill, prompt))
    .map((skill) => skill.id)
  const ids = [...new Set([...explicitIds, ...matchedIds, ...baseIds.slice(0, 2)])]
  const skillById = new Map(allSkills.map((skill) => [skill.id, skill]))

  return ids.map((id) => skillById.get(id)).filter(Boolean) as ResolvedAgentSkill[]
}

export function composeSkillPrompt(agentId: FlowAgentId, prompt = '') {
  const skills = inferSkillsForPrompt(prompt, agentId).slice(0, 5)

  if (!skills.length) {
    return ''
  }

  return [
    'Use the following Skills when they match the task or an explicit @skill mention. Follow their execution and output rules.',
    ...skills.map((skill) =>
      [
        `Skill: ${skill.name}`,
        `Trigger: ${skill.trigger}`,
        'Execution rules:',
        ...skill.instructions.map((instruction) => `- ${instruction}`),
        'Output rules:',
        ...skill.outputRules.map((rule) => `- ${rule}`),
      ].join('\n'),
    ),
  ].join('\n\n')
}

export function formatSkillTrace(prompt: string, agentId?: FlowAgentId) {
  const skills = inferSkillsForPrompt(prompt, agentId).slice(0, 5)

  return {
    names: skills.map((skill) => skill.shortName),
    detail: skills.map((skill) => `${skill.shortName}: ${skill.trigger}`).join('\n'),
  }
}

function getAllAgentSkills(): ResolvedAgentSkill[] {
  return [
    ...Object.values(agentSkills),
    ...useAppStore.getState().customAgentSkills.filter((skill) => skill.enabled).map(resolveCustomSkill),
  ]
}

function resolveCustomSkill(skill: CustomAgentSkill): ResolvedAgentSkill {
  const keywordTerms = splitTerms(skill.keywordsText)

  return {
    id: `custom:${skill.id}`,
    name: skill.name,
    shortName: skill.shortName || skill.name,
    trigger: skill.trigger,
    agents: skill.agents.length ? skill.agents : ['writer'],
    keywords: /$a/,
    keywordTerms,
    instructions: splitLines(skill.instructionsText),
    outputRules: splitLines(skill.outputRulesText),
    custom: true,
  }
}

function skillMatchesPrompt(skill: ResolvedAgentSkill, prompt: string) {
  if (skill.custom) {
    const normalized = prompt.toLowerCase()
    return Boolean(skill.keywordTerms?.some((term) => normalized.includes(term.toLowerCase())))
  }

  skill.keywords.lastIndex = 0
  return skill.keywords.test(prompt)
}

function splitTerms(value: string) {
  return value
    .split(/[\n,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40)
}

function splitLines(value: string) {
  return value
    .split(/\n+/)
    .map((item) => item.trim().replace(/^-\s*/, ''))
    .filter(Boolean)
    .slice(0, 20)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
