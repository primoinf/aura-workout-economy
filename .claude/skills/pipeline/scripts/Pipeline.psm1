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

function Get-OrcaMessagePayload {
    param($Message)
    $payload = Get-OptionalProperty $Message 'payload'
    if ($payload -is [string]) { return ($payload | ConvertFrom-Json) }
    return $payload
}

function Test-ExpectedWorkerDone {
    param($Message, [string]$DispatchId)
    if ((Get-OptionalProperty $Message 'type') -ne 'worker_done') { return $false }
    $payload = Get-OrcaMessagePayload $Message
    return ((Get-OptionalProperty $payload 'dispatchId') -eq $DispatchId)
}

function Wait-PipelineWorkerDone {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DispatchId,
        [string]$OrcaExe = (Get-DefaultOrcaExe),
        [int]$WaitTimeoutMs = 900000,
        [int]$MaxEmptyWaits = 3
    )
    $empty = 0
    while ($true) {
        $reply = ConvertFrom-OrcaJson (Invoke-Orca -OrcaExe $OrcaExe -Arguments @('orchestration', 'check', '--wait', '--types', 'worker_done,escalation,question', '--timeout-ms', "$WaitTimeoutMs", '--json'))
        if (-not $reply.ok) { throw "orca orchestration check failed: $((Get-OptionalProperty $reply 'error').message)" }
        $result = $reply.result
        $messages = @(@(Get-OptionalProperty $result 'messages') | Where-Object { $null -ne $_ })
        if ((Get-OptionalProperty $result 'timedOut') -or $messages.Count -eq 0) {
            $empty++
            if ($empty -ge $MaxEmptyWaits) {
                return [pscustomobject]@{ kind = 'stalled'; dispatchId = $DispatchId; deliveryId = $null; outcome = $null; body = $null; messages = @() }
            }
            continue
        }
        $empty = 0
        $deliveryId = Get-OptionalProperty $result 'deliveryId'
        $expected = @($messages | Where-Object { Test-ExpectedWorkerDone -Message $_ -DispatchId $DispatchId })
        if ($expected.Count -eq 1 -and $messages.Count -eq 1) {
            $ack = ConvertFrom-OrcaJson (Invoke-Orca -OrcaExe $OrcaExe -Arguments @('orchestration', 'check', '--ack', $deliveryId, '--json'))
            if (-not $ack.ok) { throw "orca orchestration ack failed: $((Get-OptionalProperty $ack 'error').message)" }
            $payload = Get-OrcaMessagePayload $expected[0]
            return [pscustomobject]@{ kind = 'done'; dispatchId = $DispatchId; deliveryId = $deliveryId; outcome = (Get-OptionalProperty $payload 'outcome'); body = (Get-OptionalProperty $expected[0] 'body'); messages = $messages }
        }
        return [pscustomobject]@{ kind = 'attention'; dispatchId = $DispatchId; deliveryId = $deliveryId; outcome = $null; body = $null; messages = $messages }
    }
}

function Invoke-Git {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $previous = $null
    try { $previous = [Console]::OutputEncoding; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
    try {
        $output = & git -C $RepoPath @Arguments 2>$null
        if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
        return ($output | Out-String)
    }
    finally {
        if ($null -ne $previous) { try { [Console]::OutputEncoding = $previous } catch { } }
    }
}

function Split-NulList {
    param([string]$Text)
    return @($Text.Split([char]0) | Where-Object { $_.Trim().Length -gt 0 })
}

function Get-ChangedPath {
    [CmdletBinding()]
    param([string]$RepoPath = (Get-Location).Path)
    $entries = @(Split-NulList (Invoke-Git -RepoPath $RepoPath -Arguments @('status', '--porcelain=v1', '-uall', '-z')))
    $paths = New-Object System.Collections.Generic.List[string]
    $i = 0
    while ($i -lt $entries.Count) {
        $entry = $entries[$i]
        $code = $entry.Substring(0, 2)
        $paths.Add($entry.Substring(3))
        if ($code[0] -eq 'R' -or $code[0] -eq 'C') {
            $i++
            $paths.Add($entries[$i])
        }
        $i++
    }
    return $paths.ToArray()
}

function ConvertTo-RepoRelativePath {
    param([string]$Path)
    $p = $Path.Trim().Replace('\', '/')
    while ($p.StartsWith('./')) { $p = $p.Substring(2) }
    return $p
}

function Get-OwnershipViolation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string[]]$AllowedPaths,
        [string]$RepoPath = (Get-Location).Path
    )
    $allowed = @($AllowedPaths | ForEach-Object { $_ -split ',' } | Where-Object { $_.Trim().Length -gt 0 } | ForEach-Object { ConvertTo-RepoRelativePath $_ })
    $violations = New-Object System.Collections.Generic.List[string]
    foreach ($changed in (Get-ChangedPath -RepoPath $RepoPath)) {
        $path = ConvertTo-RepoRelativePath $changed
        $ok = $false
        foreach ($entry in $allowed) {
            if ($entry.EndsWith('/')) {
                if ($path.StartsWith($entry, [System.StringComparison]::Ordinal)) { $ok = $true }
            }
            elseif ($path -ceq $entry) { $ok = $true }
        }
        if (-not $ok) { $violations.Add($path) }
    }
    return $violations.ToArray()
}

function Get-Sha256Hex {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Get-RepoSnapshot {
    [CmdletBinding()]
    param([string]$RepoPath = (Get-Location).Path)
    $head = (Invoke-Git -RepoPath $RepoPath -Arguments @('rev-parse', 'HEAD')).Trim()
    $status = (Invoke-Git -RepoPath $RepoPath -Arguments @('status', '--porcelain=v1', '-uall')).Trim()
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        Invoke-Git -RepoPath $RepoPath -Arguments @('diff', 'HEAD', '--binary', "--output=$tmp") | Out-Null
        $diffSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash.ToLowerInvariant()
    }
    finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    $untracked = @(Split-NulList (Invoke-Git -RepoPath $RepoPath -Arguments @('ls-files', '--others', '--exclude-standard', '-z')) | Sort-Object)
    $lines = foreach ($u in $untracked) {
        $full = Join-Path $RepoPath $u
        if (Test-Path -LiteralPath $full -PathType Leaf) { $h = (Get-FileHash -Algorithm SHA256 -LiteralPath $full).Hash.ToLowerInvariant() } else { $h = 'missing' }
        "$u`t$h"
    }
    $untrackedSha = Get-Sha256Hex ([System.Text.Encoding]::UTF8.GetBytes((@($lines) -join "`n")))
    return [pscustomobject]@{ head = $head; status = $status; diffSha256 = $diffSha; untrackedSha256 = $untrackedSha }
}

function Compare-RepoSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Before,
        [Parameter(Mandatory = $true)]$After
    )
    $changed = New-Object System.Collections.Generic.List[string]
    foreach ($name in @('head', 'status', 'diffSha256', 'untrackedSha256')) {
        if ([string](Get-OptionalProperty $Before $name) -cne [string](Get-OptionalProperty $After $name)) { $changed.Add($name) }
    }
    return $changed.ToArray()
}

function Get-DefaultRolesDir {
    return (Join-Path (Split-Path -Parent $PSScriptRoot) 'roles')
}

function New-PipelineTaskSpec {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('worker', 'verifier', 'verdict')][string]$Role,
        [Parameter(Mandatory = $true)][string]$RunDir,
        [Parameter(Mandatory = $true)][int]$Round,
        [string]$FindingsPath,
        [string]$RolesDir = (Get-DefaultRolesDir)
    )
    $runDirNorm = $RunDir.Replace('\', '/').TrimEnd('/')
    $briefPath = Join-Path $RunDir 'brief.md'
    if (-not (Test-Path -LiteralPath $briefPath)) { throw "brief not found: $briefPath" }
    $rolePath = Join-Path $RolesDir "$Role.md"
    if (-not (Test-Path -LiteralPath $rolePath)) { throw "role file not found: $rolePath" }
    $roleText = (Get-Content -LiteralPath $rolePath -Raw -Encoding UTF8).Replace('{RUN_DIR}', $runDirNorm).Replace('{ROUND}', "$Round")
    $brief = Get-Content -LiteralPath $briefPath -Raw -Encoding UTF8
    $inputs = New-Object System.Collections.Generic.List[string]
    if ($Role -eq 'worker') {
        if ($Round -gt 1) {
            if (-not $FindingsPath) { throw 'FindingsPath is required for worker rounds after the first' }
            $inputs.Add('Findings to address: ' + $FindingsPath.Replace('\', '/'))
        }
    }
    else {
        $inputs.Add("Diff: $runDirNorm/diff-r$Round.patch")
        $inputs.Add("Untracked files list: $runDirNorm/untracked-r$Round.txt")
        if ($Role -eq 'verdict') { $inputs.Add("Verifier report: $runDirNorm/verifier-r$Round.md") }
    }
    if ($inputs.Count -eq 0) { $inputs.Add('None') }
    $header = "PIPELINE ROLE: $($Role.ToUpperInvariant())  RUN DIR: $runDirNorm  ROUND: $Round"
    $spec = $header + "`n`n" + $roleText.Trim() + "`n`n=== BRIEF ===`n" + $brief.Trim() + "`n`n=== ROUND INPUTS ===`n" + ($inputs -join "`n") + "`n"
    return $spec.Replace('"', "'")
}

function Get-ReportDecision {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet('verifier', 'verdict')][string]$Kind
    )
    if (-not (Test-Path -LiteralPath $Path)) { throw "report not found: $Path" }
    $first = Get-Content -LiteralPath $Path -Encoding UTF8 -TotalCount 1
    if ($null -eq $first) { $first = '' }
    $first = ([string]$first).TrimStart([char]0xFEFF).Trim()
    if ($Kind -eq 'verifier') { $pattern = '^RESULT: (PASS|FAIL)$' } else { $pattern = '^VERDICT: (APPROVE|CHANGES_REQUESTED)$' }
    $match = [regex]::Match($first, $pattern)
    if (-not $match.Success) { throw "invalid $Kind report header in ${Path}: '$first'" }
    return $match.Groups[1].Value
}

function Start-PipelineTask {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('worker', 'verifier', 'verdict')][string]$Role,
        [Parameter(Mandatory = $true)][string]$RunDir,
        [Parameter(Mandatory = $true)][int]$Round,
        [string]$FindingsPath,
        [string]$Terminal,
        [string]$OrcaExe = (Get-DefaultOrcaExe),
        [string]$RolesDir = (Get-DefaultRolesDir)
    )
    if ($Role -ne 'verdict' -and -not $Terminal) { throw "Terminal is required for the $Role role" }
    $spec = New-PipelineTaskSpec -Role $Role -RunDir $RunDir -Round $Round -FindingsPath $FindingsPath -RolesDir $RolesDir
    $title = "$Role-$(Split-Path -Leaf $RunDir)-r$Round"
    if ($Role -eq 'verdict') {
        $startArgs = @('orchestration', 'worker-start', '--spec', $spec, '--task-title', $title, '--worktree', 'current', '--agent', 'claude', '--model', 'claude-opus-5-5', '--effort', 'max', '--timeout-ms', '180000', '--json')
    }
    else {
        $createdText = Invoke-Orca -OrcaExe $OrcaExe -Arguments @('orchestration', 'task-create', '--spec', $spec, '--task-title', $title, '--json')
        $created = ConvertFrom-OrcaJson $createdText
        if (-not $created.ok) { throw "orca task-create failed: $((Get-OptionalProperty $created 'error').message)" }
        $taskMatch = [regex]::Match($createdText, '"id"\s*:\s*"(task_[^"]+)"')
        if (-not $taskMatch.Success) { throw "orca task-create returned no task id: $createdText" }
        $startArgs = @('orchestration', 'worker-start', '--task', $taskMatch.Groups[1].Value, '--worktree', 'current', '--terminal', $Terminal, '--timeout-ms', '120000', '--json')
    }
    $receipt = ConvertFrom-OrcaJson (Invoke-Orca -OrcaExe $OrcaExe -Arguments $startArgs)
    if (-not $receipt.ok) { throw "orca worker-start failed: $((Get-OptionalProperty $receipt 'error').message)" }
    $result = $receipt.result
    $state = Get-OptionalProperty $result 'state'
    $stage = Get-OptionalProperty $result 'stage'
    $dispatchId = Get-OptionalProperty $result 'dispatchId'
    if ($state -eq 'failed' -or $state -eq 'outcome_unknown') {
        $failedStage = Get-OptionalProperty $result 'failedStage'
        if (-not $failedStage) { $failedStage = $stage }
        throw "worker-start failed at ${failedStage}: $(Get-OptionalProperty $result 'recovery')"
    }
    $effective = Get-OptionalProperty (Get-OptionalProperty $result 'launch') 'effective'
    $effectiveModel = Get-OptionalProperty $effective 'model'
    $effectiveEffort = Get-OptionalProperty $effective 'effort'
    if ($Role -eq 'verdict' -and ($effectiveModel -cne 'claude-opus-5-5' -or $effectiveEffort -cne 'max')) {
        throw "launch mismatch for ${dispatchId}: effective $effectiveModel/$effectiveEffort"
    }
    return [pscustomobject]@{ role = $Role; round = $Round; taskId = (Get-OptionalProperty $result 'taskId'); dispatchId = $dispatchId; stage = $stage; effectiveModel = $effectiveModel; effectiveEffort = $effectiveEffort }
}
