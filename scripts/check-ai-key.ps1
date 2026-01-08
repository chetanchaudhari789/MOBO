$ErrorActionPreference = "Stop"

Write-Host "Checking Gemini AI key connectivity (no secrets printed)..." -ForegroundColor Cyan
npm --prefix backend run ai:check
