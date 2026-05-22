const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDashboardPayload,
  buildTrpcUrl,
  normalizeProjectInput,
  normalizeProjectList,
} = require("./handshake-api");

test("normalizeProjectInput accepts project IDs and Handshake project URLs", () => {
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

test("normalizeProjectList merges active and past projects", () => {
  assert.deepEqual(
    normalizeProjectList(
      [{ id: "active-1", name: "Active", status: "active" }],
      [{ id: "past-1", name: "Past", status: "paused" }]
    ),
    [
      { id: "active-1", name: "Active", status: "active", source: "current" },
      { id: "past-1", name: "Past", status: "paused", source: "past" },
    ]
  );
});

test("buildDashboardPayload creates task summaries with project context", () => {
  const payload = buildDashboardPayload({
    project: { id: "project-1", name: "Project One" },
    tasks: [
      {
        id: "task-1",
        pipelineStage: { name: "Internal Audit" },
        buildStatus: "failing",
        data: { task_title: "Fix a thing" },
      },
    ],
  });

  assert.equal(payload.summary.total, 1);
  assert.equal(payload.summary.failingCount, 1);
  assert.deepEqual(payload.tasks[0], {
    id: "task-1",
    projectId: "project-1",
    projectName: "Project One",
    stage: "Internal Audit",
    status: null,
    buildStatus: "failing",
    title: "Fix a thing",
    updatedAt: null,
  });
});

test("normalizeTask extracts updatedAt from common shapes", () => {
  const { normalizeTask } = require("./handshake-api");

  const task = normalizeTask(
    {
      id: "t-1",
      pipelineStage: { name: "Delivered", enteredAt: "2026-05-22T10:00:00Z" },
      data: { task_title: "Hi" },
    },
    { id: "p-1", name: "P" }
  );

  assert.equal(task.updatedAt, "2026-05-22T10:00:00Z");
});
