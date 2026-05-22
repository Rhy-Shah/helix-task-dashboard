# HAI Script

Checks your Handshake AI **My tasks** stages with the Handshake API.

Run `node main.js`. If `auth.json` already exists, the script uses it. If
`auth.json` is missing, `main.js` automatically starts the Playwright login
fallback, opens a browser, waits for you to log in, saves `auth.json`, and then
continues the API run.

## Setup

Use Node.js 18 or newer.

Playwright is only required for the automatic login fallback that runs when
`auth.json` is missing:

```bash
npm install playwright
npx playwright install chromium
```

## Configure

Create `config.json` in this folder and put your Handshake project page or
project tasks URL in it:

```json
{
  "projectTasksUrl": "https://ai.joinhandshake.com/fellow/projects/past/YOUR_PROJECT_ID"
}
```

`config.json` is ignored by git.

Optionally create `task-ids.txt` in this folder with one task ID per line. When
that file exists, the script fetches your Handshake tasks and reports stages for
only those IDs, preserving the order from `task-ids.txt`. IDs that are not found
in your **My tasks** response are shown as `Not found in My tasks`.

## Run

```bash
node main.js
```

If this is your first run, or if `auth.json` was deleted, a browser opens for
login automatically. After you finish logging in, press Enter in the terminal.
The script saves `auth.json` and continues.

The script uses the `task.listClaimedTasksForFellow` endpoint, which matches the
**My tasks** tab. It fetches active and past tasks, writes task IDs to
`ids.json`, writes stage results to `stages.json`, and prints a stage summary.

Generated files:

- `auth.json`
- `config.json`
- `ids.json`
- `stages.json`

## Dashboard

Generate the static dashboard data after fetching tasks:

```bash
npm run dashboard:data
```

Then open `dashboard/index.html` in a browser. The dashboard shows all fetched
task IDs, stages, build status, summary counts, extra IDs found in Handshake,
and submitted IDs that were not found in **My tasks**.

## Web App

Run the local web app:

```bash
npm start
```

Open `http://localhost:4173`. Users can connect through Handshake's own login
window, fetch Project Helix, copy task IDs from the current filters, and view
task IDs, stages, build status, and summaries. Saved web sessions are stored in
`.sessions/`, which is ignored by git.
