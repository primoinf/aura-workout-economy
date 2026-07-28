# Codex Mission Control UI prototype

> THROWAWAY UI PROTOTYPE — fake data, in-memory interactions, no live agents.

## Question

Which information hierarchy makes Mission state, agent work, quality gates and
human approval easiest to understand before production implementation?

Three structurally different variants share one route and URL-stable query state:

- `?variant=A` — Command Deck: dense operational dashboard and left navigation.
- `?variant=B` — Mission Flow: lifecycle-first spatial view and agent hand-offs.
- `?variant=C` — Review Ledger: editorial decision record and evidence hierarchy.

Each variant includes Overview, Mission Detail and Approval Room views. Scenario
tabs exercise Happy path, Review loop and Release rejected.

## Run

```powershell
npm.cmd run prototype:mission-ui
```

Then open:

```text
http://127.0.0.1:4174/?variant=A
```

Use the floating bottom switcher or left/right arrow keys to change variants.

## Build check

```powershell
npm.cmd run prototype:mission-ui:build
```

When a direction wins, capture the chosen hierarchy in `NOTES.md`, delete the
losing variants and rewrite the winner as production code with tests.
