# Codex Mission Control UI Convergence

Status: ready-for-agent

## Brief

ทำให้ Codex Mission Control ตัวใช้งานจริงมีรูปลักษณ์ ลำดับข้อมูล และประสบการณ์ใช้งานตามต้นแบบที่อนุมัติแล้ว โดยรวม:

- **A — Command Deck** เป็นหน้า Overview สำหรับเห็นภาพรวม Mission และทีม
- **B — Mission Flow** เป็นหน้า Mission Detail สำหรับติดตาม lifecycle, hand-off และ Evidence
- **C — Review Ledger** เป็น Approval Room สำหรับการตัดสินใจที่ตรวจสอบย้อนหลังได้

งานนี้ไม่ใช่การย้าย prototype เข้า production ตรง ๆ แต่เป็นการนำ visual language และ information hierarchy ที่ดีมาแสดงข้อมูลจริงจาก Mission Orchestrator ปัจจุบัน

ผลลัพธ์ที่ต้องได้:

1. ผู้ใช้เปิดระบบแล้วเข้าใจทันทีว่ามี Mission อะไร กำลังอยู่ขั้นไหน และต้องทำอะไรต่อ
2. ทุกสถานะ ตัวเลข และ activity ที่เห็นอธิบายที่มาได้จาก event history หรือ configuration จริง
3. ไม่มี scenario switcher, fake progress, fake agent activity หรือ fake approval ใน production
4. หน้า A, B และ C ดูเหมือนเป็นผลิตภัณฑ์เดียวกันทั้ง desktop และ mobile
5. ความสามารถที่ backend ยังไม่มีต้องแสดงอย่างซื่อสัตย์ เช่น `Not connected`, `No assignment` หรือ `Available after approval flow`

## Context

### สิ่งที่มีอยู่แล้ว

- Prototype A/B/C อยู่ใน `.scratch/` และตอบคำถามด้านรูปแบบได้แล้ว
- Production app มี Brief form, Mission lifecycle, local event persistence, replay, Web Locks และ no-release completion ที่ผ่านการทดสอบ
- Mission Orchestrator เป็น behavioral seam เดียวของระบบและเป็นแหล่งข้อมูลจริงของ Mission state
- Ticket 01 ปิดแล้ว ส่วน correction loop, approval flow และ real agent assignment ยังอยู่ใน Ticket 02, 03 และ 04

### ปัญหาปัจจุบัน

- Production มี engine จริง แต่ยังถ่ายทอดบุคลิกและลำดับข้อมูลของ A/B/C ได้ไม่ครบ
- Prototype มีข้อมูลจำลองที่ดูสมบูรณ์กว่า production แต่ไม่ควรถูกตีความว่าเป็น runtime truth
- ถ้าเริ่ม Ticket 02–04 ก่อนรวม UI contract จะเกิด markup, component และ navigation ซ้ำ
- ถ้าแสดงการ์ด agent เหมือนกำลังทำงานทั้งที่ยังไม่ได้เชื่อม จะทำให้ผู้ใช้เข้าใจผิด

### หลักการตัดสินใจ

- **Truth before theatre:** แสดงเฉพาะข้อมูลจริงหรือระบุชัดว่าเป็น configuration/placeholder
- **One product, three operating views:** A, B และ C ใช้ shell, token, typography, status language และ navigation เดียวกัน
- **One behavioral seam:** UI อ่าน state และส่ง command ผ่าน Mission Orchestrator เท่านั้น
- **Progressive activation:** โครง UI วางล่วงหน้าได้ แต่ action เปิดใช้เมื่อ domain capability พร้อมเท่านั้น
- **Human authority remains explicit:** การอนุมัติและ release ไม่เกิดจาก animation, navigation หรือการถึงขั้นสุดท้ายของ progress bar

## Workflow

### Delivery workflow

| Wave | เป้าหมาย | สิ่งที่ส่งมอบ | Dependency |
| --- | --- | --- | --- |
| 1 — Foundation | รวม visual system และ navigation | shared shell, tokens, responsive layout, state vocabulary, empty/loading/error states | Ticket 01 |
| 2 — A + B Convergence | ยกระดับ Overview และ Mission Detail ด้วยข้อมูลจริง | Command Deck metrics, Mission cards, team directory, Mission Flow hero, lifecycle, Evidence ledger, Brief context | Wave 1 |
| 3 — Control + Approval | รองรับ loop และเปิด C เมื่อ domain พร้อม | changes-requested/blocked/resume UI จาก Ticket 02 และ Review Ledger Approval Room จาก Ticket 03 | Ticket 02 |
| 4 — Live Team | เปลี่ยน directory เป็น telemetry จริง | assignment, run, role, permission, elapsed time, latest Evidence และ honest disconnected/error states | Ticket 04 |
| 5 — Hardening | ทำให้พร้อมใช้งานต่อเนื่อง | navigation completeness, filtering, accessibility, replay/reload, multi-tab and responsive QA | Waves 1–4 |

### User workflow

1. Mission owner เปิด **Overview (A)** และเห็น metrics ที่คำนวณจาก Mission state จริง
2. Mission owner สร้าง Mission จาก Brief หรือเลือก Mission ที่มีอยู่
3. ระบบเปิด **Mission Detail (B)** พร้อม goal, risk, authority, lifecycle และ next allowed action
4. Orchestrator รับ command และ append event; UI render state ใหม่จาก replay
5. เมื่อมี review/validation failure ระบบแสดง correction loop โดยรักษา reason และ Evidence เดิม
6. เมื่อ Mission ต้องการ human approval ระบบเปิด **Approval Room (C)** ที่แสดง candidate, Evidence, residual risk, external action และ rollback commitment
7. Human approve หรือ reject ผ่าน Orchestrator; UI ไม่เรียก deploy โดยตรง
8. เมื่อ real agent integration พร้อม หน้า Overview และ Mission Detail แสดง assignment/run telemetry จริง
9. เมื่อ reload หรือเปิดอีก tab ระบบ reconstruct มุมมองเดิมจาก event history และไม่สร้างสถานะหลอก

### Information flow

```text
Brief
  -> Mission Orchestrator command
  -> validated immutable event
  -> persisted event history
  -> replayed Mission state
  -> A Overview / B Mission Detail / C Approval Room
```

Configuration เช่น role directory สามารถแสดงได้โดยติดป้าย `Configured` แต่ runtime status ต้องมาจาก Assignment/Run events เท่านั้น

## Problem Statement

ผู้ใช้มีต้นแบบที่สื่อภาพ Codex Team ได้ชัด แต่ตัว production ซึ่งมี lifecycle และ persistence จริงยังไม่ให้ความรู้สึกและลำดับการใช้งานแบบเดียวกัน หากย้าย prototype ตรง ๆ จะนำข้อมูลจำลองและพฤติกรรมที่ไม่มี domain support เข้ามา แต่หากละทิ้งต้นแบบ ผู้ใช้จะได้ระบบที่ถูกต้องทางเทคนิคแต่ไม่ตอบโจทย์ control center ที่ต้องการ

## Solution

สร้างชั้นนำเสนอของ production ใหม่ตาม hybrid information architecture ที่อนุมัติแล้ว ใช้ A สำหรับภาพรวม, B สำหรับการไหลของ Mission และ C สำหรับ approval โดยทุกมุมมองใช้ state และ command จาก Mission Orchestrator เดิม ความสามารถที่ยังไม่เชื่อมจะแสดงสถานะจำกัดอย่างซื่อสัตย์ และถูกเปิดใช้งานเป็นลำดับตาม Ticket 02–04

## User Stories

1. As a mission owner, I want to see every real Mission on one Command Deck, so that I can choose where to focus.
2. As a mission owner, I want metrics to be derived from current Mission state, so that dashboard numbers are trustworthy.
3. As a mission owner, I want to distinguish active, awaiting action, completed and cancelled Missions, so that operational priority is clear.
4. As a mission owner, I want to open a Mission from its card, so that I can move from overview to detail without searching.
5. As a mission owner, I want each card to show goal, risk, lifecycle stage and next action, so that I can triage quickly.
6. As a mission owner, I want empty states to explain how to create the first Mission, so that the interface remains useful without demo data.
7. As a mission owner, I want configured agent roles visible separately from live agents, so that I know team capability without assuming activity.
8. As a mission owner, I want disconnected roles labelled clearly, so that the UI never fabricates a running agent.
9. As a mission owner, I want Mission Detail to emphasize the current lifecycle stage, so that I know what is happening now.
10. As a mission owner, I want completed, current and locked stages visually distinct, so that progress cannot be misread.
11. As a mission owner, I want the next allowed command surfaced near the current stage, so that I do not need to understand the state machine.
12. As a mission owner, I want forbidden actions omitted or disabled with a reason, so that gates are visible before I attempt a bypass.
13. As a mission owner, I want the Brief visible beside execution state, so that implementation remains tied to the original objective.
14. As a mission owner, I want authority and deployment permission visible, so that implementation permission is never confused with release permission.
15. As a reviewer, I want events shown in sequence with actor, reason and Evidence, so that I can reconstruct the Mission.
16. As a reviewer, I want Evidence references attached to the event that produced them, so that validation is traceable.
17. As a reviewer, I want changes-requested and resumed transitions emphasized, so that correction loops are auditable.
18. As a mission owner, I want blocked state to show the blocker and prior safe state, so that recovery is deliberate.
19. As a mission owner, I want approval-required Missions to link to the Review Ledger, so that the decision surface is unambiguous.
20. As an approver, I want to see the exact candidate and current Evidence, so that I approve the intended artifact.
21. As an approver, I want residual risk and intended external action visible, so that consent is informed.
22. As an approver, I want a rollback commitment visible before approval, so that failure handling is explicit.
23. As an approver, I want rejection to require a reason, so that work returns to correction with useful context.
24. As an approver, I want approval to update Mission state without deploying, so that release remains a separate authority.
25. As a mission owner, I want status words and colors consistent across A, B and C, so that I can scan without relearning.
26. As a keyboard user, I want navigation, dialogs and actions fully operable with visible focus, so that the control center is accessible.
27. As a mobile user, I want priority information and the next action to remain visible without horizontal page overflow, so that I can operate from a small screen.
28. As an auditor, I want reload to reconstruct the same view from events, so that display state cannot silently diverge from history.
29. As an auditor, I want two tabs to converge on the same persisted sequence, so that concurrent use does not create contradictory dashboards.
30. As a maintainer, I want visual components to consume view data derived from the orchestrator state, so that future integrations do not bypass domain rules.
31. As a maintainer, I want prototype-only scenario controls excluded from production, so that test fixtures are not mistaken for product features.
32. As a maintainer, I want approval UI inactive until Ticket 03 is implemented, so that a visual affordance cannot imply missing authority.
33. As a maintainer, I want agent telemetry inactive until Ticket 04 is implemented, so that configuration is not presented as runtime observation.
34. As a maintainer, I want correction states introduced with Ticket 02 to reuse the same status vocabulary, so that loops fit the original information architecture.
35. As a product owner, I want the original prototypes retained until visual acceptance is complete, so that design intent remains reviewable.

## Implementation Decisions

- Keep the production app and throwaway prototype separate. Do not import prototype JavaScript or in-memory scenarios into production.
- Retain the current Mission Orchestrator as the single behavioral seam. UI actions issue commands; UI rendering consumes replayed observable state.
- Introduce no second store for visual state. Navigation and temporary dialog state may remain ephemeral, but Mission truth must remain event-derived.
- Use one shared application shell, design-token set, responsive grid, focus treatment and status vocabulary across A, B and C.
- Overview follows A's operational hierarchy: primary navigation, real metrics, Mission inventory, configured team directory and system state.
- Mission Detail follows B's lifecycle hierarchy: Mission hero, lifecycle rail, next action, Evidence/activity ledger and Brief context.
- Approval Room follows C's ledger hierarchy: decision summary, candidate identity, Evidence, residual risk, external action, rollback commitment and immutable decision history.
- The prototype scenario switcher is a development artifact and is excluded from production.
- Role cards before Ticket 04 show configuration only. `Working`, `Blocked`, `Reviewing`, progress, elapsed time and latest Evidence require observable Assignment/Run events.
- A lifecycle percentage is labelled `Lifecycle completion`, never `confidence`, unless a separate confidence model is specified and tested.
- Aggregate metrics document their derivation and use neutral empty values when no Mission exists.
- Approval navigation may be present but disabled with an explanation until the current Mission is in `APPROVAL_REQUIRED` and Ticket 03 is implemented.
- The correction loop introduced by Ticket 02 must map distinct review, validation and human rejection reasons into a shared visual changes-requested state without erasing reason provenance.
- Prototype files remain available as visual references until Ticket 07 hardening is accepted.
- No deployment, external messaging, commit, push or PR action is added by UI convergence.
- Recommended implementation order is Wave 1, Wave 2, then Ticket 02 and Ticket 04 in either order, followed by Ticket 03 and final hardening.

## Testing Decisions

- The principal behavioral test seam remains Mission Orchestrator: a command sequence must produce the expected observable state, event history, allowed actions and invalidations.
- UI tests assert user-observable DOM and interaction behavior, not private render helpers or CSS implementation details.
- Existing Ticket 01 black-box lifecycle, replay, validation and persistence tests remain the regression baseline.
- Overview journey tests cover zero, one and multiple real Missions; metric derivation; selection; and honest configured/disconnected agent states.
- Mission Detail journey tests cover every current Ticket 01 stage, next allowed action, Brief context, Evidence ledger and accepted no-release completion.
- Ticket 02 adds tests for blocked, changes-requested, resumed and cancelled presentation.
- Ticket 03 adds tests proving Approval Room uses the current candidate/Evidence, requires a reason on rejection and never deploys as a side effect.
- Ticket 04 adds tests proving live status appears only from real Assignment/Run observations and degrades to disconnected/error states when observation is unavailable.
- Replay tests verify that reload yields the same selected Mission status and audit content without persisting derived UI claims as Mission events.
- Concurrency tests retain the Web Locks contract and add a real two-tab browser test during hardening.
- Accessibility checks cover semantic landmarks, heading order, labelled controls, keyboard navigation, dialog focus, visible focus, contrast and reduced motion.
- Visual QA covers representative desktop and mobile widths for A, B and C, including long Thai/English content, empty data, failure states and no global overflow.
- Production build, existing automated tests and browser console checks must pass before each wave is marked complete.

## Out of Scope

- Copying prototype source directly into production
- Fake agent runs, fake progress, demo scenario switching or fabricated dashboard metrics
- Automatic deployment, commit, push, pull request creation or external messaging
- A new backend, cloud synchronization or multi-user identity system
- Autonomous playbook mutation or promotion
- Provider/model comparison dashboards
- Real agent orchestration before Ticket 04
- Human approval behavior before Ticket 03
- Replacing the event schema solely for styling convenience

## Further Notes

- This is the preferred next implementation slice because it stabilizes the product shell before Tickets 02–04 add more states and actions.
- The prototype remains a visual contract, not a runtime dependency.
- The approved testing seam is already established by Ticket 01; this plan does not require a new domain interface.
- Suggested execution ticket name: **UI-01 — Converge production Command Deck and Mission Flow on real state**.
- UI-01 should include Wave 1 and Wave 2 only. Approval Room activation remains part of Ticket 03, and live agent telemetry remains part of Ticket 04.
