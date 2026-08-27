const NAVIGATION_DEFINITIONS = Object.freeze([
  { view: "overview", label: "Overview", icon: "▦", availability: "always" },
  { view: "detail", label: "Mission Detail", icon: "◎", availability: "mission" },
  { view: "runs", label: "Runs & Artifacts", icon: "◫", availability: "mission" },
  { view: "decisions", label: "Decision Rooms", icon: "◆", availability: "mission" },
  { view: "gates", label: "Quality Gates", icon: "✓", availability: "mission" },
  { view: "approval", label: "Approval Room", icon: "◇", availability: "approval" },
  { view: "playbook", label: "Playbooks", icon: "↻", availability: "playbook" },
  { view: "metrics", label: "Metrics", icon: "⌁", availability: "always" },
  { view: "settings", label: "Settings", icon: "⚙", availability: "always" },
]);

const AVAILABILITY_COPY = Object.freeze({
  mission: "Select a Mission first",
  approval: "No decision pending",
  playbook: "Complete Mission first",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildMissionNavigation({
  activeView,
  mission,
  approvalAvailable,
  playbookAvailable,
}) {
  return Object.freeze(
    NAVIGATION_DEFINITIONS.map((definition) => {
      const disabled =
        definition.availability === "mission"
          ? !mission
          : definition.availability === "approval"
            ? !approvalAvailable
            : definition.availability === "playbook"
              ? !playbookAvailable
              : false;
      const availability = disabled
        ? AVAILABILITY_COPY[definition.availability]
        : definition.availability === "approval"
          ? "Human decision"
          : definition.availability === "playbook"
            ? "Bounded evaluation"
            : null;
      return Object.freeze({
        ...definition,
        current: definition.view === activeView,
        disabled,
        availability,
      });
    }),
  );
}

export function renderMissionNavigation(items) {
  return `
    <nav class="nav-list" aria-label="Primary navigation">
      ${items
        .map(
          (item) => `
            <button class="nav-item ${item.current ? "is-active" : ""}" type="button" data-route="${escapeHtml(item.view)}"${item.current ? ' aria-current="page"' : ""}${item.disabled ? ` disabled title="${escapeHtml(item.availability)}"` : ""}>
              <span class="nav-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>
              <span class="nav-copy"><span>${escapeHtml(item.label)}</span>${item.availability ? `<small>${escapeHtml(item.availability)}</small>` : ""}</span>
            </button>
          `,
        )
        .join("")}
    </nav>
  `;
}
