import { BookMarked, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { ProjectNavigator } from './ProjectNavigator'

export function LeftSidebar() {
  const collapsed = useAppStore((state) => state.isLeftCollapsed)
  const toggleLeftCollapsed = useAppStore((state) => state.toggleLeftCollapsed)

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f8f5ed]">
      <div className="papyrus-toolbar flex h-[58px] shrink-0 items-center justify-between border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#edf2e8] text-[#3f5845]">
            <BookMarked size={16} />
          </div>
          {!collapsed ? (
            <div className="min-w-0 leading-tight">
              <span className="block truncate text-[13px] font-semibold text-[#2f2b22]">项目</span>
              <span className="block truncate text-[10px] text-[#8f897a]">对话、文稿与资料</span>
            </div>
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
