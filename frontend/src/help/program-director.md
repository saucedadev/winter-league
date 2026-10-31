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

### Fewer games for one team (travel teams)
If one of your teams plays mostly tournaments, for example a travel team, it can play fewer league games than the league's count.

1. On **Teams**, click **Edit** on the team.
2. Under **Games this season**, choose a number lower than the league's, for example **4 games**, or **No league games**. It can't be higher than the league's count; that would push extra games onto opponents who didn't ask for them.
3. Enter a **Reason**, for example *Travel team, tournament schedule*, and click **Save team**.

![Games this season](/help/img/pd-team-games.png)

The team shows a badge such as **4 league games**. It takes effect the next time the league builds a draft; a draft or schedule already built doesn't change. The Matchmaker spreads the team's games across the season, and its opponents make up their games against other teams. With **No league games**, the team is left out of the league schedule, but it can still play [preseason](#preseason) games, and the league can add a game by hand.

**Tip:** add [blackout dates](#blackout-dates) for tournament weekends too, so league games aren't scheduled then.

Only your program and the league see the team's target and reason. The league can change or remove it, and every change is in the Activity log.

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

Gym slots are the times your program can offer the league. **Menu → My program → Gym slots.** If the season has a preseason, you can add gym time from the day it opens; time before the regular-season start is used only for [preseason](#preseason) scrimmages and joint practices.

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

## Preseason

If the league has a preseason, programs that are ready (tryouts done, teams formed) can arrange **scrimmages** and **joint practices** with each other before the regular season starts. Join whenever you're ready; not every program has to. Preseason games don't count toward standings, games per team, or home/away balance, and the Schedule builder never uses preseason gym time.

**Menu → Scheduling → Preseason.**

### 1. Add preseason gym time
Add gym slots as usual under **Gym slots**, on dates between the preseason opening and the regular-season start. Those slots are marked **Preseason**, and a note on the page says so. Game time (weeknight or weekend) is offered for scrimmages; practice time is also offered for joint practices.

![Preseason gym time](/help/img/pd-slots-preseason.png)

### 2. Open your teams
Under **Your teams**, click a team to open it for preseason (**Open all** does every team). You can also do it from **Teams** with **Open for preseason**. Other programs can then find that team. Closing a team later doesn't cancel anything already arranged.

![Opening a team for preseason on the Teams page](/help/img/pd-teams-preseason.png)

### 3. Find an opponent and pick a time
1. Under **Find an opponent**, choose your team. Teams in the same division that are open for preseason are listed, nearest first. Tick **Include teams one grade up or down** to see more.
2. Choose **Find times**. You'll see times when **either** program has open preseason gym time and both teams are free (no other preseason event that day, no blackout), with whose gym it is and how far the visitors travel. Switch between **Scrimmage** and **Joint practice**.
3. Choose **Ask** next to a time, tick **We'd like referees** if you want them, add an optional note, and **Send request**. The time is held while you wait.

![Finding a time](/help/img/pd-preseason-find.png)

![Asking for a scrimmage](/help/img/pd-preseason-ask.png)

### 4. Answering a request
When another program asks, you're emailed, and it appears at the top of the page under **Waiting for your answer** (the **Preseason** menu item shows a number). **Accept** puts it on both teams' schedules; **Decline** needs a short note (e.g. a time that would work instead). There's no league sign-off, but the league can see everything.

![A request waiting for an answer](/help/img/pd-preseason-waiting.png)

### Afterwards
- **Arranged** lists everything that's on. Each one also shows at the top of the **Schedule** page, for you and the coaches of both teams.
- **Withdraw** a request you sent, while it's still waiting. **Cancel…** something arranged (either program can), with a reason; the other program is emailed.
- **Referees:** if you asked for referees, the Referee Assignor is told once it's accepted. Preseason games aren't on the referee assignment board or in Referee payouts, so referees and their pay are arranged directly with the assignor.

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

Programs pay the referees, **one referee each per game**. **Menu → My program → Referee payouts** lists the referees **your program pays** and what each is owed. A referee the other program pays isn't in your list or your total, so nobody is paid twice.

| Game | Who pays |
|---|---|
| Two referees worked | The **home** program pays **Referee 1**; the **away** program pays **Referee 2** |
| Only one referee worked (the other slot was empty or a no-show) | The two programs pay **half each** |
| Guest game | The same: your program (home) pays Referee 1 and the guest program pays Referee 2, or half each for a lone referee. The league collects the guest's share, since a guest has no director |
| Two teams from the same program | That program pays every referee |

Home and away games are balanced across the season, so each program ends up paying for about the same number of referees. Referees can have different pay rates, so the two programs in a game may owe slightly different amounts.

1. Choose **From** and **To** dates and **Update**.
2. **Your program still owes** is what's left to pay for those dates, and **Marked as paid** is what you've already paid. The list shows **Unpaid** referees first; switch to **Paid** or **All** to see the rest.
3. Expand a referee to see each game you pay them for, marked **Paid**, **Unpaid** or **Partly paid**. A line under each game names the other referee and the program that pays them, for example *Referee 2, Morgan Hayes: paid by Oak Hollow Owls*. When you're paying half, it says so and names the program paying the other half.
4. **Download game detail (CSV)** gives one row per payment, each detail in its own column so you can sort or filter in Excel or Google Sheets: **Referee**, **Email**, **Date**, **Home team**, **Away team**, **Checked in** (Pacific Time), **Confirmed by**, **Paid by**, **Share** (Full or Half), **Amount**, **Status** (Paid, Partly paid or Unpaid), and **Paid**. **Download summary (CSV)** gives one row per referee, with their Venmo username and what's paid and unpaid.

![Referee payouts for a program](/help/img/pd-payouts.png)

No money moves through the app. If a warning says some assigned referees never checked in, the Referee Assignor confirms attendance for those games. That can change who pays: a game with one confirmed referee is split, and becomes one referee each once the second is confirmed.

### Paying a referee
Referees add their **Venmo username** to their profile. You see it under the name of each referee your program owes (only referees your program pays).

1. Choose **Pay…** next to the referee.
2. Under **Games to pay for**, every game you still owe them is ticked. Untick any you aren't paying now; the total updates.
3. **1. Pay:**
   - **On a phone**, choose **Open Venmo to pay**. The Venmo app opens with the amount and a note (for example *Winter League referee · 2 games, Nov 5 – Nov 7 · Northfield Hawks*) filled in.
   - **On a computer**, scan the code with your phone's camera to do the same in the Venmo app, or use the button.
   - **Before you send, check the name and photo in Venmo.** If the referee changed their username in the last two weeks, a yellow note says so; if you haven't paid them before, check it with them first.
   - If the referee hasn't added a Venmo username, pay them the way your program usually does (check, cash).
4. **2. Mark as paid:** once the money is sent, choose how you paid (**Venmo**, **Check**, **Cash** or **Other**), the date, an optional note (e.g. *Check #1042*), and **Mark … as paid**. The referee is emailed and asked to confirm it arrived.

![Paying a referee](/help/img/pd-pay-referee.png)

Venmo's link fills in the amount and note on most phones. If it ever opens without them, type the amount shown in the app.

**After marking it:** the payment appears under the referee (switch to **Paid** and expand them), with **Waiting for the referee to confirm** until they choose **Got it**, then **Referee confirmed ✓**. Marked something by mistake? **Undo** takes it off the record (it doesn't move any money), until the referee has confirmed it; after that, ask the league.

![A payment the referee has confirmed](/help/img/pd-payouts-paid.png)

## Referee reserve

Instead of paying referees yourself, your program can **prepay the Referee Assignor**, who then pays your referees and takes each payment out of your reserve. The league switches a program to a reserve; ask them if you'd like to. Once it's on, **Referee payouts** shows *Assignor pays* instead of a Pay button, and the assignor pays your referees.

![Payouts for a program on a reserve](/help/img/pd-payouts-reserve.png)

**Menu → My program → Referee reserve.**

| Figure | What it means |
|---|---|
| **Balance** | What you've deposited (and the assignor has confirmed), minus what's been paid out to referees: the money the assignor is holding for you. Below zero means your program owes the reserve. |
| **Available** | Balance minus referees **owed** (worked your games, not yet paid) and **upcoming** (an estimate for referees already assigned to your future games). This is what's really left; it says roughly how many more referee fees it covers, or how short you are. |
| **Deposited**, **Paid out** | The totals so far this season. |

![Referee reserve](/help/img/pd-reserve.png)

### Adding a deposit
1. Pay the Referee Assignor (check, cash, Venmo).
2. Choose **Add a deposit**, enter the amount, how you paid, the date, and an optional note (e.g. *Check #1001*).
3. It shows under **Deposits waiting for the referee assignor to confirm**. It counts toward your reserve once they confirm they received it; you're emailed either way. Entered it by mistake? **Withdraw** it while it's still waiting.

![Adding a deposit](/help/img/pd-reserve-deposit.png)

**Low-balance email:** under **Email me when available drops below**, enter an amount (e.g. *100.00*) and **Save**. You're emailed once when Available drops below it, and again the next time it dips after you've topped it up.

**Statement:** every confirmed deposit, referee payout (expand a payout to see its games), refund, and correction, with a running balance and opening and closing balances. Choose **From** and **To** dates for part of the season, **Download (CSV)** for a spreadsheet, or **Print / Save as PDF**.

Entries are never edited or deleted. If something is wrong, the assignor adds a correction, and the statement shows both. At the end of the season the assignor refunds whatever is left and records it here.

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
