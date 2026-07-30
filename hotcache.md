# Hot Cache

Updated: 2026-07-28 19:44:45 +07:00 (Asia/Bangkok)

## Codex Mission Control UI direction

- A focused `ready-for-agent` UI Convergence PRD now lives at `.scratch/codex-mission-control-ui-convergence/PRD.md`.
- Approved mapping remains A = Command Deck Overview, B = Mission Flow Detail, C = Review Ledger Approval Room.
- The prototype remains a visual contract only. Production must not inherit its scenario switcher, fake progress, fake metrics, fake agent activity, or fake approval.
- UI-01 is complete: production now uses the A Command Deck and B Mission Flow hierarchy on real replayed state. Configured roles say telemetry is unavailable; Ticket 04 must supply Assignment/Run observations before live status appears.
- Mission Orchestrator remains the single behavioral seam; UI must not introduce a second Mission store.
- `mission-history-guard.js` fails closed on malformed history and blocks Mission creation before append; presenter and guard contracts are covered by black-box tests.

## Codex Mission Control production

- Ticket 01 is done in `codex-mission-control/`: a separate Vite app with Command Deck Overview, Mission Flow Detail, complete Brief form, local event persistence, replay, and an accepted no-release completion.
- `src/mission-orchestrator.js` is the single behavioral seam. It validates Briefs, payloads, audit metadata, Evidence, event envelopes, sequence, Mission identity, Context version, legal replay order, and expected sequence.
- Browser writes are serialized across tabs with Web Locks; release-required Briefs remain closed until Ticket 03.
- Validation passed: 19/19 black-box tests, syntax, production build, desktop 1440×960, mobile 390×844 and 320px, full nine-stage journey, reload replay, focus management, local lifecycle scrolling, zero global overflow, and zero console warnings/errors.
- Standards and Spec reviewers re-reviewed all UI-01 fixes and reported no material finding. Recorded gaps: UI journey coverage is browser/manual rather than a committed UI suite; corrupted history uses an in-memory execution test rather than real browser localStorage; cross-tab locking still uses a faithful lock mock.
- UI-01 files remain unstaged/uncommitted: the Git escalation was rejected before execution because Codex usage reached its limit. Do not lose or overwrite this working-tree scope; stage and commit it after usage resets.
- Run locally from `codex-mission-control/` with `npm.cmd run dev`.

## Agent routing

- Project routing is verified for `luna_worker`, `terra_builder`, `terra_debugger`, `sol_architect`, and read-only `sol_reviewer`.
- Roles inherit the parent task model/reasoning; role diversity must not be presented as model diversity.

## Workspace cautions

- Nihongo Dojo remains separate and untouched by Mission Control work.
- Preserve the pre-existing uncommitted `nihongo-dojo/app/globals.css` change.
- Do not deploy without an explicit request.

## Next step

- First commit the validated UI-01 working tree after usage resets. Then implement Ticket 02 correction/control loops; Ticket 04 real bounded agent assignment can proceed independently.
