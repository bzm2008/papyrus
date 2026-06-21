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
  /(?:百万(?:字|级)?|百万级|长篇小说|长篇|多卷|多部|整本|成书|连载|连续章节|多章节|章节规模|长程|长期|系列|million|long[-\s]?form|novel\s+series)/i

const robustLongformFictionPattern =
  /(?:小说|续写|章节|卷纲|大纲|人物|剧情|叙事|世界观|伏笔|对白|兄弟|历史|明朝|明代|南明|史实|玄幻|科幻|古言|悬疑|fiction|story|chapter|plot)/i

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
  /长程/,
  /百万/,
  /多章节/,
  /连续章节/,
  /整本/,
  /小说/,
  /续写/,
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

  const longformScaleHit = robustLongformScalePattern.test(text)
  const fictionHit = robustLongformFictionPattern.test(text)

  if (longformScaleHit && fictionHit) {
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

  if (longformScaleHit) {
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

  if (fictionHit && /续写|章节|小说|兄弟/.test(text) && (options.writeIntent || normalized.length > 24)) {
    return {
      complexity: 'complex',
      confidence: 0.84,
      suggestedAgentCount: 5,
      expectedAgentCount: 7,
      hiveRecommended: longformScaleHit || normalized.length > 180,
      cacheability: 'medium',
      reasons: ['检测到小说续写或章节创作任务，需要多 Agent 写作链路'],
      taskType: 'longform-fiction',
    }
  }

  if (simpleHit && isShort && complexHits === 0 && !options.writeIntent && !fictionHit) {
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
