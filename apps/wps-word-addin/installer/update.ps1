param(
  [string]$AddinName = "PapyrusWpsAddin",
  [string]$ManifestUrl = "https://scallion.uno/api/papyrus/wps/update",
  [switch]$Silent
)

$ErrorActionPreference = "Stop"

$StableVersionPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
$OfficialManifestHost = 'scallion.uno'
$OfficialManifestPath = '/api/papyrus/wps/update'

function Assert-StableVersion {
  param([string]$Version, [string]$Label)

  $candidate = $Version.Trim()
  if ($candidate -notmatch $StableVersionPattern) {
    throw "$Label must be a stable numeric release version."
  }
  return $candidate
}

function Compare-StableVersion {
  param([string]$Left, [string]$Right)

  $leftParts = (Assert-StableVersion -Version $Left -Label 'Left version') -split '\.'
  $rightParts = (Assert-StableVersion -Version $Right -Label 'Right version') -split '\.'
  for ($index = 0; $index -lt $leftParts.Count; $index += 1) {
    if ($leftParts[$index].Length -lt $rightParts[$index].Length) { return -1 }
    if ($leftParts[$index].Length -gt $rightParts[$index].Length) { return 1 }
    $comparison = [string]::CompareOrdinal($leftParts[$index], $rightParts[$index])
    if ($comparison -lt 0) { return -1 }
    if ($comparison -gt 0) { return 1 }
  }
  return 0
}

function Assert-OfficialManifestUrl {
  param([string]$Url)

  try {
    $uri = [Uri]$Url
  } catch {
    throw "The WPS update manifest URL is invalid."
  }
  if (
    -not $uri.IsAbsoluteUri -or
    $uri.Scheme -ne 'https' -or
    -not [string]::Equals($uri.Host, $OfficialManifestHost, [System.StringComparison]::OrdinalIgnoreCase) -or
    $uri.AbsolutePath -ne $OfficialManifestPath -or
    $uri.Query
  ) {
    throw "The WPS updater only accepts the official HTTPS update manifest."
  }
  return $uri
}

function Get-ExpectedPackageUrl {
  param([string]$Version)

  $stableVersion = Assert-StableVersion -Version $Version -Label 'Release version'
  return "https://github.com/bzm2008/papyrus/releases/download/v$stableVersion/Papyrus-WPS-Addin_$stableVersion.zip"
}

function Assert-OfficialPackageUrl {
  param([string]$Url, [string]$Version)

  $expected = Get-ExpectedPackageUrl -Version $Version
  if (-not [string]::Equals($Url.Trim(), $expected, [System.StringComparison]::Ordinal)) {
    throw "The WPS update manifest packageUrl does not match the official release asset for $Version."
  }
  return $expected
}

function Assert-ExtractedRelease {
  param([string]$ReleasePath, [string]$ExpectedVersion, [string]$ExpectedPackageUrl)

  if (-not (Test-Path -LiteralPath $ReleasePath)) {
    throw "The downloaded WPS package is missing release.json."
  }
  try {
    $release = Get-Content -LiteralPath $ReleasePath -Raw | ConvertFrom-Json
  } catch {
    throw "The downloaded WPS package release.json is invalid."
  }
  $releaseVersion = Assert-StableVersion -Version ([string]$release.version) -Label 'Downloaded release version'
  if ($releaseVersion -ne $ExpectedVersion) {
    throw "The downloaded WPS package version does not match the update manifest."
  }
  if (-not [string]::Equals(([string]$release.packageUrl).Trim(), $ExpectedPackageUrl, [System.StringComparison]::Ordinal)) {
    throw "The downloaded WPS package release metadata does not match the official asset URL."
  }
}

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

$manifestUri = Assert-OfficialManifestUrl -Url $ManifestUrl

$manifest = Invoke-RestMethod -Uri "$($manifestUri.AbsoluteUri)?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -UseBasicParsing
$latestVersion = Assert-StableVersion -Version ([string]$manifest.version) -Label 'Update manifest version'
$packageUrl = Assert-OfficialPackageUrl -Url ([string]$manifest.packageUrl) -Version $latestVersion

if ($currentVersion) {
  $currentVersion = Assert-StableVersion -Version $currentVersion -Label 'Installed WPS add-in version'
  $comparison = Compare-StableVersion -Left $latestVersion -Right $currentVersion
  if ($comparison -le 0) {
    if ($comparison -eq 0) {
      Write-UpdateMessage "Papyrus WPS add-in is already up to date: $latestVersion"
    } else {
      Write-UpdateMessage "Refused a WPS add-in downgrade from $currentVersion to $latestVersion."
    }
    return
  }
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
  if (
    -not (Test-Path -LiteralPath $payload) -or
    -not (Test-Path -LiteralPath (Join-Path $payload "taskpane.html")) -or
    -not (Test-Path -LiteralPath (Join-Path $payload "ribbon.xml")) -or
    -not (Test-Path -LiteralPath (Join-Path $payload "js\main.js"))
  ) {
    throw "The downloaded package does not contain an addin folder."
  }

  $releasePath = Join-Path $extractDir "release.json"
  Assert-ExtractedRelease -ReleasePath $releasePath -ExpectedVersion $latestVersion -ExpectedPackageUrl $packageUrl

  New-Item -ItemType Directory -Force -Path $addinDir | Out-Null
  Copy-Item -Path (Join-Path $payload "*") -Destination $addinDir -Recurse -Force

  Copy-Item -LiteralPath $releasePath -Destination $versionPath -Force

  $updateScript = Join-Path $extractDir "update.ps1"
  if (Test-Path $updateScript) {
    Copy-Item -LiteralPath $updateScript -Destination (Join-Path $addinDir "update.ps1") -Force
  }

  Update-PublishFile -Name $AddinName -PublishPath (Join-Path $jsAddonsRoot "publish.xml")
  Write-UpdateMessage "Papyrus WPS add-in updated to $latestVersion. Restart WPS Writer if it is open."
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
