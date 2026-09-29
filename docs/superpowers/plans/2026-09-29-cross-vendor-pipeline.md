# Cross-Vendor Agent Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a repo-local `/pipeline` skill that has the Claude Opus 5.5 xhigh Architect drive Codex GPT-6 Luna max (Worker), Codex GPT-6 Sol xhigh (Independent Verifier) and a fresh Claude Opus 5.5 max session (Final Verdict) through Orca, plus a Sonnet 5.5 medium subagent for small tasks.

**Architecture:** One PowerShell module (`Pipeline.psm1`) holds every deterministic step: Codex warm launch and status-line checks, task dispatch, waiting for `worker_done`, repository snapshots, ownership checks, spec composition and report parsing. Thin entry scripts expose it to the Architect, whose shell state does not persist between tool calls. Markdown role files and `SKILL.md` carry the judgment parts, and repo config (`settings.json`, `AGENTS.md`, `CLAUDE.md`) wires the routing.

**Tech Stack:** Windows PowerShell 5.1, Pester 3.4.0, git 2.54, Orca 1.4.216 CLI, Codex CLI 0.158.0, Claude Code.

**Spec:** `docs/superpowers/specs/2026-09-29-cross-vendor-pipeline-design.md`

## Global Constraints

- Roles, models and efforts are fixed:
  - Architect: `claude-opus-5-5` / `xhigh`
  - Worker: `gpt-6-luna` / `max`
  - Verifier: `gpt-6-sol` / `xhigh`
  - Final Verdict: `claude-opus-5-5` / `max`
  - sonnet-small: `claude-sonnet-5-5` / `medium`
- At most 2 fix rounds after the first Worker attempt (3 Worker dispatches in total).
- Never push, merge or open pull requests. Commit only after `VERDICT: APPROVE`, with the trailers `Pipeline-Run: <run_id>`, `Verdict: APPROVE` and `Verifier: PASS`.
- Repository-local configuration only. Do not modify `~/.claude` or `~/.codex`.
- Orca CLI path: `%LOCALAPPDATA%\Programs\orca\resources\bin\orca.exe` (not on `PATH`).
- Codex roles launch as `codex -m <model> -c model_reasoning_effort=<effort> --dangerously-bypass-approvals-and-sandbox` in an Orca terminal, are warmed with `Reply with exactly: WARM`, and are then dispatched with `worker-start --task <id> --worktree current --terminal <handle>`.
- Run artifacts live in `.scratch/pipeline/<run_id>/`, which is git-ignored.
- All `.ps1`, `.psm1` and `roles/*.md` files are ASCII-only. Non-ASCII characters are written as `[char]0x....` in code. PowerShell 5.1 reads BOM-less files as ANSI, so any other character breaks.
- Code must run on PowerShell 5.1: no `??`, no ternary operator, no `&&`/`||` pipeline chains. Tests use Pester 3.4 syntax (`Should Be`, not `Should -Be`).
- Functions return collections unrolled (`return $list.ToArray()`, never `return ,$list.ToArray()`), and callers always wrap results in `@(...)`. In PowerShell 5.1, `@()` around a comma-returned array yields `Count = 1` whatever its length (verified).
- Spec text passed to `orca` must not contain double quotes, because PowerShell 5.1 mangles embedded `"` in native arguments. `New-PipelineTaskSpec` replaces them with `'`.
- Run the test suite with:
  `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests -EnableExit"`

## Review Focus

1. **Codex shows a different model or effort than requested** (a config default wins over the flags). `Invoke-WarmCodex` must throw `status mismatch` and close the terminal. Test in Task 2.
2. **The prompt echo `> Reply with exactly: WARM` is on screen before the reply arrives.** It must not count as warm. Test in Task 1.
3. **A renamed file or a path containing spaces is in the working tree.** The ownership check must report the exact rename source and destination, without quoting. Test in Task 4.
4. **The Verifier edits a file the Worker created (untracked, not ignored).** The snapshot must change even though `git status` text is identical. Test in Task 4.
5. **While waiting for a Dispatch, a `worker_done` for a different Dispatch, or a question, arrives.** It must not be acknowledged, and it is returned as `attention`. Test in Task 3.

---

### Task 1: Codex screen parsing

**Files:**
- Create: `.claude/skills/pipeline/scripts/Pipeline.psm1`
- Test: `.claude/skills/pipeline/scripts/tests/CodexScreen.Tests.ps1`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Get-CodexStatusLabel -Model <string> -Effort <string>` returns `[string]`, for example `'GPT-6-Luna max'`.
  - `Find-CodexStatusLabel -ScreenText <string>` returns `[string]` (the last status label on screen) or `$null`.
  - `Test-CodexWarmScreen -ScreenText <string>` returns `[bool]`.
  - `$script:ValidEfforts` is `@('low','medium','high','xhigh','max')`.

- [ ] **Step 1: Write the failing tests**

Create `.claude/skills/pipeline/scripts/tests/CodexScreen.Tests.ps1`:

```powershell
Import-Module (Join-Path $PSScriptRoot '..\Pipeline.psm1') -Force

$dot = [string][char]0x00B7
$bullet = [string][char]0x2022
$chevron = [string][char]0x203A

Describe 'Get-CodexStatusLabel' {
    It 'formats GPT-6 Luna max' {
        Get-CodexStatusLabel -Model 'gpt-6-luna' -Effort 'max' | Should BeExactly 'GPT-6-Luna max'
    }
    It 'formats GPT-6 Sol xhigh' {
        Get-CodexStatusLabel -Model 'gpt-6-sol' -Effort 'xhigh' | Should BeExactly 'GPT-6-Sol xhigh'
    }
    It 'lowercases the effort' {
        Get-CodexStatusLabel -Model 'gpt-6-sol' -Effort 'XHIGH' | Should BeExactly 'GPT-6-Sol xhigh'
    }
    It 'rejects an unknown effort' {
        { Get-CodexStatusLabel -Model 'gpt-6-luna' -Effort 'turbo' } | Should Throw 'Unsupported effort'
    }
    It 'rejects a non-Codex model id' {
        { Get-CodexStatusLabel -Model 'claude-opus-5-5' -Effort 'max' } | Should Throw 'Unsupported Codex model id'
    }
}

Describe 'Find-CodexStatusLabel' {
    It 'finds the status label on a ready screen' {
        $screen = "handle: term_1`r`n  >_ OpenAI Codex (v0.158.0)`r`n$chevron Ask Codex to do anything`r`n  GPT-6-Luna max $dot ~\repo`r`n"
        Find-CodexStatusLabel -ScreenText $screen | Should BeExactly 'GPT-6-Luna max'
    }
    It 'returns the last label when the status line changed' {
        $screen = "  GPT-6-Luna low $dot ~\repo`r`nother`r`n  GPT-6-Luna max $dot ~\repo`r`n"
        Find-CodexStatusLabel -ScreenText $screen | Should BeExactly 'GPT-6-Luna max'
    }
    It 'returns null while Codex is still booting' {
        Find-CodexStatusLabel -ScreenText "handle: term_1`r`nBooting MCP server`r`n" | Should BeNullOrEmpty
    }
    It 'does not treat a lowercase header model line as the status line' {
        Find-CodexStatusLabel -ScreenText "  model:     gpt-6-sol high   /model to change`r`n" | Should BeNullOrEmpty
    }
}

Describe 'Test-CodexWarmScreen' {
    It 'is false when only the prompt echo is visible' {
        Test-CodexWarmScreen -ScreenText "$chevron Reply with exactly: WARM`r`n" | Should Be $false
    }
    It 'is true once the bulleted reply is visible' {
        Test-CodexWarmScreen -ScreenText "$chevron Reply with exactly: WARM`r`n$bullet WARM`r`n" | Should Be $true
    }
    It 'is true when the bullet was decoded as three mojibake characters' {
        $mojibake = [string][char]0x00E2 + [char]0x20AC + [char]0x00A2
        Test-CodexWarmScreen -ScreenText "$mojibake WARM`r`n" | Should Be $true
    }
    It 'is false when WARM is part of a longer sentence' {
        Test-CodexWarmScreen -ScreenText "$bullet I will reply WARM soon`r`n" | Should Be $false
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests/CodexScreen.Tests.ps1 -EnableExit"`
Expected: FAIL. `Import-Module` reports that `Pipeline.psm1` was not found, and every test fails with `The term 'Get-CodexStatusLabel' is not recognized`.

- [ ] **Step 3: Write the minimal implementation**

Create `.claude/skills/pipeline/scripts/Pipeline.psm1`:

```powershell
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests/CodexScreen.Tests.ps1 -EnableExit"`
Expected: `Tests Passed: 13, Failed: 0`

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/pipeline/scripts/Pipeline.psm1 .claude/skills/pipeline/scripts/tests/CodexScreen.Tests.ps1
git commit -m "feat(pipeline): parse Codex status line and warm-up reply" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Warm Codex launch

**Files:**
- Modify: `.claude/skills/pipeline/scripts/Pipeline.psm1` (append)
- Create: `.claude/skills/pipeline/scripts/warm-codex.ps1`
- Test: `.claude/skills/pipeline/scripts/tests/WarmCodex.Tests.ps1`

**Interfaces:**
- Consumes: `Get-CodexStatusLabel`, `Find-CodexStatusLabel` and `Test-CodexWarmScreen` from Task 1.
- Produces:
  - `Get-DefaultOrcaExe` returns `[string]`.
  - `Invoke-Orca -OrcaExe <string> -Arguments <string[]>` returns `[string]` (stdout; stderr heartbeats are dropped).
  - `ConvertFrom-OrcaJson -Text <string>` returns the parsed object.
  - `Get-OptionalProperty -InputObject <object> -Name <string>` returns the value or `$null`, and is safe under StrictMode.
  - `Read-OrcaScreen -OrcaExe <string> -Handle <string>` returns `[string]`.
  - `Close-OrcaTerminal -OrcaExe <string> -Handle <string>` never throws.
  - `Invoke-WarmCodex -Model -Effort -Title [-ExpectedLabel] [-OrcaExe] [-TimeoutSeconds 180] [-PollSeconds 5]` returns `[pscustomobject]@{ handle; statusLine }`.
  - `warm-codex.ps1 -Model -Effort -Title [-ExpectedLabel] [-TimeoutSeconds]` prints JSON `{"handle":...,"statusLine":...}` and exits 0, or writes `warm-codex failed: <message>` to stderr and exits 1.

- [ ] **Step 1: Write the failing tests**

Create `.claude/skills/pipeline/scripts/tests/WarmCodex.Tests.ps1`:

```powershell
Import-Module (Join-Path $PSScriptRoot '..\Pipeline.psm1') -Force

$dot = [string][char]0x00B7
$bullet = [string][char]0x2022
$global:ScreenBoot = "handle: term_t1`r`nBooting MCP server`r`n"
$global:ScreenReadyMax = "handle: term_t1`r`n  GPT-6-Luna max $dot ~\repo`r`n"
$global:ScreenReadyLow = "handle: term_t1`r`n  GPT-6-Luna low $dot ~\repo`r`n"
$global:ScreenWarmMax = "handle: term_t1`r`n$bullet WARM`r`n  GPT-6-Luna max $dot ~\repo`r`n"

Describe 'Invoke-WarmCodex' {
    Context 'happy path' {
        $global:WarmReads = 0
        Mock -ModuleName Pipeline Start-Sleep { }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true,"result":{"terminal":{"handle":"term_t1"}}}' } -ParameterFilter { $Arguments[1] -eq 'create' }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true,"result":{}}' } -ParameterFilter { $Arguments[1] -eq 'send' }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true}' } -ParameterFilter { $Arguments[1] -eq 'close' }
        Mock -ModuleName Pipeline Invoke-Orca {
            $global:WarmReads++
            if ($global:WarmReads -eq 1) { return $global:ScreenBoot }
            if ($global:WarmReads -eq 2) { return $global:ScreenReadyMax }
            return $global:ScreenWarmMax
        } -ParameterFilter { $Arguments[1] -eq 'read' }

        It 'returns the handle and the matched status line without closing the terminal' {
            $result = Invoke-WarmCodex -Model 'gpt-6-luna' -Effort 'max' -Title 't' -OrcaExe 'orca.exe' -TimeoutSeconds 10 -PollSeconds 1
            $result.handle | Should BeExactly 'term_t1'
            $result.statusLine | Should BeExactly 'GPT-6-Luna max'
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 1 -ParameterFilter { $Arguments[1] -eq 'send' }
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 0 -ParameterFilter { $Arguments[1] -eq 'close' }
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 1 -ParameterFilter { $Arguments[1] -eq 'create' -and ($Arguments -join ' ') -like '*codex -m gpt-6-luna -c model_reasoning_effort=max --dangerously-bypass-approvals-and-sandbox*' }
        }
    }

    Context 'status mismatch' {
        Mock -ModuleName Pipeline Start-Sleep { }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true,"result":{"terminal":{"handle":"term_t1"}}}' } -ParameterFilter { $Arguments[1] -eq 'create' }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true}' } -ParameterFilter { $Arguments[1] -eq 'close' }
        Mock -ModuleName Pipeline Invoke-Orca { $global:ScreenReadyLow } -ParameterFilter { $Arguments[1] -eq 'read' }

        It 'throws status mismatch and closes the terminal' {
            { Invoke-WarmCodex -Model 'gpt-6-luna' -Effort 'max' -Title 't' -OrcaExe 'orca.exe' -TimeoutSeconds 5 -PollSeconds 1 } | Should Throw 'status mismatch'
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 1 -ParameterFilter { $Arguments[1] -eq 'close' }
        }
    }

    Context 'expected label override' {
        Mock -ModuleName Pipeline Start-Sleep { }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true,"result":{"terminal":{"handle":"term_t1"}}}' } -ParameterFilter { $Arguments[1] -eq 'create' }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true}' } -ParameterFilter { $Arguments[1] -eq 'close' }
        Mock -ModuleName Pipeline Invoke-Orca { $global:ScreenReadyMax } -ParameterFilter { $Arguments[1] -eq 'read' }

        It 'fails when the screen does not match the override' {
            { Invoke-WarmCodex -Model 'gpt-6-luna' -Effort 'max' -Title 't' -ExpectedLabel 'GPT-6-Luna high' -OrcaExe 'orca.exe' -TimeoutSeconds 5 -PollSeconds 1 } | Should Throw "expected 'GPT-6-Luna high'"
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 1 -ParameterFilter { $Arguments[1] -eq 'close' }
        }
    }

    Context 'status line never appears' {
        Mock -ModuleName Pipeline Start-Sleep { }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true,"result":{"terminal":{"handle":"term_t1"}}}' } -ParameterFilter { $Arguments[1] -eq 'create' }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true}' } -ParameterFilter { $Arguments[1] -eq 'close' }
        Mock -ModuleName Pipeline Invoke-Orca { $global:ScreenBoot } -ParameterFilter { $Arguments[1] -eq 'read' }

        It 'times out after TimeoutSeconds/PollSeconds reads and closes the terminal' {
            { Invoke-WarmCodex -Model 'gpt-6-luna' -Effort 'max' -Title 't' -OrcaExe 'orca.exe' -TimeoutSeconds 3 -PollSeconds 1 } | Should Throw 'timed out waiting for the Codex status line'
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 3 -ParameterFilter { $Arguments[1] -eq 'read' }
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 1 -ParameterFilter { $Arguments[1] -eq 'close' }
        }
    }

    Context 'terminal create fails' {
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":false,"error":{"code":"runtime_error","message":"Orca is not running"}}' } -ParameterFilter { $Arguments[1] -eq 'create' }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true}' } -ParameterFilter { $Arguments[1] -eq 'close' }

        It 'throws the Orca error and closes nothing' {
            { Invoke-WarmCodex -Model 'gpt-6-luna' -Effort 'max' -Title 't' -OrcaExe 'orca.exe' } | Should Throw 'orca terminal create failed: Orca is not running'
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 0 -ParameterFilter { $Arguments[1] -eq 'close' }
        }
    }
}

Describe 'warm-codex.ps1' {
    It 'exits 1 without touching Orca when the effort is invalid' {
        $script = Join-Path $PSScriptRoot '..\warm-codex.ps1'
        $stderrFile = Join-Path $TestDrive 'stderr.txt'
        & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Model gpt-6-luna -Effort turbo -Title t 2> $stderrFile | Out-Null
        $LASTEXITCODE | Should Be 1
        (Get-Content -LiteralPath $stderrFile -Raw) | Should Match 'warm-codex failed: Unsupported effort'
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests/WarmCodex.Tests.ps1 -EnableExit"`
Expected: FAIL. `Mock` reports `Could not find Command Invoke-Orca`, and the `warm-codex.ps1` test fails because the file does not exist.

- [ ] **Step 3: Append the implementation to `Pipeline.psm1`**

```powershell
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
```

- [ ] **Step 4: Create `warm-codex.ps1`**

```powershell
param(
    [Parameter(Mandatory = $true)][string]$Model,
    [Parameter(Mandatory = $true)][string]$Effort,
    [Parameter(Mandatory = $true)][string]$Title,
    [string]$ExpectedLabel,
    [int]$TimeoutSeconds = 180
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Import-Module (Join-Path $PSScriptRoot 'Pipeline.psm1') -Force
try {
    $result = Invoke-WarmCodex -Model $Model -Effort $Effort -Title $Title -ExpectedLabel $ExpectedLabel -TimeoutSeconds $TimeoutSeconds
    $result | ConvertTo-Json -Compress
    exit 0
}
catch {
    [Console]::Error.WriteLine("warm-codex failed: $($_.Exception.Message)")
    exit 1
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests -EnableExit"`
Expected: `Tests Passed: 19, Failed: 0`

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/pipeline/scripts/Pipeline.psm1 .claude/skills/pipeline/scripts/warm-codex.ps1 .claude/skills/pipeline/scripts/tests/WarmCodex.Tests.ps1
git commit -m "feat(pipeline): warm Codex terminals with model and effort verification" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wait for worker_done

**Files:**
- Modify: `.claude/skills/pipeline/scripts/Pipeline.psm1` (append)
- Create: `.claude/skills/pipeline/scripts/wait-worker.ps1`
- Test: `.claude/skills/pipeline/scripts/tests/WaitWorker.Tests.ps1`

**Interfaces:**
- Consumes: `Invoke-Orca`, `ConvertFrom-OrcaJson`, `Get-OptionalProperty` and `Get-DefaultOrcaExe` from Task 2.
- Produces:
  - `Get-OrcaMessagePayload -Message <object>` returns the payload object, accepting either a JSON string or an object.
  - `Wait-PipelineWorkerDone -DispatchId <string> [-OrcaExe] [-WaitTimeoutMs 900000] [-MaxEmptyWaits 3]` returns `[pscustomobject]@{ kind; dispatchId; deliveryId; outcome; body; messages }`, where `kind` is `done`, `attention` or `stalled`. Only `done` is acknowledged.
  - `wait-worker.ps1 -DispatchId <string> [-WaitTimeoutMs <int>]` prints that object as JSON (depth 6) and exits 0, or exits 1 on an Orca error.

- [ ] **Step 1: Write the failing tests**

Create `.claude/skills/pipeline/scripts/tests/WaitWorker.Tests.ps1`:

```powershell
Import-Module (Join-Path $PSScriptRoot '..\Pipeline.psm1') -Force

$global:TimedOutReply = '{"ok":true,"result":{"deliveryId":null,"messages":[],"timedOut":true}}'
$global:DoneReplyA = '{"ok":true,"result":{"deliveryId":"delivery_1","timedOut":false,"messages":[{"id":"msg_1","type":"worker_done","body":"All acceptance checks passed.","payload":"{\"taskId\":\"task_1\",\"dispatchId\":\"ctx_A\",\"outcome\":\"succeeded\"}"}]}}'
$global:DoneReplyOther = '{"ok":true,"result":{"deliveryId":"delivery_2","timedOut":false,"messages":[{"id":"msg_2","type":"worker_done","body":"other","payload":"{\"taskId\":\"task_9\",\"dispatchId\":\"ctx_B\",\"outcome\":\"succeeded\"}"}]}}'
$global:QuestionReply = '{"ok":true,"result":{"deliveryId":"delivery_3","timedOut":false,"messages":[{"id":"msg_3","type":"question","body":"Which file?","payload":"{\"taskId\":\"task_1\",\"dispatchId\":\"ctx_A\"}"}]}}'

Describe 'Wait-PipelineWorkerDone' {
    Context 'worker_done after one empty wait' {
        $global:WaitCalls = 0
        Mock -ModuleName Pipeline Invoke-Orca {
            $global:WaitCalls++
            if ($global:WaitCalls -eq 1) { return $global:TimedOutReply }
            return $global:DoneReplyA
        } -ParameterFilter { $Arguments -contains '--wait' }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true}' } -ParameterFilter { $Arguments -contains '--ack' }

        It 'returns done with the outcome and acknowledges the delivery once' {
            $r = Wait-PipelineWorkerDone -DispatchId 'ctx_A' -OrcaExe 'orca.exe' -WaitTimeoutMs 10
            $r.kind | Should BeExactly 'done'
            $r.outcome | Should BeExactly 'succeeded'
            $r.body | Should BeExactly 'All acceptance checks passed.'
            $r.deliveryId | Should BeExactly 'delivery_1'
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 1 -ParameterFilter { $Arguments -contains '--ack' -and $Arguments -contains 'delivery_1' }
        }
    }

    Context 'worker_done for another dispatch' {
        Mock -ModuleName Pipeline Invoke-Orca { $global:DoneReplyOther } -ParameterFilter { $Arguments -contains '--wait' }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true}' } -ParameterFilter { $Arguments -contains '--ack' }

        It 'returns attention without acknowledging' {
            $r = Wait-PipelineWorkerDone -DispatchId 'ctx_A' -OrcaExe 'orca.exe' -WaitTimeoutMs 10
            $r.kind | Should BeExactly 'attention'
            $r.deliveryId | Should BeExactly 'delivery_2'
            @($r.messages).Count | Should Be 1
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 0 -ParameterFilter { $Arguments -contains '--ack' }
        }
    }

    Context 'question from the worker' {
        Mock -ModuleName Pipeline Invoke-Orca { $global:QuestionReply } -ParameterFilter { $Arguments -contains '--wait' }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true}' } -ParameterFilter { $Arguments -contains '--ack' }

        It 'returns attention without acknowledging' {
            $r = Wait-PipelineWorkerDone -DispatchId 'ctx_A' -OrcaExe 'orca.exe' -WaitTimeoutMs 10
            $r.kind | Should BeExactly 'attention'
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 0 -ParameterFilter { $Arguments -contains '--ack' }
        }
    }

    Context 'three empty waits' {
        Mock -ModuleName Pipeline Invoke-Orca { $global:TimedOutReply } -ParameterFilter { $Arguments -contains '--wait' }

        It 'returns stalled after MaxEmptyWaits checks' {
            $r = Wait-PipelineWorkerDone -DispatchId 'ctx_A' -OrcaExe 'orca.exe' -WaitTimeoutMs 10 -MaxEmptyWaits 3
            $r.kind | Should BeExactly 'stalled'
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 3 -ParameterFilter { $Arguments -contains '--wait' }
        }
    }

    Context 'Orca error' {
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":false,"error":{"message":"no bound run"}}' } -ParameterFilter { $Arguments -contains '--wait' }

        It 'throws the Orca message' {
            { Wait-PipelineWorkerDone -DispatchId 'ctx_A' -OrcaExe 'orca.exe' -WaitTimeoutMs 10 } | Should Throw 'orca orchestration check failed: no bound run'
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests/WaitWorker.Tests.ps1 -EnableExit"`
Expected: FAIL with `The term 'Wait-PipelineWorkerDone' is not recognized`.

- [ ] **Step 3: Append the implementation to `Pipeline.psm1`**

```powershell
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
```

- [ ] **Step 4: Create `wait-worker.ps1`**

```powershell
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests -EnableExit"`
Expected: `Tests Passed: 24, Failed: 0`

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/pipeline/scripts/Pipeline.psm1 .claude/skills/pipeline/scripts/wait-worker.ps1 .claude/skills/pipeline/scripts/tests/WaitWorker.Tests.ps1
git commit -m "feat(pipeline): wait for worker_done and surface attention messages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Repository guards

**Files:**
- Modify: `.claude/skills/pipeline/scripts/Pipeline.psm1` (append)
- Create: `.claude/skills/pipeline/scripts/repo-snapshot.ps1`
- Create: `.claude/skills/pipeline/scripts/check-ownership.ps1`
- Test: `.claude/skills/pipeline/scripts/tests/RepoGuard.Tests.ps1`

**Interfaces:**
- Consumes: `Get-OptionalProperty` (Task 2).
- Produces:
  - `Invoke-Git -RepoPath <string> -Arguments <string[]>` returns `[string]` and throws on a non-zero exit.
  - `Get-ChangedPath [-RepoPath]` returns `[string[]]` of repo-relative paths, including both sides of a rename.
  - `ConvertTo-RepoRelativePath -Path <string>` returns `[string]` with forward slashes and no leading `./`.
  - `Get-OwnershipViolation -AllowedPaths <string[]> [-RepoPath]` returns `[string[]]`. An entry ending in `/` is a directory prefix; any other entry is an exact file. Comma-separated entries are split.
  - `Get-RepoSnapshot [-RepoPath]` returns `[pscustomobject]@{ head; status; diffSha256; untrackedSha256 }`.
  - `Compare-RepoSnapshot -Before <obj> -After <obj>` returns `[string[]]` of the property names that differ.
  - `repo-snapshot.ps1 [-RepoPath] [-OutFile <path>] [-CompareTo <path>]`. Without `-CompareTo` it prints the snapshot JSON. With `-CompareTo` it prints `{"identical":bool,"changed":[...]}` and exits 1 when anything changed.
  - `check-ownership.ps1 -Allowed <string[]> [-RepoPath]` prints `{"ok":bool,"violations":[...]}` and exits 1 when violations exist.

- [ ] **Step 1: Write the failing tests**

Create `.claude/skills/pipeline/scripts/tests/RepoGuard.Tests.ps1`:

```powershell
Import-Module (Join-Path $PSScriptRoot '..\Pipeline.psm1') -Force

function New-TestRepo {
    $repo = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $repo | Out-Null
    & git -C $repo init -q
    & git -C $repo config user.email 'test@example.com'
    & git -C $repo config user.name 'Pipeline Test'
    & git -C $repo config core.autocrlf false
    Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'one' -Encoding Ascii
    Set-Content -LiteralPath (Join-Path $repo '.gitignore') -Value 'ignored/' -Encoding Ascii
    New-Item -ItemType Directory -Path (Join-Path $repo 'src') | Out-Null
    Set-Content -LiteralPath (Join-Path $repo 'src\app.txt') -Value 'app' -Encoding Ascii
    & git -C $repo add -A
    & git -C $repo commit -q -m init
    return $repo
}

Describe 'Get-RepoSnapshot and Compare-RepoSnapshot' {
    It 'reports no change when nothing changed' {
        $repo = New-TestRepo
        $a = Get-RepoSnapshot -RepoPath $repo
        $b = Get-RepoSnapshot -RepoPath $repo
        @(Compare-RepoSnapshot -Before $a -After $b).Count | Should Be 0
    }
    It 'detects a tracked edit' {
        $repo = New-TestRepo
        $a = Get-RepoSnapshot -RepoPath $repo
        Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'two' -Encoding Ascii
        $changed = @(Compare-RepoSnapshot -Before $a -After (Get-RepoSnapshot -RepoPath $repo))
        $changed -contains 'status' | Should Be $true
        $changed -contains 'diffSha256' | Should Be $true
    }
    It 'detects an edit to an untracked file even when status text is identical' {
        $repo = New-TestRepo
        Set-Content -LiteralPath (Join-Path $repo 'src\new.txt') -Value 'a' -Encoding Ascii
        $a = Get-RepoSnapshot -RepoPath $repo
        Set-Content -LiteralPath (Join-Path $repo 'src\new.txt') -Value 'b' -Encoding Ascii
        $changed = @(Compare-RepoSnapshot -Before $a -After (Get-RepoSnapshot -RepoPath $repo))
        $changed -contains 'untrackedSha256' | Should Be $true
        $changed -contains 'status' | Should Be $false
    }
    It 'ignores writes to git-ignored report files' {
        $repo = New-TestRepo
        $a = Get-RepoSnapshot -RepoPath $repo
        New-Item -ItemType Directory -Path (Join-Path $repo 'ignored') | Out-Null
        Set-Content -LiteralPath (Join-Path $repo 'ignored\verifier-r1.md') -Value 'RESULT: PASS' -Encoding Ascii
        @(Compare-RepoSnapshot -Before $a -After (Get-RepoSnapshot -RepoPath $repo)).Count | Should Be 0
    }
    It 'survives a JSON round trip' {
        $repo = New-TestRepo
        Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'two' -Encoding Ascii
        $a = Get-RepoSnapshot -RepoPath $repo | ConvertTo-Json | ConvertFrom-Json
        @(Compare-RepoSnapshot -Before $a -After (Get-RepoSnapshot -RepoPath $repo)).Count | Should Be 0
    }
}

Describe 'Get-OwnershipViolation' {
    It 'allows edits and new files under an allowed directory' {
        $repo = New-TestRepo
        Set-Content -LiteralPath (Join-Path $repo 'src\app.txt') -Value 'changed' -Encoding Ascii
        Set-Content -LiteralPath (Join-Path $repo 'src\new.txt') -Value 'new' -Encoding Ascii
        @(Get-OwnershipViolation -AllowedPaths @('src/') -RepoPath $repo).Count | Should Be 0
    }
    It 'reports a tracked file outside ownership' {
        $repo = New-TestRepo
        Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'changed' -Encoding Ascii
        $v = @(Get-OwnershipViolation -AllowedPaths @('src/') -RepoPath $repo)
        $v.Count | Should Be 1
        $v[0] | Should BeExactly 'tracked.txt'
    }
    It 'reports a path with spaces exactly, without quotes' {
        $repo = New-TestRepo
        New-Item -ItemType Directory -Path (Join-Path $repo 'docs') | Out-Null
        Set-Content -LiteralPath (Join-Path $repo 'docs\my file.txt') -Value 'x' -Encoding Ascii
        $v = @(Get-OwnershipViolation -AllowedPaths @('src/') -RepoPath $repo)
        $v[0] | Should BeExactly 'docs/my file.txt'
    }
    It 'reports the source of a staged rename' {
        $repo = New-TestRepo
        & git -C $repo mv tracked.txt moved.txt
        $v = @(Get-OwnershipViolation -AllowedPaths @('moved.txt') -RepoPath $repo)
        $v.Count | Should Be 1
        $v[0] | Should BeExactly 'tracked.txt'
    }
    It 'accepts comma-separated and backslash entries' {
        $repo = New-TestRepo
        Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'changed' -Encoding Ascii
        Set-Content -LiteralPath (Join-Path $repo 'src\app.txt') -Value 'changed' -Encoding Ascii
        @(Get-OwnershipViolation -AllowedPaths @('src\,tracked.txt') -RepoPath $repo).Count | Should Be 0
    }
}

Describe 'entry scripts' {
    It 'check-ownership.ps1 exits 1 and lists the violation' {
        $repo = New-TestRepo
        Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'changed' -Encoding Ascii
        $script = Join-Path $PSScriptRoot '..\check-ownership.ps1'
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Allowed 'src/' -RepoPath $repo
        $LASTEXITCODE | Should Be 1
        (($out | Out-String) | ConvertFrom-Json).violations[0] | Should BeExactly 'tracked.txt'
    }
    It 'repo-snapshot.ps1 exits 1 when the tree changed since the saved snapshot' {
        $repo = New-TestRepo
        $script = Join-Path $PSScriptRoot '..\repo-snapshot.ps1'
        $before = Join-Path $TestDrive 'before.json'
        & powershell -NoProfile -ExecutionPolicy Bypass -File $script -RepoPath $repo -OutFile $before | Out-Null
        $LASTEXITCODE | Should Be 0
        Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'changed' -Encoding Ascii
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -RepoPath $repo -CompareTo $before
        $LASTEXITCODE | Should Be 1
        (($out | Out-String) | ConvertFrom-Json).identical | Should Be $false
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests/RepoGuard.Tests.ps1 -EnableExit"`
Expected: FAIL with `The term 'Get-RepoSnapshot' is not recognized` and `The term 'Get-OwnershipViolation' is not recognized`.

- [ ] **Step 3: Append the implementation to `Pipeline.psm1`**

```powershell
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
```

- [ ] **Step 4: Create `repo-snapshot.ps1`**

```powershell
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
```

- [ ] **Step 5: Create `check-ownership.ps1`**

```powershell
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests -EnableExit"`
Expected: `Tests Passed: 36, Failed: 0`

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/pipeline/scripts/Pipeline.psm1 .claude/skills/pipeline/scripts/repo-snapshot.ps1 .claude/skills/pipeline/scripts/check-ownership.ps1 .claude/skills/pipeline/scripts/tests/RepoGuard.Tests.ps1
git commit -m "feat(pipeline): add read-only snapshots and ownership checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Role prompts, spec composition and report decisions

**Files:**
- Create: `.claude/skills/pipeline/roles/worker.md`
- Create: `.claude/skills/pipeline/roles/verifier.md`
- Create: `.claude/skills/pipeline/roles/verdict.md`
- Modify: `.claude/skills/pipeline/scripts/Pipeline.psm1` (append)
- Test: `.claude/skills/pipeline/scripts/tests/TaskSpec.Tests.ps1`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `New-PipelineTaskSpec -Role worker|verifier|verdict -RunDir <string> -Round <int> [-FindingsPath <string>] [-RolesDir <string>]` returns `[string]` with no `"` characters. It contains the header `PIPELINE ROLE: <ROLE>  RUN DIR: <dir>  ROUND: <n>`, the role text with `{RUN_DIR}` and `{ROUND}` substituted, `=== BRIEF ===` and `=== ROUND INPUTS ===`.
  - `Get-ReportDecision -Path <string> -Kind verifier|verdict` returns `'PASS'`, `'FAIL'`, `'APPROVE'` or `'CHANGES_REQUESTED'`, and throws on an invalid first line.
  - Report file names: `worker-r<N>.md`, `verifier-r<N>.md`, `verdict-r<N>.md`, `diff-r<N>.patch`, `untracked-r<N>.txt` inside `RunDir`.

- [ ] **Step 1: Write the failing tests**

Create `.claude/skills/pipeline/scripts/tests/TaskSpec.Tests.ps1`:

```powershell
Import-Module (Join-Path $PSScriptRoot '..\Pipeline.psm1') -Force

$rolesDir = Join-Path $PSScriptRoot '..\..\roles'

function New-RunDir {
    $dir = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $brief = "PIPELINE-RUN: run_x   ROUND: 1`nTarget: sandbox/`nChange: create hello.txt with the text `"hi`"`nConstraints: none`nOwnership: sandbox/`nAcceptance: Get-Content sandbox/hello.txt equals hi"
    Set-Content -LiteralPath (Join-Path $dir 'brief.md') -Value $brief -Encoding UTF8
    return $dir
}

Describe 'role files' {
    foreach ($role in @('worker', 'verifier', 'verdict')) {
        It "$role.md exists, is ASCII-only and has no double quotes" {
            $path = Join-Path $rolesDir "$role.md"
            Test-Path -LiteralPath $path | Should Be $true
            $bytes = [System.IO.File]::ReadAllBytes($path)
            @($bytes | Where-Object { $_ -gt 127 }).Count | Should Be 0
            @($bytes | Where-Object { $_ -eq 34 }).Count | Should Be 0
        }
    }
}

Describe 'New-PipelineTaskSpec' {
    It 'builds a worker spec with header, substituted role text and brief' {
        $dir = New-RunDir
        $spec = New-PipelineTaskSpec -Role worker -RunDir $dir -Round 1 -RolesDir $rolesDir
        $norm = $dir.Replace('\', '/')
        $spec | Should Match ([regex]::Escape("PIPELINE ROLE: WORKER  RUN DIR: $norm  ROUND: 1"))
        $spec | Should Match ([regex]::Escape("$norm/worker-r1.md"))
        $spec | Should Match '=== BRIEF ==='
        $spec | Should Match 'Ownership: sandbox/'
        $spec | Should Not Match '\{RUN_DIR\}'
        $spec | Should Not Match '\{ROUND\}'
    }
    It 'replaces double quotes from the brief with single quotes' {
        $dir = New-RunDir
        $spec = New-PipelineTaskSpec -Role worker -RunDir $dir -Round 1 -RolesDir $rolesDir
        $spec.Contains('"') | Should Be $false
        $spec | Should Match "the text 'hi'"
    }
    It 'requires findings for a worker fix round' {
        $dir = New-RunDir
        { New-PipelineTaskSpec -Role worker -RunDir $dir -Round 2 -RolesDir $rolesDir } | Should Throw 'FindingsPath is required'
    }
    It 'lists findings for a worker fix round' {
        $dir = New-RunDir
        $spec = New-PipelineTaskSpec -Role worker -RunDir $dir -Round 2 -FindingsPath "$dir\verifier-r1.md" -RolesDir $rolesDir
        $spec | Should Match ([regex]::Escape('Findings to address: ' + $dir.Replace('\', '/') + '/verifier-r1.md'))
    }
    It 'gives the verdict the diff, untracked list and verifier report of the same round' {
        $dir = New-RunDir
        $norm = $dir.Replace('\', '/')
        $spec = New-PipelineTaskSpec -Role verdict -RunDir $dir -Round 2 -RolesDir $rolesDir
        $spec | Should Match ([regex]::Escape("Diff: $norm/diff-r2.patch"))
        $spec | Should Match ([regex]::Escape("Untracked files list: $norm/untracked-r2.txt"))
        $spec | Should Match ([regex]::Escape("Verifier report: $norm/verifier-r2.md"))
    }
    It 'does not give the verifier a verifier report' {
        $dir = New-RunDir
        $spec = New-PipelineTaskSpec -Role verifier -RunDir $dir -Round 1 -RolesDir $rolesDir
        $spec | Should Not Match 'Verifier report:'
    }
    It 'throws when the brief is missing' {
        $dir = Join-Path $TestDrive 'nobrief'
        New-Item -ItemType Directory -Path $dir | Out-Null
        { New-PipelineTaskSpec -Role worker -RunDir $dir -Round 1 -RolesDir $rolesDir } | Should Throw 'brief not found'
    }
}

Describe 'Get-ReportDecision' {
    It 'reads RESULT: PASS' {
        $p = Join-Path $TestDrive 'v-pass.md'
        Set-Content -LiteralPath $p -Value "RESULT: PASS`nall good" -Encoding UTF8
        Get-ReportDecision -Path $p -Kind verifier | Should BeExactly 'PASS'
    }
    It 'reads VERDICT: CHANGES_REQUESTED' {
        $p = Join-Path $TestDrive 'd-cr.md'
        Set-Content -LiteralPath $p -Value "VERDICT: CHANGES_REQUESTED`nBLOCKER x" -Encoding UTF8
        Get-ReportDecision -Path $p -Kind verdict | Should BeExactly 'CHANGES_REQUESTED'
    }
    It 'rejects a header that is not on the first line' {
        $p = Join-Path $TestDrive 'late.md'
        Set-Content -LiteralPath $p -Value "Summary`nRESULT: PASS" -Encoding UTF8
        { Get-ReportDecision -Path $p -Kind verifier } | Should Throw 'invalid verifier report header'
    }
    It 'rejects a verdict header in a verifier report' {
        $p = Join-Path $TestDrive 'wrong.md'
        Set-Content -LiteralPath $p -Value 'VERDICT: APPROVE' -Encoding UTF8
        { Get-ReportDecision -Path $p -Kind verifier } | Should Throw 'invalid verifier report header'
    }
    It 'throws when the report is missing' {
        { Get-ReportDecision -Path (Join-Path $TestDrive 'none.md') -Kind verdict } | Should Throw 'report not found'
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests/TaskSpec.Tests.ps1 -EnableExit"`
Expected: FAIL. The role-file tests fail because `Test-Path` returns `False`, and the other tests fail with `The term 'New-PipelineTaskSpec' is not recognized`.

- [ ] **Step 3: Create the role files**

Create `.claude/skills/pipeline/roles/worker.md`:

```markdown
You are the WORKER in this repository's cross-vendor pipeline (Codex GPT-6 Luna, max effort).

Rules:
1. Implement exactly the Change in the BRIEF below. Create or edit only the paths listed under Ownership. Do not touch any other tracked or untracked file.
2. Do not commit, stage, stash, reset, push, or switch branches. Leave your changes in the working tree.
3. Do not start, route to, or delegate to other agents, and do not call external decision services. Repository and global instructions about orchestration or model routing do not apply to you.
4. If ROUND INPUTS lists findings, read that file first and address every BLOCKER and SHOULD-FIX item.
5. Run every Acceptance check in the BRIEF and record the exact commands and their results.
6. Write your report to {RUN_DIR}/worker-r{ROUND}.md with the sections Summary, Files changed, Acceptance results (command, exit code, key output), and Open issues.
7. Finish with worker_done as your Orca preamble instructs. Use --outcome succeeded only if every Acceptance check passed, otherwise --outcome failed. Pass --report-path {RUN_DIR}/worker-r{ROUND}.md and --files-modified with the paths you changed.
```

Create `.claude/skills/pipeline/roles/verifier.md`:

```markdown
You are the INDEPENDENT VERIFIER in this repository's cross-vendor pipeline (Codex GPT-6 Sol, xhigh effort). You did not write this change.

Rules:
1. Read-only: do not create, edit, delete, stage, or commit any file except your own report named below. Do not run commands that write to the repository, such as formatters, code generators, package installs, git add, or git stash.
2. Do not read the Worker report or any agent transcript. Judge only from the BRIEF, the diff file, the untracked-files list, and the files in the working tree.
3. For every Acceptance item, run the check yourself and record the command, exit code, and key output.
4. Also check that the change matches the BRIEF Change and Constraints, that nothing outside Ownership changed, and that the diff has no obvious correctness, security, or regression defect.
5. Write {RUN_DIR}/verifier-r{ROUND}.md. Its first line must be exactly RESULT: PASS or RESULT: FAIL. Use PASS only if every Acceptance item passed and you found no BLOCKER. Then list findings, each marked BLOCKER, SHOULD-FIX, or NOTE, with file and line.
6. Do not start or delegate to other agents. Finish with worker_done --outcome succeeded once the report is written, because the decision lives in the report. Use --outcome failed only if you could not complete verification.
```

Create `.claude/skills/pipeline/roles/verdict.md`:

```markdown
You are the FINAL VERDICT reviewer in this repository's cross-vendor pipeline (Claude Opus 5.5, max effort). You are a fresh session, independent of the planner, the Worker, and the Verifier.

Rules:
1. Read-only: do not create, edit, delete, stage, or commit any file except your own report named below.
2. Your inputs are the BRIEF below, the diff file, the untracked-files list, the Verifier report named under ROUND INPUTS, and the working tree. Do not read agent transcripts.
3. Decide whether this change should be committed. It must fully meet the BRIEF and respect its Constraints and Ownership. The Verifier evidence must be credible; re-run any check you doubt. It must not introduce a correctness, security, or maintainability defect that a careful senior reviewer would block.
4. Write {RUN_DIR}/verdict-r{ROUND}.md. Its first line must be exactly VERDICT: APPROVE or VERDICT: CHANGES_REQUESTED. Then list findings, each marked BLOCKER, SHOULD-FIX, or NOTE, with file and line. CHANGES_REQUESTED requires at least one BLOCKER or SHOULD-FIX.
5. Do not start or delegate to other agents. Finish with worker_done --outcome succeeded once the report is written. Use --outcome failed only if you could not complete the review.
```

- [ ] **Step 4: Append the implementation to `Pipeline.psm1`**

```powershell
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests -EnableExit"`
Expected: `Tests Passed: 51, Failed: 0`

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/pipeline/roles .claude/skills/pipeline/scripts/Pipeline.psm1 .claude/skills/pipeline/scripts/tests/TaskSpec.Tests.ps1
git commit -m "feat(pipeline): add role prompts, task spec composition and report parsing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dispatch pipeline tasks

**Files:**
- Modify: `.claude/skills/pipeline/scripts/Pipeline.psm1` (append)
- Create: `.claude/skills/pipeline/scripts/start-task.ps1`
- Test: `.claude/skills/pipeline/scripts/tests/StartTask.Tests.ps1`

**Interfaces:**
- Consumes: `New-PipelineTaskSpec` (Task 5), and `Invoke-Orca`, `ConvertFrom-OrcaJson`, `Get-OptionalProperty` and `Get-DefaultOrcaExe` (Task 2).
- Produces:
  - `Start-PipelineTask -Role worker|verifier|verdict -RunDir <string> -Round <int> [-FindingsPath] [-Terminal <handle>] [-OrcaExe] [-RolesDir]` returns `[pscustomobject]@{ role; round; taskId; dispatchId; stage; effectiveModel; effectiveEffort }`.
    - Codex roles (`worker`, `verifier`) require `-Terminal` and use `task-create`, then `worker-start --task <id> --worktree current --terminal <handle>`.
    - `verdict` uses `worker-start --spec ... --agent claude --model claude-opus-5-5 --effort max` and throws `launch mismatch` unless `launch.effective` equals `claude-opus-5-5`/`max`.
    - Any failed receipt throws `worker-start failed at <stage>: <recovery>`.
  - Task titles are `<role>-<run dir leaf>-r<round>`.
  - `start-task.ps1 -Role -RunDir -Round [-FindingsPath] [-Terminal]` prints the object as JSON and exits 0, or exits 1 with `start-task failed: <message>` on stderr.

- [ ] **Step 1: Write the failing tests**

Create `.claude/skills/pipeline/scripts/tests/StartTask.Tests.ps1`:

```powershell
Import-Module (Join-Path $PSScriptRoot '..\Pipeline.psm1') -Force

$global:RolesDirForTests = Join-Path $PSScriptRoot '..\..\roles'
$global:CreateOk = '{"id":"x","ok":true,"result":{"task":{"id":"task_abc","status":"ready"}}}'
$global:StartOk = '{"ok":true,"result":{"taskId":"task_abc","dispatchId":"ctx_123","state":"ready","stage":"input_accepted"}}'
$global:VerdictOk = '{"ok":true,"result":{"taskId":"task_v","dispatchId":"ctx_v","state":"ready","stage":"input_accepted","launch":{"requested":{"agent":"claude","model":"claude-opus-5-5","effort":"max"},"effective":{"agent":"claude","model":"claude-opus-5-5","effort":"max"}}}}'
$global:VerdictWrong = '{"ok":true,"result":{"taskId":"task_v","dispatchId":"ctx_v","state":"ready","stage":"input_accepted","launch":{"requested":{"agent":"claude","model":"claude-opus-5-5","effort":"max"},"effective":{"agent":"claude","model":"claude-opus-5-5","effort":"high"}}}}'
$global:StartFailed = '{"ok":true,"result":{"taskId":"task_abc","dispatchId":"ctx_9","state":"failed","stage":"agent_readiness","failedStage":"agent_readiness","lastError":"timeout","recovery":"Close it with: orca orchestration worker-release --dispatch ctx_9"}}'

function New-RunDir {
    $dir = Join-Path $TestDrive 'run_test'
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    Set-Content -LiteralPath (Join-Path $dir 'brief.md') -Value "Target: a`nChange: b`nConstraints: c`nOwnership: d/`nAcceptance: e" -Encoding UTF8
    return $dir
}

Describe 'Start-PipelineTask' {
    Context 'worker on a warm Codex terminal' {
        Mock -ModuleName Pipeline Invoke-Orca { $global:CreateOk } -ParameterFilter { $Arguments[1] -eq 'task-create' }
        Mock -ModuleName Pipeline Invoke-Orca { $global:StartOk } -ParameterFilter { $Arguments[1] -eq 'worker-start' }

        It 'creates the task and dispatches it onto the given terminal' {
            $r = Start-PipelineTask -Role worker -RunDir (New-RunDir) -Round 1 -Terminal 'term_w' -OrcaExe 'orca.exe' -RolesDir $global:RolesDirForTests
            $r.taskId | Should BeExactly 'task_abc'
            $r.dispatchId | Should BeExactly 'ctx_123'
            $r.stage | Should BeExactly 'input_accepted'
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 1 -ParameterFilter { $Arguments[1] -eq 'task-create' -and $Arguments -contains 'worker-run_test-r1' }
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 1 -ParameterFilter { $Arguments[1] -eq 'worker-start' -and $Arguments -contains '--terminal' -and $Arguments -contains 'term_w' -and $Arguments -contains 'task_abc' }
        }
    }

    Context 'codex role without a terminal' {
        Mock -ModuleName Pipeline Invoke-Orca { throw 'should not be called' }

        It 'throws before calling Orca' {
            { Start-PipelineTask -Role verifier -RunDir (New-RunDir) -Round 1 -OrcaExe 'orca.exe' -RolesDir $global:RolesDirForTests } | Should Throw 'Terminal is required for the verifier role'
        }
    }

    Context 'verdict with matching launch' {
        Mock -ModuleName Pipeline Invoke-Orca { $global:VerdictOk } -ParameterFilter { $Arguments[1] -eq 'worker-start' }

        It 'starts a Claude Opus 5.5 max worker and reports the effective launch' {
            $r = Start-PipelineTask -Role verdict -RunDir (New-RunDir) -Round 1 -OrcaExe 'orca.exe' -RolesDir $global:RolesDirForTests
            $r.dispatchId | Should BeExactly 'ctx_v'
            $r.effectiveModel | Should BeExactly 'claude-opus-5-5'
            $r.effectiveEffort | Should BeExactly 'max'
            Assert-MockCalled Invoke-Orca -ModuleName Pipeline -Exactly -Times 1 -ParameterFilter { ($Arguments -join ' ') -like '*--agent claude --model claude-opus-5-5 --effort max*' }
        }
    }

    Context 'verdict with the wrong effective effort' {
        Mock -ModuleName Pipeline Invoke-Orca { $global:VerdictWrong } -ParameterFilter { $Arguments[1] -eq 'worker-start' }

        It 'throws launch mismatch with the dispatch id' {
            { Start-PipelineTask -Role verdict -RunDir (New-RunDir) -Round 1 -OrcaExe 'orca.exe' -RolesDir $global:RolesDirForTests } | Should Throw 'launch mismatch for ctx_v'
        }
    }

    Context 'failed worker-start receipt' {
        Mock -ModuleName Pipeline Invoke-Orca { $global:CreateOk } -ParameterFilter { $Arguments[1] -eq 'task-create' }
        Mock -ModuleName Pipeline Invoke-Orca { $global:StartFailed } -ParameterFilter { $Arguments[1] -eq 'worker-start' }

        It 'throws with the failed stage and the recovery instruction' {
            { Start-PipelineTask -Role worker -RunDir (New-RunDir) -Round 1 -Terminal 'term_w' -OrcaExe 'orca.exe' -RolesDir $global:RolesDirForTests } | Should Throw 'worker-start failed at agent_readiness: Close it with: orca orchestration worker-release --dispatch ctx_9'
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests/StartTask.Tests.ps1 -EnableExit"`
Expected: FAIL with `The term 'Start-PipelineTask' is not recognized`.

- [ ] **Step 3: Append the implementation to `Pipeline.psm1`**

```powershell
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
```

- [ ] **Step 4: Create `start-task.ps1`**

```powershell
param(
    [Parameter(Mandatory = $true)][ValidateSet('worker', 'verifier', 'verdict')][string]$Role,
    [Parameter(Mandatory = $true)][string]$RunDir,
    [Parameter(Mandatory = $true)][int]$Round,
    [string]$FindingsPath,
    [string]$Terminal
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Import-Module (Join-Path $PSScriptRoot 'Pipeline.psm1') -Force
try {
    Start-PipelineTask -Role $Role -RunDir $RunDir -Round $Round -FindingsPath $FindingsPath -Terminal $Terminal | ConvertTo-Json -Compress
    exit 0
}
catch {
    [Console]::Error.WriteLine("start-task failed: $($_.Exception.Message)")
    exit 1
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester -Script .claude/skills/pipeline/scripts/tests -EnableExit"`
Expected: `Tests Passed: 56, Failed: 0`

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/pipeline/scripts/Pipeline.psm1 .claude/skills/pipeline/scripts/start-task.ps1 .claude/skills/pipeline/scripts/tests/StartTask.Tests.ps1
git commit -m "feat(pipeline): dispatch worker, verifier and verdict tasks through Orca" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Architect playbook (SKILL.md)

**Files:**
- Create: `.claude/skills/pipeline/SKILL.md`

**Interfaces:**
- Consumes: every script from Tasks 2-6, the role files from Task 5, and the `sonnet-small` subagent from Task 8.
- Produces: the `pipeline` skill, invocable as `/pipeline`.

- [ ] **Step 1: Write `SKILL.md`**

````markdown
---
name: pipeline
description: Cross-vendor coding pipeline for this repository. This Claude Opus 5.5 xhigh session is the Architect; Codex GPT-6 Luna max implements, Codex GPT-6 Sol xhigh verifies independently, and a fresh Claude Opus 5.5 max session gives the final verdict, all orchestrated through Orca. Use when the user types /pipeline or asks for the pipeline, or when a coding request meets the sizing rule (more than 3 files or more than one module, a behavior change that needs tests, or security, auth, data, migration, or public-interface changes). For smaller localized edits, delegate to the sonnet-small subagent instead.
---

# Pipeline (Architect playbook)

Design: `docs/superpowers/specs/2026-09-29-cross-vendor-pipeline-design.md`. Run every command from the repository root in PowerShell. Shell state does not persist between tool calls, so set `$orca` and `$S` in every call:

```powershell
$orca = Join-Path $env:LOCALAPPDATA 'Programs\orca\resources\bin\orca.exe'
$S = '.claude/skills/pipeline/scripts'
```

## 0. Classify

State the classification to the user before acting.

- **Pipeline:** more than 3 files, or more than one module or layer; a behavior change that needs new or updated tests; security, auth, data persistence, migrations, or public interfaces; or the user asked for the pipeline.
- **Small:** everything else. Delegate with the Agent tool (`subagent_type: sonnet-small`), then read `git diff` yourself. Report the files, the verification evidence, and your review. You do not commit unless the user asks.

## 1. Preconditions

- `& $orca status --json` must show `"runtimeReachable": true`. If it does not, stop and ask the user to open Orca.
- `git status --porcelain` must be empty. If it is not, stop and ask the user to commit or stash their work.

## 2. Start the run

1. Run `& $orca orchestration run-create --objective "<one-line objective>" --json` and note `result.run.id` as `<run>`.
2. Create `.scratch/pipeline/<run>/`.
3. Write `.scratch/pipeline/<run>/brief.md`. Use no double quotes, and state Ownership as exact paths, or directories ending in `/`:
   ```
   PIPELINE-RUN: <run>   ROUND: 1
   Target:      ...
   Change:      ...
   Constraints: ...
   Ownership:   path/a.ts, dir/
   Acceptance:  <command> -> <expected result>; <command> -> <expected result>
   ```
4. Start `.scratch/pipeline/<run>/ledger.md`. Append one line per event:
   `<UTC time> | <role> r<N> | <handle or dispatch> | <evidence or outcome>`

## 3. Rounds (N = 1, 2, 3; at most 2 fix rounds)

### 3a. Worker

- **Round 1, or when the Worker terminal is gone:**
  `$w = & "$S/warm-codex.ps1" -Model gpt-6-luna -Effort max -Title luna-<run> | ConvertFrom-Json`
  Record `$w.statusLine`, which must be `GPT-6-Luna max`, in the ledger. A non-zero exit means: retry once, then stop and report.
- **Dispatch:**
  `& "$S/start-task.ps1" -Role worker -RunDir .scratch/pipeline/<run> -Round <N> -Terminal <luna handle> [-FindingsPath <previous verifier or verdict report>]`
- **Wait:** `& "$S/wait-worker.ps1" -DispatchId <dispatchId>`
  - `kind: done`: run `& $orca orchestration worker-release --dispatch <dispatchId> --json`. Orca reports `retained` because the Luna terminal existed before the dispatch, so the terminal stays open for fix rounds. `outcome: failed` consumes this round.
  - `kind: attention`: answer questions with `& $orca orchestration reply --id <message id> --body "<answer>" --json`, then acknowledge with `& $orca orchestration check --ack <deliveryId> --json` and wait again. Treat an unexpected `worker_done` as a protocol error and report it.
  - `kind: stalled`: follow `& $orca orchestration worker-list --run <run> --json` `nextAction`, per `orca skills get orchestration`. Never stop or retry without positive proof of exit.

### 3b. Capture the Worker's change

```powershell
git diff HEAD --binary --output=.scratch/pipeline/<run>/diff-r<N>.patch
git ls-files --others --exclude-standard | Set-Content .scratch/pipeline/<run>/untracked-r<N>.txt -Encoding UTF8
& "$S/check-ownership.ps1" -Allowed '<ownership entries, comma separated>'
```

An ownership violation fails the round. Write `.scratch/pipeline/<run>/ownership-r<N>.md` listing the violations, use it as the findings for the next round, and skip 3c and 3d.

### 3c. Verifier (fresh terminal every round)

```powershell
& "$S/repo-snapshot.ps1" -OutFile .scratch/pipeline/<run>/snap-verifier-r<N>.json
$v = & "$S/warm-codex.ps1" -Model gpt-6-sol -Effort xhigh -Title sol-<run>-r<N> | ConvertFrom-Json
& "$S/start-task.ps1" -Role verifier -RunDir .scratch/pipeline/<run> -Round <N> -Terminal $v.handle
& "$S/wait-worker.ps1" -DispatchId <dispatchId>
& $orca orchestration worker-release --dispatch <dispatchId> --json
& $orca terminal close --terminal $v.handle --json
& "$S/repo-snapshot.ps1" -CompareTo .scratch/pipeline/<run>/snap-verifier-r<N>.json
```

- If the final command exits 1, the Verifier changed the repository. Void its report, record the changed fields in the ledger, and stop the run.
- Read the decision:
  `powershell -NoProfile -Command "Import-Module $S/Pipeline.psm1; Get-ReportDecision -Path .scratch/pipeline/<run>/verifier-r<N>.md -Kind verifier"`
- `FAIL` sends the findings (`verifier-r<N>.md`) to the next round. If this was round 3, stop and ask the user.

### 3d. Final Verdict (fresh Claude session every round)

```powershell
& "$S/repo-snapshot.ps1" -OutFile .scratch/pipeline/<run>/snap-verdict-r<N>.json
& "$S/start-task.ps1" -Role verdict -RunDir .scratch/pipeline/<run> -Round <N>
& "$S/wait-worker.ps1" -DispatchId <dispatchId>
& $orca orchestration worker-release --dispatch <dispatchId> --json
& "$S/repo-snapshot.ps1" -CompareTo .scratch/pipeline/<run>/snap-verdict-r<N>.json
```

- Record `effectiveModel/effectiveEffort` (`claude-opus-5-5/max`) in the ledger. Handle a snapshot change the same way as in 3c.
- Read the decision with `Get-ReportDecision -Kind verdict`.
- `CHANGES_REQUESTED` sends the findings (`verdict-r<N>.md`) to the next round. If this was round 3, stop and ask the user.
- `APPROVE`: go to 4.

## 4. Commit (never push or merge)

Stage only the Ownership paths, check that nothing else is staged, then commit:

```powershell
git add -- <ownership paths>
git diff --cached --name-only
git commit -m "<type>: <summary>" -m "Pipeline-Run: <run>`nVerdict: APPROVE`nVerifier: PASS" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 5. Cleanup and report

- Close the Luna terminal: `& $orca terminal close --terminal <luna handle> --json`. Its Dispatches were already released in 3a.
- `& $orca orchestration worker-list --run <run> --terminal-state reclaimable --json` must report `"total": 0`.
- Report to the user:
  - the run id and the number of rounds;
  - the per-role model evidence from the ledger;
  - the Verifier result and the Verdict;
  - the commit hash;
  - the path to `.scratch/pipeline/<run>/`.

## Rules

- Never give the Verifier or the Verdict the Worker report or any transcript.
- Never run two roles at the same time.
- Never relaunch after a failed `start-task.ps1` without following its recovery message.
- Never push, merge or open a pull request.
````

- [ ] **Step 2: Verify every referenced script and role exists**

Run:
```powershell
$skill = Get-Content .claude/skills/pipeline/SKILL.md -Raw
foreach ($name in @('warm-codex.ps1','start-task.ps1','wait-worker.ps1','repo-snapshot.ps1','check-ownership.ps1','Pipeline.psm1')) { "$name referenced=$($skill.Contains($name)) exists=$(Test-Path .claude/skills/pipeline/scripts/$name)" }
foreach ($role in @('worker','verifier','verdict')) { "roles/$role.md exists=$(Test-Path .claude/skills/pipeline/roles/$role.md)" }
```
Expected: every line shows `referenced=True exists=True`, and every role shows `exists=True`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pipeline/SKILL.md
git commit -m "feat(pipeline): add Architect playbook skill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Repository routing configuration

**Files:**
- Create: `.claude/agents/sonnet-small.md`
- Create: `AGENTS.md`
- Modify: `.claude/settings.json`
- Modify: `CLAUDE.md` (append section)
- Modify: `.gitignore` (append line)
- Delete: `.claude/agents/luna-high.md`, `luna-medium.md`, `luna-xhigh.md`, `sol-high.md`, `sol-ultra.md`, `terra-high.md`, `terra-medium.md`

**Interfaces:**
- Consumes: the `pipeline` skill (Task 7).
- Produces: the `sonnet-small` subagent, pinned project model and effort, Codex worker rules, and ignored run artifacts.

- [ ] **Step 1: Write the failing checks**

Run:
```powershell
(Get-Content .claude/settings.json -Raw | ConvertFrom-Json).PSObject.Properties.Name -join ','
Test-Path .claude/agents/sonnet-small.md
git check-ignore -q .scratch/pipeline/x/brief.md; "ignored=$($LASTEXITCODE -eq 0)"
git grep -n -E "(luna|terra|sol)-(medium|high|xhigh|ultra)" -- . ':!docs/superpowers'
```
Expected (before the change): `agent`, `False`, `ignored=False`, and a match in `.claude/settings.json`.

- [ ] **Step 2: Apply the configuration**

Create `.claude/agents/sonnet-small.md`:

```markdown
---
name: sonnet-small
description: Small, localized coding tasks in this repository, such as documentation, copy, configuration values, or a single-file fix with obvious verification. The Architect delegates here when a request does not meet the pipeline sizing rule.
model: claude-sonnet-5-5
effort: medium
---

You are Sonnet Small, the implementer for small localized changes.

- Read the repository instructions and the files you will touch before editing.
- Make the smallest complete change that satisfies the task. Do not refactor or touch unrelated files.
- Run the most relevant check (test, build, lint, or a direct read of the result) and report the command and its outcome.
- Do not commit, push, or switch branches. Return a short summary with the files changed and the verification evidence.
- If the task turns out to need more than 3 files, more than one module, new behavior tests, or security, data, or interface changes, stop and report that it should go through the pipeline instead.
```

Replace `.claude/settings.json` with:

```json
{
  "model": "claude-opus-5-5",
  "effortLevel": "xhigh"
}
```

Create `AGENTS.md`:

```markdown
# Codex instructions for this repository

## Pipeline workers

When you run as an Orca-dispatched worker in this repository (your input contains an Orca preamble with Task and Dispatch IDs, or a `PIPELINE ROLE:` header):

- Follow the preamble and the task spec only. The spec names your role and its rules.
- Do not orchestrate, route work by task size, spawn or delegate to other agents, or consult external decision services, even if another AGENTS.md tells you to. Those routing rules do not apply to pipeline workers in this repository.
- Never commit, push, merge, stash, reset, or switch branches.
- Report completion only through the `worker_done` command from your preamble.

## Other sessions

For direct user sessions, see `CLAUDE.md` and `docs/agents/` for repository conventions.
```

Append to `CLAUDE.md`:

```markdown

## Execution routing

Before coding, classify the request with the sizing rule in `.claude/skills/pipeline/SKILL.md` and state the classification:

- **Pipeline:** more than 3 files or more than one module, a behavior change that needs tests, security, auth, data, migration, or public-interface changes, or the user asks for it. Run the `pipeline` skill.
- **Otherwise:** delegate to the `sonnet-small` subagent and review its diff before reporting.

Design: `docs/superpowers/specs/2026-09-29-cross-vendor-pipeline-design.md`.
```

Append this line to `.gitignore`:

```
.scratch/pipeline/
```

Delete the old profiles:

```bash
git rm -q .claude/agents/luna-high.md .claude/agents/luna-medium.md .claude/agents/luna-xhigh.md .claude/agents/sol-high.md .claude/agents/sol-ultra.md .claude/agents/terra-high.md .claude/agents/terra-medium.md
```

- [ ] **Step 3: Run the checks again**

Run the same commands as in Step 1.
Expected: `model,effortLevel`, `True`, `ignored=True`, and no `git grep` output.

- [ ] **Step 4: Verify that Claude Code honors the project model**

Run: `claude -p --output-format json "Reply with exactly: ROUTING-OK" | ConvertFrom-Json | ForEach-Object { "$($_.result) | $(($_.modelUsage.PSObject.Properties.Name) -join ',')" }`
Expected: `ROUTING-OK | claude-opus-5-5`, with no settings validation warning on stderr.

- [ ] **Step 5: Verify the sonnet-small subagent model**

Run: `claude -p --agent sonnet-small --output-format json "Reply with exactly: SMALL-OK" | ConvertFrom-Json | ForEach-Object { "$($_.result) | $(($_.modelUsage.PSObject.Properties.Name) -join ',')" }`
Expected: `SMALL-OK | claude-sonnet-5-5`

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/sonnet-small.md .claude/settings.json AGENTS.md CLAUDE.md .gitignore
git commit -m "feat(pipeline): route repo work through the pipeline and sonnet-small" -m "Removes the Luna/Terra/Sol Claude profiles and the default agent, which leaked its persona into Orca-launched Claude workers." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Live verification of warm Codex launches

**Files:**
- None created. This is live verification against Orca.

**Interfaces:**
- Consumes: `warm-codex.ps1` (Task 2).
- Produces: evidence that the Luna max and Sol xhigh launches work live and that a mismatch closes its terminal.

- [ ] **Step 1: Warm Luna max**

Run:
```powershell
$orca = Join-Path $env:LOCALAPPDATA 'Programs\orca\resources\bin\orca.exe'
$r = & .claude/skills/pipeline/scripts/warm-codex.ps1 -Model gpt-6-luna -Effort max -Title live-luna
"exit=$LASTEXITCODE $r"
& $orca terminal close --terminal (($r | ConvertFrom-Json).handle) --json | Out-Null
```
Expected: `exit=0 {"handle":"term_...","statusLine":"GPT-6-Luna max"}`

- [ ] **Step 2: Warm Sol xhigh**

Run the same commands with `-Model gpt-6-sol -Effort xhigh -Title live-sol`.
Expected: `exit=0 {"handle":"term_...","statusLine":"GPT-6-Sol xhigh"}`

- [ ] **Step 3: A forced mismatch closes its terminal**

Run:
```powershell
$orca = Join-Path $env:LOCALAPPDATA 'Programs\orca\resources\bin\orca.exe'
$before = [regex]::Matches((& $orca terminal list --json | Out-String), '"handle"').Count
& .claude/skills/pipeline/scripts/warm-codex.ps1 -Model gpt-6-luna -Effort max -Title live-mismatch -ExpectedLabel 'GPT-6-Luna high'
"exit=$LASTEXITCODE"
$after = [regex]::Matches((& $orca terminal list --json | Out-String), '"handle"').Count
"terminal count unchanged: $($before -eq $after)"
```
Expected: stderr shows `warm-codex failed: status mismatch ... expected 'GPT-6-Luna high', got 'GPT-6-Luna max'`, then `exit=1`, then `terminal count unchanged: True`. Count terminals rather than search for the title, because Orca rewrites terminal titles, as seen in the spikes.

- [ ] **Step 4: Record the results**

Append the three results (the status lines and the mismatch exit code) to the implementation notes for the final report. Nothing is committed in this task.

---

### Task 10: End-to-end pipeline runs

**Files:**
- Temporary: branch `pipeline-e2e`, deleted at the end.
- Temporary: `sandbox/pipeline-e2e/` on that branch only.

**Interfaces:**
- Consumes: the whole pipeline (Tasks 1-8). The Architect is the current Claude Opus 5.5 xhigh session.
- Produces: evidence for spec section 12, items 2 to 5.

- [ ] **Step 1: Create the throwaway branch**

Run: `git switch -c pipeline-e2e`
Expected: `Switched to a new branch 'pipeline-e2e'`

- [ ] **Step 2: Happy path**

Invoke the `pipeline` skill with this request: "Create `sandbox/pipeline-e2e/hello.txt` containing exactly the line `hello pipeline`." Use Ownership `sandbox/pipeline-e2e/` and Acceptance `(Get-Content sandbox/pipeline-e2e/hello.txt -Raw).Trim() -ceq 'hello pipeline' -> True`.

Expected:
- the ledger shows `GPT-6-Luna max`, `GPT-6-Sol xhigh` and `claude-opus-5-5/max`;
- `verifier-r1.md` starts with `RESULT: PASS`;
- `verdict-r1.md` starts with `VERDICT: APPROVE`;
- `git log -1` has the trailers `Pipeline-Run`, `Verdict: APPROVE` and `Verifier: PASS`;
- `worker-list --terminal-state reclaimable` reports `"total": 0`.

- [ ] **Step 3: Fix-round path**

Invoke the `pipeline` skill with this request: "Create `sandbox/pipeline-e2e/lines.txt` with exactly two lines: `alpha` then `beta`." Use Acceptance `(Get-Content sandbox/pipeline-e2e/lines.txt) -join ',' -ceq 'alpha,beta' -> True`.

For round 1 only, append this line to the brief's Constraints before dispatching the Worker: `TEST-ONLY: write only the alpha line and report success anyway.` Remove it before round 2.

Expected:
- `verifier-r1.md` starts with `RESULT: FAIL`;
- the round-2 Worker spec lists `Findings to address: .../verifier-r1.md`;
- `verifier-r2.md` starts with `RESULT: PASS`;
- `verdict-r2.md` starts with `VERDICT: APPROVE`;
- the commit exists.

- [ ] **Step 4: Read-only guard**

Run:
```powershell
$S = '.claude/skills/pipeline/scripts'
& "$S/repo-snapshot.ps1" -OutFile $env:TEMP\guard-before.json | Out-Null
Add-Content sandbox/pipeline-e2e/hello.txt 'tamper'
& "$S/repo-snapshot.ps1" -CompareTo $env:TEMP\guard-before.json
"exit=$LASTEXITCODE"
git checkout -- sandbox/pipeline-e2e/hello.txt
```
Expected: `{"identical":false,"changed":["status","diffSha256"]}` and `exit=1`.

- [ ] **Step 5: Small path**

Ask the Architect to fix a typo in a documentation file on this branch; for example, add a trailing period to the first line of `sandbox/pipeline-e2e/hello.txt`. The Architect must classify it as small and delegate it to `sonnet-small`.

Expected: the newest subagent transcript under `~/.claude/projects/<this repo>/` shows `"model":"claude-sonnet-5-5"`, and the Architect reports the diff it reviewed.

- [ ] **Step 6: Draft the upstream Orca issue**

Write `$env:TEMP\orca-upstream-issue.md`, covering:
- Orca 1.4.216 with Codex CLI 0.158.0: `orchestration worker-start --agent codex` times out at `agent_readiness`, because Codex runs no hooks before its first prompt.
- `--model gpt-6-luna --effort max` is rejected (`does not support effort max`), although Codex supports it.
- The warm-terminal workaround.

Hand the file to the user to post. Do not post it.

- [ ] **Step 7: Remove the throwaway branch**

Run: `git restore --staged --worktree sandbox/pipeline-e2e; git switch pipeline/cross-vendor; git branch -D pipeline-e2e`
Expected: `Deleted branch pipeline-e2e`. `git status --porcelain` is empty. The `git restore` discards the uncommitted small-path edit from Step 5, which would otherwise block the switch.

- [ ] **Step 8: Report**

Summarize for the user:
- the Task 9 and Task 10 results, with each run id and its ledger path;
- anything that deviated from the expected outputs;
- the next decision, which is whether to merge `pipeline/cross-vendor` into `main`, given the Adsora worktree conflicts noted in spec section 13.
