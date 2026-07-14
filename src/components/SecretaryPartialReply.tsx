import { MarkdownMessage } from './SecretaryWorkbenchPanel'

export function SecretaryPartialReply({ text }: { text: string }) {
  const content = text.trim()
  if (!content) return null

  return (
    <div
      data-testid="secretary-partial-reply"
      className="w-full max-w-[880px] rounded-xl border border-[#e8c9bf]/80 bg-[#fff8f4]/90 px-3.5 py-2.5 text-sm leading-7 text-[#2f2b22]"
    >
      <div className="mb-1 text-[11px] font-medium text-[#9a4338]">电脑助手 · 已取消</div>
      <MarkdownMessage text={content} />
    </div>
  )
}
