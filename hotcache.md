# Hot Cache

Updated: 2026-07-28 18:50:21 +07:00 (Asia/Bangkok)

## Codex Mission Control production

- Ticket 01 is done in `codex-mission-control/`: a separate Vite app with Command Deck Overview, Mission Flow Detail, complete Brief form, local event persistence, replay, and an accepted no-release completion.
- `src/mission-orchestrator.js` is the single behavioral seam. It validates Briefs, payloads, audit metadata, Evidence, event envelopes, sequence, Mission identity, Context version, legal replay order, and expected sequence.
- Browser writes are serialized across tabs with Web Locks; release-required Briefs remain closed until Ticket 03.
- Validation passed: 16/16 black-box tests, syntax, production build, desktop 1440×960, mobile 390×844, full nine-stage journey, reload replay, focus management, local lifecycle scrolling, zero global overflow, and zero console warnings/errors.
- Standards and Spec reviewers re-reviewed all fixes and reported no material finding. The only recorded gap is that cross-tab locking uses a faithful lock mock in automation rather than a real two-tab browser test.
- Run locally from `codex-mission-control/` with `npm.cmd run dev`.

## Agent routing

- Project routing is verified for `luna_worker`, `terra_builder`, `terra_debugger`, `sol_architect`, and read-only `sol_reviewer`.
- Roles inherit the parent task model/reasoning; role diversity must not be presented as model diversity.

## Workspace cautions

- Nihongo Dojo remains separate and untouched by Mission Control work.
- Preserve the pre-existing uncommitted `nihongo-dojo/app/globals.css` change.
- Do not deploy without an explicit request.

## Next step

- Tickets 02 and 04 are now unblocked and can be implemented independently in fresh `/implement` contexts. Ticket 02 adds correction/control loops; Ticket 04 adds one bounded real Codex-agent assignment.
