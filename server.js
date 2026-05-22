const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const handshakeApi = require("./handshake-api");

const DEFAULT_PORT = Number(process.env.PORT || 4173);
const SESSION_COOKIE = "hai_session";
const DEFAULT_SESSIONS_DIR = path.join(__dirname, ".sessions");
const WEB_DIR = path.join(__dirname, "web");
const CONFIG_PATH = path.join(__dirname, "config.json");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [
          decodeURIComponent(part.slice(0, index)),
          decodeURIComponent(part.slice(index + 1)),
        ];
      })
  );
}

function createSessionId() {
  return crypto.randomUUID();
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function ensureSession(req, res, sessionsDir) {
  fs.mkdirSync(sessionsDir, { recursive: true });

  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE] || createSessionId();
  const authPath = path.join(sessionsDir, `${sessionId}.json`);

  if (!cookies[SESSION_COOKIE]) {
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${encodeURIComponent(
        sessionId
      )}; HttpOnly; SameSite=Lax; Path=/`
    );
  }

  return { sessionId, authPath };
}

function readAuthState(authPath) {
  if (!fs.existsSync(authPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(authPath, "utf8"));
}

function getHelixProject() {
  const fallbackUrl =
    "https://ai.joinhandshake.com/fellow/projects/past/26a53071-8843-4138-97df-430bd3e4cd45";
  let projectUrl = fallbackUrl;

  if (fs.existsSync(CONFIG_PATH)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    projectUrl = config.projectTasksUrl || fallbackUrl;
  }

  return {
    id: handshakeApi.normalizeProjectInput(projectUrl).projectId,
    name: "Project Helix",
    projectUrl,
  };
}

function createLoginManager(sessionsDir) {
  const flows = new Map();

  async function start(sessionId, authPath, startUrl) {
    const existing = flows.get(sessionId);

    if (existing) {
      await existing.browser.close().catch(() => {});
      flows.delete(sessionId);
    }

    const { chromium } = require("playwright");
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    const url = startUrl || getHelixProject().projectUrl;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    flows.set(sessionId, { browser, context, authPath });

    return { opened: true };
  }

  async function save(sessionId) {
    const flow = flows.get(sessionId);

    if (!flow) {
      throw new Error("No active Handshake login window for this session.");
    }

    fs.mkdirSync(sessionsDir, { recursive: true });
    await flow.context.storageState({ path: flow.authPath });
    await flow.browser.close().catch(() => {});
    flows.delete(sessionId);

    return readAuthState(flow.authPath);
  }

  async function cancel(sessionId) {
    const flow = flows.get(sessionId);

    if (flow) {
      await flow.browser.close().catch(() => {});
      flows.delete(sessionId);
    }
  }

  return { start, save, cancel };
}

function serveStatic(req, res) {
  const requestedPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
  const filePath = path.resolve(WEB_DIR, relativePath);

  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  res.writeHead(200, {
    "Content-Type":
      MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function createAppServer(options = {}) {
  const sessionsDir = options.sessionsDir || DEFAULT_SESSIONS_DIR;
  const api = options.api || handshakeApi;
  const loginManager = options.loginManager || createLoginManager(sessionsDir);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const { sessionId, authPath } = ensureSession(req, res, sessionsDir);

    try {
      if (req.method === "GET" && url.pathname === "/api/status") {
        const authState = readAuthState(authPath);
        const helixProject = getHelixProject();

        if (!authState) {
          sendJson(res, 200, { connected: false, helixProject });
          return;
        }

        const profile = await api.fetchProfile(authState);
        sendJson(res, 200, {
          connected: true,
          helixProject,
          profile: { name: profile.name || profile.fullName || "Handshake user" },
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/connect/start") {
        const body = await readRequestBody(req);
        const result = await loginManager.start(
          sessionId,
          authPath,
          body.startUrl || getHelixProject().projectUrl
        );
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/connect/save") {
        const authState = await loginManager.save(sessionId);
        const profile = await api.fetchProfile(authState);
        sendJson(res, 200, {
          connected: true,
          profile: { name: profile.name || profile.fullName || "Handshake user" },
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/connect/cancel") {
        await loginManager.cancel(sessionId);
        sendJson(res, 200, { cancelled: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/logout") {
        await loginManager.cancel(sessionId);
        if (fs.existsSync(authPath)) {
          fs.unlinkSync(authPath);
        }
        sendJson(res, 200, { connected: false });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/dashboard") {
        const authState = readAuthState(authPath);

        if (!authState) {
          sendJson(res, 401, { error: "Connect Handshake first." });
          return;
        }

        const body = await readRequestBody(req);
        const helixProject = getHelixProject();
        const dashboard = await api.fetchDashboardForProject(
          body.projectInput || helixProject.projectUrl,
          authState,
          {
            project: {
              id: helixProject.id,
              name: helixProject.name,
            },
          }
        );

        sendJson(res, 200, dashboard);
        return;
      }

      if (req.method === "GET" && serveStatic(req, res)) {
        return;
      }

      sendJson(res, 404, { error: "Not found." });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
}

if (require.main === module) {
  const server = createAppServer();

  server.listen(DEFAULT_PORT, () => {
    console.log(`Handshake dashboard running at http://localhost:${DEFAULT_PORT}`);
  });
}

module.exports = {
  createAppServer,
  createSessionId,
  getHelixProject,
  parseCookies,
};
