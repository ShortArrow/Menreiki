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

# Build off this repo's drive if it is ReFS: a clean build measured 674s on
# ReFS here versus 15s on NTFS (~44x). Redirect Cargo's output to a fast local
# NTFS location under %LOCALAPPDATA% (no hard-coded drive letter). An explicit
# CARGO_TARGET_DIR in the environment still wins.
if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA 'cargo-target-shared'
}

# Frees Vite's port via netstat (a quiet native command); Get-NetTCPConnection
# floods the console with CIM debug traces when $DebugPreference is on.
function Stop-VitePort {
    foreach ($line in (netstat -ano | Select-String -Pattern ':1420\s' | Where-Object { $_ -match 'LISTENING' })) {
        $procId = ($line.ToString().Trim() -split '\s+')[-1]
        if ($procId -match '^\d+$' -and $procId -ne '0') {
            Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
        }
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
