// Rule requests (migration 014): a Program Director tells the league what
// their program needs from the Matchmaker rules, and the System Admin
// answers it in the app, so there's a record of what was asked and decided.
//
//   Director:      file a request, reply to a question, withdraw.
//   System Admin:  ask a question, accept (optionally applying a travel cap
//                  or rematch limit to the rules in one click), mark as
//                  noted, decline, and re-confirm each season.
//
// Only that program's directors and the league see a request. A request
// stays in effect (accepted / noted) until the program withdraws it or the
// league declines it.
import { Router } from 'express';
import { one, all, run, db, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, isSuperAdmin, readScope, resolveWriteProgram } from '../middleware/auth.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { logActivity } from '../utils/activityLog.js';
import { assertLeagueProgram } from '../utils/guests.js';
import { getRules, saveRules, divisionNameMap, programNameMap } from '../scheduling/data.js';
import { normalizeRules, travelCapFor, hasTravelOverride, rulesForDivision, hasOverride, MAX_VS_SAME_OPPONENT_LIMIT } from '../scheduling/core.js';
import { notifyUsers } from '../referees/data.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent, requireRole('super_admin', 'program_director'));

export const KINDS = {
  travel_cap: 'Travel cap for my program',
  rematch_limit: 'Rematch limit for a division',
  league_rule: 'A league rule',
  other: 'Something else',
};
export const STATUS_LABELS = { open: 'Waiting for the league', question: 'Question for the program', accepted: 'Accepted', noted: 'Noted', declined: 'Declined', withdrawn: 'Withdrawn' };
const OPEN = ['open', 'question'];
const IN_EFFECT = ['accepted', 'noted'];
const APPLIES = ['travel_cap', 'rematch_limit']; // kinds the app can put into the rules itself
const ACTION = { label: 'Open rule requests', url: '/requests?tab=rules' };

const activeSeason = () => one('SELECT * FROM seasons WHERE is_active = 1');
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const limitText = (v) => (v == null || v === 'none' ? 'no limit' : `${v} game${Number(v) === 1 ? '' : 's'}`);

// Check and tidy the requested value for a kind. Returns the stored text (or null).
function readValue(kind, raw) {
  if (kind === 'travel_cap') {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw badRequest('Enter the travel cap in whole miles, from 1 to 500.');
    return String(n);
  }
  if (kind === 'rematch_limit') {
    if (raw === null || raw === '' || raw === 'none') return 'none';
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_VS_SAME_OPPONENT_LIMIT) throw badRequest(`Choose 1 to ${MAX_VS_SAME_OPPONENT_LIMIT} games against the same opponent, or no limit.`);
    return String(n);
  }
  return clip(raw, 100) || null;
}

// "A 15-mile travel cap for Northfield Hawks"
function summarize(r) {
  if (r.kind === 'travel_cap') return `A ${r.requestedValue}-mile travel cap for ${r.programName}`;
  if (r.kind === 'rematch_limit') return `${r.divisionName || 'A division'}: ${limitText(r.requestedValue)} against the same opponent`;
  if (r.kind === 'league_rule') return `League rule${r.requestedValue ? `: ${r.requestedValue}` : ''}`;
  return r.requestedValue || 'Something else';
}

const SELECT = `SELECT r.*, p.name AS program_name, d.name AS division_name,
    ru.first_name || ' ' || ru.last_name AS requested_by_name, du.first_name || ' ' || du.last_name AS decided_by_name,
    cs.name AS confirmed_season_name
  FROM rule_requests r JOIN programs p ON p.id = r.program_id
  LEFT JOIN divisions d ON d.id = r.division_id
  LEFT JOIN users ru ON ru.id = r.requested_by LEFT JOIN users du ON du.id = r.decided_by
  LEFT JOIN seasons cs ON cs.id = r.confirmed_season_id`;

// What each signed-in user can do with a request.
function actionsFor(r, user, needsConfirm) {
  const a = [];
  if (isSuperAdmin(user)) {
    if (OPEN.includes(r.status)) a.push('ask', 'accept', 'decline', ...(APPLIES.includes(r.kind) ? [] : ['note']));
    if (IN_EFFECT.includes(r.status)) { a.push('end'); if (needsConfirm) a.push('confirm'); }
  } else if (user.programId === r.programId) {
    if (OPEN.includes(r.status)) a.push('reply');
    if (OPEN.includes(r.status) || IN_EFFECT.includes(r.status)) a.push('withdraw');
  }
  return a;
}

async function shape(rows, user) {
  if (!rows.length) return [];
  const [rules, season] = await Promise.all([getRules(), activeSeason()]);
  const ph = rows.map(() => '?').join(',');
  const msgs = await all(`SELECT m.*, u.first_name || ' ' || u.last_name AS author_name, u.role AS author_role
    FROM rule_request_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.request_id IN (${ph}) ORDER BY m.created_at, m.rowid`, rows.map((r) => r.id));
  return rows.map((r) => {
    // What the rules say right now for this request's program / division.
    let current = null;
    if (r.kind === 'travel_cap') current = { value: travelCapFor(rules, r.programId), own: hasTravelOverride(rules, r.programId), league: rules.maxTravelMiles };
    if (r.kind === 'rematch_limit' && r.divisionId) current = { value: rulesForDivision(rules, r.divisionId).maxVsSameOpponent, own: hasOverride(rules, r.divisionId, 'maxVsSameOpponent'), league: rules.maxVsSameOpponent };
    const needsConfirm = IN_EFFECT.includes(r.status) && !!season && r.confirmedSeasonId !== season.id;
    return {
      ...r, kindLabel: KINDS[r.kind], statusLabel: STATUS_LABELS[r.status], summary: summarize(r), current, needsConfirm,
      canApply: APPLIES.includes(r.kind),
      messages: msgs.filter((m) => m.requestId === r.id).map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt, authorName: m.authorName || 'Someone', fromLeague: m.authorRole === 'super_admin' })),
      actions: actionsFor(r, user, needsConfirm),
    };
  });
}
const shapeOne = async (id, user) => (await shape([await one(`${SELECT} WHERE r.id = ?`, [id])], user))[0];

async function loadFor(req) {
  const r = await one(`${SELECT} WHERE r.id = ?`, [req.params.id]);
  if (!r) throw notFound('Rule request');
  if (!isSuperAdmin(req.user) && req.user.programId !== r.programId) throw notFound('Rule request'); // other programs' requests are private
  return r;
}
const adminOnly = (req) => { if (!isSuperAdmin(req.user)) throw forbidden('Only the league administrator can do that.'); };
const who = (u) => `${u.firstName} ${u.lastName}`;
const toAdmins = (subject, text) => notifyUsers("role = 'super_admin'", [], subject, text, ACTION);
const toProgram = (programId, subject, text) => notifyUsers("role = 'program_director' AND program_id = ?", [programId], subject, text, ACTION);

// ---- GET /api/rule-requests?state=open|effect|closed&programId= ----
router.get('/', ah(async (req, res) => {
  const programId = readScope(req);
  const state = ['open', 'effect', 'closed'].includes(req.query.state) ? req.query.state : 'open';
  const statuses = { open: OPEN, effect: IN_EFFECT, closed: ['declined', 'withdrawn'] }[state];
  const where = [`r.status IN (${statuses.map(() => '?').join(',')})`];
  const args = [...statuses];
  if (programId) { where.push('r.program_id = ?'); args.push(programId); }
  const rows = await all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY r.updated_at DESC`, args);
  const rules = await getRules();
  res.json({ requests: await shape(rows, req.user), kinds: KINDS, league: { maxTravelMiles: rules.maxTravelMiles, maxVsSameOpponent: rules.maxVsSameOpponent } });
}));

// ---- GET /api/rule-requests/count ----  (nav badge, Schedule builder)
// Admin: requests waiting for an answer, and ones in effect that need
// re-confirming this season. Director: questions waiting for their reply.
router.get('/count', ah(async (req, res) => {
  if (isSuperAdmin(req.user)) {
    const season = await activeSeason();
    const open = Number((await one("SELECT COUNT(*) AS n FROM rule_requests WHERE status = 'open'")).n);
    const toConfirm = season ? Number((await one(`SELECT COUNT(*) AS n FROM rule_requests WHERE status IN ('accepted', 'noted')
      AND (confirmed_season_id IS NULL OR confirmed_season_id != ?)`, [season.id])).n) : 0;
    return res.json({ needsAction: open, open, toConfirm });
  }
  const n = Number((await one("SELECT COUNT(*) AS n FROM rule_requests WHERE status = 'question' AND program_id = ?", [req.user.programId || ''])).n);
  res.json({ needsAction: n, open: n, toConfirm: 0 });
}));

// ---- POST /api/rule-requests ----
// A director files one for their program. A System Admin can record one on a
// program's behalf (e.g. it came in by phone) by sending programId.
router.post('/', ah(async (req, res) => {
  const b = req.body || {};
  const programId = resolveWriteProgram(req, b.programId);
  await assertLeagueProgram(programId, 'rule requests', 'Guest programs aren’t scheduled by the matchmaker.');
  if (!KINDS[b.kind]) throw badRequest('Choose what the request is about.');
  const details = clip(b.details, 1000);
  if (details.length < 5) throw badRequest('Say why, in a sentence or two, so the league can decide.');
  let divisionId = null;
  if (b.kind === 'rematch_limit') {
    divisionId = b.divisionId || null;
    if (!divisionId || !(await one('SELECT 1 FROM divisions WHERE id = ?', [divisionId]))) throw badRequest('Choose the division.');
  }
  const value = readValue(b.kind, b.requestedValue);
  if (b.kind === 'travel_cap') {
    const rules = await getRules();
    if (Number(value) >= rules.maxTravelMiles) throw badRequest(`A program’s own travel cap has to be lower than the league’s ${rules.maxTravelMiles} miles. To ask for a higher league cap, choose “A league rule”.`);
  }
  if (b.kind === 'other' && !value) throw badRequest('Give the request a short title, e.g. “No games before 10 AM on Saturdays”.');
  const dup = await one(`SELECT 1 FROM rule_requests WHERE program_id = ? AND kind = ? AND IFNULL(division_id, '') = ? AND status IN ('open', 'question')
    AND kind IN ('travel_cap', 'rematch_limit')`, [programId, b.kind, divisionId || '']);
  if (dup) throw conflict('There’s already an open request for that. Reply to it or withdraw it first.');
  const season = await activeSeason();
  const id = newId();
  await run(`INSERT INTO rule_requests (id, program_id, season_id, kind, division_id, requested_value, details, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, programId, season?.id || null, b.kind, divisionId, value, details, req.user.id]);
  const r = await shapeOne(id, req.user);
  await logActivity({ category: 'request', action: 'rule request', actor: req.user, programId, details: `Rule request: ${r.summary}. “${details.slice(0, 200)}”` });
  if (!isSuperAdmin(req.user)) await toAdmins(`Rule request from ${r.programName}`, `${who(req.user)} (${r.programName}) asked for:\n${r.summary}\nReason: ${details}`);
  res.status(201).json({ request: r });
}));

// ---- POST /api/rule-requests/:id/messages { body, ask? } ----
// The league asks a question (ask: true puts the request on hold for the
// program's reply); the director replies, which hands it back to the league.
router.post('/:id/messages', ah(async (req, res) => {
  const r = await loadFor(req);
  if (!OPEN.includes(r.status)) throw conflict('That request has already been answered.');
  const body = clip(req.body?.body, 1000);
  if (body.length < 2) throw badRequest('Type your message.');
  const admin = isSuperAdmin(req.user);
  const status = admin ? (req.body?.ask === false ? r.status : 'question') : 'open';
  await db.batch([
    { sql: 'INSERT INTO rule_request_messages (id, request_id, author_id, body) VALUES (?, ?, ?, ?)', args: [newId(), r.id, req.user.id, body] },
    { sql: "UPDATE rule_requests SET status = ?, updated_at = datetime('now') WHERE id = ?", args: [status, r.id] },
  ], 'write');
  await logActivity({ category: 'request', action: 'rule request', actor: req.user, programId: r.programId, details: `${admin ? 'Asked about' : 'Replied on'} the rule request “${summarize(r)}”: “${body.slice(0, 200)}”` });
  if (admin) await toProgram(r.programId, 'The league has a question about your rule request', `About your request:\n${summarize(r)}\n\n${who(req.user)} asks:\n“${body}”`);
  else await toAdmins(`${r.programName} replied on a rule request`, `About the request:\n${summarize(r)}\n\n${who(req.user)} replied:\n“${body}”`);
  res.json({ request: await shapeOne(r.id, req.user) });
}));

// Put an accepted travel cap / rematch limit into the saved rules.
async function applyToRules(r, value) {
  const rules = await getRules();
  const next = { ...rules, divisionOverrides: { ...rules.divisionOverrides }, programOverrides: { ...rules.programOverrides } };
  if (r.kind === 'travel_cap') next.programOverrides[r.programId] = { ...next.programOverrides[r.programId], maxTravelMiles: Number(value) };
  else next.divisionOverrides[r.divisionId] = { ...next.divisionOverrides[r.divisionId], maxVsSameOpponent: value === 'none' ? null : Number(value) };
  const [divisionNames, programNames] = await Promise.all([divisionNameMap(), programNameMap()]);
  let clean;
  try { clean = normalizeRules(next, { divisionNames, programNames }); } catch (e) { throw badRequest(e.message); }
  await saveRules(clean);
}

// ---- POST /api/rule-requests/:id/decide { decision: accept|note|decline, note?, apply?, value? } ----
router.post('/:id/decide', ah(async (req, res) => {
  adminOnly(req);
  const r = await loadFor(req);
  const b = req.body || {};
  const ending = IN_EFFECT.includes(r.status);
  if (!OPEN.includes(r.status) && !ending) throw conflict('That request is already closed.');
  if (!['accept', 'note', 'decline'].includes(b.decision)) throw badRequest('Choose accept, noted, or decline.');
  if (ending && b.decision !== 'decline') throw conflict('That request is already in effect. You can end it, with a note.');
  const note = clip(b.note, 600);
  if (b.decision === 'decline' && note.length < 3) throw badRequest(ending ? 'Say why this no longer applies, for the program.' : 'Add a note for the program saying why.');
  if (b.decision === 'note' && APPLIES.includes(r.kind)) throw badRequest('Accept or decline this one: it’s a setting the rules have.');

  let applied = null;
  if (b.decision === 'accept' && b.apply) {
    if (!APPLIES.includes(r.kind)) throw badRequest('Only a travel cap or a rematch limit can be applied to the rules from here.');
    if (r.kind === 'rematch_limit' && !r.divisionId) throw conflict('That division no longer exists.');
    applied = readValue(r.kind, b.value ?? r.requestedValue);
    await applyToRules(r, applied);
  }
  const status = { accept: 'accepted', note: 'noted', decline: 'declined' }[b.decision];
  const season = await activeSeason();
  await run(`UPDATE rule_requests SET status = ?, decision_note = ?, applied_value = COALESCE(?, applied_value), decided_by = ?, decided_at = datetime('now'),
      confirmed_season_id = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, note || null, applied, req.user.id, status === 'declined' ? r.confirmedSeasonId : season?.id || null, r.id]);
  const summary = summarize(r);
  const appliedText = applied ? ` and applied to the rules (${r.kind === 'travel_cap' ? `${applied} miles` : limitText(applied)})` : '';
  await logActivity({ category: 'request', action: 'rule request', actor: req.user, programId: r.programId,
    details: `${ending ? 'Ended' : { accept: 'Accepted', note: 'Noted', decline: 'Declined' }[b.decision]} the rule request “${summary}”${appliedText}${note ? `: ${note}` : ''}` });
  if (applied) {
    await logActivity({ category: 'schedule', action: 'rules', actor: req.user,
      details: r.kind === 'travel_cap' ? `Set ${r.programName}’s travel cap to ${applied} miles (from a rule request)` : `Set ${r.divisionName}’s limit against the same opponent to ${limitText(applied)} (from a rule request)` });
  }
  const verb = ending ? 'ended' : { accept: 'accepted', note: 'noted', decline: 'declined' }[b.decision];
  await toProgram(r.programId, `Your rule request was ${verb}`,
    `The league ${verb} this request:\n${summary}${applied ? `\nIn the rules now: ${r.kind === 'travel_cap' ? `${applied} miles` : limitText(applied)}` : ''}${note ? `\nNote: ${note}` : ''}${
      b.decision === 'accept' && !applied ? '\n\nThe league will set it up in the Matchmaker rules.' : b.decision === 'note' ? '\n\nThe matchmaker can’t do this by itself yet, so the league will keep it in mind when reviewing the schedule.' : ''}`);
  res.json({ request: await shapeOne(r.id, req.user), applied: !!applied });
}));

// ---- POST /api/rule-requests/:id/confirm ----  (still applies this season)
router.post('/:id/confirm', ah(async (req, res) => {
  adminOnly(req);
  const r = await loadFor(req);
  if (!IN_EFFECT.includes(r.status)) throw conflict('Only a request that’s in effect can be confirmed.');
  const season = await activeSeason();
  if (!season) throw conflict('No season is active.');
  await run("UPDATE rule_requests SET confirmed_season_id = ?, updated_at = datetime('now') WHERE id = ?", [season.id, r.id]);
  await logActivity({ category: 'request', action: 'rule request', actor: req.user, programId: r.programId, details: `Confirmed the rule request “${summarize(r)}” still applies for ${season.name}` });
  res.json({ request: await shapeOne(r.id, req.user) });
}));

// ---- POST /api/rule-requests/:id/withdraw ----  (the program no longer needs it)
router.post('/:id/withdraw', ah(async (req, res) => {
  const r = await loadFor(req);
  if (isSuperAdmin(req.user)) throw forbidden('The program withdraws its own requests. To close one, decline or end it with a note.');
  if (!OPEN.includes(r.status) && !IN_EFFECT.includes(r.status)) throw conflict('That request is already closed.');
  await run("UPDATE rule_requests SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?", [r.id]);
  const summary = summarize(r);
  // An override the app applied stays in the rules until the league removes it.
  const stillSet = r.appliedValue ? ' Its value is still in the Matchmaker rules: remove the override in the Schedule builder if it’s no longer wanted.' : '';
  await logActivity({ category: 'request', action: 'rule request', actor: req.user, programId: r.programId, details: `Withdrew the rule request “${summary}”` });
  await toAdmins(`${r.programName} withdrew a rule request`, `${who(req.user)} withdrew this request:\n${summary}${stillSet ? `\n\n${stillSet.trim()}` : ''}`);
  res.json({ request: await shapeOne(r.id, req.user), overrideStillSet: !!r.appliedValue });
}));

export default router;
