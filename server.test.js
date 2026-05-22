const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAppServer,
  createSessionId,
  getHelixProject,
  parseCookies,
} = require("./server");

test("parseCookies reads URL encoded cookie values", () => {
  assert.deepEqual(parseCookies("hai_session=abc%20123; theme=clean"), {
    hai_session: "abc 123",
    theme: "clean",
  });
});

test("createSessionId returns unique UUID session ids", () => {
  const first = createSessionId();
  const second = createSessionId();

  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});

test("createAppServer returns an HTTP server instance", () => {
  const server = createAppServer();

  assert.equal(typeof server.listen, "function");
  assert.equal(typeof server.close, "function");
});

test("getHelixProject reads the configured Project Helix URL", () => {
  assert.deepEqual(getHelixProject(), {
    id: "26a53071-8843-4138-97df-430bd3e4cd45",
    name: "Project Helix",
    projectUrl:
      "https://ai.joinhandshake.com/fellow/projects/past/26a53071-8843-4138-97df-430bd3e4cd45",
  });
});
