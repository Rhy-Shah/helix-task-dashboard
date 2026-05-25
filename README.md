# Tasks Dashboard

A local dashboard for your project tasks. Runs entirely on your machine — nothing is hosted.

## Setup

You only need to do this once.

```bash
git clone <REPO_URL>
cd <repo-folder>
npm install
npx playwright install chromium
```

## Run it

```bash
npm start
```

Open <http://localhost:4173> and click **Login**.

A browser window opens. Sign in normally (SSO / Duo / whatever your school uses). Once you land on your project tasks page the window closes by itself, your session is saved locally to `auth.json`, and the dashboard loads automatically. If the window doesn't close on its own, click **Save Login** to capture the session manually.

> You'll see project details (name, tasks, stages) only after you sign in — and only if you're on **Project H**. Anyone else will get an empty / unauthorized response.

Daily use is just `npm start`. Your saved session is reused; no sign-in needed until you click **Log Out**.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Executable doesn't exist` | `npx playwright install chromium` |
| Login window flashes and closes (macOS) | `xattr -dr com.apple.quarantine ~/Library/Caches/ms-playwright` |
| Login window crashes with `SIGABRT` / `chrome-mac-x64` | Run `npm start` from the real macOS Terminal, not an IDE-integrated terminal |
| `EADDRINUSE :::4173` | `pkill -f "node server.js"` then `npm start` |
| Port 4173 is taken by something else | `PORT=5050 npm start` |

## What gets stored

| Thing | Where | Lifetime |
| --- | --- | --- |
| Session cookies | `auth.json` (gitignored, mode 600) | Until you click Log Out |
| Session id cookie | Browser cookie (HttpOnly, SameSite=Lax) | 30 days |
| Anything else | Nowhere | — |
