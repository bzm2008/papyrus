export type AgentSkillPackId =
  | 'research-check'
  | 'writing-review'
  | 'platform-ops'
  | 'longform-chapter'

export type AgentSkillPack = {
  id: AgentSkillPackId
  label: string
  parameters: string[]
}

export function inferSkillPacks(prompt: string): AgentSkillPack[] {
  const packs: AgentSkillPack[] = []

  if (/资料|核查|引用|文献|事实|来源|研究/.test(prompt)) {
    packs.push({ id: 'research-check', label: '资料核查包', parameters: ['来源', '可信度', '引用风险'] })
  }

  if (/润色|审校|改写|终校|风格|错别字|病句/.test(prompt)) {
    packs.push({ id: 'writing-review', label: '写作审校包', parameters: ['风格', '结构', '语言质量'] })
  }

  if (/小红书|抖音|B站|公众号|知乎|微博|视频号|SEO|运营/.test(prompt)) {
    packs.push({ id: 'platform-ops', label: '平台运营包', parameters: ['平台定位', '标题钩子', '发布策略'] })
  }

  if (/小说|章节|人物|对白|世界观|长篇|连载/.test(prompt)) {
    packs.push({ id: 'longform-chapter', label: '长篇章节包', parameters: ['设定一致性', '章节目标', '伏笔'] })
  }

  return packs.slice(0, 3)
}

export function formatSkillPacksForPrompt(prompt: string) {
  const packs = inferSkillPacks(prompt)

  if (!packs.length) {
    return '技能包：无'
  }

  return [
    '可用技能包（只引用名称和参数，避免重复展开工具描述）：',
    ...packs.map((pack) => `- ${pack.label}: ${pack.parameters.join('、')}`),
  ].join('\n')
}
