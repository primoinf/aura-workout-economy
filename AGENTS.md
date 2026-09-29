# Codex instructions for this repository

## Pipeline workers

When you run as an Orca-dispatched worker in this repository (your input contains an Orca preamble with Task and Dispatch IDs, or a `PIPELINE ROLE:` header):

- Follow the preamble and the task spec only. The spec names your role and its rules.
- Do not orchestrate, route work by task size, spawn or delegate to other agents, or consult external decision services, even if another AGENTS.md tells you to. Those routing rules do not apply to pipeline workers in this repository.
- Never commit, push, merge, stash, reset, or switch branches.
- Report completion only through the `worker_done` command from your preamble.

## Other sessions

For direct user sessions, see `CLAUDE.md` and `docs/agents/` for repository conventions.
