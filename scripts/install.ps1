# One-command install for CollectCollect, for one owner on one machine.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 cards skins
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -All
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -All -Lan
#
# (In PowerShell 7 the command is pwsh instead of powershell.)
#
# Why that long first line: Windows refuses to run an unsigned script under its
# default policy ("running scripts is disabled on this system"), and a script
# downloaded as a zip carries a mark that RemoteSigned refuses as well.
# -ExecutionPolicy Bypass lifts that for this one run only and changes no
# setting. A policy your organisation sets with Group Policy still wins; then
# use the Linux/macOS/WSL/Git Bash script, scripts/install.sh. To run the
# script bare instead: Unblock-File .\scripts\install.ps1, and
# Set-ExecutionPolicy -Scope CurrentUser RemoteSigned once.
#
# Apps: cards, skins, retro-games, comics, watches, whisky (ports 3000 to 3005);
# cards when none is named. It checks Docker with Compose, creates .env with a
# generated password and a 64-hex secret for every app, builds and starts the
# apps you chose, and waits for each to answer its health route.
#
# Safe to re-run: an existing .env is never changed. It says which of the
# chosen apps have no password in it, and with -Lan refuses to publish one.
#
# -Lan writes compose.override.yaml, which publishes the chosen apps on every
# network interface of this computer instead of on localhost, and prints the
# addresses to open on the phone. It is plain http: see docs/SELF_HOSTING.md,
# "Phone access". A run without -Lan removes a compose.override.yaml this
# script wrote, so the apps are back on localhost only.
#
# Plain ASCII on purpose: Windows PowerShell 5.1 reads a script without a
# byte-order mark as ANSI, and would garble anything else.
[CmdletBinding()]
param(
    [switch]$All,
    [switch]$Lan,
    [switch]$Help,
    # App names. --all, --lan and --help are accepted here too, as install.sh spells them.
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$App
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Native docker exit codes are checked explicitly below; PowerShell 7.3 and later
# may turn a non-zero exit into an error on their own.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

# Resolve the repository root (parent of scripts\) and work from there.
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

$AllApps = @('cards', 'skins', 'retro-games', 'comics', 'watches', 'whisky')
$HealthTimeoutSeconds = 180
$HealthIntervalSeconds = 2
# The first line of a compose.override.yaml this script wrote, the same in install.sh, which
# recognises it too: neither installer touches an override it did not write.
$OverrideMark = '# Written by the CollectCollect installer (scripts/install.sh --lan or scripts/install.ps1 -Lan)'
$EnvPath = Join-Path $RepoRoot '.env'
$EnvExamplePath = Join-Path $RepoRoot '.env.example'
$OverridePath = Join-Path $RepoRoot 'compose.override.yaml'
# Text files are read and written as UTF-8 without a byte-order mark, whatever
# the PowerShell version: Docker Compose parses .env the same everywhere then.
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Stop-Install {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "error: $Message" -ForegroundColor Red
    exit 1
}

function Show-Usage {
    Write-Host 'Usage: install.ps1 [-All] [-Lan] [app ...]'
    Write-Host ''
    Write-Host '  app     cards (the default), skins, retro-games, comics, watches, whisky'
    Write-Host '  -All    every app'
    Write-Host '  -Lan    publish the chosen apps on your network (compose.override.yaml), for'
    Write-Host '          a phone on the same Wi-Fi; plain http, and only for apps with a password'
    Write-Host '  -Help   this text'
}

# --- Arguments ---------------------------------------------------------------
$Named = @()
foreach ($arg in @($App)) {
    if ($null -eq $arg) { continue }
    $lower = $arg.ToLowerInvariant()
    if ($lower -eq '--all') { $All = [switch]$true }
    elseif ($lower -eq '--lan') { $Lan = [switch]$true }
    elseif ($lower -eq '--help' -or $lower -eq '-h') { $Help = [switch]$true }
    elseif ($lower.StartsWith('-')) { Stop-Install "unknown option '$arg'. Usage: install.ps1 [-All] [-Lan] [app ...]" }
    elseif ($AllApps -contains $lower) { $Named += $lower }
    else { Stop-Install "unknown app '$arg'. The apps are: $($AllApps -join ' ')." }
}
if ($Help) {
    Show-Usage
    exit 0
}

# The chosen apps, once each, in the order above. Cards when nothing is named.
$Selected = @($AllApps | Where-Object { $All -or ($Named -contains $_) })
if ($Selected.Count -eq 0) { $Selected = @('cards') }

# --- What each app is --------------------------------------------------------
$Ports = @{ 'cards' = 3000; 'skins' = 3001; 'retro-games' = 3002; 'comics' = 3003; 'watches' = 3004; 'whisky' = 3005 }
# The prefix of the app's variables: APP_PASSWORD for cards, SKINS_APP_PASSWORD for skins.
$Prefixes = @{ 'cards' = ''; 'skins' = 'SKINS_'; 'retro-games' = 'RETRO_GAMES_'; 'comics' = 'COMICS_'; 'watches' = 'WATCHES_'; 'whisky' = 'WHISKY_' }

function Get-PasswordVar {
    param([Parameter(Mandatory)][string]$Name)
    return ($Prefixes[$Name] + 'APP_PASSWORD')
}

function Get-SecretVar {
    param([Parameter(Mandatory)][string]$Name)
    return ($Prefixes[$Name] + 'APP_SECRET')
}

# --- Helpers -----------------------------------------------------------------
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

function Invoke-Docker {
    # Runs "docker <arguments>" and returns its exit code and what it printed.
    # Windows PowerShell 5.1 turns a native command's standard error into error
    # records once it is redirected, and under $ErrorActionPreference = 'Stop'
    # the first one would end the script with a raw NativeCommandError instead
    # of the message below. So the preference is relaxed for the call.
    param([Parameter(Mandatory)][string[]]$Arguments)
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = @(& docker @Arguments 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($lines -join "`n") }
    }
    finally {
        $ErrorActionPreference = $saved
    }
}

function Test-Health {
    param([Parameter(Mandatory)][string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
    }
    catch {
        return $false
    }
}

function Get-EnvValue {
    # The value of the last uncommented NAME=value line of a file (default .env),
    # without quotes or a trailing comment; empty when there is none. The file is
    # read, never run: it is text the owner edited.
    param([Parameter(Mandatory)][string]$Name, [string]$Path = $EnvPath)
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $found = ''
    foreach ($line in [System.IO.File]::ReadAllLines($Path, $Utf8NoBom)) {
        if ($line -match ('^\s*(export\s+)?' + [regex]::Escape($Name) + '\s*=(.*)$')) {
            $value = $Matches[2]
            $trimmed = $value.TrimStart()
            if ($trimmed -match '^"(.*)"\s*$') { $found = $Matches[1] }
            elseif ($trimmed -match '^''(.*)''\s*$') { $found = $Matches[1] }
            else {
                # A comment starts at a blank followed by #, as Compose reads it.
                $found = ($value -replace '\s+#.*$', '').Trim()
            }
        }
    }
    return $found
}

function Test-AppGated {
    # Whether the app asks for a login: a password, or any of its Google sign-in
    # variables, which turn the gate on by themselves (README, "Sign in with Google").
    param([Parameter(Mandatory)][string]$Name)
    if ((Get-EnvValue (Get-PasswordVar $Name)) -ne '') { return $true }
    if ($Name -eq 'cards' -or $Name -eq 'skins') {
        foreach ($variable in @('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_ALLOWED_SUBS', 'GOOGLE_ALLOWED_EMAILS')) {
            if ((Get-EnvValue ($Prefixes[$Name] + $variable)) -ne '') { return $true }
        }
    }
    return $false
}

function Protect-File {
    # Leave a file readable by its owner alone (the counterpart of chmod 600).
    # Best effort: a drive that cannot hold permissions is said, not fatal.
    param([Parameter(Mandatory)][string]$Path)
    if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) { return }
    try {
        $acl = Get-Acl -LiteralPath $Path
        # No inherited access (a repository under C:\ is readable by every user),
        # and full control for whoever is running this.
        $acl.SetAccessRuleProtection($true, $false)
        $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($me, 'FullControl', 'Allow')
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $Path -AclObject $acl
    }
    catch {
        Write-Host "warning: could not limit who can read $Path ($($_.Exception.Message)). Keep this folder private."
    }
}

function New-TempFile {
    # An empty, private file beside the real one, for a write that is moved into
    # place only when it is whole.
    param([Parameter(Mandatory)][string]$Stem)
    $path = Join-Path $RepoRoot ('.' + $Stem + '.tmp.' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    [System.IO.File]::WriteAllBytes($path, [byte[]]@())
    Protect-File -Path $path
    return $path
}

function Write-TextFile {
    # LF line endings and no byte-order mark, as install.sh writes.
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string[]]$Lines)
    [System.IO.File]::WriteAllText($Path, (($Lines -join "`n") + "`n"), $Utf8NoBom)
}

function Test-PrivateAddress {
    param([string]$Address)
    if ($Address -match '^(10\.|192\.168\.)') { return $true }
    if ($Address -match '^172\.(\d+)\.') {
        $second = [int]$Matches[1]
        return ($second -ge 16 -and $second -le 31)
    }
    return $false
}

function Get-LanAddress {
    # Private IPv4 addresses of this computer, the one a phone would use first:
    # the adapter that has a default gateway.
    $found = @()
    try {
        $found = @(Get-NetIPConfiguration -ErrorAction Stop |
                Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
                ForEach-Object { $_.IPv4Address } |
                ForEach-Object { $_.IPAddress })
    }
    catch {
        $found = @()
    }
    if ($found.Count -eq 0) {
        try {
            $found = @([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
                    Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
                    ForEach-Object { $_.ToString() })
        }
        catch {
            $found = @()
        }
    }
    # The default bridge Docker makes is not on the Wi-Fi.
    return @($found | Where-Object { (Test-PrivateAddress $_) -and ($_ -ne '172.17.0.1') })
}

# --- 1. Docker with Compose must be available -------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Stop-Install "Docker was not found on PATH. Install Docker (with Compose) from https://docs.docker.com/get-docker/ and re-run this script."
}
# 'docker compose version' succeeds only when the Compose plugin is present.
if ((Invoke-Docker @('compose', 'version')).Code -ne 0) {
    Stop-Install "'docker compose' is not available. Install a current Docker with the Compose plugin (or update Docker Desktop) and re-run this script."
}
if ((Invoke-Docker @('info')).Code -ne 0) {
    Stop-Install "Docker is installed but the daemon is not reachable. Start Docker Desktop (or the docker service) and re-run this script."
}

Write-Host "Installing: $($Selected -join ' ')"

# --- 2. Create .env if needed ------------------------------------------------
$Generated = [ordered]@{}
$Missing = @()

if (Test-Path -LiteralPath $EnvPath) {
    Write-Host ".env already exists - not changed. Checking the chosen apps for a password:"
    foreach ($name in $Selected) {
        if (Test-AppGated $name) {
            Write-Host "  ${name}: asks for a login ($(Get-PasswordVar $name) in .env)."
        }
        else {
            Write-Host "  ${name}: NO PASSWORD - $(Get-PasswordVar $name) is empty or missing in .env."
            $Missing += $name
        }
    }
    if ($Missing.Count -gt 0) {
        Write-Host "  Without one, anyone who can reach the app can read and change the collection."
        Write-Host "  To add one, put a line like this in .env (a value of your own does as well), then run this script again:"
        foreach ($name in $Missing) { Write-Host "    $(Get-PasswordVar $name)=$(Get-RandomHex -ByteCount 12)" }
    }
}
else {
    if (-not (Test-Path -LiteralPath $EnvExamplePath)) {
        Stop-Install ".env.example not found. Run this script from a complete checkout of the repository."
    }
    Write-Host "Creating .env from .env.example with a generated password and secret for every app..."

    # A password and a secret for every app, whichever are started now, so that
    # starting another later never finds it open.
    foreach ($name in $AllApps) {
        $password = Get-RandomHex -ByteCount 12
        $secret = Get-RandomHex -ByteCount 32
        if ($password -notmatch '^[0-9a-f]{24}$') { Stop-Install "failed to generate $(Get-PasswordVar $name)." }
        if ($secret -notmatch '^[0-9a-f]{64}$') { Stop-Install "failed to generate $(Get-SecretVar $name) (expected 64 hex characters)." }
        $Generated[(Get-PasswordVar $name)] = $password
        $Generated[(Get-SecretVar $name)] = $secret
    }

    # What an interrupted earlier run left behind: temporary copies, never a .env.
    Get-ChildItem -LiteralPath $RepoRoot -Filter '.env.tmp.*' -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

    # Written beside .env and moved onto it only when complete: .env is never
    # there half made, with or without a password in it.
    $tmp = New-TempFile -Stem 'env'
    try {
        $done = @{}
        $lines = New-Object System.Collections.Generic.List[string]
        foreach ($line in [System.IO.File]::ReadAllLines($EnvExamplePath, $Utf8NoBom)) {
            if ($line -match '^#?\s*([A-Z][A-Z0-9_]*)=') {
                $key = $Matches[1]
                if ($Generated.Contains($key) -and -not $done.Contains($key)) {
                    $lines.Add("$key=$($Generated[$key])")
                    $done[$key] = $true
                    continue
                }
            }
            $lines.Add($line)
        }
        foreach ($key in $Generated.Keys) {
            if (-not $done.Contains($key)) { $lines.Add("$key=$($Generated[$key])") }
        }
        Write-TextFile -Path $tmp -Lines $lines.ToArray()

        # Read back what was written before it becomes .env.
        foreach ($key in $Generated.Keys) {
            if ((Get-EnvValue $key $tmp) -ne $Generated[$key]) {
                Stop-Install "could not write $key to .env; nothing was changed."
            }
        }
        if (Test-Path -LiteralPath $EnvPath) {
            Stop-Install ".env appeared while this script was running; it was not changed."
        }
        Move-Item -LiteralPath $tmp -Destination $EnvPath
    }
    finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }

    Write-Host "Created .env (readable by you only), at $EnvPath. Your passwords:"
    foreach ($name in $Selected) {
        Write-Host "  ${name}: $($Generated[(Get-PasswordVar $name)])   ($(Get-PasswordVar $name) in .env)"
    }
    Write-Host "  The other apps have passwords in .env too. API-key lines are left blank; add them later if you want those features."
}

# --- 3. Publish on the network, only when asked and only with a password ------
function Test-OverrideIsOurs {
    if (-not (Test-Path -LiteralPath $OverridePath)) { return $false }
    $first = [System.IO.File]::ReadAllLines($OverridePath, $Utf8NoBom) | Select-Object -First 1
    return ($first -eq $OverrideMark)
}

function Assert-ComposeReads {
    # Compose reading compose.yaml, .env and the override as they are now; its
    # own message when it cannot. Returns whether it can.
    $result = Invoke-Docker @('compose', 'config', '-q')
    if ($result.Code -ne 0) {
        Write-Host $result.Text
        return $false
    }
    return $true
}

$LanOn = $false
if ($Lan) {
    if ($Missing.Count -gt 0) {
        Write-Host "error: not publishing on your network: no password for $($Missing -join ' ')." -ForegroundColor Red
        Write-Host "Add one for each to .env (above) and run this script again. Nothing was started."
        exit 1
    }
    if ((Test-Path -LiteralPath $OverridePath) -and -not (Test-OverrideIsOurs)) {
        Stop-Install "compose.override.yaml exists and was not written by this script, so it was left alone. Move it away, or add the ports of the chosen apps to it yourself (docs/SELF_HOSTING.md, `"Phone access`")."
    }
    if (-not (Assert-ComposeReads)) {
        Stop-Install "docker compose cannot read compose.yaml and .env as they are. Nothing was started."
    }
    $tmp = New-TempFile -Stem 'compose-override'
    try {
        $lines = @(
            $OverrideMark,
            '# Publishes these apps on every network interface of this computer, not only on',
            '# localhost, so a phone on the same Wi-Fi can reach them over plain http.',
            '# Delete this file, then run: docker compose up -d   to put them back on localhost.',
            "# '!override' needs Docker Compose 2.24 or newer.",
            'services:'
        )
        foreach ($name in $Selected) {
            $lines += "  ${name}:"
            $lines += '    ports: !override'
            $lines += "      - `"$($Ports[$name]):3000`""
        }
        Write-TextFile -Path $tmp -Lines $lines
        Move-Item -LiteralPath $tmp -Destination $OverridePath -Force
    }
    finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
    $LanOn = $true
    if (-not (Assert-ComposeReads)) {
        Remove-Item -LiteralPath $OverridePath -Force -ErrorAction SilentlyContinue
        Stop-Install "docker compose could not read the network settings this script wrote (it needs Docker Compose 2.24 or newer for '!override'). compose.override.yaml was removed and nothing was started."
    }
}
else {
    if (Test-OverrideIsOurs) {
        Remove-Item -LiteralPath $OverridePath -Force
        Write-Host "Removed compose.override.yaml, which an earlier run with -Lan wrote: the apps started now are on this computer only. Add -Lan to publish them on your network."
        Write-Host "An app that is already running keeps the ports it was started with until it is started again."
    }
    elseif (Test-Path -LiteralPath $OverridePath) {
        Write-Host "Note: compose.override.yaml is in effect and was not written by this script; whatever ports it publishes stay published."
    }
    if (-not (Assert-ComposeReads)) {
        Stop-Install "docker compose cannot read compose.yaml, .env and compose.override.yaml as they are. Nothing was started."
    }
}

# --- 4. Build and start ------------------------------------------------------
Write-Host "Building and starting: $($Selected -join ' ') (docker compose up -d --build) ..."
# Relaxed for the call, as in Invoke-Docker, but not redirected: the build's own
# output is what the owner needs to see.
$saved = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    & docker compose up -d --build @Selected
    $upCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $saved
}
if ($upCode -ne 0) {
    Write-Host ""
    Write-Host "error: docker compose could not build or start: $($Selected -join ' ') (exit $upCode)." -ForegroundColor Red
    Write-Host "The output above says why."
    Write-Host "Nothing is lost: .env was written and is kept at $EnvPath, with the password for each app"
    foreach ($name in $Selected) { Write-Host "  $(Get-PasswordVar $name)   ($name)" }
    Write-Host "Fix the problem and run this script again; it does not change .env. docs/SELF_HOSTING.md has more."
    exit 1
}

# --- 5. Wait for health ------------------------------------------------------
$pending = @($Selected)
Write-Host "Waiting for the apps to answer (up to ${HealthTimeoutSeconds}s) ..."
$clock = [System.Diagnostics.Stopwatch]::StartNew()
while ($pending.Count -gt 0) {
    $pending = @($pending | Where-Object { -not (Test-Health "http://127.0.0.1:$($Ports[$_])/api/health") })
    if ($pending.Count -eq 0) { break }
    if ($clock.Elapsed.TotalSeconds -ge $HealthTimeoutSeconds) {
        Write-Host "error: not healthy within $HealthTimeoutSeconds seconds: $($pending -join ' ')." -ForegroundColor Red
        foreach ($name in $pending) { Write-Host "Check the logs with:  docker compose logs -f $name" }
        Write-Host "The passwords are in $EnvPath. Then try again, or see docs/SELF_HOSTING.md for help."
        exit 1
    }
    Start-Sleep -Seconds $HealthIntervalSeconds
}

# --- The addresses to open ---------------------------------------------------
Write-Host ""
Write-Host "CollectCollect is running."
foreach ($name in $Selected) { Write-Host "  ${name}: http://localhost:$($Ports[$name])" }
if ($Generated.Count -gt 0) {
    Write-Host "Passwords (also in .env, readable by you only; keep it private and back it up):"
    foreach ($name in $Selected) { Write-Host "  ${name}: $($Generated[(Get-PasswordVar $name)])" }
}
else {
    Write-Host "Sign in with the passwords in .env (Select-String _PASSWORD= .env); it was not changed."
    if ($Missing.Count -gt 0) {
        Write-Host "No password is set for: $($Missing -join ' '); those apps let in anyone who can reach them."
    }
}
Write-Host "To change a password later, edit .env, then run: docker compose up -d --force-recreate <app>"

if ($LanOn) {
    $addresses = @(Get-LanAddress)
    $first = ''
    if ($addresses.Count -gt 0) { $first = $addresses[0] }
    $shown = $first
    if ($first -eq '') { $shown = '<this-computer-ip>' }
    Write-Host ""
    Write-Host "Open these on a phone on the same Wi-Fi:"
    foreach ($name in $Selected) { Write-Host "  ${name}: http://$($shown):$($Ports[$name])" }
    if ($first -eq '') {
        Write-Host "  This computer's address on your Wi-Fi was not found; ipconfig shows it."
    }
    elseif ($addresses.Count -gt 1) {
        Write-Host "  This computer has other addresses too ($(($addresses | Select-Object -Skip 1) -join ', ')); use the one on the phone's network."
    }
    Write-Host "These addresses are plain http, so on the phone Chrome will not install an app to the home screen,"
    Write-Host "keep it working offline, or open the live camera in cards' Scan. Those need https, or the phone"
    Write-Host "reaching this computer as localhost (docs/SELF_HOSTING.md, `"Phone access`")."
    Write-Host "If the phone cannot connect, Windows Firewall may block ports 3000 to 3005 (allow Docker Desktop on private networks),"
    Write-Host "or the Wi-Fi may keep devices apart (guest networks often do)."
    $hosts = Get-EnvValue 'ALLOWED_HOSTS'
    if ($hosts -ne '' -and $hosts -ne '*' -and $first -ne '') {
        $listed = @($hosts -split ',' | ForEach-Object { $_.Trim() })
        if ($listed -notcontains $first) {
            Write-Host "Warning: ALLOWED_HOSTS in .env is '$hosts', which does not list $first, so the apps will refuse the phone. Add it."
        }
    }
    if ((Get-EnvValue 'COOKIE_SECURE') -eq '1') {
        Write-Host "Warning: COOKIE_SECURE=1 in .env makes every address https, so saving anything from the phone's plain-http address is refused."
    }
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open the address above and sign in."
Write-Host "  2. In an app, open Settings and run the provider connection tests (guided checks)"
Write-Host "     to verify any API keys or providers you add to .env."
Write-Host "  3. Add optional keys to .env (for example ANTHROPIC_API_KEY for photo identification),"
Write-Host "     then apply them with: docker compose up -d --force-recreate <app>"
Write-Host "  4. See docs/SELF_HOSTING.md for phone access, remote access, backup and updates."
