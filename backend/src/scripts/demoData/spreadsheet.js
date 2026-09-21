// Reads the demo spreadsheet (Programs, Venues, Directors sheets) into the
// dataset shape seedDemo.js uses. Every problem is collected with its sheet
// and row number, and nothing is written unless the whole file is valid.
//
// Columns are found by header name, so their order doesn't matter.
//   Programs:  Program | Short code | City | Contact | Contact phone
//   Venues:    Program | Venue Name | Street address | City | State | Zip |
//              Latitude | Longitude | Courts ("Main Gym, Aux Gym")
//   Directors: First name | Last name | Email | Phone | Role | Program
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { config } from '../../config.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A cell's value as plain text: handles hyperlinks (Excel often turns emails
// into links), rich text, formulas, and numbers (zips, phones).
function text(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.text !== undefined) return String(typeof v.text === 'object' ? (v.text.richText || []).map((r) => r.text).join('') : v.text).trim();
    if (v.richText) return v.richText.map((r) => r.text).join('').trim();
    if (v.result !== undefined) return String(v.result).trim();
    if (v.hyperlink) return String(v.hyperlink).replace(/^mailto:/i, '').trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return String(v).trim();
}
const number = (cell) => { const t = text(cell); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function phoneDigits(raw) {
  if (!raw) return { value: null };
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? { value: d } : { error: `"${raw}" isn't a 10-digit phone number` };
}

// Reads one sheet into [{ row, cells: { key: cell } }], after finding each
// required/optional column by its header text.
function readSheet(wb, sheetName, columns, errors) {
  const ws = wb.worksheets.find((s) => norm(s.name) === norm(sheetName));
  if (!ws) { errors.push(`The "${sheetName}" sheet is missing.`); return []; }
  const header = ws.getRow(1);
  const index = {};
  header.eachCell((cell, col) => { index[norm(text(cell))] = col; });
  const cols = {};
  for (const [key, { header: h, required }] of Object.entries(columns)) {
    const col = index[norm(h)];
    if (!col && required) errors.push(`${sheetName}: the "${h}" column is missing from row 1.`);
    cols[key] = col;
  }
  const rows = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const cells = Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, c ? row.getCell(c) : null]));
    if (Object.values(cells).every((c) => text(c) === '')) return; // blank row
    rows.push({ row: r, cells });
  });
  return rows;
}

export async function loadSpreadsheetDataset(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Demo spreadsheet not found: ${file}\n   Put it there, pass --file=<path>, or run with --dataset=test for the built-in test league.`);
  }
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.readFile(file); } catch (e) { throw new Error(`Couldn't read ${file} as an .xlsx workbook (${e.message}).`); }

  const errors = [];
  const warnings = [];

  // ---- Programs ----
  const programRows = readSheet(wb, 'Programs', {
    name: { header: 'Program', required: true }, code: { header: 'Short code', required: true },
    city: { header: 'City' }, contact: { header: 'Contact' }, phone: { header: 'Contact phone' },
  }, errors);
  const programs = [];
  const byName = new Map();
  const codes = new Set();
  for (const { row, cells } of programRows) {
    const at = `Programs row ${row}`;
    const name = text(cells.name);
    const code = text(cells.code).toUpperCase();
    const contact = text(cells.contact);
    const phone = phoneDigits(text(cells.phone));
    if (!name) errors.push(`${at}: Program name is empty.`);
    else if (byName.has(norm(name))) errors.push(`${at}: "${name}" is listed twice.`);
    if (!/^[A-Z0-9]{2,6}$/.test(code)) errors.push(`${at}: Short code "${text(cells.code)}" must be 2–6 letters or numbers.`);
    else if (codes.has(code)) errors.push(`${at}: Short code "${code}" is used twice.`);
    if (contact && !EMAIL_RE.test(contact)) errors.push(`${at}: Contact "${contact}" isn't an email address.`);
    if (phone.error) errors.push(`${at}: Contact phone ${phone.error}.`);
    const p = { row, name, code, city: text(cells.city) || null, contactEmail: contact || null, contactPhone: phone.value || null, venues: [] };
    programs.push(p);
    if (name) byName.set(norm(name), p);
    codes.add(code);
  }
  if (!programs.length) errors.push('Programs: no programs found.');
  if (programs.length > config.maxPrograms) errors.push(`Programs: ${programs.length} programs listed, but the league allows at most ${config.maxPrograms} (MAX_PROGRAMS).`);
  const programFor = (cell, at) => {
    const n = text(cell);
    const p = byName.get(norm(n));
    if (!n) errors.push(`${at}: Program is empty.`);
    else if (!p) errors.push(`${at}: program "${n}" isn't on the Programs sheet (check the spelling).`);
    return p;
  };

  // ---- Venues ----
  const venueRows = readSheet(wb, 'Venues', {
    program: { header: 'Program', required: true }, name: { header: 'Venue Name', required: true },
    address: { header: 'Street address' }, city: { header: 'City' }, state: { header: 'State' }, zip: { header: 'Zip' },
    lat: { header: 'Latitude' }, lng: { header: 'Longitude' }, courts: { header: 'Courts' },
  }, errors);
  for (const { row, cells } of venueRows) {
    const at = `Venues row ${row}`;
    const p = programFor(cells.program, at);
    const name = text(cells.name);
    const lat = number(cells.lat);
    const lng = number(cells.lng);
    if (!name) errors.push(`${at}: Venue Name is empty.`);
    if (Number.isNaN(lat) || Number.isNaN(lng)) errors.push(`${at}: Latitude and Longitude must be numbers.`);
    else if ((lat === null) !== (lng === null)) errors.push(`${at}: give both Latitude and Longitude, or neither.`);
    else if (lat !== null && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) errors.push(`${at}: Latitude/Longitude are out of range.`);
    else if (lat === null) warnings.push(`${at}: "${name}" has no coordinates, so travel distance can't be checked for games there.`);
    let courts = [...new Set(text(cells.courts).split(/[,;\n]/).map((c) => c.trim()).filter(Boolean))];
    if (!courts.length) { courts = ['Main Gym']; warnings.push(`${at}: no courts listed for "${name}", so it gets one "Main Gym".`); }
    if (!p || !name) continue;
    if (p.venues.some((v) => norm(v.name) === norm(name))) { errors.push(`${at}: "${name}" is listed twice for ${p.name}.`); continue; }
    const zip = text(cells.zip);
    p.venues.push({
      name, address: text(cells.address) || null, city: text(cells.city) || p.city, state: text(cells.state).toUpperCase() || null,
      zip: zip ? (/^\d{1,4}$/.test(zip) ? zip.padStart(5, '0') : zip) : null,
      lat: Number.isNaN(lat) ? null : lat, lng: Number.isNaN(lng) ? null : lng, courts,
    });
  }

  // ---- Directors ----
  const directorRows = readSheet(wb, 'Directors', {
    first: { header: 'First name', required: true }, last: { header: 'Last name', required: true },
    email: { header: 'Email', required: true }, phone: { header: 'Phone' }, role: { header: 'Role' },
    program: { header: 'Program', required: true },
  }, errors);
  const directors = [];
  const emails = new Set();
  for (const { row, cells } of directorRows) {
    const at = `Directors row ${row}`;
    const first = text(cells.first);
    const last = text(cells.last);
    const email = text(cells.email).toLowerCase();
    const role = text(cells.role);
    const phone = phoneDigits(text(cells.phone));
    const p = programFor(cells.program, at);
    if (!first || !last) errors.push(`${at}: First and Last name are required.`);
    if (!EMAIL_RE.test(email)) errors.push(`${at}: Email "${text(cells.email)}" isn't an email address.`);
    else if (emails.has(email)) errors.push(`${at}: Email ${email} is used twice.`);
    if (role && norm(role) !== 'programdirector') errors.push(`${at}: Role "${role}" isn't supported here. Only Program Directors are loaded from this sheet.`);
    if (phone.error) errors.push(`${at}: Phone ${phone.error}.`);
    emails.add(email);
    if (p && first && last) directors.push({ row, first, last, email, phone: phone.value || null, programCode: p.code });
  }

  for (const p of programs) {
    if (!p.venues.length) warnings.push(`${p.name} has no venues, so its teams can only play away.`);
    if (!directors.some((d) => d.programCode === p.code)) warnings.push(`${p.name} has no Program Director on the Directors sheet.`);
  }

  if (errors.length) {
    const shown = errors.slice(0, 25);
    throw new Error(`The demo spreadsheet has ${errors.length} problem${errors.length > 1 ? 's' : ''}. Nothing was loaded.\n   • ${shown.join('\n   • ')}${errors.length > shown.length ? `\n   • …and ${errors.length - shown.length} more` : ''}`);
  }
  return { programs, directors, warnings };
}
