// THROWAWAY UI PROTOTYPE
// Three radically different Codex Mission Control layouts, switchable via
// ?variant=A|B|C. Data and mutations are in-memory stubs only.

const variants = [
  { key: "A", name: "Command Deck" },
  { key: "B", name: "Mission Flow" },
  { key: "C", name: "Review Ledger" },
];

const agents = [
  {
    initials: "OR",
    name: "Orchestrator",
    role: "Team Lead",
    status: "กำลังจัด wave 2",
    tone: "cyan",
    load: 72,
    task: "จัดลำดับ validation และ approval",
  },
  {
    initials: "LU",
    name: "Luna",
    role: "Operations",
    status: "ส่ง evidence แล้ว",
    tone: "violet",
    load: 32,
    task: "Repository map · 12 artifacts",
  },
  {
    initials: "TB",
    name: "Terra Builder",
    role: "Build Team",
    status: "ทำงาน",
    tone: "emerald",
    load: 86,
    task: "Session API · 7/8 tasks",
  },
  {
    initials: "TD",
    name: "Terra Debugger",
    role: "Incident Team",
    status: "พร้อมรับงาน",
    tone: "amber",
    load: 10,
    task: "Standby · ไม่มี blocker",
  },
  {
    initials: "SA",
    name: "Sol Architect",
    role: "Architecture Board",
    status: "ให้คำตัดสินแล้ว",
    tone: "blue",
    load: 44,
    task: "ADR-014 · Passkey boundary",
  },
  {
    initials: "SR",
    name: "Sol Reviewer",
    role: "Quality Board",
    status: "Read-only review",
    tone: "rose",
    load: 58,
    task: "ตรวจเส้นทาง session replay",
  },
];

const scenarios = {
  happy: {
    key: "happy",
    label: "Happy path",
    mission: "เพิ่มระบบสมาชิกด้วย Passkey",
    id: "MSN-2048",
    status: "VALIDATING",
    statusThai: "กำลังตรวจสอบ",
    progress: 72,
    risk: "Medium",
    branch: "codex/passkey-auth",
    elapsed: "18m 42s",
    budget: "38.2k / 64k tok",
    summary:
      "เพิ่มการสมัครและเข้าสู่ระบบด้วย Passkey โดยรักษา session เดิมและไม่ deploy จนกว่าจะได้รับอนุมัติ",
    nextAction: "รอ validation 2 รายการก่อนเปิด Approval Room",
    gates: [
      ["Brief", "pass", "ครบ 8/8 เงื่อนไข"],
      ["Context", "pass", "snapshot v3"],
      ["Build", "pass", "41 checks"],
      ["Review", "pass", "0 material findings"],
      ["Validation", "active", "6/8 scenarios"],
      ["Human approval", "pending", "ยังไม่เปิด"],
    ],
    tasks: [
      ["Repository scan", "Luna", "done"],
      ["Session boundary", "Sol Architect", "done"],
      ["Passkey API", "Terra Builder", "done"],
      ["Browser journey", "Terra Builder", "active"],
      ["Independent review", "Sol Reviewer", "done"],
      ["Release approval", "Human", "pending"],
    ],
    activity: [
      ["14:19", "Sol Reviewer", "Review ผ่าน · ไม่พบ material finding", "pass"],
      ["14:16", "Terra Builder", "ส่ง artifacts 12 รายการ", "info"],
      ["14:12", "Luna", "Build และ lint ผ่าน 41 checks", "pass"],
      ["14:08", "Sol Architect", "อนุมัติ session boundary", "info"],
    ],
    finding: null,
  },
  review: {
    key: "review",
    label: "Review loop",
    mission: "ย้าย Session Store แบบไม่เสียข้อมูล",
    id: "MSN-2047",
    status: "CHANGES_REQUESTED",
    statusThai: "ขอให้แก้ไข",
    progress: 48,
    risk: "High",
    branch: "codex/session-migration",
    elapsed: "31m 09s",
    budget: "51.7k / 72k tok",
    summary:
      "ย้าย session จาก local store ไป event-backed store พร้อม replay และ migration ที่ย้อนกลับได้",
    nextAction: "Terra Builder ต้องเพิ่ม idempotency guard และ regression case",
    gates: [
      ["Brief", "pass", "ครบ 11/11 เงื่อนไข"],
      ["Context", "pass", "snapshot v5"],
      ["Build", "pass", "53 checks"],
      ["Review", "fail", "1 material finding"],
      ["Validation", "blocked", "รอการแก้ไข"],
      ["Human approval", "pending", "ยังไม่เปิด"],
    ],
    tasks: [
      ["Migration inventory", "Luna", "done"],
      ["Event schema", "Sol Architect", "done"],
      ["Replay worker", "Terra Builder", "active"],
      ["Idempotency guard", "Terra Builder", "blocked"],
      ["Independent review", "Sol Reviewer", "changes"],
      ["Release approval", "Human", "pending"],
    ],
    activity: [
      ["14:18", "Sol Reviewer", "พบ duplicate replay เมื่อ retry หลัง timeout", "fail"],
      ["14:14", "Terra Builder", "ส่ง migration replay artifacts", "info"],
      ["14:09", "Luna", "ตรวจ fixture 18 ชุดผ่าน", "pass"],
      ["14:02", "Orchestrator", "เริ่ม execution wave 2", "info"],
    ],
    finding: {
      title: "Duplicate replay หลัง worker timeout",
      body: "Retry path เขียน event ซ้ำได้เพราะไม่มี idempotency key ที่ boundary ของ replay worker",
      owner: "Terra Builder",
      severity: "P1 · Material",
    },
  },
  rejected: {
    key: "rejected",
    label: "Release rejected",
    mission: "เตรียม Release Candidate v2.4",
    id: "MSN-2046",
    status: "CHANGES_REQUESTED",
    statusThai: "อนุมัติไม่ผ่าน",
    progress: 86,
    risk: "High",
    branch: "codex/release-2-4",
    elapsed: "47m 23s",
    budget: "60.1k / 80k tok",
    summary:
      "รวมฟีเจอร์ที่ผ่าน validation เป็น release candidate พร้อม diff, rollback plan และ production checklist",
    nextAction: "แก้ rollback plan และขอ approval ใหม่ใน release window ถัดไป",
    gates: [
      ["Brief", "pass", "ครบ 10/10 เงื่อนไข"],
      ["Context", "pass", "snapshot v7"],
      ["Build", "pass", "68 checks"],
      ["Review", "pass", "0 material findings"],
      ["Validation", "pass", "9/9 scenarios"],
      ["Human approval", "fail", "ถูกปฏิเสธ 14:17"],
    ],
    tasks: [
      ["Release inventory", "Luna", "done"],
      ["Security boundary", "Sol Architect", "done"],
      ["Release candidate", "Terra Builder", "done"],
      ["Independent review", "Sol Reviewer", "done"],
      ["Rollback drill", "Terra Debugger", "changes"],
      ["Release approval", "Human", "changes"],
    ],
    activity: [
      ["14:17", "Mission owner", "ปฏิเสธ release · rollback plan ไม่ชัด", "fail"],
      ["14:15", "Orchestrator", "เปิด Approval Room", "info"],
      ["14:11", "Sol Reviewer", "Review ผ่านแบบ read-only", "pass"],
      ["14:04", "Luna", "Validation ผ่าน 9/9 scenarios", "pass"],
    ],
    finding: {
      title: "Rollback plan ยังไม่มี recovery time",
      body: "หลักฐานครบสำหรับ release แต่ยังระบุ owner และ recovery time objective ไม่ชัดเจน",
      owner: "Orchestrator",
      severity: "Human decision",
    },
  },
};

const icons = {
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  target:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2M22 12h-2M12 22v-2M2 12h2"/>',
  bot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M9 12h.01M15 12h.01M9 16h6M12 3v4"/>',
  shield:
    '<path d="M12 3 4.5 6v5.5c0 4.4 3.1 7.5 7.5 9.5 4.4-2 7.5-5.1 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  activity:
    '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert:
    '<path d="M10.3 3.7 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="m9 18 6-6-6-6"/>',
  terminal: '<path d="m5 7 4 4-4 4M11 17h8"/>',
  layers:
    '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  spark:
    '<path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
};

function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

function queryState() {
  const params = new URLSearchParams(window.location.search);
  return {
    variant: variants.some((item) => item.key === params.get("variant"))
      ? params.get("variant")
      : "A",
    page: ["overview", "mission", "approval"].includes(params.get("page"))
      ? params.get("page")
      : "overview",
    scenario: scenarios[params.get("scenario")]
      ? params.get("scenario")
      : "happy",
  };
}

let ui = {
  ...queryState(),
  toast: null,
  evidenceOpen: false,
  overrides: {},
};

function currentMission() {
  const base = scenarios[ui.scenario];
  return { ...base, ...(ui.overrides[ui.scenario] ?? {}) };
}

function setQuery(updates) {
  ui = { ...ui, ...updates };
  const params = new URLSearchParams(window.location.search);
  params.set("variant", ui.variant);
  params.set("page", ui.page);
  params.set("scenario", ui.scenario);
  window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  render();
}

function scenarioControls() {
  return `<div class="scenario-tabs" aria-label="เลือกสถานการณ์จำลอง">
    ${Object.values(scenarios)
      .map(
        (item) =>
          `<button class="${ui.scenario === item.key ? "active" : ""}" data-scenario="${item.key}">${item.label}</button>`,
      )
      .join("")}
  </div>`;
}

function statusPill(mission) {
  const stateClass =
    mission.status === "VALIDATING"
      ? "status-active"
      : mission.status === "READY_TO_RELEASE"
        ? "status-pass"
        : "status-fail";
  return `<span class="status-pill ${stateClass}"><span></span>${mission.statusThai}</span>`;
}

function navButton(page, label, iconName) {
  return `<button class="nav-button ${ui.page === page ? "active" : ""}" data-page="${page}" aria-label="${label}">
    ${icon(iconName, 17)}<span>${label}</span>
  </button>`;
}

function gatesMarkup(mission, compact = false) {
  return `<div class="${compact ? "gate-list compact" : "gate-list"}">
    ${mission.gates
      .map(
        ([name, state, detail]) => `<div class="gate-row gate-${state}">
          <span class="gate-symbol">${state === "pass" ? icon("check", 14) : state === "fail" ? icon("x", 14) : state === "active" ? '<span class="pulse-dot"></span>' : "·"}</span>
          <div><strong>${name}</strong><small>${detail}</small></div>
          <span class="gate-state">${state}</span>
        </div>`,
      )
      .join("")}
  </div>`;
}

function activityMarkup(mission) {
  return `<div class="activity-list">
    ${mission.activity
      .map(
        ([time, actor, text, tone]) => `<div class="activity-item">
          <span class="activity-dot ${tone}"></span>
          <time>${time}</time>
          <div><strong>${actor}</strong><p>${text}</p></div>
        </div>`,
      )
      .join("")}
  </div>`;
}

function tasksMarkup(mission) {
  return `<div class="task-list">
    ${mission.tasks
      .map(
        ([task, owner, state], index) => `<button class="task-row" data-action="evidence">
          <span class="task-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="task-copy"><strong>${task}</strong><small>${owner}</small></span>
          <span class="task-state task-${state}">${state}</span>
        </button>`,
      )
      .join("")}
  </div>`;
}

function agentsCards() {
  return agents
    .map(
      (agent) => `<button class="agent-card" data-action="agent" title="ดูรายละเอียด ${agent.name}">
        <div class="agent-head">
          <span class="agent-avatar tone-${agent.tone}">${agent.initials}</span>
          <span><strong>${agent.name}</strong><small>${agent.role}</small></span>
          <span class="live-dot tone-${agent.tone}"></span>
        </div>
        <p>${agent.task}</p>
        <div class="agent-foot"><span>${agent.status}</span><span>${agent.load}%</span></div>
        <div class="load-track"><span style="width:${agent.load}%"></span></div>
      </button>`,
    )
    .join("");
}

function missionMetrics(mission) {
  return `<div class="metric-strip">
    <div><small>Progress</small><strong>${mission.progress}%</strong></div>
    <div><small>Elapsed</small><strong>${mission.elapsed}</strong></div>
    <div><small>Budget</small><strong>${mission.budget}</strong></div>
    <div><small>Risk</small><strong>${mission.risk}</strong></div>
  </div>`;
}

function findingMarkup(mission) {
  if (!mission.finding) {
    return `<div class="empty-finding">${icon("shield", 24)}<strong>ไม่พบ material finding</strong><span>Independent review ผ่านแล้ว</span></div>`;
  }
  return `<div class="finding-card">
    <div class="finding-title">${icon("alert", 18)}<span>${mission.finding.severity}</span></div>
    <h3>${mission.finding.title}</h3>
    <p>${mission.finding.body}</p>
    <div class="finding-owner"><span>Owner</span><strong>${mission.finding.owner}</strong></div>
    <button class="secondary-button" data-action="resolve">ส่งกลับไปแก้ไข</button>
  </div>`;
}

function actionsFor(mission) {
  if (ui.scenario === "happy" && mission.status === "VALIDATING") {
    return `<button class="primary-button" data-action="advance">${icon("check", 17)}จำลอง validation ผ่าน</button>`;
  }
  if (mission.status === "APPROVAL_REQUIRED") {
    return `<button class="danger-button" data-action="reject">${icon("x", 17)}ปฏิเสธ</button>
      <button class="primary-button" data-action="approve">${icon("check", 17)}อนุมัติ Release</button>`;
  }
  if (ui.scenario === "review") {
    return `<button class="primary-button" data-action="resolve">${icon("terminal", 17)}รับไปแก้ไข</button>`;
  }
  return `<button class="primary-button" data-action="reset">${icon("activity", 17)}เริ่มสถานการณ์ใหม่</button>`;
}

function variantA(mission) {
  const shellStart = `<div class="variant-a">
    <aside class="a-sidebar">
      <div class="brand-mark">${icon("activity", 22)}<span><strong>Mission</strong><small>Control</small></span></div>
      <nav aria-label="เมนูหลัก">
        ${navButton("overview", "ภาพรวม", "grid")}
        ${navButton("mission", "Mission", "target")}
        ${navButton("approval", "Approval", "shield")}
      </nav>
      <div class="sidebar-live"><span></span><div><strong>6 agents</strong><small>3 active · 0 blocked</small></div></div>
      <div class="sidebar-user"><span>NH</span><div><strong>Mission owner</strong><small>Full approval</small></div></div>
    </aside>
    <main class="a-main">
      <header class="a-topbar">
        <div><span class="eyebrow">CODEX TEAM / LIVE CONTROL</span><h1>${ui.page === "overview" ? "ภาพรวมทีม" : ui.page === "mission" ? "Mission Detail" : "Approval Room"}</h1></div>
        <div class="top-actions">${scenarioControls()}<button class="icon-button" data-action="reset" title="รีเซ็ตข้อมูลจำลอง" aria-label="รีเซ็ตข้อมูลจำลอง">${icon("activity")}</button></div>
      </header>`;

  if (ui.page === "overview") {
    return `${shellStart}
      <section class="a-kpis">
        <div><span class="kpi-icon cyan">${icon("bot")}</span><p>Agents ทำงาน<strong>3 / 6</strong><small>ความจุคงเหลือ 1 slot</small></p></div>
        <div><span class="kpi-icon green">${icon("check")}</span><p>Gate pass rate<strong>84%</strong><small>37 ผ่าน · 2 รอตรวจ</small></p></div>
        <div><span class="kpi-icon violet">${icon("target")}</span><p>Mission cycle<strong>26m</strong><small>เร็วขึ้น 18% จาก baseline</small></p></div>
        <div><span class="kpi-icon amber">${icon("clock")}</span><p>Approval queue<strong>01</strong><small>เก่าสุด 4 นาที</small></p></div>
      </section>
      <section class="section-block"><div class="section-heading"><div><span class="eyebrow">ACTIVE SQUAD</span><h2>ทีม Codex</h2></div><button class="text-button" data-page="mission">ดู Task Graph ${icon("arrow", 15)}</button></div><div class="agent-grid">${agentsCards()}</div></section>
      <section class="a-lower">
        <div class="mission-focus">
          <div class="section-heading"><div><span class="eyebrow">PRIMARY MISSION</span><h2>${mission.mission}</h2></div>${statusPill(mission)}</div>
          <p class="mission-summary">${mission.summary}</p>
          ${missionMetrics(mission)}
          <div class="progress-track"><span style="width:${mission.progress}%"></span></div>
          <div class="mission-next"><span>${icon("spark", 17)}</span><p><small>Next best action</small><strong>${mission.nextAction}</strong></p><button class="primary-button small" data-page="mission">เปิด Mission</button></div>
        </div>
        <div class="activity-panel"><div class="section-heading"><div><span class="eyebrow">EVENT STREAM</span><h2>กิจกรรมล่าสุด</h2></div><span class="live-label"><i></i>Live</span></div>${activityMarkup(mission)}</div>
      </section>`;
  }

  if (ui.page === "mission") {
    return `${shellStart}
      <section class="mission-title-row"><div><span class="mission-id">${mission.id}</span>${statusPill(mission)}<h2>${mission.mission}</h2><p>${mission.summary}</p></div><div class="mission-actions"><button class="secondary-button" data-action="evidence">${icon("file", 17)}Evidence</button>${actionsFor(mission)}</div></section>
      ${missionMetrics(mission)}
      <section class="a-mission-grid">
        <div class="panel"><div class="section-heading"><div><span class="eyebrow">EXECUTION PLAN</span><h2>Task Graph</h2></div><span class="branch-tag">${mission.branch}</span></div>${tasksMarkup(mission)}</div>
        <div class="panel"><div class="section-heading"><div><span class="eyebrow">QUALITY CONTROL</span><h2>Gates</h2></div></div>${gatesMarkup(mission)}${findingMarkup(mission)}</div>
        <div class="panel activity-wide"><div class="section-heading"><div><span class="eyebrow">AUDIT TRAIL</span><h2>Event stream</h2></div></div>${activityMarkup(mission)}</div>
      </section>`;
  }

  return `${shellStart}
    <section class="approval-hero">
      <div><span class="eyebrow">HUMAN GATE · EXTERNAL ACTION</span><div class="approval-title">${icon("shield", 34)}<h2>ตรวจ Release Candidate</h2></div><p>การอนุมัตินี้อนุญาตให้ Orchestrator เตรียม release เท่านั้น ยังไม่ deploy โดยอัตโนมัติ</p></div>
      <span class="risk-badge">${mission.risk} risk</span>
    </section>
    <section class="approval-grid">
      <div class="panel approval-diff"><div class="section-heading"><div><span class="eyebrow">CHANGESET</span><h2>${mission.mission}</h2></div><span class="branch-tag">${mission.branch}</span></div>
        <div class="diff-stats"><span class="plus">+428</span><span class="minus">−96</span><span>12 files</span><span>3 migrations</span></div>
        <div class="code-preview"><span>01</span><code>+ passkeyChallenge: createChallenge(user)</code><span>02</span><code>+ session.rotateAfterAuthentication()</code><span>03</span><code>+ rollback: restoreSessionSnapshot(v3)</code><span>04</span><code>  deploy: false // requires separate authority</code></div>
        <button class="secondary-button" data-action="evidence">${icon("file", 17)}เปิด Evidence ทั้งหมด</button>
      </div>
      <div class="panel"><div class="section-heading"><div><span class="eyebrow">REQUIRED GATES</span><h2>หลักฐานก่อนตัดสินใจ</h2></div></div>${gatesMarkup(mission, true)}<div class="approval-note"><strong>ความเสี่ยงคงเหลือ</strong><p>ต้องเฝ้าดู session replay 30 นาทีหลัง release และ rollback ภายใน 8 นาทีหาก error rate เกิน 1%.</p></div></div>
    </section>
    <footer class="approval-footer"><div><strong>คุณกำลังตัดสินใจในฐานะ Mission owner</strong><span>เหตุผลของการตัดสินใจจะถูกบันทึกใน audit trail</span></div><div>${actionsFor(mission)}</div></footer>`;
}

function variantB(mission) {
  const stageMap = [
    ["Brief", "done"],
    ["Context", "done"],
    ["Build", "done"],
    ["Review", mission.gates[3][1] === "fail" ? "fail" : "done"],
    ["Validate", mission.status === "VALIDATING" ? "active" : mission.gates[4][1]],
    ["Approve", mission.gates[5][1]],
  ];
  const header = `<div class="variant-b">
    <header class="b-header">
      <div class="b-brand">${icon("layers", 23)}<span>CODEX / MISSION FLOW</span></div>
      <nav>${navButton("overview", "Flow", "activity")}${navButton("mission", "Detail", "target")}${navButton("approval", "Gate", "shield")}</nav>
      ${scenarioControls()}
    </header>`;

  if (ui.page === "overview") {
    return `${header}
      <main class="b-main">
        <section class="b-hero">
          <div class="b-hero-copy"><span class="mission-id">${mission.id} · EXECUTION WAVE 2</span><h1>${mission.mission}</h1><p>${mission.summary}</p><div class="b-hero-meta">${statusPill(mission)}<span>${icon("clock", 15)}${mission.elapsed}</span><span>${icon("terminal", 15)}${mission.branch}</span></div></div>
          <div class="b-orbit"><div><strong>${mission.progress}</strong><span>%</span></div><small>mission<br/>confidence</small></div>
        </section>
        <section class="flow-map" aria-label="Mission lifecycle">
          ${stageMap
            .map(
              ([label, state], index) => `<button class="flow-node node-${state}" data-page="${label === "Approve" ? "approval" : "mission"}">
                <span>${state === "done" ? icon("check", 16) : index + 1}</span><strong>${label}</strong><small>${state}</small>
              </button>${index < stageMap.length - 1 ? '<span class="flow-line"></span>' : ""}`,
            )
            .join("")}
        </section>
        <section class="squad-lanes">
          <div class="lane-label"><span class="eyebrow">AGENT LANES</span><strong>การส่งต่องาน</strong></div>
          ${agents
            .slice(0, 5)
            .map(
              (agent, index) => `<button class="lane" data-action="agent">
                <span class="agent-avatar tone-${agent.tone}">${agent.initials}</span>
                <div><strong>${agent.name}</strong><small>${agent.task}</small></div>
                <div class="lane-run"><span style="width:${agent.load}%"></span></div>
                <em>${index < 3 ? "ส่งต่อแล้ว" : index === 3 ? "พร้อม" : "ตรวจอยู่"}</em>
              </button>`,
            )
            .join("")}
        </section>
        <section class="b-bottom">
          <div><div class="b-section-title"><span>${icon("activity")}</span><h2>Signals</h2></div>${activityMarkup(mission)}</div>
          <div><div class="b-section-title"><span>${icon("shield")}</span><h2>Gate health</h2></div>${gatesMarkup(mission, true)}</div>
          <div class="next-action-card"><span class="eyebrow">NEXT BEST ACTION</span><h2>${mission.nextAction}</h2><div>${actionsFor(mission)}</div></div>
        </section>
      </main>`;
  }

  if (ui.page === "mission") {
    return `${header}<main class="b-main">
      <section class="b-detail-head"><div><span class="mission-id">${mission.id}</span><h1>${mission.mission}</h1></div>${statusPill(mission)}</section>
      <section class="b-storyline">
        <aside><span class="eyebrow">MISSION BRIEF</span><p>${mission.summary}</p>${missionMetrics(mission)}<button class="secondary-button" data-action="evidence">${icon("file", 17)}Inspect context pack</button></aside>
        <div class="vertical-flow">
          ${mission.tasks
            .map(
              ([task, owner, state], index) => `<button class="vertical-step step-${state}" data-action="evidence">
                <span>${index + 1}</span><div><small>${owner}</small><strong>${task}</strong></div><em>${state}</em>
              </button>`,
            )
            .join("")}
        </div>
        <aside class="b-finding"><span class="eyebrow">REVIEW SIGNAL</span>${findingMarkup(mission)}<div class="b-actions">${actionsFor(mission)}</div></aside>
      </section>
    </main>`;
  }

  return `${header}<main class="b-main">
    <section class="b-gate-stage">
      <div class="gate-radar">${icon("shield", 52)}<span class="radar-ring one"></span><span class="radar-ring two"></span></div>
      <div><span class="eyebrow">DECISION GATE</span><h1>หลักฐานครบพอให้ปล่อยหรือยัง?</h1><p>${mission.mission} · ${mission.id}</p></div>
    </section>
    <section class="b-decision-path">
      <div class="evidence-stack"><span class="eyebrow">EVIDENCE STACK</span>${gatesMarkup(mission)}<button class="secondary-button" data-action="evidence">${icon("file", 17)}เปิด artifact 12 รายการ</button></div>
      <div class="decision-center">
        <div class="decision-fact"><small>Change surface</small><strong>12 files · 3 migrations</strong></div>
        <div class="decision-fact"><small>Rollback target</small><strong>8 นาที · owner: Terra Debugger</strong></div>
        <div class="decision-fact"><small>External authority</small><strong>Release only · deploy disabled</strong></div>
        <blockquote>“${mission.nextAction}”</blockquote>
        <div class="decision-buttons">${actionsFor(mission)}</div>
      </div>
      <div class="audit-preview"><span class="eyebrow">LATEST SIGNALS</span>${activityMarkup(mission)}</div>
    </section>
  </main>`;
}

function variantC(mission) {
  const masthead = `<div class="variant-c">
    <header class="c-masthead">
      <div class="c-wordmark"><span>CODEx</span><strong>Mission Ledger</strong></div>
      <div class="c-date">28 JUL 2026<br/><span>Bangkok · Live edition</span></div>
      <nav>${navButton("overview", "Briefing", "grid")}${navButton("mission", "Dossier", "file")}${navButton("approval", "Decision", "shield")}</nav>
    </header>
    <div class="c-scenario">${scenarioControls()}</div>`;

  if (ui.page === "overview") {
    return `${masthead}<main class="c-main">
      <section class="c-lead">
        <div class="c-kicker">MISSION OF THE HOUR · ${mission.id}</div>
        <h1>${mission.mission}</h1>
        <div class="c-deck"><p>${mission.summary}</p><div class="c-score"><strong>${mission.progress}</strong><span>%<br/>ready</span></div></div>
        <div class="c-byline"><span>Orchestrated by Codex Team</span>${statusPill(mission)}<span>${mission.elapsed}</span><span>${mission.risk} risk</span></div>
      </section>
      <section class="c-columns">
        <article class="c-story">
          <span class="c-section-label">Situation report</span>
          <h2>${mission.nextAction}</h2>
          <p>การทำงานถูกแบ่งเป็น wave เพื่อรักษาหนึ่ง slot สำหรับ Orchestrator ทุก agent ส่งหลักฐานกลับผ่าน Mission lifecycle เดียวกัน</p>
          ${activityMarkup(mission)}
        </article>
        <article class="c-story c-agents">
          <span class="c-section-label">Field team</span>
          ${agents
            .slice(0, 4)
            .map(
              (agent) => `<button data-action="agent"><span class="agent-avatar tone-${agent.tone}">${agent.initials}</span><p><strong>${agent.name}</strong><small>${agent.role}</small><em>${agent.status}</em></p></button>`,
            )
            .join("")}
        </article>
        <article class="c-story">
          <span class="c-section-label">Quality ledger</span>
          ${gatesMarkup(mission, true)}
          <button class="ink-button" data-page="approval">เปิด Decision desk ${icon("arrow", 15)}</button>
        </article>
      </section>
      <section class="c-ticker"><strong>LIVE</strong><span>3 agents active</span><i></i><span>84% gate pass rate</span><i></i><span>1 approval waiting</span><i></i><span>0 unsafe mutation</span></section>
    </main>`;
  }

  if (ui.page === "mission") {
    return `${masthead}<main class="c-main">
      <section class="c-dossier-head"><div><span class="c-section-label">Mission dossier · ${mission.id}</span><h1>${mission.mission}</h1><p>${mission.summary}</p></div><div>${statusPill(mission)}<strong>${mission.progress}%</strong><small>readiness</small></div></section>
      <section class="c-dossier-grid">
        <article><span class="c-section-label">Execution record</span>${tasksMarkup(mission)}</article>
        <article><span class="c-section-label">Material evidence</span>${gatesMarkup(mission)}<button class="ink-button" data-action="evidence">อ่าน Context Pack และ artifacts</button></article>
        <article><span class="c-section-label">Review memorandum</span>${findingMarkup(mission)}<div class="c-action-stack">${actionsFor(mission)}</div></article>
      </section>
    </main>`;
  }

  return `${masthead}<main class="c-main">
    <section class="c-decision-head"><span class="c-section-label">Human authority required</span><h1>Release Decision Memorandum</h1><p>${mission.id} · ${mission.mission}</p></section>
    <section class="c-memo">
      <aside><span class="c-section-label">Decision index</span><ol><li>Scope และ authority</li><li>Quality evidence</li><li>Residual risk</li><li>Rollback commitment</li></ol><div class="c-seal">${icon("shield", 30)}<strong>Human<br/>Gate</strong></div></aside>
      <article>
        <h2>คำขออนุมัติ</h2><p>Orchestrator ขอสิทธิ์เลื่อน changeset นี้เป็น release candidate การตัดสินใจนี้ไม่รวม production deployment และไม่เปลี่ยน permission เดิมของ agents</p>
        <h3>หลักฐานประกอบ</h3>${gatesMarkup(mission)}
        <h3>ข้อผูกพันหลัง release</h3><p>เฝ้าดู session replay 30 นาที, rollback ภายใน 8 นาที และบันทึก outcome เข้า Retrospective ก่อนปิด Mission</p>
        <div class="memo-sign"><div><small>Prepared by</small><strong>Codex Orchestrator</strong><span>Evidence snapshot v3</span></div><div><small>Decision by</small><strong>Mission owner</strong><span>Awaiting signature</span></div></div>
        <div class="memo-actions">${actionsFor(mission)}</div>
      </article>
      <aside><span class="c-section-label">Audit excerpt</span>${activityMarkup(mission)}<button class="ink-button" data-action="evidence">เปิดหลักฐานทั้งหมด</button></aside>
    </section>
  </main>`;
}

function prototypeSwitcher() {
  const index = variants.findIndex((item) => item.key === ui.variant);
  const current = variants[index];
  return `<div class="prototype-switcher" aria-label="สลับรูปแบบ prototype">
    <button data-variant="${variants[(index - 1 + variants.length) % variants.length].key}" aria-label="รูปแบบก่อนหน้า" title="รูปแบบก่อนหน้า">←</button>
    <div><small>THROWAWAY PROTOTYPE</small><strong>${current.key} — ${current.name}</strong></div>
    <button data-variant="${variants[(index + 1) % variants.length].key}" aria-label="รูปแบบถัดไป" title="รูปแบบถัดไป">→</button>
  </div>`;
}

function evidenceOverlay(mission) {
  if (!ui.evidenceOpen) return "";
  return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
    <div class="evidence-drawer">
      <header><div><span class="eyebrow">READ-ONLY ARTIFACTS</span><h2 id="evidence-title">Evidence snapshot v3</h2></div><button class="icon-button" data-action="close-evidence" aria-label="ปิดหลักฐาน">${icon("x")}</button></header>
      <div class="evidence-summary"><span>${icon("shield", 20)}</span><p><strong>12 artifacts · checksum verified</strong><small>ผูกกับ Context Pack v${ui.scenario === "happy" ? "3" : "5"} และ ${mission.id}</small></p></div>
      <div class="artifact-list">
        <button><span class="artifact-icon">${icon("terminal", 17)}</span><p><strong>production-build.log</strong><small>41 checks · exit 0</small></p><em>verified</em></button>
        <button><span class="artifact-icon">${icon("file", 17)}</span><p><strong>independent-review.md</strong><small>Sol Reviewer · read-only</small></p><em>signed</em></button>
        <button><span class="artifact-icon">${icon("activity", 17)}</span><p><strong>browser-journey.json</strong><small>6/8 scenarios complete</small></p><em>running</em></button>
        <button><span class="artifact-icon">${icon("layers", 17)}</span><p><strong>rollback-plan.md</strong><small>owner · RTO · trigger</small></p><em>current</em></button>
      </div>
      <footer><span>Prototype data only · ไม่มีไฟล์จริงถูกเปิด</span><button class="secondary-button" data-action="close-evidence">ปิด</button></footer>
    </div>
  </div>`;
}

function toastMarkup() {
  return ui.toast
    ? `<div class="toast" role="status">${icon("check", 17)}${ui.toast}</div>`
    : "";
}

function render() {
  const mission = currentMission();
  const markup =
    ui.variant === "A"
      ? variantA(mission)
      : ui.variant === "B"
        ? variantB(mission)
        : variantC(mission);
  document.querySelector("#app").innerHTML =
    markup +
    `</main></div>` +
    prototypeSwitcher() +
    evidenceOverlay(mission) +
    toastMarkup();
}

function showToast(message) {
  ui.toast = message;
  render();
  window.setTimeout(() => {
    ui.toast = null;
    render();
  }, 2200);
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.variant) {
    setQuery({ variant: target.dataset.variant });
    return;
  }
  if (target.dataset.page) {
    setQuery({ page: target.dataset.page });
    return;
  }
  if (target.dataset.scenario) {
    setQuery({ scenario: target.dataset.scenario, page: "overview" });
    return;
  }

  switch (target.dataset.action) {
    case "evidence":
      ui.evidenceOpen = true;
      render();
      break;
    case "close-evidence":
      ui.evidenceOpen = false;
      render();
      break;
    case "advance":
      ui.overrides.happy = {
        status: "APPROVAL_REQUIRED",
        statusThai: "รอการอนุมัติ",
        progress: 88,
        nextAction: "ตรวจ evidence และตัดสินใจใน Approval Room",
        gates: scenarios.happy.gates.map((gate, index) =>
          index === 4
            ? ["Validation", "pass", "8/8 scenarios"]
            : index === 5
              ? ["Human approval", "active", "พร้อมตัดสินใจ"]
              : gate,
        ),
      };
      setQuery({ page: "approval" });
      showToast("Validation ผ่าน 8/8 · เปิด Approval Room แล้ว");
      break;
    case "approve":
      ui.overrides[ui.scenario] = {
        ...(ui.overrides[ui.scenario] ?? {}),
        status: "READY_TO_RELEASE",
        statusThai: "พร้อมเป็น Release Candidate",
        progress: 96,
      };
      showToast("บันทึกการอนุมัติแล้ว · deploy ยังถูกปิด");
      break;
    case "reject":
      setQuery({ scenario: "rejected", page: "mission" });
      showToast("ปฏิเสธ release และส่งกลับเป็น Changes requested");
      break;
    case "resolve":
      ui.overrides.review = {
        status: "RUNNING",
        statusThai: "กำลังแก้ไข",
        progress: 54,
        nextAction: "Terra Builder กำลังเพิ่ม idempotency guard",
      };
      showToast("ส่ง finding กลับให้ Terra Builder แล้ว");
      break;
    case "agent":
      showToast("Agent detail เป็น read-only ใน prototype");
      break;
    case "reset":
      ui.overrides = {};
      showToast("รีเซ็ตข้อมูลจำลองแล้ว");
      break;
  }
});

document.addEventListener("keydown", (event) => {
  const tag = event.target.tagName;
  if (
    ["INPUT", "TEXTAREA", "SELECT"].includes(tag) ||
    event.target.isContentEditable
  ) {
    return;
  }
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const index = variants.findIndex((item) => item.key === ui.variant);
  const nextIndex =
    event.key === "ArrowRight"
      ? (index + 1) % variants.length
      : (index - 1 + variants.length) % variants.length;
  setQuery({ variant: variants[nextIndex].key });
});

window.addEventListener("popstate", () => {
  ui = { ...ui, ...queryState() };
  render();
});

render();
