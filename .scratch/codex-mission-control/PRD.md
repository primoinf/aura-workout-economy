# Codex Mission Control

Status: ready-for-agent

## Problem Statement

ผู้ใช้ต้องการควบคุม Codex หลายบทบาทให้ทำงานร่วมกันเป็นทีมที่ตรวจสอบได้ ไม่ใช่เปิดหลายแชตแล้วต้องคอยประกอบคำตอบเอง ปัจจุบันข้อมูลสำคัญกระจายอยู่ระหว่างบทสนทนา สถานะ Git, กฎใน workspace, task board, ผลทดสอบ และรายงานจาก sub-agent จึงมองไม่เห็นภาพรวมว่าใครกำลังทำอะไร งานติดที่จุดใด หลักฐานเพียงพอหรือยัง และใครมีสิทธิ์อนุมัติการเปลี่ยนแปลงที่มีผลจริง

ผู้ใช้ยังต้องการวงจรปรับปรุงการทำงานจากผลลัพธ์ที่ผ่านมา แต่การ “self-improving” แบบไม่มีขอบเขตเสี่ยงต่อการแก้ playbook หรือปล่อยงานโดยไม่มีหลักฐาน ดังนั้นระบบต้องเรียนรู้ผ่าน candidate ที่เปรียบเทียบกับ baseline, ตรวจสอบย้อนหลังได้, rollback ได้ และต้องมี human approval ก่อนเลื่อนเป็นมาตรฐาน

## Solution

สร้างเว็บแอปแยกชื่อ **Codex Mission Control** เป็น control center สำหรับกำหนด Mission Brief, สร้าง Context Pack, วาง Task Graph, route งานไปยัง Codex agents ตามบทบาท, รับ Artifact และ Evidence, บังคับ quality gates, ขอ human approval และบันทึกผลการทำงานเป็น retrospective

ระบบใช้ความต่างของบทบาทและ permission เป็นหลัก:

- **Orchestrator** รับ Brief, สร้างแผน, จัด wave และตัดสิน lifecycle
- **Luna Worker** ทำงาน deterministic, สำรวจ, สรุป และ validation เชิงกล
- **Terra Builder** ทำ implementation ที่ขอบเขตชัดเจน
- **Terra Debugger** รับบั๊กที่ reproduce ได้แต่ซับซ้อน
- **Sol Architect** ตัดสิน architecture, security และความเสี่ยงสูง
- **Sol Reviewer** ตรวจอิสระแบบ read-only ก่อนผ่าน gate

ระบบจะไม่แสดง agent เป็นโมเดลคนละค่ายเมื่อ runtime ไม่ได้เป็นเช่นนั้น และจะไม่ถือว่าการ spawn สำเร็จเท่ากับงานสำเร็จ ทุกผลลัพธ์ต้องผูกกับ Run, Artifact, Evidence และ Gate Outcome

MVP ใช้ local-first persistence และ project-agent routing ที่มีอยู่ก่อน ยังไม่ deploy อัตโนมัติและยังไม่แก้ agent prompt หลักอัตโนมัติ

## User Stories

1. As a mission owner, I want to create a Mission Brief with a goal, scope, constraints, risk and acceptance criteria, so that the team receives an unambiguous objective.
2. As a mission owner, I want required fields to be validated before planning starts, so that incomplete missions do not consume agent time.
3. As a mission owner, I want to choose whether the mission permits code changes, commits or deployment, so that authority is explicit.
4. As a mission owner, I want deployment to require a separate approval, so that implementation permission cannot silently become production permission.
5. As an orchestrator, I want to assemble a Context Pack from workspace rules, repository state, recent context, task status and relevant decisions, so that agents act on current evidence.
6. As an orchestrator, I want each agent to receive only the relevant context slice, so that instructions remain focused and token use remains bounded.
7. As an orchestrator, I want to record assumptions separately from proven facts, so that reviewers can identify unverified reasoning.
8. As an orchestrator, I want to convert a Mission into a dependency-aware Task Graph, so that work can be scheduled safely.
9. As an orchestrator, I want to group independent tasks into execution waves, so that concurrency is useful without exceeding the available agent slots.
10. As an orchestrator, I want to route deterministic work to Luna, routine implementation to Terra Builder, reproducible difficult bugs to Terra Debugger, and high-risk ambiguity to Sol Architect, so that the smallest capable role handles each task.
11. As an orchestrator, I want to reserve an agent slot for coordination when needed, so that the team does not deadlock by filling every slot with workers.
12. As a mission owner, I want to see agent cards with role, status, current task, elapsed time and latest evidence, so that I understand the team at a glance.
13. As a mission owner, I want active, queued, blocked and completed tasks to be visually distinct, so that bottlenecks are obvious.
14. As a mission owner, I want an activity stream of lifecycle events, so that I can reconstruct what happened without reading every chat.
15. As an agent, I want my task ownership and writable scope to be explicit, so that concurrent agents do not overwrite one another.
16. As an agent, I want to submit structured Artifacts and Evidence, so that completion is based on observable results rather than a narrative claim.
17. As an agent, I want a blocked outcome to include the blocker, attempted alternatives and requested authority, so that the orchestrator can act without rediscovery.
18. As a reviewer, I want read-only access to the actual execution path, diff, tests and acceptance criteria, so that review remains independent.
19. As a reviewer, I want to distinguish demonstrated defects from hypotheses, so that findings are actionable and correctly prioritized.
20. As a reviewer, I want to request changes with an owner and triggering scenario, so that work returns to the correct agent.
21. As a mission owner, I want lint, tests, build, security checks and review to appear as separate gates, so that one passing signal cannot hide another failure.
22. As an orchestrator, I want illegal lifecycle transitions to be rejected, so that a Mission cannot bypass context, review, validation or approval.
23. As an orchestrator, I want failed review or validation to return the Mission to a correction loop, so that evidence can be regenerated.
24. As a mission owner, I want approval requests to show the exact diff, evidence, risks and intended external action, so that approval is informed.
25. As a mission owner, I want rejection to preserve the reason and return the Mission to changes requested, so that the decision is auditable.
26. As a release owner, I want only an approved and currently valid release candidate to become ready for release, so that stale evidence cannot be reused.
27. As a release owner, I want the system to prevent deployment when the Mission did not authorize deployment, so that scope cannot expand silently.
28. As a mission owner, I want release results and rollback information recorded, so that production outcomes are traceable.
29. As a mission owner, I want the Mission to enter a retrospective after release or an explicitly accepted no-release completion, so that learning is captured consistently.
30. As an orchestrator, I want to propose a Playbook Candidate from recurring evidence, so that improvements are grounded in observed failures.
31. As a reviewer, I want a Playbook Candidate compared against a fixed baseline on the same evaluation cases, so that improvement claims are meaningful.
32. As a mission owner, I want candidate metrics to include acceptance pass rate, regressions, review findings, retries, cycle time and token use, so that trade-offs are visible.
33. As a mission owner, I want human approval before promoting a Playbook Candidate, so that the system cannot rewrite its operating policy autonomously.
34. As a mission owner, I want promoted playbooks to retain their previous version and rollback path, so that harmful changes are reversible.
35. As an auditor, I want every state transition to record actor, timestamp, reason and related evidence, so that the full decision trail can be reconstructed.
36. As an auditor, I want role labels and effective permissions shown separately from model and reasoning metadata, so that the dashboard does not make false claims about runtime behavior.
37. As a mission owner, I want to call a Decision Room with a defined agenda, participants, inputs and required output, so that “meetings” produce decisions rather than unstructured conversation.
38. As a participant, I want Decision Room conclusions to record alternatives, trade-offs, recommendation and validation plan, so that future agents can reuse the decision.
39. As a mission owner, I want to pause or cancel a Mission without losing its history, so that control remains with the human.
40. As an orchestrator, I want a blocked Mission to resume at its prior safe state, so that recovery does not skip gates.
41. As a mission owner, I want dashboard filters by Mission, agent, state, risk and time, so that large histories remain navigable.
42. As a mission owner, I want desktop and mobile views with keyboard-accessible controls and visible focus states, so that the control center remains usable and accessible.
43. As a maintainer, I want corrupted or incomplete stored events to fail closed, so that the system does not infer approval from missing data.
44. As a maintainer, I want Mission state to be reconstructable from an ordered event history, so that displayed state and audit history cannot silently diverge.
45. As a maintainer, I want external integrations to be adapters around the core lifecycle, so that the Mission model does not depend on a particular tracker, model provider or deployment platform.

## Implementation Decisions

- The product is a separate web application and must not be added to or coupled with Nihongo Dojo.
- The MVP is a control plane over existing Codex project agents. It does not pretend that roles imply different underlying models.
- The core domain terms are Mission, Brief, Context Pack, Task Graph, Execution Wave, Agent Assignment, Run, Artifact, Evidence, Finding, Gate, Approval, Release Candidate, Retrospective, Playbook, Playbook Candidate and Baseline.
- The primary behavioral seam is a **Mission Orchestrator** that accepts commands and exposes the resulting Mission state plus emitted events. UI, automation and future API adapters must use this seam instead of mutating state directly.
- Mission state is event-driven and reconstructable. Every accepted command emits an immutable event containing actor, timestamp, reason and evidence references.
- The canonical Mission lifecycle is:
  - `DRAFT`
  - `CONTEXT_READY`
  - `PLANNED`
  - `RUNNING`
  - `REVIEWING`
  - `CHANGES_REQUESTED`
  - `VALIDATING`
  - `APPROVAL_REQUIRED`
  - `READY_TO_RELEASE`
  - `RELEASED`
  - `LEARNING`
  - `COMPLETED`
  - `BLOCKED` and `CANCELLED` as control states
- `BLOCKED` stores the prior safe state and may resume only to that state. `CANCELLED` is terminal.
- Review rejection, validation failure and human rejection all enter `CHANGES_REQUESTED`; they preserve distinct reasons and invalidate stale approval/evidence.
- A Mission can enter `READY_TO_RELEASE` only from `APPROVAL_REQUIRED` after explicit human approval and only when all required evidence remains current.
- Release is a separately authorized action. A Mission without deployment authority may complete as an accepted no-release outcome but cannot emit a deployment event.
- Agent routing uses declared role capabilities and risk, not a hard-coded provider name.
- Worker assignments declare ownership boundaries. Agents share the filesystem, so concurrent writable assignments must not overlap unless the orchestrator serializes them.
- Independent review uses a read-only reviewer role by default.
- Context Packs are versioned snapshots. New material repository changes invalidate dependent review, validation and approval results.
- Gates are typed and individually visible. A combined “passed” status is derived only when every required gate has current passing evidence.
- Decision Rooms require a question, participant roles, input evidence and an expected decision artifact.
- The MVP persists locally. External issue trackers, GitHub, deployment systems and communication tools are future adapters.
- Playbook improvement is a separate bounded lifecycle: `PROPOSED → EVALUATING → APPROVAL_REQUIRED → PROMOTED | REJECTED`.
- A Playbook Candidate must run against the same evaluation set as its Baseline. Promotion requires no new critical regression, measurable improvement on the declared target, reviewer acceptance and human approval.
- Playbook promotion creates a new immutable version. Rollback selects an earlier version; history is never overwritten.
- The dashboard includes Overview, Missions, Teams, Task Graph, Decision Rooms, Runs & Artifacts, Quality Gates, Playbooks, Metrics and Settings.
- The approved production information architecture is hybrid: Variant A's Command Deck for Overview, Variant B's Mission Flow for Mission Detail, and Variant C's Review Ledger for Approval Room. Prototype code itself must not be promoted directly.
- Agent cards show role, effective permission, runtime status, current assignment, elapsed time, latest evidence and queue position. Model metadata is shown only when observable.
- The first release does not automatically commit, push, open pull requests or deploy unless the Mission explicitly authorizes that action and the user approves the corresponding gate.

## Testing Decisions

- Tests assert externally visible behavior through the Mission Orchestrator seam. They do not assert component internals, routing implementation details or private storage shapes.
- The highest-value contract is: given an initial Mission and a sequence of commands, the orchestrator returns the expected state, emitted events, allowed next actions and gate invalidations.
- Lifecycle transition tests cover the happy path and every rejected bypass, especially attempts to start without context, validate without review, approve with failed gates, release without approval and promote a playbook without baseline comparison.
- Correction-loop tests prove that review rejection, validation failure and human rejection preserve their distinct reason while returning to `CHANGES_REQUESTED`.
- Evidence freshness tests prove that a material Context Pack change invalidates review, validation and approval derived from the older version.
- Permission tests prove that read-only roles cannot mutate Mission artifacts and that deployment cannot occur without explicit Mission authority plus human approval.
- Concurrency tests prove that overlapping writable ownership is rejected or serialized and that execution waves never exceed the configured agent capacity.
- Block/resume tests prove that a Mission resumes to its prior safe state and cannot use `BLOCKED` to skip a gate.
- Cancellation tests prove that `CANCELLED` is terminal and history remains readable.
- Event-replay tests prove that replaying an ordered event stream reconstructs the same observable Mission state.
- Fail-closed tests prove that missing, duplicated, out-of-order or malformed approval events never produce `READY_TO_RELEASE`.
- Playbook tests compare Baseline and Candidate on identical cases and reject promotion when a critical regression appears even if aggregate cost improves.
- UI journey tests use the same orchestrator seam and cover creating a Brief, observing agents, resolving requested changes, approving a release and inspecting the audit trail.
- Accessibility tests cover semantic navigation, labelled controls, keyboard operation, visible focus and sufficient contrast at representative desktop and mobile widths.
- Existing repository tests are useful prior art for black-box rendered-output and persistence compatibility checks, but the new application will own its own test suite and commands.
- Before production implementation, a throwaway state-machine prototype will exercise representative command sequences and expose the full state after every action. Its validated decisions will be absorbed into this spec; the interactive shell will not ship.

## Out of Scope

- Autonomous production deployment without a human gate.
- Automatic modification or promotion of system prompts, agent profiles or security policy.
- Claiming role diversity is model diversity when effective runtime metadata does not support that claim.
- Multi-provider competition between Claude, Gemini, DeepSeek, Grok or other vendors.
- Trading, financial execution or portfolio management from the visual references.
- Billing, subscription management or cross-organization tenancy.
- Enterprise SSO, RBAC administration and compliance certification.
- Remote collaboration integrations such as Slack, Teams, Jira, Notion or email in the MVP.
- Long-term semantic memory or embedding-based retrieval.
- Replacing Codex Desktop thread management.
- Production-grade distributed scheduling; the MVP coordinates the locally available agent capacity.

## Further Notes

- The supplied dashboard reference is used for information hierarchy, team cards and activity visibility. The trading-specific data model is not carried into this product.
- The supplied self-improving-loop reference is adapted into a controlled Baseline-versus-Candidate process with validation, independent review, human approval and rollback.
- The first prototype answers one question: **Can the proposed lifecycle represent correction loops, human-controlled release and bounded playbook promotion without permitting a gate bypass?**
- Initial product success means a user can reconstruct why a Mission reached its current state without reading hidden reasoning or trusting an agent’s unverified completion claim.
