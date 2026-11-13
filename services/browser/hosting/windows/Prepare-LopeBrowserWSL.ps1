# Host feature installation only. Never restarts Windows or changes the live Caddy configuration.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run WSL preparation from the elevated production runner account.' }
$features = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')
$restartNeeded = $false
foreach ($feature in $features) {
    $state = Get-WindowsOptionalFeature -Online -FeatureName $feature
    if ($state.State -ne 'Enabled') {
        $result = Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart
        if ($result.RestartNeeded) { $restartNeeded = $true }
    }
}
if ($restartNeeded) {
    Write-Output 'WSL2 Windows features are enabled. A Windows restart is required before continuing. No restart was performed; Caddy configuration was not changed.'
    exit 0
}
# The modern WSL package is installed separately from Ubuntu. This command does not
# create a Linux user or initiate a Windows restart. Nonzero/restart-required results
# are reported for the operator instead of forcing a reboot.
& wsl.exe --install --no-distribution --web-download
if ($LASTEXITCODE -ne 0) { throw 'The WSL package needs an operator check or a scheduled Windows restart. No automatic restart was performed.' }
Write-Output 'WSL preparation completed without a Windows restart. Ubuntu and Docker setup remain separate.'
