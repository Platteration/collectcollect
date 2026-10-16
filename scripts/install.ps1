# One-command first install for CollectCollect (cards app).
#
#   .\scripts\install.ps1          # Windows PowerShell / PowerShell 7
#
# Checks Docker with Compose, creates .env with generated secrets if needed,
# builds and starts the cards service, and waits for its health endpoint.
# Safe to re-run: an existing .env is never overwritten.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Native docker exit codes are checked explicitly via $LASTEXITCODE below.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

# Resolve the repository root (parent of scripts\) and work from there.
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

$HealthUrl = 'http://127.0.0.1:3000/api/health'
$AppUrl = 'http://localhost:3000'
$HealthAttempts = 60
$HealthIntervalSeconds = 2

function Stop-Install {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "error: $Message" -ForegroundColor Red
    exit 1
}

function Get-RandomHex {
    # Return lowercase hex for $ByteCount cryptographically random bytes.
    param([Parameter(Mandatory)][int]$ByteCount)
    $bytes = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    }
    finally {
        $rng.Dispose()
    }
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Test-Health {
    try {
        $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
    }
    catch {
        return $false
    }
}

# --- 1. Docker with Compose must be available -------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Stop-Install "Docker was not found on PATH. Install Docker (with Compose) from https://docs.docker.com/get-docker/ and re-run this script."
}
# 'docker compose version' succeeds only when the Compose plugin is present.
docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
    Stop-Install "'docker compose' is not available. Install a current Docker with the Compose plugin (or update Docker Desktop) and re-run this script."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Stop-Install "Docker is installed but the daemon is not reachable. Start Docker Desktop (or the docker service) and re-run this script."
}

# --- 2. Create .env if needed ------------------------------------------------
$GeneratedPassword = $null
$EnvPath = Join-Path $RepoRoot '.env'
$EnvExamplePath = Join-Path $RepoRoot '.env.example'

if (Test-Path -LiteralPath $EnvPath) {
    Write-Host ".env already exists - leaving it untouched and continuing."
}
else {
    if (-not (Test-Path -LiteralPath $EnvExamplePath)) {
        Stop-Install ".env.example not found. Run this script from a complete checkout of the repository."
    }
    Write-Host "Creating .env from .env.example with generated secrets..."
    $AppSecret = Get-RandomHex -ByteCount 32
    $SkinsAppSecret = Get-RandomHex -ByteCount 32
    $GeneratedPassword = Get-RandomHex -ByteCount 12

    if ($AppSecret -notmatch '^[0-9a-f]{64}$') { Stop-Install "failed to generate APP_SECRET." }
    if ($SkinsAppSecret -notmatch '^[0-9a-f]{64}$') { Stop-Install "failed to generate SKINS_APP_SECRET." }
    if ([string]::IsNullOrWhiteSpace($GeneratedPassword)) { Stop-Install "failed to generate APP_PASSWORD." }

    Copy-Item -LiteralPath $EnvExamplePath -Destination $EnvPath

    # Fill only the three generated values; every API-key line stays blank.
    $lines = Get-Content -LiteralPath $EnvPath
    $updated = foreach ($line in $lines) {
        if ($line -match '^#?\s*SKINS_APP_SECRET=') {
            "SKINS_APP_SECRET=$SkinsAppSecret"
        }
        elseif ($line -match '^#?\s*APP_PASSWORD=') {
            "APP_PASSWORD=$GeneratedPassword"
        }
        elseif ($line -match '^#?\s*APP_SECRET=') {
            "APP_SECRET=$AppSecret"
        }
        else {
            $line
        }
    }
    # Write as UTF-8 without BOM so Docker Compose parses it the same everywhere.
    [System.IO.File]::WriteAllLines($EnvPath, [string[]]$updated, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Created .env (API-key lines left blank - add them later if you want those features)."
}

# --- 3. Build and start ------------------------------------------------------
Write-Host "Building and starting the cards app (docker compose up -d --build cards)..."
docker compose up -d --build cards
if ($LASTEXITCODE -ne 0) {
    Stop-Install "docker compose up failed (exit $LASTEXITCODE). Run 'docker compose logs cards' for details, then re-run this script."
}

# --- 4. Wait for health ------------------------------------------------------
Write-Host "Waiting for $HealthUrl ..."
$healthy = $false
for ($attempt = 1; $attempt -le $HealthAttempts; $attempt++) {
    if (Test-Health) {
        $healthy = $true
        break
    }
    Start-Sleep -Seconds $HealthIntervalSeconds
}

if (-not $healthy) {
    Write-Host "error: the app did not become healthy within $($HealthAttempts * $HealthIntervalSeconds) seconds." -ForegroundColor Red
    Write-Host "Check the logs with:  docker compose logs -f cards"
    Write-Host "Then try again, or see docs/SELF_HOSTING.md for help."
    exit 1
}

# --- Next steps ---------------------------------------------------------------
Write-Host ""
Write-Host "CollectCollect is running."
Write-Host "  Open: $AppUrl"
if ($null -ne $GeneratedPassword) {
    Write-Host "  Generated login password (shown once - it is stored as APP_PASSWORD in .env): $GeneratedPassword"
    Write-Host "  Warning: keep .env private and back it up somewhere safe; anyone with that password can sign in."
    Write-Host "  You can change APP_PASSWORD in .env later, then run: docker compose up -d --force-recreate cards"
}
else {
    Write-Host "  Sign in with the APP_PASSWORD already in your existing .env (it was not changed)."
}
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open $AppUrl and sign in."
Write-Host "  2. In the app, open Settings and run the provider connection tests (guided checks)"
Write-Host "     to verify any API keys or providers you add to .env."
Write-Host "  3. Add optional keys to .env (for example ANTHROPIC_API_KEY for photo identification),"
Write-Host "     then apply them with: docker compose up -d --force-recreate cards"
Write-Host "  4. See docs/SELF_HOSTING.md for remote access, backup, and running the skins app."