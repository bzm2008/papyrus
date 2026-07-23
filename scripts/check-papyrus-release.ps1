param(
  [string]$BaseUrl = "https://scallion.uno",
  [string]$LegacyBaseUrl = "https://scallion.uno",
  [string]$ExpectedVersion
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Read-Json([string]$Url) {
  return Invoke-RestMethod -Uri $Url -Headers @{ Accept = "application/json" }
}

function Read-Head([string]$Url) {
  return Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageVersion = [string]((Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json).version)
if (-not $ExpectedVersion) {
  $ExpectedVersion = $packageVersion
}
if ($ExpectedVersion -ne $packageVersion) {
  throw "ExpectedVersion $ExpectedVersion must match package.json version $packageVersion."
}

$platformChecks = @(
  @{ Key = 'windows-x86_64'; Query = 'windows'; UpdaterAsset = '_x64-setup\.exe$'; DownloadAsset = '_x64-setup\.exe'; MinimumBytes = 1MB },
  @{ Key = 'linux-x86_64'; Query = 'linux'; UpdaterAsset = '\.AppImage$'; DownloadAsset = '\.AppImage'; MinimumBytes = 1MB },
  @{ Key = 'darwin-x86_64'; Query = 'macos'; UpdaterAsset = '(_x64|x86_64)\.app\.tar\.gz$'; DownloadAsset = '_x64\.dmg'; MinimumBytes = 1MB },
  @{ Key = 'darwin-aarch64'; Query = 'macos&arch=arm64'; UpdaterAsset = '(aarch64|arm64)\.app\.tar\.gz$'; DownloadAsset = '(aarch64|arm64)\.dmg'; MinimumBytes = 1MB }
)

$canonicalBaseUrl = "https://sca-hub.cn"
$endpointChecks = @(
  @{ Name = 'canonical'; BaseUrl = $canonicalBaseUrl },
  @{ Name = 'legacy'; BaseUrl = $LegacyBaseUrl }
)

$manifests = @{}
$results = @()
$canonicalManifest = $null
foreach ($endpoint in $endpointChecks) {
  $manifest = Read-Json "$($endpoint.BaseUrl)/api/papyrus/update"
  $manifestVersion = [string]$manifest.version
  if ($manifestVersion -ne $ExpectedVersion) {
    throw "$($endpoint.Name) OTA manifest version $manifestVersion does not match expected Papyrus version $ExpectedVersion. Publish the signed $ExpectedVersion assets before enabling updates."
  }
  $manifests[$endpoint.Name] = $manifest

  foreach ($check in $platformChecks) {
    $platform = $manifest.platforms.($check.Key)
    if (-not $platform) { throw "$($endpoint.Name) updater manifest is missing $($check.Key)." }
    if (-not $platform.url -or -not $platform.signature) { throw "$($endpoint.Name) updater manifest must include url and signature for $($check.Key)." }
    if ($platform.url -notmatch '^https://' -or $platform.url -notmatch $check.UpdaterAsset) { throw "$($endpoint.Name) updater asset for $($check.Key) has unexpected URL: $($platform.url)" }

    $downloadUri = "$($endpoint.BaseUrl)/api/papyrus/download/latest?platform=$($check.Query)"
    $download = Invoke-WebRequest -Uri $downloadUri -MaximumRedirection 0 -UseBasicParsing -ErrorAction SilentlyContinue
    $location = [string]$download.Headers.Location
    if ($download.StatusCode -ne 302) { throw "$downloadUri should redirect with 302, got: $($download.StatusCode)" }
    if ($location -notmatch $check.DownloadAsset) { throw "$downloadUri redirected to unexpected asset: $location" }

    $artifactHead = Read-Head $platform.url
    if ([int64]$artifactHead.Headers.'Content-Length' -lt $check.MinimumBytes) { throw "Artifact for $($endpoint.Name) $($check.Key) looks too small: $($artifactHead.Headers.'Content-Length') bytes" }

    $signatureUrl = "$($platform.url).sig"
    $signatureText = (Invoke-WebRequest -Uri $signatureUrl -UseBasicParsing).Content
    if ($signatureText -is [byte[]]) { $signatureText = [System.Text.Encoding]::UTF8.GetString($signatureText) }
    if ($signatureText.Trim() -ne $platform.signature.Trim()) { throw "$($endpoint.Name) manifest signature does not match $signatureUrl" }
    $results += [pscustomobject]@{ Endpoint = $endpoint.Name; Platform = $check.Key; DownloadLocation = $location; UpdaterUrl = $platform.url; InstallerBytes = $artifactHead.Headers.'Content-Length'; Signature = 'ok' }
  }
}

if ([string]$manifests.canonical.version -ne [string]$manifests.legacy.version) {
  throw "Canonical and legacy OTA endpoints returned different versions."
}

$wps = Read-Json "$canonicalBaseUrl/api/papyrus/wps/update"
if ([string]$wps.version -ne $ExpectedVersion) { throw "WPS update version $($wps.version) does not match expected $ExpectedVersion" }

[pscustomobject]@{
  Version = $manifests.canonical.version
  Platforms = $results
  WpsVersion = $wps.version
}
