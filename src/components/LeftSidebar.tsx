import { BookMarked, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { ProjectNavigator } from './ProjectNavigator'

export function LeftSidebar() {
  const collapsed = useAppStore((state) => state.isLeftCollapsed)
  const toggleLeftCollapsed = useAppStore((state) => state.toggleLeftCollapsed)

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fffefa]/72">
      <div className="papyrus-toolbar flex h-11 shrink-0 items-center justify-between border-b px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <BookMarked size={16} className="shrink-0 text-[#6f7f68]" />
          {!collapsed ? (
            <span className="truncate text-[13px] font-semibold text-[#2f2b22]">项目</span>
          ) : null}
        </div>
        <button
          type="button"
          title={collapsed ? '展开左侧栏' : '折叠左侧栏'}
          onClick={toggleLeftCollapsed}
          className="papyrus-icon-button size-7 rounded-md border-0 bg-transparent"
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      <ProjectNavigator collapsed={collapsed} />
    </div>
  )
}
