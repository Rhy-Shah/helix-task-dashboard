const assert = require("node:assert/strict");
const test = require("node:test");

const { filterTasks, summarizeTasks } = require("./dashboard-core");

test("summarizeTasks returns totals and important task groups", () => {
  const summary = summarizeTasks(
    [
      {
        id: "task-1",
        stage: "Internal Audit",
        buildStatus: "failing",
        title: "Broken task",
      },
      {
        id: "task-2",
        stage: "Review 2",
        status: "review_pending",
        buildStatus: "passing",
      },
      {
        id: "task-3",
        stage: "Delivered",
        buildStatus: null,
      },
    ],
    ["missing-1"],
    ["extra-1", "extra-2"]
  );

  assert.equal(summary.total, 3);
  assert.equal(summary.stageCounts["Internal Audit"], 1);
  assert.equal(summary.stageCounts["Review 2"], 1);
  assert.equal(summary.failingCount, 1);
  assert.equal(summary.reviewCount, 1);
  assert.equal(summary.missingCount, 1);
  assert.equal(summary.extraCount, 2);
});

test("filterTasks searches ids, titles, stages and applies filters", () => {
  const tasks = [
    {
      id: "task-1",
      stage: "Internal Audit",
      buildStatus: "failing",
      title: "Broken task",
    },
    {
      id: "task-2",
      stage: "Delivered",
      buildStatus: "passing",
      title: "Done task",
    },
  ];

  assert.deepEqual(filterTasks(tasks, { query: "broken" }).map((task) => task.id), [
    "task-1",
  ]);
  assert.deepEqual(
    filterTasks(tasks, { stage: "Delivered", buildStatus: "passing" }).map(
      (task) => task.id
    ),
    ["task-2"]
  );
});
