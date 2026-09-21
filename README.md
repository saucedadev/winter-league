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
- **Themes:** the same four sitewide themes as Gym Hive (Light, Dark, Regal Opulence, Midnight Noir), chosen by the System Admin.
- Referee payments are intentionally out of scope.

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

## Backend scripts

| Script                  | What it does |
|-------------------------|--------------|
| `npm run dev`           | Start the API with auto-restart on file changes. |
| `npm run migrate`       | Apply any new migrations in `src/db/migrations/`. Safe to run repeatedly. |
| `npm run seed`          | Create the first System Admin, starter divisions and default theme. Idempotent and production-safe. |
| `npm run seed:demo`     | Local demo data. Refuses to run against Turso. |
| `npm run db:reset`      | Delete the local database file and rebuild it (migrate + seed + demo). Local only. **Restart `npm run dev` afterwards.** |
| `npm run migrate:prod`  | Run migrations against Turso using `.env.production.local`. |
| `npm run seed:prod`     | Seed the production Turso database using `.env.production.local`. |
| `npm run start:render`  | What Render runs: migrate, then start the server. |
| `npm run test:smoke`    | 28 API checks (auth, program isolation, slot rules). Run with the API up and demo data loaded. |

## Deploying

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for step-by-step Turso, Render and Vercel setup.
