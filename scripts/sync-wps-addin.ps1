param(
  [string]$AddinName = "PapyrusWpsAddin"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repoRoot "dist-wps-addin"
$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$packageJson.version

if (-not (Test-Path $distDir)) {
  throw "dist-wps-addin not found. Run npm run wps:build first."
}

$mainPath = Join-Path $distDir "main.js"
$legacyMainPath = Join-Path $distDir "js\main.js"

if ((Test-Path $mainPath) -and -not (Test-Path $legacyMainPath)) {
  $legacyMainDir = Split-Path -Parent $legacyMainPath
  New-Item -ItemType Directory -Force -Path $legacyMainDir | Out-Null
  Copy-Item -LiteralPath $mainPath -Destination $legacyMainPath -Force
}

$jsAddonsRoot = Join-Path $env:APPDATA "kingsoft\wps\jsaddons"
$addinDir = Join-Path $jsAddonsRoot "$($AddinName)_"
$publishPath = Join-Path $jsAddonsRoot "publish.xml"

New-Item -ItemType Directory -Force -Path $addinDir | Out-Null
Copy-Item -Path (Join-Path $distDir "*") -Destination $addinDir -Recurse -Force

$versionPath = Join-Path $addinDir "papyrus-wps-version.json"
[ordered]@{
  version = $version
  product = "Papyrus WPS Add-in"
  pubDate = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $versionPath -Encoding UTF8

$installerUpdateScript = Join-Path $repoRoot "apps\wps-word-addin\installer\update.ps1"
if (Test-Path $installerUpdateScript) {
  Copy-Item -LiteralPath $installerUpdateScript -Destination (Join-Path $addinDir "update.ps1") -Force
}

if (Test-Path $publishPath) {
  [xml]$publish = Get-Content -LiteralPath $publishPath -Raw
} else {
  [xml]$publish = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><jsplugins></jsplugins>'
}

$root = $publish.DocumentElement
$existing = @($root.SelectNodes("jsplugin")) | Where-Object { $_.GetAttribute("name") -eq $AddinName } | Select-Object -First 1

if (-not $existing) {
  $existing = $publish.CreateElement("jsplugin")
  [void]$root.AppendChild($existing)
}

$existing.SetAttribute("enable", "enable_dev")
$existing.SetAttribute("url", "file://")
$existing.SetAttribute("name", $AddinName)
$existing.SetAttribute("type", "wps")

$settings = New-Object System.Xml.XmlWriterSettings
$settings.Encoding = New-Object System.Text.UTF8Encoding($false)
$settings.Indent = $true
$writer = [System.Xml.XmlWriter]::Create($publishPath, $settings)
$publish.Save($writer)
$writer.Close()

Write-Host "Synced WPS addin to: $addinDir"
Write-Host "Wrote version file: $versionPath"
Write-Host "Updated publish file: $publishPath"
Write-Host "Restart WPS Writer to reload the addin."
