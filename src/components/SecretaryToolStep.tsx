import { ChevronDown, ChevronRight, Copy, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'

import type { AssistantApprovalChoice, AssistantApprovalRequest, AssistantToolCall } from '../services/workAssistantProtocol'

type Props = {
  toolCall: AssistantToolCall
  approval?: AssistantApprovalRequest
  onApprove?: (choice: AssistantApprovalChoice) => void
  onSelect?: () => void
  onRetry?: () => void
  onDismiss?: () => void
}

const choiceLabels: Record<AssistantApprovalChoice, string> = { once: '执行一次', run: '本轮允许', deny: '拒绝' }

function targetOf(call: AssistantToolCall, approval?: AssistantApprovalRequest) {
  if (approval?.targetSummary) return approval.targetSummary
  for (const key of ['path', 'url', 'appId', 'applicationId', 'rootId']) {
    const value = call.arguments[key]
    if (typeof value === 'string' && value) return value
  }
  return call.name
}

function impactCount(call: AssistantToolCall) {
  const completed = call.result?.data?.completed
  if (Array.isArray(completed)) return completed.length
  const items = call.result?.data?.items
  return Array.isArray(items) ? items.length : undefined
}

export function SecretaryToolStep({ toolCall, approval, onApprove, onSelect, onRetry, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false)
  const count = impactCount(toolCall)
  const recoverable = toolCall.status === 'failed' && toolCall.result?.recoverable
  const retryLabel = toolCall.result?.errorCode === 'stale_preview' ? '重新生成预览' : '重试'

  return (
    <section className="rounded-lg border border-[#ddd7c9] bg-[#fffdf7] px-3 py-2 text-sm text-[#332f27]" data-tool-call-id={toolCall.id}>
      <div className="flex items-start gap-2">
        <button type="button" aria-label={expanded ? '收起详情' : '展开详情'} onClick={() => setExpanded((value) => !value)} className="mt-0.5 text-[#777062]">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <span className="block font-medium">{approval?.title || toolCall.intent || toolCall.name}</span>
          <span className="mt-0.5 block truncate text-xs text-[#777062]">{targetOf(toolCall, approval)}</span>
        </button>
        <span className="shrink-0 text-xs text-[#777062]">
          {toolCall.status === 'running' ? '进行中' : toolCall.status === 'awaiting_approval' ? '等待确认' : toolCall.status === 'completed' ? '已完成' : toolCall.status === 'failed' ? '失败' : toolCall.status === 'cancelled' ? '已取消' : '排队中'}
        </span>
      </div>

      {toolCall.result?.summary ? <div className={`mt-2 text-xs ${toolCall.result.ok ? 'text-[#416746]' : 'text-[#9a4338]'}`}>{toolCall.result.summary}</div> : null}
      {count !== undefined ? <div className="mt-1 text-xs text-[#777062]">{count} 项</div> : null}

      {approval && toolCall.status === 'awaiting_approval' ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {approval.allowedChoices.map((choice) => <button key={choice} type="button" onClick={() => onApprove?.(choice)} className={choice === 'deny' ? 'rounded-md border border-[#d8cfc0] px-2 py-1 text-xs' : 'rounded-md bg-[#3f6247] px-2 py-1 text-xs text-white'}>{choiceLabels[choice]}</button>)}
        </div>
      ) : null}

      {recoverable && onRetry ? <button type="button" onClick={onRetry} className="mt-2 inline-flex items-center gap-1 text-xs text-[#7b5131]"><RefreshCw size={13} />{retryLabel}</button> : null}

      {expanded ? (
        <div className="mt-2 border-t border-[#e5dfd3] pt-2 text-xs text-[#625c50]">
          {approval?.impactSummary ? <p>{approval.impactSummary}</p> : null}
          {approval?.reason && approval.reason !== approval.impactSummary ? <p className="mt-1">{approval.reason}</p> : null}
          <div className="mt-2 flex gap-2">
            <button type="button" aria-label="复制工具信息" onClick={() => void navigator.clipboard?.writeText(JSON.stringify({ name: toolCall.name, arguments: toolCall.arguments }))}><Copy size={13} /></button>
            {onDismiss ? <button type="button" aria-label="隐藏工具步骤" onClick={onDismiss}><X size={13} /></button> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
