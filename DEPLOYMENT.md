# Deploying the Winter League Platform

> This guide is for the **real league**. For a hosted **demo** copy (demo data, shared demo password, check-in open any day) to use in presentations, follow [DEMO-DEPLOYMENT.md](./DEMO-DEPLOYMENT.md) instead. The two are completely separate.

This guide stands up **three brand-new services**, all separate from Gym Hive:

1. **Turso** — a new `winter-league` database
2. **Render** — a new Web Service running the Express API
3. **Vercel** — a new project serving the Vue frontend

Nothing here touches Gym Hive's database, Render service or Vercel project. Different database, different JWT secret, different URLs. A Gym Hive sign-in token can't be used here even by accident (tokens carry a `winter-league` audience).

Do the steps **in order**. Each service needs a value from the one before it, and Render needs one value back from Vercel at the end.

```
Turso  ──(DB URL + token)──▶  Render  ──(API URL)──▶  Vercel
                                 ▲                       │
                                 └──────(site URL)───────┘
```

---

## 0. Before you start

- Push the project to a **new GitHub repository** (e.g. `winter-league`). The repo root contains `backend/` and `frontend/`; both services deploy from the same repo using different root directories.
- Install the Turso CLI if you don't already have it from Gym Hive:
  - macOS: `brew install tursodatabase/tap/turso`
  - Linux / WSL: `curl -sSfL https://get.tur.so/install.sh | bash`
- Have Node 20+ installed locally (you'll run the one-time migrate and seed from your machine).

Keep a scratch note open. You'll collect these values as you go:

| Value | Comes from | Used in |
|---|---|---|
| `DATABASE_URL` | Turso step 1.3 | Render, `.env.production.local` |
| `DATABASE_AUTH_TOKEN` | Turso step 1.4 | Render, `.env.production.local` |
| `JWT_SECRET` | Render step 2.3 | Render |
| API URL | Render step 2.5 | Vercel |
| Site URL | Vercel step 3.4 | Render (`APP_URL`) |

---

## 1. Turso — create the database

### 1.1 Sign in
```bash
turso auth login
```
Use the same Turso account as Gym Hive if you like. The databases stay completely separate.

### 1.2 Create a new database
```bash
turso db create winter-league
```
If your Gym Hive database lives in a named group (check with `turso group list`), you can put this one in the same group so it's in the same region: `turso db create winter-league --group <group-name>`. A shared group only shares location; the data is separate.

### 1.3 Get the database URL
```bash
turso db show winter-league --url
```
It looks like `libsql://winter-league-<your-org>.turso.io`. Save it as **`DATABASE_URL`**.

### 1.4 Create an auth token
```bash
turso db tokens create winter-league
```
Save the long string as **`DATABASE_AUTH_TOKEN`**. Treat it like a password: never commit it.

### 1.5 Create the tables and the first System Admin (from your machine)
```bash
cd backend
npm install
cp .env.production.example .env.production.local
```
Edit `backend/.env.production.local`:
```
NODE_ENV=production
DATABASE_URL=libsql://winter-league-<your-org>.turso.io
DATABASE_AUTH_TOKEN=<token from 1.4>
SEED_ADMIN_FIRST_NAME=<your first name>
SEED_ADMIN_LAST_NAME=<your last name>
SEED_ADMIN_EMAIL=<your real email>
SEED_ADMIN_PASSWORD=<a strong temporary password>
```
Then run:
```bash
npm run migrate:prod
npm run seed:prod
```
The seed prints the admin's **username** (generated from the name, e.g. first initial + last name). Write it down. You'll be made to change the temporary password on first sign-in.

`.env.production.local` is gitignored. Keep it only on your machine, or delete it after this step.

> Don't run `seed:demo` against production. It refuses unless forced, and demo accounts with a shared known password don't belong in a live system.

### 1.6 Check it worked (optional)
```bash
turso db shell winter-league "SELECT version FROM schema_migrations;"
turso db shell winter-league "SELECT username, role FROM users;"
```
You should see migration `1` and your one `super_admin`.

---

## 2. Render — the API

### 2.1 Create the service
Render dashboard → **New +** → **Web Service** → connect the `winter-league` GitHub repo.

### 2.2 Service settings

| Setting | Value |
|---|---|
| Name | `winter-league-api` (this becomes the URL) |
| Region | Same region as your Turso DB if possible |
| Branch | `main` |
| **Root Directory** | `backend` |
| Runtime | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm run start:render` |
| Instance type | Free works; see note below |

The server applies any pending database updates itself as it starts, so every deploy brings the database up to date whatever the start command is. If an update fails, the server stops with the reason in the log rather than running against a half-updated database, and Render keeps the previous version serving. You won't need `migrate:prod` unless you prefer to run updates by hand.

### 2.3 Generate a JWT secret
On your machine:
```bash
openssl rand -hex 32
```
Use a **new** value. It must not be the same as Gym Hive's `JWT_SECRET`. (On Windows without OpenSSL: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.)

### 2.4 Environment variables
Under **Environment** add:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | from Turso 1.3 |
| `DATABASE_AUTH_TOKEN` | from Turso 1.4 |
| `JWT_SECRET` | from 2.3 |
| `JWT_EXPIRES_IN` | `8h` |
| `APP_URL` | `http://localhost:5174` **for now** (you'll replace it in step 4) |
| `MAX_PROGRAMS` | `16` |
| `LEAGUE_TIMEZONE` | `America/Los_Angeles` (Pacific Time, the default; the league's clock for game times, "today", referee check-in, and timestamps) |
| `DEMO_CHECKIN_ANYTIME` | `false` (optional; see **Live demos** under “Upgrading an existing deployment to Phase 3”) |
| `EMAIL_PROVIDER` | `console` to start, or `brevo` (see below) |
| `EMAIL_FROM` | `Winter League <no-reply@yourdomain.com>` |
| `BREVO_SMTP_USER` | only if `EMAIL_PROVIDER=brevo` |
| `BREVO_SMTP_PASS` | only if `EMAIL_PROVIDER=brevo` |

Don't set `PORT`; Render provides it. The server refuses to start in production if `JWT_SECRET` is still the development placeholder, which protects you from a common mistake.

**Email:** with `console`, password-reset and forgot-username emails are written to the Render log instead of sent. That's fine while you test. To really send, use Brevo like Gym Hive; you can reuse the same Brevo account, but use a distinct `EMAIL_FROM` so people can tell the apps apart.

### 2.5 Health check and deploy
- **Settings → Health Check Path:** `/api/health`
- Click **Create Web Service** / **Deploy**.

In the deploy log, look for the migration line followed by the server starting. When it's live, open:
```
https://winter-league-api.onrender.com/api/health
```
Expected (`schema` is how many database updates have been applied, and `latestUpdate` the most recent one — handy for confirming a deploy landed):
```json
{"ok":true,"app":"winter-league","database":"turso","schema":7,"latestUpdate":"007_cancel_requests.sql"}
```
Save the base URL plus `/api` as the **API URL**, e.g. `https://winter-league-api.onrender.com/api`.

> **Free tier note:** free Render services sleep after about 15 minutes idle, and the first request afterwards takes 30–60 seconds. That's acceptable for setup and testing. Before Program Directors start entering gym time for real, consider the paid Starter instance so nobody sits through a cold start.

---

## 3. Vercel — the frontend

### 3.1 Create the project
Vercel dashboard → **Add New… → Project** → import the same `winter-league` repo.

### 3.2 Project settings

| Setting | Value |
|---|---|
| Project Name | `winter-league` |
| Framework Preset | **Vite** |
| **Root Directory** | `frontend` |
| Build Command | `npm run build` (default) |
| Output Directory | `dist` (default) |

`frontend/vercel.json` already contains the SPA rewrite, so refreshing on a page like `/slots` won't 404.

### 3.3 Environment variable

| Key | Value | Environments |
|---|---|---|
| `VITE_API_URL` | the API URL from 2.5, **including `/api`** and no trailing slash | Production and Preview |

Vite bakes this in **at build time**. If you change it later, you must redeploy for it to take effect.

### 3.4 Deploy
Click **Deploy**. When it finishes, note the production URL, e.g. `https://winter-league.vercel.app`. This is your **Site URL**. If you attach a custom domain, use that instead.

---

## 4. Connect them back — set `APP_URL` on Render

The API only accepts browser requests from origins listed in `APP_URL`, and uses it to build links in password-reset emails.

1. Render → `winter-league-api` → **Environment** → set:
   ```
   APP_URL=https://winter-league.vercel.app
   ```
   No trailing slash. To also allow a custom domain, comma-separate them:
   `https://winter-league.vercel.app,https://league.yourdomain.com`.
   The **first** one is used in emailed links, so put your main domain first.
2. Save. Render redeploys automatically.

---

## 5. First sign-in checklist

1. Open the Site URL. The login page should load in the default theme.
2. Sign in with the username printed in step 1.5 and your temporary password.
3. You should be sent to **Change password**. Set a permanent one.
4. **League setup:** create the season (e.g. Winter 2026–27 with real start/end dates) and adjust the 10 starter divisions.
5. **Programs:** add each participating program (up to 16).
6. **Users:** create a Program Director for each program. Each gets a generated username and temporary password to hand over.
7. Have one Program Director sign in and confirm they only see their own program, then add a venue and a few gym slots.
8. Optional: on **Branding & Theme** (avatar menu → League admin), pick the sitewide theme and set the conference's name and logo. On wide screens there's also a quick theme picker in the header.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login page loads, but sign-in shows a network or CORS error | `APP_URL` on Render doesn't exactly match the Vercel URL | Match it exactly: `https://`, no trailing slash, no path. Redeploy Render. |
| Every API call 404s, or requests go to `winter-league.vercel.app/api/...` | `VITE_API_URL` missing, or set after the last build | Set it in Vercel and **redeploy** the frontend. |
| API calls go to `.../api/api/...` | `VITE_API_URL` ends with `/api/` or `/api` was doubled | Use exactly `https://<service>.onrender.com/api`. |
| `/api/health` shows `"database":"local-sqlite"` on Render | `DATABASE_URL` not set on Render | Add the Turso URL and token, redeploy. Data written in that state is lost on restart. |
| `no such table: users` | Migrations never ran against Turso | Check the Render start command is `npm run start:render`, or run `npm run migrate:prod` locally. |
| Render deploy fails immediately with a JWT message | `JWT_SECRET` missing or still the dev placeholder | Set a fresh `openssl rand -hex 32` value. |
| Turso `401` / `UNAUTHORIZED` in the Render log | Token missing, mistyped, or revoked | `turso db tokens create winter-league` and update `DATABASE_AUTH_TOKEN`. |
| Signed out every time the tab is closed | Expected: tokens live in `sessionStorage` (same as Gym Hive, for Safari/iOS reliability) | — |
| First request after a while takes ~1 minute | Render free tier woke from sleep | Upgrade the instance, or accept it during testing. |
| Referees told check-in hasn’t opened (or has closed) at tip-off, or tonight’s games show as already played | `LEAGUE_TIMEZONE` doesn’t match where games are played | Set it to `America/Los_Angeles` (Pacific), or remove it to use that default, and redeploy. |
| Forgot-password email never arrives | `EMAIL_PROVIDER=console` | Read the link from the Render log, or switch to `brevo` with SMTP credentials. |

## Upgrading an existing deployment to Phase 2

Nothing new to configure. Push the code and Render's `npm run start:render` applies `002_scheduling.sql` before the server starts. Then sign in as the System Admin, open **Schedule builder**, check the rules, generate a draft, review it, and publish. Venues need latitude/longitude for the travel cap to be checked; the builder lists any program whose venues don't have them.

## Upgrading an existing deployment to Phase 3

Push the code. Render applies `003_referees.sql` before the server starts. The league runs on Pacific Time by default (`LEAGUE_TIMEZONE=America/Los_Angeles`). If an earlier deployment set `LEAGUE_TIMEZONE=America/Chicago` on Render, change it or delete it. Then sign in as the Referee Assignor, add referees under **Referees**, check **Settings** (referees per game, default pay, check-in window), and use **Assignments** to fill games. Referee slots are created for the games already on the published schedule the first time the Assignments page or dashboard loads.

**Live demos:** check-in and score entry normally only open on game day. For a demo before the season starts, set `DEMO_CHECKIN_ANYTIME=true` on Render, redeploy, run the demo, then set it back to `false` and redeploy. While it's on, referees can check in to any upcoming game, and those check-ins count toward payouts. Reset or clear demo check-ins before the real season (the assignor can use **Clear attendance** on each).

## Hosted demo

A demo copy of the app for presentations can run on your laptop or as its own Turso database, Render service, and Vercel project, filled from the demo spreadsheet. Step-by-step instructions, including refreshing and tearing one down, are in **[DEMO-DEPLOYMENT.md](./DEMO-DEPLOYMENT.md)**. Never point a demo at the production database.

## Running more than one conference

Each conference runs as its own copy of the app: its own Turso database, Render service, and Vercel project. Data, accounts, schedules, and referees are completely separate, the same way Winter League is separate from Gym Hive. For each additional conference:

1. Follow steps 1–4 above with new names, e.g. Turso database `pacific-youth`, Render service `pacific-youth-api`, Vercel project `pacific-youth`.
2. Give it its **own** `JWT_SECRET`, and set `EMAIL_FROM` to that conference's name (e.g. `Pacific Youth Conference <no-reply@yourdomain.com>`).
3. Sign in as its System Admin and open **Branding & Theme** (avatar menu → League admin) to set the app name, upload its logo, and pick its sitewide theme.

The code is the same for every conference, so fixes and new features ship to all of them from the one repository. Each Render service and Vercel project simply redeploys from `main`.

## Routine operations

- **Ship a change:** push to `main`. Render and Vercel both redeploy; Render applies new migrations first.
- **Rotate the Turso token:** create a new one, update Render, redeploy, then revoke the old one (`turso db tokens invalidate winter-league` revokes **all** tokens for the DB, so update Render first).
- **Back up the database:** `turso db shell winter-league .dump > winter-league-backup.sql`.
- **Local development is unaffected by all of this.** `backend/.env` keeps pointing at the local SQLite file.
