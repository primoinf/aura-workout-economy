#!/usr/bin/env node
// THROWAWAY PROTOTYPE — interactive shell and scripted scenario walkthrough.

import readline from "node:readline";
import {
  createMission,
  runCommands,
  transition,
} from "./mission-machine.prototype.js";

const shortcuts = {
  c: { type: "PREPARE_CONTEXT" },
  i: { type: "REVISE_CONTEXT" },
  p: { type: "PLAN" },
  s: { type: "START_RUN" },
  e: { type: "SUBMIT_ARTIFACTS" },
  r: { type: "REVIEW_PASS" },
  x: { type: "REVIEW_FAIL", reason: "Reviewer found a material defect" },
  v: { type: "VALIDATION_PASS" },
  f: { type: "VALIDATION_FAIL", reason: "Acceptance scenario failed" },
  a: { type: "HUMAN_APPROVE" },
  j: { type: "HUMAN_REJECT", reason: "Risk is not acceptable yet" },
  l: { type: "RELEASE" },
  t: { type: "BEGIN_LEARNING" },
  o: { type: "PROPOSE_PLAYBOOK" },
  u: {
    type: "EVALUATE_PLAYBOOK",
    baselineScore: 80,
    candidateScore: 88,
    criticalRegression: false,
  },
  g: { type: "REQUEST_PLAYBOOK_APPROVAL" },
  m: { type: "APPROVE_PLAYBOOK" },
  n: { type: "REJECT_PLAYBOOK" },
  d: { type: "COMPLETE" },
  b: { type: "BLOCK", reason: "Waiting for external authority" },
  z: { type: "RESUME" },
  k: { type: "CANCEL" },
};

const labels = [
  "[c] context",
  "[i] revise context",
  "[p] plan",
  "[s] start",
  "[e] evidence",
  "[r/x] review pass/fail",
  "[v/f] validation pass/fail",
  "[a/j] approve/reject",
  "[l] release",
  "[t] learn",
  "[o/u/g/m/n] playbook",
  "[d] complete",
  "[b/z] block/resume",
  "[k] cancel",
  "[q] quit",
].join("  ");

function render(state, error = null) {
  console.clear();
  console.log("\x1b[1mCodex Mission lifecycle prototype\x1b[0m");
  console.log("\x1b[2mTHROWAWAY — full state is shown after every action\x1b[0m\n");
  console.log(JSON.stringify(state, null, 2));
  if (error) {
    console.log(`\n\x1b[1mRejected:\x1b[0m ${error}`);
  }
  console.log(`\n${labels}`);
}

function walkthrough(name, initialState, commands, expectedStatus, expectedPlaybook) {
  try {
    const state = runCommands(initialState, commands);
    const passed =
      state.status === expectedStatus &&
      (expectedPlaybook === undefined ||
        state.playbook.status === expectedPlaybook);
    return {
      name,
      passed,
      detail: `status=${state.status}, playbook=${state.playbook.status}`,
    };
  } catch (error) {
    return { name, passed: false, detail: error.message };
  }
}

function rejectedWalkthrough(name, initialState, commands, expectedMessage) {
  try {
    runCommands(initialState, commands);
    return { name, passed: false, detail: "unsafe sequence was accepted" };
  } catch (error) {
    return {
      name,
      passed: error.message.includes(expectedMessage),
      detail: error.message,
    };
  }
}

function runDemo() {
  const happyPath = [
    { type: "PREPARE_CONTEXT" },
    { type: "PLAN" },
    { type: "START_RUN" },
    { type: "SUBMIT_ARTIFACTS" },
    { type: "REVIEW_PASS" },
    { type: "VALIDATION_PASS" },
    { type: "HUMAN_APPROVE" },
    { type: "RELEASE" },
    { type: "BEGIN_LEARNING" },
    { type: "PROPOSE_PLAYBOOK" },
    {
      type: "EVALUATE_PLAYBOOK",
      baselineScore: 80,
      candidateScore: 88,
      criticalRegression: false,
    },
    { type: "REQUEST_PLAYBOOK_APPROVAL" },
    { type: "APPROVE_PLAYBOOK" },
    { type: "COMPLETE" },
  ];

  const correctionLoop = [
    { type: "PREPARE_CONTEXT" },
    { type: "PLAN" },
    { type: "START_RUN" },
    { type: "SUBMIT_ARTIFACTS" },
    { type: "REVIEW_FAIL", reason: "Missing regression coverage" },
    { type: "START_RUN" },
    { type: "SUBMIT_ARTIFACTS" },
    { type: "REVIEW_PASS" },
    { type: "VALIDATION_FAIL", reason: "Build failed" },
    { type: "START_RUN" },
    { type: "SUBMIT_ARTIFACTS" },
    { type: "REVIEW_PASS" },
    { type: "VALIDATION_PASS" },
    { type: "HUMAN_REJECT", reason: "Release window closed" },
  ];

  const blockResume = [
    { type: "PREPARE_CONTEXT" },
    { type: "PLAN" },
    { type: "START_RUN" },
    { type: "BLOCK", reason: "Approval needed for dependency download" },
    { type: "RESUME" },
  ];

  const results = [
    walkthrough(
      "happy path reaches completion with a promoted playbook",
      createMission(),
      happyPath,
      "COMPLETED",
      "PROMOTED",
    ),
    walkthrough(
      "review, validation and human rejection return to correction",
      createMission(),
      correctionLoop,
      "CHANGES_REQUESTED",
    ),
    walkthrough(
      "blocked work resumes to its prior safe state",
      createMission(),
      blockResume,
      "RUNNING",
    ),
    walkthrough(
      "an approved no-release Mission enters learning and completes",
      createMission({ releaseRequired: false }),
      [...happyPath.slice(0, 7), { type: "COMPLETE" }],
      "COMPLETED",
      "NONE",
    ),
    rejectedWalkthrough(
      "release cannot bypass review and validation",
      createMission(),
      [{ type: "RELEASE" }],
      "illegal from DRAFT",
    ),
    rejectedWalkthrough(
      "required release cannot proceed without Brief authority",
      createMission({ releaseRequired: true, releaseAuthorized: false }),
      happyPath.slice(0, 7),
      "does not authorize",
    ),
    rejectedWalkthrough(
      "critical regression blocks playbook promotion",
      createMission(),
      [
        ...happyPath.slice(0, 9),
        { type: "PROPOSE_PLAYBOOK" },
        {
          type: "EVALUATE_PLAYBOOK",
          baselineScore: 80,
          candidateScore: 90,
          criticalRegression: true,
        },
        { type: "REQUEST_PLAYBOOK_APPROVAL" },
      ],
      "critical regression",
    ),
    rejectedWalkthrough(
      "candidate must outperform the baseline",
      createMission(),
      [
        ...happyPath.slice(0, 9),
        { type: "PROPOSE_PLAYBOOK" },
        {
          type: "EVALUATE_PLAYBOOK",
          baselineScore: 80,
          candidateScore: 79,
          criticalRegression: false,
        },
        { type: "REQUEST_PLAYBOOK_APPROVAL" },
      ],
      "outperform",
    ),
    rejectedWalkthrough(
      "context revision invalidates stale approval",
      createMission(),
      [
        ...happyPath.slice(0, 6),
        { type: "REVISE_CONTEXT" },
        { type: "HUMAN_APPROVE" },
      ],
      "illegal from CONTEXT_READY",
    ),
  ];

  console.log("Codex Mission Control — scenario walkthrough\n");
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name}`);
    console.log(`      ${result.detail}`);
  }

  const failures = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failures.length}/${results.length} scenarios passed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

if (process.argv.includes("--demo")) {
  runDemo();
} else {
  let state = createMission();
  let lastError = null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () => {
    render(state, lastError);
    rl.question("> ", (answer) => {
      const key = answer.trim().toLowerCase();
      if (key === "q") {
        rl.close();
        return;
      }
      try {
        const command = shortcuts[key];
        if (!command) throw new Error(`unknown shortcut: ${key}`);
        state = transition(state, command);
        lastError = null;
      } catch (error) {
        lastError = error.message;
      }
      ask();
    });
  };

  ask();
}
