# Setting up a demo

This guide covers running the Winter League Platform as a **demo**: filled with the demo league from the spreadsheet in `backend/demo-data/`, for presentations and training.

There are two ways to run one, and each can be loaded **with** a schedule already published or **without** one:

| | Where it runs | Who can see it | Setup |
|---|---|---|---|
| **Local demo** | your laptop | you (screen-share works) | minutes |
| **Hosted demo** | Turso + Render + Vercel | anyone with the link, on their own phones | 30–45 minutes, once |

| Loaded… | Command ends with | Use it for |
|---|---|---|
| **With a schedule** | *(nothing extra)* | [DEMO.md](./DEMO.md) walkthrough A: everything is ready, every screen has data |
| **Without a schedule** | `--no-schedule` | walkthrough B: the audience watches you generate and publish the season live |

For the **real league**, use [DEPLOYMENT.md](./DEPLOYMENT.md). A demo is always separate from it: its own database, its own server, its own website.

> **Why a demo is never mixed with the real league:** every demo account uses the same published password (`WinterDemo2026`), and demo mode lets referees check in and coaches enter scores on any day.

---

## The demo accounts

Everyone signs in with the password **`WinterDemo2026`**. Program Directors come from the demo spreadsheet, one per program; the others are the same in every demo. **Every load prints the full list**, so this is just a preview:

| Username | Role | Name | Program |
|---|---|---|---|
| `gkim` | System Admin | Grace Kim | — |
| `crogers` | Program Director | Colleen Rogers | Glencoe Youth Basketball |
| `tlehman` | Program Director | Ted Lehman | Forest Grove Youth Basketball |
| `rkruse`, `sknight`, `jnewman`, `rkent`, `ksmith` | Program Directors | Rebecca Kruse, Sam Knight, Jake Newman, Roy Kent, Krissy Smith | Banks, Century, Liberty, Hilhi, Mountainside |
| `tgreene` | Coach | Tasha Greene | Glencoe Youth Basketball |
| `lortega` | Coach | Luis Ortega | Forest Grove Youth Basketball |
| `pnair` | Referee Assignor | Priya Nair | — |
| `acoleman`, `obrooks`, `jpike`, `sdelgado`, `rchen`, `mhayes`, `cnovak`, `dokafor` | Referees | Avery Coleman and seven others | — |

Email addresses are replaced with safe placeholders when the demo is loaded, so a demo can never email the people named in the spreadsheet.

---

# 1. Local demo (on your laptop)

Everything runs on your machine against a local database file. Nothing is published to the internet.

1. **Open `backend/.env`** and set:
   ```
   DEMO_CHECKIN_ANYTIME=true
   ```
   That lets referees check in and coaches enter scores on any day, so you can show both outside the season.
2. **Load the demo.** In `backend/`:
   ```bash
   npm run db:reset                    # with a schedule (walkthrough A)
   npm run db:reset -- --no-schedule   # without a schedule (walkthrough B)
   ```
   Note the `--` before `--no-schedule`: that's how npm passes the option through. The command prints every login at the end.
3. **Restart the app,** because the database file was replaced: stop and re-run `npm run dev` in both `backend/` and `frontend/`.
4. **Open** `http://localhost:5174` and sign in as `gkim` / `WinterDemo2026`.

**To start over,** or to switch between the two styles, run step 2 again and restart. It always replaces what's there.

---

# 2. Hosted demo (a link anyone can open)

Three services, all separate from the real league:

```
Turso winter-league-demo → Render winter-league-demo-api → Vercel winter-league-demo
```

Do the steps in order. Each needs a value from the one before.

## Before you start

- **The code is on GitHub.** The demo deploys from the same repository as production.
- **The Turso CLI is installed and signed in:**
  - macOS: `brew install tursodatabase/tap/turso`
  - Linux/WSL: `curl -sSfL https://get.tur.so/install.sh | bash`
  - Then `turso auth login`.
- **Node 20+**, and `npm install` run in `backend/` (that includes the spreadsheet reader the loader needs).
- **The demo spreadsheet** is `backend/demo-data/WinterLeague-ProgramVenueDirector-DemoData.xlsx`. Edit it first if you want different programs, venues, or directors ([README](./README.md#demo-data-from-a-spreadsheet) describes the columns).

Keep a note of these as you go:

| Value | From | Used in |
|---|---|---|
| Demo `DATABASE_URL` | 2.1 | `.env.demo.local`, Render |
| Demo `DATABASE_AUTH_TOKEN` | 2.1 | `.env.demo.local`, Render |
| Demo `JWT_SECRET` | 2.3 | Render |
| Demo API address | 2.3 | Vercel |
| Demo site address | 2.4 | Render (`APP_URL`) |

## 2.1 Create the demo database

```bash
turso db create winter-league-demo
turso db show winter-league-demo --url      # → libsql://winter-league-demo-<org>.turso.io
turso db tokens create winter-league-demo   # → a long token; treat it like a password
```

If production lives in a group (`turso group list`), you can use the same one for the same region: `turso db create winter-league-demo --group <name>`.

## 2.2 Load the demo league (from your machine)

Create **`backend/.env.demo.local`** with the two values from 2.1:

```
DATABASE_URL=libsql://winter-league-demo-<org>.turso.io
DATABASE_AUTH_TOKEN=<token>
```

Git ignores this file (any `.env.*.local`), so the token is never committed. Check the address says **`-demo`**.

> **Already loaded this database before?** These are the **first-time** commands. To load a fresh demo over an existing one, add `--replace` — see [section 3, Refreshing a demo](#3-refreshing-a-demo). Without it you'll get `Demo data already present — nothing to do.`

Then, **in `backend/`**, run these three in order:

```bash
# 1. check the spreadsheet (nothing is written)
node src/scripts/seedDemo.js --env=.env.demo.local --force --check

# 2. create the tables
node src/scripts/migrate.js --env=.env.demo.local

# 3. load the demo league (first time only — to reload, see section 3)
node src/scripts/seedDemo.js --env=.env.demo.local --force               # with a schedule
node src/scripts/seedDemo.js --env=.env.demo.local --force --no-schedule # without a schedule
```

- `--env=.env.demo.local` points at the demo database instead of your local one. **Leave it out and you'll load your laptop's database instead.**
- `--force` is required because this writes to a hosted database; it's a deliberate speed bump.
- Step 3 takes a minute or two over the internet and ends with the full list of logins. **Save that output.**

## 2.3 Render: the demo API

Render → **New +** → **Web Service** → the same GitHub repository.

| Setting | Value |
|---|---|
| Name | `winter-league-demo-api` |
| Region | same as the demo database if possible |
| Branch | `main` (see "Keeping the demo stable") |
| **Root Directory** | `backend` |
| **Build Command** | `npm install` |
| **Start Command** | `npm run start:render` |
| Instance type | Free is fine for a demo |

> **Use exactly `npm run start:render`.** It applies any new database updates before starting. With a different start command, a future version can fail with "Something went wrong on the server".

**Environment variables:**

| Key | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | from 2.1 | must be the `-demo` database |
| `DATABASE_AUTH_TOKEN` | from 2.1 | |
| `JWT_SECRET` | a new random value: `openssl rand -hex 32` | different from production's |
| `APP_URL` | `http://localhost:5174` **for now** | replaced in 2.5 |
| `EMAIL_PROVIDER` | `console` | **a demo never sends email**; messages go to the Render log |
| `DEMO_CHECKIN_ANYTIME` | `true` | referees can check in and coaches can enter scores on any day |
| `MAX_PROGRAMS` | `16` | |

Leave `LEAGUE_TIMEZONE` out (it defaults to Pacific) and don't set `PORT` (Render provides it).

**Settings → Health Check Path:** `/api/health`. Then create the service.

When it's live, open `https://winter-league-demo-api.onrender.com/api/health`. Expect `{"ok":true,"app":"winter-league","database":"turso"}`. Save **`https://winter-league-demo-api.onrender.com/api`** as the demo API address.

## 2.4 Vercel: the demo site

Vercel → **Add New… → Project** → the same repository.

| Setting | Value |
|---|---|
| Project Name | `winter-league-demo` |
| Framework Preset | **Vite** |
| **Root Directory** | `frontend` |
| `VITE_API_URL` | the demo API address from 2.3, ending in `/api`, no trailing slash (Production and Preview) |

Deploy, then note the address, e.g. `https://winter-league-demo.vercel.app`.

## 2.5 Connect them

Render → `winter-league-demo-api` → **Environment** → set `APP_URL` to the demo site address (no trailing slash). Save; Render redeploys.

## 2.6 Check it

Open the site and sign in with `WinterDemo2026`:

1. **`gkim`:** the dashboard shows the season and (if loaded with a schedule) upcoming games; **Programs** lists the spreadsheet's programs.
2. **`crogers`** (or whoever the load printed as Director 1): **Requests** shows a badge, when loaded with a schedule.
3. **`acoleman`** on a phone: **My games** shows a **Check-in is open** card. If it says check-in opens on game day, `DEMO_CHECKIN_ANYTIME` isn't `true`.
4. **`pnair`:** **Assignments** shows November filled (with a schedule) or nothing to assign yet (without).

**Optional:** as `gkim`, open **Branding & Theme** (avatar menu → League admin) to set the conference name, upload a logo, and pick a theme.

---

# 3. Refreshing a demo

Use this **any time the demo database already has a league in it**: after a meeting, after editing the spreadsheet, after updating the code, or to switch between the two styles. The first-time commands in section 2.2 deliberately refuse to overwrite an existing demo.

## Local

In `backend/`, then restart `npm run dev` in both folders:

```bash
npm run db:reset                    # with a schedule
npm run db:reset -- --no-schedule   # without a schedule
```

## Hosted

One command, in `backend/`. `--replace` clears everything in the demo database first, so there's no need to delete or recreate anything in Turso, and no tokens or Render settings change:

```bash
node src/scripts/seedDemo.js --env=.env.demo.local --force --replace                # with a schedule
node src/scripts/seedDemo.js --env=.env.demo.local --force --replace --no-schedule  # without a schedule
```

It prints `🧹 Replacing everything in winter-league-demo-…turso.io…`, then the new league and logins. **Everything from the previous demo is deleted**, which is the point. Anyone signed in should sign in again afterwards.

> **`npm run db:reset` never touches a hosted database.** It only ever replaces your local file, which is why the hosted refresh uses the command above.

**If a new version of the code adds database changes,** Render applies them when it deploys (that's `npm run start:render`). If you refresh a hosted demo and see "Something went wrong on the server", apply them from your machine:
```bash
node src/scripts/migrate.js --env=.env.demo.local
```

---

# 4. Before each demo

- **Wake the server** a few minutes early by opening the site: free Render services sleep after ~15 minutes idle, and the first request then takes 30–60 seconds.
- **Open one browser tab per person** you'll sign in as; each tab keeps its own sign-in.
- **Refresh the demo** (section 3) if it's been used before, so approved requests and check-ins from last time are gone.
- Have [DEMO.md](./DEMO.md) open for the walkthrough.

# 5. Keeping the demo stable

Both demo services redeploy whenever `main` changes, so the demo always runs the latest code. To freeze it for a presentation:

1. Create a `demo` branch from `main`.
2. Set **Branch** to `demo` on the Render service and the Vercel project.
3. Merge `main` into `demo` when you want the demo updated.

# 6. Things to know

- **The demo season is Winter 2026–27** (Nov 2, 2026 – Feb 28, 2027), fixed in the loader. Demos work best before or during that season; after it, there are no upcoming games and the dates in `backend/src/scripts/seedDemo.js` should be moved forward.
- **Demo check-ins and scores count** toward the demo's payouts and results. That's expected.
- **Anyone with the address can sign in** with the shared password. Share it only with the people you're presenting to, and never put real data in a demo.

# 7. Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| `seed:demo only runs against a local SQLite database` | `--force` missing | Add `--force` (intentional for hosted databases). |
| `Demo data already present — nothing to do. To load a fresh demo over it, add --replace.` | The demo database already has a league, and the command you ran was the first-time one | Run the same command with `--replace` added, e.g. `node src/scripts/seedDemo.js --env=.env.demo.local --force --replace` (see [section 3](#3-refreshing-a-demo)). |
| The spreadsheet is listed with problems | A typo or missing value | Fix the rows it names and run again. Nothing was written. |
| `Tables not found. Run the migration first` | The demo database has no tables yet | `node src/scripts/migrate.js --env=.env.demo.local` (step 2.2), then load again. |
| `401` / `UNAUTHORIZED` | The token is wrong, or from a database you recreated | `turso db tokens create winter-league-demo`, update `.env.demo.local` **and** Render, redeploy. |
| Your laptop's demo changed instead of the hosted one | `--env=.env.demo.local` was left off | Include it in every hosted command. |
| `Demo spreadsheet not found` | Run from the wrong folder | Run these commands from `backend/`. |
| `Something went wrong on the server` on the site | Database updates not applied | Check Render's Start Command is `npm run start:render`, redeploy; or run `migrate.js` (section 3). |
| Sign-in fails with a network or CORS error | `APP_URL` doesn't match the site address | Match it exactly (2.5), no trailing slash. |
| `/api/health` says `"database":"local-sqlite"` | `DATABASE_URL` missing on Render | Add it and the token (2.3), redeploy. |
| Referees see "Check-in opens on game day" | `DEMO_CHECKIN_ANYTIME` not `true` | Set it on Render (2.3) and redeploy, or in `backend/.env` locally. |
| No upcoming games anywhere | Today is after the demo season | See section 6. |

# 8. Tearing down a hosted demo

1. Vercel → `winter-league-demo` → Settings → **Delete Project**.
2. Render → `winter-league-demo-api` → Settings → **Delete Web Service**.
3. `turso db destroy winter-league-demo` (check the name says `-demo`).
4. Delete `backend/.env.demo.local` from your machine.
