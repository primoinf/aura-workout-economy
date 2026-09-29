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
