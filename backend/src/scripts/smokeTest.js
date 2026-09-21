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

console.log('\nAdmin');
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

console.log('\nData integrity with a live schedule');
const liveNfh = (await call('GET', `/schedule/games?programId=${nfh.id}`, { token: admin })).data.games.find((g) => g.venueProgramId === nfh.id && g.status === 'scheduled');
check('gym slot holding a published game cannot be deleted', (await call('DELETE', `/slots/${liveNfh.gymSlotId}`, { token: pd })).status === 409);
const bo2 = await call('POST', '/blackouts', { token: pd, body: { startDate: liveNfh.date, endDate: liveNfh.date, reason: 'Gym floor refinishing' } });
check('new blackout reports affected games', bo2.status === 201 && bo2.data.affectedGames >= 1);
check('affected game is flagged', (await call('GET', `/schedule/games/${liveNfh.id}`, { token: pd })).data.game.hasBlackoutConflict === true);
await call('DELETE', `/blackouts/${bo2.data.blackout.id}`, { token: pd });
check('team with games cannot be deleted', (await call('DELETE', `/teams/${liveNfh.homeTeamId}`, { token: pd })).status === 409);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
