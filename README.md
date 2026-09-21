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
- **Themes:** Gym Hive's four sitewide themes (Light, Dark, Regal Opulence, Midnight Noir) plus the league's own **Pacific Youth Conference** theme (navy, teal, sand, sunset orange, and a gold accent line), chosen by the System Admin.
- Referee payments are intentionally out of scope.

## Phase 2 – Scheduling (in draft form)

- **Matchmaker (Module B).** The System Admin opens **Schedule builder**, checks the rules, and generates a draft. The matchmaker is a deliberately simple, deterministic heuristic: it builds a round-robin within each division, then places each game in an open weeknight or weekend game slot at the home team's program. Hard rules it never breaks: same-division games only, no court booked twice, no program blackout days, minimum days between a team's games, maximum games per team per week, and the travel cap (straight-line miles from the away program to the gym). A second pass evens out home/away. Anything it can't place is listed under **Unplaced** instead of being dropped.
- **Rules** (System Admin, saved in `app_settings`): games per team (default 8), game length (60 min; each game slot is split into back-to-back games), travel cap (30 mi), days between a team's games (2), games per team per week (2).
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

Sign in as:

- `ladmin` / `ChangeMe123!` — the seeded System Admin (you'll be asked to change the password).
- Demo accounts, all with password `WinterDemo2026`: `gkim` (System Admin), `dwhitfield` and `mbell` (Program Directors), `tgreene` and `lortega` (League Coaches), `pnair` (Referee Assignor), `obrooks` (Referee).
- The demo comes with a published schedule, 8 referees (`obrooks`, `acoleman`, `rchen`, `sdelgado`, `mhayes`, `cnovak`, `dokafor`, `jpike`) with November already assigned, and two open change requests. One is waiting on `dwhitfield` to endorse a coach's request, and one is waiting on her to agree to Riverbend's request. Sign in as `gkim` and open **Schedule builder** to generate a new draft, or as `pnair` to assign referees. The demo league differs slightly each time you reset, because record IDs are random.

## Backend scripts

| Script                  | What it does |
|-------------------------|--------------|
| `npm run dev`           | Start the API with auto-restart on file changes. |
| `npm run migrate`       | Apply any new migrations in `src/db/migrations/`. Safe to run repeatedly. |
| `npm run seed`          | Create the first System Admin, starter divisions and default theme. Idempotent and production-safe. |
| `npm run seed:demo`     | Local demo data, including a published schedule and sample requests. Refuses to run against Turso. |
| `npm run db:reset`      | Delete the local database file and rebuild it (migrate + seed + demo). Local only. **Restart `npm run dev` afterwards.** |
| `npm run migrate:prod`  | Run migrations against Turso using `.env.production.local`. |
| `npm run seed:prod`     | Seed the production Turso database using `.env.production.local`. |
| `npm run start:render`  | What Render runs: migrate, then start the server. |
| `npm run test:smoke`    | 119 API checks (auth, program isolation, slot rules, matchmaker rules, approval chain, referee assignment, check-in, payouts). Run against freshly reset demo data with the API up in normal mode (not demo check-in mode). |

## Deploying

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for step-by-step Turso, Render and Vercel setup.
