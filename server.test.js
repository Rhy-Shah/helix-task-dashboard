const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAppServer,
  createSessionId,
  createSessionStore,
  getHelixProject,
  launchLoginBrowser,
  parseCookies,
} = require("./server");

test("launchLoginBrowser prefers installed Chrome", async () => {
  const launches = [];
  const mockChromium = {
    launch: async (opts) => {
      launches.push(opts);
      if (opts.channel === "chrome") return { kind: "chrome" };
      throw new Error("unexpected chromium launch");
    },
  };
  const logs = [];
  const browser = await launchLoginBrowser(mockChromium, (msg) => logs.push(msg));

  assert.equal(browser.kind, "chrome");
  assert.equal(launches.length, 1);
  assert.equal(launches[0].channel, "chrome");
  assert.ok(logs.some((line) => line.includes("Google Chrome")));
});

test("launchLoginBrowser falls back to Playwright Chromium", async () => {
  const launches = [];
  const mockChromium = {
    launch: async (opts) => {
      launches.push(opts);
      if (opts.channel === "chrome") throw new Error("Chrome not installed");
      return { kind: "chromium" };
    },
  };
  const logs = [];
  const browser = await launchLoginBrowser(mockChromium, (msg) => logs.push(msg));

  assert.equal(browser.kind, "chromium");
  assert.equal(launches.length, 2);
  assert.equal(launches[0].channel, "chrome");
  assert.equal(launches[1].channel, undefined);
  assert.ok(logs.some((line) => line.includes("Playwright Chromium")));
});

test("parseCookies reads URL encoded cookie values", () => {
  assert.deepEqual(parseCookies("hai_session=abc%20123; theme=clean"), {
    hai_session: "abc 123",
    theme: "clean",
  });
});

test("createSessionId returns long random session ids", () => {
  const first = createSessionId();
  const second = createSessionId();

  assert.equal(typeof first, "string");
  assert.ok(first.length >= 24);
  assert.notEqual(first, second);
});

test("createSessionStore stores and clears in-memory auth state", () => {
  const store = createSessionStore();

  store.ensure("s1");
  assert.equal(store.size(), 1);

  store.setAuth("s1", { cookies: [{ name: "_trajectory_session", value: "x" }] });
  assert.equal(store.get("s1").authState.cookies[0].name, "_trajectory_session");

  store.clear("s1");
  assert.equal(store.get("s1"), null);
});

test("createAppServer returns an HTTP server instance", () => {
  const server = createAppServer();

  assert.equal(typeof server.listen, "function");
  assert.equal(typeof server.close, "function");
  server.close();
});

test("getHelixProject reads the configured Project Helix URL", () => {
  assert.deepEqual(getHelixProject(), {
    id: "26a53071-8843-4138-97df-430bd3e4cd45",
    name: "Project Helix",
    projectUrl:
      "https://ai.joinhandshake.com/fellow/projects/past/26a53071-8843-4138-97df-430bd3e4cd45",
  });
});
