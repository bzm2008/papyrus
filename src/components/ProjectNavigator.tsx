import { AnimatePresence, motion } from 'framer-motion'
import {
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { importResourceFiles, openProjectFolder } from '../services/resourceImportService'
import {
  useAppStore,
  type ArticleRecord,
  type ChatSession,
  type ImportedResource,
} from '../stores/useAppStore'

export function ProjectNavigator({ collapsed = false }: { collapsed?: boolean }) {
  const articles = useAppStore((state) => state.articles)
  const activeArticleId = useAppStore((state) => state.activeArticleId)
  const resources = useAppStore((state) => state.resources)
  const chatSessions = useAppStore((state) => state.chatSessions)
  const activeChatId = useAppStore((state) => state.activeChatId)
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
  const sortedChats = sortPinned(chatSessions)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!collapsed ? (
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-[#e8ddc7] p-3">
          <SmallAction icon={Plus} label="新建对话" primary onClick={newChatSession} />
          <SmallAction icon={FilePlus2} label="新建文章" onClick={() => newArticleInChat()} />
          <SmallAction icon={FolderPlus} label="文件夹" onClick={() => void openProjectFolder()} />
          <SmallAction icon={Upload} label="导入" onClick={() => void importResourceFiles()} />
        </div>
      ) : null}

      <div className="papyrus-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <NavigatorSection collapsed={collapsed} title="历史聊天">
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
                    if (window.confirm(`删除对话「${chat.title}」？`)) {
                      deleteChatSession(chat.id)
                    }
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

        <NavigatorSection collapsed={collapsed} title="文件">
          {resources.length ? (
            <AnimatedList>
              {resources.map((resource) => (
                <ResourceItem key={resource.id} resource={resource} collapsed={collapsed} />
              ))}
            </AnimatedList>
          ) : (
            <EmptyRow collapsed={collapsed} icon={FilePlus2} text="导入 Word、Markdown 或项目文件夹" />
          )}
        </NavigatorSection>
      </div>
    </div>
  )
}

function SmallAction({
  icon: Icon,
  label,
  primary = false,
  onClick,
}: {
  icon: typeof Plus
  label: string
  primary?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition ${
        primary
          ? 'bg-[#171714] text-[#fffefa] hover:bg-[#3f5845]'
          : 'border border-[#e8ddc7] bg-[#fffefa] text-[#6f7168] hover:text-[#171714]'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

function NavigatorSection({
  title,
  collapsed,
  children,
}: {
  title: string
  collapsed: boolean
  children: ReactNode
}) {
  return (
    <section>
      {!collapsed ? <div className="mb-2 text-xs font-medium uppercase text-[#9d988a]">{title}</div> : null}
      {children}
    </section>
  )
}

function AnimatedList({ children }: { children: ReactNode }) {
  return (
    <motion.div layout className="space-y-2">
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12 }}
      className={`rounded-lg border p-2 transition ${
        active
          ? 'border-[#171714] bg-[#171714] text-[#fffefa]'
          : 'border-transparent text-[#6f7168] hover:border-[#e8ddc7] hover:bg-[#fffdf7] hover:text-[#2f2b22]'
      }`}
    >
      <button type="button" onClick={onOpen} title={chat.title} className="flex w-full items-center gap-2 text-left">
        <MessageSquare size={15} className="shrink-0" />
        {!collapsed ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{chat.title}</span>
            <span className={`block truncate text-xs ${active ? 'text-[#d6d0c4]' : 'text-[#8f897a]'}`}>
              {chat.messages.length.toLocaleString()} 条消息 · {sortedArticles.length} 篇文章
            </span>
          </span>
        ) : null}
      </button>

      {!collapsed ? (
        <>
          <ItemActions active={active} pinned={Boolean(chat.pinned)} onRename={onRename} onDelete={onDelete} onTogglePin={onTogglePin} />
          {active ? (
            <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
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
                className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[#d9c69c] text-xs text-[#8f897a] transition hover:bg-[#fffefa] hover:text-[#171714]"
              >
                <FilePlus2 size={13} />
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

function ResourceItem({ resource, collapsed }: { resource: ImportedResource; collapsed: boolean }) {
  const Icon = resource.type === 'folder' ? FolderOpen : FileText

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12 }}
      className="rounded-lg border border-[#e8ddc7] bg-[#fffefa] p-2"
    >
      <div className="flex items-start gap-2">
        <Icon size={16} className="mt-0.5 shrink-0 text-[#6f7f68]" />
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[#2f2b22]">{resource.name}</div>
            <div className="mt-0.5 truncate text-xs text-[#8f897a]">
              {resource.type.toUpperCase()} · {resource.tokenCount.toLocaleString()} tokens
            </div>
          </div>
        ) : null}
      </div>
    </motion.article>
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
    <div className="mt-2 flex justify-end gap-1">
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
  icon: typeof Pencil
  title: string
  onClick: () => void
  className?: string
}) {
  return (
    <button type="button" title={title} onClick={onClick} className={`rounded-md p-1 transition ${className}`}>
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
  icon: typeof FilePlus2
  text: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-[#d9c69c] bg-[#fffdf7] px-3 py-3 text-xs text-[#8f897a]">
      <Icon size={15} className="shrink-0" />
      {!collapsed ? <span>{text}</span> : null}
    </div>
  )
}

function sortPinned<T extends { pinned?: boolean; updatedAt: number }>(items: T[]) {
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
}
