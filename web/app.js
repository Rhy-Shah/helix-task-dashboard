const state = {
  connected: false,
  dashboard: null,
  loginWindowOpen: false,
  quickFilter: null,
  sort: { column: "updatedAt", direction: "desc" },
};

const QUICK_FILTERS = {
  delivered_ready: {
    label: "Delivered & Ready",
    sub: "Delivered + Ready to Deliver",
    accent: "green",
    test: (task) => {
      const s = task.stage || "";
      return s === "Delivered" || s === "Ready to Deliver";
    },
  },
  internal_audit: {
    label: "Internal Audit",
    sub: "Review + Internal Audit",
    accent: "blue",
    test: (task) => {
      const s = task.stage || "";
      if (/clayden/i.test(s)) return false;
      return /internal audit|review|likely rejected/i.test(s);
    },
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
    label: "Misc",
    sub: "Invalid + Others",
    accent: "amber",
    test: (task) =>
      !QUICK_FILTERS.delivered_ready.test(task) &&
      !QUICK_FILTERS.internal_audit.test(task) &&
      !QUICK_FILTERS.pass_at.test(task),
  },
};
const FILTER_ORDER = ["delivered_ready", "pass_at", "internal_audit", "other"];

const BRANDING_PUBLIC = {
  documentTitle: "Tasks Dashboard",
  mastheadTitle: "Tasks Dashboard",
  subtitle:
    "Sign in to load your tasks. If the window doesn't close on its own, click Save Login. Your session is saved locally.",
  connectButton: "Login",
  footnote: "Tasks Dashboard",
};

const BRANDING_PRIVATE = {
  documentTitle: "Project Helix Tasks",
  mastheadTitle: "Project Helix Tasks",
  subtitle: "Every Project Helix task, stage, and build in one place.",
  connectButton: "Login",
  footnote: "Project Helix Tasks · Handshake dashboard",
};

const elements = {
  mastheadTitle: document.querySelector("#masthead-title"),
  mastheadSubtitle: document.querySelector("#masthead-subtitle"),
  footnoteText: document.querySelector("#footnote-text"),
  connectionCard: document.querySelector("#connection-card"),
  connectionTitle: document.querySelector("#connection-title"),
  connectButton: document.querySelector("#connect-button"),
  saveLoginButton: document.querySelector("#save-login-button"),
  logoutButton: document.querySelector("#logout-button"),
  message: document.querySelector("#message"),
  loadingState: document.querySelector("#loading-state"),
  dashboard: document.querySelector("#dashboard"),
  mastheadMeta: document.querySelector("#masthead-meta"),
  generatedAt: document.querySelector("#generated-at"),
  refreshButton: document.querySelector("#refresh-button"),
  summaryGrid: document.querySelector("#summary-grid"),
  searchInput: document.querySelector("#search-input"),
  stageFilter: document.querySelector("#stage-filter"),
  buildFilter: document.querySelector("#build-filter"),
  dateFromInput: document.querySelector("#date-from-input"),
  dateToInput: document.querySelector("#date-to-input"),
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
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
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

function applyBranding(connected) {
  const b = connected ? BRANDING_PRIVATE : BRANDING_PUBLIC;
  document.title = b.documentTitle;
  elements.mastheadTitle.textContent = b.mastheadTitle;
  elements.mastheadSubtitle.textContent = b.subtitle;
  elements.footnoteText.textContent = b.footnote;
  elements.connectButton.textContent = b.connectButton;
}

function renderConnection(profile) {
  elements.connectionCard.classList.toggle("connected", state.connected);
  if (state.connected) {
    elements.connectionTitle.textContent = `Signed in${
      profile?.name ? ` as ${profile.name}` : ""
    }`;
  } else if (state.loginWindowOpen) {
    elements.connectionTitle.textContent = "Waiting for sign-in...";
  } else {
    elements.connectionTitle.textContent = "Not signed in";
  }
  if (state.connected) {
    elements.connectButton.hidden = true;
    elements.saveLoginButton.hidden = true;
    elements.logoutButton.hidden = false;
  } else if (state.loginWindowOpen) {
    elements.connectButton.hidden = true;
    elements.saveLoginButton.hidden = false;
    elements.logoutButton.hidden = true;
  } else {
    elements.connectButton.hidden = false;
    elements.saveLoginButton.hidden = true;
    elements.logoutButton.hidden = true;
  }
  applyBranding(state.connected);
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
  return (state.dashboard?.tasks || []).reduce(
    (n, task) => (predicate(task) ? n + 1 : n),
    0
  );
}

function renderSummary() {
  const total = state.dashboard?.summary?.total || 0;
  const cards = [
    {
      key: "all",
      label: "Total tasks",
      sub: "Click to clear category",
      value: total,
      accent: "violet",
    },
    ...FILTER_ORDER.map((key) => ({
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
      if (key === "all") {
        state.quickFilter = null;
        renderTable();
        renderSummary();
        updateClearFilterButton();
      } else {
        setQuickFilter(key);
      }
    });
  });
}

function setQuickFilter(key) {
  state.quickFilter = state.quickFilter === key ? null : key;
  renderTable();
  renderSummary();
  updateClearFilterButton();
}

function clearAllFilters() {
  state.quickFilter = null;
  elements.searchInput.value = "";
  elements.stageFilter.value = "all";
  elements.buildFilter.value = "all";
  elements.dateFromInput.value = "";
  elements.dateToInput.value = "";
  renderTable();
  renderSummary();
  updateClearFilterButton();
}

function hasActiveFilter() {
  return (
    state.quickFilter ||
    elements.searchInput.value.trim() ||
    elements.stageFilter.value !== "all" ||
    elements.buildFilter.value !== "all" ||
    elements.dateFromInput.value ||
    elements.dateToInput.value
  );
}

function updateClearFilterButton() {
  elements.clearFiltersButton.hidden = !hasActiveFilter();
}

function renderFilters() {
  const tasks = state.dashboard?.tasks || [];
  const stages = unique(tasks.map((task) => task.stage || "No stage found"));
  const builds = unique(tasks.map((task) => task.buildStatus || "None"));

  const prevStage = elements.stageFilter.value;
  const prevBuild = elements.buildFilter.value;

  elements.stageFilter.innerHTML = [
    '<option value="all">All stages</option>',
    ...stages.map(
      (stage) => `<option value="${escapeHtml(stage)}">${escapeHtml(stage)}</option>`
    ),
  ].join("");
  elements.buildFilter.innerHTML = [
    '<option value="all">All builds</option>',
    ...builds.map(
      (build) => `<option value="${escapeHtml(build)}">${escapeHtml(build)}</option>`
    ),
  ].join("");

  if (prevStage && [...elements.stageFilter.options].some((o) => o.value === prevStage)) {
    elements.stageFilter.value = prevStage;
  }
  if (prevBuild && [...elements.buildFilter.options].some((o) => o.value === prevBuild)) {
    elements.buildFilter.value = prevBuild;
  }
}

function parseDateInput(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function filteredTasks() {
  const tasks = state.dashboard?.tasks || [];
  const query = elements.searchInput.value.trim().toLowerCase();
  const stage = elements.stageFilter.value;
  const build = elements.buildFilter.value;
  const quick = state.quickFilter ? QUICK_FILTERS[state.quickFilter] : null;
  const dateFrom = parseDateInput(elements.dateFromInput.value);
  const dateTo = parseDateInput(elements.dateToInput.value, true);

  return tasks.filter((task) => {
    const buildStatus = task.buildStatus || "None";
    const searchable = [task.id, task.projectName, task.stage, buildStatus, task.title || ""]
      .join(" ")
      .toLowerCase();

    let dateMatch = true;
    if (dateFrom || dateTo) {
      const taskDate = task.updatedAt ? new Date(task.updatedAt) : null;
      if (!taskDate || Number.isNaN(taskDate.getTime())) {
        dateMatch = false;
      } else {
        if (dateFrom && taskDate < dateFrom) dateMatch = false;
        if (dateTo && taskDate > dateTo) dateMatch = false;
      }
    }

    return (
      (!query || searchable.includes(query)) &&
      (stage === "all" || task.stage === stage) &&
      (build === "all" || buildStatus === build) &&
      (!quick || quick.test(task)) &&
      dateMatch
    );
  });
}

function compareValues(a, b, column) {
  const av = a?.[column];
  const bv = b?.[column];
  const aMissing = av === null || av === undefined || av === "";
  const bMissing = bv === null || bv === undefined || bv === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (column === "updatedAt") {
    return new Date(av).getTime() - new Date(bv).getTime();
  }
  return String(av).localeCompare(String(bv), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortedTasks(tasks) {
  const { column, direction } = state.sort;
  if (!column) return tasks;
  const factor = direction === "desc" ? -1 : 1;
  return [...tasks].sort((a, b) => compareValues(a, b, column) * factor);
}

function renderSortIndicators() {
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (state.sort.column && th.dataset.sort === state.sort.column) {
      th.classList.add(state.sort.direction === "desc" ? "sort-desc" : "sort-asc");
    }
  });
}

function handleSortClick(column) {
  if (state.sort.column === column) {
    if (state.sort.direction === "asc") {
      state.sort.direction = "desc";
    } else {
      state.sort.column = null;
      state.sort.direction = "asc";
    }
  } else {
    state.sort.column = column;
    state.sort.direction = "asc";
  }
  renderSortIndicators();
  renderTable();
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

function renderTable() {
  const tasks = sortedTasks(filteredTasks());
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
          <td class="mono">
            <span class="task-id-cell">
              <span class="task-id-text">${escapeHtml(task.id)}</span>
              <button
                type="button"
                class="copy-id-button"
                data-task-id="${escapeHtml(task.id)}"
                title="Copy task ID"
                aria-label="Copy task ID ${escapeHtml(task.id)}"
              >⧉</button>
            </span>
          </td>
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

function renderDashboard() {
  elements.dashboard.hidden = false;
  if (elements.mastheadMeta) elements.mastheadMeta.hidden = false;
  elements.generatedAt.textContent = `Updated ${new Date(
    state.dashboard.generatedAt
  ).toLocaleString()}`;
  state.quickFilter = null;
  state.sort = { column: "updatedAt", direction: "desc" };
  renderSummary();
  renderFilters();
  renderSortIndicators();
  renderTable();
  updateClearFilterButton();
}

async function loadStatus({ autoFetch = false } = {}) {
  const status = await request("/api/status");
  state.connected = status.connected;
  renderConnection(status.profile);
  if (autoFetch && status.connected) {
    try {
      await fetchProject({ silent: true });
    } catch (err) {
      showMessage(err.message || "Could not load tasks.", "error");
    }
  }
}

let loginPollHandle = null;

function stopLoginPoll() {
  if (loginPollHandle) {
    clearInterval(loginPollHandle);
    loginPollHandle = null;
  }
}

function startLoginPoll() {
  stopLoginPoll();
  let attempts = 0;
  const maxAttempts = 600; // ~20 minutes at 2s
  loginPollHandle = setInterval(async () => {
    attempts += 1;
    try {
      const status = await request("/api/status");
      if (status.connected) {
        stopLoginPoll();
        state.connected = true;
        state.loginWindowOpen = false;
        renderConnection(status.profile);
        clearMessage();
        await fetchProject({ silent: true });
        return;
      }
    } catch {
      // ignore transient polling errors
    }
    if (attempts >= maxAttempts) {
      stopLoginPoll();
      state.loginWindowOpen = false;
      renderConnection();
      showMessage("Login window timed out. Click Login to try again.", "error");
    }
  }, 2000);
}

async function startLogin() {
  const done = setBusy(elements.connectButton, "Opening...");
  clearMessage();
  try {
    await request("/api/connect/start", { method: "POST", body: JSON.stringify({}) });
    state.loginWindowOpen = true;
    renderConnection();
    showMessage("Login window opened. Finish signing in there — your session saves automatically.");
    startLoginPoll();
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    done();
  }
}

async function saveLogin() {
  const done = setBusy(elements.saveLoginButton, "Saving...");
  clearMessage();
  try {
    const result = await request("/api/connect/save", {
      method: "POST",
      body: JSON.stringify({}),
    });
    stopLoginPoll();
    state.connected = true;
    state.loginWindowOpen = false;
    renderConnection(result.profile);
    clearMessage();
    await fetchProject({ silent: true });
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    done();
  }
}

async function logout() {
  stopLoginPoll();
  await request("/api/logout", { method: "POST" });
  state.connected = false;
  state.loginWindowOpen = false;
  state.dashboard = null;
  elements.dashboard.hidden = true;
  if (elements.mastheadMeta) elements.mastheadMeta.hidden = true;
  if (elements.loadingState) elements.loadingState.hidden = true;
  renderConnection();
  showMessage("Logged out.");
}

async function fetchProject({ silent = false } = {}) {
  const refreshButton = elements.refreshButton;
  const previousLabel = refreshButton?.innerHTML ?? null;
  const firstLoad = !state.dashboard;

  if (firstLoad && elements.loadingState) {
    elements.loadingState.hidden = false;
  }
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Refreshing...';
  }

  try {
    const data = await request("/api/dashboard", {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.dashboard = data;
    renderDashboard();
    if (!silent) showMessage(`Fetched ${data.tasks.length} tasks.`);
    else clearMessage();
  } finally {
    if (elements.loadingState) elements.loadingState.hidden = true;
    if (refreshButton && previousLabel !== null) {
      refreshButton.disabled = false;
      refreshButton.innerHTML = previousLabel;
    }
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

async function copyFilteredIds(button) {
  const ids = filteredTasks().map((task) => task.id);
  if (ids.length === 0) {
    showMessage("No filtered task IDs to copy.", "error");
    return;
  }
  await writeClipboard(ids.join("\n"));
  showMessage(
    `Copied ${ids.length} task ID${ids.length === 1 ? "" : "s"} to clipboard.`
  );
  const labelEl = button.querySelector(".copy-label");
  if (labelEl) {
    labelEl.textContent = "Copied!";
    setTimeout(() => {
      labelEl.textContent = "Copy Filtered IDs";
    }, 1400);
  }
}

elements.connectButton.addEventListener("click", startLogin);
elements.saveLoginButton.addEventListener("click", saveLogin);
elements.logoutButton.addEventListener("click", logout);
elements.refreshButton?.addEventListener("click", () =>
  fetchProject().catch((err) => showMessage(err.message, "error"))
);
elements.copyVisibleButton.addEventListener("click", () =>
  copyFilteredIds(elements.copyVisibleButton)
);
elements.clearFiltersButton.addEventListener("click", clearAllFilters);

document.querySelectorAll("th.sortable").forEach((th) => {
  th.addEventListener("click", () => handleSortClick(th.dataset.sort));
});

elements.taskTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".copy-id-button");
  if (!button) return;
  const id = button.dataset.taskId;
  if (!id) return;
  try {
    await writeClipboard(id);
    const original = button.textContent;
    button.classList.add("copied");
    button.textContent = "✓";
    setTimeout(() => {
      button.classList.remove("copied");
      button.textContent = original;
    }, 1200);
  } catch {
    showMessage("Could not copy task ID.", "error");
  }
});

[
  elements.searchInput,
  elements.stageFilter,
  elements.buildFilter,
  elements.dateFromInput,
  elements.dateToInput,
].forEach((control) => {
  const onChange = () => {
    renderTable();
    updateClearFilterButton();
  };
  control.addEventListener("input", onChange);
  control.addEventListener("change", onChange);
});

loadStatus({ autoFetch: true }).catch((err) => showMessage(err.message, "error"));
