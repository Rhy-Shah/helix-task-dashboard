const state = {
  connected: false,
  dashboard: null,
  helixProject: null,
  loginWindowOpen: false,
  quickFilter: null,
};

const PRIMARY_STAGES = new Set([
  "Delivered",
  "Ready to Deliver",
  "Internal Audit",
  "Pass@n",
  "Pass@0",
  "Submitted for Pass@",
]);

const QUICK_FILTERS = {
  delivered_ready: {
    label: "Delivered & Ready",
    sub: "Delivered + Ready to Deliver",
    accent: "green",
    test: (task) => task.stage === "Delivered" || task.stage === "Ready to Deliver",
  },
  internal_audit: {
    label: "Internal Audit",
    sub: "invalid or rejected",
    accent: "blue",
    test: (task) => /internal audit/i.test(task.stage || ""),
  },
  pass_at: {
    label: "Pass@",
    sub: "Pass@n + Pass@0 + Submitted",
    accent: "violet",
    test: (task) => {
      const s = task.stage || "";
      return s === "Pass@n" || s === "Pass@0" || s === "Submitted for Pass@";
    },
  },
  other: {
    label: "Other",
    sub: "Review, failing, misc.",
    accent: "amber",
    test: (task) => !PRIMARY_STAGES.has(task.stage || ""),
  },
};

const elements = {
  connectionCard: document.querySelector("#connection-card"),
  connectionTitle: document.querySelector("#connection-title"),
  connectionCopy: document.querySelector("#connection-copy"),
  connectButton: document.querySelector("#connect-button"),
  saveLoginButton: document.querySelector("#save-login-button"),
  logoutButton: document.querySelector("#logout-button"),
  fetchProjectButton: document.querySelector("#fetch-project-button"),
  helixProjectId: document.querySelector("#helix-project-id"),
  message: document.querySelector("#message"),
  dashboard: document.querySelector("#dashboard"),
  dashboardTitle: document.querySelector("#dashboard-title"),
  generatedAt: document.querySelector("#generated-at"),
  summaryGrid: document.querySelector("#summary-grid"),
  searchInput: document.querySelector("#search-input"),
  stageFilter: document.querySelector("#stage-filter"),
  buildFilter: document.querySelector("#build-filter"),
  resultCount: document.querySelector("#result-count"),
  copyVisibleButton: document.querySelector("#copy-visible-button"),
  copyCount: document.querySelector("#copy-count"),
  clearFiltersButton: document.querySelector("#clear-filters-button"),
  taskTable: document.querySelector("#task-table"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || "Request failed.");
  }

  return body;
}

function showMessage(text, type = "info") {
  elements.message.hidden = false;
  elements.message.textContent = text;
  elements.message.className = `message ${type === "error" ? "error" : ""}`;
}

function clearMessage() {
  elements.message.hidden = true;
  elements.message.textContent = "";
}

function setBusy(button, busyText) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;

  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

function renderConnection(profile) {
  elements.connectionCard.classList.toggle("connected", state.connected);
  elements.connectionTitle.textContent = state.connected
    ? `Signed in${profile?.name ? ` as ${profile.name}` : ""}`
    : "Not signed in";
  elements.connectionCopy.textContent = state.connected
    ? "Ready to fetch your Helix tasks."
    : "Open Handshake login to create a local session.";
  elements.saveLoginButton.disabled = !state.loginWindowOpen;

  if (state.helixProject && elements.helixProjectId) {
    elements.helixProjectId.textContent = state.helixProject.id || "";
  }
}

function pillClass(value) {
  const v = String(value || "");
  if (v === "failing") return "coral";
  if (v === "passing" || v === "Delivered") return "green";
  if (/Review|Submitted/.test(v)) return "blue";
  if (/Ready/.test(v)) return "violet";
  return "amber";
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function countByPredicate(predicate) {
  const tasks = state.dashboard?.tasks || [];
  return tasks.reduce((n, task) => (predicate(task) ? n + 1 : n), 0);
}

function renderSummary() {
  const summary = state.dashboard.summary || {};
  const total = summary.total || 0;

  const filterKeys = ["delivered_ready", "internal_audit", "pass_at", "other"];
  const cards = [
    { key: "all", label: "Total tasks", sub: "click to clear filter", value: total, accent: "violet" },
    ...filterKeys.map((key) => ({
      key,
      label: QUICK_FILTERS[key].label,
      sub: QUICK_FILTERS[key].sub,
      value: countByPredicate(QUICK_FILTERS[key].test),
      accent: QUICK_FILTERS[key].accent,
    })),
  ];

  elements.summaryGrid.innerHTML = cards
    .map(({ key, label, sub, value, accent }) => {
      const isActive =
        state.quickFilter === key || (key === "all" && !state.quickFilter);
      return `
        <button type="button" class="metric metric-button accent-${accent}${
        isActive ? " active" : ""
      }" data-quick="${key}">
          <strong>${value}</strong>
          <span class="metric-label">${escapeHtml(label)}</span>
          ${sub ? `<small class="metric-sub">${escapeHtml(sub)}</small>` : ""}
        </button>
      `;
    })
    .join("");

  elements.summaryGrid.querySelectorAll(".metric-button").forEach((node) => {
    node.addEventListener("click", () => {
      const key = node.dataset.quick;
      setQuickFilter(key === "all" ? null : key);
    });
  });
}

function setQuickFilter(key) {
  state.quickFilter = key;
  elements.searchInput.value = "";
  elements.stageFilter.value = "all";
  elements.buildFilter.value = "all";
  renderTable();
  renderSummary();
  updateClearFilterButton();
}

function hasActiveFilter() {
  return (
    state.quickFilter ||
    elements.searchInput.value.trim() ||
    elements.stageFilter.value !== "all" ||
    elements.buildFilter.value !== "all"
  );
}

function updateClearFilterButton() {
  elements.clearFiltersButton.hidden = !hasActiveFilter();
}

function renderFilters() {
  const tasks = state.dashboard.tasks || [];
  const stages = unique(tasks.map((task) => task.stage || "No stage found"));
  const builds = unique(tasks.map((task) => task.buildStatus || "None"));

  const prevStage = elements.stageFilter.value;
  const prevBuild = elements.buildFilter.value;

  elements.stageFilter.innerHTML = [
    '<option value="all">All stages</option>',
    ...stages.map((stage) => `<option value="${escapeHtml(stage)}">${escapeHtml(stage)}</option>`),
  ].join("");
  elements.buildFilter.innerHTML = [
    '<option value="all">All builds</option>',
    ...builds.map((build) => `<option value="${escapeHtml(build)}">${escapeHtml(build)}</option>`),
  ].join("");

  if (prevStage && [...elements.stageFilter.options].some((o) => o.value === prevStage)) {
    elements.stageFilter.value = prevStage;
  }
  if (prevBuild && [...elements.buildFilter.options].some((o) => o.value === prevBuild)) {
    elements.buildFilter.value = prevBuild;
  }
}

function filteredTasks() {
  const tasks = state.dashboard?.tasks || [];
  const query = elements.searchInput.value.trim().toLowerCase();
  const stage = elements.stageFilter.value;
  const build = elements.buildFilter.value;
  const quick = state.quickFilter ? QUICK_FILTERS[state.quickFilter] : null;

  return tasks.filter((task) => {
    const buildStatus = task.buildStatus || "None";
    const searchable = [
      task.id,
      task.projectName,
      task.stage,
      buildStatus,
      task.title || "",
    ]
      .join(" ")
      .toLowerCase();

    return (
      (!query || searchable.includes(query)) &&
      (stage === "all" || task.stage === stage) &&
      (build === "all" || buildStatus === build) &&
      (!quick || quick.test(task))
    );
  });
}

function renderTable() {
  const tasks = filteredTasks();
  const total = state.dashboard?.tasks?.length || 0;

  elements.resultCount.textContent =
    tasks.length === total
      ? `${tasks.length} tasks`
      : `${tasks.length} of ${total} tasks`;

  elements.copyCount.textContent = tasks.length;
  elements.copyVisibleButton.disabled = tasks.length === 0;

  if (tasks.length === 0) {
    elements.taskTable.innerHTML = `
      <tr><td colspan="5" style="padding: 32px; text-align: center; color: var(--muted);">
        No tasks match the current filters.
      </td></tr>
    `;
    return;
  }

  elements.taskTable.innerHTML = tasks
    .map(
      (task) => `
        <tr>
          <td class="mono">${escapeHtml(task.id)}</td>
          <td><span class="pill ${pillClass(task.stage)}">${escapeHtml(task.stage)}</span></td>
          <td><span class="pill ${pillClass(task.buildStatus || "None")}">${escapeHtml(
            task.buildStatus || "None"
          )}</span></td>
          <td class="muted-cell" title="${escapeHtml(task.updatedAt || "")}">${escapeHtml(
            formatDate(task.updatedAt)
          )}</td>
          <td>${escapeHtml(task.title || "")}</td>
        </tr>
      `
    )
    .join("");
}

function formatDate(value) {
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderDashboard() {
  elements.dashboard.hidden = false;
  elements.dashboardTitle.textContent = "Project Helix Tasks";
  elements.generatedAt.textContent = `Updated ${new Date(
    state.dashboard.generatedAt
  ).toLocaleString()}`;
  state.quickFilter = null;
  renderSummary();
  renderFilters();
  renderTable();
  updateClearFilterButton();
}

async function loadStatus() {
  const status = await request("/api/status");
  state.connected = status.connected;
  state.helixProject = status.helixProject;
  renderConnection(status.profile);
}

async function startLogin() {
  const done = setBusy(elements.connectButton, "Opening...");
  clearMessage();

  try {
    await request("/api/connect/start", {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.loginWindowOpen = true;
    renderConnection();
    showMessage("Handshake login window opened. Finish signing in there, then click Save Login.");
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    done();
  }
}

async function saveLogin() {
  const done = setBusy(elements.saveLoginButton, "Saving...");

  try {
    const result = await request("/api/connect/save", { method: "POST" });
    state.connected = true;
    state.loginWindowOpen = false;
    renderConnection(result.profile);
    showMessage("Signed in. You can fetch tasks now.");
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    done();
  }
}

async function logout() {
  await request("/api/logout", { method: "POST" });
  state.connected = false;
  state.dashboard = null;
  elements.dashboard.hidden = true;
  renderConnection();
  showMessage("Logged out.");
}

async function fetchProject() {
  const done = setBusy(elements.fetchProjectButton, "Fetching...");

  try {
    const data = await request("/api/dashboard", {
      method: "POST",
      body: JSON.stringify({ mode: "project" }),
    });
    state.dashboard = data;
    renderDashboard();
    showMessage(`Fetched ${data.tasks.length} tasks.`);
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    done();
  }
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function flashCopySuccess(button, originalLabel) {
  const labelEl = button.querySelector(".copy-label");
  if (labelEl) {
    labelEl.textContent = "Copied!";
    setTimeout(() => {
      labelEl.textContent = originalLabel;
    }, 1400);
  }
}

async function copyTaskIds(label, tasks, button) {
  const ids = tasks.map((task) => task.id);

  if (ids.length === 0) {
    showMessage(`No ${label} task IDs to copy.`, "error");
    return;
  }

  await writeClipboard(ids.join("\n"));
  showMessage(`Copied ${ids.length} ${label} task ID${ids.length === 1 ? "" : "s"} to clipboard.`);
  if (button) flashCopySuccess(button, "Copy Filtered IDs");
}

elements.connectButton.addEventListener("click", startLogin);
elements.saveLoginButton.addEventListener("click", saveLogin);
elements.logoutButton.addEventListener("click", logout);
elements.fetchProjectButton.addEventListener("click", fetchProject);
elements.copyVisibleButton.addEventListener("click", () =>
  copyTaskIds("filtered", filteredTasks(), elements.copyVisibleButton)
);
elements.clearFiltersButton.addEventListener("click", () => setQuickFilter(null));
[elements.searchInput, elements.stageFilter, elements.buildFilter].forEach((control) => {
  control.addEventListener("input", () => {
    if (state.quickFilter) {
      state.quickFilter = null;
      renderSummary();
    }
    renderTable();
    updateClearFilterButton();
  });
  control.addEventListener("change", () => {
    if (state.quickFilter) {
      state.quickFilter = null;
      renderSummary();
    }
    renderTable();
    updateClearFilterButton();
  });
});

loadStatus().catch((err) => showMessage(err.message, "error"));
