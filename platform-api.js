const HANDSHAKE_ORIGIN = "https://ai.joinhandshake.com";
const DEFAULT_REFERER = `${HANDSHAKE_ORIGIN}/fellow/projects`;
const PAGE_SIZE = 10;
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

function pastProjectHistoryInput(projectId, profileId) {
  return { projectId, profileId };
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

function extractPastHistoryTasksFromJson(data) {
  if (!data) return [];
  if (Array.isArray(data.tasks)) return data.tasks;
  return [];
}

function extractPastHistoryTasks(apiPayload) {
  const entry = apiPayload?.[0];
  if (entry?.error) {
    throw new Error(
      entry.error?.json?.message || "Past project history returned an error."
    );
  }

  return extractPastHistoryTasksFromJson(entry?.result?.data?.json);
}

function isAuthError(err) {
  return /401|403|expired|not connected/i.test(err?.message || "");
}

function isPastProjectUrl(projectUrl) {
  return /\/fellow\/projects\/past\//i.test(projectUrl);
}

function historyRowToRawTask(row, projectId) {
  const id = row.taskId ?? row.id ?? row.task?.id;
  if (!id) return null;

  return {
    id,
    annotationProjectId: projectId,
    title: row.title || row.task?.title || "",
    pipelineStage: row.pipelineStage || row.task?.pipelineStage,
    buildStatus: row.buildStatus ?? row.task?.buildStatus ?? null,
    data: row.data || row.task?.data,
    lastWorkedAt: row.lastWorkedAt ?? row.last_worked_at,
    updatedAt: row.lastWorkedAt ?? row.last_worked_at ?? row.updatedAt,
  };
}

function mergeClaimedTasksWithPastHistory(claimedTasks, historyRows, projectId) {
  const byId = new Map();

  for (const task of claimedTasks) {
    if (task?.id) byId.set(task.id, task);
  }

  for (const row of historyRows) {
    const stub = historyRowToRawTask(row, projectId);
    if (!stub || byId.has(stub.id)) continue;
    byId.set(stub.id, stub);
  }

  return [...byId.values()];
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

async function fetchPastProjectTaskHistory(
  projectUrl,
  projectId,
  storageState,
  options = {}
) {
  const fetchProfileImpl = options.fetchProfile || fetchProfile;
  const fetchTrpcImpl = options.fetchTrpc || fetchTrpc;

  const profile = await fetchProfileImpl(storageState, options);
  const profileId = profile?.id;
  if (!profileId) {
    throw new Error("Could not resolve profile id for past project history.");
  }

  const data = await fetchTrpcImpl(
    "annotationProject.listPastProjectTaskHistoryForFellow",
    pastProjectHistoryInput(projectId, profileId),
    storageState,
    { ...options, referer: projectUrl }
  );

  return extractPastHistoryTasksFromJson(data);
}

async function fetchPastProjectTaskHistoryBestEffort(
  projectUrl,
  projectId,
  storageState,
  options = {}
) {
  try {
    const rows = await fetchPastProjectTaskHistory(
      projectUrl,
      projectId,
      storageState,
      options
    );
    return { rows, warning: null };
  } catch (err) {
    if (isAuthError(err)) throw err;
    console.warn(`[past-history] ${err.message}`);
    return {
      rows: [],
      warning:
        "Could not load extra past-project task history. Showing tasks from the main list only.",
    };
  }
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
    title: data.task_title || data.pr_title || task.title || "",
    updatedAt: pickFirstIsoLike([
      task.statusUpdatedAt,
      task.status_updated_at,
      task.lastStatusChangeAt,
      task.lastActionAt,
      task.last_action_at,
      task.lastWorkedAt,
      task.last_worked_at,
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

function isTasksPage500(err) {
  return /status 500/.test(err?.message || "");
}

const TASKS_PAGE_RETRY_ATTEMPTS = 3;
const TASKS_PAGE_RETRY_DELAYS_MS = [50, 150, 300];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTasksPageWithRetries(
  fetchPage,
  projectUrl,
  storageState,
  limit,
  offset,
  retryDelays
) {
  let lastError;
  for (let attempt = 0; attempt < TASKS_PAGE_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetchPage(projectUrl, storageState, limit, offset);
    } catch (err) {
      lastError = err;
      if (!isTasksPage500(err)) throw err;
      if (attempt < TASKS_PAGE_RETRY_ATTEMPTS - 1) {
        await delay(retryDelays[attempt] ?? 300);
      }
    }
  }
  throw lastError;
}

async function fetchPageAdaptive(
  fetchPage,
  extractPage,
  projectUrl,
  storageState,
  offset,
  preferredLimit,
  retryDelays
) {
  let limit = preferredLimit;

  while (limit >= 1) {
    try {
      const payload = await fetchTasksPageWithRetries(
        fetchPage,
        projectUrl,
        storageState,
        limit,
        offset,
        retryDelays
      );
      const tasks = extractPage(payload);
      return { tasks, limitUsed: limit };
    } catch (err) {
      if (!isTasksPage500(err)) throw err;
      if (limit === 1) {
        if (offset === 0) throw err;
        return { tasks: [], limitUsed: 0 };
      }
      const halved = Math.floor(limit / 2);
      limit = halved >= 1 ? halved : 1;
    }
  }

  if (offset === 0) {
    throw new Error("Tasks API failed with status 500.");
  }
  return { tasks: [], limitUsed: 0 };
}

async function fetchAllPaginated(
  projectUrl,
  storageState,
  { pageSize, fetchPage, extractPage, retryDelays }
) {
  const tasks = [];
  let offset = 0;
  let preferredLimit = pageSize;
  const maxPages = 5000;
  let finished = false;

  for (let page = 0; page < maxPages; page += 1) {
    const { tasks: pageTasks, limitUsed } = await fetchPageAdaptive(
      fetchPage,
      extractPage,
      projectUrl,
      storageState,
      offset,
      preferredLimit,
      retryDelays
    );

    if (pageTasks.length === 0) {
      finished = true;
      break;
    }

    tasks.push(...pageTasks);
    offset += pageTasks.length;

    if (pageTasks.length < limitUsed) {
      finished = true;
      break;
    }

    // After a halved page succeeds, keep using that smaller limit. The API 500s when
    // offset+limit extends past the last task; jumping back to pageSize skips rows.
    if (limitUsed > 0 && limitUsed < pageSize) {
      preferredLimit = limitUsed;
    } else if (pageTasks.length === pageSize && limitUsed === pageSize) {
      preferredLimit = pageSize;
    }
  }

  if (!finished) {
    throw new Error("Task pagination exceeded safe page limit.");
  }

  return tasks;
}

async function fetchAllTasks(projectInput, storageState, options = {}) {
  const { projectUrl } = normalizeProjectInput(projectInput);
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const fetchPage = options.fetchPage || fetchTasksPage;
  const retryDelays = options.retryDelays ?? TASKS_PAGE_RETRY_DELAYS_MS;

  return fetchAllPaginated(projectUrl, storageState, {
    pageSize,
    fetchPage,
    extractPage: extractTasks,
    retryDelays,
  });
}

async function fetchDashboardForProject(projectInput, storageState, options = {}) {
  const { projectUrl, projectId } = normalizeProjectInput(projectInput);
  const project = options.project || {
    id: projectId,
    name: "Project",
  };

  let tasks = await fetchAllTasks(projectInput, storageState, options);
  let historyWarning = null;

  if (isPastProjectUrl(projectUrl)) {
    const { rows: historyRows, warning } = await fetchPastProjectTaskHistoryBestEffort(
      projectUrl,
      projectId,
      storageState,
      options
    );
    historyWarning = warning;
    if (historyRows.length > 0) {
      tasks = mergeClaimedTasksWithPastHistory(tasks, historyRows, projectId);
    }
  }

  const normalizedTasks = tasks.map((task) => normalizeTask(task, project));

  return {
    generatedAt: new Date().toISOString(),
    project,
    tasks: normalizedTasks,
    summary: { total: normalizedTasks.length },
    ...(historyWarning ? { historyWarning } : {}),
  };
}

module.exports = {
  PAGE_SIZE,
  buildTrpcUrl,
  extractPastHistoryTasks,
  extractPastHistoryTasksFromJson,
  extractTasks,
  fetchAllTasks,
  fetchDashboardForProject,
  fetchPastProjectTaskHistory,
  fetchProfile,
  isPastProjectUrl,
  mergeClaimedTasksWithPastHistory,
  normalizeProjectInput,
  normalizeTask,
  pastProjectHistoryInput,
};
