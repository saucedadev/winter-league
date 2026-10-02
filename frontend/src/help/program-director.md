# Program Director guide

Program Directors run one program in the league. You tell the league when and where your program can host games, keep your teams and venues up to date, and approve schedule changes that involve your teams. You only ever see and change your own program.

{{gettingStarted}}

## Your dashboard

**Get your program ready** lists what the league needs from you before it can build the schedule, and ticks each item off as you finish it. Once the schedule is published, the dashboard shows your upcoming games.

![A director's dashboard](/help/img/pd-dashboard.png)

## Venues and courts

**Menu → My program → Venues → Add venue.** Add each gym your program can host games in, with its address and **map coordinates** (latitude and longitude). The coordinates let the league keep travel reasonable for visiting teams.

Each venue has one or more **courts**. Type a name in **New court name** and choose **Add court**. Gym slots are entered per court.

![Venues](/help/img/pd-venues.png)

## Teams

**Menu → My program → Teams.** Add a team for each division your program enters, and choose its **coach**. Coaches see their team's schedule and can ask for changes. If a coach doesn't have an account yet, ask your league's System Admin to create one. Meanwhile you can pick them from your [Directory](#directory).

![Teams](/help/img/pd-teams.png)

A team that has games on the schedule can't be deleted. Untick **Active** instead.

## Directory

Your program's contact list: coaches, referees, team managers, gym contacts, anyone you need to reach quickly. **Menu → My program → Directory.**

![Directory](/help/img/pd-directory.png)

**Add contact** and enter:
- **First name** and **Last name** (required)
- **Email** and **Phone** (optional). In the list they're links, so you can email or call in one tap.
- **Role** (optional): **Coach**, **Referee**, or **Other (type it in)…** for anything else, e.g. *Team manager* or *Scorekeeper*. Roles you've typed before are suggested as you type, and you can filter the list by role.

![Adding a contact](/help/img/pd-directory-add.png)

A contact is **not an app account**. They can't sign in, and adding someone here doesn't create one. Only the league's System Admin creates accounts. Search finds a contact by name, email, phone, or role. The System Admin can see every program's directory.

### A coach without an account yet
Add them to the Directory with the role **Coach**. On **Teams**, open the team and choose them under **Head coach → From the Directory (no account yet)**. The team shows them with a **Directory** tag.

![A Directory coach on a team](/help/img/pd-team-directory-coach.png)

Because a Directory coach can't sign in, they won't see the schedule or be able to request changes. Ask the System Admin to create their Coach account. When it exists (same email, or same first and last name), their Directory entry says *"Now has a Coach account"*. Click **Use the account for their team(s)** to move every team they coach over to the real account in one step. The Directory entry stays, and you can remove it.

While a contact is the head coach of a team, you can't change their role away from Coach. Removing them from the Directory leaves their teams with no head coach (you're warned first).

## Gym slots

Gym slots are the times your program can offer the league. **Menu → My program → Gym slots.**

![The gym slots week board](/help/img/pd-gym-slots.png)

| Category | Used for |
|---|---|
| **Practice** | Your own practices. The league never schedules games here. |
| **Weeknight game** | League games on a weeknight, e.g. 6:30–9:00 PM. |
| **Weekend game block** | A longer block, e.g. Saturday 9:00 AM–3:00 PM, split into several back-to-back games. |

### Adding gym slots
1. Choose **Add gym slots** (or the **+** on any day).
2. Pick the court, category, **Start date**, and start and end time. For one date, that's all.
3. To repeat it, also pick an **End date**, e.g. *11/02/2026 to 1/15/2027*, and under **Repeat on** choose the days of the week, e.g. **Mon** and **Wed**, or **Tue**, **Wed** and **Thu**. The form says how many slots that makes. With **Skip blackout dates** ticked, dates that fall in a blackout are skipped, and the app lists any dates it skipped.
4. For game slots, you can also choose who they're kept for (see *Day preferences* below).

> **Make game slots long enough for two games.** Referees work games back to back, so the league's matchmaker stacks games at a gym: a second game is placed right after the first rather than on another day. A slot with room for only one game (e.g. 6:00–7:00 PM with 60-minute games) leaves that game on its own, which referees may not be able to cover. A 6:00–8:00 PM slot holds two.

![Adding gym slots](/help/img/pd-add-slots.png)

Use the arrows, **This week**, or **Go to** to move between weeks, and the category buttons to show one kind of slot. Open a slot to edit or delete it.

### Editing a block of gym slots
Slots you added together over a date range are a **block**. Open any one of them and the form says so, e.g. *"This slot is part of a block: Thursdays, Nov 5 – Jan 7 (10 dates)"*. Make your change, then choose what it applies to:

- **This date only:** just the slot you opened. The rest of the block stays as it is.
- **This and later dates:** this slot and every later date in the block.
- **Every date in the block.**

![Editing a block of gym slots](/help/img/pd-edit-block.png)

A block edit can change the **time**, **court**, **slot type**, **Keep for**, and **notes**. Only what you change is applied to the other dates: if you move the end time from 9:00 to 9:30, every date gets the new end time, and a date you gave a different court earlier keeps its court. To move a slot to another **date**, use **This date only**.

Some dates can't always change. They're skipped, and the app lists them with the reason, while the rest of the block is updated:
- a **published game** in the slot would no longer fit (you can make a slot longer around its games, but not shorter than them or onto another court; ask the league admin to move those games first);
- the new time would **overlap another slot** on the same court.

If the league has a **draft** schedule and a draft game no longer fits a changed slot, that game goes back to the league's Unplaced list, and the app tells you how many.

Deleting works the same way: **Delete this slot**, or **This and later dates in the block**. A slot with published games in it can't be deleted; its card says how many games are scheduled.

### Day preferences: keeping game slots for certain divisions
If, for example, your 4th to 6th grade teams play on Mondays and Wednesdays, keep those game slots for them. The league's matchmaker then gives those slots to their games first.

**Keep for** is a grid of grades and Boys/Girls. Tick any mix of divisions:
- click a grade (e.g. **4th grade**) to tick its boys' and girls' divisions;
- click **Boys** or **Girls** (or **All boys** / **All girls**) to tick every division of that gender;
- **Clear** unticks everything, so any game can use the slot.

The form shows the result, e.g. *Kept for: 4th–6th Grade Boys & Girls*.

**Tag many slots at once:** choose **Tag game slots**, pick the **Days** (e.g. *Mon* and *Wed*), optionally one **Venue** and a date range, then choose:
- **Keep for:** the divisions, as above.
- **How strictly?**
  - **Priority** (the default): those games get the slot first. Other games use it only if nothing else fits, so a priority tag never costs anyone games.
  - **Only**: no other games are ever placed there. If there aren't enough of those games, the slot stays empty, and other teams may end up short of gym time.

![Tagging game slots](/help/img/pd-tag-slots.png)

It changes your existing weeknight and weekend game slots; practice slots aren't affected. To tag a single slot, open it and use **Keep for**. New slots can be tagged when you add them. Tagged slots show a ★ line on the week board, e.g. *★ 4th–6th Grade Boys & Girls priority* or *★ Girls only*. To remove tags, use **Tag game slots** with no divisions ticked.

**What it can and can't do:** a tag decides which games are played **in your gyms**, so it covers your home games. Away games are at the other program's gyms, on their slots. A team also can't play two games too close together, so a team with two games in a week may still play one on another day. After the league generates a draft, its notes report how your tagged slots were used, e.g. *"4th–6th Grade Boys & Girls priority slots: 12 of 14 game times used by 4th–6th Grade Boys & Girls games."*

## Blackout dates

**Menu → My program → Blackouts.** Add dates your program, or one of its venues, can't be used: holidays, school events, building closures. Gym slots on those dates are shown hatched and aren't used for games. Removing a blackout makes them available again.

![Blackouts](/help/img/pd-blackouts.png)

If you add a blackout after the schedule is published and it covers games already scheduled, the app tells you how many, and the league admin sees them flagged to move.

## The schedule

**Menu → League → Schedule.** **My program** shows your teams' games; **Whole league** shows everyone's. Filter by division, program, or team.

![The published schedule](/help/img/pd-schedule.png)

Each game shows the referees assigned to it, or **Referees: not assigned yet** if the assignor hasn't filled them.

**Download CSV** saves the games you're looking at, with your filters, as a spreadsheet file you can open in Excel, Google Sheets, or Numbers: date, day, times, division, both teams and programs, venue, court and address, status, scores, referees, and notes (e.g. *Cancelled: gym closed*).

**Travel.** The league has one travel cap (30 miles by default) for how far a team travels to an away game. If your program needs a shorter one, ask the league to set a **program travel cap** for you. Your teams then never travel further than that, and opponents beyond it come to your gyms instead. That means more home games for your teams, so make sure you have enough game slots, and possibly fewer games if there isn't enough gym time.

## Reviewing the draft schedule

Before the league publishes a schedule, you're asked to check your program's games. When a draft is shared you get an email, and your **Dashboard** shows a card linking to it.

![The dashboard card](/help/img/pd-draft-dashboard.png)

**Menu → Scheduling → Draft review** shows every draft game involving your program (not other programs' games), read-only. Only you and the league can see it: coaches and referees see the schedule once it's published.

- **Sign off** if your games work. You can add a note for the league.
- **Flag** a game that doesn't work, with a note, e.g. *"11/5 clashes with our school event."* The league is emailed and either changes the game or replies. Either way you're emailed, and the reply shows under **Your flags**. When your games work, sign off. Signing off withdraws any flags still open.

![Draft review](/help/img/pd-draft-review.png)

**Download CSV** (above the list of games) saves your program's draft games as a spreadsheet file, e.g. to check them against school calendars or share with your coaches before you sign off. It's a snapshot: if the league changes the draft, download it again.

Please respond by the deadline shown at the top. If the league changes one of your games after you've signed off, your status goes back to **Waiting**, you're emailed with what changed, and the page shows it, so please review again. Changes to other programs' games don't affect your sign-off.

The league publishes once every program has signed off. If the deadline passes without a response, the league can publish anyway, and that's recorded.

## Referee payouts for your program

**Menu → My program → Referee payouts** shows the referees who worked **your program's games**, and what each is owed for them. Other programs' games aren't included.

1. Choose **From** and **To** dates and **Update**.
2. Expand a referee to see each game they worked for you.
3. **Download game detail (CSV)** gives one row per game, each detail in its own column so you can sort or filter in Excel or Google Sheets: **Referee**, **Email**, **Date**, **Home team**, **Away team**, **Checked in** (Pacific Time), **Confirmed by**, and **Amount**. **Download summary (CSV)** gives one row per referee.

![Referee payouts for a program](/help/img/pd-payouts.png)

Referees are paid by the league, not by your program; this is for checking and for your own records. If a warning says some assigned referees never checked in, the Referee Assignor confirms attendance for those games.

## Final scores

After a game, you or a coach of either team enter the final score. On **Schedule**, played games have an **Enter score** button from tip-off on game day; tick **Needs a score** to see the ones still waiting. Your dashboard says how many of your program's games need scores.

Enter each team's points, an optional note (e.g. *Forfeit*), and **Save score**. The other team's coach and director are emailed, and every entry or correction shows in both programs' Activity. Use **Edit score** or **Clear score** to fix a mistake. The [Coach guide](/help/coach#entering-the-final-score) has screenshots of each step.

## Change requests

When a game needs to change, anyone involved can ask. **Request change** on a game lets you **move this game** to another open time, **swap** it with another of your program's games, or **cancel** it if it can't be played at all (weather, a gym closure). Only times that fit every scheduling rule are offered, and a cancellation needs a reason.

![A cancellation waiting for a decision](/help/img/pd-cancel-request.png)

A cancelled game stays on the schedule marked **Cancelled** with the reason, so everyone can see what happened, and its referees are taken off.

### Requesting an extra game
To add a game for one of your teams, for example to replace a cancelled one, choose **Request a game** at the top of the **Schedule** page:

1. Choose your **Team** and the **Opponent**. Only opponents within the league rules are listed: the same division, another program, and not already played as often as the league allows. **Guest teams** (outside clubs the league has set up, marked *guest*) are listed too, for a non-conference game. If none are listed, your team already plays everyone it can. Contact the league if it needs a game outside the rules.
2. Pick a time. Every time listed is an open game slot at either team's gym that fits both teams' schedules, and the court decides who hosts.
3. Give a reason and choose **Send request**.

It follows the same path as other requests, and the game appears on the schedule, with referee slots, when the league signs off. Games added this way show an **Added** badge.

![A request to add a game](/help/img/pd-add-request.png)

### Guest games
A game against a guest team is always at one of your gyms, so only your times are offered. There's no guest director, so after you ask (or endorse your coach's request) it goes straight to the league. Guest games show *(guest)* after the guest team's name and a **Guest game** badge. They get referees and scores like any other game, but they don't count toward your team's games-per-team target or home/away balance.

Every request follows the same path:

1. **Your approval**, if one of your coaches asked.
2. **The other program's director** agrees.
3. **The league** gives final sign-off, and the change is applied.

**Menu → League → Requests** shows every request involving your program. The number on **Requests** is how many are waiting on you.
- **Endorse:** approve your own coach's request so it moves to the other program.
- **Agree:** accept another program's request involving your team.
- **Deny:** turn it down, with a short note explaining why.
- **Withdraw request:** cancel a request your program made, while it's still open.

![Requests waiting on a director](/help/img/pd-requests.png)

## Rule requests

Some things about the schedule only the league can set. A rule request is how you tell the league what your program needs, with the reason, and get an answer you can refer back to.

**First, what you can set yourself.** You don't need to ask for these:
- Dates your program can't play: [Blackout dates](#blackout-dates).
- When and where your gyms are free: [Gym slots](#gym-slots).
- Which divisions play on which days: **Keep for** on your gym slots ([Day preferences](#day-preferences-keeping-game-slots-for-certain-divisions)).

**What to ask the league for:**

| Choose | When |
|---|---|
| **A lower travel cap** | Your teams shouldn't travel as far as the league allows. Opponents beyond your cap come to your gyms instead, so you need enough game slots to host them. |
| **A division's rematch limit** | A division is small and its teams need to meet more often to reach their games, or you'd like fewer repeats. |
| **A league rule** | Games per team, game length, the buffer between games, days between games, games per week. These apply to every program. |
| **Something else** | Anything else the schedule should take into account, for example *No games before 10 AM on Saturdays*. |

### Sending a request
1. **Menu → League → Requests**, then the **Rule requests** tab.
2. Choose **New rule request**.
3. Pick what it's about and fill in the value: the miles for a travel cap (it has to be lower than the league's), or the division and number of games for a rematch limit. For the other two, describe it in a few words.
4. Under **Why?**, give the reason in a sentence or two. The league decides from this.
5. Choose **Send to the league**. The System Admins are emailed.

![A new rule request](/help/img/pd-rule-request-new.png)

You can have one open travel-cap request at a time, and one rematch request for each division. Only your program and the league can see your requests; other programs can't. Coaches can't send rule requests, so ask them to bring these to you.

### Following a request
Each request shows where it stands:

- **Waiting for the league:** nothing for you to do yet.
- **Question for the program:** the league asked something. Choose **Reply**; the request then goes back to the league. The Requests menu item shows a number while a question is waiting on you.
- **Accepted:** the league agrees. For a travel cap or rematch limit, the request shows the value that went into the rules (the league can adjust what you asked for) and it applies to the next draft schedule built.
- **Noted:** the scheduler can't do this by itself, so the league keeps it on record and checks it when reviewing the schedule.
- **Declined:** the league's note says why.

You're emailed at each step. **Add a comment** adds more information while a request is open.

![Rule requests for a director](/help/img/pd-rule-requests.png)

Accepted and noted requests move to **In effect** and stay there season after season; the league confirms each one again when a new season starts. When you no longer need one, choose **Withdraw**. The league is told, and removes the setting from the rules. Declined and withdrawn requests are kept under **Closed**.

## Activity

**Menu → My program → Activity** shows every change involving your program, newest first, including changes made by other programs and the league: who made it and which programs it involves.

![Activity for a director](/help/img/pd-activity.png)

## Your coaches

Your coaches have their own guide: the [Coach guide](/help/coach).
