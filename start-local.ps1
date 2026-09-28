# ── Local dev launcher for pos_system ────────────────────────
# Reads .env.local (if present), then starts the app:
#   powershell -ExecutionPolicy Bypass -File start-local.ps1
# Then open http://localhost:8000/index.php

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (Test-Path "$PSScriptRoot\.env.local") {
    Get-Content "$PSScriptRoot\.env.local" | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        $name, $value = $line -split '=', 2
        $value = $value.Trim()
        if ($value -ne '') { [Environment]::SetEnvironmentVariable($name.Trim(), $value, 'Process') }
    }
}

if ($env:DATABASE_URL) {
    Write-Host "Connecting via configured DATABASE_URL." -ForegroundColor Cyan
} elseif ($env:DB_HOST -and $env:DB_NAME -and $env:DB_USER) {
    Write-Host "Connecting to database at $env:DB_HOST ($env:DB_NAME)." -ForegroundColor Cyan
} else {
    Write-Host "No remote DB credentials configured. Using local zero-config storage (MySQL or embedded SQLite: pos_local.db)." -ForegroundColor Yellow
}

Write-Host "Starting POS System at http://localhost:8000/index.php ..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Start-Process 'http://localhost:8000/index.php'
php -S 127.0.0.1:8000 -t .
