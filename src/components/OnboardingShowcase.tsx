import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import { ArrowLeft, ArrowRight, AtSign, Check, GitBranch, MousePointer2, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { BrandMark } from './BrandMark'

type ShowcaseCard = {
  id: string
  eyebrow: string
  title: string
  copy: string
  visual: 'companion' | 'flow' | 'rag'
}

const cards: ShowcaseCard[] = [
  {
    id: 'companion',
    eyebrow: 'Companion',
    title: '伴写模式',
    copy: '原位协作，不打断你的文学心流',
    visual: 'companion',
  },
  {
    id: 'flow',
    eyebrow: 'Flow',
    title: '虚拟编辑部',
    copy: '多智能体协作，你的秘书长与工作室',
    visual: 'flow',
  },
  {
    id: 'omniscient',
    eyebrow: 'RAG',
    title: '全知视界',
    copy: 'RAG 加持，告别设定冲突与人物 OOC',
    visual: 'rag',
  },
]

const swipeConfidenceThreshold = 4800
const carouselVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 54 : -54, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -54 : 54, opacity: 0 }),
}

export function OnboardingShowcase() {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const setFirstLaunchComplete = useAppStore((state) => state.setFirstLaunchComplete)
  const activeCard = cards[index]
  const isLast = index === cards.length - 1

  const progressLabel = useMemo(() => `${index + 1} / ${cards.length}`, [index])

  const paginate = (nextDirection: number) => {
    const nextIndex = Math.min(cards.length - 1, Math.max(0, index + nextDirection))

    if (nextIndex === index) {
      return
    }

    setDirection(nextDirection)
    setIndex(nextIndex)
  }

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const swipe = Math.abs(info.offset.x) * info.velocity.x

    if (swipe < -swipeConfidenceThreshold) {
      paginate(1)
      return
    }

    if (swipe > swipeConfidenceThreshold) {
      paginate(-1)
    }
  }

  return (
    <div className="papyrus-grain flex h-screen min-h-0 flex-col overflow-hidden bg-[#fbfaf6] text-[#171714]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#eee8dc] bg-[#fffefa]/92 px-5">
        <div className="flex items-center gap-3">
          <BrandMark size="sm" />
          <div>
            <div className="text-sm font-semibold">Papyrus</div>
            <div className="text-xs text-[#7d7a70]">初始化向导</div>
          </div>
        </div>
        <div className="rounded-full border border-[#e8ddc7] bg-[#fffefa] px-3 py-1 text-xs text-[#7d7a70]">
          {progressLabel}
        </div>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.section
            key={activeCard.id}
            custom={direction}
            variants={carouselVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.16}
            onDragEnd={handleDragEnd}
            className="absolute inset-0 grid min-h-0 grid-cols-1 gap-8 px-6 py-8 md:grid-cols-[minmax(320px,0.92fr)_minmax(420px,1.28fr)] md:px-12 lg:px-20"
          >
            <div className="flex min-w-0 flex-col justify-center">
              <motion.div
                className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#e8ddc7] bg-[#fffefa] px-3 py-1 text-xs font-medium text-[#6f7168]"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <Sparkles size={13} className="text-[#d7aa4f]" />
                {activeCard.eyebrow}
              </motion.div>
              <motion.h1
                className="text-4xl font-semibold leading-tight text-[#171714] md:text-5xl"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.16 }}
              >
                {activeCard.title}
              </motion.h1>
              <motion.p
                className="mt-5 max-w-[520px] text-lg leading-8 text-[#5f6159]"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
              >
                {activeCard.copy}
              </motion.p>

              <motion.div
                className="mt-9 flex flex-wrap items-center gap-3"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28 }}
              >
                <button
                  type="button"
                  onClick={() => paginate(-1)}
                  disabled={index === 0}
                  className="papyrus-icon-button size-10 rounded-lg disabled:cursor-not-allowed disabled:opacity-40"
                  title="上一页"
                >
                  <ArrowLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => (isLast ? setFirstLaunchComplete() : paginate(1))}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#171714] px-4 text-sm font-medium text-[#fffefa] transition hover:bg-[#3f5845]"
                >
                  {isLast ? '开启创作之旅' : '继续'}
                  {isLast ? <Check size={16} /> : <ArrowRight size={16} />}
                </button>
              </motion.div>
            </div>

            <div className="flex min-h-[360px] min-w-0 items-center justify-center">
              <div className="relative w-full max-w-[760px] overflow-hidden rounded-2xl border border-[#eee8dc] bg-[#fffefa] p-5 shadow-[0_18px_60px_rgba(43,34,19,0.08)]">
                {activeCard.visual === 'companion' ? <CompanionVisual /> : null}
                {activeCard.visual === 'flow' ? <FlowVisual /> : null}
                {activeCard.visual === 'rag' ? <RagVisual /> : null}
              </div>
            </div>
          </motion.section>
        </AnimatePresence>
      </main>

      <footer className="flex h-14 shrink-0 items-center justify-center gap-2 border-t border-[#eee8dc] bg-[#fffefa]/88">
        {cards.map((card, cardIndex) => (
          <button
            key={card.id}
            type="button"
            aria-label={`切换到第 ${cardIndex + 1} 张卡片`}
            onClick={() => {
              setDirection(cardIndex > index ? 1 : -1)
              setIndex(cardIndex)
            }}
            className="relative h-2.5 w-9 rounded-full bg-[#eadfca]"
          >
            {cardIndex === index ? (
              <motion.span
                layoutId="showcase-progress-dot"
                className="absolute inset-0 rounded-full bg-[#3f5845]"
                transition={{ duration: 0.22 }}
              />
            ) : null}
          </button>
        ))}
      </footer>
    </div>
  )
}

function CompanionVisual() {
  return (
    <motion.div
      className="group relative min-h-[420px] rounded-xl border border-[#e8ddc7] bg-[#fbfaf6] p-6"
      whileHover="hover"
    >
      <div className="mb-5 flex items-center justify-between">
        <div className="text-xs font-medium text-[#8f897a]">Draft.md</div>
        <MousePointer2 size={16} className="text-[#8f897a]" />
      </div>
      <div className="space-y-4 text-[15px] leading-8 text-[#25231e]">
        <p>雨停在城南旧站，檐下的灯把每个人的影子都拉得很长。</p>
        <p>
          <span>她把信折回口袋，忽然意识到，</span>
          <motion.span
            className="rounded bg-[#d7aa4f]/24 px-1"
            animate={{ opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 2.2, repeat: Infinity }}
          >
            真相不是答案，而是一扇终于肯开的门
          </motion.span>
          <motion.span
            className="ml-0.5 inline-block h-5 w-px translate-y-1 bg-[#171714]"
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        </p>
      </div>

      <motion.div
        variants={{
          hover: { opacity: 1, y: 0, scale: 1 },
        }}
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        className="absolute left-1/2 top-28 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-1.5 text-xs shadow-[0_14px_34px_rgba(43,34,19,0.14)]"
      >
        {['审查', '降噪', '查重'].map((item) => (
          <span key={item} className="rounded-lg px-3 py-1.5 text-[#5f6159] hover:bg-[#f2eadb]">
            {item}
          </span>
        ))}
      </motion.div>
    </motion.div>
  )
}

function FlowVisual() {
  const nodes = [
    { label: '秘书长', x: 'left-[44%]', y: 'top-8', delay: 0 },
    { label: '寻根', x: 'left-[12%]', y: 'top-[42%]', delay: 0.22 },
    { label: '刺客', x: 'left-[42%]', y: 'top-[48%]', delay: 0.34 },
    { label: '文风师', x: 'left-[68%]', y: 'top-[38%]', delay: 0.46 },
    { label: '初稿生成', x: 'left-[38%]', y: 'bottom-8', delay: 0.62 },
  ]

  return (
    <div className="relative min-h-[420px] rounded-xl border border-[#e8ddc7] bg-[#fbfaf6] p-6">
      <motion.div
        className="absolute left-1/2 top-20 h-[260px] w-px origin-top bg-[#d7aa4f]/55"
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div
        className="absolute left-[18%] top-[47%] h-px w-[62%] origin-left bg-[#d7aa4f]/55"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.18, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      />
      {nodes.map((node) => (
        <motion.div
          key={node.label}
          className={`absolute ${node.x} ${node.y} -translate-x-1/2 rounded-xl border border-[#e8ddc7] bg-[#fffefa] px-4 py-3 shadow-[0_10px_24px_rgba(43,34,19,0.07)]`}
          initial={{ opacity: 0, y: -10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: node.delay, duration: 0.28 }}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-[#2f2b22]">
            <motion.span
              className="size-2 rounded-full bg-[#3f5845]"
              animate={{ opacity: [0.35, 1, 0.35], scale: [1, 1.35, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, delay: node.delay }}
            />
            {node.label}
          </div>
        </motion.div>
      ))}
      <div className="absolute bottom-6 left-6 right-6 flex items-center gap-2 rounded-xl border border-[#e8ddc7] bg-[#fffefa] p-3 text-xs text-[#6f7168]">
        <GitBranch size={14} />
        规划、调查、审核、再稿被拆成可追踪的执行轨迹
      </div>
    </div>
  )
}

function RagVisual() {
  const chips = ['第七章', '沈砚人物卡', '南明设定集', 'STYLE.md']

  return (
    <div className="relative min-h-[420px] rounded-xl border border-[#e8ddc7] bg-[#fbfaf6] p-6">
      <div className="mx-auto max-w-[480px] rounded-2xl border border-[#e8ddc7] bg-[#fffefa] p-4 shadow-[0_12px_30px_rgba(43,34,19,0.06)]">
        <div className="flex items-center gap-2 rounded-xl border border-[#e8ddc7] bg-[#fbfaf6] px-3 py-2 text-sm text-[#2f2b22]">
          <AtSign size={17} className="text-[#3f5845]" />
          <span>唤醒项目记忆</span>
        </div>
        <div className="mt-3 space-y-2">
          {chips.map((chip, index) => (
            <motion.div
              key={chip}
              className="flex items-center justify-between rounded-lg border border-[#eee8dc] bg-[#fffefa] px-3 py-2 text-sm text-[#5f6159]"
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.16 + index * 0.12 }}
            >
              {chip}
              <motion.span
                className="size-1.5 rounded-full bg-[#d7aa4f]"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.7, repeat: Infinity, delay: index * 0.15 }}
              />
            </motion.div>
          ))}
        </div>
      </div>

      <motion.div
        className="absolute bottom-7 left-1/2 w-[74%] -translate-x-1/2 rounded-2xl border border-[#d7aa4f]/45 bg-[#fff7e3] p-4"
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.72, duration: 0.32 }}
      >
        <div className="text-xs font-medium text-[#6f7168]">Context Bundle</div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eadfca]">
          <motion.div
            className="h-full rounded-full bg-[#3f5845]"
            initial={{ width: '18%' }}
            animate={{ width: '72%' }}
            transition={{ delay: 0.9, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </motion.div>
    </div>
  )
}
