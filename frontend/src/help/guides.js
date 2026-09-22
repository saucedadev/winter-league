// In-app user guides. Each guide is one Markdown file in this folder; the
// Help page and the downloadable PDF are both produced from it.
//   {{appName}}         -> the conference's name (Branding)
//   {{gettingStarted}}  -> the shared "Getting started" section
//   Links to /help/<id> open another guide inside the app.
// After editing a guide, rebuild the PDFs: npm run guides:pdf (see README).
import { Marked } from 'marked';
import gettingStarted from './_getting-started.md?raw';
import systemAdmin from './system-admin.md?raw';
import programDirector from './program-director.md?raw';
import coach from './coach.md?raw';
import refereeAssignor from './referee-assignor.md?raw';
import referee from './referee.md?raw';

export const GUIDES = [
  { id: 'system-admin', title: 'System Admin guide', blurb: 'Seasons, programs, accounts, building and publishing the schedule, league sign-off.', source: systemAdmin },
  { id: 'program-director', title: 'Program Director guide', blurb: 'Venues, teams, gym slots, blackouts, and approving schedule changes.', source: programDirector },
  { id: 'coach', title: 'Coach guide', blurb: 'Your teams’ schedule and asking for a game to move.', source: coach },
  { id: 'referee-assignor', title: 'Referee Assignor guide', blurb: 'The referee roster, assigning games, attendance, and payouts.', source: refereeAssignor },
  { id: 'referee', title: 'Referee guide', blurb: 'Your games, checking in, declining, and dates you can’t work.', source: referee },
];

// Each role's own guide, and the guides it can open (its own first).
export const ROLE_GUIDE = { super_admin: 'system-admin', program_director: 'program-director', league_coach: 'coach', referee_assignor: 'referee-assignor', referee: 'referee' };
const VISIBLE = {
  super_admin: GUIDES.map((g) => g.id),
  program_director: ['program-director', 'coach'],
  league_coach: ['coach'],
  referee_assignor: ['referee-assignor', 'referee'],
  referee: ['referee'],
};
export const guidesFor = (role) => (VISIBLE[role] || []).map((id) => GUIDES.find((g) => g.id === id));
export const findGuide = (id) => GUIDES.find((g) => g.id === id) || null;
export const pdfUrl = (id) => `/guides/${id}.pdf`;

const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Returns { html, toc: [{ id, text }] } for one guide.
// lazy: false loads every image straight away (the PDF printer never scrolls).
export function renderGuide(guide, appName = 'Winter League', { lazy = true } = {}) {
  const md = guide.source.replaceAll('{{gettingStarted}}', gettingStarted).replaceAll('{{appName}}', appName);
  const toc = [];
  const used = new Set();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        let id = slug(text) || 'section';
        for (let n = 2; used.has(id); n++) id = `${slug(text)}-${n}`;
        used.add(id);
        if (depth === 2) toc.push({ id, text: text.replace(/<[^>]+>/g, '') });
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      image({ href, text }) {
        return `<figure><img src="${href}" alt="${text}"${lazy ? ' loading="lazy"' : ''} /><figcaption>${text}</figcaption></figure>`;
      },
      table(token) {
        // Wide tables scroll sideways on phones instead of stretching the page.
        const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('');
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });
  return { html: marked.parse(md), toc };
}
