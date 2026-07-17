<#
.SYNOPSIS
Launches the desktop app, captures its window into a PNG, then closes it.
Used to verify that the UI actually renders without manual interaction.
#>
param(
    [string]$Executable = (Join-Path $PSScriptRoot '..' 'target' 'debug' 'menreiki-desktop.exe'),
    [string]$Output = (Join-Path ([System.IO.Path]::GetTempPath()) 'menreiki-smoke.png'),
    [int]$WaitSeconds = 12,
    [string]$ProjectDir = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MenreikiSmokeWin32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

$process = if ($ProjectDir) {
    Start-Process $Executable -ArgumentList $ProjectDir -PassThru
} else {
    Start-Process $Executable -PassThru
}
try {
    Start-Sleep -Seconds $WaitSeconds
    $process.Refresh()
    if ($process.HasExited) {
        throw "app exited early with code $($process.ExitCode)"
    }
    $hwnd = $process.MainWindowHandle
    if ($hwnd -eq [IntPtr]::Zero) {
        throw 'app has no main window'
    }
    [MenreikiSmokeWin32]::MoveWindow($hwnd, 0, 0, 1400, 900, $true) | Out-Null
    [MenreikiSmokeWin32]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Seconds 2

    $rect = New-Object MenreikiSmokeWin32+RECT
    [MenreikiSmokeWin32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) {
        throw "window has no size ($width x $height)"
    }

    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
    $graphics.Dispose()
    $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    Write-Host "captured $Output ($width x $height)"
} finally {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -Confirm:$false
    }
}
