param(
    [Parameter(Mandatory = $true)][string]$DispatchId,
    [int]$WaitTimeoutMs = 900000
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Import-Module (Join-Path $PSScriptRoot 'Pipeline.psm1') -Force
try {
    Wait-PipelineWorkerDone -DispatchId $DispatchId -WaitTimeoutMs $WaitTimeoutMs | ConvertTo-Json -Depth 6 -Compress
    exit 0
}
catch {
    [Console]::Error.WriteLine("wait-worker failed: $($_.Exception.Message)")
    exit 1
}
