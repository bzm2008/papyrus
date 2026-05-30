import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useAppStore } from '../stores/useAppStore'

export async function checkAndDownloadUpdate() {
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

  try {
    const update = await check({ timeout: 15000 })

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

    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0
        useAppStore.getState().setUpdateState({
          status: 'downloading',
          message: '正在静默下载更新',
          progress: 0,
        })
      }

      if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        useAppStore.getState().setUpdateState({
          status: 'downloading',
          message: '正在静默下载更新',
          progress: total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0,
        })
      }

      if (event.event === 'Finished') {
        useAppStore.getState().setUpdateState({
          status: 'ready',
          message: '更新已安装，重启后生效',
          progress: 100,
        })
      }
    })
  } catch (error) {
    useAppStore.getState().setUpdateState({
      status: 'error',
      message: error instanceof Error ? error.message : '更新检查失败',
      progress: 0,
    })
  }
}

export async function relaunchToInstallUpdate() {
  if (!isTauriRuntime()) {
    useAppStore.getState().setUpdateState({
      status: 'unavailable',
      message: '浏览器预览环境不能重启桌面应用',
      progress: 0,
    })
    return
  }

  await relaunch()
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
