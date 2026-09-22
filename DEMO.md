# Winter League Platform — Program Directors' demo

A 15–20 minute walkthrough that follows one season end to end: directors enter gym time, the league builds and publishes a schedule, a coach asks for a change, and referees are assigned, check in, and get paid. All accounts use the password **`WinterDemo2026`**.

**Pick a walkthrough:**

| | Loads with | Best when |
|---|---|---|
| **A. Ready-made league** | `npm run db:reset` | You want to show every screen quickly. The schedule is already published, November already has referees, and two sample change requests are waiting. |
| **B. Full process** | `npm run db:reset -- --no-schedule` | You want the audience to watch the season get built: nothing is published until you generate and publish it live, then referees are assigned from scratch. |

Both use the same programs, venues, directors, teams, gym slots, and referee roster. The only difference is whether a schedule already exists.

## Before the meeting

**Where to run it.** Use your own machine, or a separate throwaway deployment. **Never** load demo data into the real league database.

- **On your laptop (simplest):** in `backend/.env` set `DEMO_CHECKIN_ANYTIME=true`, then run `npm run db:reset` (walkthrough A) or `npm run db:reset -- --no-schedule` (walkthrough B), and restart `npm run dev` in both folders. The reset loads the programs, venues, and directors from the demo spreadsheet (`backend/demo-data/`) and prints every login, plus a "For the DEMO.md walkthrough" list of who plays each part below.
- **Hosted demo (a web address everyone can open):** follow **[DEMO-DEPLOYMENT.md](./DEMO-DEPLOYMENT.md)**, which covers creating the demo database, loading the demo league, the Render and Vercel setup, and refreshing it between meetings.

**Why demo mode:** check-in normally opens only on game day, 60 minutes before tip-off, and final scores can only be entered from tip-off. Demo mode opens both for every upcoming game so you can show them in September. Turn it off afterwards.

**Tabs.** Each browser tab keeps its own sign-in, so open one tab per person ahead of time: `msauceda`, `dlumpkin`, `gkim`, `tgreene`, `pnair`, and `acoleman`. For the referee, a phone (hosted demo) or the browser's phone view (F12 → device toolbar) makes the point best.

**Rehearse once.** The demo league is generated fresh on every reset, so team pairings and dates differ slightly each time. The steps below don't depend on specific games.

**If the spreadsheet changes,** the people above may change too. Directors 1 and 2 are the directors of the first two programs on the Programs sheet, and Tasha coaches for the first program. The reset's "For the DEMO.md walkthrough" list always names them.

## Walkthrough A: ready-made league

### 1. What directors do (Misty Sauceda, `msauceda`, Glencoe) — 3 min
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
- **Schedule → My teams.** Choose **Request change** on a game against Forest Grove, pick **Move this game**, choose a new time, and give a reason.
- Point out the line under the reason explaining the path: her director, then the other program, then the league.

### 4. The approval chain — 3 min
- **Misty (`msauceda`) → Requests.** The nav badge shows what's waiting on her: the new request plus two sample ones. Click **Endorse** on Tasha's.
- **Dan (`dlumpkin`, Forest Grove) → Requests.** Click **Agree** as the other program.
- **Grace (`gkim`) → Requests.** Click **Approve & apply**. The game moves, and the **Decided** tab shows what it was and where it went.

*Talking point:* at every step the change is re-checked against the live schedule. If something else took that slot in the meantime, sign-off stops and says why.

### 5. Referees (Priya Nair, `pnair`, Referee Assignor) — 3 min
- **Dashboard → Referee coverage:** upcoming slots, how many are still open, and how many are open in the next two weeks.
- **Assignments.** Move to a December week and click **Auto-fill this week**. Open a slot to show why each referee can or can't take it: already working, marked unavailable, or back-to-back at another gym.
- **Referees.** The roster, pay overrides (Avery Coleman is on $50), and unavailable dates.

### 6. Game day (Avery Coleman, `acoleman`, on a phone) — 2 min
- **My games.** Directions and who they're working with. Tap **I'm here: check in** and allow location; the check-in records how far they are from the gym.
- Mention **Can't make it** (before game day) and **Dates I can't work**, and that both reach the assignor.
- **Tasha (`tgreene`) → Schedule:** choose **Enter score** on one of her games, enter both teams' points, and **Save score**. The score replaces "vs" on everyone's schedule with a **Final** badge. *Talking point:* either team's coach or director can enter it, the other side is emailed, and every entry or correction shows in both programs' Activity.

### 7. Paying referees (`pnair`) — 1 min
- **Payouts.** Set the dates to cover the game just checked in. Expand Avery to see the game, then **Download summary (CSV)**.

*Talking point:* the league pays from the CSV in its own system; no money moves through this app. Assigned games that nobody confirmed are flagged so nothing is paid by accident.

## Walkthrough B: full process (build and publish live)

Load with `npm run db:reset -- --no-schedule` (hosted demo: see [DEMO-DEPLOYMENT.md](./DEMO-DEPLOYMENT.md), step 2.4). Allow about 20–25 minutes. The same people play the same parts; the reset prints them under "For the DEMO.md walkthrough".

### 1. Before there's a schedule — 2 min
Show that nobody has games yet, which makes the moment of publishing land:
- **Tasha (`tgreene`, coach) → Schedule:** "The schedule hasn't been published yet".
- **Avery (`acoleman`, referee, on a phone) → My games:** "No upcoming games".
- **Priya (`pnair`, assignor) → Dashboard:** Referee coverage says slots appear once the league publishes the schedule.

### 2. What directors give the league (Misty, `msauceda`) — 3 min
- **Dashboard → Get your program ready:** the checklist of what the league needs from each program.
- **Gym slots:** the week board. *Talking point:* weeknight and weekend game slots are the only time the matchmaker uses for games; practice slots are left alone.
- **Blackouts:** Thanksgiving and winter break are already in.

### 3. Building the schedule (Grace, `gkim`) — 5 min
- **Schedule builder** shows "No schedule yet". Walk through the rules: games per team, game length, travel cap, days between games, games per week, **most games against the same opponent** (default 2), and **teams from the same program can play each other** (default Off).
- Click **Generate draft**. It takes a few seconds.
- Read the summary cards: games placed (every pairing placed), home/away balance (typically every team within one game of 50/50), longest trip, season span, and needs attention.
- **Team balance** tab: every team's home and away count. **By date:** Move or Flip one game to show the admin can adjust anything before publishing.
- *Talking point:* the draft is private. Switch to Tasha's tab and refresh: still "hasn't been published yet".
- Back as Grace, click **Publish schedule**. The dialog says how many games everyone will see. Confirm.

### 4. It's live — 2 min
- **Tasha:** refresh **Schedule**. Her team's games appear, each with **Request change**. Her **Dashboard** now shows Upcoming games.
- **Misty:** **Schedule → My program** shows all of Glencoe's games.

### 5. Assigning referees from scratch (Priya, `pnair`) — 4 min
- **Assignments:** every slot is open (the header says e.g. "0 of 296 upcoming referee slots filled").
- Click **Auto-fill all upcoming** and confirm. With the demo's 8 referees it fills roughly two-thirds of the slots. The rest stay open because several games tip off at the same time and nobody is double-booked.
- *Talking point:* open one of the still-open slots to show why each referee can't take it (already working at that time, marked unavailable, back-to-back at another gym). Then **Referees → Add referee** is how the assignor would close the gap.
- **Avery:** refresh **My games**. Their assigned games are there.

### 6. A change request and the approval chain — 4 min
- **Tasha → Schedule → My teams:** **Request change** on a game against Forest Grove, pick **Move this game**, choose a time, give a reason. It goes to her director first.
- **Misty → Requests:** the badge shows 1 waiting. **Endorse**.
- **Dan (`dlumpkin`, Forest Grove) → Requests:** **Agree** as the other program.
- **Grace → Requests:** **Approve & apply**. The game moves, and any referee who can't make the new time is taken off and emailed.
- *Talking point:* **Activity** shows every step to both programs involved.

### 7. Game day and payouts — 3 min
Same as walkthrough A, steps 6 and 7: Avery checks in on a phone, Tasha enters the final score, then Priya's **Payouts** shows the game and exports the CSV.

## Questions that usually come up
- **Can we change the rules?** Yes. Games per team, game length, travel cap, rest days, games per week, referees per game, pay, and the check-in window are all settings.
- **What if a gym closes mid-season?** Add a blackout. Affected published games are flagged in the schedule builder for the league to move, and moving them tells the referees.
- **Do coaches need accounts?** Only to see "My teams" and request changes. The published schedule is visible to every account.
- **Do parents get access?** Not in this version.
- **How will people learn the app?** Everyone has **Help & user guide** at the bottom of the menu: a step-by-step guide for their role, with screenshots, and a **Download PDF** button to print or email it.

## Afterwards

To run the other walkthrough next time, reset with the other command (see the table at the top).

Set `DEMO_CHECKIN_ANYTIME` back to `false`. If you used a hosted demo, delete the demo Render service and demo Turso database, or keep them for training.
