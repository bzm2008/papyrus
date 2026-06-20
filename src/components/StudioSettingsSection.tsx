import { Bot, LockKeyhole, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  generateStudioAgentDraftFromPrompt,
  getAllStudioAgents,
  getStudioAgentCategoryLabel,
  studioAgentCategories,
  type StudioAgent,
} from '../services/studioAgentLibrary'
import {
  useAppStore,
  type CustomStudioAgent,
  type StudioAgentCategory,
  type StudioAgentOutputType,
} from '../stores/useAppStore'

type StudioDraft = Omit<CustomStudioAgent, 'id' | 'createdAt' | 'updatedAt' | 'builtIn'> & {
  id?: string
}

const outputTypes: Array<{ id: StudioAgentOutputType; label: string }> = [
  { id: 'draft', label: '正文' },
  { id: 'research', label: '研究' },
  { id: 'critique', label: '审查' },
  { id: 'strategy', label: '策略' },
  { id: 'compliance', label: '合规' },
  { id: 'summary', label: '摘要' },
]

const defaultDraft: StudioDraft = {
  name: '',
  shortName: '',
  category: 'writing',
  description: '',
  taskTypes: [],
  keywords: [],
  systemPrompt: '',
  outputRules: [],
  outputType: 'summary',
  enabled: false,
}

export function StudioSettingsSection() {
  const disabledBuiltInStudioAgentIds = useAppStore((state) => state.disabledBuiltInStudioAgentIds)
  const customStudioAgents = useAppStore((state) => state.customStudioAgents)
  const toggleStudioAgent = useAppStore((state) => state.toggleStudioAgent)
  const upsertCustomStudioAgent = useAppStore((state) => state.upsertCustomStudioAgent)
  const deleteCustomStudioAgent = useAppStore((state) => state.deleteCustomStudioAgent)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<StudioAgentCategory | 'all'>('all')
  const [request, setRequest] = useState('')
  const [draft, setDraft] = useState<StudioDraft>(defaultDraft)
  const [editingId, setEditingId] = useState<string | undefined>()

  const agents = useMemo(
    () => getAllStudioAgents(customStudioAgents, disabledBuiltInStudioAgentIds),
    [customStudioAgents, disabledBuiltInStudioAgentIds],
  )
  const filtered = agents.filter((agent) => {
    const haystack = `${agent.name} ${agent.shortName} ${agent.description} ${agent.taskTypes.join(' ')} ${agent.keywords.join(' ')}`.toLowerCase()
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase())
    const matchesCategory = category === 'all' || agent.category === category
    return matchesQuery && matchesCategory
  })

  const createDraft = () => {
    const generated = generateStudioAgentDraftFromPrompt(request)
    setDraft({
      id: generated.id,
      name: generated.name,
      shortName: generated.shortName,
      category: generated.category,
      description: generated.description,
      taskTypes: generated.taskTypes,
      keywords: generated.keywords,
      systemPrompt: generated.systemPrompt,
      outputRules: generated.outputRules,
      outputType: generated.outputType,
      enabled: generated.enabled,
    })
    setEditingId(undefined)
  }

  const editAgent = (agent: StudioAgent) => {
    if (agent.builtIn) {
      return
    }

    setEditingId(agent.id)
    setDraft({
      id: agent.id,
      name: agent.name,
      shortName: agent.shortName,
      category: agent.category,
      description: agent.description,
      taskTypes: agent.taskTypes,
      keywords: agent.keywords,
      systemPrompt: agent.systemPrompt,
      outputRules: agent.outputRules,
      outputType: agent.outputType,
      enabled: agent.enabled,
    })
  }

  const saveDraft = () => {
    if (!draft.name.trim()) {
      return
    }

    upsertCustomStudioAgent({
      ...draft,
      id: editingId ?? draft.id,
      name: draft.name.trim(),
      shortName: draft.shortName.trim() || draft.name.trim().slice(0, 6),
      description: draft.description.trim(),
      systemPrompt: draft.systemPrompt.trim(),
    })
    setDraft(defaultDraft)
    setEditingId(undefined)
    setRequest('')
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-[#e8ddc7] bg-[#fffdf7] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#2f2b22]">
              <Bot size={15} className="text-[#6f7f68]" />
              工作室
            </div>
            <p className="mt-1 text-xs leading-5 text-[#6f7168]">
              秘书长会从这里选择 Agent。秘书长不可禁用，其他内置 Agent 可停用；自定义 Agent 保存并启用后才会参与调度。
            </p>
          </div>
          <div className="rounded-lg bg-[#f4f0e7] px-3 py-2 text-xs text-[#6f7168]">
            {agents.filter((agent) => agent.enabled).length} / {agents.length} 已启用
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_180px]">
          <label className="relative block">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8f897a]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 Agent、任务、关键词"
              className="h-10 w-full rounded-lg border border-[#e8ddc7] bg-white pl-9 pr-3 text-sm text-[#2f2b22] outline-none transition focus:border-[#d7aa4f]"
            />
          </label>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as StudioAgentCategory | 'all')}
            className="h-10 rounded-lg border border-[#e8ddc7] bg-white px-3 text-sm text-[#2f2b22] outline-none transition focus:border-[#d7aa4f]"
          >
            {studioAgentCategories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((agent) => (
          <article
            key={agent.id}
            className={`rounded-xl border p-3 transition ${
              agent.enabled
                ? 'border-[#e8ddc7] bg-[#fffefa]'
                : 'border-[#e8ddc7]/70 bg-[#f7f3ea] opacity-72'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-sm font-semibold text-[#2f2b22]">{agent.name}</div>
                  {agent.protected ? <LockKeyhole size={12} className="shrink-0 text-[#8f897a]" /> : null}
                </div>
                <div className="mt-1 text-[11px] text-[#8f897a]">
                  {getStudioAgentCategoryLabel(agent.category)} · {agent.outputType}
                </div>
              </div>
              <button
                type="button"
                disabled={agent.protected}
                onClick={() => toggleStudioAgent(agent.id, !agent.enabled)}
                className={`h-7 shrink-0 rounded-full px-2.5 text-[11px] font-medium transition ${
                  agent.enabled
                    ? 'bg-[#e2f0dc] text-[#3f5845]'
                    : 'border border-[#ded4c1] bg-white text-[#8f897a]'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {agent.protected ? '固定' : agent.enabled ? '启用' : '停用'}
              </button>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#6f7168]">{agent.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {agent.taskTypes.slice(0, 4).map((task) => (
                <span key={task} className="rounded-full bg-[#f4f0e7] px-2 py-1 text-[11px] text-[#6f7168]">
                  {task}
                </span>
              ))}
            </div>
            {!agent.builtIn ? (
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => editAgent(agent)}
                  className="h-8 rounded-lg border border-[#e8ddc7] bg-white px-3 text-xs text-[#6f7168] transition hover:text-[#2f2b22]"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => deleteCustomStudioAgent(agent.id)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#f0d6ca] bg-white px-3 text-xs text-[#9b3d30] transition hover:bg-[#fff7f4]"
                >
                  <Trash2 size={12} />
                  删除
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <div className="rounded-xl border border-[#e8ddc7] bg-[#fffdf7] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#2f2b22]">
          <Sparkles size={15} className="text-[#d7aa4f]" />
          用自然语言创建 Agent
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="例如：帮我创建一个儿童科普绘本编辑，擅长把复杂知识写得准确又有画面感"
            className="h-10 min-w-0 flex-1 rounded-lg border border-[#e8ddc7] bg-white px-3 text-sm text-[#2f2b22] outline-none transition focus:border-[#d7aa4f]"
          />
          <button
            type="button"
            onClick={createDraft}
            disabled={!request.trim()}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[#171714] px-3 text-sm font-medium text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus size={14} />
            生成草案
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="名称" value={draft.name} onChange={(value) => setDraft((item) => ({ ...item, name: value }))} />
          <Field label="短名" value={draft.shortName} onChange={(value) => setDraft((item) => ({ ...item, shortName: value }))} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[#6f7168]">分类</span>
            <select
              value={draft.category}
              onChange={(event) => setDraft((item) => ({ ...item, category: event.target.value as StudioAgentCategory }))}
              className="h-10 w-full rounded-lg border border-[#e8ddc7] bg-white px-3 text-sm text-[#2f2b22] outline-none transition focus:border-[#d7aa4f]"
            >
              {studioAgentCategories
                .filter((item) => item.id !== 'all' && item.id !== 'core')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[#6f7168]">输出类型</span>
            <select
              value={draft.outputType}
              onChange={(event) => setDraft((item) => ({ ...item, outputType: event.target.value as StudioAgentOutputType }))}
              className="h-10 w-full rounded-lg border border-[#e8ddc7] bg-white px-3 text-sm text-[#2f2b22] outline-none transition focus:border-[#d7aa4f]"
            >
              {outputTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Textarea label="简介" value={draft.description} onChange={(value) => setDraft((item) => ({ ...item, description: value }))} />
        <Textarea label="适用任务（每行一个）" value={draft.taskTypes.join('\n')} onChange={(value) => setDraft((item) => ({ ...item, taskTypes: lines(value) }))} />
        <Textarea label="关键词（每行一个）" value={draft.keywords.join('\n')} onChange={(value) => setDraft((item) => ({ ...item, keywords: lines(value) }))} />
        <Textarea label="系统规则" value={draft.systemPrompt} onChange={(value) => setDraft((item) => ({ ...item, systemPrompt: value }))} rows={5} />
        <Textarea label="输出规则（每行一个）" value={draft.outputRules.join('\n')} onChange={(value) => setDraft((item) => ({ ...item, outputRules: lines(value) }))} />
        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-[#6f7168]">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft((item) => ({ ...item, enabled: event.target.checked }))}
            />
            保存后启用
          </label>
          <button
            type="button"
            onClick={saveDraft}
            disabled={!draft.name.trim()}
            className="h-9 rounded-lg bg-[#171714] px-4 text-sm font-medium text-[#fffefa] transition hover:bg-[#3f5845] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {editingId ? '保存修改' : '保存 Agent'}
          </button>
        </div>
      </div>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[#6f7168]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-[#e8ddc7] bg-white px-3 text-sm text-[#2f2b22] outline-none transition focus:border-[#d7aa4f]"
      />
    </label>
  )
}

function Textarea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
}) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-xs font-medium text-[#6f7168]">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-none rounded-lg border border-[#e8ddc7] bg-white px-3 py-2 text-sm leading-5 text-[#2f2b22] outline-none transition focus:border-[#d7aa4f]"
      />
    </label>
  )
}

function lines(value: string) {
  return value
    .split(/[\n,，、;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}
