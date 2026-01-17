param(
  [int[]]$Ports = @(8080,3001,3002,3003,3004,3005)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$killed = @{}

try {
  $conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $Ports -contains $_.LocalPort }
  if (-not $conns) {
    Write-Output ('No listeners found on ports: ' + ($Ports -join ','))
    exit 0
  }

  $procIds = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $procIds) {
    if (-not $procId) { continue }
    if ($killed.ContainsKey($procId)) { continue }
    $killed[$procId] = $true

    try {
      $p = Get-Process -Id $procId -ErrorAction Stop
      Write-Output ("Stopping PID {0} ({1})" -f $procId, $p.ProcessName)
    } catch {
      Write-Output ("Stopping PID {0}" -f $procId)
    }

    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
    } catch {
      Write-Output ("Failed to stop PID {0}: {1}" -f $procId, $_.Exception.Message)
    }
  }

  Write-Output 'Done.'
  exit 0
} catch {
  Write-Output ("Kill-ports script error: {0}" -f $_.Exception.Message)
  exit 1
}
