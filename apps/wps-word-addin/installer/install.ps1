param(
  [string]$AddinName = "PapyrusWpsAddin",
  [string]$UpdateManifestUrl = "https://scallion.uno/api/papyrus/wps/update"
)

$ErrorActionPreference = "Stop"

function Update-PublishFile {
  param([string]$Name, [string]$PublishPath)

  if (Test-Path $PublishPath) {
    [xml]$publish = Get-Content -LiteralPath $PublishPath -Raw
  } else {
    [xml]$publish = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><jsplugins></jsplugins>'
  }

  $root = $publish.DocumentElement
  $existing = @($root.SelectNodes("jsplugin")) | Where-Object { $_.GetAttribute("name") -eq $Name } | Select-Object -First 1
  if (-not $existing) {
    $existing = $publish.CreateElement("jsplugin")
    [void]$root.AppendChild($existing)
  }

  $existing.SetAttribute("enable", "enable_dev")
  $existing.SetAttribute("url", "file://")
  $existing.SetAttribute("name", $Name)
  $existing.SetAttribute("type", "wps")

  $settings = New-Object System.Xml.XmlWriterSettings
  $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
  $settings.Indent = $true
  $writer = [System.Xml.XmlWriter]::Create($PublishPath, $settings)
  $publish.Save($writer)
  $writer.Close()
}

$packageRoot = $PSScriptRoot
$addinSource = Join-Path $packageRoot "addin"
if (-not (Test-Path $addinSource)) {
  throw "The addin payload folder was not found: $addinSource"
}

$jsAddonsRoot = Join-Path $env:APPDATA "kingsoft\wps\jsaddons"
$addinDir = Join-Path $jsAddonsRoot "$($AddinName)_"
$publishPath = Join-Path $jsAddonsRoot "publish.xml"

New-Item -ItemType Directory -Force -Path $addinDir | Out-Null
Copy-Item -Path (Join-Path $addinSource "*") -Destination $addinDir -Recurse -Force

$releasePath = Join-Path $packageRoot "release.json"
if (Test-Path $releasePath) {
  Copy-Item -LiteralPath $releasePath -Destination (Join-Path $addinDir "papyrus-wps-version.json") -Force
}

$updateScriptSource = Join-Path $packageRoot "update.ps1"
if (Test-Path $updateScriptSource) {
  $updateScriptTarget = Join-Path $addinDir "update.ps1"
  Copy-Item -LiteralPath $updateScriptSource -Destination $updateScriptTarget -Force
}

New-Item -ItemType Directory -Force -Path $jsAddonsRoot | Out-Null
Update-PublishFile -Name $AddinName -PublishPath $publishPath

if (Test-Path $updateScriptTarget) {
  try {
    $taskName = "Papyrus WPS Addin Update"
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$updateScriptTarget`" -AddinName `"$AddinName`" -ManifestUrl `"$UpdateManifestUrl`" -Silent"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $args
    $daily = New-ScheduledTaskTrigger -Daily -At 10:00
    $logon = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($daily, $logon) -Description "Keeps the Papyrus WPS add-in up to date." -Force | Out-Null
    Write-Host "Auto update task registered: $taskName"
  } catch {
    Write-Warning "Auto update task could not be registered: $($_.Exception.Message)"
  }
}

Write-Host "Papyrus WPS add-in installed to: $addinDir"
Write-Host "WPS add-in publish file updated: $publishPath"
Write-Host "Restart WPS Writer to load or refresh Papyrus."
