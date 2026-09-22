# System Admin guide

System Admins run the league: they set up seasons, programs, and accounts, build and publish the schedule, give the final sign-off on schedule changes, and can see and do everything in {{appName}}.

{{gettingStarted}}

## Your dashboard

The dashboard shows the active season, referee coverage, upcoming games, and each program's setup progress, so you can see at a glance which programs still need to enter gym time, venues, or teams.

![The System Admin dashboard](/help/img/sa-dashboard.png)

The **All programs** dropdown in the header narrows pages like Gym slots, Venues, and Teams to one program. Set it back to **All programs** to see the whole league.

## Setting up a new season

Do these in order before programs start entering gym time.

### 1. The season and divisions
**Menu → League admin → League setup.**
- **Season:** **Add season** with its first and last day, and use **Make active** if it isn't already the active season. Only one season is active at a time; gym slots, blackouts, and the schedule all belong to it.
- **Divisions:** the grade and gender groups teams play in (e.g. *6th Grade Girls*). The league starts with ten; rename, add, or deactivate them to match your league. Teams only ever play teams in their own division.

![League setup](/help/img/sa-league-setup.png)

### 2. Programs
**Menu → League admin → Programs → Add program.** Each club or organisation is a program, with a name, a 2–6 letter short code (e.g. *GYB*), and contact details. The bar at the top shows how many of the league's program spots are used.

![Programs](/help/img/sa-programs.png)

### 3. Accounts
**Menu → League admin → Users → Add user.** Choose the person's role and, for Program Directors and Coaches, their program. The app creates a username and a **temporary password, shown once**. Use **Copy sign-in details** to send them. They choose their own password the first time they sign in.

![Users](/help/img/sa-users.png)

- **Sorting and searching:** click **Name**, **Role**, **Program**, or **Last sign-in** to sort; search by name, username, or email; filter by role.
- **Someone locked out?** Open their account and choose **Issue temporary password**.
- **Someone leaving?** Untick **Active** in their account. They can no longer sign in, but their history stays.
- Referees can also be added by the Referee Assignor on the **Referees** page.

| Role | What they do |
|---|---|
| System Admin | Everything in this guide |
| Program Director | Runs one program: venues, teams, gym slots, blackouts, and approving its schedule changes |
| Coach | Sees their teams' schedule and asks for changes |
| Referee Assignor | Manages referees: roster, assignments, attendance, and payouts |
| Referee | Sees their games, checks in, and marks dates they can't work |

### 4. Branding and theme
**Menu → League admin → Branding & theme.** Set the name shown across the app and in emails, upload a logo (PNG, JPEG, WebP, or SVG under 300 KB), and pick the sitewide color theme. The preview shows your changes before you save.

![Branding & theme](/help/img/sa-branding.png)

## Building and publishing the schedule

Once programs have entered their gym slots, blackouts, and teams, the Schedule builder creates the season's games. Nothing is visible to coaches, directors, or referees until you publish.

### 1. Check the rules
**Menu → Scheduling → Schedule builder.**

![Matchmaker rules](/help/img/sa-builder-rules.png)

| Rule | What it does | Default |
|---|---|---|
| Games per team | The target for every team | 8 |
| Game length | Each game slot is split into back-to-back games this long | 60 minutes |
| Travel cap | Furthest the away team should travel | 30 miles |
| Days between games | 2 means at least one day off between a team's games | 2 |
| Games per week | Most games one team plays Monday–Sunday | 2 |
| Most games against the same opponent | How often the same two teams can meet | 2 |
| Teams from the same program can play each other | Off means a program's own teams never meet | Off |

### 2. Generate a draft
Click **Generate draft** (or **Regenerate draft** to start over). It takes a few seconds. Changed rules are saved when you generate.

![A draft schedule](/help/img/sa-builder-draft.png)

Read the summary cards (games placed, home/away balance, longest trip, season span, anything needing attention) and **Notes from the matchmaker**, which explain in plain words anything it couldn't do, such as a team left short of games and which setting would fix it.

### 3. Review and adjust
- **By date:** every game. **Move** picks a new time from a list that already passes every rule; **Flip** swaps home and away; **Unplace** takes a game off the calendar.
- **Unplaced:** pairings the matchmaker couldn't fit. Use **Place game** to put them somewhere by hand.
- **Team balance:** each team's games and home/away count. Bold rows are more than one game off 50/50 or short of the target.

![Moving a game](/help/img/sa-builder-move.png)

![Team balance](/help/img/sa-builder-balance.png)

### 4. Publish
Click **Publish schedule**. Coaches, directors, and referees see it immediately. **Discard draft** throws a draft away without affecting anything published.

> **Publishing again later** replaces the current schedule. The app warns you first: open change requests on the old schedule are cancelled, and referee assignments carry over only to games that didn't change.

### Changes after publishing
In the Schedule builder, switch to **Published** to move, flip, **Cancel**, or **Restore** a live game. Every change is logged and both teams' directors see it. Referees on a moved game stay on it if they're still free; otherwise they're removed and emailed. Cancelling a game releases its referees.

## Final scores

Coaches and directors of the two teams enter final scores after each game, and you can enter or correct any game's score the same way: **Schedule → Enter score** or **Edit score**. When you enter or correct one, both teams' coaches and directors are emailed. See the [Coach guide](/help/coach#entering-the-final-score) for the steps.

- Every entry, correction, and clearing is in **Activity**, with who made it and the previous score, so disagreements can be settled from the record.
- A game with a final score can't be moved, unplaced, or cancelled until its score is cleared. **Flip** swaps the scores along with home and away.
- Republishing the schedule keeps scores on games that didn't change.

## Change requests: league sign-off

Coaches and directors ask for changes from the Schedule page. A request goes to the requesting coach's own director, then to every other program involved, and finally to you.

**Menu → League → Requests.** Requests waiting on you say **Needs your decision**.
- **Approve & apply** checks the change against the schedule as it is right now, then applies it. If something has taken that time in the meantime, it tells you, and you can deny with a note so the requester can pick another time.
- **Deny** needs a short note for the requester. You can deny at any stage.

![A request waiting for league sign-off](/help/img/sa-requests-signoff.png)

## Activity

**Menu → League admin → Activity** lists every change across the league, newest first: who did it (with their program or role) and which programs it involves. Filter by type with the buttons at the top.

![Activity](/help/img/sa-activity.png)

## Referees and everything else

As a System Admin you can also do everything a Program Director and the Referee Assignor can. For step-by-step instructions, see the [Program Director guide](/help/program-director) (gym slots, blackouts, venues, teams), the [Referee Assignor guide](/help/referee-assignor) (assignments and payouts), the [Coach guide](/help/coach), and the [Referee guide](/help/referee).
