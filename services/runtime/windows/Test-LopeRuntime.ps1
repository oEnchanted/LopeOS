# End-to-end check of the public visitor workspace, the same path the desktop
# uses: create or resume a guest workspace, wait until it is ready, then read its
# disk usage and list its home. Reuses one smoke-test guest so repeated checks
# never use up visitor capacity.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SiteOrigin,
    [string]$StateDirectory = 'M:/LopeOS/runtime-host',
    [int]$TimeoutSeconds = 180
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force -Path $StateDirectory | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $StateDirectory /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
$cookieFile = Join-Path $StateDirectory 'smoke-cookie.txt'
$cookie = if (Test-Path $cookieFile) { (Get-Content -LiteralPath $cookieFile -Raw).Trim() } else { '' }

function Invoke-Runtime([string]$Method, [string]$Path, [string]$Body) {
    $request = [Net.HttpWebRequest]::Create("$SiteOrigin$Path")
    $request.Method = $Method; $request.Timeout = 30000; $request.Headers['Origin'] = $SiteOrigin
    if ($script:cookie) { $request.Headers['Cookie'] = $script:cookie }
    if ($Body) {
        $request.ContentType = 'application/json'
        $bytes = [Text.Encoding]::UTF8.GetBytes($Body); $request.ContentLength = $bytes.Length
        $stream = $request.GetRequestStream(); $stream.Write($bytes, 0, $bytes.Length); $stream.Close()
    }
    try { $response = $request.GetResponse() } catch [Net.WebException] { $response = $_.Exception.Response; if (-not $response) { throw "No response from $Path ($($_.Exception.Message))." } }
    $set = $response.Headers['Set-Cookie']
    if ($set -match '(__Host-lope-visitor|lope-visitor)=([^;,\s]+)') { $script:cookie = "$($Matches[1])=$($Matches[2])" }
    $reader = New-Object IO.StreamReader($response.GetResponseStream()); $text = $reader.ReadToEnd(); $reader.Close()
    $status = [int]$response.StatusCode; $response.Close()
    $json = $null; try { $json = $text | ConvertFrom-Json } catch {}
    if (-not $json) { throw "$Path returned HTTP $status without a JSON body (is the runtime behind Caddy running?)." }
    [pscustomobject]@{ Status = $status; Body = $json }
}

$visitor = Invoke-Runtime 'POST' '/api/visitor' '{}'
if ($visitor.Status -ne 200) { throw "Workspace creation returned HTTP $($visitor.Status): $($visitor.Body.error.message)" }
[IO.File]::WriteAllText($cookieFile, $script:cookie, [Text.UTF8Encoding]::new($false))
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ($visitor.Body.state -ne 'ready') {
    if ($visitor.Body.state -eq 'unavailable') { throw "The workspace could not start: $($visitor.Body.message)" }
    if ((Get-Date) -gt $deadline) { throw "The workspace stayed '$($visitor.Body.state)' for $TimeoutSeconds seconds." }
    Start-Sleep -Seconds 2
    $visitor = Invoke-Runtime 'GET' '/api/visitor'
    if ($visitor.Status -ne 200) { throw "Workspace status returned HTTP $($visitor.Status): $($visitor.Body.error.message)" }
}
$storage = Invoke-Runtime 'GET' '/api/fs/storage?path=%2F'
if ($storage.Status -ne 200 -or -not ($storage.Body.totalBytes -gt 0)) { throw "Disk usage returned HTTP $($storage.Status): $($storage.Body.error.message)" }
$list = Invoke-Runtime 'GET' '/api/fs/list?path=%2F'
if ($list.Status -ne 200) { throw "Listing the workspace home returned HTTP $($list.Status): $($list.Body.error.message)" }
Write-Output ("Visitor workspace is healthy: {0:N0} MiB of {1:N0} MiB free, {2} home entries." -f ($storage.Body.availableBytes / 1MB), ($storage.Body.totalBytes / 1MB), @($list.Body.entries).Count)
