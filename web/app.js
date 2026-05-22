const state = {
  connected: false,
  dashboard: null,
  helixProject: null,
  loginWindowOpen: false,
};

const elements = {
  connectionCard: document.querySelector("#connection-card"),
  connectionTitle: document.querySelector("#connection-title"),
  connectionCopy: document.querySelector("#connection-copy"),
  connectButton: document.querySelector("#connect-button"),
  saveLoginButton: document.querySelector("#save-login-button"),
  logoutButton: document.querySelector("#logout-button"),
  fetchProjectButton: document.querySelector("#fetch-project-button"),
  helixProjectName: document.querySelector("#helix-project-name"),
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
  dashboardNote: document.querySelector("#dashboard-note"),
  copyVisibleButton: document.querySelector("#copy-visible-button"),
  copyDeliveredButton: document.querySelector("#copy-delivered-button"),
  copyReadyButton: document.querySelector("#copy-ready-button"),
  taskTable: document.querySelector("#task-table"),
  stageTotal: document.querySelector("#stage-total"),
  stageBars: document.querySelector("#stage-bars"),
  attentionCount: document.querySelector("#attention-count"),
  attentionList: document.querySelector("#attention-list"),
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
    ? `Connected${profile?.name ? ` as ${profile.name}` : ""}`
    : "Not connected";
  elements.connectionCopy.textContent = state.connected
    ? "Ready to fetch task IDs and statuses."
    : "Open Handshake login to create a local session.";
  elements.saveLoginButton.disabled = !state.loginWindowOpen;

  if (state.helixProject) {
    elements.helixProjectName.textContent = state.helixProject.name;
    elements.helixProjectId.textContent = state.helixProject.id;
  }
}

function pillClass(value) {
  if (value === "failing") return "coral";
  if (value === "passing" || value === "Delivered") return "green";
  if (/Review|Submitted|Ready/.test(value)) return "blue";
  return "ochre";
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function renderSummary() {
  const summary = state.dashboard.summary || {};
  const cards = [
    ["Tasks", summary.total],
    ["Project", state.dashboard.project ? 1 : 0],
    ["Review", summary.reviewCount],
    ["Failing", summary.failingCount],
    ["Task IDs", state.dashboard.ids?.length || 0],
  ];

  elements.summaryGrid.innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="metric">
          <strong>${value ?? 0}</strong>
          <span>${label}</span>
        </div>
      `
    )
    .join("");
}

function renderFilters() {
  const tasks = state.dashboard.tasks || [];
  const stages = unique(tasks.map((task) => task.stage || "No stage found"));
  const builds = unique(tasks.map((task) => task.buildStatus || "None"));

  elements.stageFilter.innerHTML = [
    '<option value="all">All stages</option>',
    ...stages.map((stage) => `<option value="${escapeHtml(stage)}">${escapeHtml(stage)}</option>`),
  ].join("");
  elements.buildFilter.innerHTML = [
    '<option value="all">All builds</option>',
    ...builds.map((build) => `<option value="${escapeHtml(build)}">${escapeHtml(build)}</option>`),
  ].join("");
}

function filteredTasks() {
  const tasks = state.dashboard?.tasks || [];
  const query = elements.searchInput.value.trim().toLowerCase();
  const stage = elements.stageFilter.value;
  const build = elements.buildFilter.value;

  return tasks.filter((task) => {
    const buildStatus = task.buildStatus || "None";
    const searchable = [
      task.id,
      task.projectName,
      task.stage,
      task.status || "",
      buildStatus,
      task.title || "",
    ]
      .join(" ")
      .toLowerCase();

    return (
      (!query || searchable.includes(query)) &&
      (stage === "all" || task.stage === stage) &&
      (build === "all" || buildStatus === build)
    );
  });
}

function renderTable() {
  const tasks = filteredTasks();

  elements.resultCount.textContent = `${tasks.length} visible tasks`;
  elements.dashboardNote.textContent = "Fetched from the connected Handshake session";
  elements.taskTable.innerHTML = tasks
    .map(
      (task) => `
        <tr>
          <td class="mono">${escapeHtml(task.id)}</td>
          <td>${escapeHtml(task.projectName || task.projectId || "")}</td>
          <td><span class="pill ${pillClass(task.stage)}">${escapeHtml(task.stage)}</span></td>
          <td>${escapeHtml(task.status || "None")}</td>
          <td><span class="pill ${pillClass(task.buildStatus || "None")}">${escapeHtml(
            task.buildStatus || "None"
          )}</span></td>
          <td>${escapeHtml(task.title || "")}</td>
        </tr>
      `
    )
    .join("");
}

function renderStageBars() {
  const summary = state.dashboard.summary || {};
  const entries = Object.entries(summary.stageCounts || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, count]) => count), 1);

  elements.stageTotal.textContent = `${summary.total || 0} tasks`;
  elements.stageBars.innerHTML = entries
    .map(([stage, count]) => {
      const width = Math.max(4, Math.round((count / max) * 100));

      return `
        <div class="bar-row">
          <span>${escapeHtml(stage)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <strong>${count}</strong>
        </div>
      `;
    })
    .join("");
}

function renderAttention() {
  const summary = state.dashboard.summary || {};
  const items = [
    ...(summary.failingTasks || []).map((task) => ({ label: "Failing build", task })),
    ...(summary.reviewTasks || []).slice(0, 8).map((task) => ({ label: "In review", task })),
  ];

  elements.attentionCount.textContent = `${items.length} highlighted`;
  elements.attentionList.innerHTML =
    items.length === 0
      ? '<div class="attention-item">No failing builds or review-pending tasks.</div>'
      : items
          .map(
            ({ label, task }) => `
              <div class="attention-item">
                <strong>${escapeHtml(label)}</strong>
                <span class="mono">${escapeHtml(task.id)}</span>
                <span>${escapeHtml(task.projectName || "")} · ${escapeHtml(task.stage)}</span>
              </div>
            `
          )
          .join("");
}

function renderDashboard() {
  elements.dashboard.hidden = false;
  elements.dashboardTitle.textContent = state.dashboard.project
    ? `${state.dashboard.project.name || "Project"} Tasks`
    : "Project Helix Tasks";
  elements.generatedAt.textContent = `Generated ${new Date(
    state.dashboard.generatedAt
  ).toLocaleString()}`;
  renderSummary();
  renderFilters();
  renderTable();
  renderStageBars();
  renderAttention();
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
    showMessage("Handshake login window opened. Finish logging in there, then save the session here.");
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
    showMessage("Handshake session saved for this browser session.");
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
  showMessage("Logged out locally.");
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

async function copyTaskIds(label, tasks) {
  const ids = tasks.map((task) => task.id);

  if (ids.length === 0) {
    showMessage(`No ${label} task IDs to copy.`, "error");
    return;
  }

  await writeClipboard(ids.join("\n"));
  showMessage(`Copied ${ids.length} ${label} task IDs.`);
}

function stageTasks(stage) {
  return (state.dashboard?.tasks || []).filter((task) => task.stage === stage);
}

elements.connectButton.addEventListener("click", startLogin);
elements.saveLoginButton.addEventListener("click", saveLogin);
elements.logoutButton.addEventListener("click", logout);
elements.fetchProjectButton.addEventListener("click", fetchProject);
elements.copyVisibleButton.addEventListener("click", () =>
  copyTaskIds("visible", filteredTasks())
);
elements.copyDeliveredButton.addEventListener("click", () =>
  copyTaskIds("delivered", stageTasks("Delivered"))
);
elements.copyReadyButton.addEventListener("click", () =>
  copyTaskIds("ready to deliver", stageTasks("Ready to Deliver"))
);
[elements.searchInput, elements.stageFilter, elements.buildFilter].forEach((control) => {
  control.addEventListener("input", renderTable);
});

loadStatus().catch((err) => showMessage(err.message, "error"));
