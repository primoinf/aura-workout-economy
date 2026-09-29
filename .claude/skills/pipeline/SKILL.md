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
