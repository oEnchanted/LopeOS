# Read-only diagnostics. Output is restricted to prerequisites, versions and service health.
$ErrorActionPreference = 'Continue'
$result = [ordered]@{
    wslAvailable = [bool](Get-Command wsl.exe -ErrorAction SilentlyContinue)
    dockerAvailable = [bool](Get-Command docker -ErrorAction SilentlyContinue)
    nodeAvailable = [bool](Get-Command node -ErrorAction SilentlyContinue)
}
if ($result.wslAvailable) {
    $result.wslVersion = ((& wsl.exe --version 2>&1) -join "`n").Replace("`0", '')
    $result.ubuntuPrerequisites = ((& wsl.exe --distribution Ubuntu --user root --exec sh -c 'command -v docker; docker info --format "{{.OperatingSystem}}"; command -v systemctl; id -u' 2>&1) -join "`n").Replace("`0", '')
}
foreach ($entry in @(@{name='accounts';port=4176;path='/api/accounts/session'}, @{name='browser';port=4177;path='/api/browser/health'})) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$($entry.port)$($entry.path)" -UseBasicParsing -TimeoutSec 10
        $result[$entry.name] = [int]$response.StatusCode
    } catch { $result[$entry.name] = 'Unavailable' }
}
$result | ConvertTo-Json -Depth 4
