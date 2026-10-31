// Preseason: scrimmages and joint practices before the regular season.
//   The season can have a "preseason opens" date. Teams whose program is ready
//   are marked "open for preseason" by their director. A director finds another
//   open team (same division, or one grade either side), picks one of the
//   suggested times (open preseason gym time at either program, when both teams
//   are free), and sends a request. The other program's director accepts or
//   declines; there's no league sign-off, but the league sees everything.
//   Preseason events are kept apart from league games: they don't count toward
//   games per team, home/away balance or standings.
import { Router } from 'express';
import { one, all, run, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, isSuperAdmin } from '../middleware/auth.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { assertDate, assertTime, trimOrNull } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';
import { getRules } from '../scheduling/data.js';
import { carveWindows, milesBetween, toMinutes } from '../scheduling/core.js';
import { leagueNow, notifyUsers, notifyAssignors } from '../referees/data.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent);
const viewers = requireRole('super_admin', 'program_director', 'referee_assignor', 'league_coach');
const directors = requireRole('super_admin', 'program_director');

export const KIND_LABEL = { scrimmage: 'Scrimmage', joint_practice: 'Joint practice' };
const STATUS_LABEL = { requested: 'Waiting for the other program', accepted: 'On', declined: 'Declined', withdrawn: 'Withdrawn', cancelled: 'Cancelled' };
const GAME_CATS = ['WEEKNIGHT_GAME', 'WEEKEND_GAME_BLOCK'];
const today = () => leagueNow().date;
const LIVE = "('requested', 'accepted')";

async function activeSeason() { return one('SELECT * FROM seasons WHERE is_active = 1'); }
// The preseason window for a season: [first, last] (inclusive), or null.
function windowOf(season) {
  if (!season?.preseasonStart) return null;
  const d = new Date(`${season.startDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
  return { first: season.preseasonStart, last: d.toISOString().slice(0, 10) };
}
async function requirePreseason() {
  const season = await activeSeason();
  const w = windowOf(season);
  if (!w) throw conflict('There’s no preseason this season. A System Admin can add a “Preseason opens” date under League setup.');
  return { season, w };
}
const TEAM_SELECT = `SELECT t.id, t.name, t.program_id, t.division_id, t.preseason_open, t.preseason_open_at, t.is_active,
    d.name AS division_name, d.grade, d.gender, p.name AS program_name, p.short_code, p.is_guest, p.is_active AS program_active
  FROM teams t JOIN divisions d ON d.id = t.division_id JOIN programs p ON p.id = t.program_id`;
async function loadTeam(id) {
  const t = await one(`${TEAM_SELECT} WHERE t.id = ?`, [id]);
  if (!t) throw notFound('Team');
  return t;
}
function assertOwnTeam(req, team) {
  if (isSuperAdmin(req.user)) return;
  if (req.user.role !== 'program_director' || team.programId !== req.user.programId) throw forbidden('You can only arrange preseason games for your own program’s teams.');
}
// Same division, or (widened) the same gender one grade either side.
function canMeet(a, b, wider) {
  if (a.programId === b.programId) return false;
  if (a.divisionId === b.divisionId) return true;
  if (!wider) return false;
  const ga = Number(a.grade); const gb = Number(b.grade);
  return a.gender === b.gender && Number.isFinite(ga) && Number.isFinite(gb) && Math.abs(ga - gb) <= 1;
}
async function programVenues(programIds) {
  if (!programIds.length) return new Map();
  const rows = await all(`SELECT id, program_id, name, latitude, longitude FROM venues WHERE is_active = 1 AND program_id IN (${programIds.map(() => '?').join(',')})`, programIds);
  const m = new Map(programIds.map((id) => [id, []]));
  for (const v of rows) m.get(v.programId).push(v);
  return m;
}
// Shortest distance between any of two programs' venues (miles), or null.
function programDistance(va, vb) {
  let best = null;
  for (const a of va || []) for (const b of vb || []) {
    const d = milesBetween({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude });
    if (d != null && (best == null || d < best)) best = d;
  }
  return best;
}
const directorsOf = (programId) => ["role = 'program_director' AND program_id = ?", [programId]];
const toPrograms = async (programIds, subject, text) => {
  for (const id of [...new Set(programIds)]) await notifyUsers(...directorsOf(id), subject, text, { label: 'Open Preseason', url: '/preseason' });
};
const fmtWhen = (e) => `${e.date} ${e.startTime}–${e.endTime}`;

// ---- GET /api/preseason ----  The season's preseason and your teams.
router.get('/', viewers, ah(async (req, res) => {
  const season = await activeSeason();
  const w = windowOf(season);
  const programId = req.user.role === 'super_admin' ? (req.query.programId || null) : req.user.programId || null;
  const teams = programId && ['super_admin', 'program_director'].includes(req.user.role)
    ? (await all(`${TEAM_SELECT} WHERE t.program_id = ? AND t.is_active = 1 ORDER BY d.sort_order, t.name COLLATE NOCASE`, [programId])).map((t) => ({ ...t, preseasonOpen: !!t.preseasonOpen }))
    : [];
  const openCount = await one('SELECT COUNT(*) AS n FROM teams t JOIN programs p ON p.id = t.program_id WHERE t.preseason_open = 1 AND t.is_active = 1 AND p.is_active = 1');
  res.json({
    season: season ? { id: season.id, name: season.name, startDate: season.startDate, endDate: season.endDate, preseasonStart: season.preseasonStart } : null,
    window: w, isOpen: !!w && today() <= w.last, today: today(), teams, openTeams: Number(openCount.n),
  });
}));

// ---- PUT /api/preseason/teams ----  { teamIds: [...] | programId + all: true, open: bool }
// A director opens or closes their own teams for preseason play.
router.put('/teams', directors, ah(async (req, res) => {
  const b = req.body || {};
  const open = !!b.open;
  let teams;
  if (b.all) {
    const programId = isSuperAdmin(req.user) ? b.programId : req.user.programId;
    if (!programId) throw badRequest('Choose a program.');
    teams = await all(`${TEAM_SELECT} WHERE t.program_id = ? AND t.is_active = 1`, [programId]);
  } else {
    const ids = Array.isArray(b.teamIds) ? b.teamIds : [];
    if (!ids.length) throw badRequest('Choose at least one team.');
    teams = await all(`${TEAM_SELECT} WHERE t.id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  for (const t of teams) assertOwnTeam(req, t);
  if (teams.some((t) => t.isGuest)) throw badRequest('Guest teams don’t take part in the preseason.');
  const changed = teams.filter((t) => !!t.preseasonOpen !== open);
  for (const t of changed) await run(`UPDATE teams SET preseason_open = ?, preseason_open_at = ${open ? "datetime('now')" : 'NULL'}, updated_at = datetime('now') WHERE id = ?`, [open ? 1 : 0, t.id]);
  if (changed.length) {
    await logActivity({ category: 'preseason', action: open ? 'opened' : 'closed', actor: req.user, programId: changed[0].programId, onBehalfOf: changed[0].programId,
      details: `${open ? 'Opened' : 'Closed'} for preseason: ${changed.map((t) => t.name).join(', ')}` });
  }
  res.json({ changed: changed.length });
}));

// ---- GET /api/preseason/board?teamId=&wider=1 ----  Teams your team could play.
router.get('/board', directors, ah(async (req, res) => {
  const { season, w } = await requirePreseason();
  const team = await loadTeam(req.query.teamId);
  assertOwnTeam(req, team);
  const wider = req.query.wider === '1' || req.query.wider === 'true';
  const others = (await all(`${TEAM_SELECT} WHERE t.preseason_open = 1 AND t.is_active = 1 AND p.is_active = 1 AND p.is_guest = 0 AND t.id != ?
    ORDER BY d.sort_order, p.name COLLATE NOCASE, t.name COLLATE NOCASE`, [team.id])).filter((o) => canMeet(team, o, wider));
  const venues = await programVenues([...new Set([team.programId, ...others.map((o) => o.programId)])]);
  const booked = await all(`SELECT host_team_id, visitor_team_id, status FROM preseason_events WHERE season_id = ? AND status IN ${LIVE} AND date >= ?`, [season.id, today()]);
  res.json({
    window: w, team: { ...team, preseasonOpen: !!team.preseasonOpen },
    opponents: others.map((o) => ({
      id: o.id, name: o.name, programId: o.programId, programName: o.programName, divisionName: o.divisionName, sameDivision: o.divisionId === team.divisionId,
      openSince: o.preseasonOpenAt, miles: programDistance(venues.get(team.programId), venues.get(o.programId)),
      withYou: booked.filter((e) => [e.hostTeamId, e.visitorTeamId].includes(o.id) && [e.hostTeamId, e.visitorTeamId].includes(team.id)).length,
    })).sort((a, b) => Number(b.sameDivision) - Number(a.sameDivision) || (a.miles ?? 999) - (b.miles ?? 999)),
  });
}));

// Times two teams could meet: open preseason gym time at either program, on a
// day neither team already has a preseason event and neither program is
// blacked out, not already booked by another preseason event.
async function candidateTimes(season, w, team, opp, kind) {
  const rules = await getRules();
  const first = w.first > today() ? w.first : today();
  if (first > w.last) return [];
  const cats = kind === 'joint_practice' ? [...GAME_CATS, 'PRACTICE'] : GAME_CATS;
  const slots = await all(`SELECT g.id, g.program_id, g.court_id, g.date, g.start_time, g.end_time, g.category,
      c.name AS court_name, v.id AS venue_id, v.name AS venue_name, v.latitude, v.longitude, v.address, v.city
    FROM gym_slots g JOIN courts c ON c.id = g.court_id JOIN venues v ON v.id = c.venue_id
    WHERE g.season_id = ? AND g.program_id IN (?, ?) AND g.date BETWEEN ? AND ? AND g.category IN (${cats.map(() => '?').join(',')}) AND v.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM blackout_dates b WHERE b.program_id = g.program_id AND (b.venue_id IS NULL OR b.venue_id = v.id) AND g.date BETWEEN b.start_date AND b.end_date)
      AND NOT EXISTS (SELECT 1 FROM blackout_dates b WHERE b.venue_id IS NULL AND b.program_id IN (?, ?) AND g.date BETWEEN b.start_date AND b.end_date)
    ORDER BY g.date, g.start_time`, [season.id, team.programId, opp.programId, first, w.last, ...cats, team.programId, opp.programId]);
  const windows = carveWindows(slots, rules.gameMinutes, rules.bufferMinutes);
  const events = await all(`SELECT court_id, date, start_time, end_time, host_team_id, visitor_team_id FROM preseason_events
    WHERE season_id = ? AND status IN ${LIVE} AND date BETWEEN ? AND ?`, [season.id, first, w.last]);
  const busyDay = new Set(events.flatMap((e) => [`${e.hostTeamId}|${e.date}`, `${e.visitorTeamId}|${e.date}`]));
  const overlaps = (a, b) => toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
  const venues = await programVenues([team.programId, opp.programId]);
  const slotInfo = new Map(slots.map((s) => [s.id, s]));
  const out = [];
  for (const x of windows) {
    if (busyDay.has(`${team.id}|${x.date}`) || busyDay.has(`${opp.id}|${x.date}`)) continue;
    if (events.some((e) => e.courtId === x.courtId && e.date === x.date && overlaps(e, x))) continue;
    const hostIsTeam = x.programId === team.programId;
    const visitorProgram = hostIsTeam ? opp.programId : team.programId;
    const s = slotInfo.get(x.slotId);
    out.push({
      slotId: x.slotId, courtId: x.courtId, courtName: x.courtName, venueName: x.venueName, venueAddress: [s.address, s.city].filter(Boolean).join(', '),
      date: x.date, startTime: x.startTime, endTime: x.endTime, category: x.category,
      host: hostIsTeam ? 'you' : 'them', hostTeamId: hostIsTeam ? team.id : opp.id, visitorTeamId: hostIsTeam ? opp.id : team.id,
      visitorMiles: programDistance(venues.get(visitorProgram), [{ latitude: x.lat, longitude: x.lng }]),
    });
  }
  return out;
}

// ---- GET /api/preseason/times?teamId=&opponentId=&kind= ----
router.get('/times', directors, ah(async (req, res) => {
  const { season, w } = await requirePreseason();
  const team = await loadTeam(req.query.teamId);
  assertOwnTeam(req, team);
  const opp = await loadTeam(req.query.opponentId);
  if (!opp.preseasonOpen) throw conflict(`${opp.name} isn’t open for preseason games.`);
  if (!canMeet(team, opp, true)) throw badRequest('Those two teams can’t play each other in the preseason.');
  const kind = req.query.kind === 'joint_practice' ? 'joint_practice' : 'scrimmage';
  const times = await candidateTimes(season, w, team, opp, kind);
  res.json({ times: times.slice(0, 80), more: Math.max(0, times.length - 80), kind });
}));

// ---- POST /api/preseason/requests ----
// { teamId, opponentId, kind, slotId, date, startTime, endTime, refereesWanted, note }
router.post('/requests', directors, ah(async (req, res) => {
  const { season, w } = await requirePreseason();
  const b = req.body || {};
  const team = await loadTeam(b.teamId);
  assertOwnTeam(req, team);
  if (!team.preseasonOpen) throw conflict(`Open ${team.name} for preseason first (on this page or under Teams).`);
  const opp = await loadTeam(b.opponentId);
  if (!opp.preseasonOpen) throw conflict(`${opp.name} isn’t open for preseason games.`);
  if (!canMeet(team, opp, true)) throw badRequest('Those two teams can’t play each other in the preseason.');
  const kind = b.kind === 'joint_practice' ? 'joint_practice' : b.kind === 'scrimmage' ? 'scrimmage' : null;
  if (!kind) throw badRequest('Choose a scrimmage or a joint practice.');
  assertDate(b.date, 'Date'); assertTime(b.startTime, 'Start time'); assertTime(b.endTime, 'End time');
  // The time must still be one of the open times (it may have been taken since the page loaded).
  const fit = (await candidateTimes(season, w, team, opp, kind)).find((t) => t.slotId === b.slotId && t.date === b.date && t.startTime === b.startTime && t.endTime === b.endTime);
  if (!fit) throw conflict('That time isn’t open any more. Pick another from the list.');
  const id = newId();
  const note = trimOrNull(b.note)?.slice(0, 400) || null;
  await run(`INSERT INTO preseason_events (id, season_id, kind, host_team_id, visitor_team_id, requesting_team_id, court_id, gym_slot_id, date, start_time, end_time, referees_wanted, note, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, season.id, kind, fit.hostTeamId, fit.visitorTeamId, team.id, fit.courtId, fit.slotId, fit.date, fit.startTime, fit.endTime, b.refereesWanted ? 1 : 0, note, req.user.id]);
  const what = `${KIND_LABEL[kind].toLowerCase()}: ${team.name} and ${opp.name}, ${fmtWhen(fit)} at ${fit.venueName} – ${fit.courtName}`;
  await logActivity({ category: 'preseason', action: 'requested', actor: req.user, programIds: [team.programId, opp.programId], details: `Asked for a ${what}`, onBehalfOf: team.programId });
  await toPrograms([opp.programId], `${team.programName} asked for a preseason ${KIND_LABEL[kind].toLowerCase()}`,
    `${team.programName} would like a preseason ${KIND_LABEL[kind].toLowerCase()} between ${team.name} and your ${opp.name}:\n${fit.date}, ${fit.startTime}–${fit.endTime}\n${fit.venueName} – ${fit.courtName}${fit.venueAddress ? ` (${fit.venueAddress})` : ''}${b.refereesWanted ? '\nThey’d like referees.' : ''}${note ? `\nNote: ${note}` : ''}\n\nOpen Preseason to accept or decline.`);
  res.status(201).json({ event: { id, status: 'requested' } });
}));

// ---- GET /api/preseason/events ----  Requests and booked events.
// Directors: their program's. Coaches: their teams' booked ones. League: all.
async function eventRows(where, args) {
  return all(`SELECT e.*, ht.name AS host_team_name, ht.program_id AS host_program_id, hp.name AS host_program_name,
      vt.name AS visitor_team_name, vt.program_id AS visitor_program_id, vp.name AS visitor_program_name,
      hd.name AS division_name, c.name AS court_name, v.name AS venue_name, v.address AS venue_address, v.city AS venue_city,
      u.first_name || ' ' || u.last_name AS requested_by_name, x.first_name || ' ' || x.last_name AS decided_by_name,
      rt.program_id AS requesting_program_id,
      ht.head_coach_user_id AS host_coach_id, vt.head_coach_user_id AS visitor_coach_id
    FROM preseason_events e
    JOIN teams ht ON ht.id = e.host_team_id JOIN programs hp ON hp.id = ht.program_id JOIN divisions hd ON hd.id = ht.division_id
    JOIN teams vt ON vt.id = e.visitor_team_id JOIN programs vp ON vp.id = vt.program_id
    JOIN teams rt ON rt.id = e.requesting_team_id
    LEFT JOIN courts c ON c.id = e.court_id LEFT JOIN venues v ON v.id = c.venue_id
    LEFT JOIN users u ON u.id = e.requested_by LEFT JOIN users x ON x.id = e.decided_by
    WHERE ${where} ORDER BY e.date, e.start_time`, args);
}
// The program the user is acting for: a director's own, or the program a
// System Admin (League Admin) has picked to help.
const actingProgram = (user, programId) => (isSuperAdmin(user) ? programId || null : user.role === 'program_director' ? user.programId : null);
function shapeEvent(e, user, actingFor = null) {
  const acting = actingProgram(user, actingFor);
  const mine = !!acting && [e.hostProgramId, e.visitorProgramId].includes(acting);
  const theirsToAnswer = e.status === 'requested' && !!acting && acting !== e.requestingProgramId && mine;
  const actions = [];
  if (theirsToAnswer) actions.push('accept', 'decline');
  if (e.status === 'requested' && ((user.role === 'program_director' && user.programId === e.requestingProgramId) || isSuperAdmin(user))) actions.push('withdraw');
  if (e.status === 'accepted' && e.date >= today() && ((user.role === 'program_director' && mine) || isSuperAdmin(user))) actions.push('cancel');
  return {
    id: e.id, kind: e.kind, kindLabel: KIND_LABEL[e.kind], status: e.status, statusLabel: STATUS_LABEL[e.status],
    date: e.date, startTime: e.startTime, endTime: e.endTime, venueName: e.venueName, courtName: e.courtName, venueAddress: [e.venueAddress, e.venueCity].filter(Boolean).join(', '),
    hostTeamId: e.hostTeamId, hostTeamName: e.hostTeamName, hostProgramId: e.hostProgramId, hostProgramName: e.hostProgramName,
    visitorTeamId: e.visitorTeamId, visitorTeamName: e.visitorTeamName, visitorProgramId: e.visitorProgramId, visitorProgramName: e.visitorProgramName,
    divisionName: e.divisionName, refereesWanted: !!e.refereesWanted, note: e.note,
    requestedByName: e.requestedByName, requestedAt: e.requestedAt, requestedByUs: !!acting && acting === e.requestingProgramId,
    decidedByName: e.decidedByName, decidedAt: e.decidedAt, decisionNote: e.decisionNote, actions, needsMe: theirsToAnswer,
  };
}
router.get('/events', viewers, ah(async (req, res) => {
  const season = await activeSeason();
  if (!season) return res.json({ events: [] });
  const where = ['e.season_id = ?'];
  const args = [season.id];
  const u = req.user;
  if (u.role === 'program_director') { where.push('(ht.program_id = ? OR vt.program_id = ?)'); args.push(u.programId, u.programId); }
  else if (u.role === 'league_coach') { where.push("e.status = 'accepted' AND (ht.head_coach_user_id = ? OR vt.head_coach_user_id = ?)"); args.push(u.id, u.id); }
  else if (isSuperAdmin(u) && req.query.programId) { where.push('(ht.program_id = ? OR vt.program_id = ?)'); args.push(req.query.programId, req.query.programId); }
  if (req.query.status === 'booked') where.push("e.status = 'accepted'");
  res.json({ events: (await eventRows(where.join(' AND '), args)).map((e) => shapeEvent(e, u, req.query.programId)) });
}));

// ---- GET /api/preseason/count ----  Requests waiting on this director.
router.get('/count', viewers, ah(async (req, res) => {
  if (req.user.role !== 'program_director' || !req.user.programId) return res.json({ needsAction: 0 });
  const n = await one(`SELECT COUNT(*) AS n FROM preseason_events e JOIN teams ht ON ht.id = e.host_team_id JOIN teams vt ON vt.id = e.visitor_team_id
    JOIN teams rt ON rt.id = e.requesting_team_id
    WHERE e.status = 'requested' AND rt.program_id != ? AND (ht.program_id = ? OR vt.program_id = ?)`, [req.user.programId, req.user.programId, req.user.programId]);
  res.json({ needsAction: Number(n.n) });
}));

async function loadEvent(id, user, actingFor = null) {
  const [e] = await eventRows('e.id = ?', [id]);
  if (!e) throw notFound('Preseason request');
  return { e, shaped: shapeEvent(e, user, actingFor) };
}

// ---- POST /api/preseason/events/:id/respond ----  { decision: accept|decline, note }
router.post('/events/:id/respond', directors, ah(async (req, res) => {
  const { e, shaped } = await loadEvent(req.params.id, req.user, req.body?.programId);
  if (!shaped.actions.includes('accept')) throw forbidden(e.status !== 'requested' ? 'That request has already been answered.' : 'Only the other program’s director answers this request.');
  const answering = e.requestingProgramId === e.hostProgramId ? e.visitorProgramId : e.hostProgramId;
  const decision = req.body?.decision;
  const note = trimOrNull(req.body?.note)?.slice(0, 400) || null;
  if (!['accept', 'decline'].includes(decision)) throw badRequest('Accept or decline.');
  if (decision === 'decline' && (!note || note.length < 3)) throw badRequest('Add a short note, e.g. another time that would work.');
  if (decision === 'accept') {
    // Still free? (Another event may have been accepted for that court or team since.)
    const clash = await one(`SELECT 1 FROM preseason_events x WHERE x.id != ? AND x.status = 'accepted' AND x.date = ?
      AND ((x.court_id = ? AND x.start_time < ? AND ? < x.end_time) OR x.host_team_id IN (?, ?) OR x.visitor_team_id IN (?, ?))`,
    [e.id, e.date, e.courtId, e.endTime, e.startTime, e.hostTeamId, e.visitorTeamId, e.hostTeamId, e.visitorTeamId]);
    if (clash) throw conflict('That time is no longer free: the court or one of the teams now has another preseason event that day. Decline with a note suggesting another time.');
  }
  const status = decision === 'accept' ? 'accepted' : 'declined';
  await run("UPDATE preseason_events SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ?, updated_at = datetime('now') WHERE id = ?", [status, req.user.id, note, e.id]);
  const what = `${KIND_LABEL[e.kind].toLowerCase()}: ${e.hostTeamName} vs ${e.visitorTeamName}, ${fmtWhen(e)} at ${e.venueName} – ${e.courtName}`;
  await logActivity({ category: 'preseason', action: status, actor: req.user, programIds: [e.hostProgramId, e.visitorProgramId], details: `${status === 'accepted' ? 'Accepted' : 'Declined'} a preseason ${what}${note ? `: ${note}` : ''}`, onBehalfOf: answering });
  // The league answered for a program: tell that program's director too.
  if (isSuperAdmin(req.user)) await toPrograms([answering], `The league ${status} a preseason ${KIND_LABEL[e.kind].toLowerCase()} for you`,
    `${req.user.firstName} ${req.user.lastName} ${status} this preseason ${what} on your program’s behalf${note ? `.\nNote: ${note}` : '.'}`);
  await toPrograms([e.requestingProgramId], `Preseason ${KIND_LABEL[e.kind].toLowerCase()} ${status}`,
    `Your preseason ${what} was ${status}${note ? `.\nNote: ${note}` : '.'}${status === 'accepted' ? '\n\nIt’s now on both teams’ schedules.' : ''}`);
  if (status === 'accepted' && e.refereesWanted) {
    await notifyAssignors(`Referees wanted: preseason ${KIND_LABEL[e.kind].toLowerCase()}`,
      `${e.hostProgramName} and ${e.visitorProgramName} would like referees for a preseason ${what}.\n\nIt isn’t on the referee assignment board (preseason events are kept apart from league games), so please arrange referees with ${e.hostProgramName}’s director directly. Pay for it is arranged between the programs and the referees.`);
  }
  res.json({ ok: true, status });
}));

// ---- POST /api/preseason/events/:id/withdraw ----  The requesting program takes it back.
router.post('/events/:id/withdraw', directors, ah(async (req, res) => {
  const { e, shaped } = await loadEvent(req.params.id, req.user);
  if (!shaped.actions.includes('withdraw')) throw forbidden('Only the program that asked can withdraw it, while it’s still waiting.');
  await run("UPDATE preseason_events SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?", [e.id]);
  await logActivity({ category: 'preseason', action: 'withdrawn', actor: req.user, programIds: [e.hostProgramId, e.visitorProgramId], onBehalfOf: e.requestingProgramId,
    details: `Withdrew the preseason ${KIND_LABEL[e.kind].toLowerCase()} request: ${e.hostTeamName} vs ${e.visitorTeamName}, ${fmtWhen(e)}` });
  const other = e.requestingProgramId === e.hostProgramId ? e.visitorProgramId : e.hostProgramId;
  await toPrograms([other], `Preseason ${KIND_LABEL[e.kind].toLowerCase()} request withdrawn`, `The request for a preseason ${KIND_LABEL[e.kind].toLowerCase()} (${e.hostTeamName} vs ${e.visitorTeamName}, ${fmtWhen(e)}) was withdrawn. Nothing to do.`);
  res.json({ ok: true });
}));

// ---- POST /api/preseason/events/:id/cancel ----  { reason }  Either program, or the league.
router.post('/events/:id/cancel', directors, ah(async (req, res) => {
  const { e, shaped } = await loadEvent(req.params.id, req.user);
  if (!shaped.actions.includes('cancel')) throw forbidden('Only the two programs involved (or the league) can cancel it, before the day.');
  const reason = trimOrNull(req.body?.reason)?.slice(0, 400);
  if (!reason || reason.length < 3) throw badRequest('Give a short reason for the other program.');
  await run("UPDATE preseason_events SET status = 'cancelled', decided_by = ?, decided_at = datetime('now'), decision_note = ?, updated_at = datetime('now') WHERE id = ?", [req.user.id, reason, e.id]);
  await logActivity({ category: 'preseason', action: 'cancelled', actor: req.user, programIds: [e.hostProgramId, e.visitorProgramId],
    details: `Cancelled the preseason ${KIND_LABEL[e.kind].toLowerCase()}: ${e.hostTeamName} vs ${e.visitorTeamName}, ${fmtWhen(e)}: ${reason}` });
  const notify = isSuperAdmin(req.user) ? [e.hostProgramId, e.visitorProgramId] : [req.user.programId === e.hostProgramId ? e.visitorProgramId : e.hostProgramId];
  await toPrograms(notify, `Preseason ${KIND_LABEL[e.kind].toLowerCase()} cancelled`, `The preseason ${KIND_LABEL[e.kind].toLowerCase()} ${e.hostTeamName} vs ${e.visitorTeamName} (${fmtWhen(e)}, ${e.venueName} – ${e.courtName}) was cancelled.\nReason: ${reason}`);
  if (e.refereesWanted) await notifyAssignors(`Preseason ${KIND_LABEL[e.kind].toLowerCase()} cancelled`, `The preseason ${KIND_LABEL[e.kind].toLowerCase()} ${e.hostTeamName} vs ${e.visitorTeamName} (${fmtWhen(e)}) that wanted referees was cancelled.\nReason: ${reason}`);
  res.json({ ok: true });
}));

export default router;
