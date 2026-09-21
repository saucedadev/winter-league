# Winter League Platform — Program Directors' demo

A 15–20 minute walkthrough that follows one season end to end: directors enter gym time, the league builds and publishes a schedule, a coach asks for a change, and referees are assigned, check in, and get paid. All accounts use the password **`WinterDemo2026`**.

## Before the meeting

**Where to run it.** Use your own machine, or a separate throwaway deployment. **Never** load demo data into the real league database.

- **On your laptop (simplest):** in `backend/.env` set `DEMO_CHECKIN_ANYTIME=true`, then run `npm run db:reset` and restart `npm run dev` in both folders.
- **Hosted demo:** create a second Turso database (e.g. `winter-league-demo`) and a second Render service pointing at it, with `DEMO_CHECKIN_ANYTIME=true`. Load it from your machine with a `.env.demo.local` file:
  `node src/scripts/migrate.js --env=.env.demo.local` then `node src/scripts/seedDemo.js --env=.env.demo.local --force`.

**Why demo mode:** check-in normally opens only on game day, 60 minutes before tip-off. Demo mode opens it for every upcoming game so you can show it in September. Turn it off afterwards.

**Tabs.** Each browser tab keeps its own sign-in, so open one tab per person ahead of time: `dwhitfield`, `mbell`, `gkim`, `tgreene`, `pnair`, and `acoleman`. For the referee, a phone (hosted demo) or the browser's phone view (F12 → device toolbar) makes the point best.

**Rehearse once.** The demo league is generated fresh on every reset, so team pairings and dates differ slightly each time. The steps below don't depend on specific games.

## The walkthrough

### 1. What directors do (Dana Whitfield, `dwhitfield`, Northfield) — 3 min
- **Dashboard → Get your program ready.** A checklist of everything the league needs: gyms with map coordinates, teams, coaches, game slots, and blackouts.
- **Gym slots.** The week board with Practice, Weeknight game, and Weekend game block slots. Add a slot with **Repeat weekly** and point out that it skips blackout dates by itself. Slot cards show how many games are scheduled in them.
- **Blackouts.** Thanksgiving and winter break are already in. Blackouts hide the gym time underneath them without deleting it.

*Talking point:* directors only ever see and change their own program. That's enforced on the server, not just hidden in the screens.

### 2. Building the schedule (Grace Kim, `gkim`, System Admin) — 4 min
- **Schedule builder.** Walk through the rules: games per team, game length, travel cap, days between games, games per week, **most games against the same opponent** (default 2), and **teams from the same program can play each other** (default Off, so a program's A and B teams never meet). Click **Generate draft**.
- Point out any **Notes from the matchmaker** about small divisions (e.g. "got 4 of 8 games: 2 possible opponents and a limit of 2"). That's the rematch limit working as intended; raise it to 4 and regenerate to show the trade-off.
- Read the summary cards: games placed, home/away balance, longest trip, and anything needing attention. Read one line from **Notes from the matchmaker**.
- **Team balance** tab: find a bold row, go back to **By date**, and use **Flip** or **Move** on one of that team's games. The Move dialog only offers times that pass every rule.
- **Publish schedule.** Point out the warning: publishing replaces the current schedule and says how many referee assignments carry over.

*Talking point:* the matchmaker produces a draft for a person to review, not a final answer. That's deliberate.

### 3. A coach asks for a change (Tasha Greene, `tgreene`) — 2 min
- **Schedule → My teams.** Choose **Request change** on a game against Riverbend, pick **Move this game**, choose a new time, and give a reason.
- Point out the line under the reason explaining the path: her director, then the other program, then the league.

### 4. The approval chain — 3 min
- **Dana (`dwhitfield`) → Requests.** The nav badge shows it's waiting on her. Click **Endorse**.
- **Marcus (`mbell`) → Requests.** Click **Agree** as the other program.
- **Grace (`gkim`) → Requests.** Click **Approve & apply**. The game moves, and the **Decided** tab shows what it was and where it went.

*Talking point:* at every step the change is re-checked against the live schedule. If something else took that slot in the meantime, sign-off stops and says why.

### 5. Referees (Priya Nair, `pnair`, Referee Assignor) — 3 min
- **Dashboard → Referee coverage:** upcoming slots, how many are still open, and how many are open in the next two weeks.
- **Assignments.** Move to a December week and click **Auto-fill this week**. Open a slot to show why each referee can or can't take it: already working, marked unavailable, or back-to-back at another gym.
- **Referees.** The roster, pay overrides (Avery Coleman is on $50), and unavailable dates.

### 6. Game day (Avery Coleman, `acoleman`, on a phone) — 2 min
- **My games.** Directions and who they're working with. Tap **I'm here: check in** and allow location; the check-in records how far they are from the gym.
- Mention **Can't make it** (before game day) and **Dates I can't work**, and that both reach the assignor.

### 7. Paying referees (`pnair`) — 1 min
- **Payouts.** Set the dates to cover the game just checked in. Expand Avery to see the game, then **Download summary (CSV)**.

*Talking point:* the league pays from the CSV in its own system; no money moves through this app. Assigned games that nobody confirmed are flagged so nothing is paid by accident.

## Questions that usually come up
- **Can we change the rules?** Yes. Games per team, game length, travel cap, rest days, games per week, referees per game, pay, and the check-in window are all settings.
- **What if a gym closes mid-season?** Add a blackout. Affected published games are flagged in the schedule builder for the league to move, and moving them tells the referees.
- **Do coaches need accounts?** Only to see "My teams" and request changes. The published schedule is visible to every account.
- **Do parents get access?** Not in this version.

## Afterwards
Set `DEMO_CHECKIN_ANYTIME` back to `false`. If you used a hosted demo, delete the demo Render service and demo Turso database, or keep them for training.
