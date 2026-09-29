param(
    [Parameter(Mandatory = $true)][string[]]$Allowed,
    [string]$RepoPath = (Get-Location).Path
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Import-Module (Join-Path $PSScriptRoot 'Pipeline.psm1') -Force
try {
    $violations = @(Get-OwnershipViolation -AllowedPaths $Allowed -RepoPath $RepoPath)
    [pscustomobject]@{ ok = ($violations.Count -eq 0); violations = $violations } | ConvertTo-Json -Compress
    if ($violations.Count -gt 0) { exit 1 }
    exit 0
}
catch {
    [Console]::Error.WriteLine("check-ownership failed: $($_.Exception.Message)")
    exit 2
}
