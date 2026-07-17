export type SecretaryTaskComplexity = 'simple' | 'standard' | 'complex' | 'goal'
export type SecretaryTaskDomain = 'writing' | 'work_assistant' | 'browser' | 'mixed'

export type SecretaryTaskClassification = {
  complexity: SecretaryTaskComplexity
  confidence: number
  suggestedAgentCount: number
  expectedAgentCount: number
  hiveRecommended: boolean
  cacheability: 'low' | 'medium' | 'high'
  reasons: string[]
  taskType: string
  domain: SecretaryTaskDomain
}

const workAssistantPattern = /(?:文件|文件夹|目录|下载|桌面|磁盘|内存|CPU|应用|软件|打开网址|打开链接|定位文件|扫描|整理资料|归档|移动|重命名|复制|删除|电脑状态|downloads?|folders?|files?|desktop|disk|memory|scan|open\s+(?:app|url|file)|rename|move|organize)/i
const browserPattern = /(?:网页|网站|浏览器|标签页|链接内容|页面|表单|字段|点击|填写|下载网页|提交表单|web|website|browser|tab|page|form|field|click|fill|submit|download)/i
const writingDomainPattern = /(?:写作|撰写|编写|续写|写(?:一|篇|个|份|封|段|出|作|好|成|报告|文章|文案|小说|总结)|起草|文章|报告|总结|润色|改写|小说|章节|文案|正文|write|draft|article|report|rewrite)/i

function inferDomain(text: string): SecretaryTaskDomain {
  const work = workAssistantPattern.test(text)
  const browser = browserPattern.test(text)
  const writing = writingDomainPattern.test(text)
  if ((work || browser) && writing) return 'mixed'
  // Browser work takes precedence over the broad local-work patterns. For
  // example, "打开链接并填写表单" must expose the paired-tab tools instead
  // of being treated as a desktop URL-open request.
  if (browser) return 'browser'
  if (work) return 'work_assistant'
  return 'writing'
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

const conversationalShortcutPattern = /^(?:你好|您好|嗨|嗨嗨|哈喽|hello|hi|hey|在吗|有人吗|早上好|下午好|晚上好|晚安|谢谢|谢谢你|多谢|好的|好呀|好吧|收到|明白了|了解了|嗯|嗯嗯|哈哈|哈哈哈|再见|你是谁|你叫什么|你能做什么|how are you|who are you)[!！。,.，?？~～\s]*$/i

/**
 * Short social turns should take one conversational model call. They must not
 * enter the planner/tool pipeline, even when a model over-interprets a greeting
 * as a writing request.
 */
export function isConversationalShortcut(prompt: string) {
  const text = prompt
    .split('【思考强度】', 1)[0]
    .replace(/\s+/g, ' ')
    .trim()

  if (!text || text.length > 32 || !conversationalShortcutPattern.test(text)) {
    return false
  }

  const classification = classifySecretaryTask(text)
  return classification.complexity === 'simple' && classification.domain === 'writing'
}

export function classifySecretaryTask(
  prompt: string,
  options: { activeGoal?: boolean; writeIntent?: boolean } = {},
): SecretaryTaskClassification {
  const text = prompt.trim()
  const normalized = text.replace(/\s+/g, '')
  const reasons: string[] = []
  const domain = inferDomain(text)

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
      domain,
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
      domain,
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
      domain,
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
      domain,
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
      domain,
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
      domain,
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
      domain,
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
      domain,
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
    domain,
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
