import { AnimatePresence, motion } from 'framer-motion'
import { getSlashQuery, slashCommands, type SlashCommand, type SlashCommandScope } from './slashCommands'

export function SlashCommandMenu({
  scope,
  value,
  onPick,
}: {
  scope: SlashCommandScope
  value: string
  onPick: (command: SlashCommand) => void
}) {
  const query = getSlashQuery(value)
  const visible = query !== null
  const filtered = slashCommands
    .filter((command) => command.scopes.includes(scope))
    .filter((command) => {
      if (!query) {
        return true
      }

      const haystack = `${command.label} ${command.description} ${command.id}`.toLowerCase()
      return haystack.includes(query.toLowerCase())
    })
    .slice(0, 6)

  return (
    <AnimatePresence>
      {visible && filtered.length ? (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-1.5 shadow-[0_18px_50px_rgba(43,34,19,0.14)]"
        >
          <div className="px-2 py-1 text-[11px] font-medium uppercase text-[#9d988a]">
            / 指令
          </div>
          <div className="space-y-1">
            {filtered.map((command) => {
              const Icon = command.icon

              return (
                <button
                  key={command.id}
                  type="button"
                  onClick={() => onPick(command)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-[#f4ead8]"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f5f2ea] text-[#3f5845]">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[#2f2b22]">
                      {command.label}
                    </span>
                    <span className="block truncate text-xs text-[#8f897a]">
                      {command.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
