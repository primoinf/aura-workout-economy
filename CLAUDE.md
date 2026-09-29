## Agent skills

### Issue tracker

Local markdown files in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Standard triage label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (one `CONTEXT.md` + `docs/adr/` at the root). See `docs/agents/domain.md`.

## Execution routing

Before coding, classify the request with the sizing rule in `.claude/skills/pipeline/SKILL.md` and state the classification:

- **Pipeline:** more than 3 files or more than one module, a behavior change that needs tests, security, auth, data, migration, or public-interface changes, or the user asks for it. Run the `pipeline` skill.
- **Otherwise:** delegate to the `sonnet-small` subagent and review its diff before reporting.

Design: `docs/superpowers/specs/2026-09-29-cross-vendor-pipeline-design.md`.
