// Pure scheduling helpers — no database access. Shared by the matchmaker,
// the admin's manual edits, and change requests so every path enforces
// exactly the same rules.

export const DEFAULT_RULES = Object.freeze({
  gamesPerTeam: 8,        // target regular-season games for every team
  gameMinutes: 60,        // each game slot is carved into back-to-back games of this length
  maxTravelMiles: 30,     // straight-line cap between the game venue and the away program's home
  minDaysBetween: 2,      // a team's games must be at least this many days apart (1 = not same day)
  maxGamesPerWeek: 2,     // per team, Monday–Sunday
  allowSameProgram: false, // may two teams from the same program play each other?
  maxVsSameOpponent: 2,   // most games between the same two teams (1–6), or null = no limit
  // Per-division exceptions to the league rules: { [divisionId]: { maxVsSameOpponent } }.
  // A division without an entry uses the league value. Only the rules listed in
  // DIVISION_OVERRIDE_KEYS can be overridden (more can be added later).
  divisionOverrides: Object.freeze({}),
  // Per-program exceptions: { [programId]: { maxTravelMiles } }. A program's
  // own travel cap applies whenever ITS teams travel (they're the away team),
  // and may only be LOWER than the league cap: a higher one would push longer
  // trips onto opponents who didn't agree to them.
  programOverrides: Object.freeze({}),
});
export const MAX_VS_SAME_OPPONENT_LIMIT = 6;
export const DIVISION_OVERRIDE_KEYS = ['maxVsSameOpponent'];
export const PROGRAM_OVERRIDE_KEYS = ['maxTravelMiles'];

// How far a program's teams may travel: its own cap if it has one, else the
// league's (never more than the league's).
export function travelCapFor(rules, programId) {
  const own = rules?.programOverrides?.[programId]?.maxTravelMiles;
  return own != null ? Math.min(own, rules.maxTravelMiles) : rules.maxTravelMiles;
}
export const hasTravelOverride = (rules, programId) => rules?.programOverrides?.[programId]?.maxTravelMiles != null;

// The rematch limit: 1–6, or "no limit" (null, '', or 'none'). Returns
// { value } or { error }.
function parseRematchLimit(v, label) {
  if (v === null || v === '' || v === 'none') return { value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VS_SAME_OPPONENT_LIMIT) return { error: `${label} must be 1 to ${MAX_VS_SAME_OPPONENT_LIMIT}, or no limit.` };
  return { value: n };
}

// The rules one division plays under: the league rules with that division's
// overrides applied.
export function rulesForDivision(rules, divisionId) {
  const o = rules?.divisionOverrides?.[divisionId];
  if (!o) return rules;
  const out = { ...rules };
  for (const k of DIVISION_OVERRIDE_KEYS) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
  return out;
}

// True when a division has its own value for this rule.
export const hasOverride = (rules, divisionId, key) =>
  !!rules?.divisionOverrides?.[divisionId] && Object.prototype.hasOwnProperty.call(rules.divisionOverrides[divisionId], key);

const RULE_LIMITS = {
  gamesPerTeam: [1, 40, 'Games per team'],
  gameMinutes: [30, 180, 'Game length (minutes)'],
  maxTravelMiles: [1, 500, 'Travel cap (miles)'],
  minDaysBetween: [1, 7, 'Days between a team’s games'],
  maxGamesPerWeek: [1, 7, 'Games per team per week'],
};

// Returns clean rules or throws a message listing what's wrong.
// divisionNames (optional): { id: name } of the divisions that exist. When
// given, an override for a division not in it is an error, and messages use
// division names.
export function normalizeRules(input = {}, { divisionNames, programNames } = {}) {
  const out = { ...DEFAULT_RULES, divisionOverrides: {}, programOverrides: {} };
  const errors = [];
  for (const [key, [min, max, label]] of Object.entries(RULE_LIMITS)) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    const n = Number(input[key]);
    if (!Number.isInteger(n) || n < min || n > max) errors.push(`${label} must be a whole number from ${min} to ${max}.`);
    else out[key] = n;
  }
  // Same-program games: a real on/off switch (anything else is an error).
  if (input.allowSameProgram !== undefined && input.allowSameProgram !== null) {
    if (typeof input.allowSameProgram !== 'boolean') errors.push('“Teams from the same program can play each other” must be on or off.');
    else out.allowSameProgram = input.allowSameProgram;
  }
  // Rematch limit: 1–6, or "no limit" (null, '', or 'none').
  if (input.maxVsSameOpponent !== undefined) {
    const r = parseRematchLimit(input.maxVsSameOpponent, '“Most games against the same opponent”');
    if (r.error) errors.push(r.error); else out.maxVsSameOpponent = r.value;
  }
  // Division overrides.
  const ov = input.divisionOverrides;
  if (ov !== undefined && ov !== null) {
    if (typeof ov !== 'object' || Array.isArray(ov)) errors.push('Division overrides must be a list of divisions and their values.');
    else {
      for (const [divisionId, values] of Object.entries(ov)) {
        const name = divisionNames?.[divisionId];
        if (divisionNames && !name) { errors.push('A division override is for a division that doesn’t exist. Remove it and try again.'); continue; }
        if (!values || typeof values !== 'object' || Array.isArray(values)) { errors.push(`The override for ${name || 'a division'} is not valid.`); continue; }
        const unknown = Object.keys(values).filter((k) => !DIVISION_OVERRIDE_KEYS.includes(k));
        if (unknown.length) { errors.push(`${name || 'A division'}: only “Most games against the same opponent” can be set per division.`); continue; }
        const clean = {};
        if (values.maxVsSameOpponent !== undefined) {
          const r = parseRematchLimit(values.maxVsSameOpponent, `${name || 'A division'}’s “Most games against the same opponent”`);
          if (r.error) errors.push(r.error); else clean.maxVsSameOpponent = r.value;
        }
        if (Object.keys(clean).length) out.divisionOverrides[divisionId] = clean;
      }
    }
  }
  // Program overrides (travel cap, lower than the league's only).
  const po = input.programOverrides;
  if (po !== undefined && po !== null) {
    if (typeof po !== 'object' || Array.isArray(po)) errors.push('Program overrides must be a list of programs and their values.');
    else {
      for (const [programId, values] of Object.entries(po)) {
        const name = programNames?.[programId];
        if (programNames && !name) { errors.push('A program override is for a program that isn’t in the league (guest programs can’t have one). Remove it and try again.'); continue; }
        if (!values || typeof values !== 'object' || Array.isArray(values)) { errors.push(`The override for ${name || 'a program'} is not valid.`); continue; }
        if (Object.keys(values).some((k) => !PROGRAM_OVERRIDE_KEYS.includes(k))) { errors.push(`${name || 'A program'}: only the travel cap can be set per program.`); continue; }
        if (values.maxTravelMiles === undefined || values.maxTravelMiles === null || values.maxTravelMiles === '') continue;
        const n = Number(values.maxTravelMiles);
        if (!Number.isInteger(n) || n < 1 || n > out.maxTravelMiles) {
          errors.push(`${name || 'A program'}’s travel cap must be a whole number from 1 to ${out.maxTravelMiles} miles. A program can only set a lower cap than the league’s.`);
        } else out.programOverrides[programId] = { maxTravelMiles: n };
      }
    }
  }
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.validation = true;
    throw err;
  }
  return out;
}

// ---- distance ----
export function milesBetween(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 3958.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

// A program's "home" location = average of its venues that have coordinates.
export function programHomes(venues) {
  const acc = {};
  for (const v of venues) {
    if (v.latitude == null || v.longitude == null) continue;
    const a = (acc[v.programId] ||= { lat: 0, lng: 0, n: 0 });
    a.lat += v.latitude; a.lng += v.longitude; a.n++;
  }
  const homes = {};
  for (const [pid, a] of Object.entries(acc)) homes[pid] = { lat: a.lat / a.n, lng: a.lng / a.n };
  return homes;
}

// ---- dates & times ----
export const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMinutes = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const dayNumber = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000);
export const daysApart = (a, b) => Math.abs(dayNumber(a) - dayNumber(b));

// Monday of the week containing date, as YYYY-MM-DD.
export function weekOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Split each game slot into consecutive game windows of gameMinutes.
// A 6:30–9:00 weeknight slot with 60-minute games gives 6:30 and 7:30.
export function carveWindows(slots, gameMinutes) {
  const windows = [];
  for (const s of slots) {
    const start = toMinutes(s.startTime);
    const end = toMinutes(s.endTime);
    for (let t = start; t + gameMinutes <= end; t += gameMinutes) {
      windows.push({
        slotId: s.id, courtId: s.courtId, courtName: s.courtName, venueId: s.venueId, venueName: s.venueName,
        programId: s.programId, date: s.date, startTime: fromMinutes(t), endTime: fromMinutes(t + gameMinutes),
        lat: s.latitude, lng: s.longitude, category: s.category,
      });
    }
  }
  return windows;
}

export const windowKey = (w) => `${w.courtId}|${w.date}|${w.startTime}`;

// ---- the team-level constraints, shared everywhere ----
// teamGames: the team's other scheduled games [{date}], already excluding
// the game(s) being moved.
export function teamProblems(teamName, teamGames, date, rules) {
  const problems = [];
  const clash = teamGames.find((g) => daysApart(g.date, date) < rules.minDaysBetween);
  if (clash) {
    problems.push(clash.date === date
      ? `${teamName} already plays on ${date}`
      : `${teamName} plays on ${clash.date}, less than ${rules.minDaysBetween} days away`);
  }
  const wk = weekOf(date);
  const inWeek = teamGames.filter((g) => weekOf(g.date) === wk).length;
  if (inWeek >= rules.maxGamesPerWeek) problems.push(`${teamName} already has ${inWeek} game${inWeek > 1 ? 's' : ''} that week`);
  return problems;
}

// ---- round-robin pairings (circle method) ----
// Returns rounds: [[ [teamA, teamB], ... ], ...]; one full cycle.
export function roundRobin(teams) {
  const list = [...teams];
  if (list.length % 2) list.push(null); // bye
  const n = list.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a && b) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()); // rotate everything except the first team
  }
  return rounds;
}
