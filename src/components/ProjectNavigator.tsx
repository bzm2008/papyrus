import { AnimatePresence, motion } from 'framer-motion'
import {
  FilePlus2,
  FileText,
  FolderPlus,
  Gauge,
  MinusCircle,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  PlusCircle,
  Trash2,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  AUTHORIZED_WORKSPACE_IMPORT_MESSAGE,
  importResourceFiles,
  insertResourceIntoDocument,
  openProjectFolder,
} from '../services/resourceImportService'
import { useAppStore, type ArticleRecord, type ChatSession, type ImportedResource } from '../stores/useAppStore'

export function ProjectNavigator({ collapsed = false }: { collapsed?: boolean }) {
  const articles = useAppStore((state) => state.articles)
  const activeArticleId = useAppStore((state) => state.activeArticleId)
  const chatSessions = useAppStore((state) => state.chatSessions)
  const activeChatId = useAppStore((state) => state.activeChatId)
  const resources = useAppStore((state) => state.resources)
  const switchChatSession = useAppStore((state) => state.switchChatSession)
  const renameChatSession = useAppStore((state) => state.renameChatSession)
  const deleteChatSession = useAppStore((state) => state.deleteChatSession)
  const toggleChatPinned = useAppStore((state) => state.toggleChatPinned)
  const newChatSession = useAppStore((state) => state.newChatSession)
  const newArticleInChat = useAppStore((state) => state.newArticleInChat)
  const switchChatArticle = useAppStore((state) => state.switchChatArticle)
  const renameArticle = useAppStore((state) => state.renameArticle)
  const deleteArticle = useAppStore((state) => state.deleteArticle)
  const toggleArticlePinned = useAppStore((state) => state.toggleArticlePinned)
  const setStoryDashboardOpen = useAppStore((state) => state.setStoryDashboardOpen)
  const updateResource = useAppStore((state) => state.updateResource)
  const deleteResource = useAppStore((state) => state.deleteResource)
  const sortedChats = sortPinned(chatSessions)
  const includedResources = resources.filter((resource) => resource.includedInContext)
  const includedResourceTokens = includedResources.reduce((sum, resource) => sum + resource.tokenCount, 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={`shrink-0 border-b border-[#e3dac8] ${
          collapsed ? 'flex flex-col items-center gap-2 px-2 py-3' : 'px-3 py-3'
        }`}
      >
        {!collapsed ? (
          <div className="mb-2.5 flex items-end justify-between gap-2 px-0.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3f5845]">
                <Gauge size={14} />
                <span>工作台</span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-[#9d988a]">
                {sortedChats.length} 个对话 · {articles.length} 篇文稿 · {resources.length} 份资料
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-[#edf2e8] px-2 py-0.5 text-[10px] text-[#59705b]">当前项目</span>
          </div>
        ) : null}

        <div className={collapsed ? 'flex flex-col items-center gap-2' : 'grid grid-cols-2 gap-2'}>
          <SmallAction collapsed={collapsed} icon={Plus} label="新建对话" primary onClick={newChatSession} />
          <SmallAction collapsed={collapsed} icon={FilePlus2} label="新建文章" onClick={() => newArticleInChat()} />
          <SmallAction collapsed={collapsed} icon={Gauge} label="作品体检" onClick={() => setStoryDashboardOpen(true)} />
          <SmallAction
            collapsed={collapsed}
            icon={Upload}
            label="导入文件"
            onClick={() => void importResourceFiles().catch(showResourceImportUnavailable)}
          />
          <SmallAction
            collapsed={collapsed}
            icon={FolderPlus}
            label="打开文件夹"
            onClick={() => void openProjectFolder().catch(showResourceImportUnavailable)}
          />
        </div>
      </div>

      <div className="papyrus-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 py-3">
        <NavigatorSection collapsed={collapsed} icon={MessageSquare} title="历史聊天">
          {sortedChats.length ? (
            <AnimatedList>
              {sortedChats.map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  articles={articles.filter(
                    (article) =>
                      article.chatId === chat.id ||
                      chat.articleIds?.includes(article.id) ||
                      chat.articleId === article.id,
                  )}
                  active={chat.id === activeChatId}
                  activeArticleId={activeArticleId}
                  collapsed={collapsed}
                  onOpen={() => switchChatSession(chat.id)}
                  onNewArticle={() => newArticleInChat(chat.id)}
                  onOpenArticle={(articleId) => switchChatArticle(chat.id, articleId)}
                  onRename={() => {
                    const title = window.prompt('重命名对话', chat.title)
                    if (title) renameChatSession(chat.id, title)
                  }}
                  onDelete={() => {
                    if (window.confirm(`删除对话「${chat.title}」？`)) deleteChatSession(chat.id)
                  }}
                  onTogglePin={() => toggleChatPinned(chat.id)}
                  onRenameArticle={(article) => {
                    const title = window.prompt('重命名文章', article.title)
                    if (title) renameArticle(article.id, title)
                  }}
                  onDeleteArticle={(article) => {
                    if (articles.length > 1 && window.confirm(`删除文章「${article.title}」？`)) {
                      deleteArticle(article.id)
                    }
                  }}
                  onToggleArticlePin={(article) => toggleArticlePinned(article.id)}
                />
              ))}
            </AnimatedList>
          ) : (
            <EmptyRow collapsed={collapsed} icon={MessageSquare} text="还没有历史聊天" />
          )}
        </NavigatorSection>

        <NavigatorSection
          collapsed={collapsed}
          icon={FileText}
          title="项目资料"
          meta={
            resources.length
              ? `${includedResources.length}/${resources.length} · ${includedResourceTokens.toLocaleString()} tokens`
              : undefined
          }
        >
          {resources.length ? (
            <AnimatedList>
              {resources.map((resource) => (
                <ResourceItem
                  key={resource.id}
                  collapsed={collapsed}
                  resource={resource}
                  onToggleContext={() =>
                    updateResource(resource.id, { includedInContext: !resource.includedInContext })
                  }
                  onInsert={() => insertResourceIntoDocument(resource)}
                  onDelete={() => {
                    if (window.confirm(`移除资料「${resource.name}」？`)) {
                      deleteResource(resource.id)
                    }
                  }}
                />
              ))}
            </AnimatedList>
          ) : (
            <EmptyRow collapsed={collapsed} icon={FilePlus2} text="导入 Word、Markdown 或项目文件夹" />
          )}
        </NavigatorSection>
      </div>

      {!collapsed ? (
        <div className="shrink-0 border-t border-[#e3dac8] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 text-[10px] text-[#9d988a]">
            <span>项目资料会作为上下文按需使用</span>
            <FileText size={13} className="shrink-0 text-[#7c9273]" />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function showResourceImportUnavailable(error: unknown) {
  window.alert(error instanceof Error ? error.message : AUTHORIZED_WORKSPACE_IMPORT_MESSAGE)
}

function ResourceItem({
  resource,
  collapsed,
  onToggleContext,
  onInsert,
  onDelete,
}: {
  resource: ImportedResource
  collapsed: boolean
  onToggleContext: () => void
  onInsert: () => void
  onDelete: () => void
}) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-md px-2 py-1.5 ${
        resource.includedInContext ? 'bg-[#edf6eb] text-[#2f2b22]' : 'text-[#6f7168] hover:bg-[#fffdf7]'
      }`}
    >
      <div className="flex items-start gap-2">
        <FileText size={15} className="mt-0.5 shrink-0 text-[#6f7f68]" />
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{resource.name}</div>
            <div className="mt-0.5 truncate text-[11px] text-[#8f897a]">
              {resource.type.toUpperCase()} · {resource.tokenCount.toLocaleString()} tokens ·{' '}
              {resource.includedInContext ? '已入上下文' : '未入上下文'}
            </div>
          </div>
        ) : null}
      </div>
      {!collapsed ? (
        <div className="mt-1.5 flex justify-end gap-1">
          <MiniAction
            icon={resource.includedInContext ? MinusCircle : PlusCircle}
            title={resource.includedInContext ? '从上下文排除' : '加入上下文'}
            onClick={onToggleContext}
            className="text-[#6f7f68] hover:bg-[#edf6eb]"
          />
          <MiniAction icon={FilePlus2} title="插入文稿" onClick={onInsert} className="text-[#8f897a] hover:bg-[#f4ead8]" />
          <MiniAction icon={Trash2} title="移除资料" onClick={onDelete} className="text-[#8f897a] hover:bg-[#f4ead8]" />
        </div>
      ) : null}
    </motion.article>
  )
}

function SmallAction({
  collapsed = false,
  icon: Icon,
  label,
  primary = false,
  onClick,
}: {
  collapsed?: boolean
  icon: LucideIcon
  label: string
  primary?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md text-[11px] font-medium ${
        collapsed ? 'size-9 px-0' : 'h-10 min-w-0 px-2.5'
      } ${primary ? 'papyrus-primary-button' : 'papyrus-control'}`}
    >
      <Icon size={collapsed ? 16 : 14} />
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </button>
  )
}

function NavigatorSection({
  icon: Icon,
  title,
  meta,
  collapsed,
  children,
}: {
  icon: LucideIcon
  title: string
  meta?: string
  collapsed: boolean
  children: ReactNode
}) {
  return (
    <section className="min-w-0">
      {!collapsed ? (
        <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[11px] font-semibold text-[#6f7168]">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon size={14} className="shrink-0 text-[#7c9273]" />
            <span className="truncate">{title}</span>
          </span>
          {meta ? <span className="truncate text-[10px] font-normal text-[#9d988a]">{meta}</span> : null}
        </div>
      ) : (
        <div className="mb-2 flex justify-center text-[#7c9273]" title={title} aria-label={title}>
          <Icon size={15} />
        </div>
      )}
      {children}
    </section>
  )
}

function AnimatedList({ children }: { children: ReactNode }) {
  return (
    <motion.div layout className="space-y-1">
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </motion.div>
  )
}

function ChatItem({
  chat,
  articles,
  active,
  activeArticleId,
  collapsed,
  onOpen,
  onNewArticle,
  onOpenArticle,
  onRename,
  onDelete,
  onTogglePin,
  onRenameArticle,
  onDeleteArticle,
  onToggleArticlePin,
}: {
  chat: ChatSession
  articles: ArticleRecord[]
  active: boolean
  activeArticleId: string
  collapsed: boolean
  onOpen: () => void
  onNewArticle: () => void
  onOpenArticle: (articleId: string) => void
  onRename: () => void
  onDelete: () => void
  onTogglePin: () => void
  onRenameArticle: (article: ArticleRecord) => void
  onDeleteArticle: (article: ArticleRecord) => void
  onToggleArticlePin: (article: ArticleRecord) => void
}) {
  const sortedArticles = sortPinned(articles)

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-md px-2 py-1.5 ${
        active ? 'bg-[#171714] text-[#fffefa]' : 'text-[#6f7168] hover:bg-[#fffdf7] hover:text-[#2f2b22]'
      }`}
    >
      <button type="button" onClick={onOpen} title={chat.title} className="flex w-full items-center gap-2 text-left">
        <MessageSquare size={14} className="shrink-0" />
        {!collapsed ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{chat.title}</span>
            <span className={`block truncate text-[11px] ${active ? 'text-[#d6d0c4]' : 'text-[#8f897a]'}`}>
              {chat.messages.length.toLocaleString()} 条消息 · {sortedArticles.length} 篇文章
            </span>
          </span>
        ) : null}
      </button>

      {!collapsed ? (
        <>
          <ItemActions active={active} pinned={Boolean(chat.pinned)} onRename={onRename} onDelete={onDelete} onTogglePin={onTogglePin} />
          {active ? (
            <div className="mt-1.5 space-y-1 border-t border-white/10 pt-1.5">
              {sortedArticles.map((article) => (
                <ArticleRow
                  key={article.id}
                  article={article}
                  active={article.id === activeArticleId}
                  onOpen={() => onOpenArticle(article.id)}
                  onRename={() => onRenameArticle(article)}
                  onDelete={() => onDeleteArticle(article)}
                  onTogglePin={() => onToggleArticlePin(article)}
                />
              ))}
              <button
                type="button"
                onClick={onNewArticle}
                className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[#d9c69c] text-[11px] text-[#8f897a] hover:bg-[#fffefa] hover:text-[#171714]"
              >
                <FilePlus2 size={12} />
                新建文章
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </motion.article>
  )
}

function ArticleRow({
  article,
  active,
  onOpen,
  onRename,
  onDelete,
  onTogglePin,
}: {
  article: ArticleRecord
  active: boolean
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
  onTogglePin: () => void
}) {
  return (
    <div className={`rounded-md ${active ? 'bg-white/12' : 'hover:bg-white/8'}`}>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
        <FileText size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs">{article.title}</span>
      </button>
      <div className="flex justify-end gap-1 px-1 pb-1">
        <MiniAction icon={article.pinned ? PinOff : Pin} title={article.pinned ? '取消置顶' : '置顶'} onClick={onTogglePin} />
        <MiniAction icon={Pencil} title="重命名" onClick={onRename} />
        <MiniAction icon={Trash2} title="删除" onClick={onDelete} />
      </div>
    </div>
  )
}

function ItemActions({
  active,
  pinned,
  onRename,
  onDelete,
  onTogglePin,
}: {
  active: boolean
  pinned: boolean
  onRename: () => void
  onDelete: () => void
  onTogglePin: () => void
}) {
  const color = active ? 'text-[#d6d0c4] hover:bg-white/10' : 'text-[#8f897a] hover:bg-[#f4ead8]'

  return (
    <div className="mt-1.5 flex justify-end gap-1">
      <MiniAction icon={pinned ? PinOff : Pin} title={pinned ? '取消置顶' : '置顶'} onClick={onTogglePin} className={color} />
      <MiniAction icon={Pencil} title="重命名" onClick={onRename} className={color} />
      <MiniAction icon={Trash2} title="删除" onClick={onDelete} className={color} />
    </div>
  )
}

function MiniAction({
  icon: Icon,
  title,
  onClick,
  className = 'text-[#d6d0c4] hover:bg-white/10',
}: {
  icon: LucideIcon
  title: string
  onClick: () => void
  className?: string
}) {
  return (
    <button type="button" title={title} onClick={onClick} className={`rounded-md p-1 ${className}`}>
      <Icon size={13} />
    </button>
  )
}

function EmptyRow({
  collapsed,
  icon: Icon,
  text,
}: {
  collapsed: boolean
  icon: LucideIcon
  text: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-[#d9c69c] bg-[#fffdf7] px-2.5 py-2.5 text-xs text-[#8f897a]">
      <Icon size={14} className="shrink-0" />
      {!collapsed ? <span>{text}</span> : null}
    </div>
  )
}

function sortPinned<T extends { pinned?: boolean; updatedAt: number }>(items: T[]) {
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
}
