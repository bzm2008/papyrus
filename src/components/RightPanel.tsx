import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Clipboard, Feather, MessageSquareText, Send, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { sendCompanionMessage } from '../services/companionAgent'
import { useAppStore } from '../stores/useAppStore'
import { ModelSelector } from './ModelSelector'
import { SlashCommandMenu } from './SlashCommandMenu'
import { applySlashCommand, type SlashCommand } from './slashCommands'

export function RightPanel() {
  const mode = useAppStore((state) => state.mode)

  if (mode === 'flow') {
    return null
  }

  return <CompanionPanel />
}

function CompanionPanel() {
  const [prompt, setPrompt] = useState('')
  const contextUsedTokens = useAppStore((state) => state.contextUsedTokens)
  const contextLimitTokens = useAppStore((state) => state.effectiveContextLimitTokens)
  const selectedText = useAppStore((state) => state.editorSelectionText)
  const messages = useAppStore((state) => state.companionMessages)
  const runState = useAppStore((state) => state.companionRunState)
  const percent = Math.min(100, Math.round((contextUsedTokens / contextLimitTokens) * 100))

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!prompt.trim() || runState === 'running') {
      return
    }

    const value = prompt
    setPrompt('')
    void sendCompanionMessage(value)
  }

  const pickCommand = (command: SlashCommand) => {
    setPrompt((value) => applySlashCommand(value, command))
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full min-h-0 flex-col bg-[#fffefa]"
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[#eee8dc] px-4">
        <div className="grid size-8 place-items-center rounded-lg bg-[#f5f2ea] text-[#3f5845]">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[#20201d]">伴写 Agent</div>
          <div className="truncate text-xs text-[#86857c]">
            {selectedText ? `选区 ${selectedText.length} 字` : '全文上下文'}
          </div>
        </div>
        <ModelSelector compact />
      </div>

      <div className="papyrus-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <div className="rounded-lg border border-[#eee8dc] bg-white/70 p-3">
          <div className="mb-1 flex items-center justify-between text-xs text-[#6f7168]">
            <span className="inline-flex items-center gap-1.5">
              <Activity size={13} />
              上下文
            </span>
            <span>{percent}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[#e8e1d3]">
            <motion.div
              className="h-full rounded-full bg-[#6f7f68]"
              initial={false}
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.25 }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {!messages.length ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-dashed border-[#d9c69c] bg-[#fffdf7] p-4 text-sm leading-6 text-[#6f7168]"
              >
                <div className="mb-2 flex items-center gap-2 font-medium text-[#2f2b22]">
                  <MessageSquareText size={15} className="text-[#3f5845]" />
                  可以直接聊天，也可以输入 `/` 选择指令
                </div>
                <div className="text-xs leading-5 text-[#8f897a]">
                  选中文稿后优先处理选区；没有选区时，会基于当前文章、同一聊天内文章和导入资料给建议或生成补丁。
                </div>
              </motion.div>
            ) : null}

            {messages.map((message) => (
              <motion.div
                key={message.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={`group rounded-lg border px-3 py-2 text-sm leading-6 ${
                  message.role === 'user'
                    ? 'border-[#20201d] bg-[#20201d] text-[#fffefa]'
                    : 'border-[#eee8dc] bg-white/78 text-[#2f2b22]'
                }`}
              >
                <div className="mb-1 flex items-center justify-between text-[11px] opacity-70">
                  <span>{message.role === 'user' ? '你' : '伴写'}</span>
                  <button
                    type="button"
                    title="复制"
                    onClick={() => void navigator.clipboard?.writeText(message.content)}
                    className="rounded p-1 opacity-0 transition group-hover:opacity-100"
                  >
                    <Clipboard size={12} />
                  </button>
                </div>
                <div className="whitespace-pre-wrap">{message.content}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <form onSubmit={submitPrompt} className="shrink-0 border-t border-[#eee8dc] p-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs text-[#8f897a]">
          <span className="inline-flex items-center gap-1.5">
            <Feather size={13} />
            输入 `/` 唤起指令
          </span>
          <span>{runState === 'running' ? '处理中...' : selectedText ? '选区优先' : '全文模式'}</span>
        </div>
        <div className="relative flex items-end gap-2 rounded-xl border border-[#e8ddc7] bg-white px-3 py-2 shadow-[0_8px_24px_rgba(43,34,19,0.05)]">
          <SlashCommandMenu scope="companion" value={prompt} onPick={pickCommand} />
          <textarea
            aria-label="伴写指令"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={1}
            placeholder={selectedText ? '告诉伴写如何处理选区，或输入 /' : '询问建议、续写、补写，或输入 /'}
            className="max-h-28 min-h-8 min-w-0 flex-1 resize-none border-none bg-transparent text-sm leading-6 text-[#2f2b22] outline-none placeholder:text-[#aaa398]"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <button
            type="submit"
            title="发送给伴写"
            disabled={runState === 'running'}
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#20201d] text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-wait disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      </form>
    </motion.div>
  )
}
