# Winter League Platform

A standalone web app for running a multi-program youth basketball winter league. It is a sibling to Gym Hive: same stack, same look and feel, same auth approach, but its own codebase, its own database, and its own user accounts.

| Layer    | Tech                                  | Local                          | Production        |
|----------|---------------------------------------|--------------------------------|-------------------|
| Frontend | Vue 3 + Vite + Tailwind v4 + Pinia    | `http://localhost:5174`        | Vercel            |
| Backend  | Express (Node 20+)                     | `http://localhost:4100`        | Render            |
| Database | libSQL via `@libsql/client`           | SQLite file `backend/data/`    | Turso             |

The same backend code talks to the local SQLite file or to Turso. Only `DATABASE_URL` / `DATABASE_AUTH_TOKEN` change.

## Phase 1 – Foundation (what's in this build)

- **Accounts & roles:** System Admin (`super_admin`), Program Director, League Coach (`league_coach`), Referee Assignor, Referee. JWT Bearer tokens in `sessionStorage` (the Safari-safe approach from Gym Hive), forced password change on first sign-in, forgot username / password flows, activity log.
- **League structure:** seasons, divisions, up to 16 programs (`MAX_PROGRAMS`), venues with courts (lat/long stored for the Phase 2 travel rule), teams.
- **Program Director screens:** Gym slots week board (Practice / Weeknight game / Weekend game block), weekly repeats that skip blackout dates, "this and following weeks" edits, blackout dates per venue or whole program.
- **Program isolation:** a Program Director can only read and write their own program. This is enforced on the server, not just hidden in the UI.
- **Themes:** Gym Hive's four sitewide themes (Light, Dark, Regal Opulence, Midnight Noir) plus two of the league's own: **Pacific Energy** (navy, teal, sand, sunset orange, and a gold accent line) and **Midnight Pacific** (a dark version: midnight navy with electric teal and sunset coral), chosen by the System Admin.
- **Time zone:** the league runs on Pacific Time (`LEAGUE_TIMEZONE=America/Los_Angeles`, with daylight saving handled automatically). Game dates and times are stored as local Pacific wall-clock times. "Today", referee check-in windows, and timestamps all use the league zone on both the server (which itself runs on UTC) and every browser, whatever time zone a device is set to. Game screens say "All times Pacific Time", and the API prints the zone when it starts.
- **Branding:** the app name and logo are sitewide settings the System Admin sets on **Branding & theme** (avatar menu → League admin). The sitewide color theme is chosen on the same page. The name appears in the header, on the sign-in page, in the browser tab, and in account emails. An uploaded logo (PNG, JPEG, WebP, or SVG, under 300 KB) replaces the built-in hexagon mark and becomes the browser-tab icon. Defaults: "Winter League" and the built-in mark.
- Referee payments are intentionally out of scope.

## Phase 2 – Scheduling (in draft form)

- **Matchmaker (Module B).** The System Admin opens **Schedule builder**, checks the rules, and generates a draft. The matchmaker is a deliberately simple, deterministic heuristic: it builds a round-robin within each division, then places each game in an open weeknight or weekend game slot at the home team's program. Hard rules it never breaks: same-division games only, no court booked twice, no program blackout days, minimum days between a team's games, maximum games per team per week, and the travel cap (straight-line miles from the away program to the gym). A second pass evens out home/away. Anything it can't place is listed under **Unplaced** instead of being dropped.
- **Rules** (System Admin, saved in `app_settings`): games per team (default 8), game length (60 min; each game slot is split into back-to-back games), travel cap (30 mi), days between a team's games (2), games per team per week (2), most games against the same opponent (1–6 or no limit; default 2), and whether teams from the same program can play each other (default Off). Pairing happens in rounds where the teams furthest behind, with the fewest possible opponents, choose first and play everyone once before any rematch. When the opponent rules leave a team short of its target, the matchmaker's notes name the team and the setting to change.
- **Review and publish.** The builder shows placed/unplaced counts, home/away balance, travel, and blackout conflicts, and lets the admin Move, Place, Flip home/away, Unplace, or (once published) Cancel/Restore any game. Every edit is checked against the same rules. Publishing makes the schedule visible to everyone; publishing a newer draft replaces it (after confirmation) and cancels open requests on the old one.
- **Change requests (Module D).** From **Schedule**, a coach or director picks *Request change* on one of their own games and either moves it to another open time or swaps it with another of their games. Approval chain: the requesting program's director endorses (coach requests only) → every other program involved agrees → the System Admin signs off, at which point the change is re-checked against the live schedule and applied. Denials need a note; the requester or their director can withdraw. Every step is logged and emailed.
- **Live-schedule protection.** Gym slots holding published games can't be deleted or changed; slot cards show how many games they hold. New blackouts report which published games they hit, and those games are flagged. Teams with scheduled games can't be deleted (deactivate them instead).

Scheduling code lives in `backend/src/scheduling/`: `core.js` (pure rule helpers), `matchmaker.js` (pure draft builder, no database access), and `data.js` (loading inputs, saving drafts, and the placement checker shared by admin edits and requests).

## Phase 3 – Referees & rollout

- **Referee slots.** When a schedule is published, every game gets referee slots (2 by default; set under Referees → Settings). Slots are topped up automatically when games are placed or restored.
- **Assigning (Referee Assignor and System Admin).** **Assignments** shows the published games a week at a time. Click a slot to see every referee, with the reason anyone can't take it: already working at that time, a date they marked unavailable, or back-to-back at a different gym. **Auto-fill** (this week or all upcoming) fills open slots with whoever has the fewest games so far, and never double-books anyone or uses a conflict. Referees get an email for each new game.
- **Roster and pay.** The assignor adds referees on **Referees**; each gets a username and temporary password. Pay is a league default (default $40 per game) with an optional per-referee rate. The rate is locked in when a game is checked in, so later rate changes don't rewrite what's owed. Deactivating a referee removes them from their upcoming games.
- **For referees.** **My games** is built for a phone: each game shows directions, partners, and a **Can't make it** button (before game day; the assignor is emailed). Referees list **Dates I can't work**, and both auto-fill and the assignor's list respect them. **Check-in** opens 60 minutes before tip-off and closes 3 hours after (both adjustable). If the phone shares its location, the distance from the gym is recorded; check-in works without it.
- **Attendance and payouts.** On or after game day the assignor can **Mark as worked** or **Mark no-show**. **Payouts** previews what each referee is owed for a date range, warns about assigned games nobody confirmed, and exports a summary CSV and a per-game detail CSV. No money moves through the app.
- **Schedule changes.** A moved or swapped game keeps its referees if they're still free; anyone who now has a conflict is removed, and they and the assignor are emailed. Cancelled games release their referees. Republishing a schedule warns first, and referees stay on any game whose teams, date, time, and court didn't change.
- **Rollout.** Program Directors get a setup checklist on their dashboard (gyms, coordinates, teams, coaches, game slots, blackouts). The assignor gets a referee-coverage card. **[DEMO.md](./DEMO.md)** is a walkthrough script for the Program Directors' meeting.

Referee code lives in `backend/src/referees/data.js` (slots, conflicts, check-in windows, auto-fill, and the hooks the schedule code calls) and `backend/src/routes/referees.js`.

## Run it locally

```bash
# 1. Backend
cd backend
cp .env.example .env
npm install
npm run db:reset      # creates data/winter-league.db, migrates, seeds admin + demo data
npm run dev           # http://localhost:4100

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev           # http://localhost:5174  (proxies /api to :4100)
```

If the frontend stops with **"Port 5174 is already in use"**, an earlier dev server is still running (often in another terminal). Close it and run `npm run dev` again. To find it: `lsof -i :5174` on Mac/Linux, or `netstat -ano | findstr :5174` on Windows. The frontend is pinned to 5174 on purpose, because the backend only accepts requests from the addresses in `APP_URL`.

Sign in as:

- `ladmin` / `ChangeMe123!` — the seeded System Admin (you'll be asked to change the password).
- Demo accounts, all with password `WinterDemo2026`. The reset prints the full list; the ones you'll use most:
  - `gkim` (System Admin), `pnair` (Referee Assignor), `obrooks` and `acoleman` (Referees).
  - `tgreene` and `lortega` (League Coaches).
  - Program Directors from the demo spreadsheet, e.g. `msauceda` (Glencoe) and `dlumpkin` (Forest Grove).
- The demo comes with a published schedule, 8 referees (`obrooks`, `acoleman`, `rchen`, `sdelgado`, `mhayes`, `cnovak`, `dokafor`, `jpike`) with November already assigned, and two open change requests waiting on the first program's director. Sign in as `gkim` and open **Schedule builder** to generate a new draft, or as `pnair` to assign referees. Schedules differ slightly each time you reset, because record IDs are random.

## Demo data from a spreadsheet

The demo league's **programs, venues, and Program Directors** come from `backend/demo-data/WinterLeague-ProgramVenueDirector-DemoData.xlsx`, read every time you run `npm run db:reset`. To change the demo league, edit that file (or replace it with one that has the same sheet and column names) and reset again.

| Sheet | Columns |
|---|---|
| **Programs** | Program · Short code (2–6 letters/numbers) · City · Contact (email) · Contact phone |
| **Venues** | Program · Venue Name · Street address · City · State · Zip · Latitude · Longitude · Courts (e.g. `Main Gym, Aux Gym`) |
| **Directors** | First name · Last name · Email · Phone · Role (`Program Director`) · Program |

- **Columns are found by their header,** so their order doesn't matter. Program names on Venues and Directors must match the Programs sheet.
- **The file is checked before anything is deleted.** If it has a problem, the reset stops and lists each one by sheet and row (e.g. "Venues row 9: program 'Centry Youth Basketball' isn't on the Programs sheet"), and your current database is left as it was. Check a file without resetting: `node src/scripts/seedDemo.js --check`.
- **Email addresses are replaced with safe placeholders** (e.g. `misty.sauceda@demo.example`) so a demo can never email the real people. Keep the real addresses with `npm run db:reset -- --real-emails`, but only when email sending is off (`EMAIL_PROVIDER=console`).
- **Generated around the spreadsheet:** director logins (first initial + last name, e.g. `msauceda`), teams (each program enters 5 of 6 divisions; the 1st and 4th programs field a Competitive and a Developmental 6th Grade Girls team), gym slots on every court, blackouts, a published schedule, referee assignments for November, and two sample change requests. `tgreene` coaches for the 1st program and `lortega` for the 2nd.
- **Unchanged whatever the spreadsheet says:** the referees, the Referee Assignor, the System Admins, and the coaches' accounts.
- A different file: `npm run db:reset -- --file=path/to/league.xlsx`.
- **No schedule yet:** `npm run db:reset -- --no-schedule` loads everything except the schedule: no published games, referee assignments, or sample change requests. That lets a demo generate and publish the season live ([DEMO.md](./DEMO.md), walkthrough B).

**Automated tests use a separate built-in test league** (Northfield, Riverbend, `dwhitfield`, `mbell`, …), so editing the spreadsheet never breaks them. Before `npm run test:smoke`, load it with `npm run db:reset:test` and restart the API; the tests stop with a reminder if the spreadsheet league is loaded instead.

## Backend scripts

| Script                  | What it does |
|-------------------------|--------------|
| `npm run dev`           | Start the API with auto-restart on file changes. |
| `npm run migrate`       | Apply any new migrations in `src/db/migrations/`. Safe to run repeatedly. |
| `npm run seed`          | Create the first System Admin, starter divisions and default theme. Idempotent and production-safe. |
| `npm run seed:demo`     | Demo league from the demo spreadsheet, including a published schedule and sample requests. Refuses to run against Turso. |
| `npm run db:reset`      | Check the demo spreadsheet, then delete the local database file and rebuild it (migrate + seed + demo). Local only. **Restart `npm run dev` afterwards.** |
| `npm run db:reset:test` | The same, but with the built-in test league the smoke tests need. |
| `npm run migrate:prod`  | Run migrations against Turso using `.env.production.local`. |
| `npm run seed:prod`     | Seed the production Turso database using `.env.production.local`. |
| `npm run start:render`  | What Render runs: migrate, then start the server. |
| `npm run test:smoke`    | 148 API checks (auth, program isolation, slot rules, matchmaker and opponent rules, approval chain, referee assignment, check-in, payouts, branding, phone numbers). Run after `npm run db:reset:test`, with the API up in normal mode (not demo check-in mode). |
| `npm run test:demo-data` | 18 checks that the demo spreadsheet loads correctly and that broken files are rejected with clear messages. Needs no API or database. |

## Help pages and user guides

Everyone has **Help & user guide** at the bottom of the menu. It opens the guide for their role, with a contents list and screenshots, and a **Download PDF** button:

| Guide | Seen by |
|---|---|
| System Admin | System Admins (who can also open every other guide) |
| Program Director | Program Directors, plus the Coach guide |
| Coach | Coaches |
| Referee Assignor | the Referee Assignor, plus the Referee guide |
| Referee | Referees |

**Editing a guide:** each guide is one Markdown file in `frontend/src/help/` (`system-admin.md`, `program-director.md`, `coach.md`, `referee-assignor.md`, `referee.md`). They share `_getting-started.md` (signing in, the menu, time zone). In the text, `{{appName}}` becomes the conference's name from Branding, and links like `/help/coach` open another guide. Screenshots live in `frontend/public/help/img/`. The Help page shows edits as soon as the site is rebuilt.

**Rebuilding the PDFs after editing:** the downloadable PDFs are files in `frontend/public/guides/`, built from the same pages. In `frontend/`:
```bash
npx playwright install chromium     # one time per machine
npm run guides:pdf                  # or: npm run guides:pdf -- --name="Pacific Youth Conference"
```
Then commit `frontend/public/guides/`. `--name` sets the conference name printed in the PDFs (the Help pages always use the current Branding name).

## Deploying

- **Real league:** **[DEPLOYMENT.md](./DEPLOYMENT.md)**, with step-by-step Turso, Render and Vercel setup.
- **Hosted demo for presentations:** **[DEMO-DEPLOYMENT.md](./DEMO-DEPLOYMENT.md)**, a separate copy loaded from the demo spreadsheet.
- **Running the demo meeting:** **[DEMO.md](./DEMO.md)**.
