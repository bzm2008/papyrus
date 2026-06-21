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

const robustLongformScalePattern =
  /(?:\u767e\u4e07(?:\u5b57|\u7ea7)?|\u767e\u4e07\u7ea7|\u957f\u7bc7\u5c0f\u8bf4|\u957f\u7bc7|\u591a\u5377|\u591a\u90e8|\u6574\u672c|\u6210\u4e66|\u8fde\u8f7d|\u8fde\u7eed\u7ae0\u8282|\u591a\u7ae0\u8282|million|long[-\s]?form|novel\s+series)/i

const robustLongformFictionPattern =
  /(?:\u5c0f\u8bf4|\u7eed\u5199|\u7ae0\u8282|\u5377\u7eb2|\u5927\u7eb2|\u4eba\u7269|\u5267\u60c5|\u53d9\u4e8b|\u4e16\u754c\u89c2|\u4f0f\u7b14|\u5bf9\u767d|\u5386\u53f2|\u660e\u671d|\u5357\u660e|\u7384\u5e7b|\u79d1\u5e7b|\u53e4\u8a00|\u60ac\u7591|fiction|story|chapter|plot)/i

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

  if (robustLongformScalePattern.test(text) && robustLongformFictionPattern.test(text)) {
    return {
      complexity: 'complex',
      confidence: 0.92,
      suggestedAgentCount: 6,
      expectedAgentCount: 8,
      hiveRecommended: true,
      cacheability: 'high',
      reasons: ['detected longform fiction scale: multi-chapter or million-word writing project'],
      taskType: 'longform-fiction',
    }
  }

  if (robustLongformScalePattern.test(text)) {
    return {
      complexity: 'complex',
      confidence: 0.88,
      suggestedAgentCount: 5,
      expectedAgentCount: 7,
      hiveRecommended: true,
      cacheability: 'high',
      reasons: ['detected longform project scale'],
      taskType: inferTaskType(text, 'longform-project'),
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
