import { Download, FilePenLine, FilePlus2, Printer, Quote, Sparkles } from 'lucide-react'
import { exportTextDocument } from '../services/textExportService'
import { exportWordDocument } from '../services/wordExportService'
import { useAppStore } from '../stores/useAppStore'
import { WritingEditor } from './WritingEditor'

export function EditorPane() {
  const articleTitle = useAppStore((state) => state.articleTitle)
  const editorHtml = useAppStore((state) => state.editorHtml)
  const editorText = useAppStore((state) => state.editorText)
  const newArticle = useAppStore((state) => state.newArticle)

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#e1dccf] bg-[#fffefa]/92 px-5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-[#20201d]">
          <FilePenLine size={17} className="shrink-0 text-[#315d39]" />
          <span className="truncate">{articleTitle}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#6f7168]">
          <button
            type="button"
            title="新建文稿"
            onClick={newArticle}
            className="papyrus-icon-button size-8 rounded-lg"
          >
            <FilePlus2 size={15} />
          </button>
          <button
            type="button"
            title="导出 Word"
            onClick={() => void exportWordDocument(articleTitle, editorHtml, editorText)}
            className="papyrus-icon-button size-8 rounded-lg"
          >
            <Download size={15} />
          </button>
          <button
            type="button"
            title="导出 UTF-8 TXT"
            onClick={() => exportTextDocument(articleTitle, editorText)}
            className="papyrus-icon-button h-8 rounded-lg px-2 text-[11px] font-semibold"
          >
            TXT
          </button>
          <button
            type="button"
            title="打印"
            onClick={() => window.print()}
            className="papyrus-icon-button size-8 rounded-lg"
          >
            <Printer size={15} />
          </button>
          <Sparkles size={13} className="ml-1 text-[#31a96b]" />
          <span>Tiptap</span>
        </div>
      </div>

      <div className="papyrus-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="papyrus-surface mx-auto flex min-h-full w-full max-w-[920px] flex-col overflow-hidden rounded-lg">
          <div className="border-b border-[#ebe5d7] bg-[#fffdf7] px-10 py-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#6f7168]">
              <Quote size={14} className="text-[#31a96b]" />
              <span>草稿</span>
              <span className="size-1 rounded-full bg-[#31a96b]/45" aria-hidden="true" />
              <span>可直接编辑</span>
              <span className="size-1 rounded-full bg-[#31a96b]/45" aria-hidden="true" />
              <span>选区伴写已启用</span>
              <span className="size-1 rounded-full bg-[#31a96b]/45" aria-hidden="true" />
              <span>@ 引用项目对象</span>
            </div>
          </div>
          <WritingEditor />
        </div>
      </div>
    </section>
  )
}
