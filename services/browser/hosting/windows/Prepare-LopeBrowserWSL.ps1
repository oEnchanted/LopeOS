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
# Windows' inbox wsl.exe can remain an installation stub after enabling the
# features. Use Microsoft's documented standalone MSI path when --version fails.
# Verify the official release digest and Microsoft signature before installation.
$modernWsl = Join-Path $env:ProgramFiles 'WSL/wsl.exe'
# Do not launch the inbox installation stub merely to probe its version: it can
# leave its interactive installer process open and block MSI InstallValidate.
if (-not (Test-Path $modernWsl)) {
    $ProgressPreference = 'SilentlyContinue'
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/microsoft/WSL/releases/latest' -Headers @{Accept='application/vnd.github+json'}
    if ($release.prerelease -or $release.draft) { throw 'Expected a stable Microsoft WSL release.' }
    $assets = @($release.assets | Where-Object { $_.name -match '^wsl\.[0-9.]+\.x64\.msi$' })
    if ($assets.Count -ne 1) { throw 'Could not identify the official x64 WSL installer.' }
    $asset = $assets[0]
    if ($asset.browser_download_url -notmatch '^https://github\.com/microsoft/WSL/releases/download/') { throw 'Unexpected WSL package download origin.' }
    $package = Join-Path ([IO.Path]::GetTempPath()) ('lope-wsl-' + [Guid]::NewGuid().ToString('N') + '.msi')
    $installLog = $package + '.log'
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $package
        if ($asset.digest -match '^sha256:([a-fA-F0-9]{64})$') {
            if ((Get-FileHash -Algorithm SHA256 -LiteralPath $package).Hash -ne $Matches[1]) { throw 'The WSL package digest did not match the official release.' }
        }
        $signature = Get-AuthenticodeSignature -LiteralPath $package
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') { throw 'The WSL installer must have a valid Microsoft signature.' }
        Write-Output "Installing signed Microsoft WSL release $($release.tag_name) with Windows restart suppressed."
        Write-Output "Windows kernel build: $([Environment]::OSVersion.Version.Build)"
        $arguments = @('/i', ('"' + $package + '"'), '/qn', '/norestart', 'REBOOT=ReallySuppress', '/L*v', ('"' + $installLog + '"'))
        $installed = Start-Process -FilePath msiexec.exe -ArgumentList $arguments -Wait -PassThru -NoNewWindow
        if ($installed.ExitCode -eq 3010) { throw 'The WSL MSI requested another Windows restart. No restart was performed; operator approval is required before restarting.' }
        if ($installed.ExitCode -ne 0) {
            # Print only bounded installer error/action lines, with paths redacted.
            # Never publish the raw MSI log, environment or Windows account details.
            if (Test-Path $installLog) {
                $lines = @(Get-Content -LiteralPath $installLog)
                $matches = @($lines | Select-String -Pattern 'Error [0-9]{3,4}|Return value 3|requires .*Windows|not supported|Failed to start service')
                $indexes = @($matches | ForEach-Object { $start = [Math]::Max(0, $_.LineNumber - 9); $end = $_.LineNumber - 1; $start..$end }) | Sort-Object -Unique | Select-Object -Last 24
                foreach ($index in $indexes) {
                    $safe = $lines[$index] -replace '(?i)[A-Z]:\\[^\r\n]*', '[local path]' -replace 'S-1-[0-9-]+', '[SID]'
                    Write-Output ($safe.Substring(0, [Math]::Min(600, $safe.Length)))
                }
            }
            throw "The signed WSL package installation returned code $($installed.ExitCode). No Windows restart was performed."
        }
    } finally { Remove-Item -LiteralPath $package, $installLog -Force -ErrorAction SilentlyContinue }
}
if (Test-Path $modernWsl) { $env:PATH = (Split-Path $modernWsl) + ';' + $env:PATH }
& wsl.exe --version
if ($LASTEXITCODE -ne 0) { throw 'The installed WSL package did not start. No automatic Windows restart is permitted.' }
Write-Output 'WSL preparation completed without a Windows restart. Ubuntu and Docker setup remain separate.'
