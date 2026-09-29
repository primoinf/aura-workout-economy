Set-StrictMode -Version 2.0

$script:ValidEfforts = @('low', 'medium', 'high', 'xhigh', 'max')

function Get-CodexStatusLabel {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Model,
        [Parameter(Mandatory = $true)][string]$Effort
    )
    $effortLower = $Effort.ToLowerInvariant()
    if ($Model -cnotmatch '^gpt-[0-9.]+-[a-z]+$') { throw "Unsupported Codex model id: $Model" }
    if ($script:ValidEfforts -notcontains $effortLower) { throw "Unsupported effort: $Effort" }
    $parts = $Model.Split('-')
    $tail = for ($i = 1; $i -lt $parts.Length; $i++) {
        $part = $parts[$i]
        $part.Substring(0, 1).ToUpperInvariant() + $part.Substring(1)
    }
    return ('GPT-' + ($tail -join '-') + ' ' + $effortLower)
}

function Find-CodexStatusLabel {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$ScreenText)
    $pattern = '(?m)^[ \t]*(GPT-[0-9.]+-[A-Za-z]+ (?:low|medium|high|xhigh|max))(?=[ \t]|\r?$)'
    $found = [regex]::Matches($ScreenText, $pattern)
    if ($found.Count -eq 0) { return $null }
    return $found[$found.Count - 1].Groups[1].Value
}

function Test-CodexWarmScreen {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$ScreenText)
    return [regex]::IsMatch($ScreenText, '(?m)^[ \t]*\S{1,3}[ \t]+WARM[ \t]*\r?$')
}
