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
