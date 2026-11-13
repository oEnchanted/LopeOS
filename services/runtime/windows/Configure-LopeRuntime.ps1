# Run once on the Windows HOST, not on visitor computers.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SiteOrigin,
    [string]$Distro = "Ubuntu",
    [switch]$RegisterStartupTask
)
$ErrorActionPreference = "Stop"
$origin = [Uri]$SiteOrigin
if ($origin.Scheme -ne "https" -or $origin.GetLeftPart([UriPartial]::Authority) -ne $SiteOrigin) { throw "Use the exact HTTPS site origin without a trailing slash." }
if ($Distro -notmatch '^[A-Za-z0-9_.-]+$') { throw "Invalid WSL distribution name." }
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw "Install WSL2 and an Ubuntu distribution on this host first." }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$linuxRepo = (& wsl.exe --distribution $Distro --exec wslpath -a $repo).Trim()
if ($LASTEXITCODE -ne 0) { throw "The WSL2 distribution is unavailable." }
& wsl.exe --distribution $Distro --user root --exec bash "$linuxRepo/services/runtime/install-public-linux.sh" $SiteOrigin $linuxRepo
if ($LASTEXITCODE -ne 0) { throw "Runtime host installation failed. Review the prerequisite message above." }
$webRoot = (Join-Path $repo "dist").Replace('\', '/')
if (-not (Test-Path (Join-Path $repo "dist/index.html"))) { throw "Build the website first. The runtime is installed; the Caddy document root needs dist/index.html." }
$destination = Join-Path $repo "Caddyfile.windows.generated"
$template = Get-Content (Join-Path $PSScriptRoot "Caddyfile") -Raw
$template = $template.Replace('{$LOPE_SITE_HOST}', $origin.Authority).Replace('{$LOPE_WEB_ROOT}', $webRoot)
[IO.File]::WriteAllText($destination, $template, (New-Object Text.UTF8Encoding($false)))
if ($RegisterStartupTask) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    # WSL distributions belong to a Windows user, so do not register as SYSTEM.
    $action = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "--distribution $Distro --user root --exec bash -lc `"systemctl start lope-visitor-runtime.service; exec sleep infinity`""
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType S4U -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName "LopeOS visitor runtime" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName "LopeOS visitor runtime"
}
Write-Output "Generated $destination. Review it, then use it for the Windows Caddy service."
Write-Output "Visitors receive private workspaces automatically; no installs, tokens, or accounts are required."
