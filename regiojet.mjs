// RegioJet REST client and the domain checks built on it.
import { UserError } from './errors.mjs';
import { config } from './config.mjs';

const API = 'https://brn-ybus-pubapi.sa.cz/restapi';
const HEADERS = {
  'X-Lang': 'cs',
  'X-Currency': 'CZK',
  'X-Application-Origin': 'WEB',
  Accept: 'application/json, text/plain, */*',
};
// The API rejects POSTs with a plain application/json content type (400).
const JSON_V = 'application/1.1.0+json';

export async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(API + pathname, {
    method,
    headers: body ? { ...HEADERS, 'Content-Type': JSON_V } : HEADERS,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new UserError(`API ${method} ${pathname} → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

export const norm = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

let citiesCache = null;
export async function listCities() {
  citiesCache ??= (await api('/consts/locations')).flatMap((c) => c.cities ?? []);
  return citiesCache;
}

export async function resolveCity(name) {
  const n = norm(name ?? '');
  if (!n) throw new UserError('Zadej název města.');
  const cities = await listCities();
  const exact = cities.filter((c) => norm(c.name) === n);
  const hits = exact.length ? exact : cities.filter((c) => norm(c.name).startsWith(n));
  if (hits.length === 0) throw new UserError(`Město "${name}" jsem nenašel.`);
  if (hits.length > 1) throw new UserError(`Město "${name}" je nejednoznačné: ${hits.slice(0, 8).map((h) => h.name).join(', ')}`);
  return hits[0];
}

/** The API also returns following days, so filter on the local date in the timestamp string. */
export async function searchRoutes(fromCity, toCity, date) {
  const res = await api('/routes/search/simple?' + new URLSearchParams({
    tariffs: 'REGULAR',
    fromLocationType: 'CITY',
    fromLocationId: fromCity.id,
    toLocationType: 'CITY',
    toLocationId: toCity.id,
    departureDate: date,
  }));
  return (res.routes ?? []).filter((r) => r.departureTime.slice(0, 10) === date);
}

/** Effective departure: the predicted time (delay) if present, else the timetable. */
export async function departureInfo(routeId, fromStationId, toStationId) {
  const qs = new URLSearchParams({ fromStationId, toStationId, tariffs: 'REGULAR' });
  const detail = await api(`/routes/${routeId}/simple?${qs}`);
  const scheduled = new Date(detail.departureTime);
  const predicted = detail.predictedDepartureTime ? new Date(detail.predictedDepartureTime) : null;
  return { scheduled, predicted, effective: predicted ?? scheduled };
}

/** A departed train cannot be booked; a delayed one can until its predicted departure. */
export function assertNotDeparted(dep, now = new Date()) {
  if (now > dep.effective) {
    const when = dep.effective.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });
    throw new UserError(`Spoj už odjel (${when}), do košíku ho nedám.`);
  }
}

const LAYOUT_BASE = 'https://brn-ybus-pubapi.sa.cz/resources/vehicle_layout/';
const layoutCache = new Map();

export const layoutName = (url) => {
  const name = typeof url === 'string' && url.startsWith(LAYOUT_BASE) ? url.slice(LAYOUT_BASE.length) : '';
  return /^[\w.-]{1,100}\.svg$/.test(name) ? name : null;
};

export async function getLayout(name) {
  if (!layoutName(LAYOUT_BASE + name)) throw new UserError('Neplatný název rozložení.');
  if (!layoutCache.has(name)) {
    const res = await fetch(LAYOUT_BASE + name, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new UserError(`Rozložení vozu se nepodařilo načíst (${res.status}).`);
    const svg = await res.text();
    if (svg.length > 500_000) throw new UserError('Rozložení vozu je příliš velké.');
    layoutCache.set(name, svg);
  }
  return layoutCache.get(name);
}

export async function getVehicles(routeId, fromStationId, toStationId) {
  const fs = await api('/routes/freeSeats', {
    method: 'POST',
    body: {
      sections: [{ sectionId: Number(routeId), fromStationId: Number(fromStationId), toStationId: Number(toStationId) }],
      seatPreference: { tariffs: ['REGULAR'] },
    },
  });
  return (fs[0]?.vehicles ?? [])
    .map((v) => ({
      number: v.number,
      seatClassKey: v.seatClasses?.[0]?.name,
      layout: layoutName(v.decks?.[0]?.layoutURL),
      free: (v.decks?.[0]?.freeSeats ?? []).map((s) => s.index).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.number - b.number);
}

/** Throws unless all seats are free; returns the car's seatClassKey. */
export async function checkSeats(routeId, fromStationId, toStationId, car, seats) {
  const vehicles = await getVehicles(routeId, fromStationId, toStationId);
  const vehicle = vehicles.find((v) => v.number === car);
  if (!vehicle) throw new UserError(`Vůz ${car} ve vlaku není. Vozy: ${vehicles.map((v) => v.number).join(', ')}`);
  if (!vehicle.seatClassKey) throw new UserError(`Vůz ${car} nemá známou třídu, nelze pokračovat.`);
  const free = new Set(vehicle.free);
  const taken = seats.filter((s) => !free.has(s));
  if (taken.length) {
    throw new UserError(`Tato místa nejsou volná: ${taken.join(', ')}\n  Volná místa ve voze ${car}: ${vehicle.free.join(', ')}`, 2);
  }
  return vehicle.seatClassKey;
}

export function validateCar(n) {
  if (!Number.isInteger(n) || n < 1 || n > config.maxCar) throw new UserError('Neplatný vůz.');
  return n;
}

export function normalizeSeats(list) {
  if (!Array.isArray(list) || !list.every((s) => Number.isInteger(s) && s > 0 && s < 1000)) {
    throw new UserError('Neplatná místa.');
  }
  const seats = [...new Set(list)].sort((a, b) => a - b);
  if (seats.length === 0) throw new UserError('Nezadal jsi žádná místa.');
  if (seats.length > config.maxSeats) throw new UserError(`RegioJet dovolí v jedné objednávce nejvýše ${config.maxSeats} cestujících.`);
  return seats;
}

/** Parses "31-36", "31,32,35" or a mix into a sorted seat list. */
export function parseSeats(spec) {
  const out = [];
  for (const part of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new UserError(`Neplatný zápis míst: "${part}"`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b < a || b - a >= config.maxSeats) throw new UserError(`Neplatný rozsah míst: "${part}"`);
    for (let i = a; i <= b; i++) out.push(i);
  }
  return normalizeSeats(out);
}
