import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Where the demo spreadsheet lives. Replace this file (same sheet and column
// names) and run npm run db:reset to load a different demo league.
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_DEMO_FILE = path.join(BACKEND_DIR, 'demo-data', 'WinterLeague-ProgramVenueDirector-DemoData.xlsx');
