// Module B — first-version matchmaker.
//
// Deliberately a transparent greedy heuristic, not an optimal solver: the
// output is a DRAFT a System Admin reviews and adjusts before publishing
// (feasibility report, Section 6). Deterministic, so the same inputs always
// give the same draft.
//
// Hard constraints (never broken):
//   • teams only play teams in their own division
//   • a game only goes in an open game window at the HOME team's program
//   • no court/time is used twice; no program-wide blackout days
//   • a team's games are at least rules.minDaysBetween days apart and
//     at most rules.maxGamesPerWeek per week
//   • the away team's travel is within rules.maxTravelMiles (when venues
//     have coordinates)
// Soft goals: every team reaches rules.gamesPerTeam, home/away near 50/50,
// games spread evenly across the season.
import { roundRobin, milesBetween, weekOf, teamProblems, windowKey } from './core.js';

export function buildSchedule({ teams, windows, homes, programBlackouts, rules, programNames = {} }) {
  const warnings = [];
  const byDivision = new Map();
  for (const t of teams) {
    if (!byDivision.has(t.divisionId)) byDivision.set(t.divisionId, []);
    byDivision.get(t.divisionId).push(t);
  }

  // ---- season weeks that have any game window ----
  const weeks = [...new Set(windows.map((w) => weekOf(w.date)))].sort();
  const weekIndex = new Map(weeks.map((w, i) => [w, i]));

  // windows indexed by program -> week index -> sorted list
  const byProgramWeek = new Map();
  for (const w of [...windows].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))) {
    const wi = weekIndex.get(weekOf(w.date));
    if (!byProgramWeek.has(w.programId)) byProgramWeek.set(w.programId, weeks.map(() => []));
    byProgramWeek.get(w.programId)[wi].push(w);
  }

  const programsWithoutWindows = new Set(teams.map((t) => t.programId).filter((pid) => !byProgramWeek.has(pid)));
  for (const pid of programsWithoutWindows) {
    warnings.push(`${programNames[pid] || 'A program'} has no open game slots this season, so its teams can only play away.`);
  }
  const noCoords = new Set(teams.map((t) => t.programId).filter((pid) => !homes[pid]));
  for (const pid of noCoords) {
    warnings.push(`${programNames[pid] || 'A program'} has no venue coordinates, so travel distance couldn’t be checked for its games.`);
  }

  // ---- 1. pairings per division ----
  const matches = [];
  const tooFar = [];
  for (const [divisionId, divTeams] of byDivision) {
    if (divTeams.length < 2) {
      warnings.push(`${divTeams[0].divisionName} has only one team (${divTeams[0].name}), so no games were created for it.`);
      continue;
    }
    const cycle = roundRobin(divTeams);
    const count = new Map(divTeams.map((t) => [t.id, 0]));
    const divMatches = [];
    let round = 0;
    for (let c = 0; c < rules.gamesPerTeam + 2; c++) {
      let added = 0;
      for (const pairs of cycle) {
        let addedThisRound = 0;
        for (const [x, y] of pairs) {
          const [a, b] = c % 2 === 0 ? [x, y] : [y, x]; // alternate suggested home each cycle
          if (count.get(a.id) >= rules.gamesPerTeam || count.get(b.id) >= rules.gamesPerTeam) continue;
          const d = milesBetween(homes[a.programId], homes[b.programId]);
          if (d != null && d > rules.maxTravelMiles) {
            if (c === 0) tooFar.push({ a, b, d });
            continue;
          }
          divMatches.push({ divisionId, a, b, round });
          count.set(a.id, count.get(a.id) + 1);
          count.set(b.id, count.get(b.id) + 1);
          addedThisRound++;
        }
        if (addedThisRound) round++;
        added += addedThisRound;
      }
      if (!added) break;
    }
    const totalRounds = Math.max(round, 1);
    for (const m of divMatches) m.targetWeek = Math.floor((m.round * weeks.length) / totalRounds);
    matches.push(...divMatches);
  }
  for (const { a, b, d } of tooFar) {
    warnings.push(`${a.name} and ${b.name} weren’t paired: their programs are ${d} miles apart (cap ${rules.maxTravelMiles}).`);
  }

  // ---- 2. place each match in a window ----
  matches.sort((m, n) => m.targetWeek - n.targetWeek || m.round - n.round || m.divisionId.localeCompare(n.divisionId));
  const used = new Set();
  const teamGames = new Map(teams.map((t) => [t.id, []]));
  const homeCount = new Map(teams.map((t) => [t.id, 0]));
  const awayCount = new Map(teams.map((t) => [t.id, 0]));
  const games = [];

  // Week search order: the target week, then alternating later/earlier.
  const weekOrder = (target) => {
    const order = [];
    for (let k = 0; k < weeks.length; k++) {
      for (const w of k === 0 ? [target] : [target + k, target - k]) if (w >= 0 && w < weeks.length) order.push(w);
    }
    return order;
  };

  const tryPlace = (home, away, targetWeek) => {
    const perWeek = byProgramWeek.get(home.programId);
    if (!perWeek) return null;
    for (const wi of weekOrder(targetWeek)) {
      for (const w of perWeek[wi]) {
        if (used.has(windowKey(w))) continue;
        if (programBlackouts.has(`${home.programId}|${w.date}`) || programBlackouts.has(`${away.programId}|${w.date}`)) continue;
        if (teamProblems(home.name, teamGames.get(home.id), w.date, rules).length) continue;
        if (teamProblems(away.name, teamGames.get(away.id), w.date, rules).length) continue;
        const miles = milesBetween(w, homes[away.programId]);
        if (miles != null && miles > rules.maxTravelMiles) continue;
        return { w, miles };
      }
    }
    return null;
  };

  for (const m of matches) {
    const bal = (t) => homeCount.get(t.id) - awayCount.get(t.id);
    const hosts = bal(m.b) < bal(m.a) ? [[m.b, m.a], [m.a, m.b]] : [[m.a, m.b], [m.b, m.a]];
    let placed = null;
    let home;
    let away;
    for ([home, away] of hosts) {
      placed = tryPlace(home, away, m.targetWeek);
      if (placed) break;
    }
    if (!placed) {
      [home, away] = hosts[0];
      games.push({ divisionId: m.divisionId, homeTeamId: home.id, awayTeamId: away.id, window: null, travelMiles: null, round: m.round,
        note: 'No open game window at either program’s gyms fits both teams’ schedules and the travel cap.' });
      continue;
    }
    used.add(windowKey(placed.w));
    teamGames.get(home.id).push({ date: placed.w.date });
    teamGames.get(away.id).push({ date: placed.w.date });
    homeCount.set(home.id, homeCount.get(home.id) + 1);
    awayCount.set(away.id, awayCount.get(away.id) + 1);
    games.push({ divisionId: m.divisionId, homeTeamId: home.id, awayTeamId: away.id, window: placed.w, travelMiles: placed.miles, round: m.round, note: null });
  }

  // ---- 2b. home/away repair ----
  // Greedy placement drifts when a small program can't host often. Where a
  // team is +2 home or more and its opponent is short on home games, try
  // moving that game to the opponent's gym (same week first). Only moves
  // that lower the combined imbalance are made, and every hard constraint
  // is re-checked.
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const gap = (id) => homeCount.get(id) - awayCount.get(id);
  for (let pass = 0; pass < 4; pass++) {
    let moved = 0;
    for (const g of games) {
      if (!g.window || gap(g.homeTeamId) - gap(g.awayTeamId) < 3) continue;
      const newHome = teamById.get(g.awayTeamId);
      const newAway = teamById.get(g.homeTeamId);
      const hg = teamGames.get(newHome.id);
      const ag = teamGames.get(newAway.id);
      const hEntry = hg.find((x) => x.date === g.window.date);
      const aEntry = ag.find((x) => x.date === g.window.date);
      hg.splice(hg.indexOf(hEntry), 1);
      ag.splice(ag.indexOf(aEntry), 1);
      const placed = tryPlace(newHome, newAway, weekIndex.get(weekOf(g.window.date)));
      if (!placed) { hg.push(hEntry); ag.push(aEntry); continue; }
      used.delete(windowKey(g.window));
      used.add(windowKey(placed.w));
      hg.push({ date: placed.w.date });
      ag.push({ date: placed.w.date });
      homeCount.set(newHome.id, homeCount.get(newHome.id) + 1); awayCount.set(newHome.id, awayCount.get(newHome.id) - 1);
      homeCount.set(newAway.id, homeCount.get(newAway.id) - 1); awayCount.set(newAway.id, awayCount.get(newAway.id) + 1);
      Object.assign(g, { homeTeamId: newHome.id, awayTeamId: newAway.id, window: placed.w, travelMiles: placed.miles });
      moved++;
    }
    if (!moved) break;
  }

  // ---- 3. summary ----
  const scheduled = games.filter((g) => g.window);
  const teamStats = teams.map((t) => ({
    teamId: t.id, name: t.name, divisionId: t.divisionId,
    home: homeCount.get(t.id), away: awayCount.get(t.id), games: homeCount.get(t.id) + awayCount.get(t.id),
  }));
  const short = teamStats.filter((s) => s.games < rules.gamesPerTeam && byDivision.get(s.divisionId).length > 1);
  if (short.length) {
    warnings.push(`${short.length} team${short.length > 1 ? 's' : ''} ended up with fewer than ${rules.gamesPerTeam} games: ${short.slice(0, 6).map((s) => `${s.name} (${s.games})`).join(', ')}${short.length > 6 ? ', …' : ''}.`);
  }
  const unplaced = games.length - scheduled.length;
  if (unplaced) warnings.push(`${unplaced} pairing${unplaced > 1 ? 's' : ''} couldn’t be placed. They’re listed under Unplaced so you can place them by hand.`);

  const miles = scheduled.map((g) => g.travelMiles).filter((x) => x != null);
  const imbalance = teamStats.map((s) => Math.abs(s.home - s.away));
  const summary = {
    totalGames: games.length,
    scheduledGames: scheduled.length,
    unscheduledGames: unplaced,
    teams: teams.length,
    windowsAvailable: windows.length,
    windowsUsed: used.size,
    maxHomeAwayGap: imbalance.length ? Math.max(...imbalance) : 0,
    balancedTeams: imbalance.filter((x) => x <= 1).length,
    maxTravelMiles: miles.length ? Math.max(...miles) : null,
    avgTravelMiles: miles.length ? Math.round((miles.reduce((a, b) => a + b, 0) / miles.length) * 10) / 10 : null,
    firstDate: scheduled.length ? scheduled.map((g) => g.window.date).sort()[0] : null,
    lastDate: scheduled.length ? scheduled.map((g) => g.window.date).sort().at(-1) : null,
    teamStats,
  };
  return { games, summary, warnings };
}
