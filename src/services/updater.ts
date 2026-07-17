import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useAppStore } from '../stores/useAppStore'
import { pauseActiveSecretaryLedgerRuns } from './secretaryLedgerRuntime'
import { cancelSecretaryRun } from './secretaryRunController'
import { prepareUpdateDataSnapshot } from './updateDataProtection'

let pendingUpdate: Update | undefined
let updateOperation: Promise<void> | undefined

export async function checkAndDownloadUpdate() {
  if (updateOperation) return updateOperation
  updateOperation = checkAndDownloadUpdateInternal()
  try { await updateOperation } finally { updateOperation = undefined }
}

async function checkAndDownloadUpdateInternal() {
  const store = useAppStore.getState()

  if (!isTauriRuntime()) {
    store.setUpdateState({
      status: 'unavailable',
      message: '请在 Tauri 桌面端中检查更新',
      progress: 0,
    })
    return
  }

  store.setUpdateState({ status: 'checking', message: '正在检查更新', progress: 0 })

  let update: Update | undefined
  try {
    await closePendingUpdate()
    update = (await check({ timeout: 15000 })) ?? undefined

    if (!update) {
      useAppStore.getState().setUpdateState({
        status: 'not-available',
        message: '当前已是最新版本',
        progress: 0,
      })
      return
    }

    useAppStore.getState().setUpdateState({
      status: 'available',
      message: `发现新版本 ${update.version}`,
      progress: 0,
      version: update.version,
    })

    let downloaded = 0
    let total = 0

    await update.download((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0
        useAppStore.getState().setUpdateState({
          status: 'downloading',
          message: '正在下载更新（尚未安装）',
          progress: 0,
        })
      }

      if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        useAppStore.getState().setUpdateState({
          status: 'downloading',
          message: '正在下载更新（尚未安装）',
          progress: total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0,
        })
      }

      if (event.event === 'Finished') {
        useAppStore.getState().setUpdateState({ status: 'downloading', message: '更新包已下载，等待确认安装', progress: 100 })
      }
    }, { timeout: 120000 })

    pendingUpdate = update
    useAppStore.getState().setUpdateState({
      status: 'ready',
      message: '更新包已下载并验签，确认后安全重启安装',
      progress: 100,
      version: update.version,
    })
  } catch (error) {
    if (update) await closeUpdate(update)
    await closePendingUpdate()
    useAppStore.getState().setUpdateState({
      status: 'error',
      message: error instanceof Error ? error.message : '更新检查失败',
      progress: 0,
    })
  }
}

export async function relaunchToInstallUpdate() {
  if (updateOperation) {
    useAppStore.getState().setUpdateState({ status: 'error', message: '更新仍在下载，请等待下载完成后再安装', progress: useAppStore.getState().updateProgress })
    return
  }
  if (!isTauriRuntime()) {
    useAppStore.getState().setUpdateState({
      status: 'unavailable',
      message: '浏览器预览环境不能重启桌面应用',
      progress: 0,
    })
    return
  }

  const update = pendingUpdate
  if (!update) {
    useAppStore.getState().setUpdateState({ status: 'error', message: '没有待安装的更新，请重新检查更新', progress: 0 })
    return
  }

  pendingUpdate = undefined
  try {
    await pauseActiveSecretaryLedgerRuns()
    cancelSecretaryRun()
    const snapshot = await prepareUpdateDataSnapshot(update.version)
    if (!snapshot.ok || !('snapshotId' in snapshot)) throw new Error(snapshot.message)
    useAppStore.getState().setUpdateState({ status: 'ready', message: '数据快照已保存，正在重启并应用更新', progress: 100, version: update.version })
    await update.install()
    if (!isWindowsRuntime()) await relaunch()
  } catch (error) {
    await closeUpdate(update)
    useAppStore.getState().setUpdateState({ status: 'error', message: error instanceof Error ? error.message : '应用更新失败，请重新检查', progress: 0, version: update.version })
  }
}
async function closePendingUpdate() { const update = pendingUpdate; pendingUpdate = undefined; if (update) await closeUpdate(update) }
async function closeUpdate(update: Update) {
  try {
    await update.close()
  } catch {
    return
  }
}
function isWindowsRuntime() { return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent) }

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
