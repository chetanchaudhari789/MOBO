Param(
  [switch]$Wipe = $true,
  [string]$DbName = "",
  [string]$Seed = "mobo-seed",
  [int]$UsersPerRole = 500,
  [int]$Campaigns = 200,
  [int]$DealsPerMediator = 10,
  [int]$Orders = 0,
  [int]$Tickets = 0,
  [int]$Payouts = 0
)

$ErrorActionPreference = "Stop"

if (-not $Wipe) {
  throw "Refusing to seed without wipe. Pass -Wipe or set `$Wipe = `$true."
}

$env:SEED_WIPE = "true"
$env:SEED_LARGE = "true"
$env:SEED = $Seed
$env:SEED_USERS_PER_ROLE = "$UsersPerRole"
$env:SEED_CAMPAIGNS = "$Campaigns"
$env:SEED_DEALS_PER_MEDIATOR = "$DealsPerMediator"

if ($DbName -and $DbName.Trim().Length -gt 0) {
  $env:MONGODB_DBNAME = $DbName
  Write-Host "Using MongoDB dbName=$DbName" -ForegroundColor Cyan
}

if ($Orders -gt 0) { $env:SEED_ORDERS = "$Orders" }
if ($Tickets -gt 0) { $env:SEED_TICKETS = "$Tickets" }
if ($Payouts -gt 0) { $env:SEED_PAYOUTS = "$Payouts" }

Write-Host "Seeding large fake data (wipe=true)..." -ForegroundColor Cyan
Write-Host "Seed=$Seed UsersPerRole=$UsersPerRole Campaigns=$Campaigns DealsPerMediator=$DealsPerMediator" -ForegroundColor Cyan

# Runs the seed directly (prints demo credentials at the end)
npm --prefix backend run seed
