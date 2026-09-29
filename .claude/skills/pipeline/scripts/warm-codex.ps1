param(
    [Parameter(Mandatory = $true)][string]$Model,
    [Parameter(Mandatory = $true)][string]$Effort,
    [Parameter(Mandatory = $true)][string]$Title,
    [string]$ExpectedLabel,
    [int]$TimeoutSeconds = 180,
    [string]$HandleFile
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Import-Module (Join-Path $PSScriptRoot 'Pipeline.psm1') -Force
try {
    $result = Invoke-WarmCodex -Model $Model -Effort $Effort -Title $Title -ExpectedLabel $ExpectedLabel -TimeoutSeconds $TimeoutSeconds -HandleFile $HandleFile
    $result | ConvertTo-Json -Compress
    exit 0
}
catch {
    [Console]::Error.WriteLine("warm-codex failed: $($_.Exception.Message)")
    exit 1
}
