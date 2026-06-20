const apiKey = process.env.DEEPSEEK_API_KEY
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')

if (!apiKey) {
  console.error('DEEPSEEK_API_KEY is required')
  process.exit(2)
}

const scenarios = [
  {
    id: 'writing',
    effort: 'medium',
    temperature: 0.72,
    prompt:
      '请写一段 500 字左右的中文散文开头，主题是“雨夜里整理旧信的人”。要求有细节、有节制，不要模板化。',
  },
  {
    id: 'denoise',
    effort: 'high',
    temperature: 0.34,
    prompt:
      '请将以下文字降噪，去掉 AI 腔和空话，只输出改写后文本：\n在这个快节奏时代，我们每一个人都应该学会拥抱变化，不断提升自我，从而在人生道路上遇见更好的自己。',
  },
  {
    id: 'hive_structured',
    effort: 'ultra_hive',
    temperature: 0.48,
    prompt:
      '你是 Papyrus 蜂巢模式的秘书长，请为“写一篇关于县域文旅叙事的研究型长文”输出极简 JSON，字段为 summary, agents, risks, nextStep, confidence。不要寒暄。',
  },
  {
    id: 'low_effort',
    effort: 'low',
    temperature: 0.22,
    prompt:
      '用 120 字以内总结：长期记忆、项目记忆和短期工作现场在写作软件中为什么必须分开。',
  },
]

const startedAt = new Date()
const results = []

for (const scenario of scenarios) {
  const before = Date.now()
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are testing Papyrus writing assistant behavior. Reply in Chinese unless JSON is requested. Be concise and do not mention the test harness.',
      },
      { role: 'user', content: scenario.prompt },
    ],
    temperature: scenario.temperature,
    max_tokens: scenario.effort === 'ultra_hive' ? 1800 : 1200,
    stream: false,
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(payload?.error?.message || `HTTP ${response.status}`)
    }

    const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || ''
    const elapsedMs = Date.now() - before
    const estimatedPromptTokens = estimateTokens(JSON.stringify(body.messages))
    const estimatedOutputTokens = estimateTokens(content)
    results.push({
      id: scenario.id,
      effort: scenario.effort,
      temperature: scenario.temperature,
      ok: Boolean(content.trim()),
      elapsedMs,
      estimatedPromptTokens,
      estimatedOutputTokens,
      chars: content.length,
      preview: content.replace(/\s+/g, ' ').slice(0, 360),
    })
  } catch (error) {
    results.push({
      id: scenario.id,
      effort: scenario.effort,
      temperature: scenario.temperature,
      ok: false,
      elapsedMs: Date.now() - before,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const report = {
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  model,
  baseUrl,
  scenarios: results,
}

console.log(JSON.stringify(report, null, 2))

function estimateTokens(text) {
  const normalized = String(text || '')
  const cjk = (normalized.match(/[\u4e00-\u9fff]/g) || []).length
  const ascii = normalized.length - cjk
  return Math.ceil(cjk * 0.9 + ascii / 4)
}
