const { chromium } = require("playwright");
const fs = require("fs");

const ids = [
  "56403cdf-7729-4e91-b66d-d7a55a59eafd",
  "1edea93d-2df3-446e-8f4a-090f0407e092",
  "15f7ee08-f88d-4ba3-b230-ef6b91c26f28",
  "e62344c5-37b8-4797-bc79-dff3cc4e3b11",
  "f4bbaa9a-7e37-4b1a-beb4-e87ac53ff719",
  "13fa7af2-3a23-4ed5-ad98-057e21a2a7f1",
  "a44f0fc8-7de1-4ad5-9547-cf29d7a40880",
  "fc608507-07d6-436d-ba37-f9260567da13",
  "04017a45-b9ea-4690-827a-03bbe8c7b1e1",
  "f73c60c2-5461-4023-9854-cd9417fbf072",
  "41b0ec1a-7953-4f17-ab7b-89a4406440ff",
  "22c927a2-55ad-4c10-918e-8be446d4fc31",
  "51de74ac-25ce-417e-b883-5baf8645c77f",
  "9f0fff5c-5089-4627-b85d-f108e48f459d",
  "9d9cb38c-e6ac-4848-94f7-22323b69d73d",
  "c5069f11-e1e7-4e6a-96e1-262dc4c3213b",
  "37eeefe7-d891-4d4e-8dd2-b9c0ef32b37b",
  "f0ef93f3-fbd0-4b28-90c1-83f66570c7ae",
  "3d0d5656-3959-4df1-82a8-3f3adb2daf48",
  "c7b68237-2cea-431b-a70e-9e2498d3934a",
  "a1a72999-31c3-4ffa-b992-cbe0d0fb2795"
];

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