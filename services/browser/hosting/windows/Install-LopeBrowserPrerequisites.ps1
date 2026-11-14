# Continue approved setup after the operator-controlled Windows restart.
# Installs Ubuntu/Docker/Node; never restarts Windows or changes Caddy.
[CmdletBinding()]
param(
    [ValidateSet('Ubuntu-24.04')][string]$Distro = 'Ubuntu-24.04',
    [string]$SourcePath = (Join-Path $PSScriptRoot '../../../..'),
    [string]$DistroDirectory
)
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Use the elevated production runner account that owns the browser WSL distro.' }
foreach ($feature in @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')) {
    if ((Get-WindowsOptionalFeature -Online -FeatureName $feature).State -ne 'Enabled') {
        throw 'WSL Windows features are not ready. No automatic restart will be performed.'
    }
}
& wsl.exe --version
if ($LASTEXITCODE -ne 0) { throw 'Install the modern WSL package before Ubuntu setup. No automatic Windows restart is permitted.' }
$distros = ((& wsl.exe --list --quiet) -join "`n").Replace("`0", '') -split "`n" | ForEach-Object { $_.Trim() }
if ($distros -notcontains $Distro) {
    Write-Output 'Installing Ubuntu 24.04 LTS for the browser runtime.'
    $installArgs = @('--install', '--distribution', $Distro, '--no-launch', '--web-download')
    if ($DistroDirectory) {
        if ($DistroDirectory -notmatch '^[A-Za-z]:[\\/]LopeOS[\\/][A-Za-z0-9_.-]+$') { throw 'Use a dedicated local LopeOS directory for Ubuntu.' }
        $installArgs += @('--location', $DistroDirectory)
    }
    & wsl.exe @installArgs
    if ($LASTEXITCODE -ne 0) { throw 'Ubuntu installation did not complete. No Windows restart was performed.' }
}
# `--set-version` fails with WSL_E_VM_MODE_INVALID_STATE when the distro is already
# WSL2, so only convert when the listed version is not 2.
$env:WSL_UTF8 = '1'
$listed = @((& wsl.exe --list --verbose) -join "`n" -replace "`0", '' -split "`n" | Where-Object { $_ -match ('^\s*\*?\s*' + [regex]::Escape($Distro) + '\s') })
$wslVersion = if ($listed.Count -and $listed[0] -match '(\d)\s*$') { $Matches[1] } else { '' }
if ($wslVersion -ne '2') {
    & wsl.exe --set-version $Distro 2
    if ($LASTEXITCODE -ne 0) { throw 'The browser requires WSL2. Check virtualization support; no Windows restart was performed.' }
}
& wsl.exe --distribution $Distro --user root --exec /usr/bin/id -u
if ($LASTEXITCODE -ne 0) { throw 'The runner cannot start its Ubuntu WSL2 distro as root.' }
$source = (Resolve-Path $SourcePath).Path
$linuxSource = ((& wsl.exe --distribution $Distro --user root --exec wslpath -a $source) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxSource)) { throw 'Could not resolve the reviewed source path inside Ubuntu.' }
$init = ((& wsl.exe --distribution $Distro --user root --exec cat /proc/1/comm) -join '').Trim()
if ($init -ne 'systemd') {
    & wsl.exe --distribution $Distro --user root --exec bash "$linuxSource/services/browser/hosting/linux/configure-wsl.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure systemd in the browser distro.' }
    # Only this distro is restarted. Caddy and Accounts run directly on Windows.
    & wsl.exe --terminate $Distro
    if ($LASTEXITCODE -ne 0) { throw 'Could not restart the selected browser distro.' }
    Start-Sleep -Seconds 5
}
& wsl.exe --distribution $Distro --user root --exec bash "$linuxSource/services/browser/hosting/linux/install-prerequisites.sh"
if ($LASTEXITCODE -ne 0) { throw 'Ubuntu browser prerequisites did not complete. Caddy has not been changed.' }
Write-Output 'Ubuntu 24.04 WSL2, systemd, Docker Engine and Node are ready. No Windows restart was performed; Caddy configuration is unchanged.'
