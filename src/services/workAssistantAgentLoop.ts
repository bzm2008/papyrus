import type { ChatMessage } from './llmClient'
import type { AssistantToolCall, AssistantToolResult, WorkAssistantEvent } from './workAssistantProtocol'

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
  modelCall: (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>
  executeTool: (call: AssistantToolCall, signal?: AbortSignal) => Promise<AssistantToolResult>
  finalStream?: (outline: string, receipts: string, onToken: (token: string) => void, signal?: AbortSignal) => Promise<string>
  emit?: (event: WorkAssistantEvent) => void
  signal?: AbortSignal
  collectionOnly?: boolean
}

const MAX_TOOL_CALLS = 8

function parseDecision(raw: string): WorkAssistantDecision {
  let value: unknown
  try {
    value = JSON.parse(raw.trim())
  } catch {
    throw new Error('工具决策不是有效 JSON。')
  }
  if (!value || typeof value !== 'object') throw new Error('工具决策结构无效。')
  const decision = value as Partial<WorkAssistantDecision> & { tool?: { name?: unknown; arguments?: unknown } }
  if (decision.kind === 'final' && typeof decision.response === 'string' && decision.response.trim()) {
    return { kind: 'final', response: decision.response.trim() }
  }
  if (
    decision.kind === 'tool_call'
    && typeof decision.note === 'string'
    && typeof decision.tool?.name === 'string'
    && decision.tool.arguments !== null
    && typeof decision.tool.arguments === 'object'
    && !Array.isArray(decision.tool.arguments)
  ) {
    return { kind: 'tool_call', tool: { name: decision.tool.name, arguments: decision.tool.arguments as Record<string, unknown> }, note: decision.note }
  }
  throw new Error('工具决策必须是 tool_call 或 final。')
}

function stableArguments(argumentsValue: Record<string, unknown>) {
  return JSON.stringify(Object.keys(argumentsValue).sort().map((key) => [key, argumentsValue[key]]))
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
        'Never invent paths or approval tokens. file_apply_batch may only reference previewId returned by file_plan_batch.',
      ].join('\n'),
    },
    { role: 'user', content: input.prompt },
  ]
  const failedSignatures = new Map<string, number>()
  emit({ type: 'run.started', runId: input.runId, at: Date.now() })

  try {
    for (let round = 0; round <= MAX_TOOL_CALLS; round += 1) {
      if (input.signal?.aborted) throw new DOMException('Run cancelled', 'AbortError')
      const decision = parseDecision(await input.modelCall(messages, input.signal))
      if (decision.kind === 'final') {
        const receipts = toolReceipt(results)
        let response = decision.response
        if (input.collectionOnly) return { response, toolResults: results }
        if (!input.collectionOnly && input.finalStream) {
          let streamed = ''
          response = await input.finalStream(decision.response, receipts, (token) => {
            streamed += token
            emit({ type: 'message.delta', runId: input.runId, messageId: `final-${input.runId}`, delta: token, at: Date.now() })
          }, input.signal)
          if (!response.trim()) response = streamed.trim() || decision.response
        } else {
          emit({ type: 'message.delta', runId: input.runId, messageId: `final-${input.runId}`, delta: response, at: Date.now() })
        }
        emit({ type: 'run.completed', runId: input.runId, response, at: Date.now() })
        return { response, toolResults: results }
      }
      if (round === MAX_TOOL_CALLS) throw new Error('工作助手达到 8 次工具调用上限。')
      if (!input.toolNames.includes(decision.tool.name)) throw new Error(`模型请求了不可用工具：${decision.tool.name}`)

      const signature = `${decision.tool.name}:${stableArguments(decision.tool.arguments)}`
      if ((failedSignatures.get(signature) ?? 0) >= 2) throw new Error('相同工具参数连续失败，已停止循环。')
      const call: AssistantToolCall = {
        id: `${input.runId}-tool-${round + 1}`,
        runId: input.runId,
        name: decision.tool.name,
        intent: decision.note,
        arguments: decision.tool.arguments,
        status: 'queued',
        startedAt: Date.now(),
      }
      const result = await input.executeTool(call, input.signal)
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
