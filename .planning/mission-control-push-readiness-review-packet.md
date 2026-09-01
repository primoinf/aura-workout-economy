# Mission Control Push-Readiness — Final-Strict Review Packet

## Role

Act as a fresh read-only reviewer. Do not edit files, implement fixes, commit, push, deploy, or orchestrate agents.

## Execution and assurance

- EXECUTION_MODE: `team`
- ASSURANCE_MODE: `final-strict`
- ASSURANCE_UNIT_ID: `GENERAL/mission-control/push-readiness`
- REOPEN_GENERATION: `0`
- UNIT_STATUS: `open`
- LEDGER_LOCATION: `.planning/mission-control-push-readiness-assurance.md`
- ATTEMPT_COORDINATION_LOCATION: `.planning/mission-control-push-readiness-review-attempts.jsonl`
- COORDINATION_PRIMITIVE: atomic PowerShell directory creation at `C:\Users\HYPERX\Desktop\AGENT\GENERAL\.planning\.mission-control-push-readiness-review.lock`
- REVIEW_BUDGET_MODE: `default`
- TARGET_REVIEW_CALLS: `1`
- MAX_REVIEW_CALLS: `3`
- REVIEW_CALLS_USED: `0` before call 1
- REVIEW_ATTEMPT_ID: `task050-review-01-01a05ea1`
- CALL_STATE: planned here; the attempt journal must show the exclusive reservation before the reviewer starts

## Objective

Make the 12 local Mission Control commits safe to push without performing the push: remove simulated production Run/Artifact/Evidence/reviewer facts; prevent release self-certification; require source-backed Context; bind Playbook evaluation to observable transport Evidence; correct approval-demand state; restore standalone clean installs; and remove vulnerable build-tool dependencies.

## Acceptance mapping

1. Production has no local agent simulator. Missing or malformed transport reports disconnected, disables dispatch, and cannot fabricate progress.
2. Release-required Missions use a Task Graph, exactly one typed validation Assignment per declared gate, an inspectable candidate Artifact, and current transport-bound independent Sol Reviewer Evidence. Validation Artifacts cannot become candidate Artifacts.
3. Context capture uses an adapter with required workspace rules, repository state, recent context, task status, decisions, source-linked facts, explicit assumptions, and availability. Summary-only placeholders fail closed; Assignments bind the exact Context version and sources.
4. Playbook evaluation accepts no pasted metrics or case claims. Exactly one current completed transport observation supplies immutable case results, Artifact, and Evidence; aggregate comparison is derived from cases.
5. Operations approval demand counts only Candidates awaiting human authority after independent approval, not Candidates merely awaiting review.
6. The standalone app owns a lockfile, `npm.cmd ci` works, dead prototype scripts are removed, and reviewer profile model pins are removed.
7. Vite resolves to 8.2.2, `npm audit` is empty, all tests/build/scoped checks/browser QA pass, and unrelated workspace changes remain untouched.

## Scope and identity

- BASE: `784ac616ebf3585dcee6dd558e7bf09a2890559b`
- CANDIDATE_MANIFEST_LOCATION: `.planning/mission-control-push-readiness-candidate.json`
- FROZEN_CANDIDATE_ID: `sha256:dbac0807e7eba7b2987881f690824d6aa8737af07da579c3c5ce31d6aed8c500`
- ASSURANCE_PACKET_ID: `task050-packet-01-01a05ea1`
- Candidate records: 21 exact whole-file hashes covering `.codex/agents/reviewer.toml`, root/app package contracts, app lockfile, workspace guidance, seven production modules, and nine test modules.
- Administrative plan/ledger/readiness/attempt/tracker/log files are outside the behavior candidate. Generated `dist/` and `node_modules/` are verification outputs only.
- DELIVERY_ARTIFACT_MANIFEST: not applicable for this unpushed source candidate.
- Unrelated existing dirty/untracked workspace files are excluded and must not be reviewed as candidate changes.

## Risk and invariants

- Final-strict reason: release authority, data/event integrity, independent reviewer authenticity, source provenance, and production fact fabrication.
- Invariants: production does not invent agent facts; release cannot self-certify; Context and Playbook claims name observable sources; current identity-bound Evidence is required; supported legacy histories stay readable while new malformed histories fail closed; protected external actions remain owner-controlled.

## Evidence

- Parent complete-diff inspection and reviewability gate: pass.
- Parent adversarial matrix: nine risk rows in the ledger; PARENT_ADVERSARIAL_READY: yes.
- Clean install: `npm.cmd ci` passed; audit during install was zero.
- Frozen full suite: `node --test --test-reporter=dot` passed 202/202.
- Build: `npm.cmd run build` passed under Vite 8.2.2 with 21 modules transformed.
- Audit: `npm.cmd audit --json` reported zero vulnerabilities.
- Syntax: 16 changed JavaScript source/test files passed `node --check`.
- Scoped diff: 16 tracked and 5 untracked candidate paths passed whitespace checks.
- Candidate manifest rehash: 21/21 records and aggregate passed.
- Secret scan: no suspicious credential labels in candidate scope.
- Browser: clean loopback origin passed disconnected/disabled-context, honest metrics, desktop/mobile, overflow, native-control, and console checks; stale existing origins independently demonstrated fail-closed replay without data mutation.
- Compose: not applicable; repository defines none for this app.
- TDD: ledger records RED/GREEN for every behavior lane and the full-suite legacy-fixture RED/GREEN.
- FINAL_STRICT_READINESS_RECORD_LOCATION: `.planning/mission-control-push-readiness-readiness.json`
- MACHINE_READINESS_PROOF_LOCATION: `.planning/mission-control-push-readiness-readiness-proof.json`
- Applicable missing or not-run evidence: none.
- Protected actions: no commit, push, merge, release, deploy, or production mutation.

## Review instructions

Inspect the actual 21 files and complete base-to-working-tree candidate diff, including untracked files in the manifest. Trace behavior through unchanged callers and event replay rather than reviewing only isolated hunks. Prioritize correctness, security, data integrity, concurrency, backward compatibility, release/reviewer authority, production fact authenticity, dependency safety, and missing tests. Continue the full audit after finding a blocker.

A blocker must identify the violated contract, a reachable failure or material evidence gap, impact, and exact file references. Put optional hardening and speculation in residual risk, not blockers. If the scope cannot be fully audited in one pass, return `rethink` rather than a partial verdict.

## Return schema

VERDICT: ship | fix-first | rethink
AUDIT_COMPLETENESS: complete | scope-too-broad
FINDING_CLASS: behavior | assurance-metadata-only | mixed | none
BEHAVIOR_BLOCKERS: ordered blockers or none
CANDIDATE_CHANGE_REQUIRED: yes | no
FINDINGS: ordered evidence-qualified findings with contract, reachable path, impact, and file references; or none
EVIDENCE: what supports the verdict
RESIDUAL_RISK: non-blocking uncertainty, optional hardening, or none
