import { Router } from 'express';
import { one, all, run, db, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, readScope, assertCanManageProgram, resolveWriteProgram } from '../middleware/auth.js';
import { ah, badRequest, conflict, notFound } from '../utils/http.js';
import { requireFields, assertDate, assertTime, addDays, formatTime12, trimOrNull, isValidDate } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent, requireRole('super_admin', 'program_director'));

export const CATEGORIES = {
  PRACTICE: 'Practice',
  WEEKNIGHT_GAME: 'Weeknight game',
  WEEKEND_GAME_BLOCK: 'Weekend game block',
};
const MAX_REPEATS = 30;

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

function shape(s) {
  return { ...s, categoryLabel: CATEGORIES[s.category], isBlackedOut: !!s.blackoutReason };
}

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
  res.json({ slots: slots.map(shape), categories: CATEGORIES });
}));

// ---- POST /api/slots ----
// Optional weekly repeat: repeatWeeklyUntil = 'YYYY-MM-DD'. Each date is
// checked on its own; dates that overlap an existing slot, fall on a
// blackout (when skipBlackouts is on), or fall outside the season are
// skipped and reported back instead of failing the whole request.
router.post('/', ah(async (req, res) => {
  requireFields(req.body, ['courtId', 'date', 'startTime', 'endTime', 'category']);
  const b = req.body;
  assertSlotBody(b);
  const programId = resolveWriteProgram(req, b.programId);
  const court = await courtForProgram(b.courtId, programId);
  const season = await activeSeason();
  const skipBlackouts = b.skipBlackouts !== false;

  const dates = [b.date];
  if (b.repeatWeeklyUntil) {
    assertDate(b.repeatWeeklyUntil, 'Repeat-until date');
    if (b.repeatWeeklyUntil <= b.date) throw badRequest('Repeat-until date must be after the first date.');
    for (let d = addDays(b.date, 7); d <= b.repeatWeeklyUntil; d = addDays(d, 7)) {
      dates.push(d);
      if (dates.length > MAX_REPEATS) throw badRequest(`A weekly repeat can create at most ${MAX_REPEATS} slots at a time.`);
    }
  }

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
    sql: `INSERT INTO gym_slots (id, program_id, season_id, court_id, date, start_time, end_time, category, notes, series_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [ids[i], programId, season.id, court.id, date, b.startTime, b.endTime, b.category, trimOrNull(b.notes), seriesId, req.user.id],
  })), 'write');

  await logActivity({
    category: 'slot', action: 'created', actor: req.user, programId,
    details: `Added ${created.length} ${CATEGORIES[b.category].toLowerCase()} slot${created.length > 1 ? 's' : ''} at ${court.venueName} – ${court.name}, ${formatTime12(b.startTime)}–${formatTime12(b.endTime)}${created.length > 1 ? ` (weekly, ${created[0]} to ${created.at(-1)})` : ` on ${created[0]}`}`,
  });
  const slots = await all(`${SELECT} WHERE g.id IN (${ids.map(() => '?').join(',')}) ORDER BY g.date`, ids);
  res.status(201).json({ slots: slots.map(shape), skipped });
}));

// ---- PUT /api/slots/:id ----
router.put('/:id', ah(async (req, res) => {
  const s = await one('SELECT * FROM gym_slots WHERE id = ?', [req.params.id]);
  if (!s) throw notFound('Gym slot');
  assertCanManageProgram(req, s.programId);
  const next = {
    courtId: req.body.courtId || s.courtId,
    date: req.body.date || s.date,
    startTime: req.body.startTime || s.startTime,
    endTime: req.body.endTime || s.endTime,
    category: req.body.category || s.category,
  };
  assertSlotBody(next);
  await courtForProgram(next.courtId, s.programId);
  const moved = next.courtId !== s.courtId || next.date !== s.date || next.startTime !== s.startTime || next.endTime !== s.endTime || next.category !== s.category;
  if (moved) await assertNoPublishedGames([s.id], 'change this slot');
  const season = await one('SELECT * FROM seasons WHERE id = ?', [s.seasonId]);
  if (next.date < season.startDate || next.date > season.endDate) throw badRequest(`That date is outside the ${season.name} season (${season.startDate} to ${season.endDate}).`);
  const o = await findOverlap(next.courtId, next.date, next.startTime, next.endTime, s.id);
  if (o) throw conflict(`Can’t save — this slot ${overlapMsg(o)} on the same court.`);

  await run(`UPDATE gym_slots SET court_id = ?, date = ?, start_time = ?, end_time = ?, category = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
    [next.courtId, next.date, next.startTime, next.endTime, next.category, req.body.notes !== undefined ? trimOrNull(req.body.notes) : s.notes, s.id]);
  await logActivity({ category: 'slot', action: 'edited', actor: req.user, programId: s.programId,
    details: `Edited a ${CATEGORIES[next.category].toLowerCase()} slot on ${next.date}, ${formatTime12(next.startTime)}–${formatTime12(next.endTime)}` });
  res.json({ slot: shape(await one(`${SELECT} WHERE g.id = ?`, [s.id])) });
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
