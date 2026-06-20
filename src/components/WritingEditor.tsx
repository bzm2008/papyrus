import { EditorContent, type Editor, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Ban,
  Bold,
  CheckCheck,
  CheckCircle2,
  Feather,
  FileSearch,
  Heading1,
  Heading2,
  Info,
  Italic,
  List,
  ListOrdered,
  Loader2,
  MessageSquareText,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  ScanText,
  SeparatorHorizontal,
  ShieldCheck,
  Sparkles,
  Strikethrough,
  Undo2,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { AiDiffMark, AiRewriteExtension } from '../extensions/aiRewrite'
import { InlineAutocomplete } from '../extensions/inlineAutocomplete'
import { ProjectMention } from '../extensions/projectMention'
import { formatChangeStat, recordDocumentChange } from '../services/documentChangeStatsService'
import { requestInlineCompletion } from '../services/localAutocomplete'
import { runCompanionRewrite, type CompanionRewriteResult, type WritingAction } from '../services/writingActions'
import { type DocumentPatch, useAppStore } from '../stores/useAppStore'

const initialContent = `
  <h1>论记忆、材料与判断</h1>
  <p>这里是 Papyrus 的主编辑区。</p>
  <p>你可以选中任意一段文字，呼出悬浮菜单，然后使用伴写能力做原位改写、纠错、审查、查重或降噪。</p>
  <p>写作时，左侧用于组织材料与大纲，中间尽可能保持安静，秘书模式负责秘书长对话、上下文管理与项目级记忆。</p>
`

const actions: Array<{
  label: WritingAction
  icon: typeof MessageSquareText
  tone: 'neutral' | 'emphasis' | 'warning'
}> = [
  { label: '指令', icon: MessageSquareText, tone: 'emphasis' },
  { label: '审查', icon: ScanText, tone: 'warning' },
  { label: '纠错', icon: CheckCheck, tone: 'neutral' },
  { label: '查重', icon: FileSearch, tone: 'neutral' },
  { label: '降噪', icon: ShieldCheck, tone: 'neutral' },
]

type ActionNoticeState = {
  status: 'running' | 'completed' | 'error'
  title: string
  detail: string
}

export function WritingEditor() {
  const [customPromptOpen, setCustomPromptOpen] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [actionNotice, setActionNotice] = useState<ActionNoticeState | null>(null)
  const [previewResult, setPreviewResult] = useState<RewritePreviewState | null>(null)
  const [diagnosticResult, setDiagnosticResult] = useState<CheckupState | null>(null)
  const activeProviderId = useAppStore((state) => state.activeProviderId)
  const providerConfigs = useAppStore((state) => state.providerConfigs)
  const setLlmRunState = useAppStore((state) => state.setLlmRunState)
  const addNegativeMemory = useAppStore((state) => state.addNegativeMemory)
  const flowReviewMode = useAppStore((state) => state.flowReviewMode)
  const pendingDocumentPatch = useAppStore((state) => state.pendingDocumentPatch)
  const markDocumentPatch = useAppStore((state) => state.markDocumentPatch)
  const createArticleFromPatch = useAppStore((state) => state.createArticleFromPatch)
  const addFlowTrace = useAppStore((state) => state.addFlowTrace)
  const activeVibeId = useAppStore((state) => state.activeVibeId)
  const documentRevision = useAppStore((state) => state.documentRevision)
  const setEditorSelectionText = useAppStore((state) => state.setEditorSelectionText)
  const editor = useWritingEditor()

  useEffect(() => {
    if (!editor) {
      return
    }

    const editorHtml = useAppStore.getState().editorHtml
    editor.commands.setContent(editorHtml || '<h1>未命名文稿</h1><p></p>', { emitUpdate: false })
  }, [documentRevision, editor])

  useEffect(() => {
    if (!editor || !pendingDocumentPatch) {
      return
    }

    const canApply =
      pendingDocumentPatch.status === 'approved' ||
      (pendingDocumentPatch.status === 'pending' && flowReviewMode === 'auto')

    if (!canApply) {
      return
    }

    if (pendingDocumentPatch.createArticle) {
      const beforeText = editor.getText()
      createArticleFromPatch(pendingDocumentPatch)
      markDocumentPatch('applied')
      const stat = recordDocumentChange({
        patch: pendingDocumentPatch,
        beforeText,
        afterText: pendingDocumentPatch.content,
      })
      addFlowTrace({
        kind: 'document',
        title: '已创建新文章',
        detail: `${pendingDocumentPatch.title} · ${formatChangeStat(stat.insertedChars, stat.deletedChars)}`,
        status: 'completed',
        toolName: 'document.patch',
        endedAt: Date.now(),
      })
      return
    }

    const beforeText = editor.getText()
    const replacedText =
      pendingDocumentPatch.operation === 'replace_selection' ? getSelectedText(editor) : undefined
    const applied = applyDocumentPatch(editor, pendingDocumentPatch)

    if (applied) {
      const afterText = editor.getText()
      const stat = recordDocumentChange({
        patch: pendingDocumentPatch,
        beforeText,
        afterText,
        replacedText,
      })
      markDocumentPatch('applied')
      addFlowTrace({
        kind: 'document',
        title: '已写入文稿',
        detail: `${pendingDocumentPatch.title} · ${formatChangeStat(stat.insertedChars, stat.deletedChars)}`,
        status: 'completed',
        toolName: 'document.patch',
        endedAt: Date.now(),
      })
    }
  }, [addFlowTrace, createArticleFromPatch, editor, flowReviewMode, markDocumentPatch, pendingDocumentPatch])

  useEffect(() => {
    if (!editor) {
      return
    }

    const updateSelection = () => setEditorSelectionText(getSelectedText(editor))
    editor.on('selectionUpdate', updateSelection)
    updateSelection()

    return () => {
      editor.off('selectionUpdate', updateSelection)
    }
  }, [editor, setEditorSelectionText])

  if (!editor) {
    return (
      <div className="grid min-h-[520px] place-items-center text-sm text-[#8f897a]">
        <span className="inline-flex items-center gap-2">
          <Feather size={16} className="text-[#d7aa4f]" />
          正在准备编辑器
        </span>
      </div>
    )
  }

  const runAction = async (action: WritingAction, prompt?: string) => {
    if (action === '指令' && !prompt?.trim()) {
      setCustomPromptOpen(true)
      setRejectOpen(false)
      return
    }

    const selectedText = getSelectedText(editor)
    const provider = providerConfigs[activeProviderId]

    if (!selectedText) {
      setActionNotice({
        status: 'error',
        title: `${action}失败`,
        detail: '请先选中一段文稿。',
      })
      return
    }

    setIsRunning(true)
    setActionNotice({
      status: 'running',
      title: `${action}处理中`,
      detail: `正在处理选中的 ${selectedText.length} 字。`,
    })
    setLlmRunState('running', '伴写正在处理选区')
    setPreviewResult(null)
    setDiagnosticResult(null)

    try {
      const result = await runCompanionRewrite({
        action,
        selectedText,
        customPrompt: prompt,
        provider,
      })

      if (result.kind === 'diagnostic') {
        const checkup = toCheckupState(result, selectedText)
        setDiagnosticResult(checkup)
        setActionNotice({
          status: 'completed',
          title: '查重完成',
          detail: checkup.summary,
        })
      } else {
        const preview = buildPreviewState(result, selectedText)
        setPreviewResult(preview)
        setActionNotice({
          status: 'completed',
          title: `${action}已生成预览`,
          detail: '已生成降噪建议稿，请确认后再写回正文。',
        })
      }

      setCustomPromptOpen(false)
      setCustomPrompt('')
      setLlmRunState('idle', '伴写已完成')
    } catch (error) {
      const message = error instanceof Error ? error.message : '伴写失败'
      setActionNotice({
        status: 'error',
        title: `${action}失败`,
        detail: message,
      })
      setLlmRunState('error', message)
    } finally {
      setIsRunning(false)
    }
  }

  const applyPreview = () => {
    if (!previewResult || !editor) {
      return
    }

    const beforeText = getSelectedText(editor)
    const applied = editor.chain().focus().applyAiReplacement(previewResult.replacementText).run()

    if (!applied) {
      return
    }

    const afterText = previewResult.replacementText
    const stat = recordDocumentChange({
      patch: {
        id: `preview-${Date.now()}`,
        operation: 'replace_selection',
        content: previewResult.replacementText,
        title: '降噪预览',
        status: 'applied',
        createdAt: Date.now(),
      },
      beforeText,
      afterText,
      replacedText: beforeText,
    })

    addFlowTrace({
      kind: 'document',
      title: '已应用降噪建议',
      detail: `降噪预览 · ${formatChangeStat(stat.insertedChars, stat.deletedChars)}`,
      status: 'completed',
      toolName: 'document.patch',
      endedAt: Date.now(),
    })
    setPreviewResult(null)
    setActionNotice({
      status: 'completed',
      title: '降噪已写回',
      detail: '建议稿已应用到选区。',
    })
  }

  const submitCustomPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void runAction('指令', customPrompt)
  }

  const submitRejectReason = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    addNegativeMemory(rejectReason)
    setRejectReason('')
    setRejectOpen(false)
    setLlmRunState('idle', '已写入负向反馈记忆')
  }

  return (
    <div className="relative min-h-[560px] flex-1 bg-[#fbfaf6]/38">
      <BubbleMenu
        editor={editor}
        shouldShow={({ state }) => !state.selection.empty}
        options={{
          placement: 'top',
          offset: 10,
          flip: true,
          shift: true,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="papyrus-panel w-[min(640px,calc(100vw-32px))] rounded-xl p-2"
        >
          <div className="flex flex-wrap gap-1">
            {actions.map((action) => {
              const Icon = action.icon
              const isMuted = action.label === '降噪' && previewResult

              return (
                <button
                  key={action.label}
                  type="button"
                  title={action.label === '指令' ? '输入自定义指令' : `${action.label}选中文本`}
                  onClick={() =>
                    action.label === '指令'
                      ? setCustomPromptOpen((open) => !open)
                      : void runAction(action.label)
                  }
                  disabled={isRunning}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium disabled:cursor-wait disabled:opacity-50 ${
                    action.tone === 'emphasis'
                      ? 'bg-[#171714] text-[#fffefa] hover:bg-[#2b2a25]'
                      : action.tone === 'warning'
                        ? 'text-[#925f1d] hover:bg-[#fff4df] hover:text-[#6c4610]'
                        : 'text-[#6f7168] hover:bg-[#f4ead8] hover:text-[#3f5845]'
                  } ${isMuted ? 'ring-1 ring-[#d7aa4f]/30' : ''}`}
                >
                  <Icon size={13} />
                  {action.label}
                </button>
              )
            })}
            <button
              type="button"
              title="拒绝并告诉 AI 原因"
              onClick={() => {
                setRejectOpen((open) => !open)
                setCustomPromptOpen(false)
              }}
              className="flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium text-[#6f7168] hover:bg-[#fff1f1] hover:text-rose-700"
            >
              <Ban size={13} />
              拒绝
            </button>
          </div>

          <ActionNotice notice={actionNotice} />

          <AnimatePresence initial={false}>
            {previewResult ? (
              <PreviewPanel preview={previewResult} onApply={applyPreview} onClose={() => setPreviewResult(null)} />
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {diagnosticResult ? (
              <CheckupPanel result={diagnosticResult} onClose={() => setDiagnosticResult(null)} />
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {customPromptOpen ? (
              <motion.form
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                onSubmit={submitCustomPrompt}
                className="mt-2 overflow-hidden"
              >
                <div className="flex items-center gap-2 border-t border-[#efe5d1] pt-2">
                  <input
                    autoFocus
                    value={customPrompt}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                    placeholder="例如：改得更像一段学术随笔"
                    className="h-8 min-w-0 flex-1 rounded-md border border-[#e8ddc7] bg-[#fffdf7] px-3 text-sm text-[#2f2b22] outline-none placeholder:text-[#9d988a] focus:border-[#d7aa4f]"
                  />
                  <button
                    type="submit"
                    disabled={isRunning}
                    className="papyrus-primary-button h-8 rounded-md px-3 text-sm font-medium disabled:cursor-wait disabled:opacity-50"
                  >
                    {isRunning ? '处理中' : '应用'}
                  </button>
                </div>
              </motion.form>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {rejectOpen ? (
              <motion.form
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                onSubmit={submitRejectReason}
                className="mt-2 overflow-hidden"
              >
                <div className="flex items-center gap-2 border-t border-[#efe5d1] pt-2">
                  <input
                    autoFocus
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    placeholder="例如：不要用这个成语 / 避免过度抒情"
                    className="h-8 min-w-0 flex-1 rounded-md border border-[#e8ddc7] bg-[#fffdf7] px-3 text-sm text-[#2f2b22] outline-none placeholder:text-[#9d988a] focus:border-rose-300"
                  />
                  <button type="submit" className="h-8 rounded-md bg-rose-600 px-3 text-sm font-medium text-white hover:bg-rose-700">
                    记住
                  </button>
                </div>
              </motion.form>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </BubbleMenu>

      <DocumentToolbar editor={editor} />
      <EditorContent editor={editor} className={`papyrus-editor papyrus-editor-vibe-${activeVibeId} h-full`} />
    </div>
  )
}

function ActionNotice({ notice }: { notice: ActionNoticeState | null }) {
  return (
    <AnimatePresence initial={false}>
      {notice ? (
        <motion.div
          initial={{ opacity: 0, y: -4, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div
            className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5 ${
              notice.status === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : notice.status === 'completed'
                  ? 'border-[#d7e5cd] bg-[#f3f8ef] text-[#3f5845]'
                  : 'border-[#efe5d1] bg-[#fffdf7] text-[#6f7168]'
            }`}
          >
            {notice.status === 'running' ? (
              <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-[#d7aa4f]" />
            ) : notice.status === 'completed' ? (
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[#4f7a54]" />
            ) : (
              <Ban size={13} className="mt-0.5 shrink-0 text-rose-600" />
            )}
            <div className="min-w-0">
              <div className="font-medium">{notice.title}</div>
              <div className="text-[11px] opacity-80">{notice.detail}</div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function PreviewPanel({
  preview,
  onApply,
  onClose,
}: {
  preview: RewritePreviewState
  onApply: () => void
  onClose: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: 10, height: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="mt-2 overflow-hidden rounded-xl border border-[#e4d7b8] bg-[#fffdf8]"
    >
      <div className="flex items-center justify-between border-b border-[#efe5d1] px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-[#3f5845]">
          <Sparkles size={13} />
          降噪预览
        </div>
        <button type="button" onClick={onClose} className="text-xs text-[#8f897a] hover:text-[#171714]">
          关闭
        </button>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-2">
          <DiffBlock title="删除" tone="remove" items={preview.removedSegments} fallback="没有明显删除内容" />
          <DiffBlock title="新增" tone="add" items={preview.addedSegments} fallback="没有新增内容" />
        </div>
        <div className="rounded-lg border border-[#ece2ca] bg-white/80 p-3 text-xs text-[#4a463b]">
          <div className="flex items-center gap-2 font-medium text-[#171714]">
            <Info size={13} />
            结果说明
          </div>
          <p className="mt-2 leading-5">{preview.summary}</p>
          <p className="mt-2 text-[#8f897a]">置信度 {Math.round(preview.confidence * 100)}%</p>
          {preview.notes.length ? <p className="mt-2 leading-5 text-[#6f7168]">{preview.notes.join(' · ')}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onApply}
              className="papyrus-primary-button inline-flex h-8 items-center rounded-md px-3 text-xs font-medium"
            >
              应用到正文
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center rounded-md border border-[#e2d6bf] px-3 text-xs font-medium text-[#6f7168] hover:bg-[#faf5ea]"
            >
              暂不应用
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function CheckupPanel({
  result,
  onClose,
}: {
  result: CheckupState
  onClose: () => void
}) {
  const tone =
    result.verdict === 'likely_ai' ? 'text-rose-700' : result.verdict === 'mixed' ? 'text-[#8b5d14]' : 'text-[#3f5845]'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: 10, height: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="mt-2 overflow-hidden rounded-xl border border-[#e4d7b8] bg-[#fffdf8]"
    >
      <div className="flex items-center justify-between border-b border-[#efe5d1] px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-[#3f5845]">
          <FileSearch size={13} />
          查重诊断
        </div>
        <button type="button" onClick={onClose} className="text-xs text-[#8f897a] hover:text-[#171714]">
          关闭
        </button>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-[#ece2ca] bg-white/80 p-3">
          <div className={`text-sm font-semibold ${tone}`}>{verdictLabel(result.verdict)}</div>
          <div className="mt-1 text-xs text-[#8f897a]">置信度 {Math.round(result.confidence * 100)}%</div>
          <div className="mt-3 text-sm leading-6 text-[#2f2b22]">{result.summary}</div>
        </div>
        <div className="space-y-3 text-xs text-[#4a463b]">
          <TagBlock title="原因" items={result.reasons} />
          <TagBlock title="信号" items={result.signals} />
        </div>
      </div>
    </motion.div>
  )
}

function DiffBlock({
  title,
  tone,
  items,
  fallback,
}: {
  title: string
  tone: 'add' | 'remove'
  items: string[]
  fallback: string
}) {
  return (
    <div className="rounded-lg border border-[#ece2ca] bg-white/80 p-3">
      <div className="text-xs font-medium text-[#171714]">{title}</div>
      <div className="mt-2 space-y-1.5 text-[12px] leading-5">
        {items.length ? (
          items.map((item) => (
            <div
              key={item}
              className={`rounded-md px-2 py-1 ${
                tone === 'add'
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border border-rose-200 bg-rose-50 text-rose-700 line-through decoration-rose-400/70'
              }`}
            >
              {item}
            </div>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-[#e6dcc7] px-2 py-1 text-[#8f897a]">{fallback}</div>
        )}
      </div>
    </div>
  )
}

function TagBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8f897a]">{title}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.length ? (
          items.map((item) => (
            <span key={item} className="rounded-full border border-[#e2d6bf] bg-white px-2 py-1 text-[11px]">
              {item}
            </span>
          ))
        ) : (
          <span className="text-[#8f897a]">无</span>
        )}
      </div>
    </div>
  )
}

function verdictLabel(verdict: CheckupState['verdict']) {
  if (verdict === 'likely_ai') return '更像 AI 写作'
  if (verdict === 'mixed') return '人机混合'
  return '更像人工写作'
}

function toCheckupState(result: Extract<CompanionRewriteResult, { kind: 'diagnostic' }>, text: string): CheckupState {
  return {
    verdict: result.verdict,
    summary: result.summary,
    confidence: result.confidence,
    reasons: result.reasons.length ? result.reasons : ['缺少足够信号'],
    signals: result.signals.length ? result.signals : [`样本文本长度 ${text.length} 字`],
  }
}

function buildPreviewState(
  result: Extract<CompanionRewriteResult, { kind: 'rewrite' }>,
  originalText: string,
): RewritePreviewState {
  const replacementText = result.replacementText.trim()
  const originalLines = splitSegments(originalText)
  const replacementLines = splitSegments(replacementText)
  const removedSegments = diffList(originalLines, replacementLines, 'removed')
  const addedSegments = diffList(originalLines, replacementLines, 'added')

  return {
    replacementText,
    summary: result.summary,
    confidence: result.confidence,
    removedSegments,
    addedSegments,
    notes: result.notes.length ? result.notes : result.highlights,
  }
}

function splitSegments(text: string) {
  return text
    .split(/\n{2,}|(?<=[。！？；])/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      if (item.length <= 32) {
        return [item]
      }

      return item
        .split(/(?<=,|，|；|：)/)
        .map((part) => part.trim())
        .filter(Boolean)
    })
}

function diffList(before: string[], after: string[], type: 'removed' | 'added') {
  if (type === 'removed') {
    return before
      .filter((item) => !after.includes(item))
      .map((item) => `− ${item}`)
      .slice(0, 6)
  }

  return after
    .filter((item) => !before.includes(item))
    .map((item) => `+ ${item}`)
    .slice(0, 6)
}

function DocumentToolbar({ editor }: { editor: Editor }) {
  const controls = [
    { label: '撤销', icon: Undo2, active: false, disabled: !editor.can().undo(), action: () => editor.chain().focus().undo().run() },
    { label: '重做', icon: Redo2, active: false, disabled: !editor.can().redo(), action: () => editor.chain().focus().redo().run() },
    { label: '一级标题', icon: Heading1, active: editor.isActive('heading', { level: 1 }), disabled: false, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: '二级标题', icon: Heading2, active: editor.isActive('heading', { level: 2 }), disabled: false, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: '正文', icon: Pilcrow, active: editor.isActive('paragraph'), disabled: false, action: () => editor.chain().focus().setParagraph().run() },
    { label: '加粗', icon: Bold, active: editor.isActive('bold'), disabled: false, action: () => editor.chain().focus().toggleBold().run() },
    { label: '斜体', icon: Italic, active: editor.isActive('italic'), disabled: false, action: () => editor.chain().focus().toggleItalic().run() },
    { label: '删除线', icon: Strikethrough, active: editor.isActive('strike'), disabled: false, action: () => editor.chain().focus().toggleStrike().run() },
    { label: '项目列表', icon: List, active: editor.isActive('bulletList'), disabled: false, action: () => editor.chain().focus().toggleBulletList().run() },
    { label: '编号列表', icon: ListOrdered, active: editor.isActive('orderedList'), disabled: false, action: () => editor.chain().focus().toggleOrderedList().run() },
    { label: '引用', icon: Quote, active: editor.isActive('blockquote'), disabled: false, action: () => editor.chain().focus().toggleBlockquote().run() },
    { label: '分割线', icon: SeparatorHorizontal, active: false, disabled: false, action: () => editor.chain().focus().setHorizontalRule().run() },
    { label: '清除格式', icon: RemoveFormatting, active: false, disabled: false, action: () => editor.chain().focus().unsetAllMarks().clearNodes().run() },
  ]

  return (
    <div className="papyrus-toolbar papyrus-scrollbar sticky top-0 z-20 flex h-10 items-center gap-0.5 overflow-x-auto border-b px-8">
      {controls.map((control) => {
        const Icon = control.icon

        return (
          <button
            key={control.label}
            type="button"
            title={control.label}
            aria-pressed={control.active}
            disabled={control.disabled}
            onClick={control.action}
            className={`grid size-7 place-items-center rounded-md disabled:cursor-not-allowed disabled:opacity-40 ${
              control.active
                ? 'bg-[#171714] text-[#fffefa]'
                : 'text-[#6f7168] hover:bg-[#f4ead8] hover:text-[#171714]'
            }`}
          >
            <Icon size={14} />
          </button>
        )
      })}
    </div>
  )
}

function useWritingEditor() {
  const setEditorContent = useAppStore((state) => state.setEditorContent)
  const editorHtml = useAppStore((state) => state.editorHtml)

  return useEditor({
    extensions: [
      StarterKit,
      AiDiffMark,
      AiRewriteExtension,
      InlineAutocomplete.configure({
        debounceMs: 300,
        provider: requestInlineCompletion,
      }),
      ProjectMention,
    ],
    content: editorHtml || initialContent,
    editorProps: {
      attributes: {
        class: 'min-h-[560px] px-10 py-8 outline-none focus:outline-none',
      },
    },
    onCreate: ({ editor }) =>
      setEditorContent({ text: editor.getText(), html: editor.getHTML() }),
    onUpdate: ({ editor }) =>
      setEditorContent({ text: editor.getText(), html: editor.getHTML() }),
  })
}

function getSelectedText(editor: Editor) {
  const { from, to } = editor.state.selection
  return editor.state.doc.textBetween(from, to, '\n').trim()
}

function applyDocumentPatch(editor: Editor, patch: DocumentPatch) {
  const paragraphs = patch.content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const nodes = paragraphs.map((paragraph) => ({
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: paragraph.replace(/\s*\n\s*/g, ' '),
        marks: [{ type: 'aiDiff' }],
      },
    ],
  }))

  if (!nodes.length) {
    return false
  }

  if (patch.operation === 'replace_document') {
    return editor.commands.setContent({ type: 'doc', content: nodes })
  }

  if (patch.operation === 'replace_selection' && !editor.state.selection.empty) {
    return editor.chain().focus().applyAiReplacement(patch.content).run()
  }

  if (patch.operation === 'insert_at_cursor') {
    return editor.chain().focus().insertContent(nodes).run()
  }

  return editor.chain().focus('end').insertContent(nodes).run()
}

type RewritePreviewState = {
  replacementText: string
  summary: string
  confidence: number
  removedSegments: string[]
  addedSegments: string[]
  notes: string[]
}

type CheckupState = {
  verdict: 'likely_human' | 'mixed' | 'likely_ai'
  summary: string
  confidence: number
  reasons: string[]
  signals: string[]
}
