const { chromium } = require("playwright");
const fs = require("fs");

const PROJECT_TASKS_URL =
  "";

function parseStage(text) {
  return text.match(/Stage:\s*([^\n]+)/)?.[1]?.trim() || "No stage found";
}

(async () => {
  const browser = await chromium.launch({ headless: false });

  const context = await browser.newContext({
    storageState: "auth.json"
  });

  const page = await context.newPage();

  const results = [];

  for (const id of ids) {
    const url = `https://ai.joinhandshake.com/annotations/fellow/task/${id}/run`;

    try {
      console.log(`Opening ${id}...`);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });

      // wait for page to settle
      await page.waitForTimeout(1500);

      const span = page.locator("span").filter({ hasText: id }).first();

      const exists = await span.isVisible({ timeout: 5000 }).catch(() => false);

      if (exists) {
        await span.hover();
        await page.waitForTimeout(500);
      } else {
        console.log(`⚠️ Span not found for ${id}, continuing...`);
      }

      const bodyText = await page.locator("body").innerText();
      const stage = parseStage(bodyText);

      results.push({ id, stage });
      console.log(`${id} => ${stage}`);

    } catch (err) {
      console.log(`❌ ERROR for ${id}: ${err.message}`);

      results.push({
        id,
        stage: "ERROR / inaccessible / failed to load"
      });
    }
  }

  console.table(results);

  // ✅ save results
  fs.writeFileSync("stages.json", JSON.stringify(results, null, 2));
  console.log("✅ Saved results to stages.json");

  await browser.close();
})();