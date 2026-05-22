function normalizeTask(task) {
  return {
    id: task.id,
    stage: task.stage || "No stage found",
    status: task.status || null,
    buildStatus: task.buildStatus || null,
    title: task.title || "",
  };
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) || "None";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function summarizeTasks(tasks, missingIds = [], extraIds = []) {
  const normalizedTasks = tasks.map(normalizeTask);
  const failingTasks = normalizedTasks.filter(
    (task) => task.buildStatus === "failing"
  );
  const reviewTasks = normalizedTasks.filter(
    (task) => task.status === "review_pending" || /^Review\b/.test(task.stage)
  );

  return {
    total: normalizedTasks.length,
    stageCounts: countBy(normalizedTasks, (task) => task.stage),
    statusCounts: countBy(normalizedTasks, (task) => task.status),
    buildCounts: countBy(normalizedTasks, (task) => task.buildStatus),
    failingCount: failingTasks.length,
    reviewCount: reviewTasks.length,
    missingCount: missingIds.length,
    extraCount: extraIds.length,
    failingTasks,
    reviewTasks,
  };
}

function filterTasks(tasks, filters = {}) {
  const query = (filters.query || "").trim().toLowerCase();
  const stage = filters.stage || "all";
  const buildStatus = filters.buildStatus || "all";

  return tasks.map(normalizeTask).filter((task) => {
    const matchesQuery =
      !query ||
      task.id.toLowerCase().includes(query) ||
      task.stage.toLowerCase().includes(query) ||
      task.title.toLowerCase().includes(query);
    const matchesStage = stage === "all" || task.stage === stage;
    const matchesBuild =
      buildStatus === "all" || (task.buildStatus || "None") === buildStatus;

    return matchesQuery && matchesStage && matchesBuild;
  });
}

module.exports = {
  filterTasks,
  summarizeTasks,
};
