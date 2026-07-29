<#
.SYNOPSIS
Regenerates the analyzed sample project baked into the desktop app.

  .\scripts\build-sample-project.ps1

The result lands in apps\desktop\src-tauri\assets\sample.menreiki and is
embedded into the binary at compile time by build.rs, so the app's "open
sample" button works with no external file and no OCR language pack. Rerun
this whenever the detection output should reflect current logic; requires the
Windows Japanese OCR language pack (the analyze step reads the pages).

Uses the committed test-documents\dummy-spec.pdf (fictional data only) and a
modest DPI to keep the embedded tree small.
#>
param(
    [string]$Source = 'test-documents\dummy-spec.pdf',
    [int]$Dpi = 150
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA 'cargo-target-shared'
}
$env:MENREIKI_PDFIUM_PATH = Join-Path $repoRoot 'vendor\pdfium'
if (-not (Test-Path (Join-Path $env:MENREIKI_PDFIUM_PATH 'pdfium.dll'))) {
    throw "pdfium.dll not found; run scripts/fetch-pdfium.ps1"
}

Push-Location $repoRoot
try {
    cargo build -j 2 -p menreiki-cli
    if ($LASTEXITCODE -ne 0) { throw "cli build failed" }
    $cli = Join-Path $env:CARGO_TARGET_DIR 'debug\menreiki.exe'

    $out = Join-Path $repoRoot 'apps\desktop\src-tauri\assets\sample.menreiki'
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }

    & $cli import $Source --project $out
    if ($LASTEXITCODE -ne 0) { throw "import failed" }
    & $cli analyze $out --dpi $Dpi
    if ($LASTEXITCODE -ne 0) { throw "analyze failed" }
} finally {
    Pop-Location
}

$size = [math]::Round((Get-ChildItem $out -Recurse -File |
        Measure-Object Length -Sum).Sum / 1KB, 0)
Write-Host "sample project: $out (${size} KB embedded into the binary)"
