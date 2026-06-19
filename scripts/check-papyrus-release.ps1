param(
  [string]$BaseUrl = "https://scallion.uno"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Read-Json([string]$Url) {
  return Invoke-RestMethod -Uri $Url -Headers @{ Accept = "application/json" }
}

function Read-Head([string]$Url) {
  return Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing
}

$manifest = Read-Json "$BaseUrl/api/papyrus/update"
$platform = $manifest.platforms."windows-x86_64"

if (-not $platform) {
  throw "Missing windows-x86_64 entry in updater manifest."
}

if (-not $platform.url -or -not $platform.signature) {
  throw "Updater manifest must include url and signature."
}

if ($platform.url -notmatch "_x64-setup\.exe$") {
  throw "Updater should point to the NSIS setup exe, got: $($platform.url)"
}

$download = Invoke-WebRequest -Uri "$BaseUrl/api/papyrus/download/latest" -MaximumRedirection 0 -UseBasicParsing -ErrorAction SilentlyContinue
$location = [string]$download.Headers.Location

if ($download.StatusCode -ne 302) {
  throw "Latest download endpoint should redirect with 302, got: $($download.StatusCode)"
}

if ($location -notmatch "_x64-setup\.exe") {
  throw "Latest download should redirect to setup exe, got: $location"
}

$artifactHead = Read-Head $platform.url

if ([int64]$artifactHead.Headers.'Content-Length' -lt 1MB) {
  throw "Installer artifact looks too small: $($artifactHead.Headers.'Content-Length') bytes"
}

$signatureUrl = "$($platform.url).sig"
$signatureText = (Invoke-WebRequest -Uri $signatureUrl -UseBasicParsing).Content

if ($signatureText -is [byte[]]) {
  $signatureText = [System.Text.Encoding]::UTF8.GetString($signatureText)
}

if ($signatureText.Trim() -ne $platform.signature.Trim()) {
  throw "Manifest signature does not match $signatureUrl"
}

[pscustomobject]@{
  Version = $manifest.version
  DownloadLocation = $location
  UpdaterUrl = $platform.url
  InstallerBytes = $artifactHead.Headers.'Content-Length'
  Signature = "ok"
}
