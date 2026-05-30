$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$gitCmd = Join-Path $projectRoot ".codex-tools\MinGit\cmd"

if (Test-Path -LiteralPath (Join-Path $gitCmd "git.exe")) {
  $env:PATH = "$gitCmd;$env:PATH"
} else {
  Write-Warning "Portable Git was not found at $gitCmd"
}

Write-Host "Portable tools activated for this PowerShell session."
Write-Host "Git: $gitCmd"
