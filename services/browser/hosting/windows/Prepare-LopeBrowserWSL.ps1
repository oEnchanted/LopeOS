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
& wsl.exe --version
if ($LASTEXITCODE -ne 0) {
    $ProgressPreference = 'SilentlyContinue'
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/microsoft/WSL/releases/latest' -Headers @{Accept='application/vnd.github+json'}
    if ($release.prerelease -or $release.draft) { throw 'Expected a stable Microsoft WSL release.' }
    $assets = @($release.assets | Where-Object { $_.name -match '^wsl\.[0-9.]+\.x64\.msi$' })
    if ($assets.Count -ne 1) { throw 'Could not identify the official x64 WSL installer.' }
    $asset = $assets[0]
    if ($asset.browser_download_url -notmatch '^https://github\.com/microsoft/WSL/releases/download/') { throw 'Unexpected WSL package download origin.' }
    $package = Join-Path ([IO.Path]::GetTempPath()) ('lope-wsl-' + [Guid]::NewGuid().ToString('N') + '.msi')
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $package
        if ($asset.digest -match '^sha256:([a-fA-F0-9]{64})$') {
            if ((Get-FileHash -Algorithm SHA256 -LiteralPath $package).Hash -ne $Matches[1]) { throw 'The WSL package digest did not match the official release.' }
        }
        $signature = Get-AuthenticodeSignature -LiteralPath $package
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') { throw 'The WSL installer must have a valid Microsoft signature.' }
        Write-Output "Installing signed Microsoft WSL release $($release.tag_name) with Windows restart suppressed."
        $arguments = @('/i', ('"' + $package + '"'), '/qn', '/norestart', 'REBOOT=ReallySuppress')
        $installed = Start-Process -FilePath msiexec.exe -ArgumentList $arguments -Wait -PassThru -NoNewWindow
        if ($installed.ExitCode -eq 3010) { throw 'The WSL MSI requested another Windows restart. No restart was performed; operator approval is required before restarting.' }
        if ($installed.ExitCode -ne 0) { throw "The signed WSL package installation returned code $($installed.ExitCode). No Windows restart was performed." }
    } finally { Remove-Item -LiteralPath $package -Force -ErrorAction SilentlyContinue }
    $modernWsl = Join-Path $env:ProgramFiles 'WSL/wsl.exe'
    if (Test-Path $modernWsl) { $env:PATH = (Split-Path $modernWsl) + ';' + $env:PATH }
    & wsl.exe --version
    if ($LASTEXITCODE -ne 0) { throw 'The installed WSL package did not start. No automatic Windows restart is permitted.' }
}
Write-Output 'WSL preparation completed without a Windows restart. Ubuntu and Docker setup remain separate.'
