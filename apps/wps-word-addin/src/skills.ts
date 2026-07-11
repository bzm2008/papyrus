import type { AgentSkill } from './types'

export const agentSkills: AgentSkill[] = [
  { id: 'literary-drafting', name: '文学正文起草', shortName: '正文', description: '续写、扩写、生成可直接写入 WPS 的正文段落。', systemHint: '先判断写作意图，输出具体、有动作和细节的正文；不要把解释、计划或来源写进正文补丁。', keywords: ['正文', '续写', '扩写', '写入', '段落', '章节', 'draft', 'write'] },
  { id: 'style-continuity', name: '文风连续性', shortName: '润色', description: '改善句法、节奏、语气和表达质感，同时保留作者原意。', systemHint: '保留作者原声和判断结构，只修正表达、结构和细节；避免模板化文学腔。', keywords: ['润色', '风格', '语气', '降噪', 'polish', 'style'] },
  { id: 'copyediting-final-pass', name: '终校清稿', shortName: '校对', description: '检查错别字、病句、标点、重复表达和术语一致性。', systemHint: '先做低风险修正，再指出可能改变含义的高风险改动；不擅自改变专名和人物语气。', keywords: ['校对', '纠错', '错别字', '病句', '标点', 'proof'] },
  { id: 'structure-room', name: '结构诊断', shortName: '结构', description: '处理大纲、段落顺序、论证推进、叙事节奏和承接问题。', systemHint: '把文本拆成目标、阻力、转折、后果或论点、证据、解释、回扣，给出可执行调整。', keywords: ['结构', '大纲', '节奏', '承接', '论证', 'outline'] },
  { id: 'research-and-critique', name: '检索与反证', shortName: '核查', description: '处理事实、来源、引用、反例、逻辑漏洞和风险提示。', systemHint: '区分事实、推断和创作设定；没有可靠材料时明确标注待核实，不编造来源。', keywords: ['资料', '来源', '事实', '引用', '核实', '风险', 'research'] },
  { id: 'humanities-argument', name: '文科论证锻造', shortName: '论证', description: '形成论点、证据链、反驳预案和段落推进。', systemHint: '把核心判断压缩成可争辩命题，展示推理过程，不只罗列观点。', keywords: ['论证', '观点', '材料分析', '反驳', 'argument'] },
  { id: 'scene-cinematography', name: '场景镜头调度', shortName: '场景', description: '写场景、动作、空间、氛围、镜头感和戏剧推进。', systemHint: '用空间位置、动作顺序和感官焦点组织段落；每个镜头服务人物选择或信息释放。', keywords: ['场景', '动作', '镜头', '氛围', '冲突', 'scene'] },
  { id: 'publication-polish', name: '发表前编辑', shortName: '发布', description: '处理标题、摘要、开头、结尾、投稿和发布前润色。', systemHint: '判断发布场景，优化开头压力、结尾余波和标题准确性，不做标题党。', keywords: ['标题', '摘要', '发布', '投稿', '结尾', 'publish'] },
]

export function findSkillFromPrompt(prompt: string) {
  const expression = /(?:^|\s)@([\p{L}\p{N}_\-.\u4e00-\u9fa5]+)/gu
  let match: RegExpExecArray | null
  let query = ''
  while ((match = expression.exec(prompt))) {
    query = match[1].toLowerCase()
  }
  if (!query) {
    return undefined
  }
  return agentSkills.find((skill) => skillMatches(skill, query))
}

export function inferSkillForPrompt(prompt: string) {
  const normalized = prompt.toLowerCase()
  return agentSkills.find((skill) => skill.keywords?.some((keyword) => normalized.includes(keyword.toLowerCase())))
}

export function searchSkills(query: string) {
  const normalized = query.trim().toLowerCase()

  if (!normalized) {
    return agentSkills
  }

  return agentSkills.filter((skill) => skillMatches(skill, normalized))
}

function skillMatches(skill: AgentSkill, query: string) {
  const haystack = (skill.name + ' ' + skill.shortName + ' ' + skill.description + ' ' + skill.id + ' ' + (skill.keywords ?? []).join(' ')).toLowerCase()
  return haystack.includes(query)
}
