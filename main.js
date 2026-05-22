const fs = require("fs");
const readline = require("readline/promises");

const CONFIG_PATH = "config.json";
const AUTH_STATE_PATH = "auth.json";
const TASK_IDS_PATH = "task-ids.txt";
const PAGE_SIZE = 20;
const TASK_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function loadProjectTasksUrl() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Create ${CONFIG_PATH} with your Handshake tasks URL, for example: ` +
        `{"projectTasksUrl":"https://ai.joinhandshake.com/fellow/YOUR_PROJECT_ID/tasks"}`
    );
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const projectTasksUrl = config.projectTasksUrl?.trim();

  if (!projectTasksUrl) {
    throw new Error(`Add projectTasksUrl to ${CONFIG_PATH}.`);
  }

  return projectTasksUrl;
}

function getProjectId(projectTasksUrl) {
  const url = new URL(projectTasksUrl);
  const taskPageMatch = url.pathname.match(/^\/fellow\/([^/]+)\/tasks\/?$/i);
  const projectPageMatch = url.pathname.match(
    /^\/fellow\/projects\/(?:active|past)\/([^/]+)\/?$/i
  );
  const match = taskPageMatch || projectPageMatch;

  if (!match) {
    throw new Error(
      "PROJECT_TASKS_URL must be a Handshake project tasks URL or project page URL."
    );
  }

  return match[1];
}

function buildMyTasksUrl(projectTasksUrl, projectId, limit, offset) {
  const baseUrl = new URL(
    "/api/trpc/task.listClaimedTasksForFellow",
    projectTasksUrl
  );
  const input = {
    "0": {
      json: {
        annotationProjectId: projectId,
        pipelineStageId: null,
        statuses: null,
        attempters: null,
        search: null,
        limit,
        offset,
        sortBy: "taskId",
        sortOrder: "desc",
        removeSkipped: true,
        statusFilter: "all",
        categories: null,
        priorityLevel: null,
      },
      meta: {
        values: {
          pipelineStageId: ["undefined"],
          statuses: ["undefined"],
          attempters: ["undefined"],
          search: ["undefined"],
          categories: ["undefined"],
          priorityLevel: ["undefined"],
        },
        v: 1,
      },
    },
  };

  baseUrl.searchParams.set("batch", "1");
  baseUrl.searchParams.set("input", JSON.stringify(input));

  return baseUrl.toString();
}

function domainMatches(hostname, cookieDomain) {
  const domain = cookieDomain.startsWith(".")
    ? cookieDomain.slice(1)
    : cookieDomain;

  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function createCookieHeader(storageState, targetUrl) {
  const url = new URL(targetUrl);

  return (storageState.cookies || [])
    .filter((cookie) => {
      const path = cookie.path || "/";

      return (
        domainMatches(url.hostname, cookie.domain || "") &&
        url.pathname.startsWith(path)
      );
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function getCookieValue(storageState, name, targetUrl) {
  const url = new URL(targetUrl);
  const cookie = (storageState.cookies || []).find((item) => {
    const path = item.path || "/";

    return (
      item.name === name &&
      domainMatches(url.hostname, item.domain || "") &&
      url.pathname.startsWith(path)
    );
  });

  return cookie?.value || "";
}

function extractTasks(apiPayload) {
  const data = apiPayload?.[0]?.result?.data?.json;
  const tasks = [
    ...(Array.isArray(data?.activeTasks) ? data.activeTasks : []),
    ...(Array.isArray(data?.pastTasks) ? data.pastTasks : []),
  ];

  if (!data || (!Array.isArray(data.activeTasks) && !Array.isArray(data.pastTasks))) {
    throw new Error(
      "API response did not include 0.result.data.json.activeTasks/pastTasks."
    );
  }

  return tasks;
}

function extractTaskStages(apiPayload) {
  return extractTasks(apiPayload).map((task) => ({
    id: task.id,
    stage:
      task.$related?.pipelineStage?.name ||
      task.pipelineStage?.name ||
      "No stage found",
  }));
}

function parseTaskIds(text) {
  const seen = new Set();
  const ids = [];
  const matches = text.match(TASK_ID_PATTERN) || [];

  for (const match of matches) {
    const id = match.toLowerCase();

    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

function loadTaskIds() {
  if (!fs.existsSync(TASK_IDS_PATH)) {
    return [];
  }

  const ids = parseTaskIds(fs.readFileSync(TASK_IDS_PATH, "utf8"));

  if (ids.length === 0) {
    throw new Error(`${TASK_IDS_PATH} exists but does not contain any task IDs.`);
  }

  return ids;
}

function filterTaskStagesByTaskIds(results, taskIds) {
  const resultsById = new Map(results.map((result) => [result.id.toLowerCase(), result]));

  return taskIds.map((id) => {
    const result = resultsById.get(id.toLowerCase());

    return result || { id, stage: "Not found in My tasks" };
  });
}

async function fetchTasksPage(projectTasksUrl, storageState, limit, offset) {
  const projectId = getProjectId(projectTasksUrl);
  const apiUrl = buildMyTasksUrl(projectTasksUrl, projectId, limit, offset);
  const cookieHeader = createCookieHeader(storageState, apiUrl);

  if (!cookieHeader) {
    throw new Error(`No matching cookies found in ${AUTH_STATE_PATH} for ${apiUrl}.`);
  }

  const csrfToken =
    getCookieValue(storageState, "XSRF-TOKEN", apiUrl) ||
    getCookieValue(storageState, "csrf-token", apiUrl) ||
    getCookieValue(storageState, "_csrf_token", apiUrl);
  const headers = {
    Accept: "application/json, text/plain, */*",
    Cookie: cookieHeader,
    Referer: projectTasksUrl,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
  };

  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
    headers["X-XSRF-TOKEN"] = csrfToken;
  }

  const response = await fetch(apiUrl, { headers });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Handshake API auth failed with status ${response.status}. Refresh ${AUTH_STATE_PATH}.`
    );
  }

  if (!response.ok) {
    throw new Error(`Handshake API failed with status ${response.status}.`);
  }

  return response.json();
}

async function fetchAllTaskStages(
  projectTasksUrl,
  storageState,
  pageSize = PAGE_SIZE,
  fetchPage = fetchTasksPage
) {
  const results = [];

  for (let offset = 0; ; offset += pageSize) {
    let payload;

    try {
      payload = await fetchPage(projectTasksUrl, storageState, pageSize, offset);
    } catch (err) {
      if (offset === 0 || !err.message.includes("status 500")) {
        throw err;
      }

      const nextPayload = await fetchPage(
        projectTasksUrl,
        storageState,
        pageSize,
        offset + pageSize
      );
      const nextTasks = extractTasks(nextPayload);

      if (nextTasks.length === 0) {
        break;
      }

      throw err;
    }

    const tasks = extractTasks(payload);

    results.push(...extractTaskStages(payload));

    if (tasks.length < pageSize) {
      break;
    }
  }

  return results;
}

function renderStageSummary(results, previousResults) {
  console.log("\n=== Stage Summary ===");

  const stages = [
    "Attempt",
    "Eval Stage 1",
    "Review 1",
    "BPO Holding",
    "Pending Pass@",
    "Submitted for Pass@",
    "CL AYDEN",
    "Pass@0",
    "Internal Audit",
    "Ready to Deliver",
    "Delivered",
  ];

  stages.forEach((stage, index) => {
    const current = results.filter((result) => result.stage === stage).length;
    const previous = previousResults.filter((result) => result.stage === stage).length;
    const change = current - previous;
    const changeStr =
      change > 0 ? `(+${change})` : change < 0 ? `(${change})` : "(0)";

    console.log(`${index + 1} - ${stage}: ${current} ${changeStr}`);
  });
}

function readPreviousResults() {
  try {
    if (fs.existsSync("stages.json")) {
      return JSON.parse(fs.readFileSync("stages.json", "utf8"));
    }
  } catch {
    console.log("Could not load previous results for comparison");
  }

  return [];
}

async function waitForEnter(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    await rl.question(message);
  } finally {
    rl.close();
  }
}

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    throw new Error(
      `${AUTH_STATE_PATH} is missing and Playwright is not installed. ` +
        "Run: npm install playwright && npx playwright install chromium"
    );
  }
}

async function createAuthState(projectTasksUrl) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: false });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`${AUTH_STATE_PATH} not found. Opening browser login...`);
    await page.goto(projectTasksUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await waitForEnter(
      "Log in with Handshake in the browser, then press Enter here to save auth..."
    );

    await context.storageState({ path: AUTH_STATE_PATH });
    console.log(`Saved auth to ${AUTH_STATE_PATH}`);

    return JSON.parse(fs.readFileSync(AUTH_STATE_PATH, "utf8"));
  } finally {
    await browser.close();
  }
}

async function loadOrCreateAuthState(projectTasksUrl) {
  if (fs.existsSync(AUTH_STATE_PATH)) {
    return JSON.parse(fs.readFileSync(AUTH_STATE_PATH, "utf8"));
  }

  return createAuthState(projectTasksUrl);
}

async function main() {
  const projectTasksUrl = loadProjectTasksUrl();

  const storageState = await loadOrCreateAuthState(projectTasksUrl);

  console.log("Fetching My tasks from Handshake API...");
  const requestedTaskIds = loadTaskIds();
  const fetchedResults = await fetchAllTaskStages(projectTasksUrl, storageState);
  const results =
    requestedTaskIds.length > 0
      ? filterTaskStagesByTaskIds(fetchedResults, requestedTaskIds)
      : fetchedResults;
  const ids = results.map((result) => result.id);

  if (requestedTaskIds.length > 0) {
    console.log(`Using ${requestedTaskIds.length} task IDs from ${TASK_IDS_PATH}`);
  }

  console.log(`Found ${ids.length} IDs`);
  fs.writeFileSync("ids.json", JSON.stringify(ids, null, 2));
  console.log("Saved IDs to ids.json\n");

  console.table(results);
  renderStageSummary(results, readPreviousResults());

  fs.writeFileSync("stages.json", JSON.stringify(results, null, 2));
  console.log("\nSaved results to stages.json");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  PAGE_SIZE,
  buildMyTasksUrl,
  createCookieHeader,
  extractTasks,
  extractTaskStages,
  fetchAllTaskStages,
  fetchTasksPage,
  filterTaskStagesByTaskIds,
  getProjectId,
  parseTaskIds,
};
