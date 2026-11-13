// All environment configuration, read and validated once.
import os from 'node:os';
import path from 'node:path';

const int = (name, def) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
};

const oneOf = (name, def, allowed) => {
  const v = process.env[name] || def;
  if (!allowed.includes(v)) throw new Error(`${name} must be one of ${allowed.join(', ')}, got "${v}"`);
  return v;
};

const optional = (name, pattern, what) => {
  const v = (process.env[name] || '').trim();
  if (v && !pattern.test(v)) throw new Error(`${name} is not a valid ${what}`);
  return v;
};

const port = int('PORT', 8080);

export const config = Object.freeze({
  port,
  jobTtlMs: int('JOB_TTL_MIN', 60) * 60_000,
  profile: process.env.REGIOJETATOR_PROFILE || path.join(os.homedir(), '.regiojetator', 'profile'),
  browser: oneOf('REGIOJETATOR_BROWSER', 'chromium', ['chrome', 'chromium']),
  windowSize: process.env.REGIOJETATOR_WINDOW_SIZE || '1440,900',
  vncBind: process.env.REGIOJETATOR_VNC_BIND || '127.0.0.1',
  allowedHosts: (process.env.ALLOWED_HOSTS || `localhost:${port},127.0.0.1:${port}`)
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  contact: {
    email: optional('REGIOJETATOR_EMAIL', /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'e-mail address'),
    phone: optional('REGIOJETATOR_PHONE', /^(\+420)?[\d ]{9,13}$/, 'Czech phone number (+420 and 9 digits)').replace(/\D/g, '').slice(-9),
  },
  display: ':99',
  novncPort: 6080,
  rfbPort: 5900,
  maxSeats: 6,
  maxCar: 40,
});
