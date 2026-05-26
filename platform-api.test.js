const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PAGE_SIZE,
  buildTrpcUrl,
  fetchAllTasks,
  normalizeProjectInput,
  normalizeTask,
} = require("./platform-api");

const PROJECT_URL =
  "https://ai.joinhandshake.com/fellow/projects/past/26a53071-8843-4138-97df-430bd3e4cd45";
const STORAGE = { cookies: [{ name: "s", value: "1", domain: "ai.joinhandshake.com", path: "/" }] };

function tasksPayload(ids) {
  const activeTasks = ids.map((id) => ({ id }));
  return [{ result: { data: { json: { activeTasks, pastTasks: [] } } } }];
}

function mockFetchPage(pagesByOffset) {
  return async (_projectUrl, _storageState, _limit, offset) => {
    if (Object.hasOwn(pagesByOffset, offset)) return pagesByOffset[offset];
    const err = new Error("Tasks API failed with status 500.");
    throw err;
  };
}

test("normalizeProjectInput accepts project IDs and project URLs", () => {
  assert.deepEqual(
    normalizeProjectInput("26a53071-8843-4138-97df-430bd3e4cd45"),
    {
      projectId: "26a53071-8843-4138-97df-430bd3e4cd45",
      projectUrl:
        "https://ai.joinhandshake.com/fellow/projects/past/26a53071-8843-4138-97df-430bd3e4cd45",
    }
  );
  assert.deepEqual(
    normalizeProjectInput(
      "https://ai.joinhandshake.com/fellow/projects/active/a1c6c53b-cfad-414e-bad6-c9a68f7ee902"
    ),
    {
      projectId: "a1c6c53b-cfad-414e-bad6-c9a68f7ee902",
      projectUrl:
        "https://ai.joinhandshake.com/fellow/projects/active/a1c6c53b-cfad-414e-bad6-c9a68f7ee902",
    }
  );
});

test("buildTrpcUrl encodes batched tRPC input", () => {
  const url = new URL(
    buildTrpcUrl("annotationProject.listByProfileId", {
      profileId: "profile-1",
    })
  );

  assert.equal(url.pathname, "/api/trpc/annotationProject.listByProfileId");
  assert.equal(url.searchParams.get("batch"), "1");
  assert.deepEqual(JSON.parse(url.searchParams.get("input")), {
    "0": { json: { profileId: "profile-1" } },
  });
});

test("PAGE_SIZE defaults to 10", () => {
  assert.equal(PAGE_SIZE, 10);
});

test("fetchAllTasks stops after a short page without another request", async () => {
  const calls = [];
  const fetchPage = async (...args) => {
    calls.push(args[3]);
    return tasksPayload(["a", "b", "c", "d", "e"]);
  };

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
  });

  assert.equal(tasks.length, 5);
  assert.deepEqual(calls, [0]);
});

test("fetchAllTasks pages until a partial last page", async () => {
  const calls = [];
  const fetchPage = async (...args) => {
    const offset = args[3];
    calls.push(offset);
    if (offset === 0) return tasksPayload(Array.from({ length: 10 }, (_, i) => `t${i}`));
    return tasksPayload(["t10", "t11", "t12"]);
  };

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
  });

  assert.equal(tasks.length, 13);
  assert.deepEqual(calls, [0, 10]);
});

test("fetchAllTasks retries 500 on a full next page and returns all tasks", async () => {
  const calls = [];
  const failuresAtOffset10 = { count: 0 };
  const fetchPage = async (...args) => {
    const offset = args[3];
    calls.push(offset);
    if (offset === 0) {
      return tasksPayload(Array.from({ length: 10 }, (_, i) => `t${i}`));
    }
    if (offset === 10) {
      failuresAtOffset10.count += 1;
      if (failuresAtOffset10.count < 3) {
        throw new Error("Tasks API failed with status 500.");
      }
      return tasksPayload(Array.from({ length: 8 }, (_, i) => `t${i + 10}`));
    }
    throw new Error(`unexpected offset ${offset}`);
  };

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    retryDelays: [0, 0],
  });

  assert.equal(tasks.length, 18);
  assert.equal(failuresAtOffset10.count, 3);
  assert.deepEqual(
    calls.filter((offset) => offset === 10).length,
    3
  );
});

test("fetchAllTasks treats 500 past the true end after retries and empty probe", async () => {
  const calls = [];
  const fetchPage = async (...args) => {
    const offset = args[3];
    calls.push(offset);
    if (offset === 0) return tasksPayload(Array.from({ length: 10 }, (_, i) => `t${i}`));
    if (offset === 20) return tasksPayload([]);
    throw new Error("Tasks API failed with status 500.");
  };

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    retryDelays: [0, 0],
  });

  assert.equal(tasks.length, 10);
  assert.ok(calls.filter((offset) => offset === 10).length >= 3);
  assert.ok(calls.includes(20));
});

// Known limitation: if offset N permanently 500s while more tasks exist at N,
// probing offset N+pageSize may also be empty (e.g. 18 tasks, page 2 stuck, probe 20 empty).
test("fetchAllTasks may truncate when a middle page permanently 500s", async () => {
  const fetchPage = mockFetchPage({
    0: tasksPayload(Array.from({ length: 10 }, (_, i) => `t${i}`)),
    20: tasksPayload([]),
  });

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    retryDelays: [0, 0],
  });

  assert.equal(tasks.length, 10);
});

test("fetchAllTasks rethrows 500 on the first page", async () => {
  const fetchPage = async () => {
    throw new Error("Tasks API failed with status 500.");
  };

  await assert.rejects(
    () => fetchAllTasks(PROJECT_URL, STORAGE, { pageSize: 10, fetchPage }),
    /status 500/
  );
});

test("normalizeTask extracts stage, title, and updatedAt", () => {
  const task = normalizeTask(
    {
      id: "t-1",
      pipelineStage: { name: "Delivered", enteredAt: "2026-05-22T10:00:00Z" },
      buildStatus: "passing",
      data: { task_title: "Finish thing" },
    },
    { id: "p-1", name: "Project H" }
  );

  assert.deepEqual(task, {
    id: "t-1",
    projectId: "p-1",
    projectName: "Project H",
    stage: "Delivered",
    buildStatus: "passing",
    title: "Finish thing",
    updatedAt: "2026-05-22T10:00:00Z",
  });
});
