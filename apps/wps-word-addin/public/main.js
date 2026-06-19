/* global wps */

var PAPYRUS_DEBUG_KEY = 'papyrus.wps.addin.debug'

function GetGlobalObject() {
  if (typeof globalThis === 'object') {
    return globalThis
  }

  if (typeof window === 'object') {
    return window
  }

  return Function('return this')()
}

function GetWpsApi() {
  var globalObject = GetGlobalObject()

  if (typeof globalObject.wps === 'object') {
    return globalObject.wps
  }

  if (typeof wps === 'object') {
    return wps
  }

  return null
}

function RecordPapyrusDebug(message, detail) {
  try {
    var entry = {
      time: new Date().toISOString(),
      message: message,
      detail: detail || '',
    }
    var raw = window.localStorage.getItem(PAPYRUS_DEBUG_KEY)
    var items = raw ? JSON.parse(raw) : []
    items.push(entry)
    window.localStorage.setItem(PAPYRUS_DEBUG_KEY, JSON.stringify(items.slice(-30)))
  } catch (error) {
    // Ignore logging failures in older WPS webviews.
  }
}

function OnAddinLoad(ribbonUI) {
  var wpsApi = GetWpsApi()

  if (wpsApi && typeof wpsApi.ribbonUI !== 'object') {
    wpsApi.ribbonUI = ribbonUI
  }

  RecordPapyrusDebug('OnAddinLoad')
  return true
}

function GetEnabled(control) {
  RecordPapyrusDebug('GetEnabled', control && (control.Id || control.id) || 'unknown')
  return true
}

function GetVisible(control) {
  RecordPapyrusDebug('GetVisible', control && (control.Id || control.id) || 'unknown')
  return true
}

function GetUrlPath() {
  var locationHref = window.location.href
  var index = locationHref.lastIndexOf('/')

  if (index < 0) {
    return locationHref
  }

  return locationHref.slice(0, index + 1)
}

function GetApplication(wpsApi) {
  var app = null

  try {
    app = typeof wpsApi.WpsApplication === 'function' ? wpsApi.WpsApplication() : null
  } catch (error) {
    app = null
  }

  return app || wpsApi.Application || null
}

function SetTaskPaneVisible(taskPane) {
  if (!taskPane) {
    return
  }

  if ('Visible' in taskPane) {
    taskPane.Visible = true
    return
  }

  if ('visible' in taskPane) {
    taskPane.visible = true
    return
  }

  if (typeof taskPane.Show === 'function') {
    taskPane.Show()
  }
}

function CreatePapyrusTaskPane(wpsApi, taskPaneUrl) {
  var app = GetApplication(wpsApi)
  var candidates = []

  if (typeof wpsApi.CreateTaskPane === 'function') {
    candidates.push(function () {
      return wpsApi.CreateTaskPane(taskPaneUrl, 'Papyrus')
    })
    candidates.push(function () {
      return wpsApi.CreateTaskPane(taskPaneUrl)
    })
  }

  if (typeof wpsApi.CreateTaskpane === 'function') {
    candidates.push(function () {
      return wpsApi.CreateTaskpane(taskPaneUrl, 'Papyrus')
    })
    candidates.push(function () {
      return wpsApi.CreateTaskpane(taskPaneUrl)
    })
  }

  if (app) {
    if (typeof app.CreateTaskPane === 'function') {
      candidates.push(function () {
        return app.CreateTaskPane(taskPaneUrl, 'Papyrus')
      })
    }
    if (typeof app.CreateTaskpane === 'function') {
      candidates.push(function () {
        return app.CreateTaskpane(taskPaneUrl, 'Papyrus')
      })
    }
    if (typeof app.ShowDialog === 'function') {
      candidates.push(function () {
        return app.ShowDialog(taskPaneUrl, 'Papyrus', 420, 720, false, true)
      })
    }
  }

  for (var index = 0; index < candidates.length; index += 1) {
    try {
      var taskPane = candidates[index]()

      if (taskPane) {
        return taskPane
      }
    } catch (error) {
      RecordPapyrusDebug('CreateTaskPane candidate failed', error && error.message)
    }
  }

  throw new Error('No compatible WPS task pane API was found.')
}

function ShowPapyrusTaskPane(control) {
  var taskPaneUrl = GetUrlPath() + 'taskpane.html'
  var wpsApi = GetWpsApi()

  RecordPapyrusDebug('ShowPapyrusTaskPane', taskPaneUrl)

  if (!wpsApi) {
    window.open(taskPaneUrl, '_blank', 'noopener,noreferrer')
    return true
  }

  try {
    var taskPane = CreatePapyrusTaskPane(wpsApi, taskPaneUrl)
    SetTaskPaneVisible(taskPane)
  } catch (error) {
    RecordPapyrusDebug('ShowPapyrusTaskPane fallback', error && error.message)
    window.open(taskPaneUrl, '_blank', 'noopener,noreferrer')
  }

  return true
}

function OnAction(control) {
  var controlId = control && (control.Id || control.id)

  RecordPapyrusDebug('OnAction', controlId || 'unknown')

  if (!controlId || controlId === 'btnPapyrusTaskPane') {
    ShowPapyrusTaskPane()
  }

  return true
}

var ribbon = {
  OnAddinLoad: OnAddinLoad,
  OnAction: OnAction,
  ShowPapyrusTaskPane: ShowPapyrusTaskPane
}

function RegisterPapyrusCallbacks(target) {
  if (!target) {
    return
  }

  target.ribbon = ribbon
  target.PapyrusWpsAddin = ribbon
  target.OnAddinLoad = OnAddinLoad
  target.OnAddInLoad = OnAddinLoad
  target.OnAction = OnAction
  target.GetEnabled = GetEnabled
  target.GetVisible = GetVisible
  target.ShowPapyrusTaskPane = ShowPapyrusTaskPane
}

RegisterPapyrusCallbacks(GetGlobalObject())
RegisterPapyrusCallbacks(typeof window === 'object' ? window : null)
RegisterPapyrusCallbacks(this)
