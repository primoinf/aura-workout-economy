# UI prototype verdict

Decision approved by the user on 2026-07-28:

- Use Variant A's Command Deck hierarchy for Overview.
- Use Variant B's Mission Flow hierarchy for Mission Detail.
- Use Variant C's Review Ledger hierarchy for Approval Room.

This is a hybrid information architecture, not approval to promote prototype code
directly. Production implementation must absorb the decisions, remove the losing
throwaway renderings, and add production tests.

## Validated

- Variants A, B and C are structurally different and URL-stable.
- Overview, Mission Detail and Approval Room render at desktop and mobile sizes.
- Happy path advances from Mission validation into Approval Room.
- Evidence opens as a read-only drawer and closes without losing Mission state.
- Human approval records a ready-to-release state while deployment remains off.
- Human rejection moves to the Release rejected scenario and
  `CHANGES_REQUESTED` presentation.
- Review findings can be returned to Terra Builder.
- Variant switching works by button and shareable URL; keyboard arrows are wired.
- Mobile navigation retains accessible names and Variant B keeps its scenario
  controls visible.
- No global horizontal overflow was observed at 1440×960 or 390×844. Variant B's
  lifecycle lane scrolls locally on mobile by design.

## Preliminary synthesis

- Variant A is strongest for the operational Overview.
- Variant B is strongest for Mission lifecycle and hand-offs.
- Variant C is strongest for the human Approval Room and durable audit feeling.

A deliberate hybrid of those three strengths is the selected production
direction. No prototype implementation has been promoted.

Questions to answer:

1. Which variant makes current Mission state obvious fastest?
2. Which representation of agents and task ownership is easiest to scan?
3. Does the Approval Room show enough evidence without becoming overwhelming?
4. Which parts should be combined into the production design?

Do not promote this prototype directly. Capture the winning hierarchy, delete the
throwaway variants and implement the decision with production tests.
