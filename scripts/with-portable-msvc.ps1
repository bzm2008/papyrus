param(
  [switch]$ProbeOnly,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CargoArgs = @("check")
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$sdkRoot = Join-Path $projectRoot ".codex-tools\winsdk"
$llvmRoot = Join-Path $projectRoot ".codex-tools\llvm-mingw-20260505\llvm-mingw-20260505-ucrt-x86_64"

$crtRoot = Join-Path $sdkRoot "VC\Tools\MSVC\14.44.17.14"
$windowsSdkRoot = Join-Path $sdkRoot "Windows Kits\10"
$llvmBin = Join-Path $llvmRoot "bin"

$portablePaths = @(
  (Join-Path $crtRoot "lib\x64"),
  (Join-Path $windowsSdkRoot "Lib\10.0.26100\um\x64"),
  (Join-Path $windowsSdkRoot "Lib\10.0.26100\ucrt\x64"),
  (Join-Path $llvmBin "clang++.exe"),
  (Join-Path $llvmBin "llvm-lib.exe"),
  (Join-Path $llvmBin "llvm-rc.exe")
)

$portableReady = @($portablePaths | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -eq 0

if ($portableReady) {
  $env:LIB = @((Join-Path $crtRoot "lib\x64"), (Join-Path $windowsSdkRoot "Lib\10.0.26100\um\x64"), (Join-Path $windowsSdkRoot "Lib\10.0.26100\ucrt\x64")) -join ";"
  $env:INCLUDE = @((Join-Path $crtRoot "include"), (Join-Path $windowsSdkRoot "Include\10.0.26100\ucrt"), (Join-Path $windowsSdkRoot "Include\10.0.26100\shared"), (Join-Path $windowsSdkRoot "Include\10.0.26100\um"), (Join-Path $windowsSdkRoot "Include\10.0.26100\winrt")) -join ";"
  $env:RUSTFLAGS = "-Clinker=rust-lld"
  $env:PATH = "$llvmBin;$env:PATH"
  $env:CC_x86_64_pc_windows_msvc = Join-Path $llvmBin "clang.exe"
  $env:CXX_x86_64_pc_windows_msvc = Join-Path $llvmBin "clang++.exe"
  $env:AR_x86_64_pc_windows_msvc = Join-Path $llvmBin "llvm-lib.exe"
  $env:RC_x86_64_pc_windows_msvc = Join-Path $llvmBin "llvm-rc.exe"
  $env:RC = Join-Path $llvmBin "llvm-rc.exe"
  $env:CFLAGS_x86_64_pc_windows_msvc = "--target=x86_64-pc-windows-msvc -fms-compatibility -fms-extensions"
  $env:CXXFLAGS_x86_64_pc_windows_msvc = "--target=x86_64-pc-windows-msvc -fms-compatibility -fms-extensions"
  $toolchainLabel = "bundled portable"
} else {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path -LiteralPath $vswhere)) { throw "MSVC toolchain is unavailable: vswhere.exe was not found" }
  $vsRoot = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
  $msvcRoot = Get-ChildItem -LiteralPath (Join-Path $vsRoot "VC\Tools\MSVC") -Directory | Sort-Object Name -Descending | Select-Object -First 1
  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10"
  $kitVersion = Get-ChildItem -LiteralPath (Join-Path $kitsRoot "Lib") -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "um\x64") } | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $msvcRoot -or -not $kitVersion) { throw "MSVC toolchain is unavailable: compiler or Windows SDK libraries were not found" }
  $msvcBin = Join-Path $msvcRoot.FullName "bin\Hostx64\x64"
  $sdkBin = Join-Path $kitsRoot "bin\$($kitVersion.Name)\x64"
  $fallbackPaths = @((Join-Path $msvcRoot.FullName "lib\x64"), (Join-Path $kitVersion.FullName "um\x64"), (Join-Path $kitVersion.FullName "ucrt\x64"), (Join-Path $msvcBin "link.exe"), (Join-Path $sdkBin "rc.exe"))
  foreach ($path in $fallbackPaths) { if (-not (Test-Path -LiteralPath $path)) { throw "MSVC toolchain dependency is missing: $path" } }
  $env:LIB = @((Join-Path $msvcRoot.FullName "lib\x64"), (Join-Path $kitVersion.FullName "um\x64"), (Join-Path $kitVersion.FullName "ucrt\x64")) -join ";"
  $env:INCLUDE = @((Join-Path $msvcRoot.FullName "include"), (Join-Path $kitsRoot "Include\$($kitVersion.Name)\ucrt"), (Join-Path $kitsRoot "Include\$($kitVersion.Name)\shared"), (Join-Path $kitsRoot "Include\$($kitVersion.Name)\um"), (Join-Path $kitsRoot "Include\$($kitVersion.Name)\winrt")) -join ";"
  $env:PATH = "$msvcBin;$sdkBin;$env:PATH"
  $env:CC_x86_64_pc_windows_msvc = Join-Path $msvcBin "cl.exe"
  $env:CXX_x86_64_pc_windows_msvc = Join-Path $msvcBin "cl.exe"
  $env:AR_x86_64_pc_windows_msvc = Join-Path $msvcBin "lib.exe"
  $env:RC_x86_64_pc_windows_msvc = Join-Path $sdkBin "rc.exe"
  $env:RC = Join-Path $sdkBin "rc.exe"
  $rustSysroot = (rustc --print sysroot).Trim()
  $rustLld = Join-Path $rustSysroot "lib\rustlib\x86_64-pc-windows-msvc\bin\rust-lld.exe"
  if (-not (Test-Path -LiteralPath $rustLld)) { throw "Rust linker is unavailable: $rustLld" }
  $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = $rustLld
  $toolchainLabel = "installed Visual Studio"
}

Write-Output "MSVC toolchain ready: $toolchainLabel"
if ($ProbeOnly) { exit 0 }

if (-not $env:CARGO_TARGET_DIR) {
  $env:CARGO_TARGET_DIR = Join-Path $env:TEMP "papyrus-cargo-portable-check"
}

Push-Location -LiteralPath (Join-Path $projectRoot "src-tauri")
$cargoExitCode = 0
try {
  cargo @CargoArgs
  $cargoExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $cargoExitCode
