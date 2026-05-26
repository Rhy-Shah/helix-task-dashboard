# Tasks Dashboard

A local dashboard for your project tasks. Everything runs on your machine — nothing is hosted online.

**One person per computer:** Each fellow runs their own copy. **Login** opens **Playwright Chromium** on **your** laptop for sign-in. Sessions are saved in `auth.json` on that machine only — not shared on GitHub or between users.

## What you need

- **Node.js 18+** ([nodejs.org](https://nodejs.org))
- A terminal (Terminal on Mac, PowerShell or Terminal on Windows, iTerm, etc.)
- Access to **Project H** on the platform (this repo is wired to one project; see [Wrong project or empty tasks](#wrong-project-or-empty-tasks) below)

## First-time setup

Do these steps once after cloning the repo.

### 1. Clone and install

```bash
git clone https://github.com/Rhy-Shah/Project-H-task-dashboard.git
cd Project-H-task-dashboard
npm install
npx playwright install chromium
```

> **Important:** Run `npx playwright install chromium` in a normal system terminal, not only inside an IDE sandbox. If Chromium fails to launch, login will not work.

### 2. Start the server

```bash
npm start
```

You should see:

```text
Server running at http://localhost:4173 (development mode)
```

### 3. Open the dashboard

In your regular browser (Chrome, Safari, Firefox, etc.), open:

**http://localhost:4173**

This page is only the dashboard UI. You do **not** type your password here.

### 4. Sign in (separate browser window)

1. On the dashboard, click **Login**.
2. A **second window** opens — **Playwright Chromium** (installed via `npx playwright install chromium`).
3. In **that** window, sign in the same way you normally would on the platform:
   - **Google OAuth** is fine — complete the full Google sign-in flow there.
   - Finish SSO / Duo / school login if prompted.
4. Wait until you are fully signed in and can see your **project / tasks** in that Chromium window.
5. When login succeeds:
   - The Chromium window usually **closes on its own**.
   - The dashboard shows **Signed in** and loads your tasks.

If the Chromium window stays open after you have finished signing in:

1. Leave the dashboard tab open.
2. Click **Save Login** on the dashboard (not in the Chromium window).
3. The Chromium window should close and tasks should load.

### 5. Confirm it worked

Check the dashboard:

| What you should see | Meaning |
| --- | --- |
| **Signed in** (top right) | Session was captured |
| Summary cards with numbers | Task counts by category |
| A table of tasks | Stage, build status, updated date, title |

If you still see **Not signed in** or **0 tasks**, see [Troubleshooting](#troubleshooting).

---

## Daily use

```bash
npm start
```

Open **http://localhost:4173**. Your saved session in `auth.json` is reused — you usually do not need to log in again until you click **Log Out**.

Click **Refresh** to pull the latest tasks from the platform.

---

## How login actually works

This confuses people the first time:

| Place | What happens |
| --- | --- |
| **http://localhost:4173** | Dashboard only. Shows tasks **after** a session is saved. |
| **Playwright Chromium window** | Where you sign in with Google OAuth / SSO. |

The dashboard never talks to Google directly. Playwright opens the real platform site, you log in there, and the app saves cookies to `auth.json` on your computer.

**Common mistake:** Signing in only in your normal browser, or expecting a login form on localhost. You must complete sign-in in the **login window** that opens when you click **Login** (not the localhost tab).

---

## Reading task status (~18 tasks or any count)

After tasks load, use these parts of the dashboard:

### Summary cards (top)

Click a card to filter the table. Categories:

| Card | What it includes |
| --- | --- |
| **Accepted** | Delivered, Ready to Deliver |
| **In evaluation** | Pass@n, Pass@0, Submitted for Pass@ |
| **Internal Audit** | Review, Internal Audit, Likely Rejected |
| **Misc** | Invalid, Failed, and other stages |

Click **Total tasks** to clear the category filter.

### Task table

Each row shows:

| Column | Meaning |
| --- | --- |
| **Stage** | Pipeline stage (e.g. Delivered, Pass@n, Review) |
| **Build** | Build result (passing, failing, or empty) |
| **Updated** | Last update date |
| **Title** | Task title |

Use **Search**, **Stage**, **Build**, and **date filters** above the table to narrow down tasks (for example, only failing builds or one stage).

### Latest activity

After the first refresh, this section shows what changed since your last refresh (stage, build, title, or updated time).

---

## Troubleshooting

### Login / Google OAuth

| Problem | What to do |
| --- | --- |
| Clicked **Login** but nothing opens | Run `npm start` from a normal terminal. Re-run `npx playwright install chromium`. |
| Google says **“This browser or app may not be secure”** | Google often blocks sign-in in Playwright Chromium. Sign in in **that** window—not on localhost—then **Save Login** if tasks do not load. Try **non-Google SSO** on the platform if your account offers it. |
| Google sign-in fails or loops in the login window | Complete OAuth **inside the Chromium window opened by Login**, not on localhost. After you see your project/tasks there, use **Save Login** on the dashboard if the window does not close on its own. |
| Signed in on the platform in your normal browser, but dashboard says **Not signed in** | That session is in a different browser. Use **Login** on the dashboard so the Chromium window captures cookies. |
| Chromium closes before you finish SSO | Click **Login** again and complete the full flow. |
| Window stays open after Google login | When you see your project/tasks in that window, click **Save Login** on the dashboard. |
| **Save Login** says authentication failed | You are not fully signed in yet in the Chromium window. Finish Google OAuth and wait until the project page loads, then try **Save Login** again. |
| Was signed in, now **Session expired** | Click **Log Out**, then **Login** and sign in again. |

### Past project history warning

If you see **“Could not load extra past-project task history”**, the main task list still loaded. Some accounts hit a 404 or permission error on the secondary history API — you are not fully signed out. Task counts may be slightly lower than the platform UI until that endpoint works for your account.

### Wrong project or empty tasks

This repo loads tasks for **Project H** only (configured in `config.json`). If you are not on that project:

- You may sign in successfully but see **0 tasks** or errors.
- That is expected — not a broken login.

Fellows on Project H should use the default `config.json`. Do not change it unless you were told to use a different project URL.

### Server / port

| Problem | Fix |
| --- | --- |
| `Executable doesn't exist` | `npx playwright install chromium` |
| Login window flashes and closes | Reinstall Chromium; allow it in system security / antivirus settings. |
| Login window crashes on open | Run `npm start` outside an IDE sandbox. Reinstall Playwright for your OS/CPU (Apple Silicon vs x64). |
| `EADDRINUSE :::4173` | Stop the other `node server.js` process, then `npm start` again. |
| Port 4173 in use by something else | `PORT=5050 npm start` → open **http://localhost:5050** |

### Task status still unclear

1. Click **Refresh** and wait for the table to populate.
2. Check the **Stage** and **Build** columns on each row.
3. Click summary cards (**Accepted**, **In evaluation**, etc.) to group tasks.
4. Use the **Stage** dropdown to filter to one stage at a time.

If the table shows 0 rows but you expect ~18 tasks, you are likely not on Project H or your session does not have access — see [Wrong project or empty tasks](#wrong-project-or-empty-tasks).

---

## What gets stored locally

| Thing | Where | Lifetime |
| --- | --- | --- |
| Session cookies | `auth.json` (gitignored, mode 600) | Until **Log Out** |
| Session id cookie | Browser cookie on localhost (HttpOnly) | 30 days |
| Anything else | Nowhere | — |

---

## Quick checklist (share with someone stuck on setup)

- [ ] `npm install` and `npx playwright install chromium` finished without errors
- [ ] `npm start` shows `http://localhost:4173`
- [ ] Opened **localhost** in a normal browser
- [ ] Clicked **Login** and used the **Chromium** window (not localhost) for Google OAuth
- [ ] Saw project/tasks in the Chromium window before it closed (or clicked **Save Login**)
- [ ] Dashboard shows **Signed in** and task rows in the table

---

## Getting help

If you are still stuck, say what step failed (install, Login button, Google OAuth, Save Login, or 0 tasks) and what the dashboard status line shows (**Not signed in**, **Waiting for sign-in...**, or **Signed in**).
