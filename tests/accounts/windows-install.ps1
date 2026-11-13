$ErrorActionPreference = 'Stop'
# Local Service must not depend on access to the runner user's private profile.
$root = Join-Path $env:ProgramData ('lope-accounts-test-' + [Guid]::NewGuid().ToString('N'))
$taskName = 'LopeOS test ' + [Guid]::NewGuid().ToString('N')
$install = Join-Path $root 'service'
$data = Join-Path $root 'data'
$parameters = @{ SourcePath = "$PSScriptRoot/../../services/accounts"; SiteOrigin = 'https://test.lopeos.invalid'; NodeExe = (Get-Command node).Source; InstallPath = $install; DataPath = $data; TaskName = $taskName; Port = 14176 }
try {
    & "$PSScriptRoot/../../services/accounts/windows/Install-LopeAccounts.ps1" @parameters
    $headers = @{ Origin = $parameters.SiteOrigin }
    $credentials = @{ accountName = 'deployment_test'; displayName = 'Deployment Test'; password = 'temporary-test-password-123' } | ConvertTo-Json
    $created = Invoke-RestMethod http://127.0.0.1:14176/api/accounts/register -Method Post -ContentType application/json -Headers $headers -Body $credentials
    if (-not $created.account.id) { throw 'Account creation failed.' }
    & "$PSScriptRoot/../../services/accounts/windows/Install-LopeAccounts.ps1" @parameters
    $signedIn = Invoke-RestMethod http://127.0.0.1:14176/api/accounts/login -Method Post -ContentType application/json -Headers $headers -Body $credentials
    if ($signedIn.account.id -ne $created.account.id) { throw 'Account was not preserved across deployment.' }
    $task = Get-ScheduledTask -TaskName $taskName
    if ($task.State -ne 'Running') { throw 'Account task stopped when the installer exited.' }
    Write-Output 'Windows account installation, graceful replacement, persistent data, and sign-in passed.'
} finally {
    if (Test-Path $install) { [IO.File]::WriteAllText((Join-Path $install 'stop'), 'stop') }
    Start-Sleep -Seconds 3
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    if (Test-Path $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
