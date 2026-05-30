import Mention from '@tiptap/extension-mention'
import type { Editor } from '@tiptap/core'
import { useAppStore, type MentionContextItem } from '../stores/useAppStore'
import { searchProjectMentionItems } from '../services/projectContext'

type MentionCommandProps = {
  editor: Editor
  range: { from: number; to: number }
  props: {
    id?: string | null
    label?: string | null
    type?: string | null
  }
}

type SuggestionRenderProps = {
  items: MentionContextItem[]
  command: (item: MentionContextItem) => void
  clientRect?: (() => DOMRect | null) | null
}

export const ProjectMention = Mention.configure({
  HTMLAttributes: {
    class: 'papyrus-mention',
  },
  renderText({ node }) {
    return `@${node.attrs.label}`
  },
  suggestion: {
    char: '@',
    items: ({ query }: { query: string }) => searchProjectMentionItems(query),
    command: ({ editor, range, props }: MentionCommandProps) => {
      const item = findMentionItem(props)

      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: 'mention',
            attrs: {
              id: item.id,
              label: item.label,
              type: item.type,
            },
          },
          { type: 'text', text: ' ' },
        ])
        .run()
      useAppStore.getState().addMentionContextItem(item)
    },
    render: () => {
      let element: HTMLDivElement | null = null
      let selectedIndex = 0
      let currentProps: SuggestionRenderProps | null = null

      const renderItems = () => {
        if (!element || !currentProps) {
          return
        }

        element.innerHTML = ''

        currentProps.items.forEach((item, index) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = `papyrus-mention-item ${index === selectedIndex ? 'is-selected' : ''}`
          button.innerHTML = `<span>${item.label}</span><small>${labelForType(item.type)}</small>`
          button.addEventListener('mousedown', (event) => {
            event.preventDefault()
            currentProps?.command(item)
          })
          element?.appendChild(button)
        })

        if (!currentProps.items.length) {
          const empty = document.createElement('div')
          empty.className = 'papyrus-mention-empty'
          empty.textContent = '没有匹配的项目对象'
          element.appendChild(empty)
        }

        updatePosition()
      }

      const updatePosition = () => {
        if (!element || !currentProps?.clientRect) {
          return
        }

        const rect = currentProps.clientRect()

        if (!rect) {
          return
        }

        element.style.left = `${rect.left}px`
        element.style.top = `${rect.bottom + 8}px`
      }

      return {
        onStart: (props: SuggestionRenderProps) => {
          currentProps = props
          selectedIndex = 0
          element = document.createElement('div')
          element.className = 'papyrus-mention-menu'
          document.body.appendChild(element)
          renderItems()
        },
        onUpdate: (props: SuggestionRenderProps) => {
          currentProps = props
          selectedIndex = Math.min(selectedIndex, Math.max(0, props.items.length - 1))
          renderItems()
        },
        onKeyDown: ({ event }: { event: KeyboardEvent }) => {
          if (!currentProps?.items.length) {
            return false
          }

          if (event.key === 'ArrowDown') {
            selectedIndex = (selectedIndex + 1) % currentProps.items.length
            renderItems()
            return true
          }

          if (event.key === 'ArrowUp') {
            selectedIndex =
              (selectedIndex + currentProps.items.length - 1) % currentProps.items.length
            renderItems()
            return true
          }

          if (event.key === 'Enter') {
            currentProps.command(currentProps.items[selectedIndex])
            return true
          }

          return false
        },
        onExit: () => {
          element?.remove()
          element = null
          currentProps = null
        },
      }
    },
  },
})

function findMentionItem(props: MentionCommandProps['props']): MentionContextItem {
  const id = props.id ?? ''
  const label = props.label ?? id
  const item = searchProjectMentionItems(label).find((candidate) => candidate.id === id)

  return (
    item ?? {
      id,
      label,
      type: props.type === 'character' || props.type === 'world' ? props.type : 'chapter',
      excerpt: label,
    }
  )
}

function labelForType(type: MentionContextItem['type']) {
  const labels: Record<MentionContextItem['type'], string> = {
    chapter: '章节',
    character: '人物',
    world: '设定',
  }

  return labels[type]
}
