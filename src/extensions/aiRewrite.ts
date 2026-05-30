import { Extension, Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiRewrite: {
      applyAiReplacement: (text: string) => ReturnType
    }
  }
}

export const AiDiffMark = Mark.create({
  name: 'aiDiff',

  parseHTML() {
    return [{ tag: 'span[data-ai-diff]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-ai-diff': 'replacement',
        class: 'ai-diff-replacement',
      }),
      0,
    ]
  },
})

export const AiRewriteExtension = Extension.create({
  name: 'aiRewrite',

  addCommands() {
    return {
      applyAiReplacement:
        (text) =>
        ({ commands, state }) => {
          const { from, to, empty } = state.selection
          const normalizedText = text.trim().replace(/\s*\n+\s*/g, ' ')

          if (empty || !normalizedText) {
            return false
          }

          return commands.insertContentAt(
            { from, to },
            {
              type: 'text',
              text: normalizedText,
              marks: [{ type: 'aiDiff' }],
            },
          )
        },
    }
  },
})
