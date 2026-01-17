param(
  [int[]]$Ports = @(8080,3001,3002,3003,3004,3005)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $Ports -contains $_.LocalPort }
if (-not $conns) {
  Write-Output ('No listeners found on ports: ' + ($Ports -join ','))
  exit 0
}

$conns | Select-Object LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
