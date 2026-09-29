# Cross-Vendor Agent Pipeline: Design

- **Date:** 2026-09-29
- **Status:** Draft for review
- **Branch:** `pipeline/cross-vendor` (from local `main` at `e196eae`)
- **Scope:** this repository (GENERAL) only

## 1. Goal

Run substantial coding work through a fixed, verifiable chain of agents from two vendors, orchestrated and made visible in Orca:

| Role | Model / effort | Vendor |
| --- | --- | --- |
| Architect | Claude Opus 5.5 / xhigh | Claude Code (main session) |
| Worker | GPT-6 Luna / max | Codex |
| Independent Verifier | GPT-6 Sol / xhigh | Codex |
| Final Verdict | Claude Opus 5.5 / max | Claude Code |
| Small-task implementer | Claude Sonnet 5.5 / medium | Claude Code subagent |

Success means:

1. Every pipeline run ends with an explicit `APPROVE` or `CHANGES_REQUESTED` verdict backed by recorded evidence.
2. Each role provably ran on its configured model and effort.
3. The Verifier and the Final Verdict never modify the working tree.
4. Nothing is pushed or merged automatically.

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Trigger | The Architect classifies every coding request (section 5). The user can force the pipeline with `/pipeline` or by asking for it. |
| Small tasks | Delegated to the `sonnet-small` subagent (Sonnet 5.5, medium), then the Architect reviews the diff. |
| Scope | Repository-local configuration only. User-level `~/.claude` and `~/.codex` are not modified. |
| Orchestration | Orca orchestration (Runs, Tasks, Dispatches, `worker_done`). Rejected alternatives: Architect calling `codex exec` directly (no Orca visibility) and extending Codex Mission Control (Codex-only by design). |
| Fix rounds | At most 2 fix rounds after the initial Worker attempt (3 Worker dispatches in total). Beyond that the Architect stops and asks the user. |
| Git | After `APPROVE` the Architect commits on the current branch. It never pushes or merges. |

## 3. Roles

| Role | Launch path | Writes | Inputs | Output |
| --- | --- | --- | --- | --- |
| Architect | Main Claude Code session. Project settings pin `claude-opus-5-5` and `xhigh`. | Brief, ledger, final commit | User request | Brief, run summary, commit |
| Worker | Warm Codex terminal (section 7.1) plus `worker-start --terminal` | Files listed under the brief's Ownership, plus its report under `.scratch/pipeline/<run>/` | Brief, plus findings on fix rounds | Working-tree changes, `worker-r<N>.md`, `worker_done` |
| Verifier | Fresh warm Codex terminal each round | Only its report under `.scratch/pipeline/<run>/` | Brief, `diff-r<N>.patch`, untracked-file list. Never the Worker's transcript. | `verifier-r<N>.md` with `RESULT: PASS` or `RESULT: FAIL`, `worker_done` |
| Final Verdict | `worker-start --agent claude --model claude-opus-5-5 --effort max`, fresh each round | Only its report under `.scratch/pipeline/<run>/` | Brief, diff, Verifier report | `verdict-r<N>.md` with `VERDICT: APPROVE` or `VERDICT: CHANGES_REQUESTED`, `worker_done` |
| sonnet-small | Claude Code subagent `.claude/agents/sonnet-small.md` | Files for the small task | Task description | Diff and summary returned to the Architect |

For the Verifier and the Final Verdict, `worker_done --outcome succeeded` means the review finished. The decision itself is the `RESULT:` or `VERDICT:` header in the report file.

## 4. Flow

```
User ─► Architect: classify (section 5) or /pipeline
         ├─ small ─► sonnet-small ─► Architect reviews diff ─► done
         └─ pipeline:
              0. Preconditions: Orca reachable, working tree clean
              1. Write brief.md, run-create, open ledger.md
              2. Worker (round N)    ─► worker_done ─► save diff-r<N>.patch
              3. Verifier (round N)  ─► RESULT: FAIL ─► back to 2 with findings (if rounds remain)
              4. Final Verdict (N)   ─► CHANGES_REQUESTED ─► back to 2 with findings (if rounds remain)
              5. APPROVE ─► Architect commits (no push) ─► cleanup ─► report to user
```

Rounds are shared: a Verifier `FAIL` and a Verdict `CHANGES_REQUESTED` each consume one of the two fix rounds.

## 5. Sizing rule

The Architect states its classification before acting. The user can always override it.

Use the **pipeline** when any of the following is true:

- The change touches more than 3 files or more than one module or layer.
- It changes runtime behavior that needs new or updated tests.
- It touches security, authentication, data persistence, migrations, or public interfaces.
- The user asks for the pipeline.

Otherwise use **sonnet-small**: localized edits with obvious verification, for example documentation, copy, configuration values, or a single-file fix with an existing test.

## 6. Brief format

`brief.md` is the single source of truth for every role:

```
PIPELINE-RUN: <run_id>   ROUND: <N>
Target:      files, component, or environment in scope
Change:      the concrete result to produce
Constraints: invariants, compatibility rules, do-not-touch boundaries
Ownership:   exact paths the Worker may create or edit
Acceptance:  observable checks (commands plus expected output) that prove completion
```

Each task spec is `roles/<role>.md` + `brief.md` + the round-specific inputs (paths to the diff, prior findings).

## 7. Orca mechanics

Every procedure below was verified in spikes `run_195bc188e5cc` and `run_f5d830f6a29b` with Orca 1.4.216 and Codex CLI 0.158.0.

### 7.1 Codex roles: warm-terminal launch

Launching Codex through `worker-start --agent codex` does not work in this setup:

- **Readiness never fires.** The Codex TUI runs no hooks until its first prompt, and `worker-start` waits for a hook-based readiness signal before it injects the task. The start therefore times out at `agent_readiness`.
- **Luna max is rejected.** Orca's model table refuses `max` for `gpt-6-luna`, although Codex supports it.

The workaround, implemented by `scripts/warm-codex.ps1`:

1. `orca terminal create --worktree active --shell powershell.exe --title <role-run-round> --command "codex -m <model> -c model_reasoning_effort=<effort> --dangerously-bypass-approvals-and-sandbox"`
2. Wait until the TUI is up, then `orca terminal send --text "Reply with exactly: WARM" --enter`.
3. Poll `orca terminal read` until both `WARM` and the status line `GPT-6-<Model> <effort>` appear. If the status line does not match within the timeout, fail and close the terminal.
4. Print the terminal handle and the matched status line. The status line is the model evidence recorded in the ledger.

Then run `orca orchestration task-create --spec <spec> --task-title <title>`, followed by `orca orchestration worker-start --task <id> --worktree current --terminal <handle>`.

The sandbox bypass matches how Orca launches its own Codex workers (`YOLO mode`). It is required: with Codex's sandbox on, the `orca` CLI cannot read `%APPDATA%\orca\orca-runtime.json`, so the worker cannot send `worker_done`.

### 7.2 Claude role: native launch

For the Final Verdict, run `orca orchestration worker-start --spec <spec> --task-title <title> --worktree current --agent claude --model claude-opus-5-5 --effort max`. The receipt's `launch.effective` must equal the requested model and effort.

### 7.3 Waiting and cleanup

- Run `orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000`. Validate the `dispatchId` of each message, then `--ack` its delivery.
- After three consecutive empty waits, follow `worker-list` `nextAction` as described in the Orca orchestration skill. Never stop or retry based on the absence of messages alone.
- After settlement, run `worker-release` for each Dispatch. Orca retains pre-existing Codex terminals, so the Architect then runs `orca terminal close` on each warm terminal. The run ends only when `worker-list --run <id> --terminal-state reclaimable` reports `total: 0`.
- The Worker terminal may be reused for its own fix rounds. The Verifier and the Final Verdict always get a fresh terminal.

## 8. Files

### New

| Path | Purpose |
| --- | --- |
| `.claude/skills/pipeline/SKILL.md` | Architect playbook: sizing rule, brief template, the Orca command sequence, round rules, ledger, cleanup, commit. Invocable as `/pipeline` and loaded when the Architect chooses the pipeline. |
| `.claude/skills/pipeline/scripts/warm-codex.ps1` | Deterministic warm launch plus status-line check (section 7.1). Takes `-Model`, `-Effort`, and `-Title`; outputs JSON `{handle, statusLine}` or exits non-zero. |
| `.claude/skills/pipeline/roles/worker.md` | Worker obligations: edit only Ownership paths, run the Acceptance checks, write `worker-r<N>.md`, send `worker_done`. |
| `.claude/skills/pipeline/roles/verifier.md` | Read-only verification against Acceptance: run checks independently, never read the Worker's transcript, write `verifier-r<N>.md` with a `RESULT:` header. |
| `.claude/skills/pipeline/roles/verdict.md` | Read-only final judgment of brief, diff, and Verifier report; findings graded as blocker, should-fix, or note; `VERDICT:` header. |
| `.claude/agents/sonnet-small.md` | `model: claude-sonnet-5-5`, `effort: medium`, localized-change prompt. |
| `AGENTS.md` | Codex instructions for this repo: an Orca-dispatched worker follows its task spec and preamble only; it does not orchestrate, route, delegate, or call external decision services, overriding the global `~/.codex/AGENTS.md` routing for this repo. |

### Changed

| Path | Change |
| --- | --- |
| `.claude/settings.json` | Remove `"agent"`, because the default agent persona leaked into Orca-launched Claude workers during the spikes. Set `"model": "claude-opus-5-5"` and `"effortLevel": "xhigh"`. |
| `.claude/agents/{luna,terra,sol}-*.md` | Delete all 7. The pipeline replaces them. |
| `CLAUDE.md` | Add an "Execution routing" section that points to the pipeline skill and the sizing rule. |
| `.gitignore` | Add `.scratch/pipeline/`. |

## 9. Guardrails

- **Model evidence.** A Codex role is dispatched only after `warm-codex.ps1` matches the expected status line. The Claude verdict is accepted only if `launch.effective` matches. Both are recorded in the ledger.
- **Read-only enforcement.** Before and after each Verifier and Verdict dispatch, the Architect records `git rev-parse HEAD`, `git status --porcelain=v1 -uall`, and the SHA-256 of `git diff HEAD --binary`. Any difference voids that report and stops the run. Reports live under the git-ignored `.scratch/pipeline/`, so writing them does not change the recorded state.
- **Clean start.** The pipeline refuses to start with a dirty working tree, so the diff always equals the Worker's changes.
- **Ownership check.** Before the Verifier runs, the Architect fails the round if the Worker changed any path outside Ownership.
- **Independence.** The Verifier and the Final Verdict receive file paths to the brief, the diff, and prior reports only. Their specs forbid reading other agents' transcripts.

## 10. Failure handling

| Situation | Action |
| --- | --- |
| Orca not reachable or tree dirty | Do not start. Report to the user. |
| `warm-codex.ps1` status mismatch or timeout | Close the terminal, retry once, then stop and report. |
| `worker-start` non-zero | Follow the receipt's `recovery` and `residualResources`. Never relaunch blindly. |
| Worker `worker_done --outcome failed` | Counts as a round. Re-dispatch with its report if rounds remain. |
| Verifier `RESULT: FAIL` or Verdict `CHANGES_REQUESTED` | Re-dispatch the Worker with the findings if rounds remain. Otherwise stop and ask the user. |
| Read-only violation | Void the report, stop the run, report which paths changed. |
| No messages after three waits | Use `worker-list` `nextAction`. Stop or abandon only with positive proof of exit. |

## 11. Artifacts and commit

`.scratch/pipeline/<run_id>/` holds `brief.md`, `ledger.md`, `diff-r<N>.patch`, `worker-r<N>.md`, `verifier-r<N>.md`, and `verdict-r<N>.md`. None of these are committed.

On `APPROVE`, the Architect stages only the Ownership paths and commits with the trailers `Pipeline-Run: <run_id>`, `Verdict: APPROVE`, and `Verifier: PASS`. It does not push or merge.

## 12. Testing plan

1. **Script test.** Run `warm-codex.ps1` for Luna max and for Sol xhigh. It must return a handle and a matching status line. A deliberate mismatch (the wrong expected effort) must exit non-zero and close the terminal.
2. **End-to-end happy path.** Run the pipeline on a tiny real change with a checkable Acceptance. Expect `PASS`, then `APPROVE`, then a commit with trailers, then `reclaimable: 0`.
3. **Fix-round path.** Give an Acceptance that the first attempt cannot meet without a follow-up (for example, a required test output). Expect a Verifier `FAIL`, a Worker re-dispatch, then a pass.
4. **Read-only guard.** Simulate a tracked-file change between the pre- and post-Verifier snapshots. The run must void the report and stop.
5. **Small path.** Run a documentation fix through `sonnet-small`. Its transcript must show `claude-sonnet-5-5`.

## 13. Risks and open issues

- **Unsandboxed Codex.** The Worker and the Verifier run with Codex's sandbox bypassed, which is Orca's default.
  - **What the guards cover:** tracked and untracked (non-ignored) files in this worktree, through the ownership check and the read-only snapshots. The brief is covered by a SHA-256 the Architect keeps in its own context. The snapshot baselines are covered by fingerprints, also kept in the Architect's context.
  - **What they do not cover:**
    - git-ignored paths such as `node_modules/`, build outputs, or the run folder's reports;
    - git refs, the stash, and pushes. These are shared by every worktree, so guarding them would stop runs whenever other sessions work in parallel;
    - files outside the repository, and network access.
  - "Nothing is pushed" therefore rests on the role instructions and `AGENTS.md` for the Codex roles, backed by the Final Verdict's review.
- **Orca readiness defect.** The warm-terminal path depends on current Orca and Codex behavior. Report both issues (hook-based readiness with Codex 0.158, and Luna `max` validation) to stablyai/orca, then revisit native `worker-start --agent codex` when fixed. Whether Codex 0.144 behaved differently is unverified.
- **Model evidence for warm terminals.** It comes from the TUI status line, not from Orca's `launch.effective`.
- **Global Codex instructions.** `~/.codex/AGENTS.md` still asks every Codex session to orchestrate and to consult Jev. The repo `AGENTS.md` and the task specs override this. The spike workers complied, but this is instruction-level, not enforced.
- **Stop hook warning.** Every Codex turn logs `hook returned invalid stop hook JSON output`. It does not block `worker_done`. Fix separately.
- **Pending local work elsewhere.** The Adsora worktree has an untracked `AGENTS.md` and uncommitted edits to the old profiles. Merging this branch will conflict with them. Local `main` is 13 commits ahead of `origin/main`.

## 14. Out of scope

- A user-level (all repositories) rollout.
- Integration with Codex Mission Control.
- Parallel multi-Worker waves within one run.
- Automated push, merge, or pull request creation.
