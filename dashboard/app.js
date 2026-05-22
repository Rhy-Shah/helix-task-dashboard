(function () {
  const data = window.TASK_DASHBOARD_DATA;
  const tasks = data.tasks || [];
  const summary = data.summary || {};

  const searchInput = document.querySelector("#search-input");
  const stageFilter = document.querySelector("#stage-filter");
  const buildFilter = document.querySelector("#build-filter");
  const taskTable = document.querySelector("#task-table");
  const resultCount = document.querySelector("#result-count");
  const filterCopy = document.querySelector("#active-filter-copy");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function unique(values) {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
  }

  function pillClass(value) {
    if (value === "failing") return "red";
    if (value === "passing") return "green";
    if (/Review|Submitted|Ready/.test(value)) return "blue";
    if (/Internal|CL AYDEN|Pass@n/.test(value)) return "amber";
    return "green";
  }

  function renderSummary() {
    const cards = [
      ["Total Tasks", summary.total],
      ["Extra IDs", summary.extraCount],
      ["Missing IDs", summary.missingCount],
      ["Review Queue", summary.reviewCount],
      ["Failing Builds", summary.failingCount],
    ];

    document.querySelector("#summary-grid").innerHTML = cards
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
    const stages = unique(tasks.map((task) => task.stage || "No stage found"));
    const builds = unique(tasks.map((task) => task.buildStatus || "None"));

    stageFilter.innerHTML = [
      '<option value="all">All stages</option>',
      ...stages.map((stage) => `<option value="${escapeHtml(stage)}">${escapeHtml(stage)}</option>`),
    ].join("");
    buildFilter.innerHTML = [
      '<option value="all">All builds</option>',
      ...builds.map((build) => `<option value="${escapeHtml(build)}">${escapeHtml(build)}</option>`),
    ].join("");
  }

  function filterTasks() {
    const query = searchInput.value.trim().toLowerCase();
    const stage = stageFilter.value;
    const build = buildFilter.value;

    return tasks.filter((task) => {
      const title = task.title || "";
      const buildStatus = task.buildStatus || "None";
      const matchesQuery =
        !query ||
        task.id.toLowerCase().includes(query) ||
        task.stage.toLowerCase().includes(query) ||
        title.toLowerCase().includes(query);
      const matchesStage = stage === "all" || task.stage === stage;
      const matchesBuild = build === "all" || buildStatus === build;

      return matchesQuery && matchesStage && matchesBuild;
    });
  }

  function renderTable() {
    const filtered = filterTasks();

    resultCount.textContent = `${filtered.length} visible tasks`;
    filterCopy.textContent = searchInput.value.trim()
      ? `Filtered by "${searchInput.value.trim()}"`
      : "Showing current exported data";
    taskTable.innerHTML = filtered
      .map((task) => {
        const buildStatus = task.buildStatus || "None";
        const status = task.status || "None";

        return `
          <tr>
            <td class="mono">${escapeHtml(task.id)}</td>
            <td><span class="pill ${pillClass(task.stage)}">${escapeHtml(task.stage)}</span></td>
            <td>${escapeHtml(status)}</td>
            <td><span class="pill ${pillClass(buildStatus)}">${escapeHtml(buildStatus)}</span></td>
            <td>${escapeHtml(task.title || "")}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderStageBars() {
    const entries = Object.entries(summary.stageCounts || {}).sort((a, b) => b[1] - a[1]);
    const max = Math.max(...entries.map(([, count]) => count), 1);

    document.querySelector("#stage-total").textContent = `${summary.total || 0} tasks`;
    document.querySelector("#stage-bars").innerHTML = entries
      .map(([stage, count]) => {
        const width = Math.max(3, Math.round((count / max) * 100));

        return `
          <div class="bar-row">
            <span>${escapeHtml(stage)}</span>
            <div class="bar-track"><div class="bar-fill" style="width: ${width}%"></div></div>
            <strong>${count}</strong>
          </div>
        `;
      })
      .join("");
  }

  function renderAttention() {
    const failing = summary.failingTasks || [];
    const review = (summary.reviewTasks || []).slice(0, 5);
    const items = [
      ...failing.map((task) => ({ label: "Failing build", task })),
      ...review.map((task) => ({ label: "In review", task })),
    ];

    document.querySelector("#attention-count").textContent = `${items.length} highlighted`;
    document.querySelector("#attention-list").innerHTML =
      items.length === 0
        ? '<div class="attention-item">No failing builds or review-pending tasks.</div>'
        : items
            .map(
              ({ label, task }) => `
                <div class="attention-item">
                  <strong>${escapeHtml(label)}</strong>
                  <span class="mono">${escapeHtml(task.id)}</span>
                  <span>${escapeHtml(task.stage)}${task.buildStatus ? ` · ${escapeHtml(task.buildStatus)}` : ""}</span>
                </div>
              `
            )
            .join("");
  }

  function renderIdPanels() {
    document.querySelector("#extra-count").textContent = `${data.extraIds.length} IDs`;
    document.querySelector("#missing-count").textContent = `${data.missingGivenIds.length} IDs`;
    document.querySelector("#extra-ids").textContent = data.extraIds.join("\n");
    document.querySelector("#missing-ids").textContent = data.missingGivenIds.join("\n");
  }

  function boot() {
    document.querySelector("#generated-at").textContent = `Generated ${new Date(
      data.generatedAt
    ).toLocaleString()}`;
    renderSummary();
    renderFilters();
    renderTable();
    renderStageBars();
    renderAttention();
    renderIdPanels();

    [searchInput, stageFilter, buildFilter].forEach((control) => {
      control.addEventListener("input", renderTable);
    });
  }

  boot();
})();
