/* global wps */

function OnAddinLoad(ribbonUI) {
  if (typeof wps === 'object' && typeof wps.ribbonUI !== 'object') {
    wps.ribbonUI = ribbonUI
  }

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

function ShowPapyrusTaskPane(control) {
  var taskPaneUrl = GetUrlPath() + 'taskpane.html'

  try {
    var taskPane = wps.CreateTaskPane(taskPaneUrl, 'Papyrus')
    taskPane.Visible = true
  } catch (error) {
    window.open(taskPaneUrl, '_blank', 'noopener,noreferrer')
  }
}

function OnAction(control) {
  var controlId = control && (control.Id || control.id)

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

window.ribbon = ribbon
window.OnAddinLoad = OnAddinLoad
window.OnAction = OnAction
window.ShowPapyrusTaskPane = ShowPapyrusTaskPane
this.ribbon = ribbon
this.OnAddinLoad = OnAddinLoad
this.OnAction = OnAction
this.ShowPapyrusTaskPane = ShowPapyrusTaskPane
