[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$SiteOrigin,
    [Parameter(Mandatory = $true)][string]$NodeExe,
    [string]$InstallPath = 'M:\LopeOS\accounts',
    [string]$DataPath = 'M:\LopeOS\accounts-data',
    [string]$TaskName = 'LopeOS Accounts',
    [int]$Port = 4176
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Automatic account installation needs the Windows runner started as Administrator (or its service running with administrator rights).'
}
$origin = [Uri]$SiteOrigin
if (-not $origin.IsAbsoluteUri -or $origin.Scheme -ne 'https' -or $origin.UserInfo -or $origin.GetLeftPart([UriPartial]::Authority) -cne $SiteOrigin) { throw 'Use an exact HTTPS SiteOrigin without a trailing slash.' }
$NodeExe = (Resolve-Path -LiteralPath $NodeExe).Path
$version = & $NodeExe --version
$major = ($version -replace '^v', '').Split('.')[0]
if ($LASTEXITCODE -ne 0 -or [int]$major -lt 24) { throw 'Node 24 or newer is required.' }
$InstallPath = [IO.Path]::GetFullPath($InstallPath)
$DataPath = [IO.Path]::GetFullPath($DataPath)
foreach ($file in @('server.mjs', 'windows/host.mjs')) {
    if (-not (Test-Path -LiteralPath (Join-Path $SourcePath $file) -PathType Leaf)) { throw "Missing account source: $file" }
}
function Set-PrivateDirectory([string]$Path, [bool]$Writable) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-19')) {
        $rights = if ($sid -eq 'S-1-5-19') { if ($Writable) { 'Modify' } else { 'ReadAndExecute' } } else { 'FullControl' }
        $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), $rights, 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
Set-PrivateDirectory $InstallPath $false
Set-PrivateDirectory $DataPath $true
Set-PrivateDirectory (Join-Path $InstallPath 'logs') $true
$configPath = Join-Path $InstallPath 'config.json'
$stopPath = Join-Path $InstallPath 'stop'
$previous = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllText($configPath) } else { $null }
$release = Join-Path $InstallPath ('releases/' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $release -Force | Out-Null
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $release 'node.exe')
Copy-Item -LiteralPath (Join-Path $SourcePath 'server.mjs') -Destination $release
Copy-Item -LiteralPath (Join-Path $SourcePath 'windows/host.mjs') -Destination $release
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing -and $existing.State -eq 'Running') {
    [IO.File]::WriteAllText($stopPath, 'stop')
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-ScheduledTask -TaskName $TaskName).State -eq 'Running') {
        if ((Get-Date) -gt $deadline) { throw 'Account shutdown timed out; the existing process and data were left intact.' }
        Start-Sleep -Milliseconds 500
    }
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is already owned by another process. Stop the manually started account server before automatic installation." }
$config = @{ origin = $SiteOrigin; data = $DataPath; port = $Port; server = (Join-Path $release 'server.mjs'); release = $release }
$utf8 = [Text.UTF8Encoding]::new($false)
function Start-AccountTask($ReleaseDirectory) {
    Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
    $arguments = '"' + (Join-Path $ReleaseDirectory 'host.mjs') + '" "' + $InstallPath + '"'
    $action = New-ScheduledTaskAction -Execute (Join-Path $ReleaseDirectory 'node.exe') -Argument $arguments -WorkingDirectory $InstallPath
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $taskPrincipal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
}
try {
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), $utf8)
    Start-AccountTask $release
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/accounts/session" -TimeoutSec 2
            $session = $response.Content | ConvertFrom-Json
            if ($response.Headers['Content-Type'] -notmatch 'application/json' -or $session.quotaBytes -ne 1000000000 -or $null -ne $session.account) { throw 'Unexpected account health response.' }
            $healthy = $true; break
        } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $healthy) {
        $info = Get-ScheduledTaskInfo -TaskName $TaskName
        Write-Output "Account task result: $($info.LastTaskResult); state: $((Get-ScheduledTask -TaskName $TaskName).State)"
        $logPath = Join-Path $InstallPath 'logs/service.log'
        if (Test-Path $logPath) { Get-Content -LiteralPath $logPath -Tail 20 | Write-Output }
        throw "Accounts did not become healthy. See $logPath."
    }
    Write-Output "Accounts ready on 127.0.0.1:$Port; persistent data: $DataPath."
} catch {
    $failure = $_
    [IO.File]::WriteAllText($stopPath, 'stop')
    Start-Sleep -Seconds 2
    # Never start a second writer if graceful shutdown is still pending.
    $failedTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($failedTask -and $failedTask.State -ne 'Running' -and $previous) {
        [IO.File]::WriteAllText($configPath, $previous, $utf8)
        Start-AccountTask (($previous | ConvertFrom-Json).release)
    }
    throw $failure
}
