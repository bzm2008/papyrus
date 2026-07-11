import type { WpsDocumentSnapshot, WpsPatchOperation } from '../types'

const DEBUG_KEY = 'papyrus.wps.addin.debug'

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
  Range?: {
    Text?: string
    EndKey?: (unit?: number) => void
  }
  TypeText?: (text: string) => void
  WholeStory?: () => void
  EndKey?: (unit?: number) => void
}

type WpsDocumentLike = {
  Content?: {
    Text?: string
    InsertAfter?: (text: string) => void
    Range?: {
      Text?: string
      InsertAfter?: (text: string) => void
    }
  }
  Range?: {
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
  applyPatch: (operation: WpsPatchOperation, content: string, expectedSelectionFingerprint?: string) => Promise<void>
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
    applyPatch: async (operation, content, expectedSelectionFingerprint) => applyWpsPatch(app, operation, content, expectedSelectionFingerprint),
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
      mode: 'mock',
    }),
    applyPatch: async (operation, content, expectedSelectionFingerprint) => {
      recordDebug('Mock apply patch', operation)
      if (operation === 'replace_selection' && expectedSelectionFingerprint && expectedSelectionFingerprint !== createSelectionFingerprint(mockDocument.selection)) {
        throw new Error('选区已变更，请重新生成后再替换。')
      }
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
    if (typeof wps?.WpsApplication === 'function') {
      const app = wps.WpsApplication()

      if (app) {
        return app
      }
    }

    if (wps?.Application) {
      return wps.Application
    }

    return (window as WpsLikeWindow & { Application?: WpsApplicationLike }).Application
  } catch {
    return undefined
  }
}

async function readWpsSnapshot(app: WpsApplicationLike): Promise<WpsDocumentSnapshot> {
  const selectionText = normalizeWpsText(
    readText(app.Selection?.Text) || readText(app.Selection?.Range?.Text),
  )
  const documentText = normalizeWpsText(
    readText(app.ActiveDocument?.Content?.Text) ||
      readText(app.ActiveDocument?.Content?.Range?.Text) ||
      readText(app.ActiveDocument?.Range?.Text) ||
      selectionText,
  )

  const snapshot = {
    selectionText,
    documentExcerpt: createExcerpt(documentText),
    cursorAvailable: Boolean(app.Selection),
    wordCount: countCjkFriendlyWords(documentText),
    mode: 'wps' as const,
  }

  recordDebug('Read WPS snapshot', {
    selectionLength: selectionText.length,
    excerptLength: snapshot.documentExcerpt.length,
    cursorAvailable: snapshot.cursorAvailable,
  })

  return snapshot
}

async function applyWpsPatch(
  app: WpsApplicationLike,
  operation: WpsPatchOperation,
  content: string,
  expectedSelectionFingerprint?: string,
) {
  const normalized = content.trim()

  if (!normalized) {
    return
  }

  if (operation === 'copy_only') {
    await navigator.clipboard?.writeText(normalized)
    recordDebug('Copied patch', { length: normalized.length })
    return
  }

  const selection = app.Selection

  if (!selection) {
    throw new Error('WPS 当前没有可写入的光标或选区。')
  }

  if (operation === 'replace_selection' || operation === 'insert_at_cursor') {
    if (operation === 'replace_selection' && expectedSelectionFingerprint) {
      const currentSelection = normalizeWpsText(readText(selection.Text) || readText(selection.Range?.Text))
      if (createSelectionFingerprint(currentSelection) !== expectedSelectionFingerprint) {
        throw new Error('选区已变更，请重新生成后再替换。')
      }
    }
    if (typeof selection.TypeText === 'function') {
      selection.TypeText(normalized)
      recordDebug('Applied patch via Selection.TypeText', { operation, length: normalized.length })
      return
    }

    if (selection.Range) {
      selection.Range.Text = normalized
      recordDebug('Applied patch via Selection.Range.Text', { operation, length: normalized.length })
      return
    }

    selection.Text = normalized
    recordDebug('Applied patch via Selection.Text', { operation, length: normalized.length })
    return
  }

  if (operation === 'append_document') {
    const contentRange = app.ActiveDocument?.Content

    if (typeof contentRange?.InsertAfter === 'function') {
      contentRange.InsertAfter(`\n\n${normalized}`)
      recordDebug('Applied patch via Document.Content.InsertAfter', { length: normalized.length })
      return
    }

    if (typeof app.ActiveDocument?.Range?.InsertAfter === 'function') {
      app.ActiveDocument.Range.InsertAfter(`\n\n${normalized}`)
      recordDebug('Applied patch via Document.Range.InsertAfter', { length: normalized.length })
      return
    }

    selection.EndKey?.(6)
    selection.TypeText?.(`\n\n${normalized}`)
    recordDebug('Applied patch via Selection.EndKey/TypeText fallback', { length: normalized.length })
    return
  }

  throw new Error('暂不支持该写入方式。')
}

function normalizeWpsText(value: string) {
  return value.replace(/\r\n?/g, '\n').split('\u0007').join('').trim()
}

export function createSelectionFingerprint(selection: string) {
  const normalized = normalizeWpsText(selection)
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${normalized.length}:${(hash >>> 0).toString(16)}`
}

function readText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function recordDebug(message: string, detail?: unknown) {
  try {
    const entry = {
      time: new Date().toISOString(),
      message,
      detail,
    }
    const raw = window.localStorage.getItem(DEBUG_KEY)
    const items = raw ? (JSON.parse(raw) as unknown[]) : []
    items.push(entry)
    window.localStorage.setItem(DEBUG_KEY, JSON.stringify(items.slice(-80)))
  } catch {
    // Older WPS webviews can fail localStorage access; diagnostics must not break writing.
  }
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
