const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const page = await context.newPage();

  // Go to login page
  await page.goto("https://ai.joinhandshake.com");

  console.log("👉 Log in manually, then press ENTER here...");
  await new Promise(resolve => process.stdin.once("data", resolve));

  // Save session
  await context.storageState({ path: "auth.json" });

  console.log("✅ Auth saved!");
  await browser.close();
})();