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

Outside clubs the league plays now and then are **guest programs**, set up further down the same page. See [Guest (non-conference) teams](#guest-non-conference-teams).

### 3. Accounts
**Menu → League admin → Users → Add user.** Choose the person's role and, for Program Directors and Coaches, their program.

**Username.** As you type the first and last name, the **Username** box fills in with the username the app will create (first initial and last name, e.g. *mdiaz*, with a number added if it's taken). It's locked so it can't be changed by accident. To use a different one (say, to fix a typo in the name), click **🔒 Edit username**, then type it. It's checked as you type: 3–30 characters (lowercase letters, numbers, and `.` `_` `-`), and not already taken. **Create account** stays greyed out until it's fine. **Use the suggested username** locks it again and goes back to the generated one.

![The username, filled in from the name](/help/img/sa-username-preview.png)

Under **Temporary password**, choose:
- **Generate one for me** (the default): the app makes a readable one, e.g. *Cedar-4821-Pivot*.
- **Set it myself**: type the password you want to give them, or click **Suggest one** and adjust it. It must be at least 10 characters with a letter and a number, and the box tells you what's missing. Click **Show** to check what you typed and note it down (**Hide** masks it again).

The next screen shows the username and temporary password **once**. The password is masked; click **Show** to see it, or **Copy sign-in details** to send both. They choose their own password the first time they sign in.

![Adding a user with a temporary password you set](/help/img/sa-add-user.png)

![Users](/help/img/sa-users.png)

- **Sorting and searching:** click **Name**, **Role**, **Program**, or **Last sign-in** to sort; search by name, username, or email; filter by role.
- **Someone locked out?** Open their account and choose **Issue temporary password…**. Pick **Generate one for me** or **Set it myself** (with **Show** and **Suggest one**, as above), then **Issue password**. Their old password stops working straight away, and the new one is shown once for you to share. Activity records that a temporary password was issued, and whether you set it, but never the password itself.
- **Fixing a username:** open the account and click **🔒 Change username**, then type the corrected one (checked as you type, as above) and **Save account**. They sign in with the new username from then on. Their password doesn't change, they're emailed the new username, and Activity records the change. **Keep the current username** cancels it.

  ![Changing a username](/help/img/sa-username-change.png)
- **Someone leaving?** Untick **Active** in their account. They can no longer sign in, but their history stays.
- Referees can also be added by the Referee Assignor on the **Referees** page.
- **Program directories:** Program Directors keep a contact list under **Directory** (coaches without an account yet, referees, team managers, and so on). Those contacts aren't accounts and can't sign in. You can see every program's directory under **Programs & gyms → Directory** (pick a program in the header to see just one). A Directory coach can be a team's head coach until you create their Coach account; the director then switches the team over in one click.

| Role | What they do |
|---|---|
| System Admin | Everything in this guide |
| Program Director | Runs one program: venues, teams, gym slots, blackouts, and approving its schedule changes |
| Coach | Sees their teams' schedule and asks for changes |
| Referee Assignor | Manages referees: roster, assignments, attendance, and payouts |
| Referee | Sees their games, checks in, and marks dates they can't work |

### 4. Branding & Theme
**Menu → League admin → Branding & Theme.** Set the name shown across the app and in emails, upload a logo (PNG, JPEG, WebP, or SVG under 300 KB), and pick the sitewide color theme. The preview shows your changes before you save.

![Branding & Theme](/help/img/sa-branding.png)

**Emails** use the same branding. Every email the app sends has the app name across the top (it's also the sender's name in the inbox), your logo beside it, buttons in the theme's color, and a footer saying the inbox isn't monitored and who to contact instead: coaches are pointed to their program director, referees to the assignor, and directors and the assignor to you. The **Emails** section at the bottom of the page shows a sample that updates as you edit, before you save.

- **Logo in emails:** email apps don't show SVG logos, so when you save, the server also makes a small PNG copy of your logo for emails. Emails load it from the web, so for it to show reliably the server needs image storage (Vercel Blob) set up once: see EMAIL-SETUP.md, Step 6. If it isn't, **Send me a test email** says so. Until you upload a logo, emails use the built-in hexagon mark in the theme's colors.
- **Send me a test email** sends the sample to your own address, so you can check how it looks in your inbox and that sending works. If the server isn't set up to send yet, it says so (the email is only written to the server log); see EMAIL-SETUP.md for setting up Brevo.

![The Emails section with the sample email](/help/img/sa-branding-emails.png)

## Building and publishing the schedule

Once programs have entered their gym slots, blackouts, and teams, the Schedule builder creates the season's games. Nothing is visible to coaches, directors, or referees until you publish.

### 1. Check the rules
**Menu → Scheduling → Schedule builder.**

![Matchmaker rules](/help/img/sa-builder-rules.png)

| Rule | What it does | Default |
|---|---|---|
| Games per team | The target for every team | 8 |
| Game length | Each game slot is split into back-to-back games this long | 60 minutes |
| Travel cap | Furthest the away team should travel (a program can have its own, lower cap, see below) | 30 miles |
| Days between games | 2 means at least one day off between a team's games | 2 |
| Games per week | Most games one team plays Monday–Sunday | 2 |
| Most games against the same opponent | How often the same two teams can meet | 2 |
| Teams from the same program can play each other | Off means a program's own teams never meet | Off |

#### Division overrides
The rules above apply to every division. When one division needs something different, add a **division override** under the rules instead of changing the league value for everyone. For now, the setting a division can override is **Most games against the same opponent**.

1. Under **Division overrides**, choose the division and click **Add override**.
2. Pick that division's value (1–6, or **No limit**). It starts one step above the league value, since the usual reason is a small division that needs more rematches to reach its games-per-team target.
3. Click **Generate draft** (or **Regenerate draft**). Overrides, like the other rules, are saved when you generate.

Every other division keeps the league value. To go back to the league value, click **Remove** next to the division. "Same as the league value" next to a row means the override currently changes nothing.

**When to use one:** the matchmaker's notes say a team "got 4 of 8 games: it has 2 possible opponents in 7th Grade Boys and a limit of 2 games against each". Rather than raising the limit for the whole league, give just that division an override of 4.

After you generate, a line above the notes shows the overrides the draft was built with (for example, *Built with division override: 7th Grade Boys — at most 4 games against the same opponent*). Each draft keeps its own copy of the rules, so changing an override later doesn't change a draft or published schedule already built. If an override is what leaves teams short, the note says so and tells you to raise the division override. The Activity log records override changes with the rules.

#### Program overrides (travel cap)
A program can have its own **travel cap**, lower than the league's, for example if a club doesn't want its teams driving more than 15 miles. It applies whenever that program's teams travel.

1. Under **Program overrides**, choose the program and click **Add override**.
2. Enter its **Travel cap (miles)**. It must be lower than the league's **Travel cap** above; a higher one would push longer trips onto opponents who didn't agree to them. The row warns you if it isn't.
3. Click **Generate draft** (or **Regenerate draft**). The override is saved with the rules.

How the matchmaker uses it:
- **Placing a game:** the away team's program cap applies. When the program with the override is the away team, its own cap applies; when it hosts, the visiting program's cap applies.
- **Pairing:** two teams are paired if at least one of them can travel to the other. So if Northfield has a 15-mile cap and Riverbend is 25 miles away, Riverbend (league cap 30) can still come to Northfield. Every Northfield–Riverbend game is then at Northfield's gyms, and Riverbend never hosts Northfield.
- If neither can travel to the other (both have caps shorter than the distance between them), their teams aren't paired, and the notes say so with both caps.

**What it costs:** the program hosts more of its own games, so home/away balance shifts (it has more home games, its opponents more away games), and its gyms need enough game slots. If its teams end up short, the notes name the override, for example: *"Northfield 5th Boys got 6 of 8 games: Northfield's own 15-mile travel cap means its teams can't travel to Riverbend, so those games have to be at Northfield's gyms. More Northfield game slots, or a higher cap, would help."*

Directors can't set a cap themselves; they ask the league, and you add it here. After you generate, a line above the notes shows it (*Built with program override: Northfield Hawks — 15-mile travel cap*). When you move a game by hand, times where a team would travel past its program's cap are flagged with that cap.

### 2. Generate a draft
Click **Generate draft** (or **Regenerate draft** to start over). It takes a few seconds. Changed rules are saved when you generate.

**Day preferences.** Directors can tag game slots for girls', boys', or one division's games (e.g. *girls on Mondays*) under **Gym slots → Tag game slots**, and you can too for any program. A **Priority** tag means those games take the slot first, before an untagged slot in the same week, and other games use it only if nothing else fits anywhere. An **Only** tag means no other game is ever placed there. The notes report how tagged slots were used, e.g. *"Girls priority slots: 7 of 14 game times used by Girls games; 2 went to other games because nothing else fit"* or *"Girls-only slots: 7 of 14 used; 7 left open (other games can't use them)."* When you move or place a game by hand, a slot kept **only** for other games isn't offered (and is refused), and a **priority** slot for other games is marked so you can avoid it.

![A draft schedule](/help/img/sa-builder-draft.png)

Read the summary cards (games placed, home/away balance, longest trip, season span, anything needing attention) and **Notes from the matchmaker**, which explain in plain words anything it couldn't do, such as a team left short of games and which setting would fix it.

### 3. Review and adjust
- **By date:** every game. **Move** picks a new time from a list that already passes every rule; **Flip** swaps home and away; **Unplace** takes a game off the calendar but keeps the pairing; **Remove** deletes the pairing from the draft.
- **Unplaced:** pairings the matchmaker couldn't fit. Use **Place game** to put them somewhere by hand, or **Remove** to drop one.
- **Team balance:** each team's games and home/away count. Bold rows are more than one game off 50/50 or short of the target.

![Moving a game](/help/img/sa-builder-move.png)

![Team balance](/help/img/sa-builder-balance.png)

#### Removing and adding games
Not every pairing has to come from the matchmaker.

- **Remove** (drafts only) deletes a game from the draft after you confirm. Each team then has one game fewer, which shows on the **Team balance** tab. On the published schedule, games are **cancelled** instead, so there's a record of them.
- **+ Add game** (next to the division filter) creates a game by hand, in the draft or on the published schedule:
  1. Choose the **Team**, then the **Opponent**. Each opponent shows how often the two teams already play and how many games it has. Opponents within the league rules are listed first.
  2. Pick a time. Like **Move**, the list only offers open game slots at either team's gyms that pass every rule (court free, no blackout, days between games, games per week). The court decides who hosts. In a draft you can instead tick **Add to Unplaced** and place it later.
  3. Add a reason if you like (it's kept with the game) and click **Add game**.

![Adding a game](/help/img/sa-builder-add.png)

**Exceptions.** Opponents that break a league rule (a team in another division, a team from the same program, or a pair that already meets as often as **Most games against the same opponent** allows) are listed under **Exceptions to the league rules**. Choosing one shows which rule it breaks. To add it anyway, tick **Add it anyway, as an exception** and say why. The rule and your reason are kept with the game, which shows an **Exception** badge (hover over it for the details). Games added by hand show an **Added** badge.

![Adding a game as an exception](/help/img/sa-builder-exception.png)

If either team would go over **Games per team**, the dialog says so. That's a note, not a block.

> **Regenerating a draft** starts over from the rules, so games you added or removed in the draft are lost. Make those edits last.

### 4. Share with directors and collect sign-offs
Before a draft can be published, every program with teams in it has to sign off. The **Director review** panel sits between the rules and the draft.

1. Pick a **Sign-off deadline** (a week from today to start with) and click **Share with directors**. Each Program Director is emailed. They see **only their own program's games**, read-only, under **Draft review**. Coaches, referees, and the assignor still see nothing until you publish.
2. The panel shows each program's status: **Waiting**, **Signed off**, or **Flagged**, with who decided and when.
3. **Flags.** A director who has a problem with a game flags it with a note (e.g. *"11/5 clashes with our school event"*). You're emailed, and the flag appears under **Flagged games**. Either fix the game (**Move**, **Flip**, **Remove**, **Add game**), or click **Resolve** and add a note explaining why it stays. The director is emailed either way and signs off when their games work. Signing off withdraws that program's open flags.
4. **Programs without a director.** Click **Sign off for them**. It's recorded as signed off by you *on the program's behalf*, so the record shows nobody from the program reviewed it. Programs with a director always sign off themselves.
5. **Changes after sign-off.** When you change a game in a shared draft, only the programs in that game go back to **Waiting**. Their directors are emailed with what changed, and the panel shows *"Needs to review again: …"*. Every other program keeps its sign-off.

![Director review](/help/img/sa-draft-review.png)

**Change** next to the deadline moves it (it can't be in the past). **Regenerate draft** starts a brand-new draft that has to be shared and signed off again.

### 5. Publish
**Publish schedule** unlocks when every program has signed off. Until then it's greyed out, with a line saying how many programs are still to sign off. Coaches, directors, and referees see the schedule as soon as it's published. **Discard draft** throws a draft away without affecting anything published.

**Publishing without every sign-off.** Once the deadline has passed (the day after the deadline date, Pacific time), the button becomes **Publish anyway…**. It lists the programs that haven't signed off and asks why you're publishing now. The override is recorded on the schedule (who, when, which programs, and your note), in **Activity**, and in the Schedule builder's **Published** view. Before the deadline there's no override. Move the deadline if you need to.

> **Publishing again later** replaces the current schedule. The app warns you first: open change requests on the old schedule are cancelled, and referee assignments carry over only to games that didn't change.

### Changes after publishing
In the Schedule builder, switch to **Published** to move, flip, **Cancel**, or **Restore** a live game, or use **+ Add game** to add one. An added game goes live straight away: both teams' directors and coaches are emailed, both programs see it in Activity, and it gets referee slots for the assignor to fill. Cancelling asks for a reason, which shows on everyone's schedule next to the game; **Restore** puts it back and clears the reason. Coaches and directors can also ask for a cancellation through a change request, which comes to you for sign-off like any other. Every change is logged and both teams' directors see it. Referees on a moved game stay on it if they're still free; otherwise they're removed and emailed. Cancelling a game releases its referees.

## Guest (non-conference) teams

A guest team is a team from outside the league, such as *Sherwood 6th Boys*, that a league team plays now and then. Guest games are played at the league team's gym and otherwise work like any other game: court checks, referees, check-in, scores, payouts, and Activity.

### Setting up a guest program
**Menu → League admin → Programs**, then **Guest programs** below the league's programs.

1. Click **Add guest program** and enter its name, short code, and city. A guest program doesn't take one of the league's program spots.
2. On its card, add a team for each division it plays in: type the team name, choose the division, and click **Add team**. The teams can be reused all season.

![Guest programs](/help/img/sa-guest-programs.png)

Guest programs are kept out of the rest of the app on purpose. They have no venues, gym slots, blackouts, directors, or coaches, and they don't appear in program pickers or the setup checklist. **Deactivate** a guest team (or make the whole program inactive) to stop it being offered for new games. A team with games can't be removed, only deactivated.

### Adding a guest game
The matchmaker never schedules guests. Add guest games by hand with **+ Add game** in the Schedule builder, choosing the league team first and then the guest team (marked *guest* in the opponent list). You can also choose a guest team first, under **Guest teams** in the team list.

![Adding a guest game](/help/img/sa-guest-add.png)

- **Where:** only open game slots at the league team's gyms are offered, so the league team always hosts. Two guest teams can't play each other.
- **Rules:** the usual opponent rules apply. A guest team in another division, or over the rematch limit, is an exception that needs a reason.
- **Counting:** guest games don't count toward **Games per team** or home/away balance. The **Team balance** tab shows them in a separate **Guest games** column, and adding one never triggers the "over the target" note.
- **Marked everywhere:** guest teams show *(guest)* after their name and the game has a **Guest game** badge, on every schedule, the assignor's board, and the payout export.

![A guest game on the schedule](/help/img/common-guest-game.png)

Coaches and directors can also ask for a guest game with **Request a game**. There's no guest director to agree, so their request comes straight to you after their own director's endorsement. The same goes for moving or cancelling a guest game.

## Final scores

Coaches and directors of the two teams enter final scores after each game, and you can enter or correct any game's score the same way: **Schedule → Enter score** or **Edit score**. When you enter or correct one, both teams' coaches and directors are emailed. See the [Coach guide](/help/coach#entering-the-final-score) for the steps.

- Every entry, correction, and clearing is in **Activity**, with who made it and the previous score, so disagreements can be settled from the record.
- A game with a final score can't be moved, unplaced, or cancelled until its score is cleared. **Flip** swaps the scores along with home and away.
- Republishing the schedule keeps scores on games that didn't change.

## Change requests: league sign-off

Coaches and directors ask for changes from the Schedule page: moving, swapping, or cancelling a game, or adding an extra one (**Request a game**). A request goes to the requesting coach's own director, then to every other program involved, and finally to you.

**Menu → League → Requests.** Requests waiting on you say **Needs your decision**.
- **Approve & apply** checks the change against the schedule as it is right now, then applies it. If something has taken that time in the meantime, it tells you, and you can deny with a note so the requester can pick another time.
- **Deny** needs a short note for the requester. You can deny at any stage.
- A request to **add a game** (marked **Add game**) creates the game when you approve it, after checking again that the time is still free and the two teams are still within the league rules. Requests can't be exceptions. If a team needs a game outside the rules, add it yourself with **+ Add game**. A request involving a guest team skips the "other program" step, since guests have no director.

![A request waiting for league sign-off](/help/img/sa-requests-signoff.png)

## Activity

**Menu → League admin → Activity** lists every change across the league, newest first: who did it (with their program or role) and which programs it involves. Filter by type with the buttons at the top.

![Activity](/help/img/sa-activity.png)

## Referees and everything else

Program Directors can export referee payouts for their own program's games; you and the Referee Assignor see the whole league. As a System Admin you can also do everything a Program Director and the Referee Assignor can. For step-by-step instructions, see the [Program Director guide](/help/program-director) (gym slots, blackouts, venues, teams), the [Referee Assignor guide](/help/referee-assignor) (assignments and payouts), the [Coach guide](/help/coach), and the [Referee guide](/help/referee).
