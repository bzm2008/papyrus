import { useAppStore, type UserMemoryCategory, type UserMemoryRecord } from '../stores/useAppStore'

const categoryLabels: Record<UserMemoryCategory, string> = {
  identity: '身份',
  personality: '性格',
  habit: '习惯',
  style: '文风',
  preference: '偏好',
  constraint: '约束',
  project: '项目',
  other: '其他',
}

const sensitivePattern =
  /(身份证|护照|银行卡|密码|验证码|手机号|住址|家庭住址|token|api key|secret|private key)/i
const stableMemoryPattern =
  /(我是|我的身份|我的职业|我习惯|我喜欢|我偏好|以后|默认|记住|请记住|不要|避免|称呼我|我的风格|写作习惯|always|never|prefer|remember)/i

export function composeUserMemoryContext() {
  const state = useAppStore.getState()
  const profile = state.userMemoryProfile

  if (!profile.enabled || profile.mode === 'off') {
    return ''
  }

  const profileLines = [
    profile.displayName ? `称呼: ${profile.displayName}` : '',
    profile.identity ? `身份: ${profile.identity}` : '',
    profile.personality ? `性格与协作方式: ${profile.personality}` : '',
    profile.writingHabits ? `写作习惯: ${profile.writingHabits}` : '',
    profile.stylePreferences ? `文风偏好: ${profile.stylePreferences}` : '',
    profile.constraints ? `长期约束: ${profile.constraints}` : '',
  ].filter(Boolean)

  const recordLines = state.userMemoryRecords
    .filter((record) => record.enabled)
    .slice(0, 24)
    .map((record) => `- [${categoryLabels[record.category]}] ${record.content}`)

  if (!profileLines.length && !recordLines.length) {
    return ''
  }

  return [
    '长期用户记忆（本地保存，仅用于增强 AI 对用户习惯和上下文的理解，不代表外部收集）:',
    ...profileLines,
    recordLines.length ? '稳定记忆:' : '',
    ...recordLines,
  ]
    .filter(Boolean)
    .join('\n')
}

export function suggestUserMemoryFromText(text: string, sourceRunId?: string) {
  const state = useAppStore.getState()

  if (!state.userMemoryProfile.enabled || state.userMemoryProfile.mode === 'off') {
    return undefined
  }

  const content = text.replace(/\s+/g, ' ').trim()

  if (!content || content.length < 8 || content.length > 220 || sensitivePattern.test(content)) {
    return undefined
  }

  if (!stableMemoryPattern.test(content)) {
    return undefined
  }

  const suggestion = state.addTowriteSuggestion({
    scope: 'global',
    title: '个人长期记忆',
    content,
    reason: '这看起来是稳定的身份、习惯、偏好或长期约束。确认后才会写入本地长期记忆。',
    sourceRunId,
  })

  if (state.userMemoryProfile.mode === 'low_risk_auto') {
    state.upsertUserMemoryRecord({
      category: inferUserMemoryCategory(content),
      content,
      source: 'agent_observation',
      enabled: true,
      confidence: 0.72,
    })
    state.updateTowriteSuggestion(suggestion.id, {
      status: 'accepted',
      reason: '已按“低风险自动保存”设置写入本地长期记忆，可在设置中编辑或删除。',
    })
  }

  return suggestion
}

export function acceptUserMemorySuggestion(id: string) {
  const state = useAppStore.getState()
  const suggestion = state.towriteSuggestions.find((item) => item.id === id)

  if (!suggestion || suggestion.status !== 'pending') {
    return undefined
  }

  const record = state.upsertUserMemoryRecord({
    category: inferUserMemoryCategory(suggestion.content),
    content: suggestion.content,
    source: 'agent_suggestion',
    enabled: true,
    confidence: 0.76,
  })

  state.updateTowriteSuggestion(id, { status: 'accepted' })
  return record
}

export function rejectUserMemorySuggestion(id: string) {
  useAppStore.getState().updateTowriteSuggestion(id, { status: 'rejected' })
}

export function inferUserMemoryCategory(content: string): UserMemoryRecord['category'] {
  if (/(我是|身份|职业|学生|老师|作者|研究者|工程师|编辑|身份)/.test(content)) {
    return 'identity'
  }

  if (/(性格|沟通|协作|耐心|直接|详细|简洁)/.test(content)) {
    return 'personality'
  }

  if (/(习惯|通常|经常|默认|每次|以后)/.test(content)) {
    return 'habit'
  }

  if (/(文风|风格|语气|口吻|节奏|表达)/.test(content)) {
    return 'style'
  }

  if (/(不要|避免|禁忌|不能|别再|约束)/.test(content)) {
    return 'constraint'
  }

  if (/(喜欢|偏好|prefer|always|never)/i.test(content)) {
    return 'preference'
  }

  return 'other'
}
