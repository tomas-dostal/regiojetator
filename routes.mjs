// HTTP API of the web UI.
import { UserError } from './errors.mjs';
import { normalizeSeats, validateCar } from './regiojet.mjs';
import { hostAllowed, mutationAllowed } from './guard.mjs';

const isId = (v) => /^\d{1,15}$/.test(String(v));
const collator = new Intl.Collator('cs');

export function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJson(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooBig) return;
      data += chunk;
      if (data.length > limit) { tooBig = true; reject(new UserError('Příliš velké tělo požadavku.')); }
    });
    req.on('end', () => {
      if (tooBig) return;
      try { resolve(JSON.parse(data || '{}')); } catch { reject(new UserError('Neplatný JSON.')); }
    });
    req.on('error', reject);
  });
}

function parseJobBody(b) {
  if (![b.routeId, b.fromStationId, b.toStationId].every(isId)) throw new UserError('Neplatné ID spoje.');
  return {
    params: {
      routeId: String(b.routeId), fromStationId: String(b.fromStationId), toStationId: String(b.toStationId),
      car: validateCar(Number(b.car)), seats: normalizeSeats(b.seats),
    },
    trip: String(b.trip ?? '').slice(0, 200),
  };
}

export function createRoutes({ manager, rj, config, indexHtml }) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const route = `${req.method} ${url.pathname}`;
    const q = url.searchParams;

    if (route === 'GET /healthz') return send(res, 200, { ok: true });
    if (!hostAllowed(req, config)) return send(res, 403, { error: 'Neznámý hostitel.' });

    if (route === 'GET /') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(indexHtml);
    }
    if (route === 'GET /api/cities') return send(res, 200, (await rj.listCities()).map((c) => c.name).sort(collator.compare));

    if (route === 'GET /api/search') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q.get('date') ?? '')) throw new UserError('Zadej datum.');
      const [from, to] = await Promise.all([rj.resolveCity(q.get('from')), rj.resolveCity(q.get('to'))]);
      const routes = await rj.searchRoutes(from, to, q.get('date'));
      return send(res, 200, {
        from: from.name,
        to: to.name,
        routes: routes.map((r) => ({
          routeId: String(r.id), fromStationId: String(r.departureStationId), toStationId: String(r.arrivalStationId),
          departure: r.departureTime, arrival: r.arrivalTime, freeSeats: r.freeSeatsCount,
          priceFrom: r.priceFrom, bookable: r.bookable !== false,
        })),
      });
    }

    if (route === 'GET /api/seats') {
      const ids = ['routeId', 'fromStationId', 'toStationId'].map((k) => q.get(k));
      if (!ids.every(isId)) throw new UserError('Neplatné ID spoje.');
      return send(res, 200, await rj.getVehicles(...ids));
    }

    if (route === 'GET /api/job') return send(res, 200, manager.snapshot());

    if (url.pathname.startsWith('/api/job') && ['POST', 'DELETE'].includes(req.method)) {
      if (!mutationAllowed(req, config)) return send(res, 403, { error: 'Zakázáno.' });
      if (route === 'POST /api/job') {
        const { params, trip } = parseJobBody(await readJson(req));
        return send(res, 202, manager.start(params, { trip, car: params.car, seats: params.seats }));
      }
      if (route === 'POST /api/job/retry') return send(res, 202, manager.retry());
      if (route === 'DELETE /api/job') {
        await manager.stop();
        return send(res, 200, { ok: true });
      }
    }

    return send(res, 404, { error: 'Nenalezeno.' });
  };
}
