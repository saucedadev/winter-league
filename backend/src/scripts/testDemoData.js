// Checks for the demo spreadsheet loader (npm run test:demo-data).
// Doesn't need the API or the database: it reads the spreadsheet in
// demo-data/ (or --file=<path>) and a few deliberately broken copies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { spreadsheetDataset, shortProgramName } from './demoData/spreadsheetLeague.js';
import { DEFAULT_DEMO_FILE } from './demoFile.js';

const file = path.resolve(process.argv.find((a) => a.startsWith('--file='))?.slice(7) || DEFAULT_DEMO_FILE);
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else failed++; console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`); };

console.log(`\nDemo spreadsheet: ${file}`);
const d = await spreadsheetDataset(file, { reservedUsernames: ['gkim', 'pnair', 'tgreene', 'lortega', 'obrooks'] });
check('loads without problems', d.programs.length > 0);
check('every program has at least one venue', d.programs.every((p) => p.venues.length > 0), d.programs.filter((p) => !p.venues.length).map((p) => p.name).join(', '));
check('every program has a director', d.programs.every((p) => d.directors.some((x) => x.programCode === p.code)));
check('every venue has map coordinates (needed for the travel cap)', d.programs.every((p) => p.venues.every((v) => v.lat != null)));
check('emails are safe placeholders by default', d.directors.every((x) => x.email.endsWith('@demo.example')) && d.programs.every((p) => !p.contactEmail || p.contactEmail.endsWith('@demo.example')));
check('director usernames are unique and avoid shared accounts', new Set(d.directors.map((x) => x.username)).size === d.directors.length && !d.directors.some((x) => ['gkim', 'pnair', 'tgreene', 'lortega', 'obrooks'].includes(x.username)));
const teams = d.programs.flatMap((p) => d.teams(p).map((t) => ({ ...t, program: p.code })));
check('every program gets teams', d.programs.every((p) => teams.some((t) => t.program === p.code)));
check('team names are unique within a program', d.programs.every((p) => { const n = teams.filter((t) => t.program === p.code).map((t) => t.name); return new Set(n).size === n.length; }));
check('some program fields two teams in one division', d.programs.some((p) => { const ds = teams.filter((t) => t.program === p.code).map((t) => t.division); return new Set(ds).size < ds.length; }));
check('both coaches are placed on teams', ['tgreene', 'lortega'].every((c) => teams.some((t) => t.coach === c)));
check('short program names read well', shortProgramName({ name: 'Banks Youth Basketball Association', code: 'BYBA' }) === 'Banks' && shortProgramName({ name: 'Hilhi Youth Basketball', code: 'HYB' }) === 'Hilhi');
const real = await spreadsheetDataset(file, { realEmails: true });
check('--real-emails keeps the spreadsheet’s addresses', real.directors.every((x) => !x.email.endsWith('@demo.example')));

console.log('\nBroken spreadsheets are rejected with useful messages');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-demo-'));
async function broken(name, mutate) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  mutate(wb);
  const out = path.join(tmp, `${name}.xlsx`);
  await wb.xlsx.writeFile(out);
  try { await spreadsheetDataset(out); return ''; } catch (e) { return e.message; }
}
const firstProgram = d.programs[0].name;
let msg = await broken('typo', (wb) => { wb.getWorksheet('Venues').getCell('A2').value = `${firstProgram}x`; });
check('misspelled program name → names the row', /Venues row 2: program .* isn't on the Programs sheet/.test(msg), msg);
msg = await broken('code', (wb) => { wb.getWorksheet('Programs').getCell('B2').value = 'A-1'; });
check('invalid short code → names the row', /Programs row 2: Short code/.test(msg), msg);
msg = await broken('dupe', (wb) => { const s = wb.getWorksheet('Directors'); s.getCell('C3').value = s.getCell('C2').value; });
check('duplicate director email → names the row', /Directors row 3: Email .* used twice/.test(msg), msg);
msg = await broken('nosheet', (wb) => { wb.removeWorksheet(wb.getWorksheet('Directors').id); });
check('missing sheet → says which', /"Directors" sheet is missing/.test(msg), msg);
msg = await broken('nocolumn', (wb) => { wb.getWorksheet('Directors').getCell('C1').value = 'E-mail address'; });
check('missing required column → says which', /"Email" column is missing/.test(msg), msg);
msg = await broken('coords', (wb) => { wb.getWorksheet('Venues').getCell('G2').value = 'north'; });
check('bad coordinates → names the row', /Venues row 2: Latitude and Longitude must be numbers/.test(msg), msg);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
