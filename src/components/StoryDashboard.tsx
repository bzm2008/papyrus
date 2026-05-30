import { AnimatePresence, motion } from 'framer-motion'
import { Activity, BookOpenText, GitCommitHorizontal, Network, ShieldCheck, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatStoryDashboard } from '../services/storyEngine'
import { useAppStore, type StoryStrand } from '../stores/useAppStore'

const strandLabels: Record<StoryStrand, string> = {
  quest: '主线',
  fire: '情感',
  constellation: '世界观',
}

export function StoryDashboard() {
  const open = useAppStore((state) => state.isStoryDashboardOpen)
  const setOpen = useAppStore((state) => state.setStoryDashboardOpen)
  const projectId = useAppStore((state) => state.activeStoryProjectId)
  const chapterCommits = useAppStore((state) => state.chapterCommits)
  const storyMemories = useAppStore((state) => state.storyMemories)
  const openLoops = useAppStore((state) => state.openLoops)
  const storyEvents = useAppStore((state) => state.storyEvents)
  const dashboard = formatStoryDashboard(projectId)
  const totalStrands = Math.max(
    1,
    dashboard.strandCounts.quest + dashboard.strandCounts.fire + dashboard.strandCounts.constellation,
  )

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 bg-[#171714]/24 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.section
            role="dialog"
            aria-label="作品体检"
            className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[#e4dccd] bg-[#fffefa] shadow-[0_24px_80px_rgba(31,25,17,0.18)]"
            initial={{ y: 18, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 12, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="flex h-14 items-center justify-between border-b border-[#eee8dc] px-5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#20201d]">作品体检</div>
                <div className="truncate text-xs text-[#7b776d]">
                  {dashboard.project
                    ? `${dashboard.project.title} · ${dashboard.project.genre}`
                    : '尚未建立作品合同，先在 Flow 中初始化或写一章。'}
                </div>
              </div>
              <button
                type="button"
                title="关闭"
                onClick={() => setOpen(false)}
                className="papyrus-icon-button size-9 rounded-lg"
              >
                <X size={17} />
              </button>
            </header>

            <div className="papyrus-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-4 md:grid-cols-4">
                <Metric icon={BookOpenText} label="章节提交" value={String(chapterCommits.length)} />
                <Metric icon={Network} label="结构记忆" value={String(storyMemories.length)} />
                <Metric icon={Activity} label="开放伏笔" value={String(openLoops.length)} />
                <Metric icon={ShieldCheck} label="事件投影" value={String(storyEvents.length)} />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <Panel title="节奏雷达" subtitle="Quest / Fire / Constellation">
                  <div className="space-y-3">
                    {(Object.keys(strandLabels) as StoryStrand[]).map((strand) => {
                      const value = dashboard.strandCounts[strand]
                      const percent = Math.round((value / totalStrands) * 100)

                      return (
                        <div key={strand}>
                          <div className="mb-1 flex justify-between text-xs text-[#6f7168]">
                            <span>{strandLabels[strand]}</span>
                            <span>{percent}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-[#ece6da]">
                            <div
                              className="h-full rounded-full bg-[#3f5845]"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Panel>

                <Panel title="伏笔追踪" subtitle="未回收的问题会进入后续上下文">
                  <div className="space-y-2">
                    {dashboard.loops.slice(0, 8).map((loop) => (
                      <div key={loop.id} className="rounded-lg border border-[#eee8dc] bg-[#fbfaf6] p-3">
                        <div className="text-sm text-[#2f2b22]">{loop.content}</div>
                        <div className="mt-1 text-xs text-[#8a857b]">
                          {loop.status} · urgency {loop.urgency}
                        </div>
                      </div>
                    ))}
                    {!dashboard.loops.length ? <Empty text="暂时没有开放伏笔。" /> : null}
                  </div>
                </Panel>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Panel title="章节提交链" subtitle="accepted 才会更新长期事实">
                  <div className="space-y-2">
                    {dashboard.commits.slice(0, 8).map((commit) => (
                      <div key={commit.id} className="rounded-lg border border-[#eee8dc] bg-white p-3">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="inline-flex items-center gap-1.5 font-medium text-[#3f5845]">
                            <GitCommitHorizontal size={13} />
                            {commit.status}
                          </span>
                          <span className="text-[#8a857b]">{commit.wordCount.toLocaleString()} 字</span>
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#2f2b22]">{commit.summary}</p>
                      </div>
                    ))}
                    {!dashboard.commits.length ? <Empty text="还没有章节提交。" /> : null}
                  </div>
                </Panel>

                <Panel title="长期记忆" subtitle="人物、规则、时间线、读者承诺">
                  <div className="space-y-2">
                    {dashboard.memories.slice(0, 10).map((memory) => (
                      <div key={memory.id} className="rounded-lg border border-[#eee8dc] bg-white p-3">
                        <div className="text-xs text-[#8a857b]">{memory.category}</div>
                        <div className="mt-1 text-sm text-[#2f2b22]">
                          {memory.subject}: {memory.value}
                        </div>
                      </div>
                    ))}
                    {!dashboard.memories.length ? <Empty text="还没有长期记忆。" /> : null}
                  </div>
                </Panel>
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BookOpenText
  label: string
  value: string
}) {
  return (
    <article className="rounded-xl border border-[#eee8dc] bg-white p-4">
      <Icon size={17} className="text-[#3f5845]" />
      <div className="mt-3 text-2xl font-semibold text-[#20201d]">{value}</div>
      <div className="mt-1 text-xs text-[#8a857b]">{label}</div>
    </article>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[#eee8dc] bg-[#fffdf7] p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-[#20201d]">{title}</div>
        <div className="text-xs text-[#8a857b]">{subtitle}</div>
      </div>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-[#d8cfbd] p-4 text-sm text-[#8a857b]">{text}</div>
}
