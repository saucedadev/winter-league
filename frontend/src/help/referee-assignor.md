# Referee Assignor guide

The Referee Assignor makes sure every game has its referees: you keep the referee roster, put referees on games, confirm who worked, and export what each referee is owed. No money moves through {{appName}}. The payouts export is a spreadsheet you pay from in your usual way.

{{gettingStarted}}

## Your dashboard

**Referee coverage** shows how many upcoming referee slots there are, how many are still open, how many open slots are in the next two weeks, and how many played games still need attendance confirmed.

![The assignor's dashboard](/help/img/as-dashboard.png)

Every published game gets referee slots automatically (two per game by default). Until the league publishes the schedule, there's nothing to assign.

## The referee roster

**Menu → Referees → Referees.**

![The referee roster](/help/img/as-roster.png)

- **Add referee:** enter their name, email, and optionally phone and pay. The app creates a username and a **temporary password, shown once**, to pass on. They choose their own password the first time they sign in.
- **Edit:** change contact details, a personal pay rate (blank means the league default), notes, or **Active**. Deactivating a referee removes them from every upcoming game.
- **Settings:** referees per game, default pay per game, and when check-in opens and closes.

The roster also shows each referee's upcoming games, games worked, no-shows, and the dates they've marked unavailable.

## Assigning referees

**Menu → Referees → Assignments** shows the published games one week at a time. Each game has a box per referee slot: a name when it's filled, **Assign** when it's open. Tick **Only games needing referees** to hide covered games.

![The assignments board](/help/img/as-assignments.png)

### Filling a slot yourself
Open a slot to see every referee, with their games this season and that day. Anyone who can't take it is greyed out with the reason: *already working another gym at that time*, *marked unavailable*, or *already on this game*. Warnings such as *back-to-back with a game at another venue* are shown but don't stop you. Choose a referee and **Assign referee**, or **Leave open**.

![Choosing a referee](/help/img/as-slot.png)

### Auto-fill
**Auto-fill this week** or **Auto-fill all upcoming** fills open slots with whoever has the fewest games so far. It never double-books anyone, never uses a date they marked unavailable, and never gives back-to-back games at different gyms. Slots already filled aren't changed. If there aren't enough free referees, it tells you how many slots are still open.

![Auto-fill](/help/img/as-auto-fill.png)

Referees get an email for each new game.

### When things change
- **A referee declines** (*Can't make it*): you get an email and the slot opens again.
- **A game moves:** referees who are still free stay on it and are told the new time. Anyone with a clash is taken off, and you get an email to refill the slot.
- **A game is cancelled:** its referees are released.
- **Games added by hand**, including **guest games** against outside clubs, get referee slots like any other game. Guest teams show *(guest)* after their name.

## Confirming who worked

Referees check in from their phones at the gym. If someone couldn't check in, open their slot on or after game day:
- **Mark as worked:** counts the game for pay.
- **Mark no-show:** they aren't paid for it.
- **Clear attendance:** undo either.

## Payouts

Programs pay the referees, one referee each per game. The app works out who pays whom from the position you assign:

| Game | Who pays |
|---|---|
| Two referees worked | The **home** program pays **Referee 1**; the **away** program pays **Referee 2** |
| Only one referee worked (the other slot was empty or a no-show) | The two programs pay **half each** |
| Guest game | The same: the league team's program (home) pays Referee 1 and the **guest program** pays Referee 2, or half each for a lone referee |
| Two teams from the same program | That program pays every referee |

So **Referee 1 is paid by the home program and Referee 2 by the away program**. Keep that in mind when you put referees on a game. Each referee is owed once, and the two programs' reports never list the same payment.

**Menu → Referees → Payouts.**
1. Choose **From** and **To** dates and **Update**.
2. Check the totals. **What each program owes** lists every program with its number of referee payments and total. Guest programs are listed too, marked *(guest)*; they have no director or login, so the league collects their share from the club directly; the program totals add up to **Total owed**.
3. Expand a referee to see each game, with **Paid by** and the other referee on that game. If some assigned referees never checked in, a warning tells you, so you can confirm attendance first. Marking the second referee as worked or a no-show can change a game from *half each* to *one referee each*, or back.
4. **Download summary (CSV)** gives one row per referee: name, email, username, games worked, and total.
5. **Download game detail (CSV)** gives one row per payment, each detail in its own column so you can sort or filter: **Referee**, **Email**, **Date**, **Home team**, **Away team**, **Checked in** (in Pacific Time, where the games are played), **Confirmed by** (their own check-in or your confirmation), **Paid by**, **Share** (Full or Half), and **Amount**. A referee split between two programs has two rows of half. Guest teams have *(guest)* after their name, so non-conference games are easy to pick out.
6. **Download by program (CSV)** gives one row per program: referee payments and total.

All three open in Excel or Google Sheets. **Program Directors see and export only the referees their own program pays**, so they can check what they owe without asking you.

![Payouts](/help/img/as-payouts.png)

A referee's pay is locked in when the game is checked in, so changing a rate later never changes what's already owed.

## Your referees

Referees have their own guide: the [Referee guide](/help/referee).
