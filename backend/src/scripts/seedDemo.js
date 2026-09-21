// LOCAL DEVELOPMENT ONLY — fills the database with realistic demo data:
// a season, six programs, venues/courts, teams, weekly gym slots, blackouts,
// and one account per role. Refuses to run against Turso unless --force.
import { config } from '../config.js';
import { db, one, all, newId } from '../db/client.js';
import { hashPassword } from '../utils/security.js';
import { addDays } from '../utils/validate.js';
import { seedBase } from './seed.js';
import { generateDraft, getRules, getGame, placementOptions } from '../scheduling/data.js';
import { snapshotOf } from '../routes/requests.js';

if (!config.databaseUrl.startsWith('file:') && !process.argv.includes('--force')) {
  console.error('❌ seed:demo only runs against a local SQLite database. (Use --force to override — not recommended.)');
  process.exit(1);
}

const DEMO_PASSWORD = 'WinterDemo2026';

const PROGRAMS = [
  { name: 'Northfield Hawks', code: 'NFH', city: 'Northfield' },
  { name: 'Riverbend Youth Basketball', code: 'RYB', city: 'Riverbend' },
  { name: 'Cedar Park Cyclones', code: 'CPC', city: 'Cedar Park' },
  { name: 'Lakeview Lightning', code: 'LVL', city: 'Lakeview' },
  { name: 'Oak Hollow Owls', code: 'OHO', city: 'Oak Hollow' },
  { name: 'Westgate Wolves', code: 'WGW', city: 'Westgate' },
];

const VENUES = {
  NFH: [{ name: 'Northfield Middle School', courts: ['North court', 'South court'], lat: 42.099, lng: -87.781 }, { name: 'Hawks Community Center', courts: ['Main court'], lat: 42.105, lng: -87.77 }],
  RYB: [{ name: 'Riverbend High School', courts: ['Main gym', 'Aux gym'], lat: 41.95, lng: -87.89 }],
  CPC: [{ name: 'Cedar Park Elementary', courts: ['Main court'], lat: 41.88, lng: -87.95 }, { name: 'Cyclone Fieldhouse', courts: ['Court 1', 'Court 2', 'Court 3'], lat: 41.87, lng: -87.94 }],
  LVL: [{ name: 'Lakeview Recreation Center', courts: ['Main court'], lat: 41.94, lng: -87.65 }],
  OHO: [{ name: 'Oak Hollow Junior High', courts: ['Main gym'], lat: 41.79, lng: -87.8 }],
  WGW: [{ name: 'Westgate Academy', courts: ['East court', 'West court'], lat: 41.86, lng: -88.02 }],
};

async function main() {
  await seedBase({ quiet: true });
  if (await one('SELECT 1 FROM programs LIMIT 1')) {
    console.log('ℹ️  Demo data already present — nothing to do. (npm run db:reset starts fresh.)');
    return;
  }
  const stmts = [];
  const add = (sql, args) => stmts.push({ sql, args });

  const seasonId = newId();
  const seasonStart = '2026-11-02';
  add('INSERT INTO seasons (id, name, start_date, end_date, is_active) VALUES (?, ?, ?, ?, 1)', [seasonId, 'Winter 2026–27', seasonStart, '2027-02-28']);

  const divisions = await all('SELECT id, name FROM divisions ORDER BY sort_order');
  const div = (n) => divisions.find((d) => d.name === n).id;
  const pwHash = await hashPassword(DEMO_PASSWORD);
  const accounts = [];
  const user = (first, last, username, role, programId) => {
    const id = newId();
    add(`INSERT INTO users (id, first_name, last_name, username, email, password_hash, role, program_id, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`, [id, first, last, username, `${username}@example.com`, pwHash, role, programId]);
    accounts.push({ username, role });
    return id;
  };

  const programIds = {};
  for (const p of PROGRAMS) {
    programIds[p.code] = newId();
    add('INSERT INTO programs (id, name, short_code, city, contact_email) VALUES (?, ?, ?, ?, ?)',
      [programIds[p.code], p.name, p.code, p.city, `director@${p.code.toLowerCase()}.example.com`]);
  }

  user('Dana', 'Whitfield', 'dwhitfield', 'program_director', programIds.NFH);
  user('Marcus', 'Bell', 'mbell', 'program_director', programIds.RYB);
  const coachA = user('Tasha', 'Greene', 'tgreene', 'league_coach', programIds.NFH);
  const coachB = user('Luis', 'Ortega', 'lortega', 'league_coach', programIds.NFH);
  user('Priya', 'Nair', 'pnair', 'referee_assignor', null);
  user('Owen', 'Brooks', 'obrooks', 'referee', null);
  user('Grace', 'Kim', 'gkim', 'super_admin', null);

  // Teams: every program fields a few divisions.
  const teamDivs = ['5th Grade Boys', '6th Grade Boys', '7th Grade Boys', '6th Grade Girls', '8th Grade Girls'];
  for (const p of PROGRAMS) {
    teamDivs.forEach((d, i) => {
      if ((i + p.code.charCodeAt(0)) % 5 === 4) return; // not every program has every division
      const coach = p.code === 'NFH' && i === 0 ? coachA : p.code === 'NFH' && i === 1 ? coachB : null;
      add('INSERT INTO teams (id, program_id, division_id, name, head_coach_user_id) VALUES (?, ?, ?, ?, ?)',
        [newId(), programIds[p.code], div(d), `${p.name.split(' ')[0]} ${d.replace(' Grade', '')}`, coach]);
    });
  }

  // Venues, courts, and 10 weeks of weekly slots.
  const categoriesByDay = [
    { offset: 1, start: '18:00', end: '20:00', category: 'PRACTICE' },         // Tue
    { offset: 3, start: '18:30', end: '21:00', category: 'WEEKNIGHT_GAME' },    // Thu
    { offset: 5, start: '09:00', end: '15:00', category: 'WEEKEND_GAME_BLOCK' },// Sat
  ];
  let slotCount = 0;
  for (const p of PROGRAMS) {
    VENUES[p.code].forEach((v, vi) => {
      const venueId = newId();
      add('INSERT INTO venues (id, program_id, name, city, state, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [venueId, programIds[p.code], v.name, p.city, 'IL', v.lat, v.lng]);
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
  console.log(`✅ Demo data: 1 season, ${PROGRAMS.length} programs, ${slotCount} gym slots.`);

  // Phase 2: generate and publish a schedule, then file two sample change
  // requests so every approval screen has something in it.
  const season = await one('SELECT * FROM seasons WHERE id = ?', [seasonId]);
  const admin = await one("SELECT id FROM users WHERE username = 'gkim'");
  const draft = await generateDraft(season, await getRules(), admin.id);
  await db.execute({ sql: "UPDATE schedule_runs SET status = 'published', published_by = ?, published_at = datetime('now') WHERE id = ?", args: [admin.id, draft.runId] });
  const requests = await seedRequests(draft.runId, programIds);
  console.log(`✅ Demo schedule: ${draft.summary.scheduledGames} games published, ${requests} sample change requests.`);
  console.log(`\n   Demo accounts (password for all: ${DEMO_PASSWORD})`);
  for (const a of accounts) console.log(`     ${a.username.padEnd(12)} ${a.role}`);
  console.log('');
}

async function seedRequests(runId, programIds) {
  let made = 0;
  const reqStmt = (r) => ({
    sql: `INSERT INTO change_requests (id, game_id, type, proposed_court_id, proposed_date, proposed_start_time, proposed_end_time,
          reason, snapshot, requested_by, requesting_program_id, status) VALUES (?, ?, 'reschedule', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [r.id, r.gameId, r.opt.courtId, r.opt.date, r.opt.startTime, r.opt.endTime, r.reason, snapshotOf(r.game), r.userId, r.programId, r.status],
  });
  const step = (requestId, stage, programId) => ({ sql: 'INSERT INTO change_request_steps (id, request_id, stage, program_id) VALUES (?, ?, ?, ?)', args: [newId(), requestId, stage, programId] });

  // 1) Coach Tasha Greene (Northfield) asks to move one of her team's games -> waits on Dana (NFH director).
  const tasha = await one("SELECT id FROM users WHERE username = 'tgreene'");
  const g1 = await one(`SELECT g.id FROM games g JOIN teams t ON t.id IN (g.home_team_id, g.away_team_id)
    WHERE g.run_id = ? AND g.status = 'scheduled' AND t.head_coach_user_id = ? ORDER BY g.date LIMIT 1 OFFSET 2`, [runId, tasha.id]);
  // 2) Marcus Bell (Riverbend director) asks to move a Riverbend-vs-Northfield game -> waits on Northfield.
  const marcus = await one("SELECT id FROM users WHERE username = 'mbell'");
  const g2 = await one(`SELECT g.id FROM games g JOIN teams h ON h.id = g.home_team_id JOIN teams a ON a.id = g.away_team_id
    WHERE g.run_id = ? AND g.status = 'scheduled' AND ((h.program_id = ? AND a.program_id = ?) OR (h.program_id = ? AND a.program_id = ?))
      AND g.id != ? ORDER BY g.date LIMIT 1`, [runId, programIds.RYB, programIds.NFH, programIds.NFH, programIds.RYB, g1?.id || '']);

  for (const [row, userId, programId, status, reason] of [
    [g1, tasha.id, programIds.NFH, 'pending_director', 'Half our team has a school band concert that evening, so we’d be short of players.'],
    [g2, marcus.id, programIds.RYB, 'pending_counterpart', 'Riverbend High is hosting a regional tournament that weekend.'],
  ]) {
    if (!row) continue;
    const game = await getGame(row.id);
    const { options } = await placementOptions(game, { today: '2026-01-01', limit: 20 });
    const opt = options.find((o) => !o.overTravelCap && o.date > game.date);
    if (!opt) continue;
    const id = newId();
    const stmts = [reqStmt({ id, gameId: game.id, game, opt, reason, userId, programId, status })];
    if (status === 'pending_director') stmts.push(step(id, 'director', programId));
    for (const p of [...new Set([game.homeProgramId, game.awayProgramId])].filter((p) => p !== programId)) stmts.push(step(id, 'counterpart', p));
    await db.batch(stmts, 'write');
    made++;
  }
  return made;
}

main().then(() => process.exit(0)).catch((err) => { console.error('❌ Demo seed failed:', err.message); process.exit(1); });
