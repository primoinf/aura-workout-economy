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

Describe 'report-decision.ps1' {
    It 'prints the decision and exits 0' {
        $p = Join-Path $TestDrive 'rd-pass.md'
        Set-Content -LiteralPath $p -Value "RESULT: PASS`nok" -Encoding UTF8
        $script = Join-Path $PSScriptRoot '..\report-decision.ps1'
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Path $p -Kind verifier
        $LASTEXITCODE | Should Be 0
        ($out | Out-String).Trim() | Should BeExactly 'PASS'
    }
    It 'exits 1 on an invalid header' {
        $p = Join-Path $TestDrive 'rd-bad.md'
        Set-Content -LiteralPath $p -Value 'Summary' -Encoding UTF8
        $script = Join-Path $PSScriptRoot '..\report-decision.ps1'
        & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Path $p -Kind verdict 2>$null | Out-Null
        $LASTEXITCODE | Should Be 1
    }
}

Describe 'Final review fixes: brief integrity' {
    It 'accepts a brief whose SHA-256 matches the recorded value' {
        $dir = New-RunDir
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dir 'brief.md')).Hash
        { New-PipelineTaskSpec -Role verifier -RunDir $dir -Round 1 -RolesDir $rolesDir -ExpectedBriefSha256 $hash } | Should Not Throw
    }
    It 'throws when the brief changed after its hash was recorded' {
        $dir = New-RunDir
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dir 'brief.md')).Hash
        Add-Content -LiteralPath (Join-Path $dir 'brief.md') -Value 'Ownership: ./' -Encoding UTF8
        { New-PipelineTaskSpec -Role verifier -RunDir $dir -Round 1 -RolesDir $rolesDir -ExpectedBriefSha256 $hash } | Should Throw 'brief.md changed'
    }
}
