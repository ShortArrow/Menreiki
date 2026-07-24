<#
.SYNOPSIS
Packs the release desktop app into an (unsigned) MSIX for Microsoft Store
submission. The Store signs the package on publication, so no certificate
is needed here.

  .\scripts\build-msix.ps1                       # build release exe, then pack
  .\scripts\build-msix.ps1 -SkipBuild            # pack the existing release exe

Identity values come from Partner Center's Product Identity page, via
parameters or the MSSTORE_* environment variables. Without them, developer
placeholders are used — fine for a local packaging test, not for upload.
#>
param(
    [string]$IdentityName = $(if ($env:MSSTORE_IDENTITY_NAME) { $env:MSSTORE_IDENTITY_NAME } else { "ShortArrow.Menreiki.Dev" }),
    [string]$Publisher = $(if ($env:MSSTORE_PUBLISHER) { $env:MSSTORE_PUBLISHER } else { "CN=00000000-0000-0000-0000-000000000000" }),
    [string]$PublisherDisplay = $(if ($env:MSSTORE_PUBLISHER_DISPLAY) { $env:MSSTORE_PUBLISHER_DISPLAY } else { "ShortArrow" }),
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot 'build.ps1')
    if ($LASTEXITCODE -ne 0) { throw "release build failed" }
}

# The release exe may live in CARGO_TARGET_DIR (local dev redirects builds
# off this repo's slow drive), the workspace target/ (CI), or the shared
# local default. Probe in that order.
$candidates = @()
if ($env:CARGO_TARGET_DIR) { $candidates += $env:CARGO_TARGET_DIR }
$candidates += (Join-Path $repoRoot 'target')
if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'cargo-target-shared') }
$targetDir = $candidates |
    Where-Object { Test-Path (Join-Path $_ 'release\menreiki-desktop.exe') } |
    Select-Object -First 1
if (-not $targetDir) {
    throw "release exe not found in: $($candidates -join ', ') (run scripts/build.ps1 first)"
}

$exe = Join-Path $targetDir 'release\menreiki-desktop.exe'
$pdfium = Join-Path $repoRoot 'vendor\pdfium\pdfium.dll'
if (-not (Test-Path $pdfium)) { throw "pdfium.dll not found; run scripts/fetch-pdfium.ps1" }

$version = (Get-Content (Join-Path $repoRoot 'apps\desktop\src-tauri\tauri.conf.json') -Raw |
    ConvertFrom-Json).version
$msixVersion = "$version.0"

$outDir = Join-Path $repoRoot 'out\msix'
$staging = Join-Path $outDir 'staging'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $staging 'Assets') | Out-Null

Copy-Item $exe $staging
Copy-Item $pdfium $staging
Copy-Item (Join-Path $repoRoot 'docs\THIRD-PARTY-NOTICES.md') $staging
Copy-Item (Join-Path $repoRoot 'LICENSE-MIT'), (Join-Path $repoRoot 'LICENSE-APACHE') $staging
$icons = Join-Path $repoRoot 'apps\desktop\src-tauri\icons'
foreach ($asset in 'StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png') {
    Copy-Item (Join-Path $icons $asset) (Join-Path $staging 'Assets')
}

$manifest = Get-Content (Join-Path $repoRoot 'packaging\msstore\AppxManifest.template.xml') -Raw
$manifest = $manifest.
    Replace('{{IDENTITY_NAME}}', $IdentityName).
    Replace('{{PUBLISHER}}', $Publisher).
    Replace('{{PUBLISHER_DISPLAY}}', $PublisherDisplay).
    Replace('{{VERSION}}', $msixVersion)
Set-Content -Path (Join-Path $staging 'AppxManifest.xml') -Value $manifest -Encoding utf8

$makeappx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe' |
    Sort-Object FullName | Select-Object -Last 1
if (-not $makeappx) { throw "makeappx.exe not found (install the Windows SDK)" }

$msix = Join-Path $outDir "Menreiki_${msixVersion}_x64.msix"
if (Test-Path $msix) { Remove-Item $msix -Force }
& $makeappx.FullName pack /d $staging /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed ($LASTEXITCODE)" }

$size = [math]::Round((Get-Item $msix).Length / 1MB, 1)
Write-Host "msix: $msix (${size} MB, unsigned - the Store signs it on publication)"
