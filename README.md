# HAI Script

Node.js Playwright script for checking Handshake AI task stages.

## Setup

Install dependencies:

```bash
npm install
```

Install the Playwright Chromium browser:

```bash
npx playwright install chromium
```

Create a saved browser session:

```bash
node saveAuth.js
```

Log in when the browser opens, then press Enter in the console. This writes `auth.json`, which is ignored by git.

## Configure

Open `main.js` and add your Handshake project tasks URL to `PROJECT_TASKS_URL` near line 4:

```js
const PROJECT_TASKS_URL =
  "https://ai.joinhandshake.com/fellow/YOUR_PROJECT_ID/tasks";
```

## Run

```bash
node main.js
```

The script opens the configured project task page, checks each task ID, and writes the results to `stages.json`.

Generated files:

- `ids.json`
- `stages.json`

Both generated files are ignored by git.
