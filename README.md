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

Create `config.json` in this folder and put your Handshake project tasks URL in
it:

```json
{
  "projectTasksUrl": "https://ai.joinhandshake.com/fellow/YOUR_PROJECT_ID/tasks"
}
```

`config.json` is ignored by git.

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
