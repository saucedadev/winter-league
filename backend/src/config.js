import dotenv from 'dotenv';

// Scripts can target a different env file with --env=<path> (used by
// `npm run migrate:prod` / `seed:prod` to point at Turso from your own
// machine). Works the same on macOS, Linux and Windows — no inline
// VAR=value shell syntax required.
const envArg = process.argv.find((a) => a.startsWith('--env='));
dotenv.config({ path: envArg ? envArg.slice('--env='.length) : '.env' });

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('dev-only'))) {
  // Only enforce for the server itself; scripts don't sign tokens.
  if (process.argv[1]?.endsWith('server.js')) {
    console.error('❌ JWT_SECRET must be set to a strong random value in production.');
    process.exit(1);
  }
}

export const config = {
  isProd,
  port: Number(process.env.PORT) || 4100,
  databaseUrl: process.env.DATABASE_URL || 'file:./data/winter-league.db',
  databaseAuthToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me-before-deploying',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  appUrls: (process.env.APP_URL || 'http://localhost:5174')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  maxPrograms: Number(process.env.MAX_PROGRAMS) || 16,
  // Game dates/times are local league time; check-in windows are judged in this zone.
  leagueTimezone: process.env.LEAGUE_TIMEZONE || 'America/Chicago',
  // For live demos only: lets referees check in to any upcoming game regardless of time.
  demoCheckInAnytime: process.env.DEMO_CHECKIN_ANYTIME === 'true',
  email: {
    provider: process.env.EMAIL_PROVIDER || 'console',
    from: process.env.EMAIL_FROM || 'Winter League <no-reply@example.com>',
    brevoUser: process.env.BREVO_SMTP_USER,
    brevoPass: process.env.BREVO_SMTP_PASS,
  },
};
