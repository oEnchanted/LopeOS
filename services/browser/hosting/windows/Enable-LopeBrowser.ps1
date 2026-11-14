[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SiteOrigin,
    [string]$CaddyExe = 'C:/Caddy/caddy.exe',
    [string]$Caddyfile = 'C:/Caddy/Caddyfile',
    [string]$Template = 'C:/Caddy/Caddyfile.template',
    [string]$NodeExe = (Get-Command node -ErrorAction Stop).Source
)
$ErrorActionPreference = 'Stop'
$origin = [Uri]$SiteOrigin
if ($origin.Scheme -ne 'https' -or $origin.GetLeftPart([UriPartial]::Authority) -ne $SiteOrigin) { throw 'Use the exact HTTPS site origin.' }
$health = Invoke-RestMethod 'http://127.0.0.1:4177/api/browser/health' -Headers @{Host=$origin.Authority} -TimeoutSec 10
if ($health.service -ne 'lope-browser-gateway') { throw 'Verify the browser gateway before enabling Caddy.' }
$id = [Guid]::NewGuid().ToString('N')
$candidate = "$Caddyfile.browser-$id"
$templateCandidate = "$Template.browser-$id"
$backup = "$Caddyfile.before-browser-$id"
$helper = Join-Path $PSScriptRoot '../caddy.mjs'
try {
    & $NodeExe $helper $Caddyfile $SiteOrigin $candidate
    if ($LASTEXITCODE -ne 0) { throw 'The live Caddy browser route could not be prepared.' }
    & $NodeExe $helper $Template $SiteOrigin $templateCandidate
    if ($LASTEXITCODE -ne 0) { throw 'The persistent Caddy browser route could not be prepared.' }
    & $CaddyExe validate --config $candidate --adapter caddyfile
    if ($LASTEXITCODE -ne 0) { throw 'Caddy rejected the browser configuration; the live site is unchanged.' }
    # Same-directory atomic replacement works in Windows PowerShell and preserves the old file.
    [IO.File]::Replace($candidate, $Caddyfile, $backup)
    try {
        & $CaddyExe reload --config $Caddyfile --adapter caddyfile
        if ($LASTEXITCODE -ne 0) { throw 'Caddy reload failed.' }
        $public = Invoke-RestMethod "$SiteOrigin/api/browser/health" -TimeoutSec 15
        if ($public.service -ne 'lope-browser-gateway') { throw 'The public browser gateway did not pass verification.' }
        [IO.File]::Replace($templateCandidate, $Template, "$Template.before-browser-$id")
    } catch {
        [IO.File]::Replace($backup, $Caddyfile, "$Caddyfile.failed-browser-$id")
        & $CaddyExe reload --config $Caddyfile --adapter caddyfile
        throw
    }
    Write-Output 'Browser routing is enabled; accounts, other sites and release assets were preserved.'
} finally {
    Remove-Item -LiteralPath $candidate, $templateCandidate -Force -ErrorAction SilentlyContinue
}
