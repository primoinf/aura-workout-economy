# Task Board

อัปเดตล่าสุด: 2026-07-28 19:44:45 +07:00

ย้ายงานระหว่างสามสถานะนี้เมื่อสถานะเปลี่ยน ทุกงานต้องอยู่เพียงสถานะเดียว และจะเป็น `DONE` ได้เมื่อ validation ผ่านหรือมีการระบุสิ่งที่ยังตรวจไม่ได้

## TO DO

| ID | งาน | ผู้รับผิดชอบ | อัปเดตล่าสุด | หมายเหตุ |
| --- | --- | --- | --- | --- |

## DOING

| ID | งาน | ผู้รับผิดชอบ | อัปเดตล่าสุด | หมายเหตุ |
| --- | --- | --- | --- | --- |

## DONE

## Recent completion

| ID | Task | Owner | Updated | Validation |
| --- | --- | --- | --- | --- |
| TASK-037 | Implement Codex Mission Control UI-01 shared shell + real-state A/B convergence | Codex | 2026-07-28 19:44:45 +07:00 | Production A Command Deck and B Mission Flow now consume replayed Mission projections; configured roles explicitly have unavailable telemetry; fail-closed history guard prevents hidden writes; 19/19 tests, syntax, build, 1440/390/320 browser journeys, full completion/reload replay, focus, overflow, console, and final two-axis re-review passed. Commit remains pending because the Git escalation was rejected before execution when Codex usage reached its limit. |
| TASK-036 | Plan Codex Mission Control UI Convergence as Brief + Context + Workflow | Codex | 2026-07-28 19:16:07 +07:00 | Published a `ready-for-agent` focused PRD with the approved A/B/C mapping, 5 delivery waves, 35 user stories, one Mission Orchestrator seam, honest-data rules, dependencies, acceptance/test strategy, and scoped exclusions; required sections and `git diff --check` passed. |
| TASK-035 | Implement Codex Mission Control Ticket 01: one persistent no-release Mission tracer bullet | Codex | 2026-07-28 18:50:21 +07:00 | Separate production app completed through the public Mission Orchestrator seam; 16/16 domain tests, syntax, Vite build, full desktop/mobile no-release journey, reload replay, focus, overflow, console, two-writer serialization, and final two-axis re-review passed. |
| TASK-034 | Lock the hybrid UI decision and publish Codex Mission Control tracer-bullet tickets with blocking edges | Codex | 2026-07-28 14:48:25 +07:00 | Hybrid direction recorded in the PRD and prototype notes; root `tickets.md` contains seven `ready-for-agent` vertical slices, 55 acceptance criteria, and verified blocker targets; UTF-8 structure checks and `git diff --check` passed. |
| TASK-033 | Build and visually validate a three-variant Codex Mission Control clickable UI prototype | Codex | 2026-07-28 14:35:16 +07:00 | Variants A/B/C, Overview/Mission/Approval views, and happy/review/rejected scenarios implemented with fake in-memory data; desktop 1440×960 and mobile 390×844 inspected; lifecycle interactions, evidence, approval, rejection, accessible navigation, URL switcher, syntax, prototype build, root build, and browser console passed. |
| TASK-032 | Write and validate the Codex Mission Control product spec with a throwaway lifecycle prototype | Codex | 2026-07-28 14:17:30 +07:00 | PRD published as `ready-for-agent` with 45 user stories and all required sections; Mission Orchestrator chosen as the primary seam; prototype syntax checks and workspace build passed; executable walkthrough passed 9/9 lifecycle and gate-bypass scenarios. |
| TASK-031 | Propose Codex Team Control Center brief, context model, workflow, dashboard, and bounded self-improvement loop | Codex | 2026-07-28 14:04:06 +07:00 | Inspected both supplied references, workspace guidelines, current project-agent profiles, routing status, and application map; proposal intentionally separates role diversity from model diversity and includes permission/review/release gates. |
| TASK-015 | Restore Codex sub-agent schema and validate Desktop custom-agent routing | Codex + `luna_worker` probe | 2026-07-28 13:57:30 +07:00 | Fresh task exposed `spawn_agent.agent_type`; `/root/luna_routing_probe` spawned successfully with a limited context fork, confirmed runtime role `luna_worker` and matching profile instructions, enumerated all five project profiles, and made no file changes. |
| TASK-030 | Add Nihongo Dojo Lesson 18: say the quantity needed when shopping | Codex | 2026-07-28 03:48:22 +07:00 | Irodori Starter A1 Lesson 16 Can-do 68; 7 vocabulary, 3 dialogue lines, 5 quizzes; TDD lesson/HTML seams, lint, HTML, Next/Vercel, and Sites passed; review findings for `～つ` and `1個・2個・3個` fixed and re-reviewed; commit `e0c66c3`; no deployment. |
| TASK-029 | Deploy current Nihongo Dojo production build to Vercel | Codex | 2026-07-25 16:19:03 +07:00 | User approved deployment including the existing uncommitted `app/globals.css`; Vercel production build passed and alias returned HTTP 200. |
| TASK-028 | Add Nihongo Dojo Lesson 17: ask staff a product price | Codex | 2026-07-25 15:35:03 +07:00 | Irodori Starter A1 Lesson 16 Can-do 67; 7 vocabulary, 3 dialogue lines, 5 quizzes; lint, HTML, Next/Vercel, and Sites checks passed; review test gap fixed; commit `88613f4`; no deployment. |
| TASK-027 | Add Nihongo Dojo Lesson 16: understand a product price | Codex | 2026-07-25 15:22:01 +07:00 | Irodori Starter A1 Lesson 16 Can-do 66; 7 vocabulary, 3 dialogue lines, 5 quizzes including audio-first price recognition; lint, HTML, Next/Vercel, and Sites checks passed; review gap fixed; commit `cb205be`; no deployment. |
| TASK-026 | Add Nihongo Dojo Lesson 15: understand common shopping-center signs | Codex | 2026-07-25 15:08:16 +07:00 | Irodori Starter A1 Lesson 15 Can-do 65; 7 vocabulary, 3 dialogue lines, 5 quizzes; lint, HTML, Next/Vercel, and Sites checks passed; spec/standards review found no material issue; commit `4c9b925`; no deployment. |
| TASK-025 | Add Nihongo Dojo Lesson 14: exchange simple product comments while shopping | Codex | 2026-07-25 14:52:27 +07:00 | Irodori Starter A1 Lesson 15 Can-do 64; 7 vocabulary, 3 dialogue lines, 5 quizzes; lint, HTML, Next/Vercel, and Sites checks passed; spec/standards review found no material issue; commit `c4c9c62`; no deployment. |
| TASK-024 | Add Nihongo Dojo Lesson 13: ask staff which floor an item is on | Codex | 2026-07-25 14:39:14 +07:00 | Irodori Starter A1 Lesson 15 Can-do 63; 7 vocabulary, 3 dialogue lines, 5 quizzes; lint, HTML, Next/Vercel, and Sites checks passed; spec/standards review found no material issue; commit `96efb3e`; no deployment. |
| TASK-023 | Add Nihongo Dojo Lesson 12 floor-guide exercise | Codex | 2026-07-24 02:09:20 +07:00 | Irodori Can-do 62; visible floor guide, 7 vocabulary, 3 dialogue lines, 5 quizzes; lint, HTML, Next/Vercel, and Sites validation passed; review findings fixed; commit `6e5d60d`; no deployment. |
| TASK-022 | Add a collapsible Nihongo Dojo lesson study helper | Codex | 2026-07-24 00:35:12 +07:00 | Current-lesson vocabulary plus kana reference; HTML, lint, Next/Vercel, and Sites validations passed; independent review finding fixed; commit `edf72e3`; no deployment. |
| TASK-020 | Add Nihongo Dojo Lesson 10 sign-reading exercise | Codex | 2026-07-23 05:45:00 +07:00 | Irodori Can-do 60 scope; 7 vocabulary, 3 dialogue lines, 5 quizzes; lint, HTML, Next/Vercel, Sites, and lesson tests passed; commit `68c5257`; no deployment. |
| TASK-021 | Add Nihongo Dojo Lesson 11: ask where to buy an item | Codex | 2026-07-23 23:51:37 +07:00 | Irodori Can-do 61; 7 vocabulary, 3 dialogue lines, 5 quizzes; lint, HTML, Next/Vercel, Sites, and lesson tests passed; commit `363ccdb`; no deployment. |

| ID | งาน | ผู้รับผิดชอบ | อัปเดตล่าสุด | Validation |
| --- | --- | --- | --- | --- |
| TASK-019 | เพิ่มบทเรียนที่ 9 “บอกความรู้สึกเกี่ยวกับสถานที่” พร้อมอัปเดต self-contained HTML | Codex + curriculum/content research + Standards/Spec review | 2026-07-21 06:21:56 +07:00 | Irodori L14 Can-do 59; TDD lesson/HTML red→green; `lint`, `test:html`, Next/Vercel และ Sites ผ่าน; lesson tests 9/9; review gap ของ HTML markers ปิดและ re-review ไม่มี finding; commit `c4afa7e`; ไม่ได้ deploy |
| TASK-018 | เพิ่มบทเรียนที่ 8 “บอกว่าตอนนี้อยู่ที่ไหน” พร้อมอัปเดต self-contained HTML | Codex + content research + Standards/Spec review | 2026-07-21 04:58:10 +07:00 | TDD lesson/HTML red→green; `lint`, `test:html`, Next/Vercel และ Sites ผ่าน; lesson tests 8/8; review/re-review ไม่มี finding; commit `558e04a`; Browser เปิด `file://` ไม่ได้ตาม policy แต่ VM และ rendered-server tests ผ่าน |
| TASK-014 | เปิด subagent routing metadata ใน MultiAgent V2 และทดสอบ fresh CLI session | Codex | 2026-07-16 22:56:16 +07:00 | ผู้ใช้สั่งปิด multi-agent แทนการ probe ต่อ; `codex features disable multi_agent` สำเร็จ และ `codex features list` ยืนยัน `multi_agent stable false` |
| TASK-017 | Deploy Nihongo Dojo commit `130e212` ขึ้น Vercel production และตรวจบทที่ 6–7 | Codex | 2026-07-17 01:52:36 +07:00 | Vercel build ผ่านและ alias https://nihongo-dojo-pied.vercel.app ตอบ HTTP 200; bundles มีบทที่ 6–7 และ key phrases ครบ; ไม่รวม CSS patch เดิม |
| TASK-013 | วินิจฉัย Codex Desktop ปิดเองระหว่างทำงาน | Codex | 2026-07-16 22:11:29 +07:00 | ยืนยันใน task ใหม่แล้ว: IAB route พร้อมใช้งาน เปิด `https://example.com/` ได้ title `Example Domain`, แสดง Browser สำเร็จ และแอปไม่ crash |
| TASK-016 | เพิ่มบทเรียนที่ 7 เรื่องถามหาสถานที่ พร้อมอัปเดต HTML/Vercel/Sites | Codex + Standards/Spec review | 2026-07-17 01:29:29 +07:00 | TDD red→green; lesson tests 7/7, `lint`, HTML, Next/Vercel และ Sites ผ่าน; review findings แก้และตรวจซ้ำแล้ว; commit `130e212`; private Sites deploy สำเร็จที่ https://nihongo-dojo-th.kobeat-m1.chatgpt.site |
| TASK-010 | เพิ่มบทเรียนที่ 6 เรื่องสั่งอาหารและเครื่องดื่ม พร้อมอัปเดต HTML/Vercel/Sites | Codex | 2026-07-17 01:29:29 +07:00 | รวมใน commit `130e212`; lesson tests 7/7, `lint`, HTML, Next/Vercel และ Sites ผ่านทั้งหมด; ไม่รวม CSS patch เดิมตามขอบเขตงาน |
| TASK-012 | เชื่อมและทดลอง deploy Nihongo Dojo ขึ้น Vercel | Codex | 2026-07-16 22:00:36 +07:00 | Vercel build `READY`, production alias ตอบ HTTP 200 ที่ `https://nihongo-dojo-pied.vercel.app`; UI browser check หยุดเพราะ Codex Desktop crash |
| TASK-011 | รีวิว branch เทียบ `origin/main` ด้าน security, test gaps และ maintainability | Codex + parallel reviewers | 2026-07-16 06:49:49 +07:00 | พบ security/test gaps ระดับ High และ maintainability ระดับ Major: `reviewer` profile ไม่ถูกเลือกจริงและ read-only ไม่ enforce; 3 reviewers ตรวจครบ |
| TASK-003 | ยืนยันว่า client สามารถเลือกและเรียก project agents ใน `.codex/agents/` ได้จริง | Codex | 2026-07-16 06:44:23 +07:00 | ยืนยันผลเชิงลบด้วย `reviewer` probe: ไฟล์ตั้ง `gpt-5.4`/`high`/read-only แต่ child rollout จริงเป็น `gpt-5.6-sol`/`xhigh`/danger-full-access; spawn surface ไม่มี `agent_type` |
| TASK-009 | เพิ่มบทเรียนที่ 5 เรื่องซื้อของและถามราคา พร้อมอัปเดต HTML/Vercel/Sites | Codex + lesson5_content + lesson5_qa + standards/spec review | 2026-07-15 17:58:00 +07:00 | lesson tests 4/4 และ `lint`, HTML, Next/Vercel, Sites ผ่านทั้งหมด; review findings แก้แล้ว |
| TASK-008 | เพิ่มบทเรียนที่ 4 เรื่องอาชีพ พร้อมอัปเดต HTML/Vercel/Sites | Codex + lesson4_content + lesson4_qa + standards/spec review | 2026-07-15 17:58:00 +07:00 | lesson tests 4/4 และ `lint`, HTML, Next/Vercel, Sites ผ่านทั้งหมด; review findings แก้แล้ว |
| TASK-007 | เพิ่มบทเรียนที่ 3 ต่อจากบทแนะนำตัว พร้อมอัปเดต HTML/Vercel/Sites | Codex + lesson3_content + lesson3_qa + standards/spec review | 2026-07-15 15:18:00 +07:00 | `npm run lint`, `npm run test:html`, `npm test`, `npm run test:sites` ผ่านทั้งหมด; review findings ได้รับการแก้แล้ว |
| TASK-006 | เพิ่มเวอร์ชัน HTML ของ Nihongo Dojo ที่เปิดด้วยการดับเบิลคลิกได้ | Codex + html_bundle_review | 2026-07-14 23:49:34 +07:00 | `npm run test:html` ผ่าน 4 tests; lint, Vercel และ Sites regressions ผ่านทั้งหมด |
| TASK-005 | ปรับ Nihongo Dojo ให้ build และ deploy บน Vercel ได้ โดยยังรักษาเส้นทาง Sites เดิม | Codex | 2026-07-14 21:55:27 +07:00 | `npm run lint`, `npm test` และ `npm run test:sites` ผ่านทั้งหมด |
| TASK-004 | สร้าง `task-board.md` และ `work log.md` พร้อมกติกาอัปเดต | Codex | 2026-07-14 04:00:13 +07:00 | มีสถานะครบ 3 แบบ, work log มี timestamp และ `AGENTS.md` มีกติกาใช้งาน |
| TASK-002 | สร้าง `hotcache.md` และกำหนดให้อ่าน/อัปเดตผ่าน `AGENTS.md` | Codex | 2026-07-14 04:00:13 +07:00 | ตรวจไฟล์แล้ว; 96 คำ น้อยกว่าเพดาน 500 คำ |
| TASK-001 | ตรวจสอบชุด Codex project agents | Codex | 2026-07-14 04:00:13 +07:00 | พบไฟล์ครบ 5 ตัวและค่าตรงกับ `AGENTS.md` |
