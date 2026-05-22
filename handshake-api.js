const {
  PAGE_SIZE,
  buildMyTasksUrl,
  createCookieHeader,
  extractTasks,
  fetchTasksPage,
  getProjectId,
} = require("./main");
const { summarizeTasks } = require("./dashboard-core");

const HANDSHAKE_ORIGIN = "https://ai.joinhandshake.com";
const DEFAULT_REFERER = `${HANDSHAKE_ORIGIN}/fellow/projects`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildTrpcUrl(procedure, input) {
  const url = new URL(`/api/trpc/${procedure}`, HANDSHAKE_ORIGIN);

  url.searchParams.set("batch", "1");

  if (input !== undefined) {
    url.searchParams.set("input", JSON.stringify({ "0": { json: input } }));
  }

  return url.toString();
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

async function fetchTrpc(procedure, input, storageState, options = {}) {
  const url = buildTrpcUrl(procedure, input);
  const cookieHeader = createCookieHeader(storageState, url);

  if (!cookieHeader) {
    throw new Error("Handshake session is not connected.");
  }

  const response = await (options.fetch || fetch)(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Cookie: cookieHeader,
      Referer: options.referer || DEFAULT_REFERER,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Handshake login expired. Connect again.");
  }

  if (!response.ok) {
    throw new Error(`${procedure} failed with status ${response.status}.`);
  }

  return extractTrpcJson(await response.json(), procedure);
}

function normalizeProjectInput(value) {
  const input = String(value || "").trim();

  if (!input) {
    throw new Error("Enter a Handshake project URL or project ID.");
  }

  if (UUID_PATTERN.test(input)) {
    return {
      projectId: input,
      projectUrl: `${HANDSHAKE_ORIGIN}/fellow/projects/past/${input}`,
    };
  }

  const projectId = getProjectId(input);

  return {
    projectId,
    projectUrl: input,
  };
}

function normalizeProjectList(activeProjects = [], pastProjects = []) {
  const projects = [];
  const seen = new Set();

  for (const [source, list] of [
    ["current", activeProjects],
    ["past", pastProjects],
  ]) {
    for (const project of list) {
      if (!project?.id || seen.has(project.id)) {
        continue;
      }

      seen.add(project.id);
      projects.push({
        id: project.id,
        name: project.name || "Untitled project",
        status: project.status || "unknown",
        source,
      });
    }
  }

  return projects;
}

function pickFirst(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
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

  const submittedAt = pickFirstIsoLike([
    task.submittedAt,
    task.submitted_at,
    task.deliveredAt,
    task.delivered_at,
    task.completedAt,
    task.completed_at,
    task.finishedAt,
    data.submitted_at,
    data.submittedAt,
    data.delivered_at,
    data.deliveredAt,
    data.completed_at,
  ]);

  const updatedAt = pickFirstIsoLike([
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
  ]);

  return {
    id: task.id,
    projectId: project.id || task.annotationProjectId || "",
    projectName: project.name || "",
    stage:
      task.$related?.pipelineStage?.name ||
      task.pipelineStage?.name ||
      "No stage found",
    status: pickFirst([task.status, task.taskStatus, task.reviewStatus, task.state]),
    buildStatus: task.buildStatus ?? null,
    title: data.task_title || task.title || "",
    submittedAt,
    updatedAt,
  };
}

async function fetchProfile(storageState, options = {}) {
  const data = await fetchTrpc("profile.getSelf", undefined, storageState, options);

  return data.profile;
}

async function fetchProjects(storageState, options = {}) {
  const profile = await fetchProfile(storageState, options);
  const [currentData, pastData] = await Promise.all([
    fetchTrpc(
      "annotationProject.listByProfileId",
      { profileId: profile.id },
      storageState,
      options
    ),
    fetchTrpc(
      "annotationProject.listPastProjectsByProfileId",
      { profileId: profile.id },
      storageState,
      options
    ),
  ]);

  return {
    profile: {
      id: profile.id,
      name: profile.name || profile.fullName || "Handshake user",
    },
    projects: normalizeProjectList(
      currentData.annotationProjects || [],
      pastData.projects || []
    ),
  };
}

async function fetchAllTasksForProject(
  projectInput,
  storageState,
  options = {}
) {
  const { projectId, projectUrl } = normalizeProjectInput(projectInput);
  const pageSize = options.pageSize || PAGE_SIZE;
  const fetchPage = options.fetchPage || fetchTasksPage;
  const tasks = [];

  for (let offset = 0; ; offset += pageSize) {
    let payload;

    try {
      payload = await fetchPage(projectUrl, storageState, pageSize, offset);
    } catch (err) {
      if (offset === 0 || !err.message.includes("status 500")) {
        throw err;
      }

      const nextPayload = await fetchPage(
        projectUrl,
        storageState,
        pageSize,
        offset + pageSize
      );

      if (extractTasks(nextPayload).length === 0) {
        break;
      }

      throw err;
    }

    const pageTasks = extractTasks(payload);

    tasks.push(...pageTasks);

    if (pageTasks.length < pageSize) {
      break;
    }
  }

  return {
    projectId,
    projectUrl,
    tasks,
  };
}

function buildDashboardPayload({ project, tasks }) {
  const normalizedTasks = tasks.map((task) => normalizeTask(task, project));

  return {
    generatedAt: new Date().toISOString(),
    project,
    ids: normalizedTasks.map((task) => task.id),
    tasks: normalizedTasks,
    summary: summarizeTasks(normalizedTasks),
  };
}

async function fetchDashboardForProject(projectInput, storageState, options = {}) {
  const { projectId, tasks } = await fetchAllTasksForProject(
    projectInput,
    storageState,
    options
  );
  const project =
    options.project || {
      id: projectId,
      name: `Project ${projectId.slice(0, 8)}`,
    };

  if (process.env.DEBUG_TASKS === "1" && tasks[0]) {
    console.log("[DEBUG_TASKS] first raw task keys:", Object.keys(tasks[0]));
    console.log("[DEBUG_TASKS] first raw task json:");
    console.log(JSON.stringify(tasks[0], null, 2));
  }

  return buildDashboardPayload({ project, tasks });
}

async function fetchDashboardForAllProjects(storageState, options = {}) {
  const { profile, projects } = await fetchProjects(storageState, options);
  const taskGroups = [];
  const errors = [];

  for (const project of projects) {
    try {
      const result = await fetchAllTasksForProject(project.id, storageState, options);
      taskGroups.push({ project, tasks: result.tasks });
    } catch (err) {
      errors.push({ project, message: err.message });
    }
  }

  const tasks = taskGroups.flatMap(({ project, tasks: projectTasks }) =>
    projectTasks.map((task) => normalizeTask(task, project))
  );
  const uniqueTasks = [];
  const seen = new Set();

  for (const task of tasks) {
    const key = `${task.projectId}:${task.id}`;

    if (!seen.has(key)) {
      seen.add(key);
      uniqueTasks.push(task);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    profile,
    projects,
    errors,
    ids: uniqueTasks.map((task) => task.id),
    tasks: uniqueTasks,
    summary: summarizeTasks(uniqueTasks),
  };
}

module.exports = {
  HANDSHAKE_ORIGIN,
  buildDashboardPayload,
  buildTrpcUrl,
  fetchDashboardForAllProjects,
  fetchDashboardForProject,
  fetchProfile,
  fetchProjects,
  normalizeProjectInput,
  normalizeProjectList,
  normalizeTask,
};
