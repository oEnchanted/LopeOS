# Read-only capacity check. No filenames, account names or volume labels are logged.
$ErrorActionPreference = 'Stop'
$volumes = @(Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | ForEach-Object {
    [ordered]@{ drive=([string]$_.DriveLetter + ':'); freeGiB=[Math]::Round($_.SizeRemaining / 1GB, 2); sizeGiB=[Math]::Round($_.Size / 1GB, 2) }
})
@{ fixedVolumes=$volumes; recommendedBrowserFreeGiB=20 } | ConvertTo-Json -Depth 4
