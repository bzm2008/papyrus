param(
  [string]$OutputDir = "artifacts",
  [string]$Version
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repoRoot "dist-wps-addin"
$installerDir = Join-Path $repoRoot "apps\wps-word-addin\installer"
$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json

if (-not $Version) {
  $Version = [string]$packageJson.version
}

if (-not (Test-Path $distDir)) {
  throw "dist-wps-addin not found. Run npm run wps:build first."
}

$outRoot = Join-Path $repoRoot $OutputDir
$stageRoot = Join-Path $env:TEMP ("Papyrus-WPS-Addin_$Version-" + [Guid]::NewGuid().ToString("N"))
$addinStage = Join-Path $stageRoot "addin"
$zipPath = Join-Path $outRoot "Papyrus-WPS-Addin_$Version.zip"

New-Item -ItemType Directory -Force -Path $addinStage | Out-Null
New-Item -ItemType Directory -Force -Path $outRoot | Out-Null

Copy-Item -Path (Join-Path $distDir "*") -Destination $addinStage -Recurse -Force
Copy-Item -LiteralPath (Join-Path $installerDir "install.cmd") -Destination $stageRoot -Force
Copy-Item -LiteralPath (Join-Path $installerDir "install.ps1") -Destination $stageRoot -Force
Copy-Item -LiteralPath (Join-Path $installerDir "update.ps1") -Destination $stageRoot -Force

$release = [ordered]@{
  version = $Version
  product = "Papyrus WPS Add-in"
  packageUrl = "https://scallion.uno/downloads/papyrus/wps/Papyrus-WPS-Addin_$Version.zip?v=$Version"
  updateManifestUrl = "https://scallion.uno/api/papyrus/wps/update"
  pubDate = (Get-Date).ToUniversalTime().ToString("o")
}
$release | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stageRoot "release.json") -Encoding UTF8

Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -Force
Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Created WPS add-in package: $zipPath"
