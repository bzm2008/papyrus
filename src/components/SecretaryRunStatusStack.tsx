import { useEffect, useState } from 'react'

import type { WorkAssistantRun } from '../services/workAssistantProtocol'
import type { AgentTodo } from '../stores/useAppStore'
import { SecretarySubagentStatus } from './SecretarySubagentStatus'

type Props = { run?: WorkAssistantRun; todos: AgentTodo[]; queuedCount: number }

export function SecretaryRunStatusStack({ run, todos, queuedCount }: Props) {
  const [stalledKey, setStalledKey] = useState('')
  const activityKey = run ? `${run.id}:${run.lastActivityAt}` : ''
  const stalled = run?.status === 'running' && stalledKey === activityKey

  useEffect(() => {
    if (run?.status !== 'running') return
    const remaining = Math.max(0, 2000 - (Date.now() - run.lastActivityAt))
    const key = `${run.id}:${run.lastActivityAt}`
    const timer = window.setTimeout(() => setStalledKey(key), remaining)
    return () => window.clearTimeout(timer)
  }, [run?.id, run?.lastActivityAt, run?.status])

  if (!run && todos.length === 0 && queuedCount === 0) return null
  const tools = run ? Object.values(run.toolCalls) : []
  const subagents = run ? Object.values(run.subagents) : []

  return (
    <section aria-label="秘书运行状态" className="mx-auto mb-2 max-w-[920px] rounded-lg border border-[#e0dacd] bg-[#fffdf8] px-3 py-2 text-xs shadow-sm">
      {run?.stage ? <div className="mb-1 font-medium text-[#49443a]">{run.stage}</div> : null}
      {todos.length ? <div className="space-y-1">{todos.map((todo) => <div key={todo.id} className="flex justify-between gap-2"><span>{todo.title}</span><span className="text-[#817a6d]">{todo.status}</span></div>)}</div> : null}
      {subagents.length ? <details className="mt-1"><summary>子 Agent {subagents.length}</summary>{subagents.map((subagent) => <SecretarySubagentStatus key={subagent.id} subagent={subagent} />)}</details> : null}
      {tools.length ? <details className="mt-1"><summary>后台工具 {tools.length}</summary>{tools.map((tool) => <div key={tool.id} className="mt-1 flex justify-between"><span>{tool.intent || tool.name}</span><span>{tool.status}</span></div>)}</details> : null}
      {queuedCount ? <div className="mt-1 text-[#6f685c]">排队指令 {queuedCount}</div> : null}
      {stalled && run?.status === 'running' ? <div className="mt-1 text-[#9a6a32]">暂未收到新进展</div> : null}
      {run?.error ? <div className="mt-1 text-[#9a4338]">{run.error}</div> : null}
    </section>
  )
}
