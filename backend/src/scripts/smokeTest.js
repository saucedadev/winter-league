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
const mbell = await login('mbell');       // Riverbend (RYB) director
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

console.log('\nBranded emails');
{
  check('browsers never get the email copy of the logo', !('emailLogo' in pubBrand.data.branding) && pubBrand.data.branding.hasEmailLogo === false);
  const withCopy = await call('PUT', '/settings/branding', { token: admin, body: { appName: 'Pacific Youth Conference', logo: tinyPng } });
  check('the server makes the email copy when the logo is saved', withCopy.status === 200 && withCopy.data.branding.hasEmailLogo === true && !('emailLogo' in withCopy.data.branding));
  const svgLogo = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20"><rect width="60" height="20" fill="#E07A1F"/></svg>').toString('base64')}`;
  const svgSaved = await call('PUT', '/settings/branding', { token: admin, body: { appName: 'Pacific Youth Conference', logo: svgLogo } });
  check('an SVG logo gets a PNG copy for emails', svgSaved.status === 200 && svgSaved.data.branding.hasEmailLogo === true);
  const svgPrev = (await call('POST', '/settings/email-preview', { token: admin, body: { appName: 'Coastal League', logo: svgLogo } })).data.html || '';
  check('the email shows the SVG logo as a PNG', svgPrev.includes('data:image/png;base64,') && !svgPrev.includes('svg+xml'));
  const noLogo = await call('PUT', '/settings/branding', { token: admin, body: { appName: 'Pacific Youth Conference', logo: null } });
  check('no logo, no email copy', noLogo.data.branding.hasEmailLogo === false);
  check('only System Admins preview emails', (await call('POST', '/settings/email-preview', { token: pd, body: { appName: 'X' } })).status === 403);
  const prev = await call('POST', '/settings/email-preview', { token: admin, body: { appName: 'Coastal <League>', logo: tinyPng } });
  const h = prev.data.html || '';
  check('preview uses the unsaved name (escaped)', prev.status === 200 && h.includes('Coastal &lt;League&gt;') && !h.includes('<League>'));
  check('preview shows the logo inline', /data:image\/png;base64,[A-Za-z0-9+/=]{20,}/.test(h) && !h.includes('cid:'));
  check('preview says the inbox isn’t monitored', h.includes('this inbox is not monitored'));
  check('preview uses the theme color', h.includes('#2F6A87'));
  check('without a logo the built-in mark is used', ((await call('POST', '/settings/email-preview', { token: admin, body: { appName: 'Coastal League' } })).data.html || '').includes('data:image/png;base64,iVBOR'));
  const test = await call('POST', '/settings/email-test', { token: admin });
  check('test email goes to the admin (console mode here)', test.status === 200 && !!test.data.sentTo && ['console', 'brevo'].includes(test.data.provider));
  check('only System Admins send test emails', (await call('POST', '/settings/email-test', { token: pd })).status === 403);
  check('test email says how the logo reaches inboxes', ['built-in', 'vercel-blob', 'api', 'none', 'other'].includes(test.data.logo?.kind));
  check('the email logo address only serves the current logo', (await fetch(`${API}/settings/email-logo/0123456789abcdef.png`)).status === 404);
  await call('PUT', '/settings/branding', { token: admin, body: { appName: 'Winter League', logo: null } });
}
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
// The System Admin can set the temporary password instead of generating one.
check('a weak temporary password is refused', (await call('POST', '/users', { token: admin, body: { firstName: 'Set', lastName: 'Password', email: 'setpw@example.com', role: 'league_coach', programId: nfh.id, temporaryPassword: 'short1' } })).status === 400);
const setPw = await call('POST', '/users', { token: admin, body: { firstName: 'Set', lastName: 'Password', email: 'setpw@example.com', role: 'league_coach', programId: nfh.id, temporaryPassword: 'Hoops-2026-Tipoff' } });
check('an account can be created with a temporary password the admin sets', setPw.status === 201 && setPw.data.temporaryPassword === 'Hoops-2026-Tipoff');
const setLogin = await call('POST', '/auth/login', { body: { username: setPw.data.user.username, password: 'Hoops-2026-Tipoff' } });
check('they sign in with it and must choose their own password', setLogin.status === 200 && setLogin.data.user.mustChangePassword === true);
check('a weak password is refused when issuing one too', (await call('POST', `/users/${setPw.data.user.id}/reset-password`, { token: admin, body: { temporaryPassword: 'abcdefghij' } })).status === 400);
const reissue = await call('POST', `/users/${setPw.data.user.id}/reset-password`, { token: admin, body: { temporaryPassword: 'Rebound-7788-Court' } });
check('the admin can issue a temporary password they set', reissue.status === 200 && reissue.data.temporaryPassword === 'Rebound-7788-Court'
  && (await call('POST', '/auth/login', { body: { username: setPw.data.user.username, password: 'Rebound-7788-Court' } })).status === 200
  && (await call('POST', '/auth/login', { body: { username: setPw.data.user.username, password: 'Hoops-2026-Tipoff' } })).status === 401);
const regenPw = await call('POST', `/users/${setPw.data.user.id}/reset-password`, { token: admin, body: {} });
check('leaving it blank still generates one', regenPw.status === 200 && /^[A-Z][a-z]+-\d{4}-[A-Z][a-z]+$/.test(regenPw.data.temporaryPassword));
check('the password itself is never written to Activity', !JSON.stringify((await call('GET', '/activity?category=user', { token: admin })).data).includes('Rebound-7788-Court')
  && (await call('GET', '/activity?category=user', { token: admin })).data.entries.some((e) => e.details.includes('(set by the admin)')));
const me = (await call('GET', '/auth/me', { token: admin })).data.user;

// ---- Usernames: live suggestion, and editable on purpose ----
check('the username suggestion matches what the app generates', (await call('GET', '/users/username-suggestion?firstName=Jamie&lastName=O%27Neil', { token: admin })).data.username === 'joneil');
check('the username check flags a taken name', (await call('GET', '/users/username-check?username=gkim', { token: admin })).data.ok === false);
check('the username check accepts a free one', (await call('GET', '/users/username-check?username=Jamie.ONeil', { token: admin })).data.username === 'jamie.oneil');
check('a badly formed username is refused', (await call('POST', '/users', { token: admin, body: { firstName: 'Jamie', lastName: 'ONeil', email: 'jo@example.com', role: 'referee', username: 'j!' } })).status === 400);
check('a taken username is refused', (await call('POST', '/users', { token: admin, body: { firstName: 'Jamie', lastName: 'ONeil', email: 'jo@example.com', role: 'referee', username: 'GKIM' } })).status === 409);
const typedUser = await call('POST', '/users', { token: admin, body: { firstName: 'Jamie', lastName: 'ONeil', email: 'jo@example.com', role: 'referee', username: 'Jamie.ONeil' } });
check('the admin can set the username when creating an account', typedUser.status === 201 && typedUser.data.user.username === 'jamie.oneil');
check('only the System Admin can change usernames', (await call('PUT', `/users/${typedUser.data.user.id}`, { token: pd, body: { username: 'jo2' } })).status === 403);
check('changing to a taken username is refused', (await call('PUT', `/users/${typedUser.data.user.id}`, { token: admin, body: { username: 'dwhitfield' } })).status === 409);
const renamed = await call('PUT', `/users/${typedUser.data.user.id}`, { token: admin, body: { username: 'joneil' } });
check('the admin can fix a username', renamed.status === 200 && renamed.data.user.username === 'joneil');
check('they sign in with the new username, not the old one', (await call('POST', '/auth/login', { body: { username: 'joneil', password: typedUser.data.temporaryPassword } })).status === 200
  && (await call('POST', '/auth/login', { body: { username: 'jamie.oneil', password: typedUser.data.temporaryPassword } })).status === 401);
check('the change is in Activity', (await call('GET', '/activity?category=user', { token: admin })).data.entries.some((e) => e.details === 'Changed the username jamie.oneil to joneil'));
check('saving without a username keeps it', (await call('PUT', `/users/${typedUser.data.user.id}`, { token: admin, body: { phone: '5035550100' } })).data.user.username === 'joneil');

// ---- Directory: a program's contact list (not app accounts) ----
check('coaches can’t use the directory', (await call('GET', '/directory', { token: coach })).status === 403);
check('first and last name are required', (await call('POST', '/directory', { token: pd, body: { firstName: 'Kim' } })).status === 400);
check('a bad email is refused', (await call('POST', '/directory', { token: pd, body: { firstName: 'Kim', lastName: 'Lee', email: 'nope' } })).status === 400);
check('a typed-in role needs a name', (await call('POST', '/directory', { token: pd, body: { firstName: 'Kim', lastName: 'Lee', role: 'other' } })).status === 400);
const dCoach = await call('POST', '/directory', { token: pd, body: { firstName: 'Morgan', lastName: 'Diaz', email: 'mdiaz@example.com', phone: '(503) 555-0142', role: 'coach' } });
check('a director adds a coach to the directory', dCoach.status === 201 && dCoach.data.contact.roleLabel === 'Coach' && dCoach.data.contact.programId === nfh.id && dCoach.data.contact.phone === '5035550142');
const dOther = await call('POST', '/directory', { token: pd, body: { firstName: 'Pat', lastName: 'Quinn', role: 'other', roleOther: 'Team manager' } });
check('a director adds someone with a typed-in role', dOther.data.contact?.roleLabel === 'Team manager');
check('typing “Referee” as the role uses the built-in one', (await call('POST', '/directory', { token: pd, body: { firstName: 'Lee', lastName: 'Park', role: 'other', roleOther: 'referee' } })).data.contact?.role === 'referee');
check('email and phone are optional', (await call('POST', '/directory', { token: pd, body: { firstName: 'Sam', lastName: 'Ruiz' } })).status === 201);
check('a director sees only their own program’s directory', (await call('GET', '/directory', { token: mbell })).data.contacts.every((c) => c.programId === ryb.id)
  && (await call('GET', '/directory', { token: pd })).data.contacts.length === 4);
check('another program’s director can’t edit it', (await call('PUT', `/directory/${dCoach.data.contact.id}`, { token: mbell, body: { firstName: 'X' } })).status === 403);
check('the System Admin sees every program’s directory', (await call('GET', '/directory', { token: admin })).data.contacts.some((c) => c.id === dCoach.data.contact.id));
check('the System Admin must say which program', (await call('POST', '/directory', { token: admin, body: { firstName: 'A', lastName: 'B' } })).status === 400);
check('adding a contact doesn’t create an account', !(await call('GET', '/users', { token: admin })).data.users.some((u) => u.lastName === 'Diaz'));
// A Directory coach as a team's head coach, until a Coach account replaces them.
const nfhTeams = (await call('GET', '/teams', { token: pd })).data.teams;
const dTeam = nfhTeams.find((t) => !t.headCoachUserId) || nfhTeams[0];
const dTeamCoachBefore = dTeam.headCoachUserId || null;
const setDc = await call('PUT', `/teams/${dTeam.id}`, { token: pd, body: { headCoachUserId: null, headCoachContactId: dCoach.data.contact.id } });
check('a Directory coach can be a team’s head coach', setDc.status === 200 && setDc.data.team.headCoachName === 'Morgan Diaz' && !!setDc.data.team.headCoachIsContact);
check('the teams list marks them as from the Directory', (await call('GET', '/teams', { token: pd })).data.teams.find((t) => t.id === dTeam.id).headCoachIsContact === true);
check('only Directory contacts with the Coach role can coach', (await call('PUT', `/teams/${dTeam.id}`, { token: pd, body: { headCoachUserId: null, headCoachContactId: dOther.data.contact.id } })).status === 400);
check('a team can’t have both kinds of coach', (await call('PUT', `/teams/${dTeam.id}`, { token: pd, body: { headCoachUserId: (await call('GET', '/auth/me', { token: coach })).data.user.id, headCoachContactId: dCoach.data.contact.id } })).status === 400);
check('their role can’t be changed while they coach a team', (await call('PUT', `/directory/${dCoach.data.contact.id}`, { token: pd, body: { role: 'referee' } })).status === 409);
check('the coach picker offers Directory coaches', (await call('GET', `/teams/coaches?programId=${nfh.id}`, { token: pd })).data.contacts.some((c) => c.id === dCoach.data.contact.id));
// The league admin creates their real account; the director switches the team over.
const realCoach = await call('POST', '/users', { token: admin, body: { firstName: 'Morgan', lastName: 'Diaz', email: 'mdiaz@example.com', role: 'league_coach', programId: nfh.id } });
const withMatch = (await call('GET', '/directory', { token: pd })).data.contacts.find((c) => c.id === dCoach.data.contact.id);
check('the directory spots that they now have a Coach account', withMatch.matchingUserId === realCoach.data.user.id);
const switched = await call('POST', `/directory/${dCoach.data.contact.id}/switch-to-account`, { token: pd, body: { userId: realCoach.data.user.id } });
const afterSwitch = (await call('GET', '/teams', { token: pd })).data.teams.find((t) => t.id === dTeam.id);
check('switching moves their teams to the real account', switched.data.teamsUpdated === 1 && afterSwitch.headCoachUserId === realCoach.data.user.id && !afterSwitch.headCoachContactId);
await call('PUT', `/teams/${dTeam.id}`, { token: pd, body: { headCoachUserId: null, headCoachContactId: dCoach.data.contact.id } });
const delDc = await call('DELETE', `/directory/${dCoach.data.contact.id}`, { token: pd });
check('removing a contact who coaches a team leaves it without a coach', delDc.data.teamsCleared === 1 && !(await call('GET', '/teams', { token: pd })).data.teams.find((t) => t.id === dTeam.id).headCoachName);
await call('PUT', `/teams/${dTeam.id}`, { token: pd, body: { headCoachUserId: dTeamCoachBefore, headCoachContactId: null } }); // put things back for later checks
await call('PUT', `/users/${realCoach.data.user.id}`, { token: admin, body: { isActive: false } });
check('admin cannot demote self', (await call('PUT', `/users/${me.id}`, { token: admin, body: { role: 'referee' } })).status === 400);
check('16-program cap is enforced setting', (await call('GET', '/programs', { token: admin })).data.maxPrograms === 16);

// =====================================================================
// Phase 2 — scheduling (Module B) and change requests (Module D)
// =====================================================================
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
  const mostIn = (divId, not = false) => Math.max(0, ...games.filter((g) => (g.divisionId === divId) !== not).map((g) => meets[[g.homeTeamId, g.awayTeamId].sort().join('|')]));
  return { status: r.status, error: r.data?.error, draft: r.data.draft, games, most: Math.max(...Object.values(meets)), mostIn, same: games.filter((g) => teamProgAll[g.homeTeamId] === teamProgAll[g.awayTeamId]).length };
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

console.log('\nDivision overrides');
check('no division overrides by default', Object.keys(defaultRules.divisionOverrides || {}).length === 0);
const ovBad = await call('PUT', '/schedule/rules', { token: admin, body: { divisionOverrides: { [g6.id]: { maxVsSameOpponent: 9 } } } });
check('override above 6 is rejected, naming the division', ovBad.status === 400 && ovBad.data.error.includes('6th Grade Girls'), ovBad.data.error);
check('override for a division that doesn’t exist is rejected', (await call('PUT', '/schedule/rules', { token: admin, body: { divisionOverrides: { nope: { maxVsSameOpponent: 3 } } } })).status === 400);
check('only the rematch limit can be overridden (for now)', (await call('PUT', '/schedule/rules', { token: admin, body: { divisionOverrides: { [g6.id]: { gamesPerTeam: 4 } } } })).status === 400);
const ovOverview = (await call('GET', '/schedule/overview', { token: admin })).data;
check('builder overview lists divisions to override', ovOverview.divisions?.some((d) => d.id === g6.id && d.name === '6th Grade Girls'));
// League: no rematches. 6th Grade Girls: up to 3 meetings.
const dOv = await draftWith({ maxVsSameOpponent: 1, divisionOverrides: { [g6.id]: { maxVsSameOpponent: 3 } } });
check('draft with an override generates', dOv.status === 201, dOv.error);
check('the overridden division uses its own limit', dOv.mostIn(g6.id) > 1 && dOv.mostIn(g6.id) <= 3, `most in 6th Grade Girls: ${dOv.mostIn(g6.id)}`);
check('every other division keeps the league limit', dOv.mostIn(g6.id, true) === 1, `most elsewhere: ${dOv.mostIn(g6.id, true)}`);
check('the override still keeps same-program teams apart', dOv.same === 0);
check('the draft records the override it was built with', dOv.draft.rules.divisionOverrides?.[g6.id]?.maxVsSameOpponent === 3 && dOv.draft.rules.maxVsSameOpponent === 1);
const savedOv = (await call('GET', '/schedule/rules', { token: admin })).data.rules;
check('overrides are saved with the league rules', savedOv.divisionOverrides?.[g6.id]?.maxVsSameOpponent === 3);
const dOvNone = await draftWith({ maxVsSameOpponent: 1, divisionOverrides: { [g6.id]: { maxVsSameOpponent: null } } });
check('an override can be “No limit”', dOvNone.draft.rules.divisionOverrides?.[g6.id]?.maxVsSameOpponent === null && dOvNone.mostIn(g6.id) > 1 && dOvNone.mostIn(g6.id, true) === 1);
const dOvTight = await draftWith({ maxVsSameOpponent: 2, divisionOverrides: { [g6.id]: { maxVsSameOpponent: 1 } } });
check('a note names the override when it leaves teams short', dOvTight.draft.warnings.some((w) => w.includes('6th Grade Girls division override') || w.includes('6th Grade Girls (') && /6th Grade Girls \([^)]*division override: 1 game against each/.test(w)), dOvTight.draft.warnings.join(' | ').slice(0, 300));
check('removing the override returns the division to the league value', (await draftWith({ maxVsSameOpponent: 1, divisionOverrides: {} })).mostIn(g6.id) === 1);
const log = (await call('GET', '/activity?category=schedule', { token: admin })).data;
check('the activity log names division overrides', JSON.stringify(log).includes('division overrides'), JSON.stringify(log).slice(0, 200));
await call('PUT', '/schedule/rules', { token: admin, body: { ...defaultRules } });
check('overrides cleared when the rules are reset', Object.keys((await call('GET', '/schedule/rules', { token: admin })).data.rules.divisionOverrides).length === 0);

console.log('\nProgram travel overrides');
check('no program overrides by default', Object.keys(defaultRules.programOverrides || {}).length === 0);
const poHigh = await call('PUT', '/schedule/rules', { token: admin, body: { programOverrides: { [nfh.id]: { maxTravelMiles: 45 } } } });
check('a program can’t set a higher cap than the league’s', poHigh.status === 400 && poHigh.data.error.includes(nfh.name), poHigh.data.error);
check('an override for an unknown program is rejected', (await call('PUT', '/schedule/rules', { token: admin, body: { programOverrides: { nope: { maxTravelMiles: 10 } } } })).status === 400);
check('only the travel cap can be set per program', (await call('PUT', '/schedule/rules', { token: admin, body: { programOverrides: { [nfh.id]: { gamesPerTeam: 4 } } } })).status === 400);
check('lowering the league cap below a program’s cap is caught', (await call('PUT', '/schedule/rules', { token: admin, body: { maxTravelMiles: 5, programOverrides: { [nfh.id]: { maxTravelMiles: 10 } } } })).status === 400);
check('builder overview lists league programs for overrides', (await call('GET', '/schedule/overview', { token: admin })).data.programs?.some((p) => p.id === nfh.id));
// Northfield's teams may travel at most 1 mile, so they never travel.
const dTravel = await draftWith({ programOverrides: { [nfh.id]: { maxTravelMiles: 1 } } });
check('draft with a program travel cap generates', dTravel.status === 201, dTravel.error);
const nfhPlaced = dTravel.games.filter((g) => g.status === 'scheduled' && [teamProgAll[g.homeTeamId], teamProgAll[g.awayTeamId]].includes(nfh.id));
check('the program’s teams never travel beyond their own cap', nfhPlaced.length > 0 && nfhPlaced.every((g) => teamProgAll[g.awayTeamId] !== nfh.id || g.travelMiles == null || g.travelMiles <= 1));
check('other programs still travel to it (at least one side can travel)', nfhPlaced.some((g) => teamProgAll[g.homeTeamId] === nfh.id && g.travelMiles > 1));
check('the draft records the program override', dTravel.draft.rules.programOverrides?.[nfh.id]?.maxTravelMiles === 1);
const nfhCounts = {};
for (const g of nfhPlaced) for (const t of [g.homeTeamId, g.awayTeamId]) if (teamProgAll[t] === nfh.id) nfhCounts[t] = (nfhCounts[t] || 0) + 1;
// Northfield has enough gym time to host every game, so its cap costs nothing here...
check('every short team is explained in the notes', Object.entries(nfhCounts).filter(([, n]) => n < 8).every(([id]) => dTravel.draft.warnings.some((w) => w.includes(dTravel.games.find((g) => g.homeTeamId === id)?.homeTeamName || dTravel.games.find((g) => g.awayTeamId === id)?.awayTeamName))));
// ...so check the "leaves teams short" note with a small made-up league: Pine
// won't travel more than 5 miles and has one game slot, so its team can't get
// its games; the others are ~14–17 miles away.
{
  const { buildSchedule } = await import('../scheduling/matchmaker.js');
  const { normalizeRules } = await import('../scheduling/core.js');
  const mk = (id, programId) => ({ id, name: `${id} 5th Boys`, programId, divisionId: 'd5', divisionName: '5th Grade Boys' });
  const homes = { P: { lat: 45.0, lng: -122.9 }, Q: { lat: 45.2, lng: -122.9 }, R: { lat: 45.25, lng: -122.95 } };
  const win = (programId, date, i) => ({ slotId: `${programId}${date}${i}`, courtId: `${programId}-c`, courtName: 'Main', venueId: programId, venueName: `${programId} Gym`,
    programId, date, startTime: `${String(17 + i).padStart(2, '0')}:00`, endTime: `${String(18 + i).padStart(2, '0')}:00`, lat: homes[programId].lat, lng: homes[programId].lng });
  const dates = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07'];
  const windows = [win('P', dates[0], 0), ...['Q', 'R'].flatMap((q) => dates.flatMap((d) => [win(q, d, 0), win(q, d, 1)]))];
  const rules = normalizeRules({ gamesPerTeam: 4, programOverrides: { P: { maxTravelMiles: 5 } } });
  const out = buildSchedule({ teams: [mk('Pine', 'P'), mk('Quail', 'Q'), mk('Rose', 'R')], windows, homes, programBlackouts: new Set(), rules, programNames: { P: 'Pine', Q: 'Quail', R: 'Rose' } });
  const pineAway = out.games.filter((g) => g.window && g.awayTeamId === 'Pine');
  check('a capped program never travels past its own cap (made-up league)', pineAway.length === 0);
  check('a note names the program’s cap when it leaves teams short', out.warnings.some((w) => w.startsWith('Pine 5th Boys got') && w.includes('Pine’s own 5-mile travel cap') && w.includes('Quail')), out.warnings.join(' | '));
}
const travelGame = dTravel.games.find((g) => g.status === 'scheduled' && teamProgAll[g.homeTeamId] === nfh.id);
const travelGameOpts = (await call('GET', `/schedule/games/${travelGame.id}/options`, { token: admin })).data.options;
check('moving a game flags times where the program would travel past its own cap', travelGameOpts.filter((o) => o.programId !== nfh.id && o.travelMiles > 1).every((o) => o.overTravelCap && o.travelCap === 1));
// Both Northfield and Riverbend refuse to travel: they can't be paired at all.
const dBoth = await draftWith({ programOverrides: { [nfh.id]: { maxTravelMiles: 1 }, [ryb.id]: { maxTravelMiles: 1 } } });
check('two programs that both can’t travel are never paired', !dBoth.games.some((g) => [teamProgAll[g.homeTeamId], teamProgAll[g.awayTeamId]].sort().join() === [nfh.id, ryb.id].sort().join()));
check('the notes say why, naming both caps', dBoth.draft.warnings.some((w) => w.includes('weren’t paired') && w.includes('travel caps') && w.includes(`${nfh.name} 1`)), dBoth.draft.warnings.join(' | ').slice(0, 300));
check('the activity log names program overrides', (await call('GET', '/activity?category=schedule', { token: admin })).data.entries.some((e) => e.details.includes('program overrides')));
await call('PUT', '/schedule/rules', { token: admin, body: { ...defaultRules } });
check('program overrides cleared when the rules are reset', Object.keys((await call('GET', '/schedule/rules', { token: admin })).data.rules.programOverrides).length === 0);

console.log('\nDay preferences (tagged slots)');
{
  const seasonNow = (await call('GET', '/league/seasons', { token: admin })).data.seasons.find((x) => x.isActive);
  const nfhSlots = (await call('GET', `/slots?from=${seasonNow.startDate}&to=${seasonNow.endDate}`, { token: pd })).data.slots.filter((x) => x.category !== 'PRACTICE');
  const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const byDay = {};
  for (const x of nfhSlots) byDay[dow(x.date)] = (byDay[dow(x.date)] || 0) + 1;
  const tagDay = Number(Object.entries(byDay).sort((a, b) => b[1] - a[1])[0][0]);
  const divs = (await call('GET', '/league/divisions', { token: admin })).data.divisions;
  const girlsDiv = new Set(divs.filter((d) => d.gender === 'girls').map((d) => d.id));
  const practice = (await call('GET', `/slots?from=${seasonNow.startDate}&to=${seasonNow.endDate}`, { token: pd })).data.slots.find((x) => x.category === 'PRACTICE');
  if (practice) check('practice slots can’t be tagged', (await call('PUT', `/slots/${practice.id}`, { token: pd, body: { reservedFor: 'girls' } })).status === 400);
  check('a division tag needs the division', (await call('POST', '/slots/tag', { token: pd, body: { weekday: tagDay, reservedFor: 'division' } })).status === 400);
  check('the mode must be priority or only', (await call('POST', '/slots/tag', { token: pd, body: { weekday: tagDay, reservedFor: 'girls', reservedMode: 'always' } })).status === 400);
  const tagRes = await call('POST', '/slots/tag', { token: pd, body: { weekday: tagDay, reservedFor: 'girls' } });
  check('a director tags every game slot on one weekday as Girls priority', tagRes.status === 200 && tagRes.data.updated === byDay[tagDay], JSON.stringify(tagRes.data));
  const tagged = (await call('GET', `/slots?from=${seasonNow.startDate}&to=${seasonNow.endDate}`, { token: pd })).data.slots.find((x) => x.category !== 'PRACTICE' && dow(x.date) === tagDay);
  check('the slot shows its tag', tagged.reservedText === 'Girls priority' && tagged.reservedMode === 'prefer');
  const onTagDay = (d) => d.games.filter((g) => g.status === 'scheduled' && g.venueProgramId === nfh.id && dow(g.date) === tagDay);
  const girlsShare = (list) => list.filter((g) => girlsDiv.has(g.divisionId)).length;
  const base = await draftWith({});
  // Priority: girls' games take those slots first.
  const dPref = await draftWith({});
  check('with a priority tag, girls’ games take more of those slots', girlsShare(onTagDay(dPref)) > girlsShare(onTagDay(base)) || girlsShare(onTagDay(base)) === onTagDay(base).length,
    `before ${girlsShare(onTagDay(base))}/${onTagDay(base).length}, after ${girlsShare(onTagDay(dPref))}/${onTagDay(dPref).length}`);
  check('the notes report how the tagged slots were used', dPref.draft.warnings.some((w) => w.startsWith('Girls priority slots:')), dPref.draft.warnings.join(' | ').slice(0, 300));
  check('a priority tag never costs games', dPref.games.filter((g) => g.status === 'scheduled').length >= base.games.filter((g) => g.status === 'scheduled').length - 1);
  // Only: no other games there at all.
  await call('POST', '/slots/tag', { token: pd, body: { weekday: tagDay, reservedFor: 'girls', reservedMode: 'only' } });
  const dOnly = await draftWith({});
  check('with “only”, no other games use those slots', onTagDay(dOnly).every((g) => girlsDiv.has(g.divisionId)) && onTagDay(dOnly).length > 0, JSON.stringify(onTagDay(dOnly).map((g) => g.divisionName)));
  check('the notes report the Girls-only slots', dOnly.draft.warnings.some((w) => w.startsWith('Girls-only slots:')));
  const boysGame = dOnly.games.find((g) => g.status === 'scheduled' && !girlsDiv.has(g.divisionId) && [g.homeProgramId, g.awayProgramId].includes(nfh.id));
  const boysOpts = (await call('GET', `/schedule/games/${boysGame.id}/options`, { token: admin })).data.options;
  check('moving a boys’ game never offers a Girls-only slot', !boysOpts.some((o) => o.programId === nfh.id && dow(o.date) === tagDay));
  const girlsOnlySlot = (await call('GET', `/slots?from=${seasonNow.startDate}&to=${seasonNow.endDate}`, { token: pd })).data.slots.find((x) => x.category !== 'PRACTICE' && dow(x.date) === tagDay && !x.isBlackedOut);
  const forced = await call('PUT', `/schedule/games/${boysGame.id}`, { token: admin, body: { courtId: girlsOnlySlot.courtId, date: girlsOnlySlot.date, startTime: girlsOnlySlot.startTime,
    endTime: `${String(Number(girlsOnlySlot.startTime.slice(0, 2)) + 1).padStart(2, '0')}${girlsOnlySlot.startTime.slice(2)}` } });
  check('placing a boys’ game in a Girls-only slot is refused', forced.status === 409 && /Girls games only|already on that court|already|days|week/.test(forced.data.error), forced.data.error);
  // One division, and clearing tags.
  const g6div = divs.find((d) => d.name === '6th Grade Girls');
  const divTag = await call('POST', '/slots/tag', { token: pd, body: { weekday: tagDay, reservedFor: 'division', reservedDivisionId: g6div.id, reservedMode: 'only' } });
  check('a slot can be kept for one division', divTag.status === 200 && (await call('GET', `/slots?from=${seasonNow.startDate}&to=${seasonNow.endDate}`, { token: pd })).data.slots.find((x) => x.id === tagged.id).reservedText === '6th Grade Girls only');
  const dDiv = await draftWith({});
  check('only that division plays there', onTagDay(dDiv).every((g) => g.divisionId === g6div.id));
  check('tags can be cleared', (await call('POST', '/slots/tag', { token: pd, body: { weekday: tagDay, reservedFor: '' } })).data.updated === byDay[tagDay]
    && !(await call('GET', `/slots?from=${seasonNow.startDate}&to=${seasonNow.endDate}`, { token: pd })).data.slots.some((x) => x.reservedFor));
  check('the Activity log records tagging', (await call('GET', '/activity?category=slot', { token: pd })).data.entries.some((e) => e.details.includes('as Girls priority')));
}

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

console.log('\nRemoving and adding games (draft)');
const dGames = (await call('GET', `/schedule/runs/${draftId}/games`, { token: admin })).data.games;
const toRemove = dGames.find((g) => g.id !== target.id && g.status === 'scheduled');
const rm = await call('DELETE', `/schedule/games/${toRemove.id}`, { token: admin });
check('admin removes a pairing from the draft', rm.status === 200 && !(await call('GET', `/schedule/runs/${draftId}/games`, { token: admin })).data.games.some((g) => g.id === toRemove.id));
check('only the System Admin can remove games', (await call('DELETE', `/schedule/games/${target.id}`, { token: pd })).status === 403);
const addTeams = (await call('GET', `/schedule/add-game/teams?runId=${draftId}`, { token: admin })).data;
check('add-a-game lists every team with its game count', addTeams.teams.length >= 20 && addTeams.teams.every((t) => Number.isInteger(t.games) && t.mine));
const removedTeam = addTeams.teams.find((t) => t.id === toRemove.homeTeamId);
const opp = (await call('GET', `/schedule/add-game/opponents?runId=${draftId}&teamId=${removedTeam.id}`, { token: admin })).data;
const ruleOpp = opp.opponents.find((o) => o.id === toRemove.awayTeamId);
check('opponents include the removed pairing, within the rules again', !!ruleOpp && ruleOpp.exceptions.length === 0, JSON.stringify(ruleOpp));
const crossOpp = opp.opponents.find((o) => !o.sameDivision);
check('a System Admin also sees other divisions, marked as exceptions', !!crossOpp && crossOpp.exceptions.some((e) => e.includes('Different divisions')));
const addOpts = (await call('GET', `/schedule/add-game/options?runId=${draftId}&teamId=${removedTeam.id}&opponentId=${ruleOpp.id}`, { token: admin })).data;
check('open times are offered for the new game', addOpts.options.length > 0 && addOpts.exceptions.length === 0);
const ao = addOpts.options[0];
const added = await call('POST', `/schedule/runs/${draftId}/games`, { token: admin, body: { teamId: removedTeam.id, opponentId: ruleOpp.id, courtId: ao.courtId, date: ao.date, startTime: ao.startTime, endTime: ao.endTime, reason: 'Replacing the removed pairing' } });
check('admin adds a game at an open time', added.status === 201 && added.data.game.status === 'scheduled' && added.data.game.date === ao.date && added.data.game.isAdded && !added.data.game.isException, JSON.stringify(added.data).slice(0, 200));
check('the court decides who hosts', added.data.game.venueProgramId === (ao.flip ? teamProgAll[ruleOpp.id] : teamProgAll[removedTeam.id]));
check('the added game records who added it and why', added.data.game.addedByName === 'Grace Kim' && added.data.game.addedReason === 'Replacing the removed pairing');
const sameSpot = await call('POST', `/schedule/runs/${draftId}/games`, { token: admin, body: { teamId: removedTeam.id, opponentId: ruleOpp.id, courtId: ao.courtId, date: ao.date, startTime: ao.startTime, endTime: ao.endTime } });
check('a taken court (or a rule) blocks a second game at the same time', sameSpot.status === 409);
const noFlag = await call('POST', `/schedule/runs/${draftId}/games`, { token: admin, body: { teamId: removedTeam.id, opponentId: crossOpp.id } });
check('a game that breaks a league rule needs to be marked an exception', noFlag.status === 409 && noFlag.data.code === 'EXCEPTION_REQUIRED' && noFlag.data.exceptions.length >= 1);
check('an exception needs a reason', (await call('POST', `/schedule/runs/${draftId}/games`, { token: admin, body: { teamId: removedTeam.id, opponentId: crossOpp.id, exception: true, reason: '' } })).status === 400);
const excAdd = await call('POST', `/schedule/runs/${draftId}/games`, { token: admin, body: { teamId: removedTeam.id, opponentId: crossOpp.id, exception: true, reason: 'Scrimmage agreed by both clubs' } });
check('an exception is added, with the rule it breaks kept on the game', excAdd.status === 201 && excAdd.data.game.isException && excAdd.data.game.exceptionNote.includes('Different divisions'));
check('in a draft, a game can be added without a time (to Unplaced)', excAdd.data.game?.status === 'unscheduled');
check('added games are marked in the draft', (await call('GET', `/schedule/runs/${draftId}/games`, { token: admin })).data.games.filter((g) => g.isAdded).length === 2);
// Leave the draft with one added game (the replacement) so publishing carries it.
for (const g of [excAdd.data.game]) await call('DELETE', `/schedule/games/${g.id}`, { token: admin });
const addedDraftGame = added.data.game;

console.log('\nDraft review and sign-off');
// Every program signs off: directors for their own programs, the admin for programs without one.
async function signOffAll(runId) {
  await call('POST', `/schedule/runs/${runId}/share`, { token: admin, body: {} });
  const st = (await call('GET', `/schedule/runs/${runId}/review`, { token: admin })).data.review;
  for (const r of st.reviews) {
    if (r.status === 'signed_off') continue;
    if (!r.hasDirector) await call('POST', `/schedule/runs/${runId}/review/${r.programId}/sign-off`, { token: admin, body: {} });
    else await call('POST', '/schedule/draft-review/sign-off', { token: r.programId === nfh.id ? pd : mbell, body: {} });
  }
}
const reviewOf = async (runId) => (await call('GET', `/schedule/runs/${runId}/review`, { token: admin })).data.review;
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const leagueTodayStr = (await import('../utils/leagueTime.js')).leagueToday();
const notShared = await call('POST', `/schedule/runs/${draftId}/publish`, { token: admin, body: { replace: true } });
check('a draft can’t be published before it’s shared for sign-off', notShared.status === 409 && notShared.data.code === 'NOT_SHARED');
check('directors see nothing until the draft is shared', (await call('GET', '/schedule/draft-review', { token: pd })).data.shared === false);
check('coaches never see the draft review', (await call('GET', '/schedule/draft-review', { token: coach })).status === 403);
check('a review deadline can’t be in the past', (await call('POST', `/schedule/runs/${draftId}/share`, { token: admin, body: { deadline: addDays(leagueTodayStr, -1) } })).status === 400);
const shareRes = await call('POST', `/schedule/runs/${draftId}/share`, { token: admin, body: { deadline: addDays(leagueTodayStr, 7) } });
const rv0 = shareRes.data.review;
check('sharing creates a review for every program with teams', shareRes.status === 200 && rv0.shared && rv0.counts.total >= 5 && rv0.counts.waiting === rv0.counts.total, JSON.stringify(rv0.counts));
check('guest programs don’t review', !rv0.reviews.some((r) => r.programName.includes('Sherwood')));
const pdView = (await call('GET', '/schedule/draft-review', { token: pd })).data;
check('a director sees only their own program’s draft games', pdView.shared && pdView.games.length > 0 && pdView.games.every((g) => [g.homeProgramId, g.awayProgramId].includes(nfh.id)));
check('draft games still aren’t visible on the game pages', (await call('GET', `/schedule/games/${pdView.games[0].id}`, { token: pd })).status === 404);
const notMineDraft = (await call('GET', `/schedule/runs/${draftId}/games`, { token: admin })).data.games.find((g) => ![g.homeProgramId, g.awayProgramId].includes(nfh.id));
check('a director can’t flag another program’s game', (await call('POST', '/schedule/draft-review/flags', { token: pd, body: { gameId: notMineDraft.id, note: 'Not our game at all' } })).status === 404);
check('a flag needs a note', (await call('POST', '/schedule/draft-review/flags', { token: pd, body: { gameId: pdView.games[0].id, note: '' } })).status === 400);
const flagRes = await call('POST', '/schedule/draft-review/flags', { token: pd, body: { gameId: pdView.games[0].id, note: 'That date clashes with our school event.' } });
const rv1 = await reviewOf(draftId);
check('a director flags a game', flagRes.status === 201 && rv1.reviews.find((r) => r.programId === nfh.id).status === 'flagged' && rv1.flags.some((f) => f.status === 'open' && f.note.includes('school event')));
check('the admin can’t sign off for a program that has a director', (await call('POST', `/schedule/runs/${draftId}/review/${nfh.id}/sign-off`, { token: admin, body: {} })).status === 409);
const noDir = rv1.reviews.find((r) => !r.hasDirector);
const behalf = await call('POST', `/schedule/runs/${draftId}/review/${noDir.programId}/sign-off`, { token: admin, body: { note: 'Confirmed by phone with their contact' } });
check('the admin signs off on behalf of a program without a director (recorded)', behalf.data.review?.reviews.find((r) => r.programId === noDir.programId)?.onBehalf === true);
const blocked = await call('POST', `/schedule/runs/${draftId}/publish`, { token: admin, body: { replace: true } });
check('publishing waits for every sign-off before the deadline', blocked.status === 409 && blocked.data.code === 'SIGNOFF_REQUIRED' && blocked.data.pending.some((p) => p.programId === nfh.id));
check('even with an override, before the deadline', (await call('POST', `/schedule/runs/${draftId}/publish`, { token: admin, body: { replace: true, override: true } })).data.code === 'SIGNOFF_REQUIRED');
const openFlag = rv1.flags.find((f) => f.status === 'open');
check('the admin resolves a flag', (await call('POST', `/schedule/flags/${openFlag.id}/resolve`, { token: admin, body: { note: 'Checked with the other program; the date stays.' } })).data.review?.flags.find((f) => f.id === openFlag.id).status === 'resolved');
await signOffAll(draftId);
const rv2 = await reviewOf(draftId);
check('every program signed off', rv2.allSignedOff === true, JSON.stringify(rv2.counts));
// Changing a game after sign-off: only the two programs in it review again.
const moveMe = (await call('GET', `/schedule/runs/${draftId}/games`, { token: admin })).data.games.find((g) => g.status === 'scheduled' && [g.homeProgramId, g.awayProgramId].includes(nfh.id) && ![g.homeProgramId, g.awayProgramId].includes(ryb.id));
await call('PUT', `/schedule/games/${moveMe.id}`, { token: admin, body: { action: 'flip' } });
const rv3 = await reviewOf(draftId);
const affected = [moveMe.homeProgramId, moveMe.awayProgramId];
check('only the programs in a changed game have to sign off again', rv3.reviews.filter((r) => r.status === 'waiting').map((r) => r.programId).sort().join() === affected.sort().join() && rv3.reviews.find((r) => r.programId === ryb.id).status === 'signed_off', JSON.stringify(rv3.reviews.map((r) => [r.programName, r.status])));
check('they’re told what changed', rv3.reviews.find((r) => r.programId === nfh.id).resetReason?.includes(moveMe.awayTeamName));
check('the director sees the change on their review page', (await call('GET', '/schedule/draft-review', { token: pd })).data.review.resetReason?.includes('Swapped home/away'));
check('the director’s dashboard shows the review', (await call('GET', '/dashboard', { token: pd })).data.draftReview?.status === 'waiting');
await signOffAll(draftId);
check('the Activity log records sign-offs', (await call('GET', '/activity?category=schedule', { token: admin })).data.entries.some((e) => e.details.includes('on behalf of')));

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

console.log('\nAdding games (published schedule)');
const pubAdded = (await call('GET', '/schedule/games', { token: coach })).data.games.find((g) => g.id === addedDraftGame.id); // publishing keeps the draft's game rows
check('a game added to the draft is published like any other', !!pubAdded && pubAdded.isAdded);
check('published games can’t be removed (cancel instead)', (await call('DELETE', `/schedule/games/${pubAdded.id}`, { token: admin })).status === 409);
const coachTeams = (await call('GET', '/schedule/add-game/teams', { token: coach })).data;
const myTeam = coachTeams.teams.find((t) => t.mine);
check('a coach may add games only for their own teams', !!myTeam && coachTeams.teams.filter((t) => t.mine).every((t) => t.programId === nfh.id));
const otherTeam = coachTeams.teams.find((t) => !t.mine);
check('asking for another team’s opponents is refused', (await call('GET', `/schedule/add-game/opponents?teamId=${otherTeam.id}`, { token: coach })).status === 403);
check('a team that already meets every opponent the limit has none to request', (await call('GET', `/schedule/add-game/opponents?teamId=${myTeam.id}`, { token: coach })).data.opponents.length === 0);
// Two of its upcoming games are called off, so it needs replacements.
const myUpcoming = (await call('GET', '/schedule/games?mine=1', { token: coach })).data.games.filter((g) => g.canRequest && !g.hasOpenRequest && [g.homeTeamId, g.awayTeamId].includes(myTeam.id));
const offOpponents = [];
for (const g of myUpcoming) {
  const o = g.homeTeamId === myTeam.id ? g.awayTeamId : g.homeTeamId;
  if (offOpponents.includes(o)) continue;
  await call('PUT', `/schedule/games/${g.id}`, { token: admin, body: { action: 'cancel', reason: 'Opponent forfeited the game.' } });
  offOpponents.push(o);
  if (offOpponents.length === 2) break;
}
const coachOpp = (await call('GET', `/schedule/add-game/opponents?teamId=${myTeam.id}`, { token: coach })).data.opponents;
check('after a cancellation, that opponent can be played again', offOpponents.every((o) => coachOpp.some((x) => x.id === o)), JSON.stringify(coachOpp.map((o) => o.name)));
check('a coach only sees opponents within the league rules', coachOpp.length > 0 && coachOpp.every((o) => o.sameDivision && !o.exceptions.length && teamProgAll[o.id] !== nfh.id));
const outOfRules = coachTeams.teams.find((t) => t.divisionId !== myTeam.divisionId);
check('a request can’t be an exception', (await call('GET', `/schedule/add-game/options?teamId=${myTeam.id}&opponentId=${outOfRules.id}`, { token: coach })).status === 409);
const rybOpp = coachOpp.find((o) => teamProgAll[o.id] === ryb.id && offOpponents.includes(o.id)) || coachOpp[0];
const leagueTodayNow = (await import('../utils/leagueTime.js')).leagueToday();
const reqOpts = (await call('GET', `/schedule/add-game/options?teamId=${myTeam.id}&opponentId=${rybOpp.id}`, { token: coach })).data.options;
check('open future times are offered for a requested game', reqOpts.length > 0 && reqOpts.every((o) => o.date >= leagueTodayNow));
const ro = reqOpts[0];
const addBody = { type: 'add', teamId: myTeam.id, opponentId: rybOpp.id, courtId: ro.courtId, date: ro.date, startTime: ro.startTime, endTime: ro.endTime, reason: 'Our opponent dropped out; we need a replacement game.' };
check('a coach can’t request a game for another team', (await call('POST', '/requests', { token: coach, body: { ...addBody, teamId: otherTeam.id } })).status === 403);
const addReq = await call('POST', '/requests', { token: coach, body: addBody });
check('a coach asks to add a game', addReq.status === 201 && addReq.data.request.type === 'add' && addReq.data.request.status === 'pending_director', JSON.stringify(addReq.data).slice(0, 200));
check('it reads as an added game', /^Add /.test(addReq.data.request.summary) && addReq.data.request.game.homeTeamName, addReq.data.request.summary);
check('only one open request per pair of teams', (await call('POST', '/requests', { token: coach, body: addBody })).status === 409);
const arId = addReq.data.request.id;
check('the other program can see the request', (await call('GET', '/requests', { token: mbell })).data.requests.some((r) => r.id === arId) || teamProgAll[rybOpp.id] !== ryb.id);
await call('POST', `/requests/${arId}/act`, { token: pd, body: { action: 'approve' } });
if (teamProgAll[rybOpp.id] === ryb.id) await call('POST', `/requests/${arId}/act`, { token: mbell, body: { action: 'approve' } });
const addSignOff = await call('POST', `/requests/${arId}/act`, { token: admin, body: { action: 'approve' } });
const newGame = addSignOff.data.request?.game;
check('the league signs off and the game is created', addSignOff.data.request?.status === 'approved' && newGame?.id && newGame.status === 'scheduled' && newGame.isAdded, JSON.stringify(addSignOff.data).slice(0, 200));
check('the new game is on the published schedule', (await call('GET', '/schedule/games?mine=1', { token: coach })).data.games.some((g) => g.id === newGame.id));
check('the new game gets referee slots', (await call('GET', `/schedule/games/${newGame.id}`, { token: admin })).data.game.refereeSlots > 0);
check('the request’s reason is kept on the game', newGame.addedReason === addBody.reason);
check('Activity shows the request', (await call('GET', '/activity?category=request', { token: pd })).data.entries.some((e) => e.details.includes('Requested: Add')));
// A System Admin adds straight onto the published schedule.
const adminOpts = (await call('GET', `/schedule/add-game/options?teamId=${myTeam.id}&opponentId=${rybOpp.id}`, { token: admin })).data.options;
check('a published game needs a time', (await call('POST', `/schedule/runs/${pubr.data.published.id}/games`, { token: admin, body: { teamId: myTeam.id, opponentId: rybOpp.id } })).status === 400);
const ao2 = adminOpts.find((o) => o.date !== ro.date) || adminOpts[0];
const liveAdd = await call('POST', `/schedule/runs/${pubr.data.published.id}/games`, { token: admin, body: { teamId: myTeam.id, opponentId: rybOpp.id, courtId: ao2.courtId, date: ao2.date, startTime: ao2.startTime, endTime: ao2.endTime, exception: true, reason: 'Make-up game for the snow day' } });
check('admin adds a game to the published schedule', liveAdd.status === 201 && liveAdd.data.game.status === 'scheduled', JSON.stringify(liveAdd.data).slice(0, 300));
check('both programs see the added game in Activity', (await call('GET', '/activity?category=schedule', { token: pd })).data.entries.some((e) => e.details.startsWith('Added ') && e.details.includes('Make-up game for the snow day')));
// Left open on purpose: publishing a new schedule later must cancel it.
const pendingOpp = coachOpp.find((o) => o.id !== rybOpp.id);
const pendingOpts = (await call('GET', `/schedule/add-game/options?teamId=${myTeam.id}&opponentId=${pendingOpp.id}`, { token: pd })).data.options;
const pendingAdd = await call('POST', '/requests', { token: pd, body: { type: 'add', teamId: myTeam.id, opponentId: pendingOpp.id, courtId: pendingOpts[0].courtId, date: pendingOpts[0].date, startTime: pendingOpts[0].startTime, endTime: pendingOpts[0].endTime, reason: 'Extra practice game before the playoffs.' } });
check('a director asks to add a game (skips the director step)', pendingAdd.status === 201 && pendingAdd.data.request.status !== 'pending_director', JSON.stringify(pendingAdd.data).slice(0, 200));

console.log('\nGuest teams');
const progCountBefore = (await call('GET', '/programs', { token: admin })).data.programs.filter((p) => p.isActive && !p.isGuest).length;
const gp = await call('POST', '/programs', { token: admin, body: { name: 'Sherwood Youth Basketball', shortCode: 'SHW', city: 'Sherwood', isGuest: true } });
check('the league adds a guest program', gp.status === 201 && gp.data.program.isGuest === 1);
check('directors can’t add programs, guest or not', (await call('POST', '/programs', { token: pd, body: { name: 'Tigard Guests', shortCode: 'TGD', isGuest: true } })).status === 403);
const progList = (await call('GET', '/programs', { token: admin })).data.programs;
check('guest programs are flagged and don’t take a league spot', progList.find((p) => p.id === gp.data.program.id)?.isGuest === true
  && progList.filter((p) => p.isActive && !p.isGuest).length === progCountBefore);
const guestId = gp.data.program.id;
check('guest programs have no venues', (await call('POST', '/venues', { token: admin, body: { programId: guestId, name: 'Sherwood HS', address: '1 Main St', city: 'Sherwood' } })).status === 400);
check('guest programs have no gym slots', (await call('POST', '/slots', { token: admin, body: { programId: guestId, courtId: 'x', date: '2026-12-01', startTime: '18:00', endTime: '19:00', category: 'WEEKNIGHT_GAME' } })).status === 400);
check('guest programs have no blackouts', (await call('POST', '/blackouts', { token: admin, body: { programId: guestId, startDate: '2026-12-01', endDate: '2026-12-01', reason: 'Closed' } })).status === 400);
check('guest programs have no director or coach accounts', (await call('POST', '/users', { token: admin, body: { firstName: 'Guest', lastName: 'Director', username: 'guestdir', email: 'guestdir@example.com', password: 'Temp-Pass-123!', role: 'program_director', programId: guestId } })).status === 400);
const gt = await call('POST', '/teams', { token: admin, body: { programId: guestId, name: 'Sherwood 5th Boys', divisionId: myTeam.divisionId } });
check('the league adds a guest team in a division', gt.status === 201 && gt.data.team.programIsGuest === 1);
const gt2 = await call('POST', '/teams', { token: admin, body: { programId: guestId, name: 'Sherwood 5th Boys B', divisionId: myTeam.divisionId } });
const dash = (await call('GET', '/dashboard', { token: admin })).data;
check('guests aren’t in the setup checklist', !(dash.programReadiness || []).some((p) => p.id === guestId));
const guestOpp = (await call('GET', `/schedule/add-game/opponents?teamId=${myTeam.id}`, { token: coach })).data.opponents.find((o) => o.id === gt.data.team.id);
check('a coach can pick a guest team in the same division', !!guestOpp && guestOpp.isGuest && !guestOpp.exceptions.length);
const gOpts = (await call('GET', `/schedule/add-game/options?teamId=${myTeam.id}&opponentId=${gt.data.team.id}`, { token: coach })).data;
check('guest games are offered only at the league team’s gyms', gOpts.options.length > 0 && gOpts.options.every((o) => !o.flip && o.programId === nfh.id));
check('a guest game isn’t counted against the games-per-team target', !gOpts.warnings.some((w) => w.includes('target')));
const myGamesBefore = (await call('GET', '/schedule/add-game/teams', { token: coach })).data.teams.find((t) => t.id === myTeam.id);
const go = gOpts.options[0];
const gReq = await call('POST', '/requests', { token: coach, body: { type: 'add', teamId: myTeam.id, opponentId: gt.data.team.id, courtId: go.courtId, date: go.date, startTime: go.startTime, endTime: go.endTime, reason: 'Non-conference game against Sherwood.' } });
check('a coach asks for a guest game', gReq.status === 201 && gReq.data.request.status === 'pending_director', JSON.stringify(gReq.data).slice(0, 200));
check('no “other program” step for a guest', !gReq.data.request.steps.some((x) => x.stage === 'counterpart'));
const gEnd = await call('POST', `/requests/${gReq.data.request.id}/act`, { token: pd, body: { action: 'approve' } });
check('after the director endorses, it goes straight to the league', gEnd.data.request?.status === 'pending_admin');
const gOk = await call('POST', `/requests/${gReq.data.request.id}/act`, { token: admin, body: { action: 'approve' } });
const guestGame = gOk.data.request?.game;
check('the league signs off and the guest game is added', gOk.data.request?.status === 'approved' && guestGame?.isGuestGame && !guestGame.homeIsGuest && guestGame.awayIsGuest, JSON.stringify(gOk.data).slice(0, 200));
check('the league team hosts', guestGame.venueProgramId === nfh.id);
check('the guest game gets referee slots', (await call('GET', `/schedule/games/${guestGame.id}`, { token: admin })).data.game.refereeSlots > 0);
const myGamesAfter = (await call('GET', '/schedule/add-game/teams', { token: coach })).data.teams.find((t) => t.id === myTeam.id);
check('guest games are counted separately from league games', myGamesAfter.games === myGamesBefore.games && myGamesAfter.guestGames === myGamesBefore.guestGames + 1);
const gCancel = await call('POST', '/requests', { token: coach, body: { gameId: guestGame.id, type: 'cancel', reason: 'Sherwood can’t make it after all.' } });
check('requests on guest games skip the other-program step', gCancel.status === 201 && !gCancel.data.request.steps.some((x) => x.stage === 'counterpart'));
await call('POST', `/requests/${gCancel.data.request.id}/cancel`, { token: coach });
check('two guest teams can’t play each other', (await call('POST', `/schedule/runs/${pubr.data.published.id}/games`, { token: admin, body: { teamId: gt.data.team.id, opponentId: gt2.data.team.id, courtId: go.courtId, date: go.date, startTime: go.startTime, endTime: go.endTime } })).status === 400);

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
// A fresh list: an earlier step moves one game to today, and it may be one that was in the future.
const futureA = (await call('GET', '/referees/games', { token: assignor })).data.games.find((g) => g.date > todayLocal && g.assignments[0].refereeId);
const futureR = await call('PUT', `/referees/assignments/${futureA.assignments[0].id}/status`, { token: assignor, body: { status: 'checked_in' } });
check('attendance cannot be confirmed for future games', futureR.status === 400, `${futureR.status} ${JSON.stringify(futureR.data).slice(0, 160)} game ${futureA.date} ${futureA.status}`);
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
check('the matchmaker never schedules guest teams', !(await call('GET', `/schedule/runs/${regen.data.draft.id}/games`, { token: admin })).data.games.some((g) => g.isGuestGame));
const keep = (await call('GET', `/schedule/games?programId=${nfh.id}`, { token: admin })).data.games.find((g) => g.status === 'scheduled' && draftKeys.has(gameKey(g)));
await (await import('../db/client.js')).run('UPDATE games SET home_score = 51, away_score = 49 WHERE id = ?', [keep.id]);
// Publish after the review deadline without every sign-off: allowed, and recorded.
await call('POST', `/schedule/runs/${regen.data.draft.id}/share`, { token: admin, body: { deadline: leagueTodayStr } });
check('before the deadline has passed, it can’t be overridden', (await call('POST', `/schedule/runs/${regen.data.draft.id}/publish`, { token: admin, body: { replace: true, override: true } })).data.code === 'SIGNOFF_REQUIRED');
await (await import('../db/client.js')).run('UPDATE schedule_runs SET review_deadline = ? WHERE id = ?', [addDays(leagueTodayStr, -1), regen.data.draft.id]); // the deadline passes
const needsOverride = await call('POST', `/schedule/runs/${regen.data.draft.id}/publish`, { token: admin, body: { replace: true } });
check('after the deadline, publishing without every sign-off needs an explicit override', needsOverride.data.code === 'OVERRIDE_REQUIRED' && needsOverride.data.pending.length > 0);
const needs = await call('POST', `/schedule/runs/${regen.data.draft.id}/publish`, { token: admin, body: { override: true } });
check('republish warns about referee assignments', needs.data.code === 'REPLACE_REQUIRED' && needs.data.assignedAhead > 0);
const rep = await call('POST', `/schedule/runs/${regen.data.draft.id}/publish`, { token: admin, body: { replace: true, override: true, overrideNote: 'Two directors didn’t respond' } });
check('the override is recorded on the schedule', rep.data.published?.publishOverride?.pending.length > 0 && rep.data.published.publishOverride.note === 'Two directors didn’t respond');
check('and in the Activity log', (await call('GET', '/activity?category=schedule', { token: admin })).data.entries.some((e) => e.details.includes('review deadline without sign-off from')));
check('unchanged games keep their referees', rep.status === 200 && rep.data.referees.carried > 0, JSON.stringify(rep.data.referees));
check('worked games still count for pay after republishing', (await call('GET', `/referees/payouts?from=${todayLocal}&to=${todayLocal}`, { token: assignor })).data.totals.games === 1);
const newGames = (await call('GET', `/schedule/games?programId=${nfh.id}`, { token: admin })).data.games;
const kept = newGames.find((g) => [g.homeTeamId, g.awayTeamId].sort().join() === [keep.homeTeamId, keep.awayTeamId].sort().join() && g.date === keep.date && g.startTime === keep.startTime);
check('publishing a new schedule cancels open requests to add games', (await call('GET', `/requests/${pendingAdd.data.request.id}`, { token: admin })).data.request.status === 'cancelled');
check('final scores carry over to unchanged games when republishing', !!kept && kept.hasScore && (kept.homeTeamId === keep.homeTeamId ? kept.homeScore === 51 : kept.awayScore === 51));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
