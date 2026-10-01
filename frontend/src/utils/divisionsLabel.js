// Same as divisionsLabel in backend/src/scheduling/core.js (keep the two in step):
// a short name for a set of divisions, e.g. "4th–6th Grade Boys & Girls".
// A short readable name for a set of divisions, given every division:
//   all girls' divisions -> "Girls"; all boys' -> "Boys";
//   4th, 5th, 6th boys and girls -> "4th–6th Grade Boys & Girls";
//   otherwise grouped by gender, or the division names.
const ordinal = (n) => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`; };
function gradeList(grades) {
  const nums = grades.map(Number);
  if (nums.some((n) => !Number.isInteger(n))) return grades.join(', ');
  nums.sort((a, b) => a - b);
  const runs = [];
  for (const n of nums) {
    const last = runs.at(-1);
    if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? ordinal(a) : b === a + 1 ? `${ordinal(a)}, ${ordinal(b)}` : `${ordinal(a)}–${ordinal(b)}`)).join(', ');
}
export function divisionsLabel(ids, divisions) {
  const set = new Set(ids);
  const chosen = divisions.filter((d) => set.has(d.id));
  if (!chosen.length) return '';
  if (chosen.length === 1) return chosen[0].name;
  const active = divisions.filter((d) => d.isActive !== 0 && d.isActive !== false);
  const ofGender = (g) => active.filter((d) => d.gender === g);
  const same = (a, b) => a.length === b.length && a.every((d) => b.includes(d));
  const girls = chosen.filter((d) => d.gender === 'girls');
  const boys = chosen.filter((d) => d.gender === 'boys');
  const others = chosen.filter((d) => d.gender !== 'girls' && d.gender !== 'boys');
  if (!others.length && girls.length && !boys.length && same(girls, ofGender('girls'))) return 'Girls';
  if (!others.length && boys.length && !girls.length && same(boys, ofGender('boys'))) return 'Boys';
  if (!others.length && girls.length && boys.length && same(girls, ofGender('girls')) && same(boys, ofGender('boys'))) return 'All divisions';
  // Grouped by grade, when every chosen division has one.
  if (chosen.every((d) => d.grade)) {
    const g = (list) => [...new Set(list.map((d) => String(d.grade)))];
    const gG = g(girls); const bG = g(boys);
    const parts = [];
    if (gG.length && bG.length && gG.length === bG.length && gG.every((x) => bG.includes(x))) parts.push(`${gradeList(gG)} Grade Boys & Girls`);
    else {
      if (bG.length) parts.push(`${gradeList(bG)} Grade Boys`);
      if (gG.length) parts.push(`${gradeList(gG)} Grade Girls`);
    }
    parts.push(...others.map((d) => d.name));
    return parts.join(' + ');
  }
  return chosen.map((d) => d.name).join(', ');
}
