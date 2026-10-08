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
- **Back-to-back games (stacking)**, built into the matchmaker (`scheduling/matchmaker.js`): among a week's usable windows it picks by stack score (next to a single game > next to a stacked game > a time with a free neighbor > an isolated time), then earliest; a repair pass (2c) moves leftover single games next to another game at the home program's gyms, or pulls another home game in beside them, within three weeks either side, re-checking every hard constraint and keeping home/away. "Back to back" allows for the buffer plus 30 minutes between courts at one venue. `summary.stackedGames` / `singleGames` and a draft note report the result.
- **Inactive programs** are left out of every program drop-down (navbar switcher, ProgramPicker, the Users form; `ctx.activePrograms`) and come back when reactivated; the API refuses putting a new account in an inactive program (`validateRoleProgram`), while people already in one can still be edited.
- **Buffer between games** (`bufferMinutes`, 0–60, default 0, in the schedule rules): `carveWindows` leaves that many minutes between game windows on a court (none after the last game). Move/Place options skip times inside the buffer; a time placed by hand inside it gets a warning, not an error.
- **Schedule CSV export:** **Download CSV** on the Schedule page (the games shown, with the page's filters), the Schedule builder (draft or published, one division or all, with travel miles) and Draft review (the director's program). Built in the browser from the games the page already loaded (`utils/scheduleCsv.js`), so it matches the screen and the user's permissions; UTF-8 with a BOM for Excel, and cells starting with `= + - @` are escaped.
- **Editing gym slots in blocks:** slots added together share `series_id` (a block; `GET /api/slots` returns `block: { count, first, last, weekdays, fromHere }`). `PUT /api/slots/:id` takes `scope`: `one` (default), `following`, or `all`. A block edit applies only the fields that differ from the opened slot (court, times, type, Keep for, notes; never the date), skips and reports dates where a published game would no longer fit or the time overlaps another slot, and sends draft games that no longer fit back to unscheduled. A slot may grow around its published games (single edits too).
- **Gym slots over a date range:** `POST /api/slots` takes `startDate`, optional `endDate` and `weekdays` [0–6, …] (e.g. Mondays and Wednesdays from Nov 2 to Jan 15), up to 250 slots in one series; the older `date` + `repeatWeeklyUntil` still works.
- **Branding:** the app name and logo are sitewide settings the System Admin sets on **Branding & Theme** (avatar menu → League admin). The sitewide color theme is chosen on the same page. The name appears in the header, on the sign-in page, in the browser tab, and in account emails. An uploaded logo (PNG, JPEG, WebP, or SVG, under 300 KB) replaces the built-in hexagon mark and becomes the browser-tab icon. Defaults: "Winter League" and the built-in mark.
- **Branded emails** (`utils/emailTemplate.js`, `utils/email.js`). Every email is sent as HTML plus a plain-text version: a band with the app name and logo in the theme's accent color, the message (a paragraph whose first line ends with ":" shows its other lines in a details box), an optional button (`action: { label, url }`), and a footer saying the inbox isn't monitored and who to contact, by the recipient's role. The sender name is the app name; `EMAIL_FROM` supplies the address. Images are linked by web address, because Brevo doesn't deliver inline (`cid:`) images: the uploaded logo's PNG copy (made with `sharp` on save, `utils/emailLogo.js`) is published to Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, or served by the API (`GET /api/settings/email-logo/<hash>.png`) otherwise (`utils/emailLogoHost.js`; `branding.emailLogo` / `emailLogoUrl` are never sent to browsers). The built-in mark is pre-rendered per theme and served by the frontend from `/email/` (`frontend/public/email`). Branding & Theme has a live preview (`POST /api/settings/email-preview`) and **Send me a test email** (`POST /api/settings/email-test`). Set `EMAIL_PREVIEW_DIR` in console mode to save each email as an .html file.
- Referee payments are intentionally out of scope.

## Phase 2 – Scheduling (in draft form)

- **Matchmaker (Module B).** The System Admin opens **Schedule builder**, checks the rules, and generates a draft. The matchmaker is a deliberately simple, deterministic heuristic: it builds a round-robin within each division, then places each game in an open weeknight or weekend game slot at the home team's program. Hard rules it never breaks: same-division games only, no court booked twice, no program blackout days, minimum days between a team's games, maximum games per team per week, and the travel cap (straight-line miles from the away program to the gym). A second pass evens out home/away. Anything it can't place is listed under **Unplaced** instead of being dropped.
- **Rules** (System Admin, saved in `app_settings`): games per team (default 8), game length (60 min; each game slot is split into back-to-back games), travel cap (30 mi), days between a team's games (2), games per team per week (2), most games against the same opponent (1–6 or no limit; default 2), and whether teams from the same program can play each other (default Off). **Division overrides** (stored with the rules as `divisionOverrides: { [divisionId]: { maxVsSameOpponent } }`) let one division use its own rematch limit while every other division keeps the league value; the matchmaker applies them per division, each draft's rules snapshot records them, and more rules can be added to the override list later (`DIVISION_OVERRIDE_KEYS` in `scheduling/core.js`). **Program overrides** (`programOverrides: { [programId]: { maxTravelMiles } }`, `PROGRAM_OVERRIDE_KEYS`) give a league program its own travel cap, lower than the league's only. `travelCapFor(rules, programId)` is the one place the effective cap is worked out: when placing a game the away program's cap applies (matchmaker, Move/Place, Add game, change requests), and two teams are paired if at least one of them can travel to the other, so a capped program hosts every game against programs beyond its cap. The notes name the override when it leaves teams short or blocks a pairing. Pairing happens in rounds where the teams furthest behind, with the fewest possible opponents, choose first and play everyone once before any rematch. When the opponent rules leave a team short of its target, the matchmaker's notes name the team and the setting to change.
- **Review and publish.** The builder shows placed/unplaced counts, home/away balance, travel, and blackout conflicts, and lets the admin Move, Place, Flip home/away, Unplace, **Remove** (drafts only), or (once published) Cancel/Restore any game, and **Add game** by hand to a draft or the published schedule. Every edit is checked against the same rules. An added game's time is picked from open windows that pass every placement rule; a pairing that breaks an opponent rule (another division, same program, over the rematch limit) can only be added as an explicit exception with a reason, recorded on the game (`games.added_by/added_at/added_reason/exception_note`, migration 008; logic in `scheduling/addGame.js`). Publishing makes the schedule visible to everyone; publishing a newer draft replaces it (after confirmation) and cancels open requests on the old one. The builder's lists follow the header's program switcher (one program's games, home and away; summary and notes stay league-wide), and flag games **On its own** (no other game within buffer + 30 minutes before or after at the same venue that day, the matchmaker's stacking test, recomputed in the browser after every edit), with an **On their own (N)** filter and a note in the CSV.
- **Program Directory** (migration 012: `directory_contacts`, `teams.head_coach_contact_id`; `routes/directory.js`). A program's contact list (first/last name, optional email, phone, and role: coach, referee, or a typed-in role). Contacts are not accounts. Program Directors manage their own; System Admins see all. A Directory coach can be a team's head coach until a Coach account replaces them (`POST /api/directory/:id/switch-to-account`).
- **Usernames** are previewed live from the name on Add user (`GET /api/users/username-suggestion`) and can be set or corrected by a System Admin after unlocking the field (`username` on POST/PUT `/api/users`, checked by `GET /api/users/username-check`; 3–30 of `a-z 0-9 . _ -`, unique). A changed username is emailed to the user and logged.
- **Day preferences** (migrations 011 and 013: `gym_slots.reserved_divisions`, a JSON list of division ids, and `reserved_mode` prefer/only; 013 converted the old girls/boys/one-division tags, and `reserved_for` / `reserved_division_id` are no longer used). A slot can be kept for any mix of divisions, labelled compactly, e.g. *4th–6th Grade Boys & Girls* (`divisionsLabel`). Directors tag game slots one at a time or in bulk (`POST /api/slots/tag`: `weekdays` [0–6, …], optionally one venue and a date range, `reservedDivisionIds`). The matchmaker takes slots tagged for a game before untagged ones in the same week; slots tagged *prefer* for other games only as a last resort (both hosts tried first); *only* slots never. Move/Place/Add/change requests refuse *only* slots for other games and warn on *prefer* ones (`reservationFit` in `scheduling/core.js`). The draft notes report tagged-slot use.
- **Draft sharing and director sign-off** (migration 010, `scheduling/review.js`). The admin shares a draft (optionally with a deadline); each Program Director sees only their own program's games under **Draft review** and signs off or flags a game with a note. The admin resolves flags, and signs off on behalf of programs without a director (recorded, `draft_reviews.on_behalf`). Any admin edit to a shared draft puts only the two teams' programs back to *waiting* (`draftChanged`). Publishing requires every program with teams to have signed off; after the deadline it can be overridden, recorded in `schedule_runs.publish_override` and Activity. `npm run demo:signoff` signs off the rest for demos (local only unless `--force`).
- **Change requests (Module D).** From **Schedule**, a coach or director picks *Request change* on one of their own games and either moves it to another open time, swaps it with another of their games, or cancels it outright (weather, a gym closure), giving a reason. **Request a game** asks for an extra game for one of their teams against an opponent within the league rules (type `add`: the request holds the two teams and the proposed time, and the game is created when the league signs off).
- **Rule requests** (migration 014: `rule_requests`, `rule_request_messages`; `routes/ruleRequests.js`, `components/RuleRequestsPanel.vue`). On **Requests → Rule requests** a Program Director tells the league what the program needs from the Matchmaker rules: a lower travel cap (`travel_cap`), a division's rematch limit (`rematch_limit`), a league rule (`league_rule`), or anything else (`other`), each with a reason. Only that program and the System Admins can see a request; coaches can't file them. The admin asks a question (status `question`, the director replies), accepts, declines with a note, or marks it noted (for things the matchmaker can't do by itself). Accepting a travel cap or rematch limit can write the program or division override into the rules in the same step, with the value adjustable (`applyToRules`, through the same `normalizeRules` checks as the Schedule builder). Accepted and noted requests stay **In effect** until the program withdraws them or the admin ends them, and are flagged for re-confirmation each new season (`confirmed_season_id`). Ending or withdrawing doesn't change the rules; the admin removes the override in the Schedule builder. A System Admin can record a request on a program's behalf. Every step is emailed to the other side and logged under Activity → Requests; the nav badge and the Schedule builder's rules panel show the counts (`GET /api/rule-requests/count`).
- **Guest (non-conference) teams.** A program can be a **guest** (`programs.is_guest`, migration 009): an outside club with teams, managed by the System Admin under Programs → Guest programs. Guests don't count toward the program cap and can't have venues, gym slots, blackouts, directors, or coaches (`utils/guests.js`). The matchmaker skips them; guest games are added by hand or requested, only at the league team's gyms (so the league team hosts). Requests involving a guest skip the counterpart step. Guest games don't count toward games per team or home/away balance (`pairingContext` counts them separately), and they're marked *(guest)* / **Guest game** on every schedule view and in the payout CSV. Approval chain: the requesting program's director endorses (coach requests only) → every other program involved agrees → the System Admin signs off, at which point the change is re-checked against the live schedule and applied. Denials need a note; the requester or their director can withdraw. Every step is logged and emailed. A cancelled game stays on the schedule marked **Cancelled** with its reason, and its referees are released; a System Admin can cancel directly (a reason is required) or **Restore** it.
- **Final scores.** After tip-off, a coach of either team, either team's Program Director, or a System Admin enters the final score (with an optional note, e.g. *Forfeit*) from **Schedule → Enter score**. It shows on everyone's schedule. The other side is emailed, and every entry, correction, or clearing is in both programs' Activity. Played games waiting for a score are counted on the dashboard and listed with **Needs a score**. A scored game can't be moved, unplaced, cancelled, or put up for a change request until its score is cleared; flipping home/away swaps the scores; republishing keeps scores on unchanged games. `DEMO_CHECKIN_ANYTIME=true` also opens score entry any day, for demos.
- **Live-schedule protection.** Gym slots holding published games can't be deleted or changed; slot cards show how many games they hold. New blackouts report which published games they hit, and those games are flagged. Teams with scheduled games can't be deleted (deactivate them instead).

Scheduling code lives in `backend/src/scheduling/`: `core.js` (pure rule helpers), `matchmaker.js` (pure draft builder, no database access), and `data.js` (loading inputs, saving drafts, and the placement checker shared by admin edits and requests).

## Phase 3 – Referees & rollout

- **Referee slots.** When a schedule is published, every game gets referee slots (2 by default; set under Referees → Settings). Slots are topped up automatically when games are placed or restored.
- **Assigning (Referee Assignor and System Admin).** **Assignments** shows the published games a week at a time. Click a slot to see every referee, with the reason anyone can't take it: already workruse at that time, a date they marked unavailable, or back-to-back at a different gym. **Auto-fill** (this week or all upcoming) fills open slots with whoever has the fewest games so far, and never double-books anyone or uses a conflict. Referees get an email for each new game.
- **Roster and pay.** The assignor adds referees on **Referees**; each gets a username and temporary password. Pay is a league default (default $40 per game) with an optional per-referee rate. The rate is locked in when a game is checked in, so later rate changes don't rewrite what's owed. Deactivating a referee removes them from their upcoming games.
- **For referees.** **My games** is built for a phone: each game shows directions, partners, and a **Can't make it** button (before game day; the assignor is emailed). Referees list **Dates I can't work**, and both auto-fill and the assignor's list respect them. **Check-in** opens 60 minutes before tip-off and closes 3 hours after (both adjustable). If the phone shares its location, the distance from the gym is recorded; check-in works without it.
- **Attendance and payouts.** On or after game day the assignor can **Mark as worked** or **Mark no-show**. **Payouts** previews what each referee is owed for a date range, warns about assigned games nobody confirmed, and exports a summary CSV and a per-game detail CSV. No money moves through the app. Program Directors can export the same detail for their own program's games. The detail CSV has one row per game worked: referee, email, date, home team, away team, check-in time (in league time, not UTC), how attendance was confirmed, and the amount.
- **Who pays each referee** (`payersFor`, `splitCents`, `paidByLabel` in `referees/data.js`; no stored column, so it applies to every game, past and future). Programs pay referees, one each: the home program pays position 1 and the away program position 2. When only one referee is on the game (the other slot open or a no-show) the two programs pay half each (an odd cent goes to home). Guest programs pay like any other (always the away side, so position 2; labelled *(guest)*, `isGuest` on the `programs` rows); they have no director, so their total shows only in the league report. A game between two teams of one program is paid in full by that program. `GET /api/referees/payouts` returns one `detail` row per payment (`paidByProgramId`, `paidByName`, `isSplit`, `fullCents`, `amountCents`, `splitWith`, `others` = the rest of the crew and who pays them), `summary` per referee, and `programs` (what each program owes). A Program Director gets only the payments their program makes, so two programs' reports never overlap; `totals.games` counts referee-games once. CSV: `type=detail` adds **Paid by** and **Share**, `type=programs` is one row per program. Each assignment from `gamesWithAssignments` carries a `paidBy` label, shown to referees on **My games**.
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
  - Program Directors from the demo spreadsheet, e.g. `crogers` (Glencoe) and `tlehman` (Forest Grove).
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
- **Generated around the spreadsheet:** director logins (first initial + last name, e.g. `crogers`), teams (each program enters 5 of 6 divisions; the 1st and 4th programs field a Competitive and a Developmental 6th Grade Girls team), gym slots on every court, blackouts, a published schedule, referee assignments for November, and two sample change requests. `tgreene` coaches for the 1st program and `lortega` for the 2nd.
- **Unchanged whatever the spreadsheet says:** the referees, the Referee Assignor, the System Admins, and the coaches' accounts.
- A different file: `npm run db:reset -- --file=path/to/league.xlsx`.
- **Refresh a hosted demo:** `node src/scripts/seedDemo.js --env=.env.demo.local --force --replace` clears the demo database and loads a fresh league in one command (see [DEMO-DEPLOYMENT.md](./DEMO-DEPLOYMENT.md)). `npm run db:reset` only ever replaces your local database file.
- **No schedule yet:** `npm run db:reset -- --no-schedule` loads everything except the schedule: no published games, referee assignments, or sample change requests. That lets a demo generate and publish the season live ([DEMO.md](./DEMO.md), walkthrough B).

**Automated tests use a separate built-in test league** (Northfield, Riverbend, `dwhitfield`, `mbell`, …), so editing the spreadsheet never breaks them. Before `npm run test:smoke`, load it with `npm run db:reset:test` and restart the API; the tests stop with a reminder if the spreadsheet league is loaded instead.

## Backend scripts

| Script                  | What it does |
|-------------------------|--------------|
| `npm run dev`           | Start the API with auto-restart on file changes. |
| `npm run migrate`       | Apply any new migrations in `src/db/migrations/`. Safe to run repeatedly. |
| `npm run seed`          | Create only the first System Admin (League Admin) from `SEED_ADMIN_*`. `-- --with-divisions` also adds the 10 starter divisions. Idempotent and production-safe; on Turso it refuses placeholder values (`admin@example.com`, `ChangeMe123!`). |
| `npm run seed:demo`     | Demo league from the demo spreadsheet, including a published schedule and sample requests. `-- --no-schedule`: nothing published; `-- --draft`: a draft waiting in the Schedule builder; `-- --draft --share`: that draft already shared with the directors for sign-off. Refuses to run against Turso unless `--force`. |
| `npm run demo:signoff`  | Demos only: signs off the shared draft for every program still waiting (recorded as done by the demo script). Local only unless `--force`. |
| `npm run db:reset`      | Check the demo spreadsheet, then delete the local database file and rebuild it (migrate + seed + demo). Local only. **Restart `npm run dev` afterwards.** |
| `npm run db:reset:test` | The same, but with the built-in test league the smoke tests need. |
| `npm run db:reset:empty` | Rebuild the local database with only the System Admin (`ladmin`): no demo league. The same starting point as a new production database. |
| `npm run migrate:prod`  | Run migrations against Turso using `.env.production.local`. |
| `npm run seed:prod`     | Seed the production Turso database using `.env.production.local` (System Admin only). |
| `npm run db:reset:prod` | **Empties** the database in `.env.production.local` (all league data, tables kept), then creates only the System Admin. Without `-- --confirm=<database name>` it only shows what's there. `--keep-branding`, `--with-divisions` optional. For go-live from a UAT database; see [DEPLOYMENT.md](./DEPLOYMENT.md#going-live-from-your-uat-database). |
| `npm run start:render`  | What Render runs. The server applies any pending database updates itself at startup, and stops with the reason if one fails. |
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
- **Sending email (Brevo):** **[EMAIL-SETUP.md](./EMAIL-SETUP.md)**, domain authentication, SMTP key and Render settings.
- **Demo copies (local or hosted):** **[DEMO-DEPLOYMENT.md](./DEMO-DEPLOYMENT.md)**, loaded from the demo spreadsheet, with or without a schedule.
- **Running the demo meeting:** **[DEMO.md](./DEMO.md)**.
