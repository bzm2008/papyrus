import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function SecretaryResultDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const shouldReduceMotion = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      closeButtonRef.current?.focus()
      return
    }

    returnFocusRef.current?.focus()
    returnFocusRef.current = null
  }, [open])

  const close = () => {
    onClose()
    returnFocusRef.current?.focus()
  }

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }

    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter((element) => !element.hasAttribute('disabled') && !element.hidden && element.getAttribute('aria-hidden') !== 'true')

    if (!focusable.length) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable.at(-1)
    const current = document.activeElement
    if (event.shiftKey && (current === first || !dialogRef.current?.contains(current))) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && (current === last || !dialogRef.current?.contains(current))) {
      event.preventDefault()
      first.focus()
    }
  }

  const motionTransition = shouldReduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 42, mass: 0.8 }

  return (
    <AnimatePresence initial={!shouldReduceMotion}>
      {open ? (
        <motion.div
          key="secretary-result-drawer"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16 }}
          className="fixed inset-0 z-50 bg-[#201f1a]/20 p-3 sm:p-4"
          onMouseDown={close}
          data-reduced-motion={shouldReduceMotion ? 'true' : 'false'}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="秘书成果"
            tabIndex={-1}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: 12 }}
            transition={motionTransition}
            className="mx-auto flex h-full max-w-[960px] flex-col overflow-hidden rounded-lg border border-[#e1dccf] bg-[#fffefa] shadow-[0_24px_80px_rgba(43,34,19,0.18)]"
            onKeyDown={trapFocus}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-11 shrink-0 items-center justify-end border-b border-[#e1dccf] px-2">
              <button ref={closeButtonRef} type="button" title="关闭秘书成果" aria-label="关闭秘书成果" onClick={close} className="papyrus-icon-button grid size-7 place-items-center rounded-md">
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
