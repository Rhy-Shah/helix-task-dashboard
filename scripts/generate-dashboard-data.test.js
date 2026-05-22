const assert = require("node:assert/strict");
const test = require("node:test");

const { buildDashboardData } = require("./generate-dashboard-data");

test("buildDashboardData combines fetched tasks, comparisons, and summary", () => {
  const data = buildDashboardData();

  assert.equal(data.tasks.length, 80);
  assert.equal(data.ids.length, 80);
  assert.equal(data.extraIds.length, 24);
  assert.equal(data.missingGivenIds.length, 11);
  assert.equal(data.summary.total, 80);
  assert.equal(data.summary.failingCount, 1);
});
