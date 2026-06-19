param(
  [string]$AddinName = "PapyrusWpsAddin",
  [string]$ManifestUrl = "https://scallion.uno/api/papyrus/wps/update",
  [switch]$Silent
)

$ErrorActionPreference = "Stop"

function Write-UpdateMessage {
  param([string]$Message)
  if (-not $Silent) {
    Write-Host $Message
  }
}

function Get-CurrentVersion {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return ""
  }
  try {
    $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    return [string]$json.version
  } catch {
    return ""
  }
}

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

$jsAddonsRoot = Join-Path $env:APPDATA "kingsoft\wps\jsaddons"
$addinDir = Join-Path $jsAddonsRoot "$($AddinName)_"
$versionPath = Join-Path $addinDir "papyrus-wps-version.json"
$currentVersion = Get-CurrentVersion -Path $versionPath

$manifest = Invoke-RestMethod -Uri "$ManifestUrl?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -UseBasicParsing
$latestVersion = [string]$manifest.version
$packageUrl = [string]$manifest.packageUrl

if (-not $latestVersion -or -not $packageUrl) {
  throw "The update manifest is missing version or packageUrl."
}

if ($currentVersion -eq $latestVersion) {
  Write-UpdateMessage "Papyrus WPS add-in is already up to date: $latestVersion"
  return
}

$tempRoot = Join-Path $env:TEMP ("papyrus-wps-update-" + [Guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $tempRoot "package.zip"
$extractDir = Join-Path $tempRoot "package"

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
  Write-UpdateMessage "Downloading Papyrus WPS add-in $latestVersion..."
  Invoke-WebRequest -Uri $packageUrl -OutFile $zipPath -UseBasicParsing
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

  $payload = Join-Path $extractDir "addin"
  if (-not (Test-Path $payload)) {
    throw "The downloaded package does not contain an addin folder."
  }

  New-Item -ItemType Directory -Force -Path $addinDir | Out-Null
  Copy-Item -Path (Join-Path $payload "*") -Destination $addinDir -Recurse -Force

  $releasePath = Join-Path $extractDir "release.json"
  if (Test-Path $releasePath) {
    Copy-Item -LiteralPath $releasePath -Destination $versionPath -Force
  }

  $updateScript = Join-Path $extractDir "update.ps1"
  if (Test-Path $updateScript) {
    Copy-Item -LiteralPath $updateScript -Destination (Join-Path $addinDir "update.ps1") -Force
  }

  Update-PublishFile -Name $AddinName -PublishPath (Join-Path $jsAddonsRoot "publish.xml")
  Write-UpdateMessage "Papyrus WPS add-in updated to $latestVersion. Restart WPS Writer if it is open."
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
