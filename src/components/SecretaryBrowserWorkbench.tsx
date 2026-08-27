import { useCallback, useEffect, useState } from 'react'

import {
  browserSnapshot,
  disconnectBrowserBridge,
  getBrowserBridgeConnectionPresentation,
  getBrowserBridgeStatus,
  startBrowserBridgePairing,
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
  const [awaitingPairing, setAwaitingPairing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))

  const refresh = useCallback(async () => {
    try {
      const next = await getBrowserBridgeStatus()
      setStatus(next)
      setNowSeconds(Math.floor(Date.now() / 1000))
      const presentation = getBrowserBridgeConnectionPresentation(next)
      if (next.paired) {
        setAwaitingPairing(false)
        setMessage('')
      }
      if (presentation.state === 'connected') {
        setSnapshot(await browserSnapshot())
      } else {
        setSnapshot(undefined)
      }
      setError(next.error ?? '')
      if (next.error) setMessage('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取浏览器状态')
      setMessage('')
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void refresh())
  }, [refresh])

  useEffect(() => {
    if (!awaitingPairing && !status.expiresAt) return undefined
    const timer = globalThis.setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000))
      if (awaitingPairing) void refresh()
    }, 1000)
    return () => globalThis.clearInterval(timer)
  }, [awaitingPairing, refresh, status.expiresAt])

  const pair = async () => {
    try {
      await startBrowserBridgePairing()
      setAwaitingPairing(true)
      setStatus(await getBrowserBridgeStatus())
      setError('')
      setMessage('Browser Bridge 已待命。打开扩展后点击“连接当前标签页”即可自动完成一次性授权。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '启动配对失败')
      setMessage('')
    }
  }

  const disconnect = async () => {
    await disconnectBrowserBridge()
    setAwaitingPairing(false)
    setSnapshot(undefined)
    setMessage('')
    await refresh()
  }

  const presentation = getBrowserBridgeConnectionPresentation(status, nowSeconds)
  const runConnectionAction = async () => {
    if (presentation.action === 'disconnect') {
      await disconnect()
      return
    }
    if (presentation.action === 'pair') {
      await pair()
      return
    }
    if (presentation.action === 'refresh') {
      await refresh()
    }
  }

  return (
    <div className="papyrus-scrollbar h-full overflow-y-auto px-4 py-3 text-sm text-[#332f27]">
      {(() => {
        const state = presentation.state
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

      <section aria-label="浏览器连接租约" className="mt-3 rounded-lg border border-[#e8ddc7] bg-[#fffdf7] px-3 py-2 text-xs text-[#625c50]">
        <div className="font-medium text-[#332f27]">{presentation.title}</div>
        <p className="mt-1 leading-5">{presentation.detail}</p>
        {status.tabId !== undefined && presentation.state === 'connected' ? <div className="mt-1 text-[#817a6d]">仅当前已确认标签页可被协助</div> : null}
      </section>

      <div className="mt-3 flex flex-wrap gap-2">
        {presentation.action !== 'none' ? <button type="button" onClick={() => void runConnectionAction()} className={presentation.action === 'disconnect' ? 'rounded-md border border-[#e6c9bf] px-2.5 py-1.5 text-xs text-[#9a4338]' : 'rounded-md bg-[#20201d] px-2.5 py-1.5 text-xs text-white'}>{presentation.actionLabel}</button> : null}
        <button type="button" onClick={() => void refresh()} className="rounded-md border border-[#d8cfc0] px-2.5 py-1.5 text-xs">{presentation.state === 'connected' ? '刷新快照' : '刷新状态'}</button>
      </div>

      {message ? <div className="mt-3 rounded-lg bg-[#edf6eb] p-2 text-xs text-[#315d39]">{message}</div> : null}
      {error && presentation.state !== 'error' ? <div className="mt-3 rounded-lg bg-[#fff4ef] p-2 text-xs text-[#92483d]">{error}</div> : null}

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
