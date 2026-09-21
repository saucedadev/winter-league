import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { db, isLocalDb } from './db/client.js';
import { HttpError } from './utils/http.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import programRoutes from './routes/programs.js';
import leagueRoutes from './routes/league.js';
import venueRoutes from './routes/venues.js';
import teamRoutes from './routes/teams.js';
import slotRoutes from './routes/slots.js';
import blackoutRoutes from './routes/blackouts.js';
import dashboardRoutes from './routes/dashboard.js';
import activityRoutes from './routes/activity.js';
import settingsRoutes from './routes/settings.js';
import scheduleRoutes from './routes/schedule.js';
import requestRoutes from './routes/requests.js';
import refereeRoutes from './routes/referees.js';

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; needed for rate limiting by real IP
app.use(helmet());
app.use(cors({
  origin(origin, cb) {
    // Allow non-browser callers (curl, Render health checks) and listed origins only.
    if (!origin || config.appUrls.includes(origin)) return cb(null, true);
    cb(new HttpError(403, `Origin ${origin} is not allowed. Add it to APP_URL.`));
  },
}));
app.use(express.json({ limit: '600kb' })); // room for an uploaded logo (max 300 KB, base64-encoded)

// Health check for Render — also confirms the database is reachable.
app.get('/api/health', async (req, res) => {
  try {
    await db.execute('SELECT 1');
    res.json({ ok: true, app: 'winter-league', database: isLocalDb ? 'local-sqlite' : 'turso' });
  } catch {
    res.status(503).json({ ok: false, error: 'Database unreachable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/league', leagueRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/blackouts', blackoutRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/referees', refereeRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' });
  const msg = String(err?.message || '');
  if (msg.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'That record already exists.' });
  if (msg.includes('FOREIGN KEY constraint failed')) return res.status(409).json({ error: 'That record is still in use elsewhere.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again, and contact the league administrator if it keeps happening.' });
});

// libSQL: enforce foreign keys on this connection (off by default in SQLite).
await db.execute('PRAGMA foreign_keys = ON');

app.listen(config.port, () => {
  console.log(`🕒 League time zone: ${config.leagueTimezone}`);
  console.log(`🏀 Winter League API on http://localhost:${config.port} (${isLocalDb ? 'local SQLite' : 'Turso'})`);
});
