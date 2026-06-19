param(
  [switch]$Clear
)

$ErrorActionPreference = "Stop"

$storageRoot = Join-Path $env:APPDATA "kingsoft\wps\addons\data"
$pattern = "papyrus.wps.addin.debug"

if (-not (Test-Path $storageRoot)) {
  Write-Host "WPS addin storage folder was not found: $storageRoot"
  exit 0
}

$matches = Get-ChildItem -LiteralPath $storageRoot -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -match "Local Storage\\leveldb" -and
    (Select-String -LiteralPath $_.FullName -Pattern $pattern -Quiet -ErrorAction SilentlyContinue)
  }

if (-not $matches) {
  Write-Host "No Papyrus WPS debug entries found yet."
  Write-Host "Restart WPS Writer, click Open Sidebar, then run npm run wps:debug again."
  exit 0
}

foreach ($file in $matches) {
  Write-Host ""
  Write-Host "Found debug storage in: $($file.FullName)"
  Select-String -LiteralPath $file.FullName -Pattern $pattern -Context 0,2 -ErrorAction SilentlyContinue
}

if ($Clear) {
  Write-Host ""
  Write-Host "Clear is not automated because WPS LevelDB files may be locked. Close WPS and delete the matching LevelDB files manually if needed."
}
