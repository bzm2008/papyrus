export type SecretaryTaskComplexity = 'simple' | 'standard' | 'complex' | 'goal'

export type SecretaryTaskClassification = {
  complexity: SecretaryTaskComplexity
  confidence: number
  suggestedAgentCount: number
  expectedAgentCount: number
  hiveRecommended: boolean
  cacheability: 'low' | 'medium' | 'high'
  reasons: string[]
  taskType: string
}

const simplePatterns = [
  /润色/,
  /改写/,
  /解释/,
  /总结/,
  /翻译/,
  /校对/,
  /取标题/,
  /一句话/,
  /这句话/,
  /这段/,
]

const complexPatterns = [
  /长篇/,
  /多章节/,
  /整本/,
  /小说/,
  /研究报告/,
  /论文/,
  /资料核查/,
  /引用/,
  /合同/,
  /合规/,
  /政策/,
  /投资/,
  /商业计划/,
  /跨文档/,
  /世界观/,
]

const platformPatterns = [
  /小红书/,
  /抖音/,
  /B站/i,
  /公众号/,
  /知乎/,
  /微博/,
  /视频号/,
  /直播/,
  /SEO/i,
  /私域/,
]

export function classifySecretaryTask(
  prompt: string,
  options: { activeGoal?: boolean; writeIntent?: boolean } = {},
): SecretaryTaskClassification {
  const text = prompt.trim()
  const normalized = text.replace(/\s+/g, '')
  const reasons: string[] = []

  if (/^\/goal\b/i.test(text) || options.activeGoal) {
    return {
      complexity: 'goal',
      confidence: 0.94,
      suggestedAgentCount: 5,
      expectedAgentCount: 7,
      hiveRecommended: true,
      cacheability: 'medium',
      reasons: ['检测到长程目标模式'],
      taskType: 'longform-goal',
    }
  }

  const isShort = normalized.length <= 80
  const simpleHit = simplePatterns.find((pattern) => pattern.test(text))
  const complexHits = complexPatterns.filter((pattern) => pattern.test(text)).length
  const platformHit = platformPatterns.find((pattern) => pattern.test(text))

  if (simpleHit && isShort && complexHits === 0 && !options.writeIntent) {
    return {
      complexity: 'simple',
      confidence: 0.9,
      suggestedAgentCount: 1,
      expectedAgentCount: 1,
      hiveRecommended: false,
      cacheability: 'medium',
      reasons: [`短请求命中简单任务：${simpleHit.source}`],
      taskType: 'single-step-edit',
    }
  }

  if (complexHits >= 2 || normalized.length > 900) {
    reasons.push('请求较长或包含多个复杂信号')
    return {
      complexity: 'complex',
      confidence: 0.86,
      suggestedAgentCount: 5,
      expectedAgentCount: 8,
      hiveRecommended: true,
      cacheability: inferCacheability(text, 'high'),
      reasons,
      taskType: inferTaskType(text, platformHit ? 'platform' : 'research-writing'),
    }
  }

  if (complexHits === 1) {
    reasons.push('包含研究、合规、长文或跨文档信号')
    return {
      complexity: 'complex',
      confidence: 0.78,
      suggestedAgentCount: 4,
      expectedAgentCount: 6,
      hiveRecommended: true,
      cacheability: inferCacheability(text, 'medium'),
      reasons,
      taskType: inferTaskType(text, 'complex-writing'),
    }
  }

  if (platformHit || options.writeIntent || normalized.length > 180) {
    reasons.push(platformHit ? `命中平台/运营任务：${platformHit.source}` : '需要生成可交付文本')
    return {
      complexity: 'standard',
      confidence: 0.82,
      suggestedAgentCount: platformHit ? 2 : 2,
      expectedAgentCount: platformHit ? 4 : 3,
      hiveRecommended: Boolean(platformHit && normalized.length > 220),
      cacheability: inferCacheability(text, platformHit ? 'high' : 'medium'),
      reasons,
      taskType: inferTaskType(text, platformHit ? 'platform-content' : 'writing'),
    }
  }

  return {
    complexity: 'simple',
    confidence: 0.72,
    suggestedAgentCount: 1,
    expectedAgentCount: 1,
    hiveRecommended: false,
    cacheability: 'low',
    reasons: ['默认按单步秘书任务处理'],
    taskType: inferTaskType(text, 'general'),
  }
}

function inferCacheability(text: string, fallback: SecretaryTaskClassification['cacheability']) {
  if (/资料|核查|引用|文献|搜索|跨文档|项目|设定|人物|术语|合同|政策|法规|SEO|平台/.test(text)) {
    return 'high'
  }

  if (/写|续写|正文|小说|段落|创作/.test(text)) {
    return 'medium'
  }

  return fallback
}

function inferTaskType(text: string, fallback: string) {
  if (/小红书|抖音|B站|公众号|知乎|微博|视频号|直播|SEO/i.test(text)) {
    return 'platform-ops'
  }

  if (/论文|学术|引用|文献|研究|资料核查/.test(text)) {
    return 'academic-research'
  }

  if (/合同|法律|合规|政策|政府|公共事务/.test(text)) {
    return 'professional-compliance'
  }

  if (/小说|人物|对白|章节|世界观|剧情/.test(text)) {
    return 'longform-fiction'
  }

  return fallback
}
