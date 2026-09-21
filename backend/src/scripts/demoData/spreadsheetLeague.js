// Turns the loaded spreadsheet into the dataset seedDemo.js builds from:
// logins, safe emails, teams, coaches, and which programs the sample change
// requests use. Everything here is derived, so editing the spreadsheet and
// resetting is all it takes to change the demo league.
import { loadSpreadsheetDataset } from './spreadsheet.js';

// Divisions every demo program can enter. Each program enters 5 of the 6,
// so every division has 5–7 teams: enough opponents for a full 8-game
// schedule under the default "at most 2 games per opponent" rule.
const DIVISIONS = ['5th Grade Boys', '6th Grade Boys', '7th Grade Boys', '5th Grade Girls', '6th Grade Girls', '7th Grade Girls'];
// Programs (by position in the sheet) that field a Competitive and a
// Developmental team in this division, to show the same-program rule.
const PAIR_DIVISION = '6th Grade Girls';
const PAIR_PROGRAMS = [0, 3];

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

// "Banks Youth Basketball Association" -> "Banks"; used in team names.
export function shortProgramName(p) {
  const s = p.name.replace(/\b(youth\s+)?basketball(\s+association|\s+club)?\b/i, '').replace(/\byouth\b/i, '').replace(/\s+/g, ' ').trim();
  return s || p.code;
}

export async function spreadsheetDataset(file, { realEmails = false, reservedUsernames = [] } = {}) {
  const loaded = await loadSpreadsheetDataset(file);
  const { programs } = loaded;

  // ---- logins + emails ----
  const taken = new Set(reservedUsernames.map((u) => u.toLowerCase()));
  const uniqueUsername = (first, last) => {
    const base = slug(first[0] + last) || 'director';
    let u = base;
    for (let n = 2; taken.has(u); n++) u = `${base}${n}`;
    taken.add(u);
    return u;
  };
  const usedEmails = new Set();
  const placeholder = (local) => {
    let e = `${local}@demo.example`;
    for (let n = 2; usedEmails.has(e); n++) e = `${local}${n}@demo.example`;
    usedEmails.add(e);
    return e;
  };
  const realToSafe = new Map();
  const directors = loaded.directors.map((d) => {
    const email = realEmails ? d.email : placeholder(`${slug(d.first)}.${slug(d.last)}`);
    realToSafe.set(d.email.toLowerCase(), email);
    return { ...d, username: uniqueUsername(d.first, d.last), email };
  });
  for (const p of programs) {
    if (!p.contactEmail || realEmails) continue;
    p.contactEmail = realToSafe.get(p.contactEmail.toLowerCase()) || placeholder(`contact.${slug(p.code)}`);
  }

  // ---- teams ----
  const plan = new Map(programs.map((p, i) => [p.code, DIVISIONS.filter((_, di) => di !== i % DIVISIONS.length)]));
  const [first, second] = programs;
  // Put Tasha (coach) in a division the second program also plays, so her
  // team meets that program and the demo's change request has a counterpart.
  const sharedDivision = second ? plan.get(first.code).find((d) => plan.get(second.code).includes(d)) : plan.get(first.code)[0];

  return {
    label: `spreadsheet ${file.split(/[\\/]/).pop()}`,
    programs,
    directors,
    warnings: loaded.warnings,
    realEmails,
    teams(program) {
      const idx = programs.indexOf(program);
      const short = shortProgramName(program);
      const out = [];
      for (const d of plan.get(program.code)) {
        const label = `${short} ${d.replace(' Grade', '')}`;
        const coach = program === first && d === sharedDivision ? 'tgreene' : program === (second || first) && d === sharedDivision && second ? 'lortega' : null;
        if (d === PAIR_DIVISION && PAIR_PROGRAMS.includes(idx)) {
          out.push({ division: d, name: `${label} Competitive`, coach }, { division: d, name: `${label} Developmental`, coach: null });
        } else out.push({ division: d, name: label, coach });
      }
      return out;
    },
    coaches: { tgreene: first.code, lortega: (second || first).code },
    requests: second ? { coachProgram: first.code, askingProgram: second.code, otherProgram: first.code } : null,
  };
}
