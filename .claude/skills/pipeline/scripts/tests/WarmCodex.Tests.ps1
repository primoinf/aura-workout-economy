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

Describe 'Final review fixes: warm-codex handle file' {
    Context 'handle file is written before polling' {
        $global:HandleFileForTest = Join-Path $TestDrive 'warm-handle.txt'
        $global:HandleSeenBeforeRead = $false
        $global:WarmReads2 = 0
        Mock -ModuleName Pipeline Start-Sleep { }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true,"result":{"terminal":{"handle":"term_t1"}}}' } -ParameterFilter { $Arguments[1] -eq 'create' }
        Mock -ModuleName Pipeline Invoke-Orca { '{"ok":true,"result":{}}' } -ParameterFilter { $Arguments[1] -eq 'send' }
        Mock -ModuleName Pipeline Invoke-Orca {
            $global:WarmReads2++
            if ($global:WarmReads2 -eq 1) { $global:HandleSeenBeforeRead = Test-Path -LiteralPath $global:HandleFileForTest; return $global:ScreenReadyMax }
            return $global:ScreenWarmMax
        } -ParameterFilter { $Arguments[1] -eq 'read' }

        It 'records the terminal handle so a killed run can still close it' {
            Invoke-WarmCodex -Model 'gpt-6-luna' -Effort 'max' -Title 't' -OrcaExe 'orca.exe' -TimeoutSeconds 5 -PollSeconds 1 -HandleFile $global:HandleFileForTest | Out-Null
            $global:HandleSeenBeforeRead | Should Be $true
            (Get-Content -LiteralPath $global:HandleFileForTest -Raw).Trim() | Should BeExactly 'term_t1'
        }
    }
}
