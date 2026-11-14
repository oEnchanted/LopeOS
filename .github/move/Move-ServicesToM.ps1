# Moves LopeOS, Portfolio, and Caddy from C: to M:. Copies first, switches one
# service at a time, verifies it live, and switches that service back on failure.
# C: originals are left in place; a later step removes them after verification.
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$Steps = 'copy,accounts,portfolio,caddy'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$selected = $Steps.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
function Say([string]$Message) { Write-Output ("[{0}] {1}" -f (Get-Date).ToString('HH:mm:ss'), $Message) }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "The runner is not elevated ($($identity.Name)); nothing was changed." }
Say "Running as $($identity.Name) (administrator). Dry run: $DryRun. Steps: $($selected -join ', ')"
if ((Get-Volume -DriveLetter M).FileSystem -ne 'NTFS') { throw 'M: must be NTFS.' }

function Invoke-Robocopy([string]$Source, [string]$Target, [string[]]$Options) {
    if ($DryRun) { Say "  would copy $Source -> $Target $($Options -join ' ')"; return }
    $output = & robocopy.exe $Source $Target @Options /R:2 /W:2 /NP /NFL /NDL /NJH
    $code = $LASTEXITCODE
    $output | Where-Object { $_ -match '^\s*(Dirs|Files|Bytes)\s*:' } | ForEach-Object { Say "  $($_.Trim())" }
    if ($code -ge 8) { $output | Select-Object -Last 20 | ForEach-Object { Say "  $_" }; throw "Copy failed: $Source -> $Target (robocopy $code)" }
}
function Wait-Until([scriptblock]$Test, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) { if (& $Test) { return $true }; Start-Sleep -Milliseconds 750 }
    return $false
}
function Update-Text([string]$Path, $Map) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $offset = if ($bom) { 3 } else { 0 }
    $text = [Text.Encoding]::UTF8.GetString($bytes, $offset, $bytes.Length - $offset)
    $updated = $text
    foreach ($key in $Map.Keys) { $updated = [regex]::Replace($updated, [regex]::Escape($key), $Map[$key].Replace('$', '$$'), 'IgnoreCase') }
    if ($updated -ne $text) { [IO.File]::WriteAllText($Path, $updated, [Text.UTF8Encoding]::new($bom)) }
    return $updated
}
function Set-PrivateDirectory([string]$Path, [bool]$Writable) {
    # Same policy as services/accounts/windows/Install-LopeAccounts.ps1.
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-19')) {
        $rights = if ($sid -eq 'S-1-5-19') { if ($Writable) { 'Modify' } else { 'ReadAndExecute' } } else { 'FullControl' }
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), $rights, 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Wait-TaskStopped([string]$Name, [int]$Seconds) { Wait-Until { (Get-ScheduledTask -TaskName $Name).State -ne 'Running' } $Seconds }
function Get-Status([string]$Url) {
    try { return (Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 8 -Headers @{ 'Cache-Control' = 'no-cache' }).StatusCode } catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } return 0 }
}
function Test-Sites {
    $lope = Get-Status "https://lopeos.online/__lope/version.json?move=$([Guid]::NewGuid().ToString('N'))"
    $accounts = Get-Status 'https://lopeos.online/api/accounts/session'
    $portfolio = Get-Status 'https://benjaminsuitts.com/'
    return [pscustomobject]@{ lopeos = $lope; accounts = $accounts; portfolio = $portfolio; ok = ($lope -eq 200 -and $accounts -eq 200 -and $portfolio -eq 200) }
}

# Paths Caddy serves now and would restore on rollback.
$caddyRoots = @(foreach ($file in 'C:\caddy\Caddyfile', 'C:\caddy\Caddyfile.previous') {
    if (Test-Path -LiteralPath $file) { foreach ($match in (Select-String -LiteralPath $file -Pattern 'root \* "?([^"\s]+)"?' -AllMatches).Matches) { [IO.Path]::GetFullPath($match.Groups[1].Value.Replace('/', '\')).TrimEnd('\') } }
}) | Sort-Object -Unique
$liveReleases = @($caddyRoots | Where-Object { $_ -like 'C:\LopeOS\releases\*' -and (Test-Path -LiteralPath $_) })
Say "Caddy roots: $($caddyRoots -join ', ')"
if (-not $liveReleases.Count) { throw 'Could not identify the live LopeOS release from Caddy; nothing was changed.' }
$before = Test-Sites
Say "Sites before: lopeos=$($before.lopeos) accounts=$($before.accounts) portfolio=$($before.portfolio)"

if ($selected -contains 'copy') {
    Say '== Copy files to M: (services keep running from C:)'
    # The C:\LopeOS checkout's node_modules are pnpm links into C:; reinstall there if that checkout is used.
    Invoke-Robocopy 'C:\LopeOS' 'M:\LopeOS' @('/E', '/COPY:DAT', '/DCOPY:DAT', '/XJ', '/XD', 'C:\LopeOS\accounts', 'C:\LopeOS\accounts-data', 'C:\LopeOS\releases', 'node_modules')
    foreach ($release in $liveReleases) { Invoke-Robocopy $release ('M:\LopeOS\releases\' + (Split-Path $release -Leaf)) @('/E', '/COPY:DAT', '/DCOPY:DAT') }
    Invoke-Robocopy 'C:\Portfolio' 'M:\Portfolio' @('/E', '/COPY:DAT', '/DCOPY:DAT', '/XJ')
    Invoke-Robocopy 'C:\sites' 'M:\sites' @('/E', '/COPY:DAT', '/DCOPY:DAT', '/XJ')
}

if ($selected -contains 'accounts') {
    Say '== Account service'
    $taskName = 'LopeOS Accounts'; $oldRoot = 'C:\LopeOS\accounts'; $newRoot = 'M:\LopeOS\accounts'; $oldData = 'C:\LopeOS\accounts-data'; $newData = 'M:\LopeOS\accounts-data'
    $task = Get-ScheduledTask -TaskName $taskName
    $oldAction = $task.Actions[0]
    $config = Get-Content -LiteralPath (Join-Path $oldRoot 'config.json') -Raw | ConvertFrom-Json
    if ([IO.Path]::GetFullPath($config.data).TrimEnd('\') -ne $oldData) { throw "Unexpected account data path $($config.data); nothing was changed." }
    $newRelease = Join-Path $newRoot ('releases\' + (Split-Path $config.release -Leaf))
    $port = [int]$config.port
    $healthy = { try { $s = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/accounts/session" -TimeoutSec 3).Content | ConvertFrom-Json; $s.quotaBytes -eq 1000000000 -and $null -eq $s.account } catch { $false } }
    Say "  now: $($oldAction.Execute) $($oldAction.Arguments) state=$($task.State) healthy=$(& $healthy)"
    Say "  will run: $newRelease\node.exe with data in $newData"
    if (-not (Test-Path -LiteralPath (Join-Path $config.release 'host.mjs'))) { throw 'The running account release is incomplete; nothing was changed.' }
    if (-not $DryRun) {
        Set-PrivateDirectory $newRoot $false
        Set-PrivateDirectory (Join-Path $newRoot 'logs') $true
        Set-PrivateDirectory $newData $true
        [IO.File]::WriteAllText((Join-Path $oldRoot 'stop'), 'stop')
        if (-not (Wait-TaskStopped $taskName 90)) { throw 'The account service did not stop within 90 seconds; data was not copied.' }
        Say '  stopped; copying account data while nothing can write to it'
        try {
            Invoke-Robocopy $oldRoot $newRoot @('/E', '/COPY:DAT', '/DCOPY:DAT', '/XF', 'stop')
            Invoke-Robocopy $oldData $newData @('/MIR', '/COPY:DAT', '/DCOPY:DAT', '/XF', '.lock')
            $sourceFiles = @(Get-ChildItem -LiteralPath $oldData -Recurse -File -Force | Where-Object Name -ne '.lock' | ForEach-Object { $_.FullName.Substring($oldData.Length) + '|' + $_.Length } | Sort-Object)
            $targetFiles = @(Get-ChildItem -LiteralPath $newData -Recurse -File -Force | Where-Object Name -ne '.lock' | ForEach-Object { $_.FullName.Substring($newData.Length) + '|' + $_.Length } | Sort-Object)
            if (($sourceFiles -join "`n") -ne ($targetFiles -join "`n")) { throw 'The copied account data does not match the original.' }
            $registry = Join-Path $oldData 'registry.json'
            if ((Test-Path $registry) -and (Get-FileHash $registry).Hash -ne (Get-FileHash (Join-Path $newData 'registry.json')).Hash) { throw 'The copied account registry does not match.' }
            Say "  verified $($sourceFiles.Count) account data files"
            $newConfig = [ordered]@{ origin = $config.origin; data = $newData; port = $port; server = (Join-Path $newRelease 'server.mjs'); release = $newRelease }
            [IO.File]::WriteAllText((Join-Path $newRoot 'config.json'), ($newConfig | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
            Remove-Item -LiteralPath (Join-Path $newRoot 'stop') -Force -ErrorAction SilentlyContinue
            $newAction = New-ScheduledTaskAction -Execute (Join-Path $newRelease 'node.exe') -Argument ('"' + (Join-Path $newRelease 'host.mjs') + '" "' + $newRoot + '"') -WorkingDirectory $newRoot
            Set-ScheduledTask -TaskName $taskName -Action $newAction | Out-Null
            Remove-Item -LiteralPath (Join-Path $oldRoot 'stop') -Force -ErrorAction SilentlyContinue
            Start-ScheduledTask -TaskName $taskName
            if (-not (Wait-Until $healthy 60)) { throw 'The account service did not become healthy from M:.' }
            $owner = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$newRoot*" }
            if (-not $owner) { throw 'The healthy account service is not the M: copy.' }
            Say "  account service is serving from M: (pid $($owner.ProcessId))"
        } catch {
            $failure = $_
            Say "  FAILED: $failure. Switching the account service back to C:."
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            Wait-TaskStopped $taskName 30 | Out-Null
            Set-ScheduledTask -TaskName $taskName -Action $oldAction | Out-Null
            Remove-Item -LiteralPath (Join-Path $oldRoot 'stop') -Force -ErrorAction SilentlyContinue
            Start-ScheduledTask -TaskName $taskName
            Say "  restored on C:: healthy=$(Wait-Until $healthy 60)"
            throw $failure
        }
    }
}

if ($selected -contains 'portfolio') {
    Say '== Portfolio backend'
    $taskName = 'Portfolio Node Backend'
    $task = Get-ScheduledTask -TaskName $taskName
    $oldAction = $task.Actions[0]
    $swap = { param([string]$Value) if ($Value) { [regex]::Replace($Value, [regex]::Escape('C:\sites\'), 'M:\sites\', 'IgnoreCase') } else { $Value } }
    $statusOf = { param([string]$Runtime) try { $state = Get-Content -LiteralPath (Join-Path $Runtime 'logs\runtime.json') -Raw | ConvertFrom-Json; $s = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/stress/status" -f $state.port) -TimeoutSec 4; [bool]($s.available -and $s.runtime.platform -eq 'win32' -and $s.runtime.caddy.ready) } catch { $false } }
    $wasHealthy = & $statusOf 'C:\sites\portfolio-backend'
    $newExe = & $swap $oldAction.Execute; $newArgs = & $swap $oldAction.Arguments; $newDir = & $swap $oldAction.WorkingDirectory
    Say "  now: $($oldAction.Execute) $($oldAction.Arguments) state=$($task.State) healthy=$wasHealthy"
    Say "  will run: $newExe $newArgs (cwd $newDir)"
    if ($newExe -notlike 'M:\sites\*') { throw 'The Portfolio backend does not run from C:\sites; nothing was changed.' }
    if (-not $DryRun) {
        Stop-ScheduledTask -TaskName $taskName
        if (-not (Wait-TaskStopped $taskName 20)) { throw 'The Portfolio backend did not stop.' }
        try {
            Invoke-Robocopy 'C:\sites' 'M:\sites' @('/E', '/COPY:DAT', '/DCOPY:DAT', '/XJ')
            $hostConfig = 'M:\sites\portfolio-backend\host.json'
            Update-Text $hostConfig ([ordered]@{ 'C:\\sites\\' = 'M:\\sites\\' }) | Out-Null
            $root = (Get-Content -LiteralPath $hostConfig -Raw | ConvertFrom-Json).root
            if ($root -notlike 'M:\sites\*') { throw "host.json root is $root after rewriting." }
            Remove-Item -LiteralPath 'M:\sites\portfolio-backend\logs\runtime.json' -Force -ErrorAction SilentlyContinue
            # Same grants as the Portfolio installer: Local Service reads the app and site, writes logs.
            foreach ($grant in @(@('M:\sites\portfolio-backend', '*S-1-5-19:(OI)(CI)RX'), @('M:\sites\portfolio', '*S-1-5-19:(OI)(CI)RX'), @('M:\sites\portfolio-backend\logs', '*S-1-5-19:(OI)(CI)M'))) {
                & icacls.exe $grant[0] /grant $grant[1] /T /Q | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "Could not grant access on $($grant[0])." }
            }
            Set-ScheduledTask -TaskName $taskName -Action (New-ScheduledTaskAction -Execute $newExe -Argument $newArgs -WorkingDirectory $newDir) | Out-Null
            Start-ScheduledTask -TaskName $taskName
            $ok = if ($wasHealthy) { Wait-Until { & $statusOf 'M:\sites\portfolio-backend' } 60 } else { Wait-Until { (Get-ScheduledTask -TaskName $taskName).State -eq 'Running' } 30 }
            if (-not $ok) { throw 'The Portfolio backend did not become healthy from M:.' }
            Say "  Portfolio backend is running from M: (healthy=$(& $statusOf 'M:\sites\portfolio-backend'))"
        } catch {
            $failure = $_
            Say "  FAILED: $failure. Switching the Portfolio backend back to C:."
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            Wait-TaskStopped $taskName 20 | Out-Null
            Set-ScheduledTask -TaskName $taskName -Action $oldAction | Out-Null
            Remove-Item -LiteralPath 'C:\sites\portfolio-backend\logs\runtime.json' -Force -ErrorAction SilentlyContinue
            Start-ScheduledTask -TaskName $taskName
            Say "  restored on C:: healthy=$(Wait-Until { & $statusOf 'C:\sites\portfolio-backend' } 60)"
            throw $failure
        }
    }
}

if ($selected -contains 'caddy') {
    Say '== Caddy'
    $service = Get-CimInstance Win32_Service -Filter "Name='caddy'"
    $oldPath = $service.PathName
    $newPath = 'M:\Caddy\caddy.exe run --config M:\Caddy\Caddyfile --adapter caddyfile'
    $map = [ordered]@{ 'C:/LopeOS/' = 'M:/LopeOS/'; 'C:\LopeOS\' = 'M:\LopeOS\'; 'C:/sites/' = 'M:/sites/'; 'C:\sites\' = 'M:\sites\'; 'C:/caddy/' = 'M:/Caddy/'; 'C:\caddy\' = 'M:\Caddy\' }
    Say "  now: $oldPath ($($service.State))"
    $workDir = if ($DryRun) { Join-Path $env:RUNNER_TEMP 'caddy-preview' } else { 'M:\Caddy' }
    if ($DryRun) { New-Item -ItemType Directory -Force -Path $workDir | Out-Null; Copy-Item 'C:\caddy\Caddyfile*' $workDir -Force; Copy-Item 'C:\caddy\Start-Caddy.bat' $workDir -Force -ErrorAction SilentlyContinue }
    else { Invoke-Robocopy 'C:\caddy' 'M:\Caddy' @('/E', '/COPY:DAT', '/DCOPY:DAT') }
    foreach ($name in 'Caddyfile', 'Caddyfile.previous', 'Caddyfile.template', 'Start-Caddy.bat') { $path = Join-Path $workDir $name; if (Test-Path -LiteralPath $path) { Update-Text $path $map | Out-Null } }
    $candidate = Join-Path $workDir 'Caddyfile'
    $leftover = @(Select-String -LiteralPath $candidate -Pattern '(?i)\bC:[\\/]')
    if ($leftover.Count) { $leftover | ForEach-Object { Say "  still on C: line $($_.LineNumber): $($_.Line.Trim())" }; throw 'The Caddyfile still references C:; nothing was switched.' }
    foreach ($match in (Select-String -LiteralPath $candidate -Pattern 'root \* "?([^"\s]+)"?' -AllMatches).Matches) {
        $root = $match.Groups[1].Value
        Say "  serves $root (exists on M: now: $(Test-Path -LiteralPath $root))"
        if (-not $DryRun -and -not (Test-Path -LiteralPath $root)) { throw "Caddy root $root is missing on M:; nothing was switched." }
    }
    $caddyExe = if ($DryRun) { 'C:\caddy\caddy.exe' } else { 'M:\Caddy\caddy.exe' }
    # Caddy logs to stderr; Windows PowerShell would turn those lines into terminating errors.
    $ErrorActionPreference = 'Continue'
    $validation = & $caddyExe validate --config $candidate --adapter caddyfile 2>&1
    $validationCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $validation | Select-Object -Last 2 | ForEach-Object { Say "  validate: $($_.ToString())" }
    if ($validationCode -ne 0) { throw 'The M: Caddyfile did not validate; nothing was switched.' }
    if (-not $DryRun) {
        try {
            Stop-Service -Name caddy
            & sc.exe config caddy binPath= $newPath | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Could not point the Caddy service at M:.' }
            Start-Service -Name caddy
            if (-not (Wait-Until { (Test-Sites).ok } 60)) { $now = Test-Sites; throw "Sites did not recover from M: (lopeos=$($now.lopeos) accounts=$($now.accounts) portfolio=$($now.portfolio))." }
            $process = Get-CimInstance Win32_Process -Filter "Name='caddy.exe'" | Select-Object -First 1
            if ($process.ExecutablePath -notlike 'M:\Caddy\*') { throw "Caddy is running from $($process.ExecutablePath)." }
            Say "  Caddy is serving from M: ($($process.ExecutablePath))"
            $api = Wait-Until { (Get-Status 'https://benjaminsuitts.com/api/stress/status') -eq 200 } 45
            Say "  Portfolio API route reconnected: $api"
        } catch {
            $failure = $_
            Say "  FAILED: $failure. Switching Caddy back to C:."
            Stop-Service -Name caddy -ErrorAction SilentlyContinue
            & sc.exe config caddy binPath= $oldPath | Out-Null
            Start-Service -Name caddy
            $now = Test-Sites
            Say "  restored on C:: lopeos=$($now.lopeos) accounts=$($now.accounts) portfolio=$($now.portfolio)"
            throw $failure
        }
    }
}
$after = Test-Sites
Say "Sites after: lopeos=$($after.lopeos) accounts=$($after.accounts) portfolio=$($after.portfolio)"
Say "Free space: C: $([math]::Round((Get-Volume -DriveLetter C).SizeRemaining / 1GB, 2)) GiB, M: $([math]::Round((Get-Volume -DriveLetter M).SizeRemaining / 1GB, 2)) GiB"
