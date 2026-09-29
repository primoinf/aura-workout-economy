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

function Get-DefaultOrcaExe {
    return (Join-Path $env:LOCALAPPDATA 'Programs\orca\resources\bin\orca.exe')
}

function Get-OptionalProperty {
    param($InputObject, [string]$Name)
    if ($null -eq $InputObject) { return $null }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Invoke-Orca {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$OrcaExe,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $output = & $OrcaExe @Arguments 2>$null | Out-String
    return $output
}

function ConvertFrom-OrcaJson {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
    $start = $Text.IndexOf('{')
    if ($start -lt 0) { throw "Orca returned no JSON: $Text" }
    return ($Text.Substring($start) | ConvertFrom-Json)
}

function Read-OrcaScreen {
    param([string]$OrcaExe, [string]$Handle)
    return (Invoke-Orca -OrcaExe $OrcaExe -Arguments @('terminal', 'read', '--terminal', $Handle, '--limit', '400'))
}

function Close-OrcaTerminal {
    param([string]$OrcaExe, [string]$Handle)
    try { Invoke-Orca -OrcaExe $OrcaExe -Arguments @('terminal', 'close', '--terminal', $Handle, '--json') | Out-Null } catch { }
}

function Invoke-WarmCodex {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Model,
        [Parameter(Mandatory = $true)][string]$Effort,
        [Parameter(Mandatory = $true)][string]$Title,
        [string]$ExpectedLabel,
        [string]$OrcaExe = (Get-DefaultOrcaExe),
        [int]$TimeoutSeconds = 180,
        [int]$PollSeconds = 5
    )
    $computed = Get-CodexStatusLabel -Model $Model -Effort $Effort
    if (-not $ExpectedLabel) { $ExpectedLabel = $computed }
    $effortLower = $Effort.ToLowerInvariant()
    $command = "codex -m $Model -c model_reasoning_effort=$effortLower --dangerously-bypass-approvals-and-sandbox"
    $created = ConvertFrom-OrcaJson (Invoke-Orca -OrcaExe $OrcaExe -Arguments @('terminal', 'create', '--worktree', 'active', '--shell', 'powershell.exe', '--title', $Title, '--command', $command, '--json'))
    if (-not $created.ok) { throw "orca terminal create failed: $((Get-OptionalProperty $created 'error').message)" }
    $handle = $created.result.terminal.handle
    $attempts = [Math]::Max(1, [int][Math]::Ceiling($TimeoutSeconds / [double]$PollSeconds))
    try {
        $label = $null
        for ($i = 0; $i -lt $attempts -and -not $label; $i++) {
            $label = Find-CodexStatusLabel -ScreenText (Read-OrcaScreen -OrcaExe $OrcaExe -Handle $handle)
            if (-not $label) { Start-Sleep -Seconds $PollSeconds }
        }
        if (-not $label) { throw "timed out waiting for the Codex status line in $handle" }
        if ($label -cne $ExpectedLabel) { throw "status mismatch in ${handle}: expected '$ExpectedLabel', got '$label'" }
        $sent = ConvertFrom-OrcaJson (Invoke-Orca -OrcaExe $OrcaExe -Arguments @('terminal', 'send', '--terminal', $handle, '--text', 'Reply with exactly: WARM', '--enter', '--json'))
        if (-not $sent.ok) { throw "orca terminal send failed: $((Get-OptionalProperty $sent 'error').message)" }
        $warm = $false
        $screen = ''
        for ($i = 0; $i -lt $attempts -and -not $warm; $i++) {
            $screen = Read-OrcaScreen -OrcaExe $OrcaExe -Handle $handle
            $warm = Test-CodexWarmScreen -ScreenText $screen
            if (-not $warm) { Start-Sleep -Seconds $PollSeconds }
        }
        if (-not $warm) { throw "timed out waiting for the WARM reply in $handle" }
        $final = Find-CodexStatusLabel -ScreenText $screen
        if ($final -cne $ExpectedLabel) { throw "status mismatch after warm-up in ${handle}: expected '$ExpectedLabel', got '$final'" }
        return [pscustomobject]@{ handle = $handle; statusLine = $final }
    }
    catch {
        Close-OrcaTerminal -OrcaExe $OrcaExe -Handle $handle
        throw
    }
}
