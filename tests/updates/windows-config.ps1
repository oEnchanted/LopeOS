$ErrorActionPreference = 'Stop'
$scriptPath = "$PSScriptRoot/../../services/runtime/windows/Deploy-LopeFrontend.ps1"
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$null)
$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Write-AtomicConfig' }, $true)
. ([scriptblock]::Create($function.Extent.Text))
$root = Join-Path $env:TEMP ('lope-config-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$Caddyfile = Join-Path $root 'Caddyfile'
try {
    foreach ($content in @('initial', 'replacement', 'rollback')) {
        Write-AtomicConfig -Bytes ([Text.Encoding]::UTF8.GetBytes($content))
        if ([IO.File]::ReadAllText($Caddyfile) -ne $content) { throw 'Configuration replacement failed.' }
        if (@(Get-ChildItem $root).Count -ne 1) { throw 'Temporary files were not removed.' }
    }
    Write-Output 'Windows configuration initialization, replacement, and rollback passed.'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
