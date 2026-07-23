function Get-ReleaseRetryDelaySeconds([int]$Attempt) {
  if ($Attempt -lt 1) { throw "Retry attempt must be positive." }
  return [int][Math]::Min(8, [Math]::Pow(2, $Attempt - 1))
}

function Test-ReleaseRetryableHttpStatus([int]$StatusCode) {
  return $StatusCode -eq 404
}

function Get-ReleaseHttpStatusCode([System.Exception]$Exception) {
  $current = $Exception
  while ($null -ne $current) {
    if ($current.Data.Contains("PapyrusReleaseHttpStatus")) {
      return [int]$current.Data["PapyrusReleaseHttpStatus"]
    }
    if ($current.PSObject.Properties.Match("StatusCode").Count -gt 0 -and $null -ne $current.StatusCode) {
      return [int]$current.StatusCode
    }
    if ($current.PSObject.Properties.Match("Response").Count -gt 0 -and $null -ne $current.Response) {
      $response = $current.Response
      if ($response.PSObject.Properties.Match("StatusCode").Count -gt 0 -and $null -ne $response.StatusCode) {
        return [int]$response.StatusCode
      }
    }
    $current = $current.InnerException
  }
  return $null
}

function Test-ReleaseRetryableFailure([System.Exception]$Exception) {
  $current = $Exception
  while ($null -ne $current) {
    if ($current.Data["PapyrusReleaseRetryReason"] -eq "stale-manifest") { return $true }
    $current = $current.InnerException
  }

  $statusCode = Get-ReleaseHttpStatusCode $Exception
  if ($null -ne $statusCode) { return Test-ReleaseRetryableHttpStatus $statusCode }

  $current = $Exception
  while ($null -ne $current) {
    if (
      $current -is [TimeoutException] -or
      $current -is [System.Net.Sockets.SocketException] -or
      $current.GetType().FullName -eq "System.Net.Http.HttpRequestException"
    ) {
      return $true
    }
    if ($current -is [System.Net.WebException]) {
      return $current.Status -in @(
        [System.Net.WebExceptionStatus]::ConnectFailure,
        [System.Net.WebExceptionStatus]::ConnectionClosed,
        [System.Net.WebExceptionStatus]::KeepAliveFailure,
        [System.Net.WebExceptionStatus]::NameResolutionFailure,
        [System.Net.WebExceptionStatus]::PipelineFailure,
        [System.Net.WebExceptionStatus]::ProxyNameResolutionFailure,
        [System.Net.WebExceptionStatus]::ReceiveFailure,
        [System.Net.WebExceptionStatus]::SendFailure,
        [System.Net.WebExceptionStatus]::Timeout
      )
    }
    $current = $current.InnerException
  }
  return $false
}

function New-ReleaseHttpStatusException([string]$Message, [int]$StatusCode) {
  $exception = [InvalidOperationException]::new($Message)
  $exception.Data["PapyrusReleaseHttpStatus"] = $StatusCode
  return $exception
}

function New-StaleReleaseManifestException([string]$Message) {
  $exception = [InvalidOperationException]::new($Message)
  $exception.Data["PapyrusReleaseRetryReason"] = "stale-manifest"
  return $exception
}

function Test-ReleaseManifestIsStale([string]$ManifestVersion, [string]$ExpectedVersion) {
  try {
    return [version]$ManifestVersion -lt [version]$ExpectedVersion
  } catch {
    return $false
  }
}

function Invoke-ReleaseWithRetry {
  param(
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][scriptblock]$Operation,
    [int]$MaxAttempts = 4
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
    try {
      return & $Operation
    } catch {
      if ($attempt -ge $MaxAttempts -or -not (Test-ReleaseRetryableFailure $_.Exception)) { throw }
      $delay = Get-ReleaseRetryDelaySeconds $attempt
      Write-Host "Retrying $Description in $delay second(s) after a transient release publication failure."
      Start-Sleep -Seconds $delay
    }
  }
}
