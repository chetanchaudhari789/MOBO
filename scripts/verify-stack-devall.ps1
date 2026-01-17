param(
  [int]$BackendPort = 8080,
  [int[]]$PortalPorts = @(3001,3002,3003,3004,3005),
  [int]$MaxAttempts = 160,
  [int]$SleepMs = 750
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

function Kill-Port([int]$port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return }

  $processId = $conn.OwningProcess
  if (-not $processId) { return }

  try {
    taskkill /PID $processId /T /F | Out-Null
  } catch {
    # best-effort
  }
}

$ports = @($BackendPort) + $PortalPorts

function Try-HttpGet([string]$url, [int]$attempts, [int]$sleepMs, [int]$timeoutSec = 5) {
  for ($i = 1; $i -le $attempts; $i++) {
    try {
      return Invoke-WebRequest -UseBasicParsing -Uri $url -Method GET -TimeoutSec $timeoutSec
    } catch {
      Start-Sleep -Milliseconds $sleepMs
    }
  }
  return $null
}

function Cleanup([System.Diagnostics.Process]$proc) {
  if ($proc -and -not $proc.HasExited) {
    try { taskkill /PID $proc.Id /T /F | Out-Null } catch { }
  }
  foreach ($pt in $ports) { Kill-Port $pt }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'node was not found on PATH. Install Node.js 20+ and restart your terminal.'
}

Push-Location $repoRoot
$proc = $null
try {
  foreach ($pt in $ports) { Kill-Port $pt }

  $proc = Start-Process -FilePath node -ArgumentList @('scripts/dev-all.mjs','--force') -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 500

  $ready = $false
  $healthJson = $null
  $healthUrl = "http://127.0.0.1:$BackendPort/api/health"

  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -Method GET -TimeoutSec 2
      if ($resp.StatusCode -eq 200) {
        $healthJson = $resp.Content | ConvertFrom-Json
        if ($healthJson.status -eq 'ok') {
          $ready = $true
          break
        }
      }
    } catch {
      # keep polling
    }
    Start-Sleep -Milliseconds $SleepMs
  }

  if (-not $ready) {
    Write-Host 'STACK: FAIL (health not ready)'
    exit 1
  }

  $health = Invoke-RestMethod -Uri $healthUrl -Method GET -TimeoutSec 5
  Write-Host ("BACKEND: {0} db={1} readyState={2}" -f $health.status, $health.database.status, $health.database.readyState)

  # Validate seeded admin login (username/password).
  $adminUser = $env:ADMIN_SEED_USERNAME
  $adminPass = $env:ADMIN_SEED_PASSWORD
  if ([string]::IsNullOrWhiteSpace($adminUser) -or [string]::IsNullOrWhiteSpace($adminPass)) {
    $adminUser = 'chetan'
    $adminPass = 'chetan789'
  }

  try {
    $payload = @{ username = $adminUser; password = $adminPass } | ConvertTo-Json
    $login = Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/api/auth/login" -Method POST -ContentType 'application/json' -Body $payload -TimeoutSec 10
    Write-Host ("ADMIN LOGIN: ok user={0}" -f $login.user.name)
  } catch {
    Write-Host ("ADMIN LOGIN: FAIL ({0})" -f $_.Exception.Message)
    exit 1
  }

  foreach ($pt in $PortalPorts) {
    $u = "http://127.0.0.1:$pt/"
    $r = Try-HttpGet -url $u -attempts 40 -sleepMs 750 -timeoutSec 5
    if (-not $r) {
      Write-Host ("{0} FAIL" -f $u)
      exit 1
    }
    Write-Host ("{0} {1}" -f $u, $r.StatusCode)
  }

  Write-Host 'STACK: PASS'
  exit 0
}
finally {
  Cleanup $proc
  Pop-Location
}
