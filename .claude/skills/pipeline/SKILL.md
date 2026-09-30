---
name: pipeline
description: Cross-vendor coding pipeline for this repository. This Claude Opus 5.5 xhigh session is the Architect; Codex GPT-6 Luna max implements, Codex GPT-6.1 Sol xhigh verifies independently, and a fresh Claude Opus 5.5 max session gives the final verdict, all orchestrated through Orca. Use when the user types /pipeline or asks for the pipeline, or when a coding request meets the sizing rule (more than 3 files or more than one module, a behavior change that needs tests, or security, auth, data, migration, or public-interface changes). For smaller localized edits, delegate to the sonnet-small subagent instead.
---

# Pipeline (Architect playbook)

Design: `docs/superpowers/specs/2026-09-29-cross-vendor-pipeline-design.md`.

Run every command from the repository root in PowerShell. Shell state does not persist between tool calls, so set these two variables in every call:

```powershell
$orca = Join-Path $env:LOCALAPPDATA 'Programs\orca\resources\bin\orca.exe'
$PipelineScripts = '.claude/skills/pipeline/scripts'
```

PowerShell variable names are case-insensitive. Never add a variable whose name differs from one of these only by letter case.

Long-running commands:

- **`warm-codex.ps1`** can take up to 6 minutes. Give its tool call a timeout of at least 420000 ms, and always pass `-HandleFile`. If the call is killed anyway, read the handle from that file and close the terminal with `& $orca terminal close --terminal <handle> --json`.
- **`wait-worker.ps1`** can wait for a long time. Always run it with `run_in_background: true`; the harness notifies you when it exits. Never run it in the foreground.

## 0. Classify

State the classification to the user before acting.

- **Pipeline:** more than 3 files, or more than one module or layer; a behavior change that needs new or updated tests; security, auth, data persistence, migrations, or public interfaces; or the user asked for the pipeline.
- **Small:** everything else. Delegate with the Agent tool (`subagent_type: sonnet-small`), then read `git diff` yourself. Report the files, the verification evidence, and your review. You do not commit unless the user asks.

## 1. Preconditions

- `& $orca status --json` must show `"reachable": true` in its runtime block (the text-mode label for the same field is `runtimeReachable`). If it does not, stop and ask the user to open Orca.
- `git status --porcelain` must be empty. If it is not, stop and ask the user to commit or stash their work.

## 2. Start the run

1. Run `& $orca orchestration run-create --objective "<one-line objective>" --json` and note `result.run.id` as `<run>`.
2. Create `.scratch/pipeline/<run>/`.
3. Write `.scratch/pipeline/<run>/brief.md`. Use no double quotes, and state Ownership as exact paths, or directories ending in `/`:
   ```
   PIPELINE-RUN: <run>
   Target:      ...
   Change:      ...
   Constraints: ...
   Ownership:   path/a.ts, dir/
   Acceptance:  <command> -> <expected result>; <command> -> <expected result>
   ```
4. Record the brief hash:
   ```powershell
   (Get-FileHash -Algorithm SHA256 .scratch/pipeline/<run>/brief.md).Hash
   ```
   Keep that value in your own context as `<briefSha>`; the agents can write to the run folder, so the file on disk is not proof on its own. Pass `-BriefSha256 <briefSha>` to every `start-task.ps1` call. If you edit the brief yourself between rounds, record the new hash.
5. Start `.scratch/pipeline/<run>/ledger.md`. Append one line per event:
   `<UTC time> | <role> r<N> | <handle or dispatch> | <evidence or outcome>`

## 3. Rounds (N = 1, 2, 3; at most 2 fix rounds)

### 3a. Worker

- **Warm the terminal.** In round 1, or when the Worker terminal is gone, run with a tool timeout of at least 420000 ms:
  ```powershell
  & "$PipelineScripts/warm-codex.ps1" -Model gpt-6-luna -Effort max -Title luna-<run> -HandleFile .scratch/pipeline/<run>/luna.handle
  ```
  Record the printed `statusLine`, which must be `GPT-6-Luna max`, in the ledger. A non-zero exit means: retry once, then stop and report.
- **Dispatch:**
  ```powershell
  & "$PipelineScripts/start-task.ps1" -Role worker -RunDir .scratch/pipeline/<run> -Round <N> -Terminal <luna handle> -BriefSha256 <briefSha> [-FindingsPath <previous verifier or verdict report>]
  ```
  - A `stage` of `input_submitted_after_paste` is normal: Codex swallowed Orca's Enter for a long task and `start-task.ps1` pressed it once. Record it in the ledger.
  - `brief.md changed` means the brief no longer matches `<briefSha>`. Stop and report.
- **Wait** in the background: `& "$PipelineScripts/wait-worker.ps1" -DispatchId <dispatchId>`
  - `kind: done` with that same `dispatchId`: run `& $orca orchestration worker-release --dispatch <dispatchId> --json`. Orca reports `retained` because the Luna terminal existed before the dispatch, so the terminal stays open for fix rounds. `outcome: failed` consumes this round.
  - `kind: attention`: answer questions with `& $orca orchestration reply --id <message id> --body "<answer>" --json`, then acknowledge with `& $orca orchestration check --ack <deliveryId> --json`, and wait again. Treat an unexpected `worker_done` as a protocol error and report it.
  - `kind: stalled`: follow the `nextAction` from `& $orca orchestration worker-list --run <run> --json`, per `orca skills get orchestration`. Never stop or retry without positive proof of exit.

### 3b. Capture the Worker's change

```powershell
git diff HEAD --binary --output=.scratch/pipeline/<run>/diff-r<N>.patch
[System.IO.File]::WriteAllLines((Join-Path (Get-Location) '.scratch/pipeline/<run>/untracked-r<N>.txt'), [string[]]@(git ls-files --others --exclude-standard))
& "$PipelineScripts/check-ownership.ps1" -Allowed '<ownership entries, comma separated>'
```

- Exit 1 is an ownership violation, and fails the round. Write `.scratch/pipeline/<run>/ownership-r<N>.md` listing the violations, use it as the findings for the next round, and skip 3c and 3d.
- Exit 2 means the check itself failed. Stop and report.

### 3c. Verifier (fresh terminal every round)

Run one step per tool call. Check each result before the next step.

1. Take the baseline snapshot:
   ```powershell
   & "$PipelineScripts/repo-snapshot.ps1" -OutFile .scratch/pipeline/<run>/snap-verifier-r<N>.json
   ```
   Keep the printed `fingerprint` in your context.
2. Warm Sol, with a tool timeout of at least 420000 ms:
   ```powershell
   & "$PipelineScripts/warm-codex.ps1" -Model gpt-6.1-sol -Effort xhigh -Title sol-<run>-r<N> -HandleFile .scratch/pipeline/<run>/sol-r<N>.handle
   ```
   The `statusLine` must be `GPT-6.1-Sol xhigh`.
3. Dispatch:
   ```powershell
   & "$PipelineScripts/start-task.ps1" -Role verifier -RunDir .scratch/pipeline/<run> -Round <N> -Terminal <sol handle> -BriefSha256 <briefSha>
   ```
4. Wait in the background: `& "$PipelineScripts/wait-worker.ps1" -DispatchId <dispatchId>`. Handle `attention` and `stalled` as in 3a.
5. Only after `wait-worker.ps1` returns `kind: done` for that same `dispatchId`:
   - release the dispatch with `& $orca orchestration worker-release --dispatch <dispatchId> --json`;
   - close the terminal with `& $orca terminal close --terminal <sol handle> --json`.

   Never release or close while the Verifier might still be working.
6. Compare against the baseline:
   ```powershell
   & "$PipelineScripts/repo-snapshot.ps1" -CompareTo .scratch/pipeline/<run>/snap-verifier-r<N>.json -ExpectFingerprint <fingerprint>
   ```
   - Exit 0: nothing changed.
   - Exit 1: the Verifier changed the repository.
   - Exit 3: the saved baseline was altered.

   On exit 1 or 3, void the report, record the details in the ledger, and stop the run.
7. Read the decision:
   ```powershell
   & "$PipelineScripts/report-decision.ps1" -Path .scratch/pipeline/<run>/verifier-r<N>.md -Kind verifier
   ```
   - It prints `PASS` or `FAIL`. Exit 1 means the header is invalid or the report is missing; treat that as `FAIL`.
   - `FAIL` sends the findings (`verifier-r<N>.md`) to the next round. If this was round 3, stop and ask the user.

### 3d. Final Verdict (fresh Claude session every round)

1. Take the baseline snapshot:
   ```powershell
   & "$PipelineScripts/repo-snapshot.ps1" -OutFile .scratch/pipeline/<run>/snap-verdict-r<N>.json
   ```
   Keep the printed `fingerprint`.
2. Dispatch:
   ```powershell
   & "$PipelineScripts/start-task.ps1" -Role verdict -RunDir .scratch/pipeline/<run> -Round <N> -BriefSha256 <briefSha>
   ```
   Record `effectiveModel/effectiveEffort` (`claude-opus-5-5/max`) in the ledger.
3. Wait in the background: `& "$PipelineScripts/wait-worker.ps1" -DispatchId <dispatchId>`.
4. Only after `wait-worker.ps1` returns `kind: done` for that same `dispatchId`: `& $orca orchestration worker-release --dispatch <dispatchId> --json`.
5. Compare against the baseline:
   ```powershell
   & "$PipelineScripts/repo-snapshot.ps1" -CompareTo .scratch/pipeline/<run>/snap-verdict-r<N>.json -ExpectFingerprint <fingerprint>
   ```
   Handle exit codes as in 3c.
6. Read the decision:
   ```powershell
   & "$PipelineScripts/report-decision.ps1" -Path .scratch/pipeline/<run>/verdict-r<N>.md -Kind verdict
   ```
   - It prints `APPROVE` or `CHANGES_REQUESTED`. Exit 1 means the header is invalid or the report is missing; treat that as `CHANGES_REQUESTED`.
   - `CHANGES_REQUESTED` sends the findings (`verdict-r<N>.md`) to the next round. If this was round 3, stop and ask the user.
   - `APPROVE`: go to 4.

## 4. Commit (never push or merge)

Stage only the Ownership paths and check that nothing else is staged:

```powershell
git add -- <ownership paths>
git diff --cached --name-only
```

Then commit. Keep all four metadata lines in the final `-m`, so that git treats them as trailers:

```powershell
git commit -m "<type>: <summary>" -m "Pipeline-Run: <run>`nVerdict: APPROVE`nVerifier: PASS`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 5. Cleanup and report

- Close the Luna terminal: `& $orca terminal close --terminal <luna handle> --json`. Its dispatches were already released in 3a.
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
- Never release a dispatch or close a terminal before `wait-worker.ps1` returns `kind: done` for it.
- Never relaunch after a failed `start-task.ps1` without following its recovery message.
- Never push, merge or open a pull request.
