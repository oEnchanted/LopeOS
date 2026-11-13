# Install a reviewed copy outside the runner checkout. Publishes frontend only.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ReleasePath,
    [Parameter(Mandatory = $true)][string]$SiteOrigin,
    [string]$CaddyExe = 'C:\Caddy\caddy.exe',
    [string]$Caddyfile = 'C:\Caddy\Caddyfile',
    [string]$CaddyTemplate = 'C:\Caddy\Caddyfile.template',
    [string]$SharedAssetsPath = 'C:\LopeOS\shared\assets',
    [string]$ReleasesRoot = 'C:\LopeOS\releases',
    [switch]$Initialize
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this publisher on the Windows Caddy host.' }
$origin = [Uri]$SiteOrigin
if (-not $origin.IsAbsoluteUri -or $origin.Scheme -ne 'https' -or $origin.UserInfo -or $origin.GetLeftPart([UriPartial]::Authority) -cne $SiteOrigin) {
    throw 'SiteOrigin must be the exact HTTPS origin, without a trailing slash.'
}

function Invoke-Caddy([string[]]$CaddyArguments) {
    & $CaddyExe @CaddyArguments
    if ($LASTEXITCODE -ne 0) { throw "Caddy $($CaddyArguments[0]) failed with exit code $LASTEXITCODE." }
}

function Write-AtomicConfig([byte[]]$Bytes) {
    $temporary = "$Caddyfile.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllBytes($temporary, $Bytes)
        if (Test-Path -LiteralPath $Caddyfile) { [IO.File]::Replace($temporary, $Caddyfile, $null) }
        else { [IO.File]::Move($temporary, $Caddyfile) }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

$release = (Resolve-Path -LiteralPath $ReleasePath).Path.TrimEnd('\')
$releases = (Resolve-Path -LiteralPath $ReleasesRoot).Path.TrimEnd('\')
if (-not $release.StartsWith($releases + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'ReleasePath must be inside ReleasesRoot.' }
foreach ($path in @($release, $releases, $Caddyfile, $CaddyTemplate, $SharedAssetsPath)) {
    if ($path -match '["\r\n{}]') { throw 'Deployment paths cannot contain quotes, newlines, or Caddy placeholders.' }
}
if (Split-Path -Leaf $SharedAssetsPath.TrimEnd('\', '/') | Where-Object { $_ -ne 'assets' }) { throw 'SharedAssetsPath must end in assets.' }
foreach ($path in @($CaddyExe, $CaddyTemplate, (Join-Path $release 'index.html'), (Join-Path $release 'lope-sw.js'), (Join-Path $release '__lope/version.json'))) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required deployment file is missing: $path" }
}
# A release must be ordinary extracted files, never a link to live data or code.
foreach ($item in @((Get-Item -LiteralPath $releases), (Get-Item -LiteralPath $release)) + @(Get-ChildItem -LiteralPath $release -Recurse -Force)) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Release contains a filesystem link: $($item.FullName)" }
}

$manifest = Get-Content -LiteralPath (Join-Path $release '__lope/version.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 1 -or -not $manifest.build -or -not $manifest.version -or -not $manifest.assets.Count) { throw 'Invalid release manifest.' }
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
[long]$total = 0
foreach ($asset in $manifest.assets) {
    if ($asset.url -notmatch '^/[^/?#]' -or $asset.url -match '[?#]' -or $asset.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid release asset.' }
    $relative = [Uri]::UnescapeDataString($asset.url).Substring(1)
    if ($relative -match '[\\:]|(^|/)\.{1,2}(/|$)' -or -not $seen.Add($relative)) { throw 'Invalid or duplicate release asset path.' }
    $file = [IO.Path]::GetFullPath((Join-Path $release $relative))
    if (-not $file.StartsWith($release + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing release asset: $relative" }
    $length = (Get-Item -LiteralPath $file).Length
    if ($length -ne $asset.size -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $asset.sha256) { throw "Release asset failed verification: $relative" }
    $total += $length
}
if (-not $seen.Contains('index.html') -or $total -ne $manifest.totalBytes) { throw 'Release manifest is incomplete.' }

$template = Get-Content -LiteralPath $CaddyTemplate -Raw
foreach ($placeholder in @('__LOPE_SITE_HOST__', '__LOPE_WEB_ROOT__', '__LOPE_ASSET_ROOT__')) {
    if (-not $template.Contains($placeholder)) { throw "Caddy template is missing $placeholder." }
}
$assetRoot = [IO.Path]::GetFullPath((Split-Path -Parent $SharedAssetsPath)).Replace('\', '/')
$config = $template.Replace('__LOPE_SITE_HOST__', $origin.Authority).Replace('__LOPE_WEB_ROOT__', $release.Replace('\', '/')).Replace('__LOPE_ASSET_ROOT__', $assetRoot)
$utf8 = [Text.UTF8Encoding]::new($false)
$candidate = "$Caddyfile.$([Guid]::NewGuid().ToString('N')).candidate"
$lock = $null
try {
    # Also serialize manual rollbacks against Actions deployments.
    $lock = [IO.File]::Open("$Caddyfile.deploy.lock", [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $exists = Test-Path -LiteralPath $Caddyfile
    if ($Initialize -and $exists) { throw 'Initialize requires a new Caddyfile; use a normal deployment for an existing installation.' }
    if (-not $Initialize -and -not $exists) { throw 'Initialize the Caddy configuration and start its service first.' }

    # Add content-addressed assets before switching the live release. Never purge.
    $sourceAssets = Join-Path $release 'assets'
    if (-not (Test-Path -LiteralPath $sourceAssets -PathType Container)) { throw 'Release assets directory is missing.' }
    New-Item -ItemType Directory -Path $SharedAssetsPath -Force | Out-Null
    foreach ($source in Get-ChildItem -LiteralPath $sourceAssets -File -Recurse) {
        $relative = $source.FullName.Substring($sourceAssets.Length + 1)
        if (-not $seen.Contains('assets/' + $relative.Replace('\', '/'))) { throw "Asset is absent from the release manifest: $relative" }
        $target = Join-Path $SharedAssetsPath $relative
        if (Test-Path -LiteralPath $target) {
            if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash) { throw "An existing immutable asset has different content: $relative" }
        } else {
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            $temporaryAsset = "$target.$([Guid]::NewGuid().ToString('N')).tmp"
            try {
                Copy-Item -LiteralPath $source.FullName -Destination $temporaryAsset
                Move-Item -LiteralPath $temporaryAsset -Destination $target
            } finally {
                if (Test-Path -LiteralPath $temporaryAsset) { Remove-Item -LiteralPath $temporaryAsset -Force }
            }
        }
    }
    [IO.File]::WriteAllText($candidate, $config, $utf8)
    Invoke-Caddy -CaddyArguments @('validate', '--config', $candidate, '--adapter', 'caddyfile')
    if ($Initialize) {
        Write-AtomicConfig -Bytes $utf8.GetBytes($config)
        Write-Output "Initialized $Caddyfile. Start Caddy and verify $SiteOrigin/__lope/version.json before enabling deployments."
    } else {
        $previous = [IO.File]::ReadAllBytes($Caddyfile)
        try {
            Write-AtomicConfig -Bytes $utf8.GetBytes($config)
            Invoke-Caddy -CaddyArguments @('reload', '--config', $Caddyfile, '--adapter', 'caddyfile')
            $verified = $false
            for ($attempt = 0; $attempt -lt 5; $attempt++) {
                try {
                    $response = Invoke-WebRequest -UseBasicParsing -Uri "$SiteOrigin/__lope/version.json?deploy=$([Guid]::NewGuid().ToString('N'))" -Headers @{ 'Cache-Control' = 'no-cache' } -TimeoutSec 10
                    $live = $response.Content | ConvertFrom-Json
                    if ($live.build -cne $manifest.build -or $live.version -cne $manifest.version) { throw 'The public site is serving a different release.' }
                    $page = Invoke-WebRequest -UseBasicParsing -Uri "$SiteOrigin/" -Headers @{ 'Cache-Control' = 'no-cache' } -TimeoutSec 10
                    if ($page.StatusCode -ne 200) { throw 'The public desktop did not respond successfully.' }
                    $accountResponse = Invoke-WebRequest -UseBasicParsing -Uri "$SiteOrigin/api/accounts/session" -TimeoutSec 10
                    $accountSession = $accountResponse.Content | ConvertFrom-Json
                    if ($accountResponse.Headers['Content-Type'] -notmatch 'application/json' -or $accountSession.quotaBytes -ne 1000000000 -or $null -ne $accountSession.account) {
                        throw 'The public account route did not return a valid anonymous session.'
                    }
                    $verified = $true
                    break
                } catch {
                    if ($attempt -eq 4) { throw }
                    Start-Sleep -Seconds 2
                }
            }
            if (-not $verified) { throw 'Release verification failed.' }
            [IO.File]::WriteAllBytes("$Caddyfile.previous", $previous)
            Write-Output "Published LopeOS $($manifest.version), build $($manifest.build), at $SiteOrigin."
        } catch {
            $failure = $_
            Write-AtomicConfig -Bytes $previous
            try { Invoke-Caddy -CaddyArguments @('reload', '--config', $Caddyfile, '--adapter', 'caddyfile') }
            catch { throw "Deployment failed and Caddy rollback reload also failed. Previous config is restored on disk. Deployment: $failure; rollback: $_" }
            throw "Deployment failed; restored the previous Caddy configuration. $failure"
        }
    }
} finally {
    if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Force }
    if ($null -ne $lock) { $lock.Dispose() }
}
