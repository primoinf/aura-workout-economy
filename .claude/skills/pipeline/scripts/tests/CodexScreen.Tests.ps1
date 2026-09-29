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
