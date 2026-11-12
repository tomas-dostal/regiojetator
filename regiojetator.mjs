#!/usr/bin/env node
// CLI: puts the given seats of a RegioJet train into the cart once. The user finishes the purchase.
//   node regiojetator.mjs --from Praha --to Košice --date 2026-11-19 --time 07:41 --car 3 --seats 31-36
import { parseArgs } from 'node:util';
import { UserError } from './errors.mjs';
import { config } from './config.mjs';
import * as rj from './regiojet.mjs';
import { startDisplay, launchBrowser, fillCart } from './browser.mjs';

const { values: opt } = parseArgs({
  options: {
    from: { type: 'string' }, to: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' },
    car: { type: 'string' }, seats: { type: 'string' },
    profile: { type: 'string', default: config.profile },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const USAGE = `Použití:
  regiojetator --from <město> --to <město> --date YYYY-MM-DD --time HH:MM --car <vůz> --seats <místa>

  --seats      rozsah (31-36), seznam (31,32,35) nebo kombinace (31-33,36), nejvýše ${config.maxSeats}
  --profile    složka s profilem prohlížeče (přihlášení do RegioJetu se v ní zapamatuje)
  --dry-run    jen ověří spoj a volnost míst, prohlížeč neotevře
  Prohlížeč a displej se volí přes REGIOJETATOR_BROWSER (chromium|chrome) a REGIOJETATOR_VNC=1 (Xvfb + noVNC).`;

if (opt.help || !(opt.from && opt.to && opt.date && opt.time && opt.car && opt.seats)) {
  console.log(USAGE);
  process.exit(opt.help ? 0 : 1);
}

async function findRoute(fromCity, toCity) {
  const time = opt.time.padStart(5, '0');
  const sameDay = await rj.searchRoutes(fromCity, toCity, opt.date);
  const matches = sameDay.filter((r) => r.departureTime.slice(11, 16) === time);
  if (matches.length === 0) {
    const avail = sameDay.map((r) => r.departureTime.slice(11, 16)).join(', ') || 'žádné';
    throw new UserError(`Spoj s odjezdem ${time} jsem nenašel. Dostupné odjezdy: ${avail}`);
  }
  if (matches.length > 1) throw new UserError(`V ${time} odjíždí víc spojů, upřesni zadání.`);
  if (matches[0].bookable === false) throw new UserError('RegioJet hlásí, že spoj není k zakoupení.');
  return matches[0];
}

async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opt.date)) throw new UserError('--date musí být ve tvaru YYYY-MM-DD');
  if (!/^\d{1,2}:\d{2}$/.test(opt.time)) throw new UserError('--time musí být ve tvaru HH:MM');
  const car = rj.validateCar(Number(opt.car));
  const seats = rj.parseSeats(opt.seats);

  const [fromCity, toCity] = await Promise.all([rj.resolveCity(opt.from), rj.resolveCity(opt.to)]);
  console.log(`Trasa: ${fromCity.name} → ${toCity.name}, ${opt.date} ${opt.time}`);
  const r = await findRoute(fromCity, toCity);
  const route = { routeId: r.id, fromStationId: r.departureStationId, toStationId: r.arrivalStationId };

  rj.assertNotDeparted(await rj.departureInfo(route.routeId, route.fromStationId, route.toStationId));
  const seatClassKey = await rj.checkSeats(route.routeId, route.fromStationId, route.toStationId, car, seats);
  console.log(`✔ Vůz ${car} (${seatClassKey}), místa ${seats.join(', ')} jsou volná.`);
  if (opt['dry-run']) return;

  let display = null;
  let context = null;
  try {
    if (process.env.REGIOJETATOR_VNC) display = await startDisplay();
    context = await launchBrowser({ profile: opt.profile });
    const page = context.pages()[0] ?? (await context.newPage());
    await fillCart(page, { route, car, seats, seatClassKey, log: console.log });
    console.log(`\n✔ Hotovo, místa jsou v košíku. ${process.env.REGIOJETATOR_VNC_URL ? `Otevři ${process.env.REGIOJETATOR_VNC_URL}` : 'Dokonči nákup v okně prohlížeče'}; údaje cestujících a platba jsou na tobě.\n  Košík drží jen krátce. Ukonči skript zavřením okna nebo Ctrl+C.`);
    await new Promise((resolve) => context.on('close', resolve));
  } finally {
    await context?.close().catch(() => {});
    display?.stop();
  }
}

main().catch((e) => {
  console.error(`\n✖ ${e.message}`);
  process.exit(e instanceof UserError ? e.code : 1);
});
