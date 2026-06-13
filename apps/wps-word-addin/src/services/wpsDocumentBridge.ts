import type { WpsDocumentSnapshot, WpsPatchOperation } from '../types'

type WpsLikeWindow = Window &
  typeof globalThis & {
    wps?: {
      WpsApplication?: () => WpsApplicationLike
      Application?: WpsApplicationLike
    }
  }

type WpsApplicationLike = {
  Selection?: WpsSelectionLike
  ActiveDocument?: WpsDocumentLike
}

type WpsSelectionLike = {
  Text?: string
  TypeText?: (text: string) => void
  WholeStory?: () => void
  EndKey?: (unit?: number) => void
}

type WpsDocumentLike = {
  Content?: {
    Text?: string
    InsertAfter?: (text: string) => void
  }
}

export type WpsBridgeStatus =
  | 'ready'
  | 'mock'
  | 'not_in_wps'
  | 'no_selection'
  | 'write_failed'

export type WpsDocumentBridge = {
  isMock: boolean
  getSnapshot: () => Promise<WpsDocumentSnapshot>
  applyPatch: (operation: WpsPatchOperation, content: string) => Promise<void>
  getStatus: () => WpsBridgeStatus
}

const mockDocument = {
  text: [
    '莎草纸示例文档',
    '',
    '这里是一段正在写作中的说明文字。你可以在浏览器预览模式中测试 Papyrus 侧边栏的问答、润色、续写和写入流程。',
    '',
    '真正运行在 WPS 文字中时，插件会读取当前选区和文档摘要，并在你确认后替换选区、插入到光标或追加到文末。',
  ].join('\n'),
  selection: '这里是一段正在写作中的说明文字。',
}

export function createWpsDocumentBridge(): WpsDocumentBridge {
  const app = getWpsApplication()

  if (!app) {
    return createMockBridge()
  }

  return {
    isMock: false,
    getStatus: () => 'ready',
    getSnapshot: async () => readWpsSnapshot(app),
    applyPatch: async (operation, content) => applyWpsPatch(app, operation, content),
  }
}

function createMockBridge(): WpsDocumentBridge {
  return {
    isMock: true,
    getStatus: () => 'mock',
    getSnapshot: async () => ({
      selectionText: mockDocument.selection,
      documentExcerpt: mockDocument.text.slice(0, 4200),
      cursorAvailable: true,
      wordCount: countCjkFriendlyWords(mockDocument.text),
    }),
    applyPatch: async (operation, content) => {
      if (operation === 'replace_selection') {
        mockDocument.text = mockDocument.text.replace(mockDocument.selection, content)
        mockDocument.selection = content.slice(0, 120)
        return
      }

      if (operation === 'insert_at_cursor') {
        mockDocument.text = `${mockDocument.text}\n${content}`
        return
      }

      if (operation === 'append_document') {
        mockDocument.text = `${mockDocument.text}\n\n${content}`
      }
    },
  }
}

function getWpsApplication() {
  const wps = (window as WpsLikeWindow).wps

  try {
    return wps?.WpsApplication?.() ?? wps?.Application
  } catch {
    return undefined
  }
}

async function readWpsSnapshot(app: WpsApplicationLike): Promise<WpsDocumentSnapshot> {
  const selectionText = normalizeWpsText(app.Selection?.Text ?? '')
  const documentText = normalizeWpsText(app.ActiveDocument?.Content?.Text ?? selectionText)

  return {
    selectionText,
    documentExcerpt: createExcerpt(documentText),
    cursorAvailable: Boolean(app.Selection),
    wordCount: countCjkFriendlyWords(documentText),
  }
}

async function applyWpsPatch(
  app: WpsApplicationLike,
  operation: WpsPatchOperation,
  content: string,
) {
  const normalized = content.trim()

  if (!normalized) {
    return
  }

  if (operation === 'copy_only') {
    await navigator.clipboard?.writeText(normalized)
    return
  }

  const selection = app.Selection

  if (!selection) {
    throw new Error('WPS 当前没有可写入的光标或选区。')
  }

  if (operation === 'replace_selection' || operation === 'insert_at_cursor') {
    if (typeof selection.TypeText === 'function') {
      selection.TypeText(normalized)
      return
    }

    selection.Text = normalized
    return
  }

  if (operation === 'append_document') {
    const contentRange = app.ActiveDocument?.Content

    if (typeof contentRange?.InsertAfter === 'function') {
      contentRange.InsertAfter(`\n\n${normalized}`)
      return
    }

    selection.EndKey?.(6)
    selection.TypeText?.(`\n\n${normalized}`)
    return
  }

  throw new Error('暂不支持该写入方式。')
}

function normalizeWpsText(value: string) {
  return value.replace(/\r/g, '\n').split('\u0007').join('').trim()
}

function createExcerpt(text: string) {
  const normalized = text.trim()

  if (normalized.length <= 4200) {
    return normalized
  }

  return `${normalized.slice(0, 2200)}\n\n...[中间内容已省略]...\n\n${normalized.slice(-1600)}`
}

function countCjkFriendlyWords(text: string) {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const words = text.match(/[A-Za-z0-9]+/g)?.length ?? 0
  return cjk + words
}
