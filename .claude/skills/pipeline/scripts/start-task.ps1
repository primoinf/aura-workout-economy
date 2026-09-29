param(
    [Parameter(Mandatory = $true)][ValidateSet('worker', 'verifier', 'verdict')][string]$Role,
    [Parameter(Mandatory = $true)][string]$RunDir,
    [Parameter(Mandatory = $true)][int]$Round,
    [string]$FindingsPath,
    [string]$Terminal,
    [string]$BriefSha256
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Import-Module (Join-Path $PSScriptRoot 'Pipeline.psm1') -Force
try {
    Start-PipelineTask -Role $Role -RunDir $RunDir -Round $Round -FindingsPath $FindingsPath -Terminal $Terminal -ExpectedBriefSha256 $BriefSha256 | ConvertTo-Json -Compress
    exit 0
}
catch {
    [Console]::Error.WriteLine("start-task failed: $($_.Exception.Message)")
    exit 1
}
