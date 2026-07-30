# Hot Cache

Updated: 2026-07-30 16:07:17 +07:00 (Asia/Bangkok)

## Ticket 04 — bounded agent assignment

- Ticket 04 is complete in `codex-mission-control/`. The Mission Orchestrator routes explicit, validated Assignments through an agent adapter without depending on Codex Desktop transport details.
- Routing selects the smallest capable configured role from declared capability and risk. The Assignment bounds goal, acceptance criteria, Context slice, ownership, effective permission, budget, and expected Evidence.
- Run replay now records routed, started, progress, completed, blocked, and error outcomes. Completion requires structured Artifacts and Evidence; blocked output preserves the blocker, attempted alternatives, and required authority.
- Permission cannot exceed Brief mutation authority, ownership must remain beneath authorized roots, duplicate dispatch fails before append, malformed replay fails closed, and the first terminal observation stops the stream.
- The UI separates role, effective permission, observable model metadata, runtime state, Assignment, elapsed time, and Evidence. A host may inject `globalThis.codexAgentTransport`; otherwise the app reports an honest disconnected state.
- Validation passed: 32/32 tests, syntax checks, Vite production build, desktop 1440×960 and mobile 390×844 browser QA with no global overflow or console errors, and a bounded read-only `luna_worker` smoke with no touched files. Final Spec review found no actionable issue.
- Implementation commits: `93449ed`, `37904ad`, and `a7f2e66`. Live evidence is recorded at `.scratch/codex-mission-control/ticket-04-live-smoke.md`.

## Mission Control state

- Ticket 01 and UI-01 are complete; UI-01 is committed as `6561da6`.
- Ticket 02 correction/control loops are the next independent product slice. Ticket 05 is now blocked only by Ticket 02.
- The browser host bridge remains optional and unavailable by default. The live smoke used the current Codex task runtime and is recorded separately rather than presented as browser telemetry.

## Workspace cautions

- Nihongo Dojo remains separate and untouched by Mission Control work.
- Preserve unrelated user changes and the existing `nihongo-dojo/app/globals.css` change.
- Do not deploy without an explicit request.
