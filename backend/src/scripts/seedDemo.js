// Fills the database with a demo league. By default the programs, venues,
// and Program Directors come from the demo spreadsheet in demo-data/; teams,
// gym slots, blackouts, a published schedule, referees, and sample change
// requests are generated around them. The referee roster, the Referee
// Assignor (pnair), the System Admin (gkim), and two coaches (tgreene,
// lortega) are the same whichever dataset is used.
//
//   npm run seed:demo                        spreadsheet in demo-data/
//   npm run seed:demo -- --file=<path.xlsx>  a different spreadsheet
//   npm run seed:demo -- --real-emails       keep the spreadsheet's real email addresses
//   npm run seed:demo -- --dataset=test      built-in test league (for npm run test:smoke)
//   npm run seed:demo -- --no-schedule       everything except the schedule: no published
//                                            games, referee assignments, or sample change
//                                            requests, so a demo can build and publish the
//                                            season live (DEMO.md, "Full-process walkthrough")
//
// Refuses to run against Turso unless --force.
import path from 'node:path';
import { config } from '../config.js';
import { db, one, all, newId } from '../db/client.js';
import { hashPassword } from '../utils/security.js';
import { addDays } from '../utils/validate.js';
import { seedBase } from './seed.js';
import { generateDraft, getRules, getGame, placementOptions } from '../scheduling/data.js';
import { snapshotOf } from '../routes/requests.js';
import { syncSlots, autoFill } from '../referees/data.js';
import { testLeagueDataset } from './demoData/testLeague.js';
import { DEFAULT_DEMO_FILE } from './demoFile.js';

if (!config.databaseUrl.startsWith('file:') && !process.argv.includes('--force')) {
  console.error('❌ seed:demo only runs against a local SQLite database. (Use --force to override — not recommended.)');
  process.exit(1);
}

const DEMO_PASSWORD = 'WinterDemo2026';
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
// Accounts every dataset shares; spreadsheet directors never get these usernames.
const REFEREE_ROSTER = [
  ['Avery', 'Coleman', 5000, null], ['Jordan', 'Pike', null, null], ['Sam', 'Delgado', null, ['2026-11-14', '2026-11-15', 'Out of town']],
  ['Riley', 'Chen', 4500, null], ['Morgan', 'Hayes', null, null], ['Casey', 'Novak', null, ['2026-11-19', '2026-11-19', 'Work shift']],
  ['Drew', 'Okafor', null, null],
];
const SHARED_USERNAMES = ['tgreene', 'lortega', 'pnair', 'obrooks', 'gkim', ...REFEREE_ROSTER.map(([f, l]) => (f[0] + l).toLowerCase())];

async function loadDataset() {
  const which = arg('dataset') || 'spreadsheet';
  if (which === 'test') return testLeagueDataset();
  if (which !== 'spreadsheet') throw new Error(`Unknown --dataset=${which}. Use "spreadsheet" (default) or "test".`);
  const { spreadsheetDataset } = await import('./demoData/spreadsheetLeague.js');
  let existing = [];
  try { existing = (await all('SELECT username FROM users')).map((u) => u.username); } catch { /* no tables yet (checking before a reset) */ }
  return spreadsheetDataset(path.resolve(arg('file') || DEFAULT_DEMO_FILE), {
    realEmails: process.argv.includes('--real-emails'),
    reservedUsernames: [...SHARED_USERNAMES, ...existing],
  });
}

async function main() {
  await seedBase({ quiet: true });
  if (await one('SELECT 1 FROM programs LIMIT 1')) {
    console.log(config.databaseUrl.startsWith('file:')
      ? 'ℹ️  Demo data already present — nothing to do. (npm run db:reset starts fresh.)'
      : 'ℹ️  Demo data already present — nothing to do. To start over on a hosted demo, recreate its database (DEMO-DEPLOYMENT.md, "Refreshing the demo").');
    return;
  }
  const data = await loadDataset();
  console.log(`📄 Demo league from the ${data.label}`);
  for (const w of data.warnings || []) console.log(`   ⚠️  ${w}`);
  if (data.realEmails) console.log('   ⚠️  Using the spreadsheet’s REAL email addresses. If email sending is on, these people will receive notifications.');

  const stmts = [];
  const add = (sql, args) => stmts.push({ sql, args });

  const seasonId = newId();
  const seasonStart = '2026-11-02';
  add('INSERT INTO seasons (id, name, start_date, end_date, is_active) VALUES (?, ?, ?, ?, 1)', [seasonId, 'Winter 2026–27', seasonStart, '2027-02-28']);

  const divisions = await all('SELECT id, name FROM divisions ORDER BY sort_order');
  const div = (n) => {
    const d = divisions.find((x) => x.name === n);
    if (!d) throw new Error(`Division "${n}" doesn't exist. Check League setup.`);
    return d.id;
  };
  const pwHash = await hashPassword(DEMO_PASSWORD);
  const accounts = [];
  const userIds = {};
  const user = ({ first, last, username, role, programId, email, phone = null }) => {
    const id = newId();
    add(`INSERT INTO users (id, first_name, last_name, username, email, phone, password_hash, role, program_id, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`, [id, first, last, username, email || `${username}@example.com`, phone, pwHash, role, programId]);
    accounts.push({ username, role, name: `${first} ${last}`, programId });
    userIds[username] = id;
    return id;
  };

  const programIds = {};
  const programNames = {};
  for (const p of data.programs) {
    programIds[p.code] = newId();
    programNames[programIds[p.code]] = p.name;
    add('INSERT INTO programs (id, name, short_code, city, contact_email, contact_phone) VALUES (?, ?, ?, ?, ?, ?)',
      [programIds[p.code], p.name, p.code, p.city, p.contactEmail, p.contactPhone]);
  }

  for (const d of data.directors) {
    user({ first: d.first, last: d.last, username: d.username, role: 'program_director', programId: programIds[d.programCode], email: d.email, phone: d.phone });
  }
  user({ first: 'Tasha', last: 'Greene', username: 'tgreene', role: 'league_coach', programId: programIds[data.coaches.tgreene], phone: '7735550123' });
  user({ first: 'Luis', last: 'Ortega', username: 'lortega', role: 'league_coach', programId: programIds[data.coaches.lortega] });
  user({ first: 'Priya', last: 'Nair', username: 'pnair', role: 'referee_assignor', programId: null });
  user({ first: 'Owen', last: 'Brooks', username: 'obrooks', role: 'referee', programId: null, phone: '6305550199' });
  user({ first: 'Grace', last: 'Kim', username: 'gkim', role: 'super_admin', programId: null });

  // Teams
  let teamCount = 0;
  for (const p of data.programs) {
    for (const t of data.teams(p)) {
      add('INSERT INTO teams (id, program_id, division_id, name, head_coach_user_id) VALUES (?, ?, ?, ?, ?)',
        [newId(), programIds[p.code], div(t.division), t.name, t.coach ? userIds[t.coach] : null]);
      teamCount++;
    }
  }

  // Venues, courts, and 10 weeks of weekly slots.
  const categoriesByDay = [
    { offset: 1, start: '18:00', end: '20:00', category: 'PRACTICE' },         // Tue
    { offset: 3, start: '18:30', end: '21:00', category: 'WEEKNIGHT_GAME' },    // Thu
    { offset: 5, start: '09:00', end: '15:00', category: 'WEEKEND_GAME_BLOCK' },// Sat
  ];
  let slotCount = 0;
  let venueCount = 0;
  for (const p of data.programs) {
    p.venues.forEach((v, vi) => {
      const venueId = newId();
      venueCount++;
      add('INSERT INTO venues (id, program_id, name, address, city, state, zip, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [venueId, programIds[p.code], v.name, v.address, v.city, v.state, v.zip, v.lat, v.lng]);
      v.courts.forEach((c, ci) => {
        const courtId = newId();
        add('INSERT INTO courts (id, venue_id, name, sort_order) VALUES (?, ?, ?, ?)', [courtId, venueId, c, ci]);
        if (ci > 1) return;
        categoriesByDay.forEach((pat, pi) => {
          if ((vi + ci + pi) % 3 === 2) return;
          const seriesId = newId();
          for (let w = 0; w < 10; w++) {
            add(`INSERT INTO gym_slots (id, program_id, season_id, court_id, date, start_time, end_time, category, series_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [newId(), programIds[p.code], seasonId, courtId, addDays(seasonStart, w * 7 + pat.offset), pat.start, pat.end, pat.category, seriesId]);
            slotCount++;
          }
        });
      });
    });
    add('INSERT INTO blackout_dates (id, program_id, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)',
      [newId(), programIds[p.code], '2026-11-26', '2026-11-28', 'Thanksgiving']);
    add('INSERT INTO blackout_dates (id, program_id, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)',
      [newId(), programIds[p.code], '2026-12-21', '2027-01-03', 'Winter break — buildings closed']);
  }

  await db.batch(stmts, 'write');
  console.log(`✅ Demo data: 1 season, ${data.programs.length} programs, ${venueCount} venues, ${teamCount} teams, ${slotCount} gym slots.`);

  const noSchedule = process.argv.includes('--no-schedule');
  const admin = await one("SELECT id FROM users WHERE username = 'gkim'");
  let draft = null;
  if (!noSchedule) {
    // Phase 2: generate and publish a schedule, then file two sample change
    // requests so every approval screen has something in it.
    const season = await one('SELECT * FROM seasons WHERE id = ?', [seasonId]);
    draft = await generateDraft(season, await getRules(), admin.id);
    await db.execute({ sql: "UPDATE schedule_runs SET status = 'published', published_by = ?, published_at = datetime('now') WHERE id = ?", args: [admin.id, draft.runId] });
    const requests = data.requests ? await seedRequests(draft.runId, programIds, data.requests) : 0;
    console.log(`✅ Demo schedule: ${draft.summary.scheduledGames} games published, ${requests} sample change requests.`);
    for (const w of draft.warnings) console.log(`   ℹ️  ${w}`);
  } else {
    console.log('✅ No schedule yet (--no-schedule): nothing published, so the demo can generate and publish it live.');
  }

  // Phase 3: a referee roster, a few pay overrides and unavailable dates,
  // and (with a schedule) November auto-filled so the assignor starts with
  // partial coverage.
  const refs = await seedReferees(pwHash, accounts);
  if (draft) {
    await syncSlots(draft.runId, 2);
    const fill = await autoFill({ runId: draft.runId, from: '2026-11-01', to: '2026-11-30', assignedBy: admin.id });
    console.log(`✅ Demo referees: ${refs} on the roster, ${fill.filled} November slots filled, December onward left open for the assignor.`);
  } else {
    console.log(`✅ Demo referees: ${refs} on the roster, none assigned yet (games get referee slots once the schedule is published).`);
  }

  console.log(`\n   Demo accounts (password for all: ${DEMO_PASSWORD})`);
  for (const a of accounts) {
    const where = a.programId ? `  ${programNames[a.programId]}` : '';
    console.log(`     ${a.username.padEnd(14)} ${a.role.padEnd(17)} ${a.name}${where}`);
  }
  if (data.requests) {
    const dirOf = (code) => accounts.find((a) => a.role === 'program_director' && a.programId === programIds[code]);
    const coachProg = data.programs.find((p) => p.code === data.requests.coachProgram);
    const askProg = data.programs.find((p) => p.code === data.requests.askingProgram);
    console.log(`\n   For the DEMO.md walkthrough${noSchedule ? ' (Full-process walkthrough)' : ''}:`);
    console.log(`     Director 1 (approves the coach's request): ${dirOf(coachProg.code)?.username || '—'}  (${coachProg.name})`);
    console.log(`     Director 2 (the "other program"):           ${dirOf(askProg.code)?.username || '—'}  (${askProg.name})`);
    console.log(`     Coach: tgreene (${coachProg.name}) · Assignor: pnair · Referee: acoleman · Admin: gkim`);
  }
  console.log('');
}

async function seedReferees(pwHash, accounts) {
  const REFS = REFEREE_ROSTER;
  const stmts = [];
  const obrooks = await one("SELECT id FROM users WHERE username = 'obrooks'");
  stmts.push({ sql: 'INSERT INTO referee_profiles (user_id, pay_rate_cents) VALUES (?, NULL)', args: [obrooks.id] });
  stmts.push({ sql: 'INSERT INTO referee_unavailability (id, user_id, start_date, end_date, note) VALUES (?, ?, ?, ?, ?)', args: [newId(), obrooks.id, '2026-11-07', '2026-11-07', 'Family wedding'] });
  for (const [first, last, rate, off] of REFS) {
    const id = newId();
    const username = (first[0] + last).toLowerCase();
    stmts.push({ sql: `INSERT INTO users (id, first_name, last_name, username, email, phone, password_hash, role, program_id, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'referee', NULL, 0)`, args: [id, first, last, username, `${username}@example.com`, username === 'acoleman' ? '7085550164' : null, pwHash] });
    stmts.push({ sql: 'INSERT INTO referee_profiles (user_id, pay_rate_cents) VALUES (?, ?)', args: [id, rate] });
    if (off) stmts.push({ sql: 'INSERT INTO referee_unavailability (id, user_id, start_date, end_date, note) VALUES (?, ?, ?, ?, ?)', args: [newId(), id, ...off] });
    accounts.push({ username, role: 'referee', name: `${first} ${last}`, programId: null });
  }
  await db.batch(stmts, 'write');
  return REFS.length + 1;
}

async function seedRequests(runId, programIds, plan) {
  let made = 0;
  const reqStmt = (r) => ({
    sql: `INSERT INTO change_requests (id, game_id, type, proposed_court_id, proposed_date, proposed_start_time, proposed_end_time,
          reason, snapshot, requested_by, requesting_program_id, status) VALUES (?, ?, 'reschedule', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [r.id, r.gameId, r.opt.courtId, r.opt.date, r.opt.startTime, r.opt.endTime, r.reason, snapshotOf(r.game), r.userId, r.programId, r.status],
  });
  const step = (requestId, stage, programId) => ({ sql: 'INSERT INTO change_request_steps (id, request_id, stage, program_id) VALUES (?, ?, ?, ?)', args: [newId(), requestId, stage, programId] });
  const coachProgram = programIds[plan.coachProgram];
  const askingProgram = programIds[plan.askingProgram];
  const otherProgram = programIds[plan.otherProgram];

  // 1) Coach Tasha Greene asks to move one of her team's games -> waits on her own program's director.
  const tasha = await one("SELECT id FROM users WHERE username = 'tgreene'");
  // Candidates in order of preference; if a game has no free alternative time, the next one is tried.
  const g1List = await all(`SELECT g.id FROM games g JOIN teams t ON t.id IN (g.home_team_id, g.away_team_id)
    WHERE g.run_id = ? AND g.status = 'scheduled' AND t.head_coach_user_id = ? ORDER BY g.date LIMIT 20 OFFSET 2`, [runId, tasha.id]);
  // 2) The asking program's director asks to move one of its games against the other program -> waits on that program.
  const asker = await one("SELECT id FROM users WHERE role = 'program_director' AND program_id = ? ORDER BY username LIMIT 1", [askingProgram]);
  const g2List = asker ? await all(`SELECT g.id FROM games g JOIN teams h ON h.id = g.home_team_id JOIN teams a ON a.id = g.away_team_id
    WHERE g.run_id = ? AND g.status = 'scheduled' AND ((h.program_id = ? AND a.program_id = ?) OR (h.program_id = ? AND a.program_id = ?))
    ORDER BY g.date LIMIT 20`, [runId, askingProgram, otherProgram, otherProgram, askingProgram]) : [];

  const taken = new Set();
  const usedGames = new Set();
  for (const [candidates, userId, programId, status, reasonFor, fits = () => true] of [
    [g1List, tasha.id, coachProgram, 'pending_director', 'Half our team has a school band concert that evening, so we’d be short of players.'],
    // The director's gym is booked, so: a game hosted at one of the asking
    // program's own venues, the reason names that venue, and the new time is
    // somewhere else.
    [g2List, asker?.id, askingProgram, 'pending_counterpart', (g) => `${g.venueName} is hosting a tournament that weekend.`, (g, o) => g.venueProgramId === askingProgram && o.venueId !== g.venueId],
  ]) {
    if (!userId) continue;
    // Proposals are several days apart (they may involve the same team), so the
    // demo can approve both without tripping the rest-days rule.
    const farFromTaken = (d) => [...taken].every((t) => Math.abs(Date.parse(d) - Date.parse(t)) >= 3 * 86400000);
    let game = null;
    let opt = null;
    for (const c of candidates) {
      if (usedGames.has(c.id)) continue;
      const g = await getGame(c.id);
      // New times after the game's current date (not just the first few of the season).
      const { options } = await placementOptions(g, { today: g.date, limit: 200 });
      opt = options.find((o) => !o.overTravelCap && o.date > g.date && farFromTaken(o.date) && fits(g, o));
      if (opt) { game = g; break; }
    }
    if (!game) { console.log(`   ⚠️  Couldn't find a free time for the ${status === 'pending_director' ? 'coach' : 'director'}'s sample request, so it was skipped.`); continue; }
    usedGames.add(game.id);
    taken.add(opt.date);
    const id = newId();
    const reason = typeof reasonFor === 'function' ? reasonFor(game) : reasonFor;
    const stmts = [reqStmt({ id, gameId: game.id, game, opt, reason, userId, programId, status })];
    if (status === 'pending_director') stmts.push(step(id, 'director', programId));
    for (const p of [...new Set([game.homeProgramId, game.awayProgramId])].filter((p) => p !== programId)) stmts.push(step(id, 'counterpart', p));
    await db.batch(stmts, 'write');
    made++;
  }
  return made;
}

// --check: validate the dataset (e.g. the spreadsheet) without touching the
// database. db:reset runs this first so a broken file never costs you the
// current demo league.
if (process.argv.includes('--check')) {
  loadDataset()
    .then((d) => { console.log(`✅ ${d.label}: ${d.programs.length} programs, ${d.programs.reduce((n, p) => n + p.venues.length, 0)} venues, ${d.directors.length} directors. Looks good.`); for (const w of d.warnings || []) console.log(`   ⚠️  ${w}`); process.exit(0); })
    .catch((err) => { console.error('❌', err.message); process.exit(1); });
} else main().then(() => process.exit(0)).catch((err) => { console.error('❌ Demo seed failed:', err.message); process.exit(1); });
