$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repoRoot "dist-wps-addin"
$mainPath = Join-Path $distDir "main.js"
$jsDir = Join-Path $distDir "js"
$legacyMainPath = Join-Path $jsDir "main.js"

if (-not (Test-Path $mainPath)) {
  throw "WPS addin main.js not found in dist-wps-addin. Run the Vite build first."
}

New-Item -ItemType Directory -Force -Path $jsDir | Out-Null
Copy-Item -LiteralPath $mainPath -Destination $legacyMainPath -Force

Write-Host "Prepared WPS legacy entry: $legacyMainPath"
