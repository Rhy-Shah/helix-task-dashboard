const ACTIVITY_FIELDS = ["stage", "buildStatus"];
const ACTIVITY_STORAGE_KEY = "hai_activity_state";
const ACTIVITY_SNAPSHOT_VERSION = 2;

const state = {
  connected: false,
  profile: null,
  dashboard: null,
  loginWindowOpen: false,
  quickFilter: null,
  sort: { column: "updatedAt", direction: "desc" },
  previousTaskSnapshot: null,
  latestActivity: [],
  activityFromThisRefresh: false,
  activityReady: false,
  activityBaselineJustCreated: false,
};

function stageName(stage) {
  return String(stage ?? "").trim();
}

/** Pattern-based buckets so new platform stage names still classify correctly. */
function isAcceptedStage(stage) {
  const lc = stageName(stage).toLowerCase();
  return lc === "delivered" || lc === "ready to deliver";
}

function isEvaluationStage(stage) {
  const s = stageName(stage);
  const lc = s.toLowerCase();
  return /pass@/i.test(s) || lc.includes("submitted for pass@");
}

function isAuditStage(stage) {
  const s = stageName(stage);
  const lc = s.toLowerCase();
  if (/clayden/i.test(s)) return false;
  return lc.includes("internal audit") || /\breview\b/i.test(lc) || lc.includes("likely rejected");
}

const QUICK_FILTERS = {
  delivered_ready: {
    label: "Accepted",
    sub: "Delivered + RTD",
    accent: "green",
    test: (task) => isAcceptedStage(task.stage),
  },
  internal_audit: {
    label: "Internal Audit",
    sub: "Review + Internal Audit",
    accent: "blue",
    test: (task) => isAuditStage(task.stage),
  },
  pass_at: {
    label: "In evaluation",
    sub: "All Pass@ Stages",
    accent: "violet",
    test: (task) => isEvaluationStage(task.stage),
  },
  other: {
    label: "Misc",
    sub: "Failed + Invalid + Misc",
    accent: "amber",
    test: (task) =>
      !isAcceptedStage(task.stage) &&
      !isAuditStage(task.stage) &&
      !isEvaluationStage(task.stage),
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
  documentTitle: "Project Helix",
  mastheadTitle: "Project Helix",
  subtitle: "Every Project Helix task, stage, and build in one place.",
  connectButton: "Login",
  footnote: "Project Helix · Handshake dashboard",
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
  messageSlot: document.querySelector("#message-slot"),
  message: document.querySelector("#message"),
  messageText: document.querySelector("#message-text"),
  messageDismiss: document.querySelector("#message-dismiss"),
  loginGoogleHint: document.querySelector("#login-google-hint"),
  loadingState: document.querySelector("#loading-state"),
  dashboard: document.querySelector("#dashboard"),
  mastheadMeta: document.querySelector("#masthead-meta"),
  generatedAt: document.querySelector("#generated-at"),
  refreshButton: document.querySelector("#refresh-button"),
  summaryGrid: document.querySelector("#summary-grid"),
  activityPanel: document.querySelector("#activity-panel"),
  activityMeta: document.querySelector("#activity-meta"),
  activityList: document.querySelector("#activity-list"),
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

const MESSAGE_AUTO_DISMISS_MS = 3000;
const MESSAGE_SLOT_MS = 550;
let messageDismissTimer = null;
let messageHideDone = null;

function messageSlotHeight() {
  if (!elements.message || elements.message.hidden) return 0;
  return elements.message.offsetHeight;
}

function finishHideMessage() {
  if (!elements.message) return;
  elements.message.hidden = true;
  elements.message.classList.remove("hiding");
  if (elements.messageText) elements.messageText.textContent = "";
  if (elements.messageSlot) {
    elements.messageSlot.classList.remove("is-open");
    elements.messageSlot.style.height = "";
    elements.messageSlot.style.marginBottom = "";
  }
  if (messageHideDone && elements.messageSlot) {
    elements.messageSlot.removeEventListener("transitionend", messageHideDone);
    messageHideDone = null;
  }
}

function openMessageSlot() {
  const slot = elements.messageSlot;
  if (!slot) return;

  slot.classList.add("is-open");
  slot.style.height = "0px";
  slot.style.marginBottom = "16px";
  const target = messageSlotHeight();
  requestAnimationFrame(() => {
    slot.style.height = `${target}px`;
    const onOpen = (event) => {
      if (event.target !== slot || event.propertyName !== "height") return;
      slot.removeEventListener("transitionend", onOpen);
      slot.style.height = "auto";
    };
    slot.addEventListener("transitionend", onOpen);
  });
}

function showMessage(text, type = "info") {
  if (messageDismissTimer) {
    clearTimeout(messageDismissTimer);
    messageDismissTimer = null;
  }
  if (messageHideDone && elements.messageSlot) {
    elements.messageSlot.removeEventListener("transitionend", messageHideDone);
    messageHideDone = null;
  }
  if (!elements.message) return;

  const typeClass = type === "error" ? "error" : "";
  if (elements.messageText) elements.messageText.textContent = text;
  elements.message.hidden = false;
  elements.message.classList.remove("hiding");
  elements.message.className = `message ${typeClass}`.trim();
  openMessageSlot();

  messageDismissTimer = setTimeout(clearMessage, MESSAGE_AUTO_DISMISS_MS);
}

function clearMessage() {
  if (messageDismissTimer) {
    clearTimeout(messageDismissTimer);
    messageDismissTimer = null;
  }
  if (!elements.message || elements.message.hidden) return;
  if (elements.message.classList.contains("hiding")) return;

  const slot = elements.messageSlot;
  let finished = false;
  const completeHide = () => {
    if (finished) return;
    finished = true;
    finishHideMessage();
  };

  if (slot) {
    messageHideDone = (event) => {
      if (event.target !== slot || event.propertyName !== "height") return;
      completeHide();
    };
    slot.addEventListener("transitionend", messageHideDone);
  }

  setTimeout(completeHide, MESSAGE_SLOT_MS + 80);

  elements.message.classList.add("hiding");

  if (slot) {
    const current = slot.style.height === "auto" ? messageSlotHeight() : slot.offsetHeight;
    slot.style.height = `${current}px`;
    slot.style.marginBottom = "16px";
    void slot.offsetHeight;
    slot.style.height = "0px";
    slot.style.marginBottom = "0px";
    slot.classList.remove("is-open");
  }
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
  const resolvedProfile = profile || state.profile;
  elements.connectionCard.classList.toggle("connected", state.connected);
  if (state.connected) {
    elements.connectionTitle.textContent = `Signed in${
      resolvedProfile?.name ? ` as ${resolvedProfile.name}` : ""
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
  if (elements.loginGoogleHint) {
    elements.loginGoogleHint.hidden = state.connected;
  }
  applyBranding(state.connected);
}

function pillClass(value) {
  const v = String(value || "").trim();
  const lc = v.toLowerCase();
  if (lc === "failing" || lc.includes("failed")) return "coral";
  if (lc === "passing" || isAcceptedStage(v)) return "green";
  if (isEvaluationStage(v)) return "violet";
  if (isAuditStage(v)) return "blue";
  if (lc.includes("invalid")) return "ochre";
  if (lc.includes("holding")) return "amber";
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

function formatRelativeUpdated(isoValue) {
  if (!isoValue) return "Updated —";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "Updated —";

  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;

  if (diffMs < minute) return "Updated just now";

  if (diffMs < hour) {
    const n = Math.floor(diffMs / minute);
    return `Updated ${n} minute${n === 1 ? "" : "s"} ago`;
  }

  if (diffMs < day) {
    const n = Math.floor(diffMs / hour);
    return `Updated ${n} hour${n === 1 ? "" : "s"} ago`;
  }

  if (diffMs <= week) {
    const n = Math.floor(diffMs / day);
    return `Updated ${n} day${n === 1 ? "" : "s"} ago`;
  }

  if (diffMs < month) {
    const n = Math.floor(diffMs / week);
    return `Updated ${n} week${n === 1 ? "" : "s"} ago`;
  }

  const n = Math.floor(diffMs / month);
  return `Updated ${n} month${n === 1 ? "" : "s"} ago`;
}

let generatedAtTicker = null;

function renderGeneratedAt() {
  if (!elements.generatedAt || !state.dashboard?.generatedAt) return;
  elements.generatedAt.textContent = formatRelativeUpdated(state.dashboard.generatedAt);
}

function startGeneratedAtTicker() {
  if (generatedAtTicker) clearInterval(generatedAtTicker);
  generatedAtTicker = setInterval(renderGeneratedAt, 60_000);
}

function stopGeneratedAtTicker() {
  if (!generatedAtTicker) return;
  clearInterval(generatedAtTicker);
  generatedAtTicker = null;
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

function taskSnapshot(task) {
  return {
    id: task.id,
    stage: task.stage || "",
    buildStatus: task.buildStatus ?? null,
    updatedAt: task.updatedAt ?? null,
    title: task.title || "",
  };
}

function buildSnapshotMap(tasks) {
  return Object.fromEntries(tasks.map((task) => [task.id, taskSnapshot(task)]));
}

function getActivityStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // ignore storage access issues
  }
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    // ignore storage access issues
  }
  return null;
}

function loadActivityState() {
  const storage = getActivityStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const snapshotVersion = parsed.snapshotVersion ?? 1;
    if (snapshotVersion !== ACTIVITY_SNAPSHOT_VERSION) {
      state.previousTaskSnapshot = null;
      state.latestActivity = [];
      state.activityFromThisRefresh = false;
      state.activityReady = false;
      state.activityBaselineJustCreated = false;
      return;
    }
    if (parsed.previousTaskSnapshot) {
      state.previousTaskSnapshot = parsed.previousTaskSnapshot;
    }
    if (Array.isArray(parsed.latestActivity)) {
      state.latestActivity = parsed.latestActivity;
    }
    state.activityFromThisRefresh = Boolean(parsed.activityFromThisRefresh);
    state.activityReady = Boolean(parsed.activityReady);
    state.activityBaselineJustCreated = Boolean(parsed.activityBaselineJustCreated);
  } catch {
    // ignore corrupt storage
  }
}

function saveActivityState() {
  const storage = getActivityStorage();
  if (!storage) return;
  try {
    storage.setItem(
      ACTIVITY_STORAGE_KEY,
      JSON.stringify({
        snapshotVersion: ACTIVITY_SNAPSHOT_VERSION,
        previousTaskSnapshot: state.previousTaskSnapshot,
        latestActivity: state.latestActivity,
        activityFromThisRefresh: state.activityFromThisRefresh,
        activityReady: state.activityReady,
        activityBaselineJustCreated: state.activityBaselineJustCreated,
      })
    );
  } catch {
    // ignore quota errors
  }
}

function activityFieldLabel(field) {
  if (field === "buildStatus") return "Build";
  return "Stage";
}

function formatActivityValue(_field, value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function diffTasksSinceRefresh(previousById, currentTasks) {
  const activities = [];

  for (const task of currentTasks) {
    const prev = previousById[task.id];
    const snap = taskSnapshot(task);

    if (!prev) continue;

    const changes = [];
    for (const field of ACTIVITY_FIELDS) {
      const from = prev[field];
      const to = snap[field];
      if (String(from ?? "") !== String(to ?? "")) {
        changes.push({ field, from, to });
      }
    }

    if (changes.length > 0) {
      activities.push({ task, changes, isNew: false });
    }
  }

  return activities.sort((a, b) => {
    const at = a.task.updatedAt ? new Date(a.task.updatedAt).getTime() : 0;
    const bt = b.task.updatedAt ? new Date(b.task.updatedAt).getTime() : 0;
    return bt - at;
  });
}

function updateLatestActivity(currentTasks) {
  const previous = state.previousTaskSnapshot;

  if (!previous) {
    state.previousTaskSnapshot = buildSnapshotMap(currentTasks);
    state.latestActivity = [];
    state.activityFromThisRefresh = false;
    state.activityReady = false;
    state.activityBaselineJustCreated = true;
    saveActivityState();
    return;
  }

  state.activityBaselineJustCreated = false;

  state.activityReady = true;
  const fresh = diffTasksSinceRefresh(previous, currentTasks);

  if (fresh.length > 0) {
    state.latestActivity = fresh;
    state.activityFromThisRefresh = true;
  } else {
    state.activityFromThisRefresh = false;
  }

  state.previousTaskSnapshot = buildSnapshotMap(currentTasks);
  saveActivityState();
}

function describeActivityChangeLine(change) {
  const from = formatActivityValue(change.field, change.from);
  const to = formatActivityValue(change.field, change.to);

  if (change.field === "stage") {
    return `Stage moved from ${from} to ${to}`;
  }
  if (change.field === "buildStatus") {
    return `Build changed from ${from} to ${to}`;
  }
  return `${activityFieldLabel(change.field)} changed from ${from} to ${to}`;
}

function describeActivityChange(entry) {
  return entry.changes.map(describeActivityChangeLine).join(" · ");
}

function renderActivity() {
  if (!elements.activityPanel || !elements.activityList) return;

  const entries = state.latestActivity;
  elements.activityPanel.hidden = false;

  if (entries.length === 0) {
    if (elements.activityMeta) {
      elements.activityMeta.textContent = state.activityReady
        ? "No stage or build changes since your last visit"
        : "";
    }
    elements.activityList.innerHTML = `<li class="activity-empty">${
      state.activityBaselineJustCreated
        ? "Baseline saved. Stage and build changes will appear here after your next refresh or visit."
        : state.activityReady
          ? "No stage or build changes since your last refresh or visit."
          : "Sign in and load tasks — stage and build changes since your last visit will show here."
    }</li>`;
    return;
  }

  if (elements.activityMeta) {
    const n = entries.length;
    elements.activityMeta.textContent = state.activityFromThisRefresh
      ? `${n} task${n === 1 ? "" : "s"} with stage or build changes since your last visit`
      : `Showing last known changes (${n} task${n === 1 ? "" : "s"})`;
  }

  elements.activityList.innerHTML = entries
    .map((entry) => {
      const task = entry.task;
      const changeText = describeActivityChange(entry);
      return `
        <li class="activity-item">
          <div class="activity-row">
            <div class="activity-col activity-col-id mono">
              <span class="task-id-cell">
                <span class="task-id-text" title="${escapeHtml(task.id)}">${escapeHtml(task.id)}</span>
                <button
                  type="button"
                  class="copy-id-button"
                  data-task-id="${escapeHtml(task.id)}"
                  title="Copy task ID"
                  aria-label="Copy task ID ${escapeHtml(task.id)}"
                >⧉</button>
              </span>
            </div>
            <div class="activity-col activity-col-stage">
              <span class="pill ${pillClass(task.stage)}">${escapeHtml(task.stage)}</span>
            </div>
            <div class="activity-col activity-col-build">
              <span class="pill ${pillClass(task.buildStatus || "None")}">${escapeHtml(
                task.buildStatus || "None"
              )}</span>
            </div>
            <div class="activity-col activity-col-date muted-cell" title="${escapeHtml(
              task.updatedAt || ""
            )}">${escapeHtml(formatDate(task.updatedAt))}</div>
          </div>
          <p class="activity-change" title="${escapeHtml(changeText)}">${escapeHtml(changeText)}</p>
        </li>
      `;
    })
    .join("");
}

function renderDashboard() {
  elements.dashboard.hidden = false;
  if (elements.mastheadMeta) elements.mastheadMeta.hidden = false;
  renderGeneratedAt();
  startGeneratedAtTicker();
  state.quickFilter = null;
  state.sort = { column: "updatedAt", direction: "desc" };
  updateLatestActivity(state.dashboard.tasks || []);
  renderSummary();
  renderActivity();
  renderFilters();
  renderSortIndicators();
  renderTable();
  updateClearFilterButton();
}

async function loadStatus({ autoFetch = false } = {}) {
  const status = await request("/api/status");
  state.connected = status.connected;
  state.profile = status.profile || null;
  renderConnection(state.profile);
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
        state.profile = status.profile || null;
        renderConnection(state.profile);
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
    state.profile = result.profile || null;
    renderConnection(state.profile);
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
  state.profile = null;
  state.dashboard = null;
  stopGeneratedAtTicker();
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
    state.connected = true;
    renderConnection(state.profile);
    state.dashboard = data;
    renderDashboard();
    if (data.historyWarning) {
      showMessage(data.historyWarning);
    } else if (!silent) {
      showMessage(`Fetched ${data.tasks.length} tasks.`);
    } else {
      clearMessage();
    }
  } catch (err) {
    if (/sign in first|session expired/i.test(err.message || "")) {
      state.connected = false;
      state.dashboard = null;
      elements.dashboard.hidden = true;
      if (elements.mastheadMeta) elements.mastheadMeta.hidden = true;
      stopGeneratedAtTicker();
      renderConnection();
    }
    throw err;
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

elements.messageDismiss?.addEventListener("click", clearMessage);

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

async function copyTaskIdFromButton(button) {
  const id = button.dataset.taskId;
  if (!id) return;
  await writeClipboard(id);
  const original = button.textContent;
  button.classList.add("copied");
  button.textContent = "✓";
  setTimeout(() => {
    button.classList.remove("copied");
    button.textContent = original;
  }, 1200);
}

async function handleCopyIdClick(event) {
  const button = event.target.closest(".copy-id-button");
  if (!button) return;
  try {
    await copyTaskIdFromButton(button);
  } catch {
    showMessage("Could not copy task ID.", "error");
  }
}

elements.taskTable.addEventListener("click", handleCopyIdClick);
elements.activityList?.addEventListener("click", handleCopyIdClick);

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

loadActivityState();
loadStatus({ autoFetch: true }).catch((err) => showMessage(err.message, "error"));
