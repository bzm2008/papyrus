import { useCallback, useEffect, useState } from 'react'

import {
  browserSnapshot,
  deriveBrowserBridgeState,
  disconnectBrowserBridge,
  getBrowserBridgeStatus,
  startBrowserBridgePairing,
  type BrowserBridgePairing,
  type BrowserBridgeStatus,
} from '../services/browserBridgeClient'
import type { BrowserSnapshot } from '../services/browserBridgePolicy'

const stateLabels = {
  disabled: '未启动',
  listening: '等待配对',
  pairing: '配对中',
  connected: '已连接',
  stale: '需要重新配对',
  error: '错误',
} as const

export function SecretaryBrowserWorkbench() {
  const [status, setStatus] = useState<BrowserBridgeStatus>({ running: false, paired: false })
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>()
  const [pairing, setPairing] = useState<BrowserBridgePairing>()
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await getBrowserBridgeStatus()
      setStatus(next)
      if (next.paired) setPairing(undefined)
      if (next.paired) {
        setSnapshot(await browserSnapshot())
      }
      setError(next.error ?? '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取浏览器状态')
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void refresh())
  }, [refresh])

  useEffect(() => {
    if (!pairing) return undefined
    const timer = globalThis.setInterval(() => void refresh(), 1000)
    return () => globalThis.clearInterval(timer)
  }, [pairing, refresh])

  const pair = async () => {
    try {
      const next = await startBrowserBridgePairing()
      setPairing(next)
      setStatus(await getBrowserBridgeStatus())
      setError('请在 Browser Bridge 扩展弹窗粘贴配对信息，并选择连接当前标签页。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '启动配对失败')
    }
  }

  const disconnect = async () => {
    await disconnectBrowserBridge()
    setPairing(undefined)
    setSnapshot(undefined)
    await refresh()
  }

  return (
    <div className="papyrus-scrollbar h-full overflow-y-auto px-4 py-3 text-sm text-[#332f27]">
      {(() => {
        const state = status.connectionState ?? deriveBrowserBridgeState(status)
        return (
      <div className="flex items-start justify-between gap-3 border-b border-[#e4ded2] pb-3">
        <div>
          <div className="font-semibold">Browser Bridge</div>
          <div className="mt-1 text-xs text-[#817a6d]">只连接用户主动授权的当前标签页</div>
        </div>
        <span className={`rounded-md px-2 py-1 text-xs ${state === 'connected' ? 'bg-[#edf6eb] text-[#315d39]' : state === 'error' ? 'bg-[#fff4ef] text-[#9a4338]' : 'bg-[#f5f2ea] text-[#817a6d]'}`}>
          {stateLabels[state]}
        </span>
      </div>
        )
      })()}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void pair()} className="rounded-md bg-[#20201d] px-2.5 py-1.5 text-xs text-white">启动配对</button>
        <button type="button" onClick={() => void refresh()} className="rounded-md border border-[#d8cfc0] px-2.5 py-1.5 text-xs">刷新快照</button>
        {status.paired ? <button type="button" onClick={() => void disconnect()} className="rounded-md border border-[#e6c9bf] px-2.5 py-1.5 text-xs text-[#9a4338]">断开</button> : null}
      </div>

      {pairing ? (
        <div className="mt-3 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3 text-xs leading-5">
          <div>WebSocket：{pairing.wsUrl}</div>
          <div className="break-all">一次性 Token：{pairing.token}</div>
          <div className="break-all">Nonce：{pairing.nonce}</div>
        </div>
      ) : null}
      {status.tabId !== undefined || status.origin ? (
        <div className="mt-3 grid gap-1 rounded-lg bg-[#fffefa] px-3 py-2 text-xs text-[#625c50]">
          {status.tabId !== undefined ? <div>当前标签页：{status.tabId}</div> : null}
          {status.origin ? <div className="truncate">来源：{status.origin}</div> : null}
        </div>
      ) : null}
      {error ? <div className="mt-3 rounded-lg bg-[#fff4ef] p-2 text-xs text-[#92483d]">{error}</div> : null}

      {snapshot ? (
        <section className="mt-3 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
          <div className="truncate font-medium">{snapshot.title || snapshot.url}</div>
          <div className="mt-1 truncate text-xs text-[#817a6d]">{snapshot.url}</div>
          {snapshot.sensitive ? <div className="mt-2 rounded-md bg-[#fff4ef] p-2 text-xs text-[#92483d]">{snapshot.sensitiveReason || '此页面被安全策略阻止'}</div> : null}
          <div className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#625c50]">{snapshot.text}</div>
          <div className="mt-3 text-xs font-medium text-[#625c50]">可访问元素 {snapshot.elements.length}</div>
          <div className="mt-1 grid gap-1">{snapshot.elements.slice(0, 20).map((element) => <div key={element.token} className="truncate rounded bg-[#f5f2ea] px-2 py-1 text-xs">{element.role} · {element.name}</div>)}</div>
        </section>
      ) : <div className="mt-3 text-xs text-[#817a6d]">配对后可查看当前标签页摘要、字段和页面变化。</div>}
    </div>
  )
}
