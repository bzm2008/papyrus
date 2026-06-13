import type { AgentSkill } from './types'

export const agentSkills: AgentSkill[] = [
  {
    id: 'explain',
    name: '解释与知识',
    shortName: '解释',
    description: '解释文学常识、写作术语、修辞和文本背景。',
    systemHint: '优先直接解释概念，再给可迁移到写作中的例子。',
  },
  {
    id: 'polish',
    name: '润色改写',
    shortName: '润色',
    description: '改善句法、节奏、准确度和表达质感。',
    systemHint: '保留作者原意和语气，只修正表达、结构和细节。',
  },
  {
    id: 'expand',
    name: '扩写成段',
    shortName: '扩写',
    description: '把提纲、短句或片段扩写为可放入文档的正文。',
    systemHint: '输出完整可用正文，减少解释，保持段落自然。',
  },
  {
    id: 'condense',
    name: '缩写提炼',
    shortName: '缩写',
    description: '压缩冗余内容，保留论点、信息和语气。',
    systemHint: '删去重复和松散铺陈，保留必要逻辑关系。',
  },
  {
    id: 'argument',
    name: '议论文',
    shortName: '议论文',
    description: '形成论点、论据、反驳和递进结构。',
    systemHint: '明确中心论点、分论点、证据链和反方回应。',
  },
  {
    id: 'expository',
    name: '说明文',
    shortName: '说明文',
    description: '按定义、分类、流程、因果或对比组织说明。',
    systemHint: '强调清楚、准确、层次和读者可理解性。',
  },
  {
    id: 'outline',
    name: '提纲结构',
    shortName: '提纲',
    description: '为文章、作业或章节生成结构骨架。',
    systemHint: '输出层级清晰的提纲，并说明每段承担的功能。',
  },
  {
    id: 'review',
    name: '审阅诊断',
    shortName: '审阅',
    description: '检查逻辑、材料、表达、错别字和完成度。',
    systemHint: '先列关键问题，再给可执行修改建议，必要时给示例。',
  },
  {
    id: 'continue',
    name: '续写正文',
    shortName: '续写',
    description: '根据上下文继续写作，适合文章、故事和作业。',
    systemHint: '承接当前文档语气和内容，不突然改变文体。',
  },
]

export function findSkillFromPrompt(prompt: string) {
  const match = prompt.match(/@([\p{L}\p{N}_\-.\u4e00-\u9fa5]*)$/u)

  if (!match) {
    return undefined
  }

  const query = match[1].toLowerCase()
  return agentSkills.find((skill) => {
    return (
      skill.shortName.toLowerCase().includes(query) ||
      skill.name.toLowerCase().includes(query) ||
      skill.id.includes(query)
    )
  })
}

export function searchSkills(query: string) {
  const normalized = query.trim().toLowerCase()

  if (!normalized) {
    return agentSkills
  }

  return agentSkills.filter((skill) => {
    const haystack = `${skill.name} ${skill.shortName} ${skill.description} ${skill.id}`.toLowerCase()
    return haystack.includes(normalized)
  })
}
