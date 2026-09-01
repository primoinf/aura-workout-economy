# Mission Control Push-Readiness Remediation Plan

Created: 2026-08-28 03:11:21 +07:00  
Status: in progress  
Task: TASK-050  
Reviewed range: `273dd100b660ba3aa45d7a868310eaed702e1df7..784ac616ebf3585dcee6dd558e7bf09a2890559b`

## Goal

Make the 12 local Mission Control commits safe to push by removing fabricated production facts, closing release-integrity bypasses, binding Context and Playbook claims to observable Evidence, and repairing committed workspace hygiene. Preserve unrelated dirty work and do not push, merge, release, or deploy without fresh owner authorization.

## Execution policy

- Use Solweaver `team`; the user explicitly authorized work division. Prefer one Terra implementation lane unless a disjoint mechanical lane materially shortens the work.
- `TDD_REQUIRED: yes` for phases 1–5. Read `test-driven-development/SKILL.md` and `writing-good-tests.md` before changing behavior.
- Observable seams: production transport bootstrap, Mission Orchestrator command/replay boundary, Context Pack capture adapter, Playbook evaluation ingestion, and operations-dashboard projection.
- Use focused RED/GREEN checks during implementation. Run the full repository candidate once after all behavior phases are integrated.
- Assurance: `final-strict`, because the remediation covers audit-data integrity, release gates, and public orchestration behavior. Preserve historical Ticket 06 assurance receipts unchanged.

## Work plan

### 0. Freeze scope and reproduce

- Reconfirm base/HEAD and bind every in-scope tracked, modified, and untracked file.
- Keep agent/config, Graphify output, runtime data, generated `dist/`, and Nihongo Dojo out of the behavior candidate unless explicitly listed below.
- Reproduce the disconnected simulator path, legacy release-gate bypass, forged Playbook evaluation, incorrect approval-demand state, broken prototype scripts, and clean-install behavior.

### 1. Fail closed without a real agent transport

- RED: prove the production app cannot dispatch a wave or create Run/Artifact/Evidence/reviewer outcomes when `globalThis.codexAgentTransport` is absent.
- GREEN: remove `localObservedTransport` from production bootstrap, expose an honest disconnected state, and disable dispatch controls.
- Keep deterministic fake transports inside tests or an explicitly isolated development harness only.

### 2. Close release-gate self-certification

- RED: construct a release-required Mission with no Task Graph and prove owner-authored `REVIEW_PASSED` plus generic `VALIDATION_PASSED` cannot reach approval.
- Require transport-bound independent reviewer Evidence on every release path.
- Replace the generic validation shortcut with explicit required typed gates and current, distinct passing Evidence.
- Add negative replay and stale/forged-Evidence tests.

### 3. Build evidence-backed Context Packs

- RED: prove placeholder-only Context cannot become `CONTEXT_READY` or be routed to an agent.
- Introduce an adapter-backed snapshot containing workspace rules, repository state, recent context, task status, decisions, and separate facts/assumptions with source references.
- Fail closed and show unavailable sources honestly when capture cannot complete.

### 4. Bind Playbook evaluation to observed Mission evidence

- RED: reject pasted metrics, case results, retrospective references, or Mission IDs that are not derivable from current Mission events/Evidence.
- Build evaluation input from observable case-level results; bind Baseline, Candidate, metrics, cases, and retrospective Evidence to immutable identities.
- Retain structural validation as a secondary guard, not proof of execution.

### 5. Correct approval demand

- RED: prove `PROMOTION_REQUESTED` is not human approval demand and `REVIEW_APPROVED` is.
- Correct the dashboard projection and provenance tests.

### 6. Repair committed hygiene

- Remove the four root prototype scripts whose targets were deliberately deleted.
- Include the existing reviewer-profile correction so committed `HEAD` inherits model/reasoning.
- Decide and document the supported clean-install path; add a Mission Control lockfile only if the app is intended to install independently.
- Restore newest-first ordering in `work log.md`.
- Treat `main.js` decomposition and shared view-helper extraction as optional follow-up unless required to make the fixes reviewable.

### 7. Integrated verification and review

- Focused tests for every RED/GREEN seam.
- Full `npm.cmd test` and `npm.cmd run build` in `codex-mission-control`.
- Verify the documented clean-install path from a clean dependency state.
- Browser QA: disconnected state, disabled dispatch, no fabricated activity, release-gate negative path, approval demand, desktop/mobile, keyboard and console.
- Run `git diff --check`, scoped secret scan, and complete-diff inspection including untracked files.
- Freeze one final candidate, perform parent adversarial checks, then obtain one fresh read-only `solweaver_reviewer` verdict under final-strict readiness rules.
- Commit only after the candidate is green. Push remains a separate owner-authorized action.

## Acceptance

- No production simulator or fabricated Run, Evidence, Artifact, metric, approval, or reviewer success.
- Every release path requires current typed Gate Evidence and an independent transport-bound review.
- Context Packs and Playbook evaluations are traceable to observable sources.
- Approval Demand represents actual human decisions waiting.
- All committed npm scripts resolve, the reviewer profile follows workspace routing policy, and the clean-install path works.
- Focused/full validation and final review are green with no known blocker.
