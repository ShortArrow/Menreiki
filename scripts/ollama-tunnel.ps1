<#
.SYNOPSIS
Opens (or closes) a background SSH tunnel to a remote Ollama, mapping local
port 11434 to the remote's localhost:11434 so Menreiki can reach it while
staying localhost-only.

Requires a `Host remote-ollama` entry in ~/.ssh/config (hostname, user, key).

  .\scripts\ollama-tunnel.ps1           # start the tunnel
  .\scripts\ollama-tunnel.ps1 -Stop     # close it
  .\scripts\ollama-tunnel.ps1 -SshHost my-box -Port 11500

While it runs, keep Menreiki's [inference] base_url at
http://localhost:<Port>/v1.
#>
param(
    [string]$SshHost = 'remote-ollama',
    [int]$Port = 11434,
    [switch]$Stop
)

# Existing tunnels for this host/port, matched by their command line.
function Get-Tunnels {
    Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" |
        Where-Object {
            $_.CommandLine -like "*${Port}:localhost:${Port}*" -and
            $_.CommandLine -like "*$SshHost*"
        }
}

if ($Stop) {
    $tunnels = Get-Tunnels
    if (-not $tunnels) {
        Write-Host "no tunnel to $SshHost on port $Port"
        return
    }
    $tunnels | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Write-Host "closed tunnel to $SshHost"
    return
}

if (Get-Tunnels) {
    Write-Host "tunnel to $SshHost on port $Port is already running"
    return
}

# Fail fast if the local port is taken (e.g. a local Ollama already listening).
$inUse = netstat -ano | Select-String -Pattern ":$Port\s" | Where-Object { $_ -match 'LISTENING' }
if ($inUse) {
    Write-Warning "local port $Port is already in use; stop it or pass -Port <other>"
    return
}

# Windows OpenSSH's `-f` does not detach cleanly (the process lingers in the
# foreground and blocks the caller), so background it with Start-Process instead.
$sshArgs = @(
    '-N',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-L', "${Port}:localhost:${Port}",
    $SshHost
)
$proc = Start-Process -FilePath 'ssh' -ArgumentList $sshArgs -WindowStyle Hidden -PassThru

# Wait until the forward binds the local port, or ssh gives up (auth/config error).
$listening = $null
for ($i = 0; $i -lt 20 -and -not $proc.HasExited; $i++) {
    $listening = netstat -ano | Select-String -Pattern ":$Port\s" | Where-Object { $_ -match 'LISTENING' }
    if ($listening) { break }
    Start-Sleep -Milliseconds 250
}

if ($proc.HasExited) {
    Write-Warning "ssh exited with code $($proc.ExitCode) (check the $SshHost entry in ~/.ssh/config)"
} elseif (-not $listening) {
    Write-Warning "ssh is running (pid $($proc.Id)) but port $Port is not listening yet; stop it with -Stop and check the connection"
} else {
    Write-Host "tunnel open: localhost:$Port -> $SshHost (remote localhost:$Port)"
}
