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

Describe 'Final review fixes: repo guards' {
    It 'reports both sides of a working-tree rename found through intent-to-add' {
        $repo = New-TestRepo
        Move-Item -LiteralPath (Join-Path $repo 'tracked.txt') -Destination (Join-Path $repo 'renamed.txt')
        & git -C $repo add -N renamed.txt
        $v = @(Get-OwnershipViolation -AllowedPaths @('src/') -RepoPath $repo)
        (@($v | Sort-Object) -join '|') | Should BeExactly 'renamed.txt|tracked.txt'
    }
    It 'handles a working-tree rename whose source name has two characters' {
        $repo = New-TestRepo
        Set-Content -LiteralPath (Join-Path $repo 'ab') -Value 'x' -Encoding Ascii
        & git -C $repo add ab
        & git -C $repo commit -q -m ab
        Move-Item -LiteralPath (Join-Path $repo 'ab') -Destination (Join-Path $repo 'cd.txt')
        & git -C $repo add -N cd.txt
        $v = @(Get-OwnershipViolation -AllowedPaths @('src/') -RepoPath $repo)
        (@($v | Sort-Object) -join '|') | Should BeExactly 'ab|cd.txt'
    }
    It 'repo-snapshot.ps1 exits 3 when the saved baseline does not match the expected fingerprint' {
        $repo = New-TestRepo
        $script = Join-Path $PSScriptRoot '..\repo-snapshot.ps1'
        $before = Join-Path $TestDrive 'fp-before.json'
        $printed = (& $script -RepoPath $repo -OutFile $before | Out-String) | ConvertFrom-Json
        $fingerprint = $printed.fingerprint
        $fingerprint | Should Match '^[0-9a-f]{64}$'
        Set-Content -LiteralPath (Join-Path $repo 'tracked.txt') -Value 'changed' -Encoding Ascii
        $tampered = Get-RepoSnapshot -RepoPath $repo
        $tampered | ConvertTo-Json | Set-Content -LiteralPath $before -Encoding UTF8
        & $script -RepoPath $repo -CompareTo $before -ExpectFingerprint $fingerprint | Out-Null
        $LASTEXITCODE | Should Be 3
    }
    It 'repo-snapshot.ps1 compares normally when the baseline fingerprint matches' {
        $repo = New-TestRepo
        $script = Join-Path $PSScriptRoot '..\repo-snapshot.ps1'
        $before = Join-Path $TestDrive 'fp-ok.json'
        $fingerprint = ((& $script -RepoPath $repo -OutFile $before | Out-String) | ConvertFrom-Json).fingerprint
        & $script -RepoPath $repo -CompareTo $before -ExpectFingerprint $fingerprint | Out-Null
        $LASTEXITCODE | Should Be 0
    }
}
