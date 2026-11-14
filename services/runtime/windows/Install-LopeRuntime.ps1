# Installs or updates the visitor workspace runtime on the Windows HOST.
# The runtime runs as a systemd service inside the host's WSL2 distribution and
# listens on loopback port 4174, which Caddy proxies for /api/*. A boot-time
# scheduled task keeps that distribution running, because systemd services alone
# do not keep WSL alive. Visitors never install anything.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SiteOrigin,
    [string]$Distro = 'Ubuntu-24.04',
    [string]$SourcePath = (Join-Path $PSScriptRoot '../../..')
)
$ErrorActionPreference = 'Stop'
$env:WSL_UTF8 = '1'
$origin = [Uri]$SiteOrigin
if ($origin.Scheme -ne 'https' -or $origin.GetLeftPart([UriPartial]::Authority) -ne $SiteOrigin) { throw 'Use the exact HTTPS site origin without a trailing slash.' }
if ($Distro -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Invalid WSL distribution name.' }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run the runtime installer from the elevated WSL-owner runner account.' }
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'WSL2 is required on this host.' }

$source = (Resolve-Path $SourcePath).Path
if (-not (Test-Path (Join-Path $source 'services/runtime/install-public-linux.sh'))) { throw 'The source path does not contain services/runtime.' }
$linuxSource = ((& wsl.exe --distribution $Distro --user root --exec wslpath -a $source) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxSource)) { throw "This runner account cannot access the $Distro WSL distribution." }

& wsl.exe --distribution $Distro --user root --exec bash "$linuxSource/services/runtime/install-public-linux.sh" $SiteOrigin $linuxSource
if ($LASTEXITCODE -ne 0) { throw 'Linux runtime installation failed; see the output above.' }

# Keep the distribution, and with it the systemd service, running from boot.
$taskName = 'LopeOS visitor runtime'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "--distribution $Distro --user root --exec /bin/sh -c `"systemctl start lope-visitor-runtime.service && exec sleep infinity`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

# Caddy reaches the service through WSL's localhost forwarding.
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Seconds 1
    try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4174/api/identity' -TimeoutSec 3; $reachable = $true }
    catch { $reachable = [bool]$_.Exception.Response }
    if ($reachable) { Write-Output 'Visitor runtime is listening on loopback port 4174.'; return }
}
$status = ((& wsl.exe --distribution $Distro --user root --exec /bin/sh -c 'systemctl status lope-visitor-runtime.service --no-pager -n 30 2>&1') -join "`n")
Write-Output $status
throw 'The visitor runtime did not become reachable from Windows on 127.0.0.1:4174.'
