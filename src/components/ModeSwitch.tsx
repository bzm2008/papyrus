import { motion } from 'framer-motion'
import { BrainCircuit, Feather } from 'lucide-react'
import { type AppMode, useAppStore } from '../stores/useAppStore'

const modes: Array<{
  value: AppMode
  label: string
  icon: typeof Feather
}> = [
  { value: 'companion', label: '写作模式', icon: Feather },
  { value: 'flow', label: '秘书模式', icon: BrainCircuit },
]

export function ModeSwitch() {
  const mode = useAppStore((state) => state.mode)
  const setMode = useAppStore((state) => state.setMode)

  return (
    <div className="relative flex h-8 items-center rounded-lg border border-[#dfe4d6] bg-[#edf6eb]/86 p-0.5 shadow-[0_1px_0_rgba(255,255,255,0.78)_inset]">
      {modes.map((item) => {
        const Icon = item.icon
        const active = mode === item.value

        return (
          <button
            key={item.value}
            type="button"
            title={'切换到' + item.label}
            onClick={() => setMode(item.value)}
            className="relative z-10 flex h-7 w-28 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-medium"
          >
            {active ? (
              <motion.span
                layoutId="mode-switch-active"
                className="absolute inset-0 rounded-md bg-[#fffefa] shadow-[0_5px_16px_rgba(43,34,19,0.08)]"
                transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
              />
            ) : null}
            <Icon
              size={14}
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
