import { AnimatePresence, motion } from 'framer-motion'
import { Settings, Sparkles } from 'lucide-react'
import { useEffect } from 'react'
import { useContextAutomation } from '../hooks/useContextAutomation'
import { useProjectGuidance } from '../hooks/useProjectGuidance'
import { useRemoteRelay } from '../hooks/useRemoteRelay'
import { refreshHardwareCapabilityProfile } from '../services/hardwareCapabilityService'
import { ensureBrowserBridgeReady } from '../services/browserBridgeClient'
import { refreshScallionRuntimeMetadata } from '../services/scallionAccountService'
import { verifyUpdateDataAfterStartup } from '../services/updateDataProtection'
import { useAppStore } from '../stores/useAppStore'
import { BrandMark } from './BrandMark'
import { EditorPane } from './EditorPane'
import { FlowWorkspace } from './FlowWorkspace'
import { LeftSidebar } from './LeftSidebar'
import { MaintenanceConsole } from './MaintenanceConsole'
import { ModeSwitch } from './ModeSwitch'
import { OnboardingShowcase } from './OnboardingShowcase'
import { RightPanel } from './RightPanel'
import { SettingsPanel } from './SettingsPanel'
import { StatusBar } from './StatusBar'
import { StoryDashboard } from './StoryDashboard'

export function AppShell() {
  const isFirstLaunch = useAppStore((state) => state.isFirstLaunch)
  const isEnvReady = useAppStore((state) => state.isEnvReady)

  useEffect(() => {
    void verifyUpdateDataAfterStartup()
  }, [])

  return (
    <AnimatePresence mode="wait" initial={false}>
      {isFirstLaunch ? (
        <motion.div
          key="onboarding"
          className="h-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24 }}
        >
          <OnboardingShowcase />
        </motion.div>
      ) : !isEnvReady ? (
        <motion.div
          key="maintenance"
          className="h-screen"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          <MaintenanceConsole />
        </motion.div>
      ) : (
        <motion.div
          key="workbench"
          className="h-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24 }}
        >
          <MainWorkbench />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function MainWorkbench() {
  useContextAutomation()
  useProjectGuidance()
  useRemoteRelay()

  const scallionToken = useAppStore((state) => state.scallionToken)
  const columnMode = useAppStore((state) => state.columnMode)
  const isLeftCollapsed = useAppStore((state) => state.isLeftCollapsed)
  const mode = useAppStore((state) => state.mode)
  const activeVibeId = useAppStore((state) => state.activeVibeId)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)

  useEffect(() => {
    void refreshScallionRuntimeMetadata()
  }, [scallionToken])

  useEffect(() => {
    if (!scallionToken) {
      return undefined
    }

    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void refreshScallionRuntimeMetadata()
      }
    }
    const timer = window.setInterval(() => {
      refresh()
    }, 30000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [scallionToken])

  useEffect(() => {
    refreshHardwareCapabilityProfile()
  }, [])

  useEffect(() => {
    // The loopback listener is local-only and safe to start at launch. The
    // browser extension still controls which tab is authorized.
    void ensureBrowserBridgeReady().catch(() => undefined)
  }, [])

  const isFlowMode = mode === 'flow'
  const showLeft = columnMode === 3
  const showRight = !isFlowMode && columnMode >= 2

  return (
    <div
      data-vibe={activeVibeId}
      className="papyrus-grain flex h-screen min-h-0 flex-col overflow-hidden text-[#171714]"
    >
      <header className="papyrus-toolbar grid h-12 shrink-0 grid-cols-[minmax(180px,1fr)_auto_minmax(180px,1fr)] items-center border-b px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark size="sm" />
          <div className="min-w-0 leading-tight">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              Papyrus
              <Sparkles size={12} className="shrink-0 text-[#31a96b]" />
            </div>
            <div className="truncate text-[11px] text-[#6f7168]">文学与文科写作工作台</div>
          </div>
        </div>

        <ModeSwitch />

        <button
          type="button"
          title="打开模型与全局设置"
          onClick={() => setSettingsOpen(true)}
          className="papyrus-icon-button ml-auto size-8 rounded-lg"
        >
          <Settings size={16} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {showLeft ? (
            <motion.aside
              key="left-sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: isLeftCollapsed ? 72 : 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="min-h-0 shrink-0 overflow-hidden border-r border-[#e1dccf] bg-[#fffefa]"
            >
              <LeftSidebar />
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <main className="min-w-0 flex-1 bg-[#fbfaf6]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              className="h-full min-h-0"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
              {isFlowMode ? <FlowWorkspace /> : <EditorPane />}
            </motion.div>
          </AnimatePresence>
        </main>

        <AnimatePresence initial={false}>
          {showRight ? (
            <motion.aside
              key="right-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 420, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="min-h-0 shrink-0 overflow-hidden border-l border-[#e1dccf] bg-[#fffefa]"
            >
              <RightPanel />
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>

      <StatusBar />
      <SettingsPanel />
      <StoryDashboard />
    </div>
  )
}

