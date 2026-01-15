param(
  [switch]$Verbose
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'node was not found on PATH. Install Node.js 20+ and restart your terminal.'
}

$existingVerbose = $env:STACK_CHECK_VERBOSE
if ($Verbose) {
  $env:STACK_CHECK_VERBOSE = 'true'
} elseif ([string]::IsNullOrWhiteSpace($existingVerbose)) {
  $env:STACK_CHECK_VERBOSE = 'false'
}

$script = Join-Path $repoRoot 'scripts/stack-check.mjs'
if (-not (Test-Path $script)) {
  Write-Error "Missing stack checker: $script"
}

Push-Location $repoRoot
try {
  & node $script
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
