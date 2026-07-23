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

$bitmapJp = New-Object System.Drawing.Bitmap(600, 120)
$graphicsJp = [System.Drawing.Graphics]::FromImage($bitmapJp)
$graphicsJp.Clear([System.Drawing.Color]::White)
$fontJp = New-Object System.Drawing.Font('MS Gothic', 28)
$graphicsJp.DrawString('株式会社アルファ 御中', $fontJp, [System.Drawing.Brushes]::Black, 20, 30)
$graphicsJp.Dispose()
$bitmapJp.Save((Join-Path $outDir 'ocr-japanese.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bitmapJp.Dispose()

if (Get-Command typst -ErrorAction SilentlyContinue) {
    # Every .typ under typst/ is a use-case fixture (see typst/README.jp.md);
    # each compiles to test-documents/<name>.pdf.
    foreach ($source in Get-ChildItem (Join-Path $outDir 'typst') -Filter '*.typ') {
        $pdf = Join-Path $outDir ($source.BaseName + '.pdf')
        typst compile $source.FullName $pdf
        if ($LASTEXITCODE -ne 0) { throw "typst compile failed for $($source.Name)" }
        Write-Host "compiled $($source.Name) -> $(Split-Path $pdf -Leaf)"
    }
    typst compile (Join-Path $outDir 'typst' 'dummy-spec.typ') (Join-Path $outDir 'dummy-page.png') --format png --pages 1 --ppi 144
} else {
    Write-Warning 'typst not found; skipping dummy PDF generation'
}

Write-Host "test fixtures written to $outDir"
