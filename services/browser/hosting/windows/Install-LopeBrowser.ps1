[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SiteOrigin,
    [string]$Distro = 'Ubuntu',
    [string]$SourcePath = (Join-Path $PSScriptRoot '../../../..'),
    [string]$InstallRoot = 'M:/LopeOS/browser',
    [string]$DataRoot = 'M:/LopeOS/browser-host-data',
    [string]$NodeExe = (Get-Command node -ErrorAction Stop).Source,
    [int]$MaxWorkers = 2
)
$ErrorActionPreference = 'Stop'
$origin = [Uri]$SiteOrigin
if ($origin.Scheme -ne 'https' -or $origin.GetLeftPart([UriPartial]::Authority) -ne $SiteOrigin) { throw 'Use the exact HTTPS origin.' }
if ($Distro -notmatch '^[A-Za-z0-9_.-]+$' -or $MaxWorkers -lt 1 -or $MaxWorkers -gt 16) { throw 'Invalid browser host parameters.' }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run the browser host installer from the elevated WSL-owner runner account.' }
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'Ubuntu WSL2 with Docker Engine is required. The installer does not reboot Windows or change Windows features.' }
$source = (Resolve-Path $SourcePath).Path
$linuxSource = ((& wsl.exe --distribution $Distro --user root --exec wslpath -a $source) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxSource)) { throw 'This runner account cannot access the selected Ubuntu WSL distribution.' }
try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:4176/api/accounts/session' -TimeoutSec 10 }
catch { throw 'The account service must be running on loopback port 4176 first.' }
$taskName = 'LopeOS Browser'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$occupied = Get-NetTCPConnection -LocalPort 4177 -State Listen -ErrorAction SilentlyContinue
if ($occupied -and -not $task) { throw 'Port 4177 belongs to an existing process; refusing to replace it.' }
if ($task) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
& wsl.exe --distribution $Distro --user root --exec bash "$linuxSource/services/browser/hosting/linux/install.sh" $linuxSource
if ($LASTEXITCODE -ne 0) { if ($task) { Start-ScheduledTask -TaskName $taskName }; throw 'Linux browser setup failed; the Caddy configuration has not been changed.' }
New-Item -ItemType Directory -Force -Path $InstallRoot, $DataRoot | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($directory in @($InstallRoot, $DataRoot)) {
    & icacls.exe $directory /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect the browser gateway code/data directory.' }
}
$release = Join-Path $InstallRoot ('releases/' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path (Join-Path $release 'services/browser'), (Join-Path $release 'services/runtime') | Out-Null
Copy-Item (Join-Path $source 'services/browser/hosting') (Join-Path $release 'services/browser/hosting') -Recurse
Copy-Item $NodeExe (Join-Path $release 'node.exe')
$configPath = Join-Path $InstallRoot 'host.json'
$previous = if (Test-Path $configPath) { Get-Content $configPath -Raw } else { $null }
$config = @{ version=1;origin=$SiteOrigin;distro=$Distro;data=$DataRoot;maxWorkers=$MaxWorkers;release=$release }
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$arguments = '"' + (Join-Path $release 'services/browser/hosting/windows/host.mjs') + '" "' + $configPath + '"'
$action = New-ScheduledTaskAction -Execute (Join-Path $release 'node.exe') -Argument $arguments -WorkingDirectory $release
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
$ready = $false
for ($attempt=0; $attempt -lt 45; $attempt++) {
    Start-Sleep -Seconds 1
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4177/api/browser/health' -Headers @{Host=$origin.Authority} -TimeoutSec 2; if ($health.service -eq 'lope-browser-gateway') { $ready=$true; break } } catch {}
}
if (-not $ready) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($previous) {
        [IO.File]::WriteAllText($configPath, $previous, [Text.UTF8Encoding]::new($false))
        $old = $previous | ConvertFrom-Json
        $oldArguments = '"' + (Join-Path $old.release 'services/browser/hosting/windows/host.mjs') + '" "' + $configPath + '"'
        $oldAction = New-ScheduledTaskAction -Execute (Join-Path $old.release 'node.exe') -Argument $oldArguments -WorkingDirectory $old.release
        Register-ScheduledTask -TaskName $taskName -Action $oldAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName $taskName
    }
    throw 'The new browser gateway did not become healthy. Caddy has not been changed.'
}
Write-Output 'Browser account gateway is healthy on loopback port 4177. Browser rendering still requires the streaming acceptance check before activating the public route.'
