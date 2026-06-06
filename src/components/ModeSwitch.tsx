import { motion } from 'framer-motion'
import { BrainCircuit, Feather } from 'lucide-react'
import { type AppMode, useAppStore } from '../stores/useAppStore'

const modes: Array<{
  value: AppMode
  label: string
  icon: typeof Feather
}> = [
  { value: 'companion', label: '秘书模式', icon: Feather },
  { value: 'flow', label: 'Flow 模式', icon: BrainCircuit },
]

export function ModeSwitch() {
  const mode = useAppStore((state) => state.mode)
  const setMode = useAppStore((state) => state.setMode)

  return (
    <div className="relative flex h-10 items-center rounded-xl border border-[#dfe4d6] bg-[#edf6eb] p-1 shadow-[0_1px_0_rgba(255,255,255,0.72)_inset]">
      {modes.map((item) => {
        const Icon = item.icon
        const active = mode === item.value

        return (
          <button
            key={item.value}
            type="button"
            title={`切换到${item.label}`}
            onClick={() => setMode(item.value)}
            className="relative z-10 flex h-8 w-32 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition"
          >
            {active ? (
              <motion.span
                layoutId="mode-switch-active"
                className="absolute inset-0 rounded-lg bg-[#fffefa] shadow-[0_8px_22px_rgba(43,34,19,0.1)]"
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              />
            ) : null}
            <Icon
              size={16}
              className={active ? 'relative text-[#315d39]' : 'relative text-[#6f7168]'}
            />
            <span className={active ? 'relative text-[#171714]' : 'relative text-[#5f6159]'}>
              {item.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
