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
  Strikethrough,
  Undo2,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { AiDiffMark, AiRewriteExtension } from '../extensions/aiRewrite'
import { InlineAutocomplete } from '../extensions/inlineAutocomplete'
import { ProjectMention } from '../extensions/projectMention'
import { formatChangeStat, recordDocumentChange } from '../services/documentChangeStatsService'
import { requestInlineCompletion } from '../services/localAutocomplete'
import { runCompanionRewrite, type WritingAction } from '../services/writingActions'
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
}> = [
  { label: '指令', icon: MessageSquareText },
  { label: '审查', icon: ScanText },
  { label: '纠错', icon: CheckCheck },
  { label: '查重', icon: FileSearch },
  { label: '降噪', icon: ShieldCheck },
]

export function WritingEditor() {
  const [customPromptOpen, setCustomPromptOpen] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [actionNotice, setActionNotice] = useState<{
    status: 'running' | 'completed' | 'error'
    title: string
    detail: string
  } | null>(null)
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

    setIsRunning(true)
    setActionNotice({
      status: 'running',
      title: `${action}处理中`,
      detail: selectedText ? `正在处理选中的 ${selectedText.length} 字。` : '请先选中一段文稿。',
    })
    setLlmRunState('running', '伴写正在处理选区')

    try {
      const replacement = await runCompanionRewrite({
        action,
        selectedText,
        customPrompt: prompt,
        provider,
      })

      editor.chain().focus().applyAiReplacement(replacement).run()
      setActionNotice({
        status: 'completed',
        title: `${action}已应用`,
        detail: '选区已原位替换，并用浅金色标出本次 AI 改动。',
      })
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
          className="papyrus-panel w-[min(520px,calc(100vw-32px))] rounded-xl p-2"
        >
          <div className="grid grid-cols-6 gap-1">
            {actions.map((action) => {
              const Icon = action.icon

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
                  className="flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-[#6f7168] hover:bg-[#f4ead8] hover:text-[#3f5845] disabled:cursor-wait disabled:opacity-50"
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
              className="flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-[#6f7168] hover:bg-[#fff1f1] hover:text-rose-700"
            >
              <Ban size={13} />
              拒绝
            </button>
          </div>

          <ActionNotice notice={actionNotice} />

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

function ActionNotice({
  notice,
}: {
  notice: {
    status: 'running' | 'completed' | 'error'
    title: string
    detail: string
  } | null
}) {
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
