import { useCallback, useEffect, useState } from 'react'

import {
  deriveBrowserBridgeState,
  disconnectBrowserBridge,
  getBrowserBridgeStatus,
  startBrowserBridgePairing,
  type BrowserBridgePairing,
  type BrowserBridgeStatus,
} from '../services/browserBridgeClient'

const EXTENSION_INSTALL_PATH = 'dist-browser-bridge/'

const stateLabels = {
  disabled: '未启动',
  listening: '等待配对',
  pairing: '配对中',
  connected: '已连接',
  stale: '需要重新配对',
  error: '错误',
} as const

export function BrowserBridgeSettings() {
  const [status, setStatus] = useState<BrowserBridgeStatus>({ running: false, paired: false })
  const [pairing, setPairing] = useState<BrowserBridgePairing>()
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await getBrowserBridgeStatus()
      setStatus(next)
      if (next.paired) setPairing(undefined)
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法读取 Browser Bridge 状态')
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
      try {
        await navigator.clipboard?.writeText(JSON.stringify({ wsUrl: next.wsUrl, token: next.token, nonce: next.nonce }))
      } catch {
        // Clipboard access is optional; the connection remains available in the
        // compatibility details below.
      }
      setMessage('Browser Bridge 已自动待命。打开扩展后点击“连接当前标签页”即可；兼容配对信息已复制。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '启动配对失败')
    }
  }

  const copyPairing = async () => {
    if (!pairing) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(
        JSON.stringify({ wsUrl: pairing.wsUrl, token: pairing.token, nonce: pairing.nonce }, null, 2),
      )
      setMessage('配对信息已复制；配对成功后不会继续显示 token。')
    } catch {
      setMessage('无法访问系统剪贴板，请手动复制当前配对信息。')
    }
  }

  const disconnect = async () => {
    await disconnectBrowserBridge()
    setPairing(undefined)
    await refresh()
  }

  return (
    <div className="rounded-lg border border-[#e8ddc7] bg-[#fffdf7] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">Browser Bridge</div>
          <div className="mt-1 text-xs text-[#817a6d]">Chromium MV3 · 自动待命 · 仅监听 127.0.0.1 · 当前标签页授权</div>
        </div>
        {(() => {
          const state = status.connectionState ?? deriveBrowserBridgeState(status)
          return <span className={`rounded-md px-2 py-1 text-xs ${state === 'connected' ? 'bg-[#edf6eb] text-[#315d39]' : state === 'error' ? 'bg-[#fff4ef] text-[#9a4338]' : 'bg-[#f5f2ea] text-[#817a6d]'}`}>{stateLabels[state]}</span>
        })()}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void pair()} className="rounded-md bg-[#20201d] px-2.5 py-1.5 text-xs text-white">准备扩展连接</button>
        <button type="button" onClick={() => void refresh()} className="rounded-md border border-[#d8cfc0] px-2.5 py-1.5 text-xs">刷新</button>
        {status.paired ? <button type="button" onClick={() => void disconnect()} className="rounded-md border border-[#e6c9bf] px-2.5 py-1.5 text-xs text-[#9a4338]">断开</button> : null}
      </div>
      <div className="mt-2 grid gap-1 rounded-md bg-[#fffefa] px-2.5 py-2 text-[11px] leading-5 text-[#625c50]">
        <div>扩展目录：{EXTENSION_INSTALL_PATH}</div>
        {status.tabId !== undefined ? <div>当前标签页：{status.tabId}</div> : null}
        {status.origin ? <div className="truncate">来源：{status.origin}</div> : null}
        {status.error ? <div className="text-[#9a4338]">健康状态：{status.error}</div> : null}
      </div>
      {pairing ? (
        <details className="mt-2 rounded-md bg-[#fffefa] px-2.5 py-2 text-[11px] text-[#625c50]">
          <summary className="cursor-pointer text-[#817a6d]">兼容模式：查看配对信息</summary>
          <div className="mt-2 grid gap-1 break-all">
            <div>WebSocket：{pairing.wsUrl}</div>
            <div>Token：{pairing.token}</div>
            <div>Nonce：{pairing.nonce}</div>
            <button type="button" onClick={() => void copyPairing()} className="mt-1 justify-self-start rounded-md border border-[#d8cfc0] px-2 py-1 text-[11px]">复制配对信息</button>
          </div>
        </details>
      ) : null}
      {message ? <div className="mt-2 text-xs text-[#817a6d]">{message}</div> : null}
    </div>
  )
}
