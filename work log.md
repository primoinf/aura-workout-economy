# Work Log

Timezone: Asia/Bangkok (`+07:00`)

## 2026-07-28 18:50:21 +07:00

- Implemented Codex Mission Control Ticket 01 as a separate production Vite app under `codex-mission-control/`, preserving Aura, Nihongo Dojo, and the throwaway prototypes. The approved hybrid UI is now Command Deck Overview plus Mission Flow Detail with a complete Brief and local-only no-release journey.
- Used TDD through the public Mission Orchestrator seam. The 16 passing black-box tests cover Brief authority, every lifecycle state, immutable audit events, malformed and illegal commands, required Evidence, local persistence/reload, strict replay envelope/sequence/identity/gate validation, optimistic expected sequence, and serialized two-Orchestrator writes.
- Added Web Locks around the full browser read→validate→append operation, rejected release-required Missions until Ticket 03, and centralized lifecycle/action-to-command metadata in the domain.
- Browser validation passed at 1440×960 and 390×844: created a Mission, advanced all nine stages, accepted the no-release outcome, reloaded the exact completed projection, and verified mobile/desktop hierarchy, focus after navigation/actions, locally scrollable lifecycle lane, no global overflow, and no console warnings/errors.
- Two-axis Standards and Spec review found replay, release-scope, null-payload, concurrency, focus, contrast, and metadata duplication issues; all were fixed and both reviewers re-reviewed with no material finding. The remaining non-defect validation gap is that the Web Locks race test uses a faithful lock mock rather than two real browser tabs.
- `node --check`, 16/16 tests, Vite production build, browser checks, and `git diff --check` passed. Updated Ticket 01 to `done`; Tickets 02 and 04 are now unblocked. No deployment was performed.

## 2026-07-28 14:48:25 +07:00

- Used the `to-tickets` flow to turn the approved Codex Mission Control PRD and UI prototype findings into root `tickets.md`: seven single-context, end-to-end tracer bullets with 55 acceptance criteria, explicit blocker edges, and `ready-for-agent` status.
- Locked the hybrid production information architecture in the PRD and prototype notes: A Command Deck for Overview, B Mission Flow for Mission Detail, and C Review Ledger for Approval Room. The throwaway prototype must not be promoted directly.
- Verified the dependency frontier: Ticket 01 starts alone; after it passes, Tickets 02 and 04 can proceed independently; Ticket 03 depends on 01+02, Ticket 05 on 02+04, Ticket 06 on 05, and Ticket 07 on 03+05+06.
- UTF-8 structural checks confirmed all 7 unique ticket IDs, statuses, build sections, blocker sections, 55 acceptance criteria, valid blocker targets, and both recorded hybrid decisions. `git diff --check` passed.
- Changed `tickets.md`, `.scratch/codex-mission-control/PRD.md`, `.scratch/codex-mission-control/ui-prototype/NOTES.md`, `hotcache.md`, `task-board.md`, and `work log.md`. No production implementation, commit, or deployment was performed.

## 2026-07-28 14:35:16 +07:00

- Used the `prototype` UI branch to build a separate throwaway Codex Mission Control app with three structurally different layouts: A Command Deck, B Mission Flow, and C Review Ledger. Each exposes Overview, Mission Detail and Approval Room plus Happy path, Review loop and Release rejected scenarios.
- Added in-memory interactions for validation, Evidence inspection, human approval without deployment, human rejection, review correction, reset, navigation and URL-stable variant switching. Added one-command local run/build scripts to `package.json`.
- Used the in-app browser to validate desktop 1440×960 and mobile 390×844 layouts and exercise the full happy path, review loop, rejection path, Evidence drawer and variant switcher. Fixed missing accessible names in collapsed mobile navigation and restored Variant B scenario controls on small screens.
- `node --check`, the prototype production build, the root Vite production build and browser console inspection passed. No global horizontal overflow remained; Variant B intentionally uses a locally scrollable lifecycle lane on mobile.
- Recorded the preliminary design synthesis in the UI prototype notes: A is strongest for Overview, B for Mission lifecycle/hand-offs, and C for the human Approval Room. No variant was promoted, committed or deployed.
- Changed `.scratch/codex-mission-control/ui-prototype/`, `package.json`, `hotcache.md`, `task-board.md`, and `work log.md`; Nihongo Dojo was untouched.

## 2026-07-28 14:17:30 +07:00

- Used the `to-spec` skill to publish the Codex Mission Control PRD to the local tracker with `ready-for-agent` status, all required sections, 45 user stories, explicit implementation/testing decisions, MVP boundaries, and the Mission Orchestrator as the primary behavioral seam.
- Used the `prototype` skill to build a clearly marked throwaway, in-memory Mission lifecycle prototype with a pure state machine and terminal shell. Added one-command interactive and scenario walkthrough scripts to the root task runner.
- The scripted walkthrough passed 9/9 scenarios covering happy path, correction loops, block/resume, no-release completion, release gate bypass, missing Brief authority, critical playbook regression, candidate below Baseline, and stale approval invalidation.
- Prototype syntax checks, structural PRD validation, and the root Vite production build passed. Recorded the durable verdict and residual production gaps in the spec test report and prototype notes.
- Changed `.scratch/codex-mission-control/`, `package.json`, `hotcache.md`, `task-board.md`, and `work log.md`. No production application, commit, or deployment was created.

## 2026-07-28 14:04:06 +07:00

- Designed a concrete “Codex Mission Control” proposal from the two supplied references: a multi-role team dashboard plus a bounded, auditable self-improvement loop.
- Mapped the design to the verified project profiles: root Orchestrator, `luna_worker`, `terra_builder`, `terra_debugger`, `sol_architect`, and read-only `sol_reviewer`.
- Defined the Brief, Context Pack, execution/review/release workflow, dashboard surfaces, metrics, MVP phases, permission gates, and baseline-versus-candidate promotion rule. No application code or deployment was performed.
- Updated `hotcache.md` and recorded TASK-031 as a completed design task in `task-board.md`.

## 2026-07-28 13:57:30 +07:00

- Successfully spawned `/root/luna_routing_probe` with `agent_type: luna_worker` using a limited context fork. A full-history fork was correctly rejected because it inherits the parent agent type.
- The child confirmed its runtime role was `luna_worker`, matched the project Luna profile, listed all five `.codex/agents/*.toml` profiles, and completed read-only without changing files or running tests.
- Updated `hotcache.md` and moved TASK-015 from DOING to DONE in `task-board.md`.

## 2026-07-28 13:55:38 +07:00

- Confirmed in a fresh Codex Desktop task that the `spawn_agent` schema now exposes `agent_type` with all five project roles: `luna_worker`, `terra_builder`, `terra_debugger`, `sol_architect`, and `sol_reviewer`.
- Updated `hotcache.md` and `task-board.md`. No child was spawned, so actual runtime role selection remains to be verified by a minimal probe before TASK-015 can be marked DONE.

## 2026-07-28 03:48:22 +07:00

- Implemented Nihongo Dojo Lesson 18, “บอกจำนวนสินค้าที่ต้องการ,” aligned with Irodori Starter A1 Lesson 16 Can-do 68. Added 7 vocabulary items, 3 dialogue lines, and 5 quizzes covering `ひき肉200gください。`, `～つ`, `～個`, `1個・2個・3個`, and `～g`.
- Changed `nihongo-dojo/app/lesson-data.ts`, lesson/HTML regression tests, and regenerated `nihongo-dojo/html/index.html`; preserved `nihongo-dojo-v1` progress compatibility. The pre-existing `nihongo-dojo/app/globals.css` change was excluded.
- Passed TDD red→green checks plus `npm.cmd run lint`, `npm.cmd run test:html`, `npm.cmd test`, `npm.cmd run test:sites`, and `git diff --check`. Standards review found no issues; spec review gaps for `～つ` and varied `～個` quantities were fixed and re-reviewed. Committed as `e0c66c3` (`feat: add shopping quantity lesson`); no deployment.

## 2026-07-25 16:19:03 +07:00

- Deployed the current Nihongo Dojo production build to Vercel after the user explicitly approved including the existing uncommitted `nihongo-dojo/app/globals.css` change.
- Vercel production build passed and production alias `https://nihongo-dojo-pied.vercel.app` returned HTTP 200. The CSS change remains uncommitted locally and was not modified.

## 2026-07-25 15:35:03 +07:00

- Implemented Nihongo Dojo Lesson 17, “ถามราคาสินค้ากับพนักงาน,” aligned with Irodori Starter A1 Lesson 16 Can-do 67. Added 7 vocabulary items, 3 dialogue lines, and 5 quizzes for asking staff `いくらですか？` and understanding the `2,000円` answer.
- Changed `nihongo-dojo/app/lesson-data.ts`, lesson/HTML regression tests, and regenerated `nihongo-dojo/html/index.html`; preserved `nihongo-dojo-v1` progress compatibility. The pre-existing `nihongo-dojo/app/globals.css` change was excluded.
- Passed `npm.cmd run lint`, `npm.cmd run test:html`, `npm.cmd test`, `npm.cmd run test:sites`, and `git diff --check`. Reviews found no material defect; a test gap for the staff response and its price interpretation was fixed. Committed in the nested app repository as `88613f4` (`feat: add staff price question lesson`); no deployment.

## 2026-07-25 15:22:01 +07:00

- Implemented Nihongo Dojo Lesson 16, “ฟังและเข้าใจราคาสินค้า,” aligned with Irodori Starter A1 Lesson 16 Can-do 66. Added 7 vocabulary items, 3 dialogue lines, and 5 quizzes, including an audio-first question that speaks a price before the learner answers.
- Changed `nihongo-dojo/app/lesson-data.ts`, `nihongo-dojo/app/page.tsx`, lesson/HTML regression tests, and regenerated `nihongo-dojo/html/index.html`; preserved `nihongo-dojo-v1` progress compatibility. The pre-existing `nihongo-dojo/app/globals.css` change was excluded.
- Passed `npm.cmd run lint`, `npm.cmd run test:html`, `npm.cmd test`, `npm.cmd run test:sites`, and `git diff --check`. The spec review identified the missing audio assessment; it was fixed and validated. Committed in the nested app repository as `cb205be` (`feat: add product price lesson`); no deployment.

## 2026-07-25 15:08:16 +07:00

- Implemented Nihongo Dojo Lesson 15, “อ่านป้ายในศูนย์การค้า,” aligned with Irodori Starter A1 Lesson 15 Can-do 65. Added 7 vocabulary items, 3 dialogue lines, and 5 quizzes covering common signs including `入口`, `出口`, `休憩所`, and `案内所`.
- Changed `nihongo-dojo/app/lesson-data.ts`, lesson/HTML regression tests, and regenerated `nihongo-dojo/html/index.html`; preserved `nihongo-dojo-v1` progress compatibility. The pre-existing `nihongo-dojo/app/globals.css` change was excluded.
- Passed `npm.cmd run lint`, `npm.cmd run test:html`, `npm.cmd test`, `npm.cmd run test:sites`, and `git diff --check`. Independent standards/spec reviews found no material issues. Committed in the nested app repository as `4c9b925` (`feat: add shopping center signs lesson`); no deployment.

## 2026-07-25 14:52:27 +07:00

- Implemented Nihongo Dojo Lesson 14, “แสดงความคิดเห็นเกี่ยวกับสินค้า,” aligned with Irodori Starter A1 Lesson 15 Can-do 64. Added 7 vocabulary items, 3 dialogue lines, and 5 quizzes covering `わあ、かっこいいですね。` and simple responses about products.
- Changed `nihongo-dojo/app/lesson-data.ts`, lesson/HTML regression tests, and regenerated `nihongo-dojo/html/index.html`; preserved `nihongo-dojo-v1` progress compatibility. The pre-existing `nihongo-dojo/app/globals.css` change was excluded.
- Passed `npm.cmd run lint`, `npm.cmd run test:html`, `npm.cmd test`, `npm.cmd run test:sites`, and `git diff --check`. Independent standards/spec reviews found no material issues. Committed in the nested app repository as `c4c9c62` (`feat: add product comments lesson`); no deployment.

## 2026-07-25 14:39:14 +07:00

- Implemented Nihongo Dojo Lesson 13, “ถามพนักงานว่าสินค้าอยู่ชั้นไหน,” aligned with Irodori Starter A1 Lesson 15 Can-do 63. Added 7 vocabulary items, 3 dialogue lines, and 5 quizzes covering `カメラは何階ですか？` and staff replies with a floor.
- Changed `nihongo-dojo/app/lesson-data.ts`, lesson/HTML regression tests, and regenerated `nihongo-dojo/html/index.html`; preserved `nihongo-dojo-v1` progress compatibility. The pre-existing `nihongo-dojo/app/globals.css` change was excluded.
- Passed `npm.cmd run lint`, `npm.cmd run test:html`, `npm.cmd test`, `npm.cmd run test:sites`, and `git diff --check`. Independent standards/spec reviews found no material issues. Committed in the nested app repository as `96efb3e` (`feat: add staff floor question lesson`); no deployment.

## 2026-07-24 02:09:20 +07:00

- Implemented Nihongo Dojo Lesson 12, “ดูผังร้านเพื่อหาของ,” from Irodori Starter A1 Lesson 15 Can-do 62. Added 7 vocabulary items, 3 dialogue lines, 5 quizzes, and a rendered data-driven shopping-center floor guide.
- Added `floorGuide` lesson data and the optional floor-guide card in `app/page.tsx`; corrected `3階` to `さんがい` and added a regression assertion. Regenerated `html/index.html`.
- Passed `npm.cmd run lint`, `npm.cmd run test:html`, `npm.cmd test`, `npm.cmd run test:sites`, and `git diff --check`. Spec/standards reviews found missing visible floor-guide practice and the reading error; both fixes were re-reviewed with no remaining material findings.
- Committed scoped app changes in `nihongo-dojo` as `6e5d60d` (`feat: add floor guide lesson`). Left unrelated `app/globals.css` untouched.

## 2026-07-24 00:35:12 +07:00

- Added a collapsible study helper to Nihongo Dojo lesson pages: current-lesson vocabulary with pronunciation, Thai meaning, and romaji; plus expandable hiragana and katakana reference grids.
- Preserved the lesson context while opening the full kana page, so its return action reopens the originating lesson. Added bundle and navigation-context regression assertions; regenerated `html/index.html`.
- Passed `npm.cmd run lint`, `npm.cmd run test:html`, `npm.cmd test`, `npm.cmd run test:sites`, and `git diff --check`. Independent spec/standards review found the kana return-path issue, which was fixed before commit. Browser local-port visual inspection was unavailable; rendered-server/bundle/VM checks passed.
- Committed scoped app changes in `nihongo-dojo` as `edf72e3` (`feat: add lesson study helper`). Left unrelated `app/globals.css` untouched.

## 2026-07-23 23:51:37 +07:00

- Implemented Nihongo Dojo Lesson 11 for Irodori Starter A1 Lesson 15 Can-do 61: asking where an item can be bought.
- Added data, lesson/HTML tests, and regenerated `nihongo-dojo/html/index.html`; also repaired the Lesson 10 test pattern to match its existing grammar data.
- Passed `npm.cmd run lint`, `npm.cmd run test:html`, `npm.cmd test`, `npm.cmd run test:sites`, and `git diff --check`; review found no material Lesson 11 issue.
- Committed scoped app changes as `363ccdb` (`feat: add shopping location lesson`). Left unrelated `app/globals.css` untouched.

## 2026-07-23 05:45:00 +07:00

- Implemented Lesson 10 sign-reading content in `nihongo-dojo/app/lesson-data.ts`, preserving the existing `nihongo-dojo-v1` progress shape.
- Added TDD coverage and HTML markers in `nihongo-dojo/tests/lesson-data.test.mjs` and `nihongo-dojo/tests/html-build.test.mjs`; regenerated `nihongo-dojo/html/index.html`.
- Validation passed with `npm.cmd run lint`, `npm.cmd run test:html`, `npm.cmd test`, `npm.cmd run test:sites`, and `git diff --check`.
- Committed scoped app changes as `68c5257` (`feat: add sign reading lesson`). Left unrelated `app/globals.css` untouched.

## 2026-07-21 06:21:56 +07:00

- เพิ่มบทที่ 9 “บอกความรู้สึกเกี่ยวกับสถานที่” ต่อจากบท 8 โดยใช้ Irodori Starter L14 Activity 3 / Can-do 59; key phrase คือ `ひろい こうえんですね`
- เพิ่มคำศัพท์ 7 คำ บทสนทนา 3 บรรทัด แบบทดสอบ 5 ข้อ และไวยากรณ์คำคุณศัพท์ な/い + คำนาม + `ですね`; ระบุข้อยกเว้น `きれいな` และรูป `おおきい／おおきな`
- ทำ TDD สอง seam: lesson data และ self-contained HTML red→green; เพิ่ม HTML markers ครอบคลุม vocabulary, dialogue, grammar และ quiz ตาม review finding
- Validation รอบสุดท้ายผ่าน: `npm run lint`, `npm run test:html`, `npm test`, `npm run test:sites`; lesson tests 9/9 และ `git diff --check` ผ่าน
- Standards/Spec review และ re-review ไม่พบ finding ที่เหลือ; generated HTML มี CSS ตรงกับ baseline และมีบท 9 ครบ; ไม่ได้ทำ browser visual run เพราะเป็น data-only change และ `file://` ถูกจำกัดใน environment นี้
- Commit ใน repo `nihongo-dojo`: `c4afa7e` (`feat: add place impressions lesson`); ไม่ได้ deploy เพราะผู้ใช้ไม่ได้ขอ
- ไฟล์แอปที่เปลี่ยน: `app/lesson-data.ts`, `html/index.html`, `tests/html-build.test.mjs`, `tests/lesson-data.test.mjs`; คง `app/globals.css` เดิมเป็น uncommitted change และไม่รวมใน commit

## 2026-07-21 04:58:10 +07:00

- เพิ่มบทที่ 8 “บอกว่าตอนนี้อยู่ที่ไหน” ต่อจากบทถามหาสถานที่ โดยอิง Irodori Starter A1 บท 14 Can-do 58; key phrase คือ `いま、かいさつの まえに います`
- เพิ่มคำศัพท์ 7 คำ บทสนทนาทางโทรศัพท์ 3 บรรทัด แบบทดสอบ 5 ข้อ และ append ข้อมูลต่อท้ายเพื่อรักษา progress เดิมใต้ `nihongo-dojo-v1`
- ทำ TDD สอง seam: lesson data และ self-contained HTML red→green; ปิด review gap ด้วย assertion จำนวนบทสนทนา, 4 ตัวเลือกไม่ซ้ำ, answer ที่ถูกช่วง และ note ที่ไม่ว่าง
- Validation ผ่าน: `npm run lint`, `npm run test:html`, `npm test`, `npm run test:sites`; lesson tests 8/8 และ `git diff --check` ผ่าน
- Standards/Spec review และ re-review ไม่พบ finding; Browser visual check เปิด `file://` ไม่ได้ตาม policy แต่ HTML execute ใน VM และ Next/Sites rendered-server tests ผ่าน
- Commit ใน repo `nihongo-dojo`: `558e04a` (`feat: add current location lesson`); ไม่ได้ deploy เพราะผู้ใช้ไม่ได้ขอ
- ไฟล์แอปที่เปลี่ยน: `app/lesson-data.ts`, `html/index.html`, `tests/html-build.test.mjs`, `tests/lesson-data.test.mjs`; คง `app/globals.css` เดิมเป็น uncommitted change และไม่รวมใน commit

## 2026-07-17 01:52:36 +07:00

- Deploy commit `130e212` จาก clean worktree ไป Vercel production สำเร็จ โดยไม่รวม uncommitted `app/globals.css`
- Vercel remote build ผ่าน Next.js 16.2.6 และ production alias ชี้ไปที่ https://nihongo-dojo-pied.vercel.app
- ตรวจ alias หลัง deploy: HTTP 200; JavaScript bundles 7 ไฟล์มี `lesson-6`, `ラーメンを ひとつ ください`, `lesson-7`, `トイレは どこですか` และ `l7-toire`
- ลบ clean worktree ชั่วคราวแล้ว; repo หลักยังเหลือเฉพาะ CSS patch เดิมเป็น uncommitted change
- ไฟล์ที่เปลี่ยน: `task-board.md`, `hotcache.md`, `work log.md`; source ของแอปไม่เปลี่ยน

## 2026-07-17 01:33:50 +07:00

- ตรวจ Vercel production `https://nihongo-dojo-pied.vercel.app`: ตอบ HTTP 200 แต่ HTML ไม่มี marker ของบทที่ 6, บทที่ 7 หรือประโยค `トイレは どこですか`
- repo `nihongo-dojo` มี local Vercel project link แต่ไม่มี Git remote จึงไม่มีเส้นทาง auto-deploy สำหรับ commit `130e212`
- ยังไม่สั่ง deploy ใหม่ เพราะคำขอรอบนี้เป็นการถามสถานะ ไม่ใช่การอนุมัติ external write
- ไฟล์ที่เปลี่ยน: `hotcache.md`, `work log.md`; source ของแอปไม่เปลี่ยน

## 2026-07-17 01:29:29 +07:00

- เพิ่มบทที่ 6 “สั่งอาหารและเครื่องดื่ม” และบทที่ 7 “ถามหาสถานที่” ใน Nihongo Dojo โดยรักษา localStorage key `nihongo-dojo-v1` และ progress เดิม
- ทำ TDD สอง seam: lesson data red→green และ self-contained HTML red→green; บทที่ 7 มีคำศัพท์ 7 คำและแบบทดสอบ 5 ข้อ
- Standards/Spec review: Spec ไม่มี finding; แก้ duplicated test assertions เป็น table-driven cases แล้ว reviewer ยืนยันว่าไม่เกิด regression
- Validation ผ่าน: `npm run lint`, `npm run test:html`, `npm test`, และ `npm run test:sites`; lesson tests 7/7 ผ่าน
- เผยแพร่ Sites แบบส่วนตัวสำเร็จที่ https://nihongo-dojo-th.kobeat-m1.chatgpt.site และบันทึก Sites project ID ใน `.openai/hosting.json`
- Commit ใน repo `nihongo-dojo`: `130e212` (`feat: add restaurant and location lessons`); push commit เดียวกันไป source repository ของ Sites
- ไฟล์แอปที่เปลี่ยน: `.openai/hosting.json`, `app/lesson-data.ts`, `html/index.html`, `tests/html-build.test.mjs`, `tests/lesson-data.test.mjs`
- คง `app/globals.css` ที่แก้ไว้ก่อนหน้าเป็น uncommitted change และไม่รวมใน commit ตามขอบเขตงาน

## 2026-07-16 23:46:41 +07:00

- Fixed Codex sub-agent config: `multi_agent = true`, removed global `[features.multi_agent_v2] hide_spawn_agent_metadata = false`, converted project custom agents to inherit parent model/reasoning, and updated `AGENTS.md`.
- Fixed global `C:\Users\HYPERX\.codex\hooks.json` to the current top-level `hooks` schema and UTF-8 without BOM; validation: fresh `codex exec` replied `OK` with no hooks parse error.
- Validation: current Desktop task can start default and built-in `worker` subagents; custom agent spawns in this already-loaded task still fail with the old reserved `collaboration.spawn_agent` schema. A full Desktop restart/fresh task is required to validate custom-agent reload.
- Files changed: `C:\Users\HYPERX\.codex\config.toml`, `C:\Users\HYPERX\.codex\hooks.json`, `.codex/agents/*.toml`, `AGENTS.md`, `hotcache.md`, `task-board.md`, `work log.md`; no application source changed.
## 2026-07-16 23:16:42 +07:00

- Removed `model = "gpt-5.6-sol"` and `model_reasoning_effort = "xhigh"` from `C:\Users\HYPERX\.codex\config.toml` to restore normal default model selection.
- Validation: both overrides are absent; `multi_agent = false` remains at line 75. A full Desktop restart and a fresh-task `test` are pending.
- Files changed: global Codex config, `hotcache.md`, `work log.md`; application source was not changed.

## 2026-07-16 22:56:16 +07:00

- Disabled Codex feature `multi_agent` at the user's request with `codex features disable multi_agent`.
- Validation: `codex features list` reports `multi_agent` as `stable false`.
- Closed `TASK-014` as superseded by the user's disable request; no sub-agent was spawned in this turn.
- Files changed: `hotcache.md`, `task-board.md`, `work log.md`; application source was not changed.

## 2026-07-16 22:48:32 +07:00

- Updated Codex CLI with user authorization. `codex --version` and strict-config doctor both report `0.144.5`; installation is consistent.
- Re-ran the isolated Sol routing probe with `hide_spawn_agent_metadata=false`. It still failed before the model turn with the same API HTTP 400 reserved `collaboration.spawn_agent` schema error, so the update alone does not change an already-pinned session schema.
- The updater requires a Codex Desktop restart. Next validation must be in a newly opened Desktop session; the unrelated legacy `hooks.json` warning remains but was not changed.
- Files changed: `hotcache.md`, `task-board.md`, `work log.md`; application source was not changed.

## 2026-07-16 22:45:14 +07:00

- Added global `[features.multi_agent_v2] hide_spawn_agent_metadata = false` to `C:\Users\HYPERX\.codex\config.toml`; strict-config doctor accepted it.
- Fresh Sol probes with normal config and isolated config both failed before a model turn with API HTTP 400 for the reserved `collaboration.spawn_agent` schema. The same isolated failure separates it from the new setting and the pre-existing `hooks.json` schema warning.
- CLI is `0.144.4`; doctor reports `0.144.5` available, matching the community workaround's tested version. No CLI update was performed because it requires user authorization.
- Files changed: Codex config, `hotcache.md`, `task-board.md`, `work log.md`; application source was not changed.

## 2026-07-16 22:11:29 +07:00

- Opened `https://example.com/` in the Codex in-app Browser and left the page visible for the user.
- Validation: final URL `https://example.com/`, title `Example Domain`; the IAB route worked and Codex Desktop did not crash.
- Files changed: `hotcache.md`, `work log.md`; application source was not changed.

บันทึกงานสำคัญแบบเรียงรายการใหม่ไว้บนสุด ระบุผลลัพธ์ ไฟล์ที่เปลี่ยน และ validation โดยไม่บันทึก secrets

## 2026-07-16 22:07:23 +07:00

- ทดสอบ built-in Browser หลังผู้ใช้ clear browsing data และ restart Codex; ChatGPT/Codex Desktop processes ยังทำงานครบและไม่มี Crashpad report ใหม่
- log ยืนยัน Browser plugin ถูก uninstall/reinstall สำเร็จ แต่ current task ยังไม่มี IAB route: `agent.browsers.list()` คืน `[]` และ log ระบุ `No ChatGPT browser route is available`
- ไม่เปิด backend อื่นแทนตาม Browser troubleshooting; ขั้นถัดไปคือลองใน task ใหม่เพื่อสร้าง route ใหม่ แล้วเปิด `https://example.com`
- ไฟล์ที่เปลี่ยน: `hotcache.md`, `task-board.md`, `work log.md`; source ของแอปไม่ถูกแก้

## 2026-07-16 22:00:36 +07:00

- วินิจฉัย Codex Desktop ปิดเอง: พบ Crashpad dump 44,969,840 bytes เวลา 21:49:51; Windows Event Log ไม่มี Application Error/Hang ใน 12 ชั่วโมงล่าสุด
- Desktop session สองรอบจบฉับพลันตรงกับ built-in Browser/IAB webview lifecycle; รอบแรกจบหลัง attach `about:blank`, รอบสองจบประมาณ 2 วินาทีหลังหน้า Vercel `dom-ready` จึงตัดหน้าเว็บ Vercel ออกจากสาเหตุ
- plugin cache และ bundled Browser ใช้เวอร์ชัน `26.707.91948` ตรงกัน จึงตัด version mismatch; log มี route error `No ChatGPT browser route` ก่อนสร้าง webview
- เครื่องไม่มี WinDbg/cdb/dumpchk/minidump_stackwalk จึงยังระบุ native crash frame ไม่ได้; workaround คือหลีกเลี่ยง built-in Browser และใช้ HTTP/CLI หรือ Chrome แทน พร้อมส่ง `/feedback` แนบ logs/task ID ตามคู่มือ
- ปิด `TASK-012`: Vercel production build `READY` และ `https://nihongo-dojo-pied.vercel.app` ตอบ HTTP 200
- ไฟล์ที่เปลี่ยน: `hotcache.md`, `task-board.md`, `work log.md`; source ของแอปไม่ถูกแก้

## 2026-07-16 21:31:40 +07:00

- เริ่ม `TASK-012` เพื่อทดลอง deploy `nihongo-dojo` ขึ้น Vercel; ยืนยันว่า deploy ผ่าน CLI โดยตรงได้และไม่จำเป็นต้องขึ้น GitHub ก่อน
- `npm.cmd test` ผ่าน: Next.js production build สำเร็จ, lesson tests 5/5 และ Vercel config/render tests 2/2
- Vercel CLI 56.2.1 ทำงาน แต่ session/token เดิมไม่ถูกต้อง จึงยังไม่ได้สร้าง deployment; ต้อง `vercel login` ใหม่ก่อน
- Git remote ปัจจุบันชี้ `primoinf/aura-workout-economy` และ `nihongo-dojo/` ยัง untracked จึงไม่ควร Import repo ปัจจุบันเข้า Vercel หากต้องการ Git integration
- ไฟล์ที่เปลี่ยน: `hotcache.md`, `task-board.md`, `work log.md`; ไม่มี source ของแอปถูกแก้

## 2026-07-16 06:57:00 +07:00

- อ่าน community post “Restoring subagent roles, model and reasoning in multi_agent_v2”; workaround ใช้ `task_name` route + `PreToolUse` hook inject metadata ซึ่งอธิบาย symptom ที่ spawn API ไม่มี `agent_type` ได้ตรง
- เทียบกับ Codex manual ที่ cache อยู่: manual รับรอง hooks และ `SubagentStart` แต่ระบุว่า `PreToolUse` รองรับ `systemMessage` และไม่รับรอง `updatedInput` rewrite; post จึงเป็น build-specific workaround ไม่ใช่ configuration ที่ควรคัดลอกทันที
- ข้อจำกัด local: Python ไม่ได้ติดตั้ง และ post เสนอให้ลบ legacy `[agents]` ที่ยังถูกอธิบายใน official manual; ไม่แก้ไฟล์หรือเปลี่ยน config

## 2026-07-16 06:49:49 +07:00

- รีวิว `origin/main...HEAD` ตามคำขอด้วย agents 3 ตัว (security, test gaps, maintainability); scope คือ commit `d46e3fb` ที่เพิ่ม `.codex/agents/reviewer.toml` ไม่รวม worktree changes ที่ยังไม่ commit
- Findings: High security เพราะ `sandbox_mode = "read-only"` ไม่ enforce เมื่อ parent runtime เป็น danger-full-access; High test gap เพราะไม่มี acceptance check สำหรับ actual model/effort/sandbox หรือ developer instructions; Major maintainability เพราะ profile ไม่มี invocation path ที่เลือกได้จริงและซ้ำกับ `sol_reviewer`
- Validation: `git rev-parse origin/main`, `git diff --check origin/main...HEAD`, และ reviewer results ครบ 3/3; ย้าย `TASK-011` เป็น `DONE`
- ไฟล์ที่เปลี่ยน: `hotcache.md`, `task-board.md`, `work log.md`; ไม่มี source code ถูกแก้

## 2026-07-16 06:44:23 +07:00

- สร้าง `.codex/agents/reviewer.toml` ตรงตาม official example (`gpt-5.4`, `high`, `read-only`) และ commit เฉพาะไฟล์นี้เป็น `d46e3fb`
- `codex --strict-config doctor --summary` โหลด config สำเร็จ; มี warning เดิมเรื่อง state DB ชี้ rollout ที่หาย แต่ไม่มี config failure
- spawn `/root/reviewer` และได้ `REVIEWER_PROBE_OK`; child อ่านค่าจากไฟล์ได้ แต่ rollout `019f6827-ab17-73e1-be03-02571099ef82` แสดง actual `gpt-5.6-sol`/`xhigh`/danger-full-access จึงยืนยันว่า current spawn surface ไม่ได้เลือก profile
- Standards review ไม่มี finding; Spec review ยืนยัน committed TOML ตรงคำขอและระบุ runtime mismatch เป็น finding สำคัญ; ย้าย `TASK-003` เป็น `DONE`
- ไฟล์ที่เปลี่ยน: `.codex/agents/reviewer.toml`, `hotcache.md`, `task-board.md`, `work log.md`; validation: strict doctor, spawn marker, direct rollout inspection, `git diff --check`, two-axis review; application tests ไม่เกี่ยวข้องและไม่ได้รัน

## 2026-07-16 06:35:27 +07:00

- อ่านหน้า official `Subagents` ที่ผู้ใช้ส่งมาโดยตรง; ยืนยันว่า screenshot `docs-researcher.toml` มาจาก “Example 1: PR review” และเป็น agent ตัวที่สามคู่กับ `pr_explorer`/`reviewer`
- สรุปใหม่แบบมีเงื่อนไข: ต้องสร้าง `docs_researcher` หากต้องการทำ workflow ตัวอย่างและเรียกชื่อนี้ใน prompt แต่ custom subagent ทั่วไปไม่บังคับให้มี role นี้
- เอกสารระบุว่า app/CLI/IDE รองรับ subagent activity, agent TOML ไม่ต้องลงทะเบียนรายชื่อซ้ำ และ `[agents]` ใน project config ใช้ตั้ง global limits; ไฟล์ที่เปลี่ยน: `hotcache.md`, `work log.md`; ไม่รัน application tests เพราะไม่มี source change

## 2026-07-16 06:31:59 +07:00

- ตรวจคู่มือ Codex ปัจจุบันและเทียบกับ `.codex/agents/*.toml`; custom agent ต้องมี `name`, `description`, `developer_instructions` ส่วน model, reasoning, sandbox และ MCP เป็น optional
- ยืนยันว่า agent profiles ทั้ง 5 ตัวในโปรเจกต์ใช้ schema ถูกต้อง และ `docs_researcher` เป็นบทบาทเสริม ไม่ใช่ไฟล์บังคับ; การเพิ่มไฟล์ไม่ยืนยันว่า client surface เลือก profile ตอน spawn ได้จริง
- ไฟล์ที่เปลี่ยน: `hotcache.md`, `work log.md`; validation: manual helper รายงาน local manual current, `codex --version` = `0.144.4`, และ `codex mcp list` ยังไม่มี `openaiDeveloperDocs`

## 2026-07-16 06:18:10 +07:00

- ตรวจ local rollout ของ child `/root/luna_worker`; `turn_context` ยืนยัน actual model `gpt-5.6-sol` effort `xhigh` และ token usage สุดท้าย 98,382 tokens
- `session_meta` ระบุ `agent_role: null`; spawn function call มีเฉพาะ `task_name`, `fork_turns`, `message` จึงเป็น task path ไม่ใช่ custom-agent selection
- ย้าย `TASK-003` จาก `DONE` กลับ `TO DO` และแก้ข้อสรุปใน `hotcache.md`; ไฟล์ที่เปลี่ยน: `hotcache.md`, `task-board.md`, `work log.md`
- Validation: อ่าน model/effort/usage จาก rollout JSONL โดยตรง; ไม่รัน application test/build เพราะไม่มี source change

## 2026-07-16 06:06:16 +07:00

- ผู้ใช้รัน end-to-end Codex CLI probe และส่งภาพผลลัพธ์: CLI เริ่ม `/root/luna_worker`, `/agent` แสดง custom-agent thread และ child คืน `LUNA_WORKER_PROBE_OK`
- Child อ่าน `.codex/agents/luna_worker.toml` ได้ `gpt-5.6-luna` กับ effort `low` และรายชื่อ project agents ครบ 5 ไฟล์
- Validation gap ถูกบันทึกไว้: runtime ไม่เปิดเผย actual model หรือ actual agent type telemetry จึงยืนยัน custom-agent routing/config ได้ แต่ไม่ใช่ server-side model attestation
- ย้าย `TASK-003` จาก `TO DO` เป็น `DONE`; ไม่มี application source ถูกแก้ไข

## 2026-07-16 05:56:12 +07:00

- อ่านหน้า official `Agents SDK: Models and providers`; ยืนยันการเลือก model ราย agent, run-level default และ process fallback ผ่าน `OPENAI_DEFAULT_MODEL`
- แยกขอบเขตว่าเอกสารนี้ใช้กับ Agents SDK ในโค้ด TypeScript/Python ไม่ใช่ Codex CLI/Desktop subagent runtime
- ตรวจ model catalog เพิ่มเติมและยืนยันว่า `gpt-5.6-luna` รองรับ reasoning รวมถึง `medium`
- ไฟล์ที่เปลี่ยน: `hotcache.md`, `task-board.md`, `work log.md`; ไม่มี application source ถูกแก้ไข

## 2026-07-16 05:49:59 +07:00

- ตรวจ Codex CLI ที่ติดตั้งจริง: `codex-cli 0.144.4`, `multi_agent` เป็น stable และ CLI มี `--model`, `--config`, `--profile` แต่ไม่มี `--agent`
- คู่มือล่าสุดยืนยันว่า interactive CLI โหลด custom agents จาก `.codex/agents/`, สั่ง spawn ด้วยชื่อผ่าน prompt และใช้ `/agent` ตรวจ/สลับ thread ได้
- สรุปว่า root session เลือก `gpt-5.6-luna` + effort `medium` ได้ด้วย CLI override; หากต้องการ spawned `luna_worker` เป็น Medium ต้องแก้หรือเพิ่ม agent file เพราะไฟล์ปัจจุบันกำหนด `low`
- Validation gap: ยังไม่ได้เปิด session ที่เรียกโมเดลจริง จึงยังไม่ยืนยัน entitlement/model availability ของบัญชีและ end-to-end custom-agent spawn
- ไฟล์ที่เปลี่ยน: `hotcache.md`, `task-board.md`, `work log.md`; ไม่มี application source ถูกแก้ไข

## 2026-07-16 05:43:13 +07:00

- ทดสอบ `spawn_agent` แบบ read-only สำเร็จด้วย task `/root/luna_spawn_probe` และได้รับผลตอบกลับครบวงจร
- Agent ตรวจพบว่า `.codex/agents/luna_worker.toml` ระบุ model `gpt-5.6-luna` กับ reasoning effort `low` ไม่ใช่ Medium
- Validation gap: API spawn ที่ใช้งานอยู่ไม่มีพารามิเตอร์เลือก custom agent/model และ runtime ไม่เปิดเผย profile จึงยืนยันไม่ได้ว่า sub-agent รันเป็น `luna_worker` จริง
- ไฟล์ที่เปลี่ยน: `hotcache.md`, `task-board.md`, `work log.md`; ไม่มี source code ถูกแก้ไข

## 2026-07-15 17:58:00 +07:00

- เพิ่มบทที่ 4 “ถามเรื่องอาชีพ” (`おしごとは なんですか`) และบทที่ 5 “ถามราคาและซื้อของ” (`これは いくらですか`) ต่อท้ายบทเดิมแบบ data-driven
- แต่ละบทมีบทสนทนา ไวยากรณ์ คำศัพท์ใหม่ 7 คำ และ quiz 5 ข้อ โดยรักษาลำดับคำศัพท์เดิมและ progress key `nihongo-dojo-v1`
- แบ่งงานให้ `lesson4_content`, `lesson4_qa`, `lesson5_content`, `lesson5_qa` และ standards/spec reviewers; แก้ findings เรื่อง source-test duplication, answer bounds, คำตอบอาชีพ และตัวอย่าง `これは...`
- ไฟล์หลักที่เปลี่ยน: `nihongo-dojo/app/lesson-data.ts`, `tests/lesson-data.test.mjs`, `tests/html-build.test.mjs`, `html/index.html`
- Validation: lesson tests ผ่าน 4/4; `npm run lint`, `npm run test:html`, `npm test`, `npm run test:sites` ผ่านทั้งหมด

## 2026-07-15 15:18:00 +07:00

- เพิ่มบทเรียนที่ 3 “ถามว่ามาจากที่ไหน” (`どこから？`) ต่อท้ายบทแนะนำตัว โดยมี key phrase `どこから きましたか`, บทสนทนา, ไวยากรณ์, 7 คำศัพท์ และแบบทดสอบ 5 ข้อ
- แบ่งงานให้ `lesson3_content` ออกแบบและตรวจภาษา, `lesson3_qa` ตรวจ flow/progress compatibility และให้ standards/spec reviewers ตรวจอิสระ; แก้ finding เรื่องขอบเขตข้อมูลทดสอบและรวมคำสั่งไว้ที่ `test:lessons`
- ไฟล์หลักที่เปลี่ยน: `nihongo-dojo/app/lesson-data.ts`, `tests/lesson-data.test.mjs`, `tests/html-build.test.mjs`, `package.json`, `html/index.html`
- Validation: `npm run lint`, `npm run test:html`, `npm test`, `npm run test:sites` ผ่านทั้งหมด

## 2026-07-14 23:49:34 +07:00

- เพิ่ม `nihongo-dojo/html/index.html` แบบ self-contained ซึ่งฝัง CSS และ classic JavaScript bundle ไว้ในไฟล์เดียว เปิดด้วยการดับเบิลคลิกได้โดยไม่ต้องรัน server
- เพิ่ม build lane `build:html`, runtime/static tests และ storage adapter ที่รักษา key `nihongo-dojo-v1` พร้อม fallback เมื่อ `file://` ถูกบล็อก storage
- ใช้ agent `html_bundle_review` วิเคราะห์และรีวิวอิสระสองรอบ; แก้ findings เรื่อง `process.env.NODE_ENV`, memory fallback และการ clear progress ข้ามแท็บครบแล้ว
- ไฟล์หลักที่เพิ่ม/เปลี่ยน: `html/index.html`, `html-entry.tsx`, `scripts/build-html.mjs`, `app/progress-storage.js`, `app/page.tsx`, `tests/html-build.test.mjs`, `tests/progress-storage.test.mjs`, `package.json`, `README.md`
- Validation: `npm run lint` ผ่าน; `npm run test:html` ผ่าน 4 tests; `npm test` ผ่าน 2 tests; `npm run test:sites` ผ่าน 3 tests

## 2026-07-14 21:55:27 +07:00

- ปรับ `nihongo-dojo` ให้ใช้ Next.js มาตรฐานเป็นเส้นทางหลักสำหรับ Vercel พร้อม `vercel.json` และ `tsconfig.next.json` ที่ไม่ดึงไฟล์ Cloudflare-only มาตรวจใน Vercel build
- เก็บเส้นทาง OpenAI Sites/Cloudflare เดิมไว้ผ่านคำสั่ง `dev:sites`, `build:sites`, `start:sites` และ `test:sites`
- เพิ่ม regression tests สำหรับ configuration และ production server ของ Vercel รวมถึงปรับ `README.md` ให้ระบุ Root Directory และขั้นตอน deploy
- ไฟล์ที่เปลี่ยน: `nihongo-dojo/package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.next.json`, `vercel.json`, `README.md`, `tests/vercel-config.test.mjs`, `tests/vercel-rendered-html.test.mjs`
- Validation: `npm run lint` ผ่าน; `npm test` ผ่าน 2 tests และ Next.js production build; `npm run test:sites` ผ่าน 3 tests

## 2026-07-14 04:00:13 +07:00

- สร้าง `task-board.md` พร้อมสถานะ `TO DO`, `DOING`, `DONE` และใส่งานล่าสุดที่ทราบ
- สร้าง `work log.md` สำหรับประวัติการทำงานแบบมี timestamp
- อัปเดต `AGENTS.md` ให้ agent ดู task board ตอนเริ่มงาน ย้ายสถานะให้ตรงกับงานจริง และเพิ่ม work log หลังงานสำคัญ
- อัปเดต `hotcache.md` ให้สะท้อนระบบติดตามงานใหม่
- Validation: ตรวจชื่อไฟล์ โครงสร้างสถานะ timestamp และกติกาการอัปเดตแล้ว

### บันทึกย้อนหลังของงานก่อนมี Work Log

- ตรวจพบ Codex project agents ครบ 5 ตัวใน `.codex/agents/` และค่าตรงกับนโยบาย routing ใน `AGENTS.md`
- สร้าง `hotcache.md`; ตรวจแล้วมี 96 คำ ซึ่งต่ำกว่าขีดจำกัด 500 คำ
- เวลาที่ทำสองรายการย้อนหลังไม่ได้ถูกบันทึกไว้ จึงรวมไว้ใต้ timestamp เวลาที่สร้าง Work Log นี้แทนการสมมติเวลา
