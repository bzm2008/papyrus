import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Clipboard, Feather, MessageSquareText, Send, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { sendCompanionMessage } from '../services/companionAgent'
import { useAppStore } from '../stores/useAppStore'
import { ModelSelector } from './ModelSelector'
import { PromptAssistMenu } from './PromptAssistMenu'
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full min-h-0 flex-col bg-[#fffefa]/82 backdrop-blur"
    >
      <div className="papyrus-toolbar flex h-12 shrink-0 items-center gap-2.5 border-b px-3">
        <div className="grid size-7 place-items-center rounded-md bg-[#edf6eb] text-[#315d39]">
          <Sparkles size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[#20201d]">文学秘书</div>
          <div className="truncate text-[11px] text-[#6f7168]">
            {selectedText ? `选区 ${selectedText.length} 字` : '全文、文件与对话上下文'}
          </div>
        </div>
        <ModelSelector compact />
      </div>

      <div className="papyrus-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="papyrus-inset rounded-lg p-3">
          <div className="mb-1 flex items-center justify-between text-xs text-[#6f7168]">
            <span className="inline-flex items-center gap-1.5">
              <Activity size={12} />
              上下文
            </span>
            <span className="tabular-nums">{percent}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[#e8e1d3]">
            <motion.div
              className="h-full rounded-full bg-[#315d39]"
              initial={false}
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.22 }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {!messages.length ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-dashed border-[#cfd8c7] bg-[#fffdf7]/78 p-3 text-sm leading-6 text-[#6f7168]"
              >
                <div className="mb-1.5 flex items-center gap-2 font-medium text-[#20201d]">
                  <MessageSquareText size={14} className="text-[#315d39]" />
                  直接提问，或用 `/`、`@技能`、`#文件` 精确调度
                </div>
                <div className="text-xs leading-5 text-[#8f897a]">
                  选中文稿时优先处理选区；没有选区时，可以解释文学常识、批改作文、整理素材、检索资料或诊断结构。
                </div>
              </motion.div>
            ) : null}

            {messages.map((message) => (
              <motion.article
                key={message.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className={`group rounded-lg px-3 py-2 text-sm leading-6 ${
                  message.role === 'user'
                    ? 'bg-[#20201d] text-[#fffefa]'
                    : 'border border-[#e1dccf]/82 bg-[#fffefa]/78 text-[#2f2b22]'
                }`}
              >
                <div className="mb-1 flex items-center justify-between text-[11px] opacity-70">
                  <span>{message.role === 'user' ? '你' : '秘书'}</span>
                  <button
                    type="button"
                    title="复制"
                    onClick={() => void navigator.clipboard?.writeText(message.content)}
                    className="rounded p-1 opacity-0 group-hover:opacity-100"
                  >
                    <Clipboard size={12} />
                  </button>
                </div>
                <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <form onSubmit={submitPrompt} className="shrink-0 border-t border-[#e1dccf] p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2 px-1 text-[11px] text-[#8f897a]">
          <span className="inline-flex items-center gap-1.5">
            <Feather size={12} />
            / 命令 · @ 技能 · # 文件
          </span>
          <span>{runState === 'running' ? '处理中...' : selectedText ? '选区优先' : '全文模式'}</span>
        </div>
        <div className="papyrus-command-bar relative flex items-end gap-2 rounded-xl px-3 py-2">
          <SlashCommandMenu scope="companion" value={prompt} onPick={pickCommand} />
          <PromptAssistMenu value={prompt} onChange={setPrompt} />
          <textarea
            aria-label="伴写指令"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={1}
            placeholder={selectedText ? '告诉秘书如何处理选区...' : '提问、续写、整理资料，或输入 /'}
            className="max-h-28 min-h-8 min-w-0 flex-1 resize-none border-none bg-transparent text-sm leading-6 text-[#2f2b22] outline-none placeholder:text-[#8f897a]"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <button
            type="submit"
            title="发送给文学秘书"
            disabled={runState === 'running'}
            className="papyrus-primary-button grid size-8 shrink-0 place-items-center rounded-lg disabled:cursor-wait disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      </form>
    </motion.div>
  )
}
