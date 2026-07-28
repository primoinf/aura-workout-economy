# Tickets: Codex Mission Control

Build the production Codex Mission Control from the approved [product spec](.scratch/codex-mission-control/PRD.md) and the validated hybrid UI decision.

Work the **frontier**: any ticket whose blockers are all done. Start each ticket in a fresh context with `/implement`; each implementation drives TDD and closes with Standards + Spec review.

## 01 — Complete one no-release Mission locally

**Status:** done

**What to build:** A mission owner can create a valid Brief, observe the resulting Mission on the Command Deck Overview, open its Mission Flow detail, run a mocked happy path through review and validation, accept the no-release outcome, reload the app, and still see the same completed Mission reconstructed from its event history.

**Blocked by:** None — can start immediately.

- [x] The production app is separate from Nihongo Dojo and does not import throwaway prototype code.
- [x] A Brief captures goal, scope, acceptance criteria, constraints, risk, mutation authority, release requirement, and release authority.
- [x] The Mission Orchestrator is the only behavioral seam that accepts commands and exposes state, emitted events, and allowed next actions.
- [x] Illegal lifecycle transitions fail closed and do not append events.
- [x] Accepted commands append ordered immutable events with actor, timestamp, reason, Context Pack version, and evidence references where applicable.
- [x] A no-release happy path reaches `COMPLETED` through observable Brief, Context, plan, run, review, validation, learning, and completion states.
- [x] Local persistence reloads and replays the event history into the same observable Mission state.
- [x] Overview uses the approved Command Deck hierarchy and Mission Detail uses the approved Mission Flow hierarchy at desktop and mobile widths.
- [x] Black-box tests exercise the happy path and replay contract through the Mission Orchestrator rather than private storage or UI internals.

## 02 — Recover a Mission through correction and control loops

**Status:** ready-for-agent

**What to build:** A mission owner can see why work failed review or validation, return it to the assigned agent, revise material Context, block and resume work, or cancel it, while the system preserves the audit trail and prevents stale evidence from passing a later gate.

**Blocked by:** 01 — Complete one no-release Mission locally.

- [ ] Review rejection and validation failure both enter `CHANGES_REQUESTED` while preserving distinct reasons and evidence.
- [ ] Resubmission regenerates the affected Artifact and Evidence references before gates can pass again.
- [ ] A material Context Pack revision increments its version and invalidates dependent review, validation, and approval evidence.
- [ ] `BLOCKED` records and resumes only to the prior safe state; it cannot skip a gate.
- [ ] `CANCELLED` is terminal while its history remains readable.
- [ ] Mission Flow makes active, blocked, changes-requested, resumed, and cancelled work visually distinct.
- [ ] Tests cover repeated correction loops, stale-evidence rejection, block/resume, cancellation, and illegal bypass attempts through the Mission Orchestrator seam.

## 03 — Make release readiness a human-controlled decision

**Status:** ready-for-agent

**What to build:** A mission owner can open the Review Ledger Approval Room, inspect the exact candidate, current Evidence, residual risk, intended external action, and rollback commitment, then approve or reject release readiness without triggering deployment.

**Blocked by:** 01 — Complete one no-release Mission locally; 02 — Recover a Mission through correction and control loops.

- [ ] Approval Room uses the approved Review Ledger hierarchy and remains accessible at desktop and mobile widths.
- [ ] A release-required Mission cannot advance when its Brief does not authorize release.
- [ ] Approval is available only when every required Gate has current passing Evidence for the same Context Pack version.
- [ ] Rejection records the human reason, enters `CHANGES_REQUESTED`, and invalidates stale approval.
- [ ] Approval records the human actor and reason and advances only to `READY_TO_RELEASE`.
- [ ] Approval does not commit, push, open a pull request, deploy, or expand the Mission's authority.
- [ ] Missing, duplicate, malformed, out-of-order, or stale approval events fail closed during replay.
- [ ] The audit trail reconstructs why the candidate was approved or rejected without relying on hidden reasoning.

## 04 — Route one bounded assignment to a real Codex agent

**Status:** ready-for-agent

**What to build:** An orchestrator can route one bounded Assignment to the smallest capable configured Codex role, observe the live Run, and receive structured Artifact, Evidence, completion, or blocked output without granting broader mutation authority.

**Blocked by:** 01 — Complete one no-release Mission locally.

- [ ] Agent routing is behind an adapter and the core Mission lifecycle has no dependency on Codex Desktop transport details.
- [ ] Routing uses declared role capability and risk rather than provider branding.
- [ ] The Assignment declares goal, acceptance criteria, Context slice, ownership boundary, effective permission, budget, and expected Evidence.
- [ ] Agent role, effective permission, observable model metadata, runtime status, and current Assignment are represented separately.
- [ ] A completed Run attaches structured Artifacts and Evidence to the Mission; spawn success alone never marks work complete.
- [ ] A blocked Run records the blocker, attempted alternatives, and authority or input required.
- [ ] Adapter contract tests use a fake agent transport, and a bounded live smoke check proves one configured role can complete without touching unrelated files.

## 05 — Coordinate a multi-agent Mission in safe execution waves

**Status:** ready-for-agent

**What to build:** A mission owner can watch a Task Graph execute across multiple role-appropriate agents in dependency-aware waves, with safe ownership boundaries, a reserved coordination slot, independent read-only review, and a structured Decision Room when consequential judgment is needed.

**Blocked by:** 02 — Recover a Mission through correction and control loops; 04 — Route one bounded assignment to a real Codex agent.

- [ ] The Task Graph exposes dependencies and computes a frontier of unblocked Assignments.
- [ ] Execution waves never exceed the configured capacity and reserve one of four available slots for Orchestrator coordination when required.
- [ ] Concurrent writable Assignments with overlapping ownership are rejected or serialized before dispatch.
- [ ] Deterministic work routes to Luna, routine build work to Terra Builder, reproducible difficult failures to Terra Debugger, high-risk ambiguity to Sol Architect, and independent review to read-only Sol Reviewer.
- [ ] Agent cards and the Activity Stream update from observable Assignment and Run events rather than invented status.
- [ ] A Decision Room requires a question, participant roles, input Evidence, alternatives, trade-offs, recommendation, and validation plan.
- [ ] Reviewer findings identify a triggering scenario and owner and can return only the affected work to the correction loop.
- [ ] Concurrency, frontier, ownership-conflict, capacity, Decision Room, and read-only reviewer behavior have deterministic contract coverage.

## 06 — Evaluate and promote a bounded Playbook Candidate

**Status:** ready-for-agent

**What to build:** After a completed Mission, a mission owner can inspect a Playbook Candidate derived from observed outcomes, compare it with a fixed Baseline on identical evaluation cases, and approve, reject, or later roll back the candidate without allowing autonomous policy mutation.

**Blocked by:** 05 — Coordinate a multi-agent Mission in safe execution waves.

- [ ] Retrospective records the outcome, recurring failure pattern, relevant metrics, and Evidence behind the proposed change.
- [ ] Candidate and Baseline run on the same versioned evaluation set.
- [ ] Comparison shows acceptance pass rate, critical regressions, review findings, retries, cycle time, and token use.
- [ ] A Candidate with any new critical regression or no declared target improvement cannot request promotion.
- [ ] Independent review and explicit human approval are both required before `PROMOTED`.
- [ ] Promotion creates an immutable Playbook version and never rewrites system prompts, agent profiles, or security policy in place.
- [ ] Rejection and rollback preserve all versions and their decision history.
- [ ] Contract tests cover promotion, rejection, regression blocking, inferior candidates, stale Baselines, and rollback.

## 07 — Operate and audit Mission Control at production UI quality

**Status:** ready-for-agent

**What to build:** A mission owner can efficiently operate a growing history of Missions from the approved hybrid dashboard, filter and inspect live or completed work, understand cost and quality signals, and use every critical control with keyboard and assistive technology.

**Blocked by:** 03 — Make release readiness a human-controlled decision; 05 — Coordinate a multi-agent Mission in safe execution waves; 06 — Evaluate and promote a bounded Playbook Candidate.

- [ ] Overview combines current Missions, agent capacity, queue, Gate health, cycle time, token use, retries, conflicts, and approval demand without presenting fake runtime facts.
- [ ] Filters by Mission, agent, lifecycle state, risk, and time remain reflected in the URL and restore on reload.
- [ ] Mission Detail, Approval Room, Runs & Artifacts, Decision Rooms, Quality Gates, Playbooks, Metrics, and Settings are reachable through a coherent navigation model.
- [ ] Every displayed aggregate can be traced to underlying observable events and Evidence.
- [ ] Semantic navigation, labelled controls, keyboard operation, visible focus, sufficient contrast, reduced motion, and screen-reader names pass automated and manual checks.
- [ ] Representative desktop and mobile journeys cover create, inspect, correct, approve, reject, block, resume, cancel, replay, and Playbook decisions.
- [ ] Production builds contain no prototype switcher, losing variants, fake scenario controls, or mock-only copy.
- [ ] The throwaway terminal and UI prototype shells are deleted after their validated decisions and test cases are absorbed.
