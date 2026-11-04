# Keeps M5azen online: restarts the production server if it stops and keeps a
# Cloudflare quick tunnel connected. Quick tunnels can be dropped by Cloudflare
# while cloudflared keeps running, so tunnel health is checked via its /ready
# metrics endpoint and the tunnel is recreated when it stays disconnected.
# The public link is written to M5azen-Link.txt on the Desktop.
# Registered to run at Windows logon. Must stay saved as UTF-8 with BOM.
$ErrorActionPreference = 'Continue'

$mutex = New-Object System.Threading.Mutex($false, 'Local\M5azenOnline')
if (-not $mutex.WaitOne(0)) { exit }

$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root 'apps\api'
$logs = Join-Path $root 'logs'
$cloudflared = Join-Path $env:USERPROFILE 'cloudflared\cloudflared.exe'
$linkFile = Join-Path ([Environment]::GetFolderPath('Desktop')) 'M5azen-Link.txt'
$metrics = '127.0.0.1:20241'
New-Item -ItemType Directory -Force $logs | Out-Null
$env:NODE_ENV = 'production'

function Test-Listening([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { return $client.ConnectAsync('127.0.0.1', $port).Wait(1500) } catch { return $false } finally { $client.Dispose() }
}

function Write-Log([string]$text) {
  Add-Content -Path (Join-Path $logs 'online.log') -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $text" -Encoding UTF8
}

function Test-TunnelReady {
  try {
    $res = Invoke-WebRequest "http://$metrics/ready" -UseBasicParsing -TimeoutSec 5
    return $res.StatusCode -eq 200
  } catch { return $false }
}

function Stop-Tunnel {
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

function Start-Tunnel {
  Write-Log 'starting tunnel'
  $tunnelLog = Join-Path $logs 'tunnel.log'
  Remove-Item $tunnelLog -ErrorAction SilentlyContinue
  Start-Process $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--metrics', $metrics, '--url', 'http://localhost:3001' -WindowStyle Hidden `
    -RedirectStandardError $tunnelLog -RedirectStandardOutput (Join-Path $logs 'tunnel-out.log') | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $match = Select-String -Path $tunnelLog -Pattern 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) {
      $url = $match.Matches[0].Value
      Set-Content -Path $linkFile -Value "رابط برنامج المخازن:`r`n$url`r`n`r`nآخر تحديث: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -Encoding UTF8
      Write-Log "tunnel url $url"
      return $true
    }
  }
  Write-Log 'tunnel did not return a url'
  return $false
}

$server = $null
$tunnelStarted = [datetime]::MinValue
$unhealthy = 0
Write-Log 'supervisor started'
Stop-Tunnel

while ($true) {
  if (-not (Test-Listening 3001) -and (-not $server -or $server.HasExited)) {
    Write-Log 'starting server'
    $server = Start-Process node -ArgumentList 'dist/main.js' -WorkingDirectory $api -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server-error.log')
    Start-Sleep -Seconds 25
  }

  if (Test-Path $cloudflared) {
    $running = [bool](Get-Process cloudflared -ErrorAction SilentlyContinue)
    if (-not $running) {
      if (-not (Start-Tunnel)) { Stop-Tunnel; Start-Sleep -Seconds 30 }
      $tunnelStarted = Get-Date
      $unhealthy = 0
    } elseif (((Get-Date) - $tunnelStarted).TotalSeconds -gt 60) {
      if (Test-TunnelReady) {
        $unhealthy = 0
      } else {
        $unhealthy++
        if ($unhealthy -ge 4) {
          Write-Log 'tunnel disconnected, recreating'
          Stop-Tunnel
          $unhealthy = 0
        }
      }
    }
  }

  Start-Sleep -Seconds 15
}
