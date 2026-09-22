# Deploying a hosted demo

This guide sets up a **demo copy** of the Winter League Platform on the internet: a web address anyone at a meeting can open on a laptop or phone, filled with the demo league from the spreadsheet in `backend/demo-data/`. It's for presentations and training.

For the **real league**, use [DEPLOYMENT.md](./DEPLOYMENT.md). The demo is a completely separate copy: its own database, server, and website. Nothing in the demo can touch real league data, and nothing in this guide changes the production deployment.

```
                 Production (DEPLOYMENT.md)          Hosted demo (this guide)
Database         Turso: winter-league                Turso: winter-league-demo
API server       Render: winter-league-api           Render: winter-league-demo-api
Website          Vercel: winter-league               Vercel: winter-league-demo
Data             real programs and people            demo spreadsheet + generated league
Passwords        each person's own                   everyone uses WinterDemo2026
```

Plan on about 30–45 minutes the first time. Do the steps **in order**, because each one needs a value from the one before.

> **Why a demo can't share production:** every demo account uses the same published password (`WinterDemo2026`), and a demo lets referees check in to any upcoming game. Both are fine for a demo and wrong for a real league, so the demo always gets its own database and services.

---

## 0. Before you start

- **The code is on GitHub.** The demo deploys from the same repository as production, so there's nothing extra to push.
- **The Turso CLI is installed and signed in** (`turso auth login`). The same Turso account as production is fine.
- **Node 20+ is installed** on your machine, and you've run `npm install` in `backend/`. That includes the spreadsheet reader the demo loader uses, which the live servers don't need.
- **The demo spreadsheet is ready.** The demo league comes from `backend/demo-data/WinterLeague-ProgramVenueDirector-DemoData.xlsx`. Edit it first if you want different programs, venues, or directors. The [README](./README.md#demo-data-from-a-spreadsheet) describes the columns.

Keep a scratch note open for these values:

| Value | Comes from | Used in |
|---|---|---|
| Demo `DATABASE_URL` | Step 1.2 | `.env.demo.local`, Render |
| Demo `DATABASE_AUTH_TOKEN` | Step 1.3 | `.env.demo.local`, Render |
| Demo `JWT_SECRET` | Step 3.3 | Render |
| Demo API URL | Step 3.5 | Vercel |
| Demo site URL | Step 4.3 | Render (`APP_URL`) |

---

## 1. Turso: create the demo database

### 1.1 Create it
```bash
turso db create winter-league-demo
```
If production lives in a named group (`turso group list`), you can use the same one for the same region: `turso db create winter-league-demo --group <group-name>`.

### 1.2 Get its URL
```bash
turso db show winter-league-demo --url
```
It looks like `libsql://winter-league-demo-<your-org>.turso.io`. Save it as the **demo `DATABASE_URL`**. Check that it says `winter-league-demo`, not the production database.

### 1.3 Create an access token
```bash
turso db tokens create winter-league-demo
```
Save it as the **demo `DATABASE_AUTH_TOKEN`**. Treat it like a password.

---

## 2. Load the demo league (from your machine)

### 2.1 Point a settings file at the demo database
In `backend/`, create a file named **`.env.demo.local`** containing:
```
DATABASE_URL=libsql://winter-league-demo-<your-org>.turso.io
DATABASE_AUTH_TOKEN=<token from 1.3>
```
This file is ignored by Git (any `.env.*.local` file is), so the token never gets committed. Double-check the URL says **`-demo`**.

### 2.2 Check the spreadsheet
```bash
node src/scripts/seedDemo.js --env=.env.demo.local --check --force
```
Expected: `✅ spreadsheet …: 7 programs, 15 venues, 7 directors. Looks good.` If it lists problems (each with its sheet and row), fix the spreadsheet and run the check again.

### 2.3 Create the tables
```bash
node src/scripts/migrate.js --env=.env.demo.local
```
Expected: `✅ Migration complete — 5 new, 5 total.` (or more, if newer versions have added migrations).

### 2.4 Load the demo league
```bash
node src/scripts/seedDemo.js --env=.env.demo.local --force
```
`--force` is required because this writes to a Turso database instead of your local one; it's a deliberate speed bump.

**Which walkthrough?** The command above loads [DEMO.md](./DEMO.md)'s **walkthrough A** (a ready-made league with a published schedule). For **walkthrough B**, where the audience watches the schedule get generated and published, add `--no-schedule`:
```bash
node src/scripts/seedDemo.js --env=.env.demo.local --force --no-schedule
``` This takes a minute or two over the internet. Expected, ending with the logins:
```
✅ Demo data: 1 season, 7 programs, 15 venues, 37 teams, 360 gym slots.
✅ Demo schedule: 148 games published, 2 sample change requests.
✅ Demo referees: 8 on the roster, … November slots filled, …
   Demo accounts (password for all: WinterDemo2026)
     msauceda  program_director  Misty Sauceda  Glencoe Youth Basketball
     …
   For the DEMO.md walkthrough:
     Director 1 (approves the coach's request): msauceda  (Glencoe Youth Basketball)
     Director 2 (the "other program"):           dlumpkin  (Forest Grove Youth Basketball)
```
**Save that output.** It's your list of demo logins and who plays each part in [DEMO.md](./DEMO.md).

Email addresses in the demo are safe placeholders (`…@demo.example`). Don't add `--real-emails` for a hosted demo.

---

## 3. Render: the demo API

### 3.1 Create the service
Render dashboard → **New +** → **Web Service** → the same GitHub repository as production.

### 3.2 Service settings

| Setting | Value |
|---|---|
| Name | `winter-league-demo-api` |
| Region | Same as the demo Turso database, if possible |
| Branch | `main` (see "Keeping the demo stable" below for an alternative) |
| **Root Directory** | `backend` |
| Runtime | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm run start:render` |
| Instance type | Free is fine for a demo; see "Before each demo" |

### 3.3 Generate a JWT secret
```bash
openssl rand -hex 32
```
(Windows without OpenSSL: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.) Use a **new** value, not production's.

### 3.4 Environment variables

| Key | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | demo URL from 1.2 | **must** be the `-demo` database |
| `DATABASE_AUTH_TOKEN` | demo token from 1.3 | |
| `JWT_SECRET` | from 3.3 | different from production's |
| `APP_URL` | `http://localhost:5174` **for now** | replaced in step 5 |
| `EMAIL_PROVIDER` | `console` | **demo never sends email**; messages go to the Render log |
| `DEMO_CHECKIN_ANYTIME` | `true` | lets referees check in to, and coaches enter final scores for, any upcoming game, so both can be shown any day |
| `MAX_PROGRAMS` | `16` | |

`LEAGUE_TIMEZONE` can be left out; it defaults to Pacific Time. Don't set `PORT`; Render provides it.

### 3.5 Health check and deploy
- **Settings → Health Check Path:** `/api/health`
- Click **Create Web Service**.

When it's live, open `https://winter-league-demo-api.onrender.com/api/health`. Expected: `{"ok":true,"app":"winter-league","database":"turso"}`. The Render log should show `🕒 League time zone: America/Los_Angeles`.

Save **`https://winter-league-demo-api.onrender.com/api`** as the **demo API URL**.

---

## 4. Vercel: the demo website

### 4.1 Create the project
Vercel dashboard → **Add New… → Project** → the same repository.

### 4.2 Project settings

| Setting | Value |
|---|---|
| Project Name | `winter-league-demo` |
| Framework Preset | **Vite** |
| **Root Directory** | `frontend` |
| Environment variable `VITE_API_URL` | the demo API URL from 3.5, including `/api`, no trailing slash, for Production and Preview |

### 4.3 Deploy
Click **Deploy** and note the address, e.g. `https://winter-league-demo.vercel.app`. That's the **demo site URL** you'll share at the meeting.

---

## 5. Connect them: set `APP_URL` on Render

Render → `winter-league-demo-api` → **Environment** → set:
```
APP_URL=https://winter-league-demo.vercel.app
```
No trailing slash. Save; Render redeploys automatically.

---

## 6. Check it works

Open the demo site URL and sign in with password `WinterDemo2026`:

1. **`gkim`** (System Admin): the dashboard shows the Winter 2026–27 season, referee coverage, and upcoming games. **Programs** lists the spreadsheet's programs.
2. **Director 1** from step 2.4 (e.g. `msauceda`): the **Requests** tab shows a badge with the sample requests waiting on them. (Loaded with `--no-schedule`, there are no sample requests yet, and **Schedule** says the schedule hasn't been published.)
3. **`acoleman`** (Referee), ideally on a phone: **My games** shows a **Check-in is open** card. If it says check-in opens on game day instead, `DEMO_CHECKIN_ANYTIME` isn't set to `true` (step 3.4).
4. **`pnair`** (Referee Assignor): **Assignments** shows November filled and later weeks open.

**Optional branding:** as `gkim`, open **Branding & theme** (avatar menu → League admin) to set the conference name and logo, and pick a theme (e.g. Pacific Energy).

You're ready to follow [DEMO.md](./DEMO.md).

---

## Before each demo

- **Wake the server** a few minutes early by opening the demo site. Free Render services sleep after about 15 minutes idle, and the first request afterwards takes 30–60 seconds.
- **Open one browser tab per person** you'll sign in as. Each tab keeps its own sign-in.
- **If the demo was used before,** earlier clicks (approved requests, check-ins, auto-fills) are still there. For a clean start, refresh it (next section).

## Refreshing the demo

To return to a clean demo league, after a meeting or after editing the spreadsheet, recreate the demo database and load it again. (`npm run db:reset` only works on local databases, and the loader deliberately won't write over an existing league.)

1. **Delete and recreate the demo database.** Check the name says `-demo`:
   ```bash
   turso db destroy winter-league-demo --yes
   turso db create winter-league-demo
   turso db show winter-league-demo --url
   turso db tokens create winter-league-demo
   ```
2. **Update `backend/.env.demo.local`** with the new token (and the URL, if it changed).
3. **Update Render:** `winter-league-demo-api` → **Environment** → paste the new `DATABASE_AUTH_TOKEN` (and `DATABASE_URL` if it changed). Save.
4. **Load the league again:** steps 2.2–2.4, with or without `--no-schedule` depending on which walkthrough you'll run next.

The demo's Vercel site and Render settings don't otherwise change, and sign-ins keep working with `WinterDemo2026`. Anyone already signed in will need to sign in again.

## Keeping the demo stable

Both demo services redeploy whenever `main` changes, so the demo always runs the latest code. That's usually what you want. If you'd rather freeze the demo for a presentation:

1. Create a `demo` branch from `main` in GitHub.
2. Set the **Branch** to `demo` on both `winter-league-demo-api` (Render → Settings) and `winter-league-demo` (Vercel → Settings → Git).
3. When you're ready to update the demo, merge `main` into `demo`.

If a new version adds database migrations, Render applies them to the demo database automatically on deploy, as it does for production.

## Things to know

- **The demo season is Winter 2026–27** (Nov 2, 2026 – Feb 28, 2027), fixed in the demo loader. Demos work best before or during that season. After Feb 28, 2027 there are no upcoming games to show, and the season dates in `backend/src/scripts/seedDemo.js` should be moved forward before refreshing the demo.
- **Demo check-ins count toward demo payouts.** That's expected, and the **Payouts** page can show it.
- **Everyone who has the demo URL can sign in** with the shared password. Only share the address with the people you're presenting to, and never put real data in the demo.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Step 2.4 says `seed:demo only runs against a local SQLite database` | `--force` missing | Add `--force` (this is intentional). |
| Step 2.4 says `Demo data already present` | The demo database already has a league | Follow **Refreshing the demo**. |
| Step 2.2 lists spreadsheet problems | A typo or missing value in the spreadsheet | Fix the rows it names and run 2.2 again. Nothing was written. |
| Step 2.x fails with `401` / `UNAUTHORIZED` | Token wrong, or from before the database was recreated | `turso db tokens create winter-league-demo`, update `.env.demo.local`. |
| Sign-in shows a network or CORS error | `APP_URL` on Render doesn't exactly match the demo site | Match it exactly (step 5), no trailing slash. |
| `/api/health` shows `"database":"local-sqlite"` | `DATABASE_URL` not set on Render | Add the demo URL and token (step 3.4), redeploy. |
| Referees see "Check-in opens on game day" | `DEMO_CHECKIN_ANYTIME` missing or not `true` | Set it to `true` on Render and redeploy. |
| The site shows no upcoming games | Today is after the demo season | See **Things to know**. |
| First load takes a minute | Render free tier waking up | Open the site a few minutes before the demo. |

## Tearing it down

When you no longer need it:

1. Vercel → `winter-league-demo` → Settings → **Delete Project**.
2. Render → `winter-league-demo-api` → Settings → **Delete Web Service**.
3. `turso db destroy winter-league-demo` (check the name says `-demo`).
4. Delete `backend/.env.demo.local` from your machine.
