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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
