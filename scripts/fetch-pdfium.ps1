<#
.SYNOPSIS
Downloads the pdfium runtime library into vendor/pdfium.

Menreiki renders PDFs through pdfium, which ships as a prebuilt dynamic
library (https://github.com/bblanchon/pdfium-binaries). The library is not
committed to the repository; run this script once per checkout. Run it while
no confidential document is open — network access and document processing
must stay separated.
#>
param(
    [string]$Destination = (Join-Path $PSScriptRoot '..' 'vendor' 'pdfium')
)

$ErrorActionPreference = 'Stop'

$url = 'https://github.com/bblanchon/pdfium-binaries/releases/latest/download/pdfium-win-x64.tgz'
$archive = Join-Path ([System.IO.Path]::GetTempPath()) 'pdfium-win-x64.tgz'
$extractDir = Join-Path ([System.IO.Path]::GetTempPath()) ('pdfium-extract-' + [System.IO.Path]::GetRandomFileName())

Invoke-WebRequest -Uri $url -OutFile $archive
New-Item -ItemType Directory -Force $extractDir | Out-Null
tar -xzf $archive -C $extractDir
New-Item -ItemType Directory -Force $Destination | Out-Null
Copy-Item (Join-Path $extractDir 'bin' 'pdfium.dll') (Join-Path $Destination 'pdfium.dll') -Force
Remove-Item $archive -Force
Remove-Item $extractDir -Recurse -Force

Write-Host "pdfium.dll installed into $Destination"
