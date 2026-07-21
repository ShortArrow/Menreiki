<#
.SYNOPSIS
Runs the desktop dev server from anywhere in the repository and returns to
the repository root when the app exits.

Run it from the project root:  .\scripts\dev.ps1

Close the app window to stop (do not Ctrl+C the terminal). Either way this
script frees Vite's port on the way in and out, so a lingering dev server
never blocks the next run.
#>
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$desktop = Join-Path $repoRoot 'apps\desktop'

function Stop-VitePort {
    $connections = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

Stop-VitePort
try {
    Set-Location $desktop
    npm run tauri dev
} finally {
    Stop-VitePort
    Set-Location $repoRoot
}
