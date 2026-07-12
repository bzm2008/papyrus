import type { AssistantToolCall } from '../services/workAssistantProtocol'

type FileOperation = { kind?: unknown; source?: unknown; destination?: unknown }

const conflictLabels: Record<string, string> = { skip: '跳过冲突', rename: '自动重命名', overwrite: '覆盖目标' }

function resultItems(call: AssistantToolCall | undefined, key: 'completed' | 'failed') {
  const value = call?.result?.data?.[key]
  return Array.isArray(value) ? value : []
}

export function SecretaryFileWorkbench({ planCall, applyCall, onSelectToolCall }: { planCall?: AssistantToolCall; applyCall?: AssistantToolCall; onSelectToolCall?: (id: string) => void }) {
  if (!planCall) return <div className="p-4 text-sm text-[#817a6d]">选择一个文件预览后查看操作详情。</div>
  const operations = Array.isArray(planCall.arguments.operations) ? planCall.arguments.operations as FileOperation[] : []
  const conflictPolicy = String(planCall.arguments.conflictPolicy ?? 'skip')
  const completed = resultItems(applyCall, 'completed')
  const failed = resultItems(applyCall, 'failed')
  const stale = applyCall?.result?.errorCode === 'stale_preview'

  return (
    <div className="papyrus-scrollbar h-full overflow-y-auto px-4 py-3 text-sm text-[#332f27]">
      <section className="border-b border-[#e4ded2] pb-3">
        <div className="text-xs text-[#817a6d]">授权工作区</div>
        <div className="mt-1 font-medium">{String(planCall.arguments.rootId ?? '未知工作区')}</div>
      </section>
      <section className="border-b border-[#e4ded2] py-3">
        <div className="flex items-center justify-between"><span className="font-medium">{operations.length} 项操作</span><span className="text-xs text-[#817a6d]">{conflictLabels[conflictPolicy] ?? conflictPolicy}</span></div>
        <button type="button" aria-label="在对话中定位" onClick={() => onSelectToolCall?.(planCall.id)} className="mt-2 text-xs text-[#416746]">在对话中定位</button>
      </section>
      {stale ? <section className="border-b border-[#e6c9bf] bg-[#fff4ef] py-3 text-[#92483d]">预览已过期，请重新生成</section> : null}
      <section className="divide-y divide-[#ebe5da]">
        {operations.map((operation, index) => (
          <div key={`${String(operation.kind)}-${index}`} className="py-3">
            <div className="text-xs uppercase tracking-wide text-[#817a6d]">{String(operation.kind ?? 'operation')}</div>
            {operation.source ? <div className="mt-1 break-all">{String(operation.source)}</div> : null}
            {operation.destination ? <div className="mt-1 break-all text-[#416746]"><span aria-hidden="true">→ </span><span>{String(operation.destination)}</span></div> : null}
          </div>
        ))}
      </section>
      {applyCall ? (
        <section className="border-t border-[#e4ded2] pt-3">
          <div className="flex gap-4 text-xs"><span className="text-[#416746]">已完成 {completed.length}</span><span className="text-[#9a4338]">失败 {failed.length}</span></div>
          {failed.map((item, index) => <div key={index} className="mt-2 text-xs text-[#9a4338]">{JSON.stringify(item)}</div>)}
        </section>
      ) : null}
    </div>
  )
}
