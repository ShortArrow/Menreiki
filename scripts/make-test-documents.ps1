<#
.SYNOPSIS
Regenerates the committed OCR test fixtures under test-documents/.

Fixtures are generated rather than hand-made so anyone can reproduce them
(no confidential or licensed material can slip in).
#>
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..' 'test-documents'
New-Item -ItemType Directory -Force $outDir | Out-Null

$bitmap = New-Object System.Drawing.Bitmap(400, 120)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Arial', 32)
$graphics.DrawString('HELLO 123', $font, [System.Drawing.Brushes]::Black, 20, 30)
$graphics.Dispose()
$bitmap.Save((Join-Path $outDir 'ocr-hello.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

Write-Host "test fixtures written to $outDir"
