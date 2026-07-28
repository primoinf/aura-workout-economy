# Mission lifecycle prototype

> THROWAWAY PROTOTYPE — this is not production application code.

## Question

Can the proposed Mission lifecycle represent correction loops, blocking/resume,
human-controlled release and bounded playbook promotion without allowing review,
validation, approval or baseline-comparison gates to be bypassed?

The pure state machine is isolated from the terminal shell. All state is in memory,
and the shell renders the complete state after every accepted or rejected action.

## Run

Interactive:

```powershell
npm.cmd run prototype:mission
```

Scripted scenario walkthrough:

```powershell
npm.cmd run prototype:mission:demo
```

Delete the terminal shell after the question is answered. Absorb only the validated
lifecycle decisions into the product spec and subsequent production tests.
