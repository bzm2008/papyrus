import type { ChatMessage } from './llmClient'
import type { AssistantToolCall, AssistantToolResult, WorkAssistantEvent } from './workAssistantProtocol'
import { isTerminalExecutionRequest } from './secretaryTaskClassifier'

export type WorkAssistantDecision =
  | { kind: 'tool_call'; tool: { name: string; arguments: Record<string, unknown> }; note: string }
  | { kind: 'final'; response: string }

export type WorkAssistantLoopResult = {
  response: string
  toolResults: Array<{ call: AssistantToolCall; result: AssistantToolResult }>
}

export type WorkAssistantAgentLoopInput = {
  runId: string
  prompt: string
  toolNames: readonly string[]
  toolSchemas?: unknown
  /** Safe, native-provided notices for capabilities intentionally withheld from this run. */
  capabilityNotes?: readonly string[]
  modelCall: (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>
  executeTool: (call: AssistantToolCall, signal?: AbortSignal) => Promise<AssistantToolResult>
  finalStream?: (outline: string, receipts: string, onToken: (token: string) => void, signal?: AbortSignal) => Promise<string>
  emit?: (event: WorkAssistantEvent) => void
  signal?: AbortSignal
  collectionOnly?: boolean
}

const MAX_TOOL_CALLS = 8
const MAX_DECISION_TEXT_LENGTH = 32_768
const MAX_CAPABILITY_NOTES = 24
const MAX_CAPABILITY_NOTE_LENGTH = 360

const browserSafetyGuidance = [
  'Never request passwords, verification codes, payment details, or hidden-field values.',
  'Never submit a form unless the user explicitly requested submission; prefer fill-draft and stop before submit.',
  'Use element tokens only from the latest browser snapshot.',
  'After navigation or a stale result, request a fresh browser snapshot and do not guess a replacement element.',
  'Do not claim a browser action succeeded unless its tool result has ok: true.',
]

const terminalSafetyGuidance = [
  'Terminal execution is structured and allowlisted. Provide operation, rootId, and optional relative cwd; never provide a shell command string.',
  'Only request git_status, git_diff_stat, git_branch, git_log, git_version, system_info, or whoami.',
  'Never request powershell, pwsh, cmd, bash, sh, zsh, npm scripts, cargo builds, Python/Node scripts, shell operators, encoded commands, or executable paths.',
  'Use terminal_run only for read-only diagnostics. It always stops at a user approval boundary.',
  'Keep the working directory inside an authorized workspace and never claim success unless the terminal result has ok: true.',
]

type ConcreteActionKind = 'application' | 'terminal' | 'browser'

const browserActionTools = new Set([
  'browser_snapshot',
  'browser_open',
  'browser_fill_draft',
  'browser_click',
  'browser_download',
  'browser_submit',
])

function isCapabilityOnlyQuestion(prompt: string) {
  const text = prompt.replace(/\s+/g, ' ').trim()
  return /^(?:你|您)?\s*(?:能不能|可不可以|是否可以|能否|会不会|可以|可否)\s*(?:直接)?\s*(?:操控|控制|操作|使用|访问)\s*(?:电脑|浏览器|桌面|应用|文件|网页|网站|终端|命令行)?\s*(?:吗|呢)?\s*[!！。,.，?？~～\s]*$/i.test(text)
}

function hasUnpairedBrowserNotice(notes: readonly string[] | undefined) {
  return notes?.some((note) => /(?:未配对|未连接|not\s+(?:paired|connected)|browser bridge.*(?:unavailable|not paired))/i.test(note)) ?? false
}

function concreteActionKind(input: Pick<WorkAssistantAgentLoopInput, 'prompt' | 'toolNames' | 'capabilityNotes'>): ConcreteActionKind | undefined {
  const prompt = input.prompt.replace(/\s+/g, ' ').trim()
  if (isCapabilityOnlyQuestion(prompt)) return undefined

  const toolNames = new Set(input.toolNames)
  if (
    toolNames.has('desktop_list_apps')
    && toolNames.has('desktop_open_app')
    && /(?:打开|启动|运行|开启|唤起|launch|open)\s*(?:谷歌(?:浏览器|\s*chrome)|google\s*(?:chrome|浏览器)|chrome|chromium|microsoft\s*edge|edge|firefox|(?:系统默认|默认)?浏览器)/i.test(prompt)
  ) {
    return 'application'
  }

  if (
    toolNames.has('terminal_run')
    && isTerminalExecutionRequest(prompt)
  ) {
    return 'terminal'
  }

  if (
    !hasUnpairedBrowserNotice(input.capabilityNotes)
    && input.toolNames.some((toolName) => browserActionTools.has(toolName))
    && /(?:操控|控制|操作|查看|点击|填写|滚动|导航|下载|提交).*(?:浏览器|网页|页面|标签页)|(?:浏览器|网页|页面|标签页).*(?:操控|控制|操作|查看|点击|填写|滚动|导航|下载|提交)|\b(?:control|operate|click|fill|navigate|scroll|submit)\s+(?:the\s+)?(?:browser|page|tab)\b/i.test(prompt)
  ) {
    return 'browser'
  }

  return undefined
}

function concreteActionCorrection(kind: ConcreteActionKind) {
  const nextTool = {
    application: 'desktop_list_apps，然后使用返回的 opaque appId 调用 desktop_open_app',
    terminal: 'terminal_run，并使用允许的 operation、rootId 和可选 relative cwd',
    browser: 'Browser Bridge 的最新可用工具，先获取当前页面快照再执行后续动作',
  }[kind]
  return `这是一个具体执行请求，运行时已提供匹配工具。请仅选择并调用合适工具，不要解释无法操作，不要声称已完成，也不要返回 final。下一步应使用：${nextTool}。保持确定性、低温的工具决策 JSON。`
}

type ListedApplication = {
  id: string
  label: string
  kind?: string
}

function listedApplications(results: WorkAssistantLoopResult['toolResults']): ListedApplication[] {
  const listing = [...results].reverse().find(({ call }) => call.name === 'desktop_list_apps')
  if (!listing?.result.ok) return []
  const applications = listing.result.data?.applications
  if (!Array.isArray(applications)) return []
  return applications.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const application = value as Record<string, unknown>
    if (typeof application.id !== 'string' || typeof application.label !== 'string') return []
    return [{
      id: application.id,
      label: application.label,
      ...(typeof application.kind === 'string' ? { kind: application.kind } : {}),
    }]
  })
}

function isRequestedBrowser(prompt: string, application: ListedApplication) {
  const value = `${application.id} ${application.label}`.toLowerCase()
  if (/(?:谷歌(?:浏览器|\s*chrome)|google\s*(?:chrome|浏览器)|\bchrome\b)/i.test(prompt)) {
    return /chrome|谷歌|google/.test(value)
  }
  if (/(?:microsoft\s*edge|\bedge\b)/i.test(prompt)) return /edge/.test(value)
  if (/\bfirefox\b/i.test(prompt)) return /firefox/.test(value)
  return application.kind === 'browser'
}

function applicationLaunchStillRequired(input: WorkAssistantAgentLoopInput, results: WorkAssistantLoopResult['toolResults']) {
  if (concreteActionKind(input) !== 'application') return false
  if (results.some(({ call }) => call.name === 'desktop_open_app')) return false
  return listedApplications(results).some((application) => isRequestedBrowser(input.prompt, application))
}

function applicationLaunchCorrection() {
  return '已找到用户请求的浏览器。请使用刚刚返回的 opaque appId 调用 desktop_open_app，随后停在系统显示的单次确认边界。不要把“已列出应用”当作已打开应用，也不要自行编造 appId。'
}

function isVerifiedRequestedBrowserApp(
  input: WorkAssistantAgentLoopInput,
  results: WorkAssistantLoopResult['toolResults'],
  appId: unknown,
) {
  if (concreteActionKind(input) !== 'application' || typeof appId !== 'string') return false
  return listedApplications(results).some((application) => application.id === appId && isRequestedBrowser(input.prompt, application))
}

function applicationDiscoveryCorrection() {
  return '启动浏览器前，appId 必须来自本轮 desktop_list_apps 的成功结果，并且与用户请求的浏览器一致。上一条启动请求未执行。请先调用 desktop_list_apps；仅可使用其返回的 opaque appId 调用 desktop_open_app，不能猜测或复用其他 id。'
}

function extractSingleJsonObject(raw: string) {
  const fenced = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  if (fenced.length > 1) {
    throw new Error('工具决策包含多个 JSON 对象。')
  }

  const candidateText = fenced[0]?.[1]?.trim() ?? raw.trim()
  const start = candidateText.indexOf('{')
  if (start < 0) {
    throw new Error('工具决策不是有效 JSON。')
  }

  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let index = start; index < candidateText.length; index += 1) {
    const character = candidateText[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) {
        end = index + 1
        break
      }
      if (depth < 0) break
    }
  }

  if (end < 0 || depth !== 0) {
    throw new Error('工具决策不是完整 JSON。')
  }

  const remainder = candidateText.slice(end)
  if (remainder.includes('{') || remainder.includes('}')) {
    throw new Error('工具决策包含多个 JSON 对象。')
  }
  return candidateText.slice(start, end)
}

function parseDecision(raw: string): WorkAssistantDecision {
  if (typeof raw !== 'string' || raw.length > MAX_DECISION_TEXT_LENGTH) {
    throw new Error('工具决策超过安全长度限制。')
  }

  let value: unknown
  try {
    value = JSON.parse(extractSingleJsonObject(raw))
  } catch {
    throw new Error('工具决策不是有效 JSON。')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工具决策结构无效。')
  const decision = value as Partial<WorkAssistantDecision> & { tool?: { name?: unknown; arguments?: unknown } }
  const topLevelKeys = Object.keys(value as Record<string, unknown>)
  if (decision.kind === 'final' && topLevelKeys.every((key) => key === 'kind' || key === 'response') && topLevelKeys.length === 2 && typeof decision.response === 'string' && decision.response.trim() && decision.response.length <= 20_000) {
    return { kind: 'final', response: decision.response.trim() }
  }
  const toolValue = decision.tool
  const toolKeys = toolValue && typeof toolValue === 'object' && !Array.isArray(toolValue)
    ? Object.keys(toolValue as Record<string, unknown>)
    : []
  if (
    decision.kind === 'tool_call'
    && topLevelKeys.length === 3
    && topLevelKeys.every((key) => key === 'kind' || key === 'tool' || key === 'note')
    && typeof decision.note === 'string'
    && decision.note.length <= 2_000
    && typeof toolValue?.name === 'string'
    && toolValue.name.length > 0
    && toolValue.name.length <= 128
    && toolKeys.length === 2
    && toolKeys.every((key) => key === 'name' || key === 'arguments')
    && toolValue.arguments !== null
    && typeof toolValue.arguments === 'object'
    && !Array.isArray(toolValue.arguments)
  ) {
    return { kind: 'tool_call', tool: { name: toolValue.name, arguments: toolValue.arguments as Record<string, unknown> }, note: decision.note }
  }
  throw new Error('工具决策必须是 tool_call 或 final。')
}

function stableArguments(argumentsValue: Record<string, unknown>) {
  return JSON.stringify(Object.keys(argumentsValue).sort().map((key) => [key, argumentsValue[key]]))
}

function formatCapabilityNotes(notes: readonly string[] | undefined) {
  if (!notes?.length) return ''
  const safeNotes = notes
    .slice(0, MAX_CAPABILITY_NOTES)
    .map((note) => [...note].map((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127 ? ' ' : character
    }).join('').trim().slice(0, MAX_CAPABILITY_NOTE_LENGTH))
    .filter(Boolean)
  return safeNotes.length
    ? `Runtime capability status: ${safeNotes.join(' | ')}. Do not claim an unavailable capability is installed or connected; explain the stated next step instead.`
    : ''
}

function toolReceipt(results: WorkAssistantLoopResult['toolResults']) {
  return results.map(({ call, result }) => JSON.stringify({ tool: call.name, ok: result.ok, summary: result.summary, errorCode: result.errorCode, data: result.data })).join('\n')
}

export async function runWorkAssistantAgentLoop(input: WorkAssistantAgentLoopInput): Promise<WorkAssistantLoopResult> {
  const emit = input.emit ?? (() => undefined)
  const results: WorkAssistantLoopResult['toolResults'] = []
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are the controlled Papyrus work assistant.',
        'Return exactly one JSON object and no markdown.',
        'Use {"kind":"tool_call","tool":{"name":"...","arguments":{}},"note":"..."} or {"kind":"final","response":"..."}.',
        `Available tools: ${input.toolNames.join(', ')}`,
        input.toolSchemas ? `Tool schemas: ${JSON.stringify(input.toolSchemas)}` : '',
        formatCapabilityNotes(input.capabilityNotes),
        'Concrete execution requests must use a tool; never answer that Papyrus cannot access the computer when a matching tool is available.',
        'To open an application, call desktop_list_apps first and then use the returned opaque id with desktop_open_app; never invent a path or id.',
        'For Git or terminal diagnostics, use terminal_run with one allowlisted operation; never provide a shell command string.',
        'For browser control, use Browser Bridge tools and the latest browser snapshot; never claim an action succeeded without a successful tool result.',
        'Never invent paths or approval tokens. file_apply_batch may only reference previewId returned by file_plan_batch.',
        ...(input.toolNames.some((name) => name.startsWith('browser_')) ? browserSafetyGuidance : []),
        ...(input.toolNames.includes('terminal_run') ? terminalSafetyGuidance : []),
      ].join('\n'),
    },
    { role: 'user', content: input.prompt },
  ]
  const failedSignatures = new Map<string, number>()
  let decisionRepairUsed = false
  let concreteActionRepairUsed = false
  let applicationLaunchRepairUsed = false
  let applicationDiscoveryRepairUsed = false
  emit({ type: 'run.started', runId: input.runId, at: Date.now() })

  try {
    let toolRound = 0
    while (toolRound <= MAX_TOOL_CALLS) {
      if (input.signal?.aborted) throw new DOMException('Run cancelled', 'AbortError')
      let decision: WorkAssistantDecision
      try {
        decision = parseDecision(await input.modelCall(messages, input.signal))
      } catch {
        if (decisionRepairUsed) {
          throw new Error('工具决策不是有效 JSON，未执行任何操作。')
        }
        decisionRepairUsed = true
        messages.push({
          role: 'assistant',
          content: '[工具决策格式无效，原始内容已省略。]',
        })
        messages.push({
          role: 'user',
          content: '上一条工具决策未通过格式校验。请只返回一个合法 JSON 对象，不要 Markdown、解释或多个对象。工具尚未执行。',
        })
        continue
      }
      if (decision.kind === 'final') {
        if (!applicationLaunchRepairUsed && applicationLaunchStillRequired(input, results)) {
          applicationLaunchRepairUsed = true
          messages.push({ role: 'assistant', content: JSON.stringify(decision) })
          messages.push({ role: 'user', content: applicationLaunchCorrection() })
          continue
        }
        const actionKind = results.length === 0 && !concreteActionRepairUsed
          ? concreteActionKind(input)
          : undefined
        if (actionKind) {
          concreteActionRepairUsed = true
          messages.push({ role: 'assistant', content: JSON.stringify(decision) })
          messages.push({ role: 'user', content: concreteActionCorrection(actionKind) })
          continue
        }
        const receipts = toolReceipt(results)
        let response = decision.response
        if (input.collectionOnly) return { response, toolResults: results }
        if (!input.collectionOnly && input.finalStream) {
          let streamed = ''
          let streamFailedBeforeOutput = false
          try {
            response = await input.finalStream(decision.response, receipts, (token) => {
              streamed += token
              emit({ type: 'message.delta', runId: input.runId, messageId: `final-${input.runId}`, delta: token, at: Date.now() })
            }, input.signal)
          } catch (error) {
            const cancelled = input.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')
            if (cancelled || streamed.trim()) throw error
            // The outline was already produced from the verified tool receipts. If the short
            // synthesis call is unavailable before its first token, keep the run useful without
            // retrying the provider or emitting a duplicate partial response.
            response = decision.response
            streamFailedBeforeOutput = true
          }
          if (!response.trim()) response = streamed.trim() || decision.response
          if (streamFailedBeforeOutput || !streamed.trim() && response === decision.response) {
            emit({ type: 'message.delta', runId: input.runId, messageId: `final-${input.runId}`, delta: response, at: Date.now() })
          }
        } else {
          emit({ type: 'message.delta', runId: input.runId, messageId: `final-${input.runId}`, delta: response, at: Date.now() })
        }
        emit({ type: 'run.completed', runId: input.runId, response, at: Date.now() })
        return { response, toolResults: results }
      }
      if (toolRound === MAX_TOOL_CALLS) throw new Error('工作助手达到 8 次工具调用上限。')
      if (!input.toolNames.includes(decision.tool.name)) throw new Error(`模型请求了不可用工具：${decision.tool.name}`)

      if (
        concreteActionKind(input) === 'application'
        && decision.tool.name === 'desktop_open_app'
        && !isVerifiedRequestedBrowserApp(input, results, decision.tool.arguments.appId)
      ) {
        if (applicationDiscoveryRepairUsed) {
          throw new Error('打开浏览器前未获得可验证的应用标识，未执行启动操作。')
        }
        applicationDiscoveryRepairUsed = true
        messages.push({ role: 'assistant', content: JSON.stringify(decision) })
        messages.push({ role: 'user', content: applicationDiscoveryCorrection() })
        continue
      }

      const signature = `${decision.tool.name}:${stableArguments(decision.tool.arguments)}`
      if ((failedSignatures.get(signature) ?? 0) >= 2) throw new Error('相同工具参数连续失败，已停止循环。')
      const call: AssistantToolCall = {
        id: `${input.runId}-tool-${toolRound + 1}`,
        runId: input.runId,
        name: decision.tool.name,
        intent: decision.note,
        arguments: decision.tool.arguments,
        status: 'queued',
        startedAt: Date.now(),
      }
      const result = await input.executeTool(call, input.signal)
      toolRound += 1
      results.push({ call, result })
      if (!result.ok) failedSignatures.set(signature, (failedSignatures.get(signature) ?? 0) + 1)
      else failedSignatures.delete(signature)
      messages.push({ role: 'assistant', content: JSON.stringify(decision) })
      messages.push({ role: 'user', content: JSON.stringify({ toolResult: { ok: result.ok, summary: result.summary, errorCode: result.errorCode, recoverable: result.recoverable, data: result.data } }) })
    }
    throw new Error('工作助手循环异常结束。')
  } catch (error) {
    const cancelled = input.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')
    emit(cancelled
      ? { type: 'run.cancelled', runId: input.runId, at: Date.now() }
      : { type: 'run.failed', runId: input.runId, code: 'agent_loop_failed', message: error instanceof Error ? error.message : '工作助手运行失败。', recoverable: true, at: Date.now() })
    throw error
  }
}
