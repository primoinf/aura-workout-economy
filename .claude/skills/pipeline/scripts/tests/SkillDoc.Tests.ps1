$skillPath = Join-Path $PSScriptRoot '..\..\SKILL.md'
$skill = Get-Content -LiteralPath $skillPath -Raw -Encoding UTF8

Describe 'SKILL.md playbook' {
    It 'uses no $S variable, which collides with $s because PowerShell names are case-insensitive' {
        $skill -cmatch '\$S\b' | Should Be $false
    }
    It 'runs wait-worker in the background and gates release on kind done' {
        $skill | Should Match 'run_in_background'
        $skill | Should Match 'Only after .{0,80}kind: done'
    }
    It 'gives warm-codex a long enough tool timeout and a handle file' {
        $skill | Should Match '420000'
        $skill | Should Match '-HandleFile'
    }
    It 'records and checks the brief hash and the baseline fingerprint' {
        $skill | Should Match '-BriefSha256'
        $skill | Should Match '-ExpectFingerprint'
    }
    It 'produces a commit whose metadata lines are real git trailers' {
        $line = @($skill -split "`r?`n" | Where-Object { $_ -match '^git commit ' })[0]
        $line | Should Not BeNullOrEmpty
        $repo = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $repo | Out-Null
        & git -C $repo init -q
        & git -C $repo config user.email 'test@example.com'
        & git -C $repo config user.name 'Pipeline Test'
        Set-Content -LiteralPath (Join-Path $repo 'f.txt') -Value 'x' -Encoding Ascii
        & git -C $repo add f.txt
        $cmd = $line.Replace('<type>: <summary>', 'test: e2e').Replace('<run>', 'run_x')
        Push-Location $repo
        try { Invoke-Expression $cmd | Out-Null } finally { Pop-Location }
        $message = (& git -C $repo log -1 --format=%B) -join "`n"
        $trailers = @($message | & git -C $repo interpret-trailers --parse | Where-Object { $_.Trim() })
        $trailers.Count | Should Be 4
        ($trailers -join '|') | Should Match 'Pipeline-Run: run_x'
        ($trailers -join '|') | Should Match 'Co-Authored-By: Claude Opus 5.5'
    }
}
