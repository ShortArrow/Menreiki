<#
.SYNOPSIS
Builds the release desktop app from anywhere in the repository and returns
to the repository root when done.

  .\scripts\build.ps1            # portable exe only (the primary artifact)
  .\scripts\build.ps1 -Bundle    # also produce installer bundles (MSI/NSIS)

Like dev.ps1, the build is redirected off this repo's ReFS drive to a fast
NTFS location unless CARGO_TARGET_DIR is already set.
#>
param([switch]$Bundle)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$desktop = Join-Path $repoRoot 'apps\desktop'

if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA 'cargo-target-shared'
}

try {
    Set-Location $desktop
    if ($Bundle) {
        npm run tauri build
    } else {
        npm run tauri build -- --no-bundle
    }
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }
} finally {
    Set-Location $repoRoot
}

$exe = Join-Path $env:CARGO_TARGET_DIR 'release\menreiki-desktop.exe'
if (Test-Path $exe) {
    $size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
    Write-Host "app: $exe (${size} MB)"
}
$bundleDir = Join-Path $env:CARGO_TARGET_DIR 'release\bundle'
if ($Bundle -and (Test-Path $bundleDir)) {
    Get-ChildItem $bundleDir -Recurse -Include *.msi, *.exe |
        ForEach-Object { Write-Host "bundle: $($_.FullName)" }
}
