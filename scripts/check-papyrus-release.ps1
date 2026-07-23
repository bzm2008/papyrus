param(
  [string]$LegacyBaseUrl = "https://scallion.uno",
  [string]$ExpectedVersion
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

. (Join-Path $PSScriptRoot "lib\release-retry.ps1")

$ReleaseRequestTimeoutSeconds = 30
$ReleaseRetryMaxAttempts = 4

function Read-ExpectedReleaseManifest([string]$Url, [string]$Name, [string]$ExpectedVersion) {
  return Invoke-ReleaseWithRetry -Description "$Name OTA manifest" -MaxAttempts $ReleaseRetryMaxAttempts -Operation {
    $manifest = Invoke-RestMethod -Uri $Url -Headers @{ Accept = "application/json" } -TimeoutSec $ReleaseRequestTimeoutSeconds -ErrorAction Stop
    $manifestVersion = [string]$manifest.version
    if ($manifestVersion -eq $ExpectedVersion) { return $manifest }
    if (Test-ReleaseManifestIsStale -ManifestVersion $manifestVersion -ExpectedVersion $ExpectedVersion) {
      throw (New-StaleReleaseManifestException "$Name OTA manifest version $manifestVersion is older than expected Papyrus version $ExpectedVersion.")
    }
    throw "$Name OTA manifest version $manifestVersion does not match expected Papyrus version $ExpectedVersion."
  }
}

function Read-Head([string]$Url, [string]$Description) {
  return Invoke-ReleaseWithRetry -Description $Description -MaxAttempts $ReleaseRetryMaxAttempts -Operation {
    Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec $ReleaseRequestTimeoutSeconds -ErrorAction Stop
  }
}

function Read-Redirect([string]$Url, [string]$Description) {
  return Invoke-ReleaseWithRetry -Description $Description -MaxAttempts $ReleaseRetryMaxAttempts -Operation {
    try {
      $response = Invoke-WebRequest -Uri $Url -MaximumRedirection 0 -UseBasicParsing -TimeoutSec $ReleaseRequestTimeoutSeconds -ErrorAction Stop
    } catch {
      $response = $_.Exception.Response
      if ($null -eq $response) { throw }
    }
    if ($response.StatusCode -eq 404) { throw (New-ReleaseHttpStatusException "$Description returned HTTP 404." 404) }
    return $response
  }
}

function Download-ReleaseFile([string]$Url, [string]$Path, [string]$Description) {
  Invoke-ReleaseWithRetry -Description $Description -MaxAttempts $ReleaseRetryMaxAttempts -Operation {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing -TimeoutSec $ReleaseRequestTimeoutSeconds -ErrorAction Stop
  }
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
$tempRoot = Join-Path $env:TEMP ("papyrus-ota-verify-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
  foreach ($endpoint in $endpointChecks) {
    $manifest = Read-ExpectedReleaseManifest -Url "$($endpoint.BaseUrl)/api/papyrus/update" -Name $endpoint.Name -ExpectedVersion $ExpectedVersion
    $manifests[$endpoint.Name] = $manifest

    foreach ($check in $platformChecks) {
      $platform = $manifest.platforms.($check.Key)
      if (-not $platform) { throw "$($endpoint.Name) updater manifest is missing $($check.Key)." }
      if (-not $platform.url -or -not $platform.signature) { throw "$($endpoint.Name) updater manifest must include url and signature for $($check.Key)." }
      if ($platform.url -notmatch '^https://' -or $platform.url -notmatch $check.UpdaterAsset) { throw "$($endpoint.Name) updater asset for $($check.Key) has unexpected URL: $($platform.url)" }

      $downloadUri = "$($endpoint.BaseUrl)/api/papyrus/download/latest?platform=$($check.Query)"
      $download = Read-Redirect -Url $downloadUri -Description "$($endpoint.Name) $($check.Key) latest-download redirect"
      $location = [string]$download.Headers.Location
      if ($download.StatusCode -ne 302) { throw "$downloadUri should redirect with 302, got: $($download.StatusCode)" }
      if ($location -notmatch $check.DownloadAsset) { throw "$downloadUri redirected to unexpected asset: $location" }

      $artifactHead = Read-Head -Url $platform.url -Description "$($endpoint.Name) $($check.Key) updater artifact HEAD"
      if ([int64]$artifactHead.Headers.'Content-Length' -lt $check.MinimumBytes) { throw "Artifact for $($endpoint.Name) $($check.Key) looks too small: $($artifactHead.Headers.'Content-Length') bytes" }

      $artifactPath = Join-Path $tempRoot "$($endpoint.Name)-$($check.Key)-artifact"
      $signaturePath = "$artifactPath.sig"
      Download-ReleaseFile -Url $platform.url -Path $artifactPath -Description "$($endpoint.Name) $($check.Key) updater artifact"
      Download-ReleaseFile -Url "$($platform.url).sig" -Path $signaturePath -Description "$($endpoint.Name) $($check.Key) updater signature"
      & node (Join-Path $repoRoot "scripts\verify-papyrus-release.mjs") --artifact $artifactPath --signature $signaturePath --manifest-signature ([string]$platform.signature)
      if ($LASTEXITCODE -ne 0) { throw "$($endpoint.Name) updater signature verification failed for $($check.Key)." }
      $results += [pscustomobject]@{ Endpoint = $endpoint.Name; Platform = $check.Key; DownloadLocation = $location; UpdaterUrl = $platform.url; InstallerBytes = $artifactHead.Headers.'Content-Length'; Signature = 'ok' }
    }
  }

  if ([string]$manifests.canonical.version -ne [string]$manifests.legacy.version) {
    throw "Canonical and legacy OTA endpoints returned different versions."
  }

  $wps = Read-ExpectedReleaseManifest -Url "$canonicalBaseUrl/api/papyrus/wps/update" -Name "WPS update" -ExpectedVersion $ExpectedVersion

  [pscustomobject]@{
    Version = $manifests.canonical.version
    Platforms = $results
    WpsVersion = $wps.version
  }
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
