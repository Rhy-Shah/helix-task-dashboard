const HANDSHAKE_ORIGIN = "https://ai.joinhandshake.com";
const DEFAULT_REFERER = `${HANDSHAKE_ORIGIN}/fellow/projects`;
const PAGE_SIZE = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getProjectId(projectUrl) {
  const url = new URL(projectUrl);
  const taskPageMatch = url.pathname.match(/^\/fellow\/([^/]+)\/tasks\/?$/i);
  const projectPageMatch = url.pathname.match(
    /^\/fellow\/projects\/(?:active|past)\/([^/]+)\/?$/i
  );
  const match = taskPageMatch || projectPageMatch;

  if (!match) {
    throw new Error("Invalid project URL.");
  }

  return match[1];
}

function normalizeProjectInput(value) {
  const input = String(value || "").trim();

  if (!input) {
    throw new Error("Enter a project URL or project ID.");
  }

  if (UUID_PATTERN.test(input)) {
    return {
      projectId: input,
      projectUrl: `${HANDSHAKE_ORIGIN}/fellow/projects/past/${input}`,
    };
  }

  return {
    projectId: getProjectId(input),
    projectUrl: input,
  };
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
      const cookiePath = cookie.path || "/";
      return (
        domainMatches(url.hostname, cookie.domain || "") &&
        url.pathname.startsWith(cookiePath)
      );
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function buildTrpcUrl(procedure, input) {
  const url = new URL(`/api/trpc/${procedure}`, HANDSHAKE_ORIGIN);
  url.searchParams.set("batch", "1");
  if (input !== undefined) {
    url.searchParams.set("input", JSON.stringify({ "0": { json: input } }));
  }
  return url.toString();
}

function buildTasksUrl(projectUrl, projectId, limit, offset) {
  const baseUrl = new URL(
    "/api/trpc/task.listClaimedTasksForFellow",
    projectUrl
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

function extractTrpcJson(payload, procedure) {
  const entry = payload?.[0];
  if (entry?.error) {
    throw new Error(
      entry.error?.json?.message || `${procedure} returned an error.`
    );
  }
  return entry?.result?.data?.json;
}

function extractTasks(apiPayload) {
  const data = apiPayload?.[0]?.result?.data?.json;
  if (!data || (!Array.isArray(data.activeTasks) && !Array.isArray(data.pastTasks))) {
    throw new Error("Unexpected tasks response shape.");
  }
  return [
    ...(Array.isArray(data.activeTasks) ? data.activeTasks : []),
    ...(Array.isArray(data.pastTasks) ? data.pastTasks : []),
  ];
}

async function fetchTrpc(procedure, input, storageState, options = {}) {
  const url = buildTrpcUrl(procedure, input);
  const cookieHeader = createCookieHeader(storageState, url);

  if (!cookieHeader) {
    throw new Error("Session is not connected.");
  }

  const fetchImpl = options.fetch || fetch;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 600;
  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  let response;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Cookie: cookieHeader,
        Referer: options.referer || DEFAULT_REFERER,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
      },
    });

    const transient =
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504;
    if (transient && attempt < maxAttempts) {
      await sleep(retryDelayMs * attempt);
      continue;
    }
    break;
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Login expired. Sign in again.");
  }
  if (response.status >= 502 && response.status <= 504) {
    throw new Error(
      `Service is temporarily unavailable (${response.status}). Try again in a moment.`
    );
  }
  if (!response.ok) {
    throw new Error(`${procedure} failed with status ${response.status}.`);
  }

  return extractTrpcJson(await response.json(), procedure);
}

async function fetchTasksPage(projectUrl, storageState, limit, offset) {
  const projectId = getProjectId(projectUrl);
  const apiUrl = buildTasksUrl(projectUrl, projectId, limit, offset);
  const cookieHeader = createCookieHeader(storageState, apiUrl);

  if (!cookieHeader) {
    throw new Error("Session is not connected.");
  }

  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Cookie: cookieHeader,
      Referer: projectUrl,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Login expired. Sign in again.");
  }
  if (!response.ok) {
    throw new Error(`Tasks API failed with status ${response.status}.`);
  }

  return response.json();
}

function pickFirstIsoLike(values) {
  for (const value of values) {
    if (typeof value === "string" && value.length >= 8) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.toISOString();
  }
  return null;
}

function normalizeTask(task, project = {}) {
  const data = task.data || {};
  const stage = task.$related?.pipelineStage || task.pipelineStage || {};

  return {
    id: task.id,
    projectId: project.id || task.annotationProjectId || "",
    projectName: project.name || "",
    stage:
      task.$related?.pipelineStage?.name ||
      task.pipelineStage?.name ||
      "No stage found",
    buildStatus: task.buildStatus ?? null,
    title: data.task_title || task.title || "",
    updatedAt: pickFirstIsoLike([
      task.statusUpdatedAt,
      task.status_updated_at,
      task.lastStatusChangeAt,
      task.lastActionAt,
      task.last_action_at,
      task.updatedAt,
      task.updated_at,
      task.modifiedAt,
      task.lastModifiedAt,
      stage.enteredAt,
      stage.updated_at,
      data.status_updated_at,
      data.updated_at,
    ]),
  };
}

async function fetchProfile(storageState, options = {}) {
  const data = await fetchTrpc("profile.getSelf", undefined, storageState, options);
  return data.profile;
}

async function fetchAllTasks(projectInput, storageState, options = {}) {
  const { projectUrl } = normalizeProjectInput(projectInput);
  const pageSize = options.pageSize || PAGE_SIZE;
  const fetchPage = options.fetchPage || fetchTasksPage;
  const tasks = [];

  for (let offset = 0; ; offset += pageSize) {
    let payload;
    try {
      payload = await fetchPage(projectUrl, storageState, pageSize, offset);
    } catch (err) {
      // Handshake returns 500 on the empty page past the last result. If the
      // next page also has zero tasks, treat the 500 as end-of-results.
      if (offset === 0 || !err.message.includes("status 500")) throw err;
      const nextPayload = await fetchPage(
        projectUrl,
        storageState,
        pageSize,
        offset + pageSize
      );
      if (extractTasks(nextPayload).length === 0) break;
      throw err;
    }

    const pageTasks = extractTasks(payload);
    tasks.push(...pageTasks);
    if (pageTasks.length < pageSize) break;
  }

  return tasks;
}

async function fetchDashboardForProject(projectInput, storageState, options = {}) {
  const tasks = await fetchAllTasks(projectInput, storageState, options);
  const project = options.project || {
    id: normalizeProjectInput(projectInput).projectId,
    name: "Project",
  };
  const normalizedTasks = tasks.map((task) => normalizeTask(task, project));

  return {
    generatedAt: new Date().toISOString(),
    project,
    ids: normalizedTasks.map((task) => task.id),
    tasks: normalizedTasks,
    summary: { total: normalizedTasks.length },
  };
}

module.exports = {
  HANDSHAKE_ORIGIN,
  PAGE_SIZE,
  buildTrpcUrl,
  fetchDashboardForProject,
  fetchProfile,
  normalizeProjectInput,
  normalizeTask,
};
