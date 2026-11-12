// Virtual display, VNC and the Playwright flow that fills the RegioJet cart.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { UserError } from './errors.mjs';
import { config } from './config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(check, ms, what) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(100)) {
    if (await check()) return;
  }
  throw new Error(`${what} did not become ready in ${ms} ms`);
}

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });

/** Starts Xvfb, x11vnc (localhost only) and noVNC; `onExit` fires if any of them dies unexpectedly. */
export async function startDisplay({ onExit = () => {} } = {}) {
  const procs = [];
  let stopped = false;
  const run = (cmd, args) => {
    const p = spawn(cmd, args, { stdio: 'ignore' });
    p.on('error', (e) => !stopped && onExit(`${cmd}: ${e.message}`));
    p.on('exit', (code) => !stopped && onExit(`${cmd} exited (${code})`));
    procs.push(p);
  };
  const stop = () => {
    stopped = true;
    for (const p of procs) p.kill('SIGTERM');
  };
  try {
    run('Xvfb', [config.display, '-screen', '0', `${config.windowSize.replace(',', 'x')}x24`, '-nolisten', 'tcp']);
    await waitUntil(() => fs.existsSync(`/tmp/.X11-unix/X${config.display.slice(1)}`), 8000, 'Xvfb');
    run('x11vnc', ['-display', config.display, '-forever', '-shared', '-nopw', '-quiet', '-localhost', '-rfbport', String(config.rfbPort)]);
    // The heartbeat keeps the WebSocket alive through proxies with idle timeouts.
    run('websockify', ['--web', '/usr/share/novnc', '--heartbeat', '30', `${config.vncBind}:${config.novncPort}`, `localhost:${config.rfbPort}`]);
    await waitUntil(async () => (await portOpen(config.rfbPort)) && (await portOpen(config.novncPort)), 8000, 'VNC');
  } catch (e) {
    stop();
    throw e;
  }
  process.env.DISPLAY = config.display;
  return { stop };
}

/** Chromium refuses to start on a profile that a crashed process left locked. */
const removeStaleLocks = (profile) => {
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) fs.rmSync(path.join(profile, f), { force: true });
};

export async function launchBrowser({ profile = config.profile } = {}) {
  fs.mkdirSync(profile, { recursive: true });
  removeStaleLocks(profile);
  return chromium.launchPersistentContext(profile, {
    ...(config.browser === 'chrome' ? { channel: 'chrome' } : {}),
    headless: false,
    viewport: null,
    // Every selector below is Czech text.
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    args: [
      '--start-maximized',
      '--window-position=0,0',
      `--window-size=${config.windowSize}`,
      // /dev/shm is tiny in containers and crashes Chromium.
      ...(config.browser === 'chromium' ? ['--disable-dev-shm-usage', '--disable-gpu'] : []),
    ],
  });
}

/** Extracts "car:seat" keys from the "Vůz N, Sedadlo a,b,c" lines of the summary panel. */
export function parseSelection(text) {
  const sel = new Set();
  // No \n in the separator, or the "6" of the next line ("6× Dospělý") gets glued on.
  for (const m of text.matchAll(/V[ůu]z[ \t]+(\d+),[ \t]*Sedadl[oa][ \t]+(\d+(?:,[ \t]*\d+)*)/g)) {
    for (const s of m[2].split(',')) sel.add(`${m[1]}:${s.trim()}`);
  }
  return sel;
}

export const seatingUrl = ({ routeId, fromStationId, toStationId }, seatClassKey, seatCount) =>
  'https://regiojet.cz/reservation/seating/there?' + new URLSearchParams([
    ['routeId', routeId],
    ['fromStationId', fromStationId],
    ['toStationId', toStationId],
    ...Array.from({ length: seatCount }, () => ['tariffs', 'REGULAR']),
    ['seatClassKey', seatClassKey],
  ]);

async function dismissCookies(page) {
  await page.getByRole('button', { name: /Odmítnout vše/i }).click({ timeout: 4000 }).catch(() => {});
}

/** Drives the site up to the add-ons step with exactly the requested seats selected. */
export async function fillCart(page, { route, car, seats, seatClassKey, log = () => {} }) {
  await page.goto(seatingUrl(route, seatClassKey, seats.length), { waitUntil: 'domcontentloaded' });
  await dismissCookies(page);
  await page.getByRole('button', { name: new RegExp(`^Vagón číslo ${car}\\.`) }).click({ timeout: 20000 });

  const readSelection = async () => parseSelection(await page.locator('body').innerText());

  for (const s of seats) {
    const key = `${car}:${s}`;
    if ((await readSelection()).has(key)) continue; // clicking would deselect it
    await page.locator(`svg g#s${s}`).first().click({ timeout: 10000 });
    await waitUntil(async () => (await readSelection()).has(key), 5000, `seat ${s}`).catch(() => {});
  }

  const selected = await readSelection();
  const wanted = seats.map((s) => `${car}:${s}`);
  if (selected.size !== wanted.length || !wanted.every((k) => selected.has(k))) {
    throw new UserError(`Výběr v prohlížeči nesedí. Chtěl jsem: ${wanted.join(' ')}; vybráno: ${[...selected].join(' ')}.`, 3);
  }
  log(`Vybráno: vůz ${car}, místa ${seats.join(', ')}`);

  await page.getByRole('button', { name: 'Pokračovat' }).first().click();
  try {
    await page.waitForURL(/\/reservation\/addons\//, { timeout: 20000 });
  } catch {
    throw new UserError('Místa jsou vybraná, ale košík se nepotvrdil. Zkontroluj okno prohlížeče.', 4);
  }
}
