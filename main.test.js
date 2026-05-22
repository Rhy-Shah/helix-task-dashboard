const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PAGE_SIZE,
  fetchAllTaskStages,
  filterTaskStagesByTaskIds,
  getProjectId,
  parseTaskIds,
} = require("./main");

function tasksPayload(tasks) {
  return [
    {
      result: {
        data: {
          json: {
            activeTasks: [],
            pastTasks: tasks,
          },
        },
      },
    },
  ];
}

test("parseTaskIds extracts UUIDs from newline and comma separated text", () => {
  const ids = parseTaskIds(`
    ffc71421-5e33-4e48-850e-f91b4b1e0f3e,
    e344fe36-9162-4e92-8248-3d569c124531
    not-a-task-id
  `);

  assert.deepEqual(ids, [
    "ffc71421-5e33-4e48-850e-f91b4b1e0f3e",
    "e344fe36-9162-4e92-8248-3d569c124531",
  ]);
});

test("filterTaskStagesByTaskIds preserves input order and reports missing tasks", () => {
  const results = [
    { id: "e344fe36-9162-4e92-8248-3d569c124531", stage: "Review 1" },
    { id: "ffc71421-5e33-4e48-850e-f91b4b1e0f3e", stage: "Attempt" },
  ];
  const requestedIds = [
    "ffc71421-5e33-4e48-850e-f91b4b1e0f3e",
    "420562e4-8924-41fd-aaf4-fb200e27f9bb",
    "e344fe36-9162-4e92-8248-3d569c124531",
  ];

  assert.deepEqual(filterTaskStagesByTaskIds(results, requestedIds), [
    { id: "ffc71421-5e33-4e48-850e-f91b4b1e0f3e", stage: "Attempt" },
    {
      id: "420562e4-8924-41fd-aaf4-fb200e27f9bb",
      stage: "Not found in My tasks",
    },
    { id: "e344fe36-9162-4e92-8248-3d569c124531", stage: "Review 1" },
  ]);
});

test("getProjectId accepts a past project page URL", () => {
  assert.equal(
    getProjectId(
      "https://ai.joinhandshake.com/fellow/projects/past/26a53071-8843-4138-97df-430bd3e4cd45"
    ),
    "26a53071-8843-4138-97df-430bd3e4cd45"
  );
});

test("uses a Handshake API page size below the observed server error threshold", () => {
  assert.equal(PAGE_SIZE, 20);
});

test("fetchAllTaskStages treats a confirmed empty-page 500 as end of results", async () => {
  const fetchPage = async (_projectTasksUrl, _storageState, limit, offset) => {
    if (offset === 80) {
      throw new Error("Handshake API failed with status 500.");
    }

    if (offset === 100) {
      return tasksPayload([]);
    }

    return tasksPayload(
      Array.from({ length: limit }, (_, index) => ({
        id: `task-${offset + index}`,
        pipelineStage: { name: "Attempt" },
      }))
    );
  };

  const results = await fetchAllTaskStages("https://example.test", {}, 20, fetchPage);

  assert.equal(results.length, 80);
});
