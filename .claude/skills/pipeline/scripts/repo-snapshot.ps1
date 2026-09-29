param(
    [string]$RepoPath = (Get-Location).Path,
    [string]$OutFile,
    [string]$CompareTo
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Import-Module (Join-Path $PSScriptRoot 'Pipeline.psm1') -Force
try {
    $snapshot = Get-RepoSnapshot -RepoPath $RepoPath
    if ($OutFile) { $snapshot | ConvertTo-Json | Set-Content -LiteralPath $OutFile -Encoding UTF8 }
    if ($CompareTo) {
        $before = Get-Content -LiteralPath $CompareTo -Raw -Encoding UTF8 | ConvertFrom-Json
        $changed = @(Compare-RepoSnapshot -Before $before -After $snapshot)
        [pscustomobject]@{ identical = ($changed.Count -eq 0); changed = $changed } | ConvertTo-Json -Compress
        if ($changed.Count -gt 0) { exit 1 }
        exit 0
    }
    $snapshot | ConvertTo-Json -Compress
    exit 0
}
catch {
    [Console]::Error.WriteLine("repo-snapshot failed: $($_.Exception.Message)")
    exit 2
}
