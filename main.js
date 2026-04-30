const { chromium } = require("playwright");
const fs = require("fs");

const PROJECT_TASKS_URL =
  "";

function parseStage(text) {
  return text.match(/Stage:\s*([^\n]+)/)?.[1]?.trim() || "No stage found";
}

function renderProgress(current, total, label = "Progress") {
  const width = 30;
  const ratio = total === 0 ? 1 : current / total;
  const filled = Math.round(width * ratio);
  const empty = width - filled;
  const percent = Math.round(ratio * 100);
  const bar = `${"#".repeat(filled)}${"-".repeat(empty)}`;

  process.stdout.write(`\r${label} [${bar}] ${current}/${total} (${percent}%)`);

  if (current === total) {
    process.stdout.write("\n");
  }
}

async function clickLoadMoreUntilDone(page) {
  while (true) {
    const loadMore = page.locator("button:has-text('Load More')").first();
    const visible = await loadMore.isVisible({ timeout: 3000 }).catch(() => false);

    if (!visible) {
      break;
    }

    await loadMore.click();
    await page.waitForTimeout(2500);
  }
}

async function extractIds(page) {
  return await page.evaluate(() => {
    return [...new Set(
      Array.from(document.querySelectorAll("span.block.truncate"))
        .map((el) => el.textContent.trim())
        .filter((text) => /^[0-9a-f-]{36}$/i.test(text))
    )];
  });
}

(async () => {
  if (!PROJECT_TASKS_URL) {
    throw new Error("Add your Handshake project tasks URL to PROJECT_TASKS_URL near line 4.");
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      storageState: "auth.json"
    });

    const page = await context.newPage();

    console.log("Opening project tasks page...");
    await page.goto(PROJECT_TASKS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await page.waitForTimeout(3000);
    await clickLoadMoreUntilDone(page);

    console.log("Extracting task IDs...");
    const ids = await extractIds(page);

    console.log(`Found ${ids.length} IDs`);
    fs.writeFileSync("ids.json", JSON.stringify(ids, null, 2));
    console.log("Saved IDs to ids.json\n");

    const results = [];
    let completed = 0;
    renderProgress(completed, ids.length, "Checking stages");

    for (const id of ids) {
      const url = `https://ai.joinhandshake.com/annotations/fellow/task/${id}/run`;

      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });

        await page.waitForTimeout(2500);

        const span = page.locator("span").filter({ hasText: id }).first();
        const exists = await span.isVisible({ timeout: 5000 }).catch(() => false);

        if (exists) {
          await span.hover();
          await page.waitForTimeout(500);
        }

        const bodyText = await page.locator("body").innerText();
        const stage = parseStage(bodyText);

        results.push({ id, stage });
      } catch (err) {
        process.stdout.write("\n");
        console.log(`ERROR for ${id}: ${err.message}`);

        results.push({
          id,
          stage: "ERROR / inaccessible / failed"
        });
      } finally {
        completed += 1;
        renderProgress(completed, ids.length, "Checking stages");
      }
    }

    console.table(results);

    fs.writeFileSync("stages.json", JSON.stringify(results, null, 2));
    console.log("Saved results to stages.json");
  } finally {
    await browser.close();
  }
})();
