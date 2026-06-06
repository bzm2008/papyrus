import { AnimatePresence, motion } from 'framer-motion'
import { FileText, Sparkles } from 'lucide-react'
import { searchAgentSkills, type AgentSkill } from '../services/agentSkillLibrary'
import { useAppStore, type ImportedResource, type MentionContextItem } from '../stores/useAppStore'

type PromptAssistKind = 'skill' | 'file'

type PromptAssistQuery =
  | {
      kind: PromptAssistKind
      query: string
      start: number
      end: number
    }
  | undefined

export function PromptAssistMenu({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const query = getPromptAssistQuery(value)
  const resources = useAppStore((state) => state.resources)
  const addMentionContextItem = useAppStore((state) => state.addMentionContextItem)

  if (!query) {
    return null
  }

  const skillItems = query.kind === 'skill' ? searchAgentSkills(query.query, 7) : []
  const fileItems =
    query.kind === 'file'
      ? resources
          .filter((resource) => resource.type !== 'folder')
          .filter((resource) => {
            const haystack = `${resource.name} ${resource.path}`.toLowerCase()
            return !query.query || haystack.includes(query.query.toLowerCase())
          })
          .slice(0, 7)
      : []
  const hasItems = skillItems.length || fileItems.length

  const replaceToken = (label: string) => {
    const next = `${value.slice(0, query.start)}${query.kind === 'skill' ? '@' : '#'}${label} ${value.slice(query.end)}`
    onChange(next)
  }

  const pickSkill = (skill: AgentSkill) => {
    replaceToken(skill.shortName)
    addMentionContextItem({
      id: `skill-${skill.id}`,
      type: 'skill',
      label: skill.name,
      excerpt: [
        skill.trigger,
        ...skill.instructions.slice(0, 3).map((item) => `- ${item}`),
      ].join('\n'),
    })
  }

  const pickFile = (resource: ImportedResource) => {
    replaceToken(resource.name)
    addMentionContextItem(resourceToMentionItem(resource))
  }

  return (
    <AnimatePresence>
      {hasItems ? (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[#d9decf] bg-[#fffefa] p-1.5 shadow-[0_18px_50px_rgba(35,43,28,0.14)]"
        >
          <div className="px-2 py-1 text-[11px] font-medium text-[#6f7168]">
            {query.kind === 'skill' ? '@ 技能' : '# 文件'}
          </div>
          <div className="space-y-1">
            {skillItems.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => pickSkill(skill)}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-[#edf6eb]"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#edf6eb] text-[#315d39]">
                  <Sparkles size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[#20201d]">
                    {skill.name}
                  </span>
                  <span className="block truncate text-xs text-[#6f7168]">{skill.trigger}</span>
                </span>
              </button>
            ))}
            {fileItems.map((resource) => (
              <button
                key={resource.id}
                type="button"
                onClick={() => pickFile(resource)}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-[#edf6eb]"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f5f2ea] text-[#315d39]">
                  <FileText size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[#20201d]">
                    {resource.name}
                  </span>
                  <span className="block truncate text-xs text-[#6f7168]">
                    {resource.tokenCount} tokens
                  </span>
                </span>
              </button>
            ))}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function getPromptAssistQuery(value: string): PromptAssistQuery {
  const match = value.match(/(?:^|\s)([@#])([\p{L}\p{N}_\-.\u4e00-\u9fa5]*)$/u)

  if (!match || match.index === undefined) {
    return undefined
  }

  const trigger = match[1]
  const token = match[2] ?? ''
  const start = match.index + match[0].lastIndexOf(trigger)

  return {
    kind: trigger === '@' ? 'skill' : 'file',
    query: token,
    start,
    end: value.length,
  }
}

function resourceToMentionItem(resource: ImportedResource): MentionContextItem {
  return {
    id: `resource-${resource.id}`,
    type: 'file',
    label: resource.name,
    excerpt: resource.content.slice(0, 1600) || resource.path,
  }
}
