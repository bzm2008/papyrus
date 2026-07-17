param(
  [string]$BaseUrl = "https://scallion.uno",
  [string]$ExpectedVersion = "1.0.0"
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
$manifestVersion = [string]$manifest.version
if ($manifestVersion -ne $ExpectedVersion) {
  throw "OTA manifest version $manifestVersion does not match expected Papyrus version $ExpectedVersion. Publish the signed $ExpectedVersion assets before enabling updates."
}
$platformChecks = @(
  @{ Key = 'windows-x86_64'; Query = 'windows'; Asset = '_x64-setup\.exe$'; MinimumBytes = 1MB },
  @{ Key = 'linux-x86_64'; Query = 'linux'; Asset = '\.AppImage$'; MinimumBytes = 1MB },
  @{ Key = 'darwin-x86_64'; Query = 'macos'; Asset = '(_x64|x86_64)\.app\.tar\.gz$'; MinimumBytes = 1MB },
  @{ Key = 'darwin-aarch64'; Query = 'macos&arch=arm64'; Asset = '(aarch64|arm64)\.app\.tar\.gz$'; MinimumBytes = 1MB }
)

$results = @()
foreach ($check in $platformChecks) {
  $platform = $manifest.platforms.($check.Key)
  if (-not $platform) { throw "Missing $($check.Key) entry in updater manifest." }
  if (-not $platform.url -or -not $platform.signature) { throw "Updater manifest must include url and signature for $($check.Key)." }
  if ($platform.url -notmatch $check.Asset) { throw "Updater asset for $($check.Key) has unexpected URL: $($platform.url)" }

  $downloadUri = "$BaseUrl/api/papyrus/download/latest?platform=$($check.Query)"
  $download = Invoke-WebRequest -Uri $downloadUri -MaximumRedirection 0 -UseBasicParsing -ErrorAction SilentlyContinue
  $location = [string]$download.Headers.Location
  if ($download.StatusCode -ne 302) { throw "$downloadUri should redirect with 302, got: $($download.StatusCode)" }
  if ($location -notmatch $check.Asset) { throw "$downloadUri redirected to unexpected asset: $location" }

  $artifactHead = Read-Head $platform.url
  if ([int64]$artifactHead.Headers.'Content-Length' -lt $check.MinimumBytes) { throw "Artifact for $($check.Key) looks too small: $($artifactHead.Headers.'Content-Length') bytes" }

  $signatureUrl = "$($platform.url).sig"
  $signatureText = (Invoke-WebRequest -Uri $signatureUrl -UseBasicParsing).Content
  if ($signatureText -is [byte[]]) { $signatureText = [System.Text.Encoding]::UTF8.GetString($signatureText) }
  if ($signatureText.Trim() -ne $platform.signature.Trim()) { throw "Manifest signature does not match $signatureUrl" }
  $results += [pscustomobject]@{ Platform = $check.Key; DownloadLocation = $location; UpdaterUrl = $platform.url; InstallerBytes = $artifactHead.Headers.'Content-Length'; Signature = 'ok' }
}

$wps = Read-Json "$BaseUrl/api/papyrus/wps/update"
if ([string]$wps.version -ne $ExpectedVersion) { throw "WPS update version $($wps.version) does not match expected $ExpectedVersion" }

[pscustomobject]@{
  Version = $manifest.version
  Platforms = $results
  WpsVersion = $wps.version
}
