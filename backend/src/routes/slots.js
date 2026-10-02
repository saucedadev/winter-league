import { Router } from 'express';
import { assertLeagueProgram } from '../utils/guests.js';
import { one, all, run, db, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, readScope, assertCanManageProgram, resolveWriteProgram } from '../middleware/auth.js';
import { ah, badRequest, conflict, notFound } from '../utils/http.js';
import { requireFields, assertDate, assertTime, addDays, formatTime12, trimOrNull, isValidDate } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';
import { reservationText, withReservations, divisionsLabel } from '../scheduling/core.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent, requireRole('super_admin', 'program_director'));

export const CATEGORIES = {
  PRACTICE: 'Practice',
  WEEKNIGHT_GAME: 'Weeknight game',
  WEEKEND_GAME_BLOCK: 'Weekend game block',
};
const MAX_SLOTS = 250; // most slots one request can create (a full season, several days a week)
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Blackouts are a live overlay: a slot is "blacked out" whenever a
// blackout covers its date, for its whole program or its venue. Nothing
// is deleted, so removing the blackout restores the slot automatically.
const BLACKOUT_REASON = `(SELECT b.reason FROM blackout_dates b
   WHERE b.program_id = g.program_id AND (b.venue_id IS NULL OR b.venue_id = v.id)
     AND g.date BETWEEN b.start_date AND b.end_date
   ORDER BY b.venue_id IS NULL LIMIT 1)`;

const SELECT = `SELECT g.*, c.name AS court_name, v.id AS venue_id, v.name AS venue_name,
  p.name AS program_name, p.short_code, ${BLACKOUT_REASON} AS blackout_reason,
  (SELECT COUNT(*) FROM games gm JOIN schedule_runs sr ON sr.id = gm.run_id
     WHERE gm.gym_slot_id = g.id AND gm.status = 'scheduled' AND sr.status = 'published') AS game_count
  FROM gym_slots g JOIN courts c ON c.id = g.court_id JOIN venues v ON v.id = c.venue_id JOIN programs p ON p.id = g.program_id`;

function assertSlotBody(b) {
  assertDate(b.date);
  assertTime(b.startTime, 'Start time');
  assertTime(b.endTime, 'End time');
  if (b.startTime >= b.endTime) throw badRequest('End time must be after start time.');
  if (!CATEGORIES[b.category]) throw badRequest('Choose a slot type: Practice, Weeknight game, or Weekend game block.');
}

async function activeSeason() {
  const s = await one('SELECT * FROM seasons WHERE is_active = 1');
  if (!s) throw conflict('No season is active yet. A System Admin needs to set up the season before gym slots can be added.');
  return s;
}

async function courtForProgram(courtId, programId) {
  const c = await one(`SELECT c.*, v.program_id, v.name AS venue_name, v.is_active AS venue_active, v.id AS venue_id
    FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.id = ?`, [courtId]);
  if (!c || c.programId !== programId) throw badRequest('Choose a court at one of this program’s venues.');
  if (!c.venueActive) throw badRequest(`${c.venueName} is inactive. Reactivate it before adding slots.`);
  return c;
}

async function findOverlap(courtId, date, start, end, excludeId = '') {
  return one(
    `SELECT start_time, end_time, category FROM gym_slots
     WHERE court_id = ? AND date = ? AND start_time < ? AND end_time > ? AND id != ? LIMIT 1`,
    [courtId, date, end, start, excludeId]
  );
}

async function findBlackout(programId, venueId, date) {
  return one(
    `SELECT reason FROM blackout_dates WHERE program_id = ? AND (venue_id IS NULL OR venue_id = ?)
     AND ? BETWEEN start_date AND end_date LIMIT 1`, [programId, venueId, date]);
}

// Published games live in gym slots; the slot can't change underneath them.
async function assertNoPublishedGames(slotIds, what) {
  const ph = slotIds.map(() => '?').join(',');
  const r = await one(`SELECT COUNT(*) AS n FROM games g JOIN schedule_runs sr ON sr.id = g.run_id
    WHERE sr.status = 'published' AND g.status = 'scheduled' AND g.gym_slot_id IN (${ph})`, slotIds);
  if (Number(r.n) > 0) throw conflict(`Can’t ${what}: ${r.n} published game${r.n > 1 ? 's are' : ' is'} scheduled in it. Ask the league admin to move ${r.n > 1 ? 'them' : 'it'} first.`);
}

const overlapMsg = (o) => `overlaps ${formatTime12(o.startTime)}–${formatTime12(o.endTime)} (${CATEGORIES[o.category]})`;

const allDivisions = () => all('SELECT id, name, grade, gender, is_active FROM divisions ORDER BY sort_order');
// Slot rows for the browser: labels, blackout state, and what the slot is kept for.
async function shapeAll(rows) {
  const divisions = await allDivisions();
  const blocks = await blockInfo(rows);
  return withReservations(rows, divisions).map(({ reservedDivisions, reservedFor, reservedDivisionId, ...s }) => ({
    ...s, categoryLabel: CATEGORIES[s.category], isBlackedOut: !!s.blackoutReason, reservedText: reservationText(s),
    block: blockFor(blocks, s),
  }));
}

// A "block" is the set of slots added together over a date range (they share
// series_id). For each slot: how many dates the block has, its first and last
// date, its weekdays, and how many dates are on or after this one. null when
// the slot isn't in a block (or is the only one left in it).
async function blockInfo(rows) {
  const ids = [...new Set(rows.map((r) => r.seriesId).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const dates = await all(`SELECT series_id, date FROM gym_slots WHERE series_id IN (${ids.map(() => '?').join(',')}) ORDER BY date`, ids);
  for (const d of dates) { if (!map.has(d.seriesId)) map.set(d.seriesId, []); map.get(d.seriesId).push(d.date); }
  return map;
}
function blockFor(blocks, s) {
  const dates = s.seriesId ? blocks.get(s.seriesId) : null;
  if (!dates || dates.length < 2) return null;
  const weekdays = [...new Set(dates.map((d) => new Date(`${d}T12:00:00Z`).getUTCDay()))].sort((a, b) => a - b);
  return { count: dates.length, first: dates[0], last: dates.at(-1), weekdays, fromHere: dates.filter((d) => d >= s.date).length };
}
const shapeOne = async (row) => (await shapeAll([row]))[0];

// Day preferences: a game slot can be kept for any set of divisions, e.g.
// 4th–6th Grade Boys and Girls, as a preference ('prefer', the default) or a
// requirement ('only').
//   { reservedDivisionIds: [id, ...], reservedMode }   (an empty list clears it)
// Older callers may still send { reservedFor: 'girls'|'boys'|'division', reservedDivisionId }.
// Returns { reservedDivisions (JSON text or null), reservedMode }, or `current`
// when the body doesn't mention it.
const NO_RESERVATION = { reservedDivisions: null, reservedMode: null };
async function readReservation(b, category, current = NO_RESERVATION) {
  let ids = b.reservedDivisionIds;
  if (ids === undefined && b.reservedFor !== undefined) {
    const f = b.reservedFor || null;
    if (!f) ids = [];
    else if (f === 'girls' || f === 'boys') ids = (await all('SELECT id FROM divisions WHERE gender = ? AND is_active = 1', [f])).map((d) => d.id);
    else if (f === 'division') ids = b.reservedDivisionId ? [b.reservedDivisionId] : null;
    else throw badRequest('Choose the divisions this slot is kept for.');
    if (ids === null) throw badRequest('Choose the division this slot is for.');
  }
  if (ids === undefined) return category === 'PRACTICE' ? NO_RESERVATION : current;
  if (!Array.isArray(ids)) throw badRequest('Choose the divisions this slot is kept for.');
  ids = [...new Set(ids.filter(Boolean).map(String))];
  if (!ids.length) return NO_RESERVATION;
  if (category === 'PRACTICE') throw badRequest('Only game slots (weeknight games and weekend blocks) can be kept for certain divisions.');
  const found = await all(`SELECT id FROM divisions WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  if (found.length !== ids.length) throw badRequest('One of those divisions no longer exists. Reload the page and try again.');
  const mode = b.reservedMode || 'prefer';
  if (!['prefer', 'only'].includes(mode)) throw badRequest('Choose “Priority” or “Only”.');
  return { reservedDivisions: JSON.stringify(ids), reservedMode: mode };
}
// "4th–6th Grade Boys & Girls priority", for log lines.
async function resvText(r) {
  const ids = r.reservedDivisions ? JSON.parse(r.reservedDivisions) : [];
  return reservationText({ reservedDivisionIds: ids, reservedMode: r.reservedMode, reservedLabel: divisionsLabel(ids, await allDivisions()) });
}

// The weekdays in a request: [0–6, ...] (0 = Sunday), sorted, no repeats.
function readWeekdays(v, fallbackDate) {
  const list = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
  const days = [...new Set(list.map(Number))];
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw badRequest('Choose days of the week.');
  if (!days.length && fallbackDate) days.push(new Date(`${fallbackDate}T12:00:00Z`).getUTCDay());
  return days.sort((a, b) => a - b);
}
const dayNames = (days) => (days.length === 7 ? 'every day' : days.map((d) => WEEKDAY_NAMES[d]).join(', ').replace(/, ([^,]*)$/, ' and $1'));

// ---- GET /api/slots?from=&to=&programId=&venueId=&category= ----
router.get('/', ah(async (req, res) => {
  const programId = readScope(req);
  const { from, to, venueId, category } = req.query;
  if (!isValidDate(from) || !isValidDate(to)) throw badRequest('from and to are required dates (YYYY-MM-DD).');
  if (to < from) throw badRequest('to must be on or after from.');
  const where = ['g.date BETWEEN ? AND ?'];
  const args = [from, to];
  if (programId) { where.push('g.program_id = ?'); args.push(programId); }
  if (venueId) { where.push('v.id = ?'); args.push(venueId); }
  if (category && CATEGORIES[category]) { where.push('g.category = ?'); args.push(category); }
  const slots = await all(`${SELECT} WHERE ${where.join(' AND ')}
    ORDER BY g.date, g.start_time, p.name COLLATE NOCASE, v.name COLLATE NOCASE, c.sort_order`, args);
  res.json({ slots: await shapeAll(slots), categories: CATEGORIES });
}));

// ---- POST /api/slots ----
// One slot, or many over a date range:
//   { startDate, endDate?, weekdays?: [0–6, ...] }  every chosen weekday from
//     startDate through endDate (weekdays default to startDate's weekday);
//   { date, repeatWeeklyUntil? }  (older form) the same weekday each week.
// Each date is checked on its own; dates that overlap an existing slot, fall
// on a blackout (when skipBlackouts is on), or fall outside the season are
// skipped and reported back instead of failing the whole request.
router.post('/', ah(async (req, res) => {
  const b = { ...req.body };
  b.date = b.startDate || b.date;
  requireFields(b, ['courtId', 'date', 'startTime', 'endTime', 'category']);
  assertSlotBody(b);
  const programId = resolveWriteProgram(req, b.programId);
  await assertLeagueProgram(programId, 'gym slots');
  const court = await courtForProgram(b.courtId, programId);
  const season = await activeSeason();
  const skipBlackouts = b.skipBlackouts !== false;
  const resv = await readReservation(b, b.category);

  const endDate = b.endDate || b.repeatWeeklyUntil || null;
  const weekdays = readWeekdays(b.weekdays, b.date);
  const dates = [];
  if (endDate && endDate !== b.date) {
    assertDate(endDate, 'End date');
    if (endDate < b.date) throw badRequest('The end date must be on or after the start date.');
    for (let d = b.date; d <= endDate; d = addDays(d, 1)) {
      if (!weekdays.includes(new Date(`${d}T12:00:00Z`).getUTCDay())) continue;
      dates.push(d);
      if (dates.length > MAX_SLOTS) throw badRequest(`That would add more than ${MAX_SLOTS} slots at once. Choose a shorter date range or fewer days.`);
    }
    if (!dates.length) throw badRequest(`There’s no ${dayNames(weekdays)} between those dates.`);
  } else dates.push(b.date);

  const created = [];
  const skipped = [];
  for (const date of dates) {
    if (date < season.startDate || date > season.endDate) { skipped.push({ date, reason: `outside the ${season.name} season` }); continue; }
    const o = await findOverlap(court.id, date, b.startTime, b.endTime);
    if (o) { skipped.push({ date, reason: overlapMsg(o) }); continue; }
    if (skipBlackouts) {
      const bo = await findBlackout(programId, court.venueId, date);
      if (bo) { skipped.push({ date, reason: `blackout: ${bo.reason}` }); continue; }
    }
    created.push(date);
  }

  if (!created.length) {
    const first = skipped[0];
    throw conflict(dates.length === 1
      ? `Can’t add this slot — it ${first.reason.startsWith('overlaps') ? first.reason : `is ${first.reason}`}.`
      : 'None of those dates could be added.', { skipped });
  }

  const seriesId = created.length > 1 ? newId() : null;
  const ids = created.map(() => newId());
  await db.batch(created.map((date, i) => ({
    sql: `INSERT INTO gym_slots (id, program_id, season_id, court_id, date, start_time, end_time, category, notes, series_id, created_by,
            reserved_divisions, reserved_mode)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [ids[i], programId, season.id, court.id, date, b.startTime, b.endTime, b.category, trimOrNull(b.notes), seriesId, req.user.id,
      resv.reservedDivisions, resv.reservedMode],
  })), 'write');

  await logActivity({
    category: 'slot', action: 'created', actor: req.user, programId,
    details: `Added ${created.length} ${CATEGORIES[b.category].toLowerCase()} slot${created.length > 1 ? 's' : ''} at ${court.venueName} – ${court.name}, ${formatTime12(b.startTime)}–${formatTime12(b.endTime)}${created.length > 1 ? ` (${dayNames(weekdays)}, ${created[0]} to ${created.at(-1)})` : ` on ${created[0]}`}${resv.reservedDivisions ? ` (${await resvText(resv)})` : ''}`,
  });
  const slots = await all(`${SELECT} WHERE g.id IN (${ids.map(() => '?').join(',')}) ORDER BY g.date`, ids);
  res.status(201).json({ slots: await shapeAll(slots), skipped });
}));

// ---- PUT /api/slots/:id ----
// scope (in the body): 'one' (the default) changes this date only.
// 'following' / 'all' change this and later dates / every date in the slot's
// block (the slots added together over a date range). A block edit:
//   - applies only the fields that differ from the slot that was opened, so a
//     date that was changed on its own earlier keeps its other differences;
//   - can change court, start/end time, type, "Keep for", and notes (not the date);
//   - skips, and reports, any date it can't change (a published game in the
//     slot would no longer fit, or a clash with another slot on that court)
//     instead of failing. A slot can grow around its published games.
// Draft games that no longer fit a changed slot go back to "unscheduled".
const sameIds = (a, b) => JSON.stringify(JSON.parse(a || '[]').sort()) === JSON.stringify(JSON.parse(b || '[]').sort());
const sameResv = (a, b) => sameIds(a.reservedDivisions, b.reservedDivisions) && (a.reservedDivisions ? (a.reservedMode || 'prefer') === (b.reservedMode || 'prefer') : true);
// The scheduled games (draft or published) in these slots that would no
// longer fit them: a different court, a practice slot, or outside its hours.
// changes: [{ id, courtId, startTime, endTime, category }]
async function gamesThatNoLongerFit(changes, runStatus) {
  if (!changes.length) return [];
  const byId = new Map(changes.map((c) => [c.id, c]));
  const games = await all(`SELECT g.id, g.gym_slot_id, g.court_id, g.start_time, g.end_time FROM games g JOIN schedule_runs sr ON sr.id = g.run_id
    WHERE sr.status = ? AND g.status = 'scheduled' AND g.gym_slot_id IN (${changes.map(() => '?').join(',')})`, [runStatus, ...changes.map((c) => c.id)]);
  return games.filter((g) => {
    const c = byId.get(g.gymSlotId);
    return c.category === 'PRACTICE' || g.courtId !== c.courtId || g.startTime < c.startTime || g.endTime > c.endTime;
  });
}
// Draft games that no longer fit go back to "unscheduled".
const draftGamesToUnplace = async (changes) => (await gamesThatNoLongerFit(changes, 'draft')).map((g) => g.id);
const unplaceSql = (ids) => ({
  sql: `UPDATE games SET status = 'unscheduled', court_id = NULL, gym_slot_id = NULL, date = NULL, start_time = NULL, end_time = NULL,
    note = 'Its gym slot changed.', updated_at = datetime('now') WHERE id IN (${ids.map(() => '?').join(',')})`, args: ids,
});

router.put('/:id', ah(async (req, res) => {
  const s = await one('SELECT * FROM gym_slots WHERE id = ?', [req.params.id]);
  if (!s) throw notFound('Gym slot');
  assertCanManageProgram(req, s.programId);
  const b = req.body || {};
  if (b.scope !== undefined && !['one', 'following', 'all'].includes(b.scope)) throw badRequest('Choose what to change: this date, this and later dates, or the whole block.');
  const scope = s.seriesId && ['following', 'all'].includes(b.scope) ? b.scope : 'one';

  if (scope === 'one') {
    const next = {
      courtId: b.courtId || s.courtId,
      date: b.date || s.date,
      startTime: b.startTime || s.startTime,
      endTime: b.endTime || s.endTime,
      category: b.category || s.category,
    };
    assertSlotBody(next);
    await courtForProgram(next.courtId, s.programId);
    const resv = await readReservation(b, next.category, { reservedDivisions: s.reservedDivisions, reservedMode: s.reservedMode });
    const moved = next.courtId !== s.courtId || next.date !== s.date || next.startTime !== s.startTime || next.endTime !== s.endTime || next.category !== s.category;
    // Published games can't lose their slot: it can grow around them, not move away or shrink past them.
    if (moved && next.date !== s.date) await assertNoPublishedGames([s.id], 'move this slot to another date');
    else if (moved) {
      const n = (await gamesThatNoLongerFit([{ id: s.id, ...next }], 'published')).length;
      if (n) throw conflict(`Can’t change this slot: ${n} published game${n > 1 ? 's' : ''} scheduled in it would no longer fit. Ask the league admin to move ${n > 1 ? 'them' : 'it'} first.`);
    }
    const season = await one('SELECT * FROM seasons WHERE id = ?', [s.seasonId]);
    if (next.date < season.startDate || next.date > season.endDate) throw badRequest(`That date is outside the ${season.name} season (${season.startDate} to ${season.endDate}).`);
    const o = await findOverlap(next.courtId, next.date, next.startTime, next.endTime, s.id);
    if (o) throw conflict(`Can’t save — this slot ${overlapMsg(o)} on the same court.`);
    // A draft game stays only if the slot still covers it (and didn't change date).
    const unplace = moved ? (next.date !== s.date
      ? (await all(`SELECT g.id FROM games g JOIN schedule_runs sr ON sr.id = g.run_id WHERE sr.status = 'draft' AND g.status = 'scheduled' AND g.gym_slot_id = ?`, [s.id])).map((g) => g.id)
      : await draftGamesToUnplace([{ id: s.id, ...next }])) : [];
    await db.batch([
      { sql: `UPDATE gym_slots SET court_id = ?, date = ?, start_time = ?, end_time = ?, category = ?, notes = ?,
          reserved_divisions = ?, reserved_mode = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [next.courtId, next.date, next.startTime, next.endTime, next.category, b.notes !== undefined ? trimOrNull(b.notes) : s.notes,
        resv.reservedDivisions, resv.reservedMode, s.id] },
      ...(unplace.length ? [unplaceSql(unplace)] : []),
    ], 'write');
    await logActivity({ category: 'slot', action: 'edited', actor: req.user, programId: s.programId,
      details: `Edited a ${CATEGORIES[next.category].toLowerCase()} slot on ${next.date}, ${formatTime12(next.startTime)}–${formatTime12(next.endTime)}${unplace.length ? ` (${unplace.length} draft game${unplace.length === 1 ? '' : 's'} went back to unplaced)` : ''}` });
    return res.json({ slot: await shapeOne(await one(`${SELECT} WHERE g.id = ?`, [s.id])), updated: 1, skipped: [], unplacedDraftGames: unplace.length });
  }

  // ---- a block edit ----
  if (b.date && b.date !== s.date) throw badRequest('A block edit can’t change the date. To move one date, choose “This date only”.');
  // What changed, compared with the slot that was opened.
  const change = {};
  for (const k of ['courtId', 'startTime', 'endTime', 'category']) if (b[k] && b[k] !== s[k]) change[k] = b[k];
  if (change.startTime) assertTime(change.startTime, 'Start time');
  if (change.endTime) assertTime(change.endTime, 'End time');
  if (change.category && !CATEGORIES[change.category]) throw badRequest('Choose a slot type: Practice, Weeknight game, or Weekend game block.');
  if (change.courtId) await courtForProgram(change.courtId, s.programId);
  const notesChanged = b.notes !== undefined && trimOrNull(b.notes) !== (s.notes || null);
  const mine = { reservedDivisions: s.reservedDivisions, reservedMode: s.reservedMode };
  const resv = await readReservation(b, change.category || s.category, mine);
  const resvChanged = !sameResv(resv, mine);
  const labels = [change.courtId && 'court', (change.startTime || change.endTime) && 'time', change.category && 'type', resvChanged && '“Keep for”', notesChanged && 'notes'].filter(Boolean);
  if (!labels.length) throw badRequest('Nothing was changed. Change the time, court, type, “Keep for”, or notes first.');

  const targets = await all(`SELECT * FROM gym_slots WHERE series_id = ? ${scope === 'following' ? 'AND date >= ?' : ''} ORDER BY date`,
    scope === 'following' ? [s.seriesId, s.date] : [s.seriesId]);
  // Published games that the changed slot would no longer cover, per slot.
  const published = new Map();
  for (const g of await gamesThatNoLongerFit(targets.map((t) => ({ id: t.id, courtId: change.courtId ?? t.courtId, startTime: change.startTime ?? t.startTime,
    endTime: change.endTime ?? t.endTime, category: change.category ?? t.category })), 'published')) published.set(g.gymSlotId, (published.get(g.gymSlotId) || 0) + 1);

  const stmts = [];
  const changed = [];
  const skipped = [];
  for (const t of targets) {
    const next = { id: t.id, courtId: change.courtId ?? t.courtId, startTime: change.startTime ?? t.startTime, endTime: change.endTime ?? t.endTime, category: change.category ?? t.category };
    if (next.startTime >= next.endTime) { skipped.push({ date: t.date, reason: `its end time (${formatTime12(next.endTime)}) would not be after its start time (${formatTime12(next.startTime)})` }); continue; }
    const structural = next.courtId !== t.courtId || next.startTime !== t.startTime || next.endTime !== t.endTime || next.category !== t.category;
    if (structural) {
      const n = published.get(t.id);
      if (n) { skipped.push({ date: t.date, reason: `${n} published game${n > 1 ? 's' : ''} scheduled in it would no longer fit` }); continue; }
      const o = await findOverlap(next.courtId, t.date, next.startTime, next.endTime, t.id);
      if (o) { skipped.push({ date: t.date, reason: overlapMsg(o) }); continue; }
    }
    // "Keep for": the new value if it changed, else this date's own; practice slots have none.
    const r = next.category === 'PRACTICE' ? NO_RESERVATION : resvChanged ? resv : { reservedDivisions: t.reservedDivisions, reservedMode: t.reservedMode };
    const notes = notesChanged ? trimOrNull(b.notes) : t.notes;
    if (!structural && sameResv(r, { reservedDivisions: t.reservedDivisions, reservedMode: t.reservedMode }) && (notes || null) === (t.notes || null)) continue; // already like that
    stmts.push({ sql: `UPDATE gym_slots SET court_id = ?, start_time = ?, end_time = ?, category = ?, notes = ?, reserved_divisions = ?, reserved_mode = ?,
        updated_at = datetime('now') WHERE id = ?`, args: [next.courtId, next.startTime, next.endTime, next.category, notes, r.reservedDivisions, r.reservedMode, t.id] });
    changed.push({ ...next, date: t.date, structural });
  }
  const unplace = await draftGamesToUnplace(changed.filter((c) => c.structural));
  if (unplace.length) stmts.push(unplaceSql(unplace));
  if (stmts.length) await db.batch(stmts, 'write');
  if (changed.length) {
    await logActivity({ category: 'slot', action: 'edited', actor: req.user, programId: s.programId,
      details: `Changed the ${labels.join(', ')} of ${changed.length} gym slot${changed.length === 1 ? '' : 's'} in a block (${changed[0].date} to ${changed.at(-1).date})${skipped.length ? `; ${skipped.length} date${skipped.length === 1 ? '' : 's'} skipped` : ''}${unplace.length ? `; ${unplace.length} draft game${unplace.length === 1 ? '' : 's'} went back to unplaced` : ''}` });
  }
  res.json({ slot: await shapeOne(await one(`${SELECT} WHERE g.id = ?`, [s.id])), updated: changed.length, skipped, unplacedDraftGames: unplace.length });
}));

// ---- POST /api/slots/tag ----
// Tag (or clear) many game slots at once, e.g. every Monday and Wednesday game
// slot at a venue for the rest of the season:
//   { programId, weekdays: [0–6, ...] (0 = Sunday), venueId?, from?, to?,
//     reservedDivisionIds: [...] (empty clears), reservedMode? }
// (weekday: n is still accepted for one day.)
router.post('/tag', ah(async (req, res) => {
  const b = req.body || {};
  const programId = resolveWriteProgram(req, b.programId);
  const season = await activeSeason();
  const weekdays = readWeekdays(b.weekdays ?? b.weekday);
  if (!weekdays.length) throw badRequest('Choose at least one day of the week.');
  const from = b.from || season.startDate;
  const to = b.to || season.endDate;
  assertDate(from, 'From'); assertDate(to, 'To');
  const resv = await readReservation(b, 'WEEKNIGHT_GAME', null);
  if (!resv) throw badRequest('Choose the divisions to keep these slots for, or none to clear the tags.');
  const where = [`g.program_id = ?`, `g.season_id = ?`, `g.category IN ('WEEKNIGHT_GAME', 'WEEKEND_GAME_BLOCK')`, `g.date BETWEEN ? AND ?`,
    `CAST(strftime('%w', g.date) AS INTEGER) IN (${weekdays.map(() => '?').join(',')})`];
  const args = [programId, season.id, from, to, ...weekdays];
  if (b.venueId) { where.push('g.court_id IN (SELECT id FROM courts WHERE venue_id = ?)'); args.push(b.venueId); }
  const r = await run(`UPDATE gym_slots SET reserved_divisions = ?, reserved_mode = ?, updated_at = datetime('now')
    WHERE id IN (SELECT g.id FROM gym_slots g WHERE ${where.join(' AND ')})`, [resv.reservedDivisions, resv.reservedMode, ...args]);
  const n = r.rowsAffected;
  const days = dayNames(weekdays);
  await logActivity({ category: 'slot', action: 'tagged', actor: req.user, programId,
    details: resv.reservedDivisions ? `Marked ${n} game slot${n === 1 ? '' : 's'} on ${days} as ${await resvText(resv)}` : `Cleared the tag on ${n} game slot${n === 1 ? '' : 's'} on ${days}` });
  res.json({ updated: n });
}));

// ---- DELETE /api/slots/:id?scope=one|following ----
// scope=following removes this slot and every later slot from the same
// weekly repeat.
router.delete('/:id', ah(async (req, res) => {
  const s = await one('SELECT * FROM gym_slots WHERE id = ?', [req.params.id]);
  if (!s) throw notFound('Gym slot');
  assertCanManageProgram(req, s.programId);
  const following = req.query.scope === 'following' && s.seriesId;
  const ids = following
    ? (await all('SELECT id FROM gym_slots WHERE series_id = ? AND date >= ?', [s.seriesId, s.date])).map((x) => x.id)
    : [s.id];
  await assertNoPublishedGames(ids, following ? 'delete these slots' : 'delete this slot');
  const ph = ids.map(() => '?').join(',');
  // Draft games in these slots go back to "unscheduled" for the admin to re-place.
  const [, r] = await db.batch([
    { sql: `UPDATE games SET status = 'unscheduled', court_id = NULL, gym_slot_id = NULL, date = NULL, start_time = NULL, end_time = NULL,
            note = 'Its gym slot was deleted.', updated_at = datetime('now') WHERE gym_slot_id IN (${ph})`, args: ids },
    { sql: `DELETE FROM gym_slots WHERE id IN (${ph})`, args: ids },
  ], 'write');
  await logActivity({ category: 'slot', action: 'deleted', actor: req.user, programId: s.programId,
    details: following ? `Deleted ${r.rowsAffected} repeating slots from ${s.date} onward` : `Deleted a ${CATEGORIES[s.category].toLowerCase()} slot on ${s.date}` });
  res.json({ deleted: r.rowsAffected });
}));

export default router;
