import { open } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useState } from 'react'

import {
  addWorkAssistantRoot,
  clearWorkAssistantAudit,
  getWorkAssistantCapabilities,
  listRegisteredApplications,
  listWorkAssistantAudit,
  listWorkAssistantRoots,
  registerApplicationFromPicker,
  removeRegisteredApplication,
  removeWorkAssistantRoot,
  type AuditEntry,
  type AuthorizedRoot,
  type RegisteredApplication,
} from '../services/workAssistantClient'
import type { AssistantCapabilityStatus } from '../services/workAssistantProtocol'

export function ComputerAssistantSettings() {
  const [capabilities, setCapabilities] = useState<AssistantCapabilityStatus[]>([])
  const [roots, setRoots] = useState<AuthorizedRoot[]>([])
  const [applications, setApplications] = useState<RegisteredApplication[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [applicationLabel, setApplicationLabel] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [nextCapabilities, nextRoots, nextApplications, nextAudit] = await Promise.all([
        getWorkAssistantCapabilities(), listWorkAssistantRoots(), listRegisteredApplications(), listWorkAssistantAudit(0, 50),
      ])
      setCapabilities(nextCapabilities); setRoots(nextRoots); setApplications(nextApplications); setAudit(nextAudit); setError('')
    } catch {
      setError('无法读取电脑助手状态，请确认桌面能力已启用。')
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void refresh())
  }, [refresh])

  const addRoot = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (typeof selected !== 'string') return
    const label = selected.split(/[\\/]/).filter(Boolean).at(-1) || '工作区'
    await addWorkAssistantRoot(label, selected, 'workspace')
    await refresh()
  }

  const addApplication = async () => {
    const selected = await open({ directory: false, multiple: false })
    if (typeof selected !== 'string' || !applicationLabel.trim()) return
    await registerApplicationFromPicker(applicationLabel.trim(), selected)
    setApplicationLabel('')
    await refresh()
  }

  return (
    <section className="space-y-5 text-sm text-[#332f27]">
      {error ? <div className="text-[#9a4338]">{error}</div> : null}
      <div><h3 className="font-semibold">能力健康</h3><div className="mt-2 divide-y divide-[#ebe5da]">{capabilities.filter((item) => item.toolset === 'workspace' || item.toolset === 'desktop').map((item) => <div key={item.name} className="flex justify-between gap-3 py-2"><span>{item.name}</span><span className={item.available ? 'text-[#416746]' : 'text-[#9a4338]'}>{item.available ? '可用' : item.reason || '不可用'}</span></div>)}</div></div>
      <div><div className="flex items-center justify-between"><h3 className="font-semibold">授权目录</h3><button type="button" aria-label="添加授权目录" onClick={() => void addRoot()} className="text-xs text-[#416746]">添加</button></div>{roots.map((root) => <div key={root.id} className="mt-2 flex items-center justify-between"><div><div>{root.label}</div><div className="text-xs text-[#817a6d]">{root.path}</div></div><button type="button" aria-label={`移除 ${root.label}`} onClick={() => void removeWorkAssistantRoot(root.id).then(refresh)} className="text-xs text-[#9a4338]">移除</button></div>)}</div>
      <div><h3 className="font-semibold">应用别名</h3><div className="mt-2 flex gap-2"><input aria-label="应用别名" value={applicationLabel} onChange={(event) => setApplicationLabel(event.target.value)} placeholder="例如：编辑器" className="min-w-0 flex-1 rounded-md border px-2 py-1"/><button type="button" onClick={() => void addApplication()} className="text-xs text-[#416746]">选择并注册</button></div>{applications.map((application) => <div key={application.id} className="mt-2 flex items-center justify-between"><span>{application.label}</span><button type="button" aria-label={`移除 ${application.label}`} onClick={() => void removeRegisteredApplication(application.id).then(refresh)} className="text-xs text-[#9a4338]">移除</button></div>)}</div>
      <div><div className="flex items-center justify-between"><h3 className="font-semibold">最近审计</h3>{confirmClear ? <button type="button" aria-label="确认清空" onClick={() => void clearWorkAssistantAudit().then(() => { setConfirmClear(false); return refresh() })} className="text-xs text-[#9a4338]">确认清空</button> : <button type="button" aria-label="清空审计记录" onClick={() => setConfirmClear(true)} className="text-xs text-[#817a6d]">清空</button>}</div><div className="mt-2 divide-y divide-[#ebe5da]">{audit.map((entry) => <div key={entry.id} className="py-2"><div>{entry.event}</div><div className="text-xs text-[#817a6d]">{entry.detail}</div></div>)}</div></div>
    </section>
  )
}
