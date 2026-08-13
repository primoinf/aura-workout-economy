import assert from "node:assert/strict";
import test from "node:test";

import { renderTaskExecutionContent } from "../src/execution-room-view.js";

test("Task execution view renders capacity, graph ownership, Decision Room, and observable activity", () => {
  const markup = renderTaskExecutionContent({
    summary: {
      capacity: 4,
      reservedSlots: 1,
      workerCapacity: 3,
      availableWorkerSlots: 2,
      completedAssignments: 1,
      totalAssignments: 3,
    },
    frontier: ["build-waves"],
    activeAssignmentIds: ["inspect-events"],
    decisionRequiredAssignmentIds: [],
    observed: true,
    nodes: [
      {
        id: "inspect-events",
        goal: "Inspect <script>alert(1)</script> events",
        dependsOn: [],
        requiresDecision: false,
        status: "WORKING",
        attempt: 1,
        currentWaveId: "wave-1",
        roleId: "luna_worker",
        roleName: "Luna Worker",
        effectivePermission: "read-only",
        runStatus: "WORKING",
        artifactCount: 0,
        evidenceRefs: [],
        latestEvidence: null,
      },
      {
        id: "build-waves",
        goal: "Build safe waves",
        dependsOn: ["inspect-events"],
        requiresDecision: false,
        status: "PENDING",
        attempt: 0,
        currentWaveId: null,
        roleId: null,
        roleName: null,
        effectivePermission: null,
        runStatus: null,
        artifactCount: 0,
        evidenceRefs: [],
        latestEvidence: null,
      },
    ],
    waves: [
      {
        id: "wave-1",
        capacity: 4,
        reservedSlots: 1,
        workerCapacity: 3,
        assignmentIds: ["inspect-events"],
        serializedAssignmentIds: ["inspect-overlap"],
        deferredAssignmentIds: ["build-waves"],
        status: "WORKING",
      },
    ],
    decisionRooms: [
      {
        id: "decision-room:seam",
        assignmentId: "build-waves",
        assignmentAttempt: 1,
        question: "Where should execution invariants live?",
        participantRoles: ["orchestrator", "sol_architect"],
        participantInputs: [
          {
            roleId: "orchestrator",
            contribution: "Keep execution auditable",
            evidenceRefs: ["evidence://seam-options"],
          },
          {
            roleId: "sol_architect",
            contribution: "Prefer a narrow replay seam",
            evidenceRefs: ["evidence://seam-options"],
          },
        ],
        expectedOutput: "A reusable execution architecture decision",
        alternatives: [
          {
            id: "module",
            label: "Deep module",
            tradeoffs: ["Extra file", "One replay policy"],
          },
          {
            id: "inline",
            label: "Inline",
            tradeoffs: ["Fewer files", "Larger Orchestrator"],
          },
        ],
        recommendation: {
          alternativeId: "module",
          rationale: "Keep replay policy local",
        },
        validationPlan: ["Replay forged wave events"],
        inputEvidenceRefs: ["evidence://seam-options"],
        status: "RESOLVED",
        decision: {
          selectedAlternativeId: "module",
          rationale: "Replay safety wins",
          actor: "mission-owner",
        },
        decisionArtifact: {
          uri: "decision://seam",
          summary: "Use a deep module with replay contracts",
        },
      },
    ],
    activity: [
      {
        sequence: 7,
        type: "EXECUTION_RUN_STARTED",
        actor: "agent:luna_worker",
        occurredAt: "2026-08-08T09:00:00.000Z",
        reason: "Started inspect-events",
        assignmentId: "inspect-events",
        waveId: "wave-1",
        attempt: 1,
        evidenceRefs: [],
      },
    ],
  });

  assert.match(markup, /Task Graph/);
  assert.match(markup, /3 worker slots/);
  assert.match(markup, /1 Orchestrator slot reserved/);
  assert.match(markup, /build-waves/);
  assert.match(markup, /Depends on inspect-events/);
  assert.match(markup, /attempt 1/);
  assert.match(markup, /Serialized inspect-overlap/);
  assert.match(markup, /Where should execution invariants live\?/);
  assert.match(markup, /Trade-offs/);
  assert.match(markup, /Keep replay policy local/);
  assert.match(markup, /Replay forged wave events/);
  assert.match(markup, /evidence:\/\/seam-options/);
  assert.match(markup, /Activity Stream/);
  assert.match(markup, /agent:luna_worker/);
  assert.doesNotMatch(markup, /<script>alert\(1\)<\/script>/);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
