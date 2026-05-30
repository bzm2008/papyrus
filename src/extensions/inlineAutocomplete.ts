import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

type InlineAutocompleteState = {
  text: string
  pos: number | null
  requestId: number
}

type InlineAutocompleteMeta =
  | { type: 'set'; text: string; pos: number; requestId: number }
  | { type: 'clear' }

type CompletionContext = {
  prefix: string
  suffix: string
  signal: AbortSignal
}

export type InlineAutocompleteOptions = {
  debounceMs: number
  provider: (context: CompletionContext) => Promise<string>
}

export const inlineAutocompletePluginKey = new PluginKey<InlineAutocompleteState>(
  'inlineAutocomplete',
)

export const InlineAutocomplete = Extension.create<InlineAutocompleteOptions>({
  name: 'inlineAutocomplete',

  addOptions() {
    return {
      debounceMs: 300,
      provider: async () => '',
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    let debounceTimer: number | undefined
    let abortController: AbortController | undefined
    let requestId = 0

    const clearSuggestion = (view: EditorView) => {
      view.dispatch(view.state.tr.setMeta(inlineAutocompletePluginKey, { type: 'clear' }))
    }

    const scheduleCompletion = (view: EditorView) => {
      window.clearTimeout(debounceTimer)
      abortController?.abort()

      const { state } = view
      const { selection } = state

      if (!selection.empty) {
        clearSuggestion(view)
        return
      }

      const pos = selection.from
      const prefix = state.doc.textBetween(Math.max(0, pos - 2200), pos, '\n', '\n')
      const suffix = state.doc.textBetween(pos, Math.min(state.doc.content.size, pos + 700), '\n', '\n')

      if (prefix.trim().length < 8) {
        clearSuggestion(view)
        return
      }

      abortController = new AbortController()
      const currentRequestId = ++requestId

      debounceTimer = window.setTimeout(() => {
        void options
          .provider({ prefix, suffix, signal: abortController?.signal ?? new AbortController().signal })
          .then((text) => {
            if (!text.trim() || currentRequestId !== requestId) {
              return
            }

            const latestSelection = view.state.selection

            if (!latestSelection.empty || latestSelection.from !== pos) {
              return
            }

            view.dispatch(
              view.state.tr.setMeta(inlineAutocompletePluginKey, {
                type: 'set',
                text,
                pos,
                requestId: currentRequestId,
              } satisfies InlineAutocompleteMeta),
            )
          })
      }, options.debounceMs)
    }

    return [
      new Plugin<InlineAutocompleteState>({
        key: inlineAutocompletePluginKey,
        state: {
          init: () => ({ text: '', pos: null, requestId: 0 }),
          apply: (tr: Transaction, value: InlineAutocompleteState) => {
            const meta = tr.getMeta(inlineAutocompletePluginKey) as InlineAutocompleteMeta | undefined

            if (meta?.type === 'set') {
              return {
                text: meta.text,
                pos: meta.pos,
                requestId: meta.requestId,
              }
            }

            if (meta?.type === 'clear') {
              return { text: '', pos: null, requestId: value.requestId }
            }

            if (tr.docChanged || tr.selectionSet) {
              return { text: '', pos: null, requestId: value.requestId }
            }

            return value
          },
        },
        props: {
          decorations(state) {
            const pluginState = inlineAutocompletePluginKey.getState(state)

            if (!pluginState?.text || pluginState.pos === null) {
              return DecorationSet.empty
            }

            const widget = Decoration.widget(
              pluginState.pos,
              () => {
                const span = document.createElement('span')
                span.className = 'papyrus-ghost-text'
                span.textContent = pluginState.text
                return span
              },
              { side: 1 },
            )

            return DecorationSet.create(state.doc, [widget])
          },
          handleKeyDown(view, event) {
            const pluginState = inlineAutocompletePluginKey.getState(view.state)

            if (!pluginState?.text || pluginState.pos === null) {
              return false
            }

            if (event.key === 'Tab') {
              event.preventDefault()
              view.dispatch(
                view.state.tr
                  .insertText(pluginState.text, pluginState.pos)
                  .setMeta(inlineAutocompletePluginKey, { type: 'clear' } satisfies InlineAutocompleteMeta),
              )
              return true
            }

            if (!isNavigationKey(event.key)) {
              clearSuggestion(view)
            }

            return false
          },
        },
        view(view) {
          scheduleCompletion(view)

          return {
            update(currentView, previousState) {
              const moved = !previousState.selection.eq(currentView.state.selection)
              const changed = previousState.doc !== currentView.state.doc

              if (moved || changed) {
                scheduleCompletion(currentView)
              }
            },
            destroy() {
              window.clearTimeout(debounceTimer)
              abortController?.abort()
            },
          }
        },
      }),
    ]
  },
})

function isNavigationKey(key: string) {
  return [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Shift',
    'Alt',
    'Control',
    'Meta',
    'Escape',
  ].includes(key)
}
