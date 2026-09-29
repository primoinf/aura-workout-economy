param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][ValidateSet('verifier', 'verdict')][string]$Kind
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Pipeline.psm1') -Force
try {
    Get-ReportDecision -Path $Path -Kind $Kind
    exit 0
}
catch {
    [Console]::Error.WriteLine("report-decision failed: $($_.Exception.Message)")
    exit 1
}
