param(
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

$requiredPaths = @(
  (Join-Path $crtRoot "lib\x64"),
  (Join-Path $windowsSdkRoot "Lib\10.0.26100\um\x64"),
  (Join-Path $windowsSdkRoot "Lib\10.0.26100\ucrt\x64"),
  (Join-Path $llvmBin "clang++.exe"),
  (Join-Path $llvmBin "llvm-lib.exe"),
  (Join-Path $llvmBin "llvm-rc.exe")
)

foreach ($path in $requiredPaths) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Portable MSVC dependency is missing: $path"
  }
}

$env:LIB = @(
  (Join-Path $crtRoot "lib\x64"),
  (Join-Path $windowsSdkRoot "Lib\10.0.26100\um\x64"),
  (Join-Path $windowsSdkRoot "Lib\10.0.26100\ucrt\x64")
) -join ";"

$env:INCLUDE = @(
  (Join-Path $crtRoot "include"),
  (Join-Path $windowsSdkRoot "Include\10.0.26100\ucrt"),
  (Join-Path $windowsSdkRoot "Include\10.0.26100\shared"),
  (Join-Path $windowsSdkRoot "Include\10.0.26100\um"),
  (Join-Path $windowsSdkRoot "Include\10.0.26100\winrt")
) -join ";"

$env:RUSTFLAGS = "-Clinker=rust-lld"
$env:PATH = "C:\Users\HW\.cargo\bin;$llvmBin;$env:PATH"
$env:CC_x86_64_pc_windows_msvc = Join-Path $llvmBin "clang.exe"
$env:CXX_x86_64_pc_windows_msvc = Join-Path $llvmBin "clang++.exe"
$env:AR_x86_64_pc_windows_msvc = Join-Path $llvmBin "llvm-lib.exe"
$env:RC_x86_64_pc_windows_msvc = Join-Path $llvmBin "llvm-rc.exe"
$env:RC = Join-Path $llvmBin "llvm-rc.exe"
$env:CFLAGS_x86_64_pc_windows_msvc = "--target=x86_64-pc-windows-msvc -fms-compatibility -fms-extensions"
$env:CXXFLAGS_x86_64_pc_windows_msvc = "--target=x86_64-pc-windows-msvc -fms-compatibility -fms-extensions"

Push-Location -LiteralPath (Join-Path $projectRoot "src-tauri")
try {
  cargo @CargoArgs
} finally {
  Pop-Location
}
