const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildTrpcUrl,
  normalizeProjectInput,
  normalizeTask,
} = require("./platform-api");

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
