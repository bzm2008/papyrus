$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "release-retry.ps1")

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

Assert-True (Test-ReleaseRetryableHttpStatus 404) "HTTP 404 should be retryable while release assets propagate."
Assert-True (-not (Test-ReleaseRetryableHttpStatus 500)) "HTTP 500 must not be retried blindly."
Assert-True (Test-ReleaseRetryableFailure ([TimeoutException]::new("request timed out"))) "Network timeouts should be retryable."
Assert-True (-not (Test-ReleaseRetryableFailure ([IO.InvalidDataException]::new("invalid updater signature")))) "Signature and structure failures must not be retried."

$staleManifest = [InvalidOperationException]::new("manifest is old")
$staleManifest.Data["PapyrusReleaseRetryReason"] = "stale-manifest"
Assert-True (Test-ReleaseRetryableFailure $staleManifest) "Older manifests should be retried during CDN propagation."
Assert-True (Test-ReleaseManifestIsStale -ManifestVersion "1.0.0" -ExpectedVersion "1.1.0") "Older semantic manifest versions should be detected."
Assert-True (-not (Test-ReleaseManifestIsStale -ManifestVersion "1.2.0" -ExpectedVersion "1.1.0")) "Newer manifests are not stale."

$delays = 1..5 | ForEach-Object { Get-ReleaseRetryDelaySeconds $_ }
Assert-True (($delays -join ",") -eq "1,2,4,8,8") "Retry delays must be finite exponential backoff."

Write-Host "PASS release retry classification"
