// End-to-end API checks against a running local server seeded with demo
// data (npm run db:reset, then npm run dev in another terminal).
// Usage: npm run test:smoke   [API_URL=http://localhost:4100/api]
const API = process.env.API_URL || 'http://localhost:4100/api';
let passed = 0;
let failed = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
function check(label, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label} ${extra}`); }
}
const login = async (u, p = 'WinterDemo2026') => (await call('POST', '/auth/login', { body: { username: u, password: p } })).data.token;

// These checks depend on the built-in test league (Northfield, Riverbend,
// dwhitfield, mbell, ...), not the demo spreadsheet. Stop early and say so.
{
  const probe = await call('POST', '/auth/login', { body: { username: 'dwhitfield', password: 'WinterDemo2026' } });
  const progs = probe.data?.token ? (await call('GET', '/programs', { token: probe.data.token })).data.programs || [] : [];
  if (!progs.some((p) => p.shortCode === 'NFH')) {
    console.error('❌ The smoke tests need the built-in test league, but the database has a different league loaded');
    console.error('   (probably the demo spreadsheet). Load the test league, restart the API, and run again:');
    console.error('     npm run db:reset:test');
    process.exit(1);
  }
}

console.log('\nAuth');
check('health endpoint', (await call('GET', '/health')).data.ok === true);
check('wrong password rejected', (await call('POST', '/auth/login', { body: { username: 'gkim', password: 'nope' } })).status === 401);
check('no token → 401', (await call('GET', '/programs')).status === 401);
const firstLogin = await call('POST', '/auth/login', { body: { username: 'ladmin', password: 'ChangeMe123!' } });
check('seeded admin must change password', firstLogin.data.user?.mustChangePassword === true);
check('forced change blocks other routes', (await call('GET', '/programs', { token: firstLogin.data.token })).status === 403);

const admin = await login('gkim');
const pd = await login('dwhitfield');   // Northfield (NFH)
const coach = await login('tgreene');   // Northfield coach
const ref = await login('obrooks');

const programs = (await call('GET', '/programs', { token: admin })).data.programs;
const nfh = programs.find((p) => p.shortCode === 'NFH');
const ryb = programs.find((p) => p.shortCode === 'RYB');

console.log('\nRole & program isolation');
check('director cannot list users', (await call('GET', '/users', { token: pd })).status === 403);
check('coach cannot see gym slots', (await call('GET', '/slots?from=2026-11-01&to=2026-11-30', { token: coach })).status === 403);
check('referee cannot see venues', (await call('GET', '/venues', { token: ref })).status === 403);
const pdVenues = (await call('GET', '/venues', { token: pd })).data.venues;
check('director sees only own venues', pdVenues.length > 0 && pdVenues.every((v) => v.programId === nfh.id));
check('director cannot query another program', (await call('GET', `/venues?programId=${ryb.id}`, { token: pd })).status === 403);
const rybVenue = (await call('GET', `/venues?programId=${ryb.id}`, { token: admin })).data.venues[0];
check('director cannot edit another program’s venue', (await call('PUT', `/venues/${rybVenue.id}`, { token: pd, body: { name: 'Hijacked' } })).status === 403);
const forced = await call('POST', '/venues', { token: pd, body: { programId: ryb.id, name: 'Sneaky Gym' } });
check('director create is pinned to own program', forced.status === 201 && forced.data.venue.programId === nfh.id);
await call('DELETE', `/venues/${forced.data.venue.id}`, { token: pd });
check('director cannot change theme', (await call('PUT', '/settings/theme', { token: pd, body: { theme: 'dark' } })).status === 403);

console.log('\nGym slots');
const court = pdVenues[0].courts[0];
const base = { courtId: court.id, startTime: '06:00', endTime: '07:30', category: 'PRACTICE' };
const single = await call('POST', '/slots', { token: pd, body: { ...base, date: '2026-11-09' } });
check('create single slot', single.status === 201 && single.data.slots.length === 1);
const overlap = await call('POST', '/slots', { token: pd, body: { ...base, date: '2026-11-09', startTime: '07:00', endTime: '08:00' } });
check('overlap rejected with 409', overlap.status === 409, JSON.stringify(overlap.data));
const adjacent = await call('POST', '/slots', { token: pd, body: { ...base, date: '2026-11-09', startTime: '07:30', endTime: '08:00' } });
check('adjacent slot allowed', adjacent.status === 201);
check('end before start rejected', (await call('POST', '/slots', { token: pd, body: { ...base, date: '2026-11-10', startTime: '09:00', endTime: '08:00' } })).status === 400);
check('outside season rejected', (await call('POST', '/slots', { token: pd, body: { ...base, date: '2027-06-01' } })).status === 409);

const repeat = await call('POST', '/slots', { token: pd, body: { ...base, startTime: '05:00', endTime: '05:45', date: '2026-11-19', repeatWeeklyUntil: '2027-01-07' } });
const skippedBlackout = repeat.data.skipped?.filter((s) => s.reason.startsWith('blackout')) || [];
check('weekly repeat creates series', repeat.status === 201 && repeat.data.slots.length >= 5, JSON.stringify(repeat.data).slice(0, 200));
check('repeat skips blackout dates (Thanksgiving + winter break)', skippedBlackout.length === 3, JSON.stringify(repeat.data.skipped));

const bo = await call('POST', '/blackouts', { token: pd, body: { startDate: '2026-11-09', endDate: '2026-11-09', reason: 'Gym floor refinish', venueId: pdVenues[0].id } });
check('blackout created and counts affected slots', bo.status === 201 && bo.data.blackout.affectedSlots >= 2);
const nov9 = (await call('GET', '/slots?from=2026-11-09&to=2026-11-09', { token: pd })).data.slots;
check('slot shows as blacked out (not deleted)', nov9.some((s) => s.isBlackedOut && s.blackoutReason === 'Gym floor refinish'));
await call('DELETE', `/blackouts/${bo.data.blackout.id}`, { token: pd });
const nov9b = (await call('GET', '/slots?from=2026-11-09&to=2026-11-09', { token: pd })).data.slots;
check('removing blackout restores slots', nov9b.length === nov9.length && nov9b.every((s) => !s.isBlackedOut || s.venueId !== pdVenues[0].id));

const del = await call('DELETE', `/slots/${repeat.data.slots[2].id}?scope=following`, { token: pd });
check('delete "this and following" in series', del.data.deleted === repeat.data.slots.length - 2);

console.log('\nHealth check');
{
  const h = (await call('GET', '/health')).data;
  check('health reports the database version', h.ok === true && h.schema >= 7 && /^\d+.*\.sql$/.test(h.latestUpdate || ''), JSON.stringify(h));
}

console.log('\nLeague time zone');
check('the league runs on Pacific Time', (await call('GET', '/settings/branding')).data.timezone === 'America/Los_Angeles');
{
  const { leagueNow } = await import('../utils/leagueTime.js');
  // Thursday 6:00 PM Pacific = Friday 02:00 UTC. The league must still say Thursday.
  const eve = leagueNow(new Date('2026-11-06T02:00:00Z'));
  check('a Thursday-evening game is still "today" after UTC midnight', eve.date === '2026-11-05' && eve.minutes === 18 * 60);
  const summer = leagueNow(new Date('2026-07-01T06:30:00Z')); // 11:30 PM PDT (UTC-7)
  check('daylight saving time is applied in summer', summer.date === '2026-06-30' && summer.minutes === 23 * 60 + 30);
  const springForward = leagueNow(new Date('2026-03-08T10:30:00Z')); // 3:30 AM PDT, just after the clocks change
  check('the spring clock change is handled', springForward.date === '2026-03-08' && springForward.minutes === 3 * 60 + 30);
  const fallBack = leagueNow(new Date('2026-11-01T09:30:00Z')); // 1:30 AM PST, after the clocks go back
  check('the fall clock change is handled', fallBack.date === '2026-11-01' && fallBack.minutes === 60 + 30);
}
console.log('\nAdmin');
const ph1 = await call('POST', '/users', { token: admin, body: { firstName: 'Phone', lastName: 'Format', email: 'phone@example.com', phone: '(312) 555-0199', role: 'league_coach', programId: nfh.id } });
check('formatted phone is stored as digits', ph1.status === 201 && (await call('GET', '/users', { token: admin })).data.users.find((u) => u.email === 'phone@example.com')?.phone === '3125550199');
const phUser = (await call('GET', '/users', { token: admin })).data.users.find((u) => u.email === 'phone@example.com');
check('+1 and dots are accepted', (await call('PUT', `/users/${phUser.id}`, { token: admin, body: { phone: '+1 773.555.0100' } })).status === 200
  && (await call('GET', '/users', { token: admin })).data.users.find((u) => u.id === phUser.id).phone === '7735550100');
await (await import('../db/client.js')).run("UPDATE users SET phone = '5550101' WHERE id = ?", [phUser.id]); // an old 7-digit entry from before digits-only
check('an unchanged old phone does not block other edits', (await call('PUT', `/users/${phUser.id}`, { token: admin, body: { firstName: 'Phoned', phone: '5550101' } })).status === 200);
check('short phone numbers are rejected', (await call('PUT', `/users/${phUser.id}`, { token: admin, body: { phone: '555-0100' } })).status === 400);
check('clearing the phone is allowed', (await call('PUT', `/users/${phUser.id}`, { token: admin, body: { phone: '' } })).status === 200
  && (await call('GET', '/users', { token: admin })).data.users.find((u) => u.id === phUser.id).phone === null);
check('program contact phone is stored as digits', (await call('PUT', `/programs/${nfh.id}`, { token: admin, body: { contactPhone: '(847) 555-0111' } })).status === 200
  && (await call('GET', '/programs', { token: admin })).data.programs.find((p) => p.id === nfh.id).contactPhone === '8475550111');
const pubBrand = await call('GET', '/settings/branding');
check('branding is readable before sign-in', pubBrand.status === 200 && pubBrand.data.branding.appName === 'Winter League' && pubBrand.data.branding.logo === null);
check('only System Admins can change branding', (await call('PUT', '/settings/branding', { token: pd, body: { appName: 'Hijacked' } })).status === 403);
check('app name is required', (await call('PUT', '/settings/branding', { token: admin, body: { appName: ' ' } })).status === 400);
check('non-image logos are rejected', (await call('PUT', '/settings/branding', { token: admin, body: { appName: 'Test', logo: 'data:text/html;base64,PHNjcmlwdD4=' } })).status === 400);
check('oversized logos are rejected', (await call('PUT', '/settings/branding', { token: admin, body: { appName: 'Test', logo: `data:image/png;base64,${'A'.repeat(420000)}` } })).status === 400);
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const br = await call('PUT', '/settings/branding', { token: admin, body: { appName: '  Pacific   Youth Conference ', logo: tinyPng } });
check('branding saves (name tidied, logo kept)', br.status === 200 && br.data.branding.appName === 'Pacific Youth Conference' && br.data.branding.logo === tinyPng);
check('new branding is public', (await call('GET', '/settings/branding')).data.branding.appName === 'Pacific Youth Conference');
check('back to defaults', (await call('PUT', '/settings/branding', { token: admin, body: { appName: 'Winter League', logo: null } })).data.branding?.logo === null);
for (const t of ['pacificEnergy', 'midnightPacific']) {
  check(`${t} theme can be chosen`, (await call('PUT', '/settings/theme', { token: admin, body: { theme: t } })).status === 200
    && (await call('GET', '/settings/theme')).data.theme === t);
}
check('the old theme id is no longer accepted', (await call('PUT', '/settings/theme', { token: admin, body: { theme: 'pacificYouthConference' } })).status === 400);
check('unknown themes are rejected', (await call('PUT', '/settings/theme', { token: admin, body: { theme: 'neonJungle' } })).status === 400);
await call('PUT', '/settings/theme', { token: admin, body: { theme: 'light' } });
const nu = await call('POST', '/users', { token: admin, body: { firstName: 'Test', lastName: 'Director', email: 't@example.com', role: 'program_director' } });
check('director requires a program', nu.status === 400);
const nu2 = await call('POST', '/users', { token: admin, body: { firstName: 'Test', lastName: 'Director', email: 't@example.com', role: 'program_director', programId: nfh.id } });
check('user created with temp password', nu2.status === 201 && !!nu2.data.temporaryPassword);
const me = (await call('GET', '/auth/me', { token: admin })).data.user;
check('admin cannot demote self', (await call('PUT', `/users/${me.id}`, { token: admin, body: { role: 'referee' } })).status === 400);
check('16-program cap is enforced setting', (await call('GET', '/programs', { token: admin })).data.maxPrograms === 16);

// =====================================================================
// Phase 2 — scheduling (Module B) and change requests (Module D)
// =====================================================================
const mbell = await login('mbell');       // Riverbend (RYB) director
const teamsAll = (await call('GET', '/teams', { token: admin })).data.teams;
const teamDiv = Object.fromEntries(teamsAll.map((t) => [t.id, t.divisionId]));
const teamProg = Object.fromEntries(teamsAll.map((t) => [t.id, t.programId]));

console.log('\nSchedule access');
const pubView = await call('GET', '/schedule/games', { token: coach });
check('coach sees the published schedule', pubView.status === 200 && pubView.data.published && pubView.data.games.length > 0);
check('referee sees the published schedule', (await call('GET', '/schedule/games', { token: ref })).data.games?.length > 0);
check('coach cannot open the schedule builder', (await call('GET', '/schedule/overview', { token: coach })).status === 403);
check('director cannot generate a schedule', (await call('POST', '/schedule/generate', { token: pd, body: {} })).status === 403);
check('invalid rules rejected', (await call('PUT', '/schedule/rules', { token: admin, body: { gamesPerTeam: 0 } })).status === 400);

console.log('\nOpponent rules');
check('rematch limit above 6 is rejected', (await call('PUT', '/schedule/rules', { token: admin, body: { maxVsSameOpponent: 7 } })).status === 400);
check('same-program switch must be on or off', (await call('PUT', '/schedule/rules', { token: admin, body: { allowSameProgram: 'yes' } })).status === 400);
const defaultRules = (await call('GET', '/schedule/rules', { token: admin })).data.rules;
check('defaults: same-program games off, at most 2 games per opponent', defaultRules.allowSameProgram === false && defaultRules.maxVsSameOpponent === 2);
// A division where one program has two teams: add a second Northfield 6th Grade Girls team.
const g6 = (await call('GET', '/league/divisions', { token: admin })).data.divisions.find((d) => d.name === '6th Grade Girls');
const sister = await call('POST', '/teams', { token: pd, body: { name: 'Northfield 6th Girls Developmental', divisionId: g6.id } });
check('director adds a second team in the same division', sister.status === 201, JSON.stringify(sister.data).slice(0, 120));
teamDiv[sister.data.team.id] = g6.id; // keep the lookups used by later checks current
teamProg[sister.data.team.id] = nfh.id;
const teamProgAll = Object.fromEntries((await call('GET', '/teams', { token: admin })).data.teams.map((t) => [t.id, t.programId]));
async function draftWith(rules) {
  const r = await call('POST', '/schedule/generate', { token: admin, body: { rules: { gamesPerTeam: 8, gameMinutes: 60, maxTravelMiles: 30, minDaysBetween: 2, maxGamesPerWeek: 2, ...rules } } });
  const games = (await call('GET', `/schedule/runs/${r.data.draft.id}/games`, { token: admin })).data.games;
  const meets = {};
  for (const g of games) { const k = [g.homeTeamId, g.awayTeamId].sort().join('|'); meets[k] = (meets[k] || 0) + 1; }
  return { draft: r.data.draft, games, most: Math.max(...Object.values(meets)), same: games.filter((g) => teamProgAll[g.homeTeamId] === teamProgAll[g.awayTeamId]).length };
}
const dOff = await draftWith({ allowSameProgram: false, maxVsSameOpponent: 2 });
check('no games between teams from the same program (default)', dOff.same === 0);
check('no pair meets more than twice (default)', dOff.most <= 2);
check('the draft explains teams left short by the rules', dOff.draft.warnings.some((w) => w.includes('possible opponent')), dOff.draft.warnings.join(' | ').slice(0, 200));
const dOn = await draftWith({ allowSameProgram: true, maxVsSameOpponent: 2 });
check('switching it on allows same-program games', dOn.same > 0);
const d1 = await draftWith({ maxVsSameOpponent: 1 });
check('a limit of 1 means no rematches', d1.most === 1 && d1.same === 0);
const dNone = await draftWith({ maxVsSameOpponent: null });
check('"No limit" saves and generates', dNone.draft.rules.maxVsSameOpponent === null && dNone.same === 0);
check('rules saved with the draft are the league rules now', (await call('GET', '/schedule/rules', { token: admin })).data.rules.maxVsSameOpponent === null);
await call('PUT', '/schedule/rules', { token: admin, body: { ...defaultRules } });

console.log('\nMatchmaker draft');
const gen = await call('POST', '/schedule/generate', { token: admin, body: { rules: { gamesPerTeam: 8, gameMinutes: 60, maxTravelMiles: 30, minDaysBetween: 2, maxGamesPerWeek: 2 } } });
check('draft generated', gen.status === 201 && gen.data.draft.status === 'draft' && gen.data.draft.summary.scheduledGames > 0, JSON.stringify(gen.data).slice(0, 200));
const draftId = gen.data.draft.id;
const dg = (await call('GET', `/schedule/runs/${draftId}/games`, { token: admin })).data.games;
const placed = dg.filter((g) => g.status === 'scheduled');
check('every game is within one division', dg.every((g) => teamDiv[g.homeTeamId] === teamDiv[g.awayTeamId] && teamDiv[g.homeTeamId] === g.divisionId));
const seen = new Set(); let dup = false;
for (const g of placed) for (const t of [g.homeTeamId, g.awayTeamId]) { const k = `${t}|${g.date}`; if (seen.has(k)) dup = true; seen.add(k); }
check('no team plays twice in a day', !dup);
const courtKeys = placed.map((g) => `${g.courtId}|${g.date}|${g.startTime}`);
check('no court used twice at once', new Set(courtKeys).size === courtKeys.length);
check('home team hosts at its own program', placed.every((g) => g.venueProgramId === teamProg[g.homeTeamId]));
check('no games on program blackout days', placed.every((g) => !g.hasBlackoutConflict));
check('travel within the cap', placed.every((g) => g.travelMiles == null || g.travelMiles <= 30));
const byWeek = {}; let tooMany = false;
for (const g of placed) for (const t of [g.homeTeamId, g.awayTeamId]) {
  const d = new Date(`${g.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const k = `${t}|${d.toISOString().slice(0, 10)}`; byWeek[k] = (byWeek[k] || 0) + 1; if (byWeek[k] > 2) tooMany = true;
}
check('max 2 games per team per week', !tooMany);
check('drafts are hidden from directors', (await call('GET', `/schedule/games/${placed[0].id}`, { token: pd })).status === 404);

console.log('\nAdmin review edits');
const target = placed[0];
const opts = (await call('GET', `/schedule/games/${target.id}/options`, { token: admin })).data.options;
check('open windows offered for a game', opts.length > 0);
const opt = opts.find((o) => !o.flip) || opts[0];
const mv = await call('PUT', `/schedule/games/${target.id}`, { token: admin, body: { courtId: opt.courtId, date: opt.date, startTime: opt.startTime, endTime: opt.endTime } });
check('admin moves a game to an open window', mv.status === 200 && mv.data.game.date === opt.date);
const other = placed.find((g) => g.id !== target.id && g.venueProgramId === mv.data.game.venueProgramId);
if (other) {
  const clash = await call('PUT', `/schedule/games/${target.id}`, { token: admin, body: { courtId: other.courtId, date: other.date, startTime: other.startTime, endTime: other.endTime } });
  check('moving onto a taken court is refused', clash.status === 409);
}
const fl = await call('PUT', `/schedule/games/${target.id}`, { token: admin, body: { action: 'flip' } });
check('flip swaps home and away', fl.data.game.homeTeamId === mv.data.game.awayTeamId);

console.log('\nPublishing');
const openBefore = (await call('GET', '/requests?state=open', { token: admin })).data.requests.length;
check('demo has open sample requests', openBefore >= 1);
check('publishing over a live schedule needs confirmation', (await call('POST', `/schedule/runs/${draftId}/publish`, { token: admin, body: {} })).data.code === 'REPLACE_REQUIRED');
const pubr = await call('POST', `/schedule/runs/${draftId}/publish`, { token: admin, body: { replace: true } });
check('draft published', pubr.status === 200 && pubr.data.published.status === 'published');
check('open requests on the old schedule were cancelled', (await call('GET', '/requests?state=open', { token: admin })).data.requests.length === 0);

console.log('\nChange requests — reschedule');
const myGames = (await call('GET', '/schedule/games?mine=1', { token: coach })).data.games;
const vsRyb = myGames.find((g) => g.canRequest && [g.homeProgramId, g.awayProgramId].includes(ryb.id));
check('coach has a requestable game against Riverbend', !!vsRyb);
const notMine = (await call('GET', '/schedule/games', { token: coach })).data.games.find((g) => !g.canRequest && g.homeProgramId !== nfh.id && g.awayProgramId !== nfh.id);
check('coach cannot request for other teams', (await call('POST', '/requests', { token: coach, body: { gameId: notMine.id, type: 'reschedule', reason: 'Testing access', courtId: 'x', date: '2026-12-01', startTime: '10:00', endTime: '11:00' } })).status === 403);
check('coach cannot swap with another team’s game', (await call('POST', '/requests', { token: coach, body: { gameId: vsRyb.id, type: 'swap', swapGameId: notMine.id, reason: 'Testing swap scope' } })).status === 403);
const coachSwaps = (await call('GET', `/schedule/games/${vsRyb.id}/swap-options`, { token: coach })).data.options;
const coachId = (await call('GET', '/auth/me', { token: coach })).data.user.id;
check('coach swap options only include their own games', coachSwaps.every((o) => [o.game.homeCoachId, o.game.awayCoachId].includes(coachId)));
const copts = (await call('GET', `/schedule/games/${vsRyb.id}/options`, { token: coach })).data.options;
const co = copts.find((o) => !o.overTravelCap);
const body = { gameId: vsRyb.id, type: 'reschedule', courtId: co.courtId, date: co.date, startTime: co.startTime, endTime: co.endTime };
check('reason is required', (await call('POST', '/requests', { token: coach, body: { ...body, reason: '' } })).status === 400);
const cr = await call('POST', '/requests', { token: coach, body: { ...body, reason: 'Team photo night at our school.' } });
check('coach request starts with their director', cr.status === 201 && cr.data.request.status === 'pending_director');
check('only one open request per game', (await call('POST', '/requests', { token: pd, body: { ...body, reason: 'Duplicate request' } })).status === 409);
check('other program cannot act before endorsement', (await call('POST', `/requests/${cr.data.request.id}/act`, { token: mbell, body: { action: 'approve' } })).status === 403);
check('director sees it in their badge count', (await call('GET', '/requests/count', { token: pd })).data.needsAction >= 1);
const s1 = await call('POST', `/requests/${cr.data.request.id}/act`, { token: pd, body: { action: 'approve' } });
check('director endorsement → other program', s1.data.request?.status === 'pending_counterpart');
check('deny needs a note', (await call('POST', `/requests/${cr.data.request.id}/act`, { token: mbell, body: { action: 'deny' } })).status === 400);
const s2 = await call('POST', `/requests/${cr.data.request.id}/act`, { token: mbell, body: { action: 'approve' } });
check('counterpart approval → league sign-off', s2.data.request?.status === 'pending_admin');
check('coach cannot sign off', (await call('POST', `/requests/${cr.data.request.id}/act`, { token: coach, body: { action: 'approve' } })).status === 403);
const s3 = await call('POST', `/requests/${cr.data.request.id}/act`, { token: admin, body: { action: 'approve' } });
check('admin sign-off applies the change', s3.data.request?.status === 'approved' && s3.data.request.game.date === co.date && s3.data.request.game.courtId === co.courtId);

check('approved request still shows where the game was', s3.data.request?.before?.game?.date === vsRyb.date && s3.data.request.before.game.courtId === vsRyb.courtId);

console.log('\nActivity for a request between two programs');
const cpc = programs.find((x) => x.shortCode === 'CPC');
const actReq = async (token, extra = '') => (await call('GET', `/activity?category=request${extra}`, { token })).data.entries;
const nfhSees = await actReq(pd);
const rybSees = await actReq(mbell);
const signOff = nfhSees.find((e) => e.action === 'applied' && e.actorName === 'Grace Kim');
check('the requesting coach’s director sees the admin’s sign-off', !!signOff);
check('the other program’s director sees it too', !!signOff && rybSees.some((e) => e.id === signOff.id));
check('both directors see every step of the request', ['created', 'approved', 'applied'].every((act) => nfhSees.some((e) => e.action === act) && rybSees.some((e) => e.action === act)));
check('the entry lists both programs involved', !!signOff && ['NFH', 'RYB'].every((c) => signOff.programs.some((p) => p.shortCode === c)));
check('the admin is shown by role, not a program', signOff?.actorRole === 'super_admin' && !signOff.actorProgramCode);
const rybStep = nfhSees.find((e) => e.actorName === 'Marcus Bell');
check('Riverbend’s director is shown with RYB, even on the request’s record', rybStep?.actorProgramCode === 'RYB');
const nfhStep = rybSees.find((e) => e.actorName === 'Dana Whitfield');
check('Northfield’s director is shown with NFH', nfhStep?.actorProgramCode === 'NFH');
check('the coach is shown with their program', nfhSees.find((e) => e.action === 'created')?.actorProgramCode === 'NFH');
check('a program not involved doesn’t see it', !(await actReq(admin, `&programId=${cpc.id}`)).some((e) => e.id === signOff?.id));
// An admin change to a published game shows up for both teams' directors.
await call('PUT', `/schedule/games/${vsRyb.id}`, { token: admin, body: { action: 'flip' } });
const flipNfh = (await call('GET', '/activity?category=schedule', { token: pd })).data.entries[0];
const flipRyb = (await call('GET', '/activity?category=schedule', { token: mbell })).data.entries[0];
check('an admin’s change to a game reaches both teams’ directors', !!flipNfh && flipNfh.id === flipRyb?.id && /Swapped home\/away/.test(flipNfh.details));
await call('PUT', `/schedule/games/${vsRyb.id}`, { token: admin, body: { action: 'flip' } });
console.log('\nChange requests — swap, deny, cancel');
const pdGames = (await call('GET', '/schedule/games?mine=1', { token: pd })).data.games.filter((g) => g.canRequest);
let swapped = false;
for (const g of pdGames.slice(0, 12)) {
  const so = (await call('GET', `/schedule/games/${g.id}/swap-options`, { token: pd })).data.options;
  if (!so?.length) continue;
  const sw = await call('POST', '/requests', { token: pd, body: { gameId: g.id, type: 'swap', swapGameId: so[0].game.id, reason: 'Swap to avoid a double-header weekend.' } });
  check('director files a swap', sw.status === 201 && sw.data.request.type === 'swap');
  const dn = await call('POST', `/requests/${sw.data.request.id}/act`, { token: admin, body: { action: 'deny', note: 'Please keep the original dates.' } });
  check('admin can deny at any stage', dn.data.request?.status === 'denied');
  swapped = true;
  break;
}
check('swap options found for a director game', swapped);
const g3 = pdGames.find((g) => g.id !== vsRyb.id);
const o3 = (await call('GET', `/schedule/games/${g3.id}/options`, { token: pd })).data.options[0];
const r3 = await call('POST', '/requests', { token: pd, body: { gameId: g3.id, type: 'reschedule', reason: 'Checking cancel flow.', courtId: o3.courtId, date: o3.date, startTime: o3.startTime, endTime: o3.endTime } });
check('director request skips the director step', ['pending_counterpart', 'pending_admin'].includes(r3.data.request?.status));
check('other directors cannot cancel it', (await call('POST', `/requests/${r3.data.request.id}/cancel`, { token: mbell })).status >= 403);
check('requester can cancel', (await call('POST', `/requests/${r3.data.request.id}/cancel`, { token: pd })).data.request?.status === 'cancelled');

console.log('\nCancelling a game');
const toCancel = (await call('GET', '/schedule/games?mine=1', { token: coach })).data.games.find((g) => g.canRequest && !g.hasOpenRequest);
check('a reason is required to ask for a cancellation', (await call('POST', '/requests', { token: coach, body: { gameId: toCancel.id, type: 'cancel', reason: '' } })).status === 400);
const cReq = await call('POST', '/requests', { token: coach, body: { gameId: toCancel.id, type: 'cancel', reason: 'Snow closed the school; the gym is unavailable.' } });
check('a coach can ask for a game to be cancelled', cReq.status === 201 && cReq.data.request.type === 'cancel' && cReq.data.request.status === 'pending_director');
check('it reads as a cancellation', /^Cancel /.test(cReq.data.request.summary), cReq.data.request.summary);
const cid = cReq.data.request.id;
const steps = cReq.data.request.steps.filter((x) => x.stage === 'counterpart').map((x) => x.programId);
check('the other program still has to agree', steps.length >= 1);
await call('POST', `/requests/${cid}/act`, { token: pd, body: { action: 'approve' } });              // their director
// The other program agrees when it's Riverbend (the only other director in the test league);
// otherwise the league signs off directly, which it may do at any stage.
if (steps.includes(ryb.id)) await call('POST', `/requests/${cid}/act`, { token: mbell, body: { action: 'approve' } });
const cancelSignOff = await call('POST', `/requests/${cid}/act`, { token: admin, body: { action: 'approve' } });
const cancelledGame = cancelSignOff.data.request?.game;
check('the league signs off and the game is cancelled', cancelSignOff.data.request?.status === 'approved' && cancelledGame?.status === 'cancelled');
check('the reason is kept on the game', cancelledGame.cancelReason === 'Snow closed the school; the gym is unavailable.');
check('a cancelled game still shows on the schedule', (await call('GET', '/schedule/games', { token: coach })).data.games.some((g) => g.id === toCancel.id && g.status === 'cancelled'));
check('its referees are released', !(await call('GET', `/schedule/games/${toCancel.id}`, { token: admin })).data.game.refereeNames);
check('a cancelled game can’t be requested again', (await call('POST', '/requests', { token: coach, body: { gameId: toCancel.id, type: 'cancel', reason: 'Changed my mind about this' } })).status === 400);
check('a cancelled game can’t be scored', (await call('PUT', `/schedule/games/${toCancel.id}/score`, { token: pd, body: { homeScore: 10, awayScore: 8 } })).status === 409);
check('the league can restore it', (await call('PUT', `/schedule/games/${toCancel.id}`, { token: admin, body: { action: 'restore' } })).data.game?.status === 'scheduled');
check('restoring clears the cancellation reason', !(await call('GET', `/schedule/games/${toCancel.id}`, { token: admin })).data.game.cancelReason);
// A game the director could still ask to change is, by definition, upcoming and unplayed.
const nfhLive = (await call('GET', `/schedule/games?programId=${nfh.id}`, { token: pd })).data.games.find((g) => g.canRequest && !g.hasOpenRequest);
check('an admin must give a reason to cancel directly', (await call('PUT', `/schedule/games/${nfhLive.id}`, { token: admin, body: { action: 'cancel' } })).status === 400);
const adminCancel = await call('PUT', `/schedule/games/${nfhLive.id}`, { token: admin, body: { action: 'cancel', reason: 'Gym floor damaged by a leak.' } });
check('an admin cancels with a reason', adminCancel.data.game?.status === 'cancelled' && adminCancel.data.game.cancelReason === 'Gym floor damaged by a leak.');
check('both programs see the cancellation in Activity', (await call('GET', '/activity?category=schedule', { token: pd })).data.entries.some((e) => e.details.includes('Gym floor damaged by a leak.')));
await call('PUT', `/schedule/games/${nfhLive.id}`, { token: admin, body: { action: 'restore' } });

console.log('\nData integrity with a live schedule');
const liveNfh = (await call('GET', `/schedule/games?programId=${nfh.id}`, { token: admin })).data.games.find((g) => g.venueProgramId === nfh.id && g.status === 'scheduled');
check('gym slot holding a published game cannot be deleted', (await call('DELETE', `/slots/${liveNfh.gymSlotId}`, { token: pd })).status === 409);
const bo2 = await call('POST', '/blackouts', { token: pd, body: { startDate: liveNfh.date, endDate: liveNfh.date, reason: 'Gym floor refinishing' } });
check('new blackout reports affected games', bo2.status === 201 && bo2.data.affectedGames >= 1);
check('affected game is flagged', (await call('GET', `/schedule/games/${liveNfh.id}`, { token: pd })).data.game.hasBlackoutConflict === true);
await call('DELETE', `/blackouts/${bo2.data.blackout.id}`, { token: pd });
check('team with games cannot be deleted', (await call('DELETE', `/teams/${liveNfh.homeTeamId}`, { token: pd })).status === 409);

// =====================================================================
// Phase 3 — referees (Module C)
// =====================================================================
const assignor = await login('pnair');
const refA = await login('obrooks');
const refB = await login('acoleman');
const meA = (await call('GET', '/auth/me', { token: refA })).data.user;
const meB = (await call('GET', '/auth/me', { token: refB })).data.user;

console.log('\nReferee access');
check('referee cannot open the roster', (await call('GET', '/referees/roster', { token: refA })).status === 403);
check('director cannot assign referees', (await call('GET', '/referees/games', { token: pd })).status === 403);
check('coach cannot see referee pages', (await call('GET', '/referees/me/assignments', { token: coach })).status === 403);
check('invalid referee settings rejected', (await call('PUT', '/referees/settings', { token: assignor, body: { refereesPerGame: 9 } })).status === 400);
const roster = (await call('GET', '/referees/roster', { token: assignor })).data;
check('roster lists the demo referees', roster.referees.filter((r) => r.isActive).length >= 8);
check('unavailable dates show on the roster', roster.referees.find((r) => r.id === meA.id).unavailable.length >= 1);

console.log('\nAssigning');
const rg = (await call('GET', '/referees/games', { token: assignor })).data;
check('every published game has two referee slots', rg.games.length > 0 && rg.games.every((g) => g.assignments.length === 2));
// Assigned referees show on the schedule, for everyone.
const withRefs = (await call('GET', '/schedule/games', { token: coach })).data.games;
check('the schedule lists who is refereeing', withRefs.some((g) => g.refereeNames) && withRefs.every((g) => g.refereeSlots >= 2));
check('games without referees say so', withRefs.filter((g) => !g.refereeNames).every((g) => g.refereeNames === null));

// Find an open game where at least one referee is actually free (busy
// time slots can have every referee already working).
let openSlotGame = null;
let cand = [];
for (const g of rg.games.filter((x) => x.assignments.every((a) => !a.refereeId))) {
  cand = (await call('GET', `/referees/assignments/${g.assignments[0].id}/candidates`, { token: assignor })).data.candidates;
  if (cand.some((c) => !c.blocking.length)) { openSlotGame = g; break; }
}
check('some upcoming games still need referees', !!openSlotGame);
check('candidates listed for an open slot', cand.length >= 8);
const pick = cand.find((c) => !c.blocking.length);
const as1 = await call('PUT', `/referees/assignments/${openSlotGame.assignments[0].id}`, { token: assignor, body: { refereeId: pick.id } });
check('assignor assigns a referee', as1.status === 200 && as1.data.game.assignments[0].refereeId === pick.id);
check('same referee twice on one game is refused', (await call('PUT', `/referees/assignments/${openSlotGame.assignments[1].id}`, { token: assignor, body: { refereeId: pick.id } })).status === 409);
const sameTime = rg.games.find((g) => g.id !== openSlotGame.id && g.date === openSlotGame.date && g.startTime < openSlotGame.endTime && openSlotGame.startTime < g.endTime);
check('a same-time game exists to test double-booking', !!sameTime);
const clashSlot = sameTime.assignments.find((a) => a.refereeId !== pick.id);
check('double-booking a referee at the same time is refused', (await call('PUT', `/referees/assignments/${clashSlot.id}`, { token: assignor, body: { refereeId: pick.id } })).status === 409);
const unavGame = (await call('GET', '/referees/games?from=2026-11-07&to=2026-11-07', { token: assignor })).data.games[0];
const unavSlot = unavGame.assignments.find((a) => a.refereeId !== meA.id);
check('an unavailable referee is refused', (await call('PUT', `/referees/assignments/${unavSlot.id}`, { token: assignor, body: { refereeId: meA.id } })).status === 409);

const fill = await call('POST', '/referees/auto-fill', { token: assignor, body: { from: '2026-12-01', to: '2027-01-31' } });
check('auto-fill fills open slots', fill.status === 200 && fill.data.filled > 0);
const after = (await call('GET', '/referees/games', { token: assignor })).data.games;
let doubleBooked = false;
const refDay = new Map();
for (const g of after) for (const a of g.assignments.filter((x) => x.refereeId)) {
  const k = `${a.refereeId}|${g.date}`;
  for (const o of refDay.get(k) || []) if (o.startTime < g.endTime && g.startTime < o.endTime) doubleBooked = true;
  refDay.set(k, [...(refDay.get(k) || []), g]);
}
check('no referee is ever double-booked', !doubleBooked);
check('no game has the same referee twice', after.every((g) => { const ids = g.assignments.map((a) => a.refereeId).filter(Boolean); return new Set(ids).size === ids.length; }));

console.log('\nReferee self-service');
const mine = (await call('GET', '/referees/me/assignments', { token: refB })).data.assignments;
check('referee sees their games', mine.length > 0);
const futureOne = mine.find((m) => m.canDecline);
check('check-in is closed before game day', (await call('POST', `/referees/me/assignments/${futureOne.id}/check-in`, { token: refB, body: {} })).status === 409);
check('decline needs a reason', (await call('POST', `/referees/me/assignments/${futureOne.id}/decline`, { token: refB, body: {} })).status === 400);
check('referee cannot touch someone else’s game', (await call('POST', `/referees/me/assignments/${futureOne.id}/decline`, { token: refA, body: { reason: 'Not mine' } })).status === 403);
const dec = await call('POST', `/referees/me/assignments/${futureOne.id}/decline`, { token: refB, body: { reason: 'School event' } });
check('referee declines a future game', dec.status === 200);
const reopened = (await call('GET', `/referees/games?from=${futureOne.game.date}&to=${futureOne.game.date}`, { token: assignor })).data.games.find((g) => g.id === futureOne.game.id);
check('declined slot reopens', reopened.assignments.find((a) => a.id === futureOne.id).refereeId === null);
const un = await call('POST', '/referees/me/unavailability', { token: refB, body: { startDate: futureOne.game.date, endDate: futureOne.game.date, note: 'School event' } });
check('referee marks a date unavailable', un.status === 201);
const c2 = (await call('GET', `/referees/assignments/${futureOne.id}/candidates`, { token: assignor })).data.candidates.find((c) => c.id === meB.id);
check('assignor sees the unavailable date', c2.blocking.some((b) => b.startsWith('Marked unavailable')));

console.log('\nSchedule changes and referees');
const covered = after.find((g) => g.assignments.every((a) => a.refereeId) && g.date > '2026-12-01');
const mopts = (await call('GET', `/schedule/games/${covered.id}/options`, { token: admin })).data.options;
const mv2 = await call('PUT', `/schedule/games/${covered.id}`, { token: admin, body: { courtId: mopts[0].courtId, date: mopts[0].date, startTime: mopts[0].startTime, endTime: mopts[0].endTime } });
check('moving a game reports referees kept or removed', mv2.status === 200 && mv2.data.referees && mv2.data.referees.kept + mv2.data.referees.removed === 2);
const cx = await call('PUT', `/schedule/games/${covered.id}`, { token: admin, body: { action: 'cancel', reason: 'Testing that cancelling releases referees.' } });
const afterCancel = (await call('GET', '/referees/me/assignments', { token: refB })).data.assignments.concat((await call('GET', '/referees/me/assignments', { token: refA })).data.assignments);
check('cancelling a game releases its referees', cx.status === 200 && !afterCancel.some((a) => a.game.id === covered.id));
await call('PUT', `/schedule/games/${covered.id}`, { token: admin, body: { action: 'restore' } });
const restored = (await call('GET', `/referees/games?from=${mv2.data.game.date}&to=${mv2.data.game.date}`, { token: assignor })).data.games.find((g) => g.id === covered.id);
check('restored game has open referee slots again', restored && restored.assignments.length === 2 && restored.assignments.every((a) => !a.refereeId));

console.log('\nCheck-in and payouts (a game today)');
const leagueTz = (await call('GET', '/settings/branding')).data.timezone;
const tz = new Intl.DateTimeFormat('en-CA', { timeZone: leagueTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .formatToParts(new Date()).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
const todayLocal = `${tz.year}-${tz.month}-${tz.day}`;
const nowMin = Number(tz.hour) * 60 + Number(tz.minute);
const startMin = Math.min(Math.max(nowMin - 30, 0), 22 * 60 + 55) - (Math.min(Math.max(nowMin - 30, 0), 22 * 60 + 55) % 5);
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const season = (await call('GET', '/league/seasons', { token: admin })).data.seasons.find((x) => x.isActive);
check('season can start today for this test', (await call('PUT', `/league/seasons/${season.id}`, { token: admin, body: { startDate: todayLocal } })).status === 200);
const nfhVenues = (await call('GET', `/venues?programId=${nfh.id}`, { token: pd })).data.venues;
const todayCourt = nfhVenues[0].courts[0];
const todaySlot = await call('POST', '/slots', { token: pd, body: { courtId: todayCourt.id, date: todayLocal, startTime: hhmm(startMin), endTime: hhmm(startMin + 60), category: 'WEEKNIGHT_GAME' } });
check('director adds a game slot today', todaySlot.status === 201, JSON.stringify(todaySlot.data).slice(0, 160));
const nfhGame = (await call('GET', `/schedule/games?programId=${nfh.id}`, { token: admin })).data.games.find((g) => g.status === 'scheduled' && !g.hasOpenRequest && g.date > todayLocal);
const toToday = await call('PUT', `/schedule/games/${nfhGame.id}`, { token: admin, body: { courtId: todayCourt.id, date: todayLocal, startTime: hhmm(startMin), endTime: hhmm(startMin + 60) } });
check('admin moves a game to today', toToday.status === 200, JSON.stringify(toToday.data).slice(0, 200));
const tg = (await call('GET', `/referees/games?from=${todayLocal}&to=${todayLocal}`, { token: assignor })).data.games.find((g) => g.id === nfhGame.id);
for (const [i, who] of [[0, meA.id], [1, meB.id]]) {
  if (tg.assignments[i].refereeId !== who) await call('PUT', `/referees/assignments/${tg.assignments[i].id}`, { token: assignor, body: { refereeId: null } });
}
const ra = await call('PUT', `/referees/assignments/${tg.assignments[0].id}`, { token: assignor, body: { refereeId: meA.id } });
const rb = await call('PUT', `/referees/assignments/${tg.assignments[1].id}`, { token: assignor, body: { refereeId: meB.id } });
check('both referees assigned to today’s game', ra.status === 200 && rb.status === 200, JSON.stringify(ra.data).slice(0, 160));
const myToday = (await call('GET', '/referees/me/assignments', { token: refA })).data.assignments.find((m) => m.game.id === nfhGame.id);
check('check-in is open around tip-off', myToday?.canCheckIn === true, myToday?.checkInNote || '');
const ci = await call('POST', `/referees/me/assignments/${myToday.id}/check-in`, { token: refA, body: { latitude: 42.1, longitude: -87.78 } });
check('referee checks in with location', ci.status === 200 && ci.data.distanceMiles != null && ci.data.distanceMiles < 1);
check('referee cannot decline on game day', (await call('POST', `/referees/me/assignments/${myToday.id}/decline`, { token: refA, body: { reason: 'Late' } })).status === 409);
const ns = await call('PUT', `/referees/assignments/${tg.assignments[1].id}/status`, { token: assignor, body: { status: 'no_show' } });
check('assignor marks a no-show', ns.data.game?.assignments[1].status === 'no_show');
check('attendance cannot be confirmed for future games', (await call('PUT', `/referees/assignments/${after.find((g) => g.date > todayLocal && g.assignments[0].refereeId).assignments[0].id}/status`, { token: assignor, body: { status: 'checked_in' } })).status === 400);
const pay = (await call('GET', `/referees/payouts?from=${todayLocal}&to=${todayLocal}`, { token: assignor })).data;
const rateA = roster.referees.find((r) => r.id === meA.id).payRateCents ?? roster.settings.defaultPayCents;
check('payout counts the checked-in game only', pay.totals.games === 1 && pay.summary[0].refereeId === meA.id && pay.totals.totalCents === rateA);
check('rate change does not rewrite what is owed', (await call('PUT', '/referees/settings', { token: assignor, body: { ...roster.settings, defaultPayCents: 9900 } })).status === 200
  && (await call('GET', `/referees/payouts?from=${todayLocal}&to=${todayLocal}`, { token: assignor })).data.totals.totalCents === rateA);
const csvRes = await fetch(`${API}/referees/payouts?from=${todayLocal}&to=${todayLocal}&format=csv&type=detail`, { headers: { Authorization: `Bearer ${assignor}` } });
const csvText = await csvRes.text();
check('payout CSV downloads', csvRes.headers.get('content-type')?.includes('text/csv') && csvText.includes('Owen Brooks') && csvText.includes('Referee check-in'));
check('referees cannot export payouts', (await call('GET', `/referees/payouts?from=${todayLocal}&to=${todayLocal}`, { token: refA })).status === 403);
check('coaches cannot export payouts', (await call('GET', `/referees/payouts?from=${todayLocal}&to=${todayLocal}`, { token: coach })).status === 403);
// Program Directors see payouts for their own program's games only.
const pdPay = (await call('GET', `/referees/payouts?from=${todayLocal}&to=${todayLocal}`, { token: pd })).data;
check('a director can see payouts for their program', pdPay.scope === 'program' && pdPay.totals.games === 1);
const otherPd = (await call('GET', `/referees/payouts?from=${todayLocal}&to=${todayLocal}`, { token: mbell })).data;
const nfhInvolved = [pdPay.detail[0]?.homeProgramName, pdPay.detail[0]?.awayProgramName].includes('Riverbend Youth Basketball');
check('another program’s director sees only their own games', nfhInvolved ? otherPd.totals.games === 1 : otherPd.totals.games === 0);
check('the league still sees every program’s games', (await call('GET', `/referees/payouts?from=${todayLocal}&to=${todayLocal}`, { token: admin })).data.scope === 'league');
const detailCsv = await (await fetch(`${API}/referees/payouts?from=${todayLocal}&to=${todayLocal}&format=csv&type=detail`, { headers: { Authorization: `Bearer ${pd}` } })).text();
const header = detailCsv.split('\r\n')[0].replace('\uFEFF', '');
check('the export has just the agreed columns', header === 'Referee,Email,Date,Home team,Away team,Checked in (Pacific Time),Confirmed by,Amount ($)', header);
const row = detailCsv.split('\r\n')[1];
check('an exported row carries that game’s details', /Owen Brooks/.test(row) && /\d{4}-\d{2}-\d{2}/.test(row) && /Referee check-in|Assignor/.test(row));
check('check-in times are exported in league time, not UTC', /\d{4}-\d{2}-\d{2} \d{1,2}:\d{2} (AM|PM)/.test(row), row);
{
  const { leagueTimestamp } = await import('../utils/leagueTime.js');
  // 6:00 PM Pacific on game night is already the next day in UTC.
  check('a game-night check-in keeps the game’s date', leagueTimestamp('2026-11-06 02:00:00') === '2026-11-05 6:00 PM');
  check('daylight saving is applied', leagueTimestamp('2026-07-01 06:30:00') === '2026-06-30 11:30 PM');
}


console.log('\nFinal scores');
const played = (await call('GET', `/schedule/games/${nfhGame.id}`, { token: pd })).data.game; // today, tip-off 30 min ago
const otherProg = played.homeProgramId === nfh.id ? played.awayProgramId : played.homeProgramId;
check('a played game can be scored by its director', played.canScore === true);
check('the dashboard counts games waiting for a score', (await call('GET', '/dashboard', { token: pd })).data.schedule.scoresNeeded >= 1);
const futureNfh = (await call('GET', `/schedule/games?programId=${nfh.id}`, { token: pd })).data.games.find((g) => g.date > todayLocal && g.status === 'scheduled');
check('future games can’t be scored', (await call('PUT', `/schedule/games/${futureNfh.id}/score`, { token: pd, body: { homeScore: 10, awayScore: 8 } })).status === 409);
check('referees can’t enter scores', (await call('PUT', `/schedule/games/${played.id}/score`, { token: refA, body: { homeScore: 10, awayScore: 8 } })).status === 403);
if (otherProg !== ryb.id && played.homeProgramId !== ryb.id) {
  check('a director whose program isn’t playing can’t enter it', (await call('PUT', `/schedule/games/${played.id}/score`, { token: mbell, body: { homeScore: 10, awayScore: 8 } })).status === 403);
}
for (const [label, body] of [['negative', { homeScore: -1, awayScore: 8 }], ['not a number', { homeScore: 'ten', awayScore: 8 }], ['over 250', { homeScore: 300, awayScore: 8 }], ['missing', { homeScore: 10 }]]) {
  check(`invalid score rejected (${label})`, (await call('PUT', `/schedule/games/${played.id}/score`, { token: pd, body })).status === 400);
}
const sc1 = await call('PUT', `/schedule/games/${played.id}/score`, { token: pd, body: { homeScore: 42, awayScore: 38 } });
check('director enters the final score', sc1.status === 200 && sc1.data.game.homeScore === 42 && sc1.data.game.awayScore === 38 && sc1.data.game.scoreEnteredByName === 'Dana Whitfield');
check('the score shows on the schedule', (await call('GET', `/schedule/games?programId=${nfh.id}`, { token: coach })).data.games.find((g) => g.id === played.id)?.hasScore === true);
const otherSees = (await call('GET', `/activity?category=schedule&programId=${otherProg}`, { token: admin })).data.entries;
check('the other program sees the score in Activity', otherSees.some((e) => e.details.startsWith('Final score:') && e.details.includes('42 – 38')));
const sc2 = await call('PUT', `/schedule/games/${played.id}/score`, { token: admin, body: { homeScore: 44, awayScore: 38, note: 'Overtime' } });
check('the league can correct a score', sc2.data.game?.homeScore === 44 && sc2.data.game.scoreNote === 'Overtime');
check('corrections are logged with the old score', (await call('GET', '/activity?category=schedule', { token: pd })).data.entries.some((e) => e.details.includes('Corrected the final score') && e.details.includes('(was 42 – 38)')));
check('a scored game can’t be cancelled', (await call('PUT', `/schedule/games/${played.id}`, { token: admin, body: { action: 'cancel', reason: 'Trying to cancel a played game.' } })).status === 409);
const mvScored = (await call('GET', `/schedule/games/${played.id}/options`, { token: admin })).data.options[0];
check('a scored game can’t be moved', !mvScored || (await call('PUT', `/schedule/games/${played.id}`, { token: admin, body: { courtId: mvScored.courtId, date: mvScored.date, startTime: mvScored.startTime, endTime: mvScored.endTime } })).status === 409);
const fl1 = await call('PUT', `/schedule/games/${played.id}`, { token: admin, body: { action: 'flip' } });
check('swapping home and away swaps the scores', fl1.data.game?.homeScore === 38 && fl1.data.game.awayScore === 44);
await call('PUT', `/schedule/games/${played.id}`, { token: admin, body: { action: 'flip' } });
check('a scored game isn’t offered for change requests', (await call('GET', `/schedule/games/${played.id}`, { token: pd })).data.game.canRequest === false
  && (await call('POST', '/requests', { token: pd, body: { gameId: played.id, type: 'reschedule', reason: 'Testing scored game', courtId: 'x', date: '2026-12-01', startTime: '10:00', endTime: '11:00' } })).status === 400);
const cl = await call('DELETE', `/schedule/games/${played.id}/score`, { token: pd });
check('a score can be cleared', cl.status === 200 && cl.data.game.hasScore === false);

console.log('\nRepublishing keeps referees on unchanged games');
const regen = await call('POST', '/schedule/generate', { token: admin, body: {} });
// A score on a game that's unchanged in the new draft must follow it when republishing.
const gameKey = (g) => `${[g.homeTeamId, g.awayTeamId].sort().join()}|${g.date}|${g.startTime}|${g.courtId}`;
const draftKeys = new Set((await call('GET', `/schedule/runs/${regen.data.draft.id}/games`, { token: admin })).data.games.map(gameKey));
const keep = (await call('GET', `/schedule/games?programId=${nfh.id}`, { token: admin })).data.games.find((g) => g.status === 'scheduled' && draftKeys.has(gameKey(g)));
await (await import('../db/client.js')).run('UPDATE games SET home_score = 51, away_score = 49 WHERE id = ?', [keep.id]);
const needs = await call('POST', `/schedule/runs/${regen.data.draft.id}/publish`, { token: admin, body: {} });
check('republish warns about referee assignments', needs.data.code === 'REPLACE_REQUIRED' && needs.data.assignedAhead > 0);
const rep = await call('POST', `/schedule/runs/${regen.data.draft.id}/publish`, { token: admin, body: { replace: true } });
check('unchanged games keep their referees', rep.status === 200 && rep.data.referees.carried > 0, JSON.stringify(rep.data.referees));
check('worked games still count for pay after republishing', (await call('GET', `/referees/payouts?from=${todayLocal}&to=${todayLocal}`, { token: assignor })).data.totals.games === 1);
const newGames = (await call('GET', `/schedule/games?programId=${nfh.id}`, { token: admin })).data.games;
const kept = newGames.find((g) => [g.homeTeamId, g.awayTeamId].sort().join() === [keep.homeTeamId, keep.awayTeamId].sort().join() && g.date === keep.date && g.startTime === keep.startTime);
check('final scores carry over to unchanged games when republishing', !!kept && kept.hasScore && (kept.homeTeamId === keep.homeTeamId ? kept.homeScore === 51 : kept.awayScore === 51));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
