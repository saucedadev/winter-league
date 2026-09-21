// The built-in test league: six fictional programs. The automated smoke tests
// (npm run test:smoke) depend on these exact programs, logins, and teams, so
// this dataset should only change together with the tests.
// Load it with: npm run db:reset:test

const PROGRAMS = [
  { name: 'Northfield Hawks', code: 'NFH', city: 'Northfield' },
  { name: 'Riverbend Youth Basketball', code: 'RYB', city: 'Riverbend' },
  { name: 'Cedar Park Cyclones', code: 'CPC', city: 'Cedar Park' },
  { name: 'Lakeview Lightning', code: 'LVL', city: 'Lakeview' },
  { name: 'Oak Hollow Owls', code: 'OHO', city: 'Oak Hollow' },
  { name: 'Westgate Wolves', code: 'WGW', city: 'Westgate' },
];

const VENUES = {
  NFH: [{ name: 'Northfield Middle School', courts: ['North court', 'South court'], lat: 42.099, lng: -87.781 }, { name: 'Hawks Community Center', courts: ['Main court'], lat: 42.105, lng: -87.77 }],
  RYB: [{ name: 'Riverbend High School', courts: ['Main gym', 'Aux gym'], lat: 41.95, lng: -87.89 }],
  CPC: [{ name: 'Cedar Park Elementary', courts: ['Main court'], lat: 41.88, lng: -87.95 }, { name: 'Cyclone Fieldhouse', courts: ['Court 1', 'Court 2', 'Court 3'], lat: 41.87, lng: -87.94 }],
  LVL: [{ name: 'Lakeview Recreation Center', courts: ['Main court'], lat: 41.94, lng: -87.65 }],
  OHO: [{ name: 'Oak Hollow Junior High', courts: ['Main gym'], lat: 41.79, lng: -87.8 }],
  WGW: [{ name: 'Westgate Academy', courts: ['East court', 'West court'], lat: 41.86, lng: -88.02 }],
};

const TEAM_DIVISIONS = ['5th Grade Boys', '6th Grade Boys', '7th Grade Boys', '6th Grade Girls', '8th Grade Girls'];

export function testLeagueDataset() {
  return {
    label: 'built-in test league',
    programs: PROGRAMS.map((p) => ({
      ...p, contactEmail: `director@${p.code.toLowerCase()}.example.com`, contactPhone: null,
      venues: VENUES[p.code].map((v) => ({ ...v, address: null, city: p.city, state: 'IL', zip: null })),
    })),
    directors: [
      { first: 'Dana', last: 'Whitfield', username: 'dwhitfield', email: 'dwhitfield@example.com', phone: '3125550142', programCode: 'NFH' },
      { first: 'Marcus', last: 'Bell', username: 'mbell', email: 'mbell@example.com', phone: '8475550187', programCode: 'RYB' },
    ],
    // Every program fields 4–5 of these divisions; both coaches are on Northfield teams.
    teams(program) {
      const out = [];
      TEAM_DIVISIONS.forEach((d, i) => {
        if ((i + program.code.charCodeAt(0)) % 5 === 4) return;
        const coach = program.code === 'NFH' && i === 0 ? 'tgreene' : program.code === 'NFH' && i === 1 ? 'lortega' : null;
        out.push({ division: d, name: `${program.name.split(' ')[0]} ${d.replace(' Grade', '')}`, coach });
      });
      return out;
    },
    coaches: { tgreene: 'NFH', lortega: 'NFH' },
    // Sample change requests: a Northfield coach asks (waits on Dana), and
    // Riverbend's director asks about a Riverbend–Northfield game (waits on Dana).
    requests: { coachProgram: 'NFH', askingProgram: 'RYB', otherProgram: 'NFH' },
  };
}
