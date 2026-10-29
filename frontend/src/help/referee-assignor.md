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
- **Edit:** change contact details, a personal pay rate (blank means the league default), the referee's **Venmo username**, notes, or **Active**. Referees usually add their Venmo username themselves; the roster shows it under their contact details, and they're emailed whenever it changes. Deactivating a referee removes them from every upcoming game.
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
2. Check the totals: **Still to pay**, **Marked as paid**, and games worked. **What each program owes** lists every program with its number of referee payments, total, what it has marked as paid, and what it still owes. Guest programs are listed too, marked *(guest)*; they have no director or login, so the league collects their share from the club directly; the program totals add up to **Total owed**.
3. Expand a referee to see each game, with **Paid by** and the other referee on that game. If some assigned referees never checked in, a warning tells you, so you can confirm attendance first. Marking the second referee as worked or a no-show can change a game from *half each* to *one referee each*, or back.
4. **Download summary (CSV)** gives one row per referee: name, email, username, Venmo username, games worked, total, paid and unpaid.
5. **Download game detail (CSV)** gives one row per payment, each detail in its own column so you can sort or filter: **Referee**, **Email**, **Date**, **Home team**, **Away team**, **Checked in** (in Pacific Time, where the games are played), **Confirmed by** (their own check-in or your confirmation), **Paid by**, **Share** (Full or Half), **Amount**, **Status** (Paid, Partly paid or Unpaid) and **Paid**. A referee split between two programs has two rows of half. Guest teams have *(guest)* after their name, so non-conference games are easy to pick out.
6. **Download by program (CSV)** gives one row per program: referee payments, total, paid and unpaid.

All three open in Excel or Google Sheets. **Program Directors see and export only the referees their own program pays**, so they can check what they owe without asking you.

![Payouts](/help/img/as-payouts.png)

A referee's pay is locked in when the game is checked in, so changing a rate later never changes what's already owed.

### Paid and unpaid
Programs pay referees directly (Venmo, check or cash) and mark it as paid on their payouts page. The referee is emailed and confirms with **Got it**. You see the same here: the **Unpaid / Paid / All** switch, each game's status, and under each referee their **Payments** (amount, method, date, program, who marked it, and whether the referee confirmed).

- **Paying on a program's behalf:** **Pay…** next to a referee works here too. Pick **Which program is paying?** and the games, then **Mark as paid**. Use it for a guest program, or a director who asks you to.
- **Undo** takes a payment back off the record if it was marked by mistake (no money moves). You can undo any payment; a director can only undo their own program's, and only until the referee confirms it.

## Referee reserves

A program can prepay you instead of paying its referees itself. You hold the money, pay its referees, and each payment comes out of its **reserve**. Guest programs can have one too; you record their deposits for them.

**Menu → Referees → Reserves.** The summary shows each program on a reserve: **Deposited**, **Paid out**, **Balance** (what you're holding for it), **Owed** (worked, not yet paid), **Upcoming** (an estimate for referees assigned to future games), and **Available**. **Held for all programs** is the total you should be holding. **Download summary (CSV)** for a spreadsheet. Programs that pay referees directly are listed underneath.

![Referee reserves](/help/img/as-reserves.png)

Open a program to see its figures, waiting deposits, and statement.
- **Switch to a reserve** (or **Switch to paying directly**): changes how the program pays its referees. Its director is emailed.
- **Deposits to confirm:** when a director adds a deposit, you're emailed. **Confirm received** once the money arrives, or **Decline** with a reason (e.g. *Not received yet*). Only confirmed deposits count.
- **Record a deposit:** for money that reached you directly, and for guest programs. It's confirmed straight away.
- **Refund** and **Adjustment** (add to or take from the reserve, with a note saying why).
- **Reverse…** on a statement line: corrects a mistake by adding the opposite amount. Nothing is ever edited or deleted, so the statement always explains itself.
- **Refund what's left…** at the end of the season: records a refund of the whole balance (pay it back first). If referees are still owed for games already played, pay them first.
- **Low-balance email:** you and the program's director are emailed when its Available drops below the level set on its page.

### Paying referees from reserves
On **Payouts**, choose **Pay…** next to a referee and pick the program under **Which program is paying?** Programs on a reserve say *from its reserve*. If more than one reserve program owes the referee, **All N reserve programs together** pays them all in one go: one Venmo payment, recorded against each program's reserve for its own games, and the referee confirms it once with **Got it**.

![Paying from two reserves at once](/help/img/as-pay-reserves.png)

The balance goes down when you mark a referee paid, not when the game is played, so it matches the money you're actually holding. It can go below zero (so a referee who worked is never left unpaid); the program then shows as owing the reserve.

## Your referees

Referees have their own guide: the [Referee guide](/help/referee).
