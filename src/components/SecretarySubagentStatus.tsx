import type { AssistantSubagent } from '../services/workAssistantProtocol'

export function SecretarySubagentStatus({ subagent }: { subagent: AssistantSubagent }) {
  const latest = subagent.progress.at(-1) || subagent.summary || subagent.goal
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="min-w-0 truncate text-[#4a453b]">{subagent.goal}</span>
      <span className="shrink-0 text-[#817a6d]">{subagent.status === 'running' ? latest : subagent.status === 'completed' ? '已完成' : subagent.status === 'failed' ? '失败' : subagent.status === 'cancelled' ? '已取消' : subagent.status === 'skipped' ? '已跳过' : '排队中'}</span>
    </div>
  )
}
