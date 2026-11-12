import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.mjs';

const config = { allowedHosts: ['good.test'], novncPort: 1 };
const calls = [];
const manager = {
  start: (params, view) => { calls.push(['start', params, view]); return { state: 'starting' }; },
  retry: () => { calls.push(['retry']); return { state: 'starting' }; },
  stop: async () => { calls.push(['stop']); },
  snapshot: () => null,
  hasDisplay: () => false,
};
const rj = { listCities: async () => [{ name: 'Řevnice' }, { name: 'Zlín' }, { name: 'Čelákovice' }] };
const server = createApp({ manager, rj, config, indexHtml: '<html></html>' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
test.after(() => server.close());

const call = (method, path, { headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: 'good.test', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });

const ok = { 'X-Regiojetator': '1', 'Content-Type': 'application/json' };
const body = JSON.stringify({ routeId: '1', fromStationId: '2', toStationId: '3', car: 3, seats: [31, 31, 30], trip: 'x' });

test('healthz answers on any host, everything else needs an allowed host', async () => {
  assert.equal((await call('GET', '/healthz', { headers: { Host: '10.0.0.1:8080' } })).status, 200);
  assert.equal((await call('GET', '/api/job', { headers: { Host: 'evil.test' } })).status, 403);
  assert.equal((await call('GET', '/api/job')).status, 200);
});

test('mutations need the custom header, a same origin and an allowed host', async () => {
  calls.length = 0;
  assert.equal((await call('POST', '/api/job', { body })).status, 403);
  assert.equal((await call('POST', '/api/job', { headers: { ...ok, Origin: 'http://evil.test' }, body })).status, 403);
  assert.equal((await call('POST', '/api/job', { headers: { ...ok, Host: 'evil.test' }, body })).status, 403);
  assert.equal((await call('DELETE', '/api/job')).status, 403);
  assert.deepEqual(calls, []);
});

test('a valid job body is normalised and started', async () => {
  calls.length = 0;
  const res = await call('POST', '/api/job', { headers: { ...ok, Origin: 'http://good.test' }, body });
  assert.equal(res.status, 202);
  assert.deepEqual(calls[0][1], { routeId: '1', fromStationId: '2', toStationId: '3', car: 3, seats: [30, 31] });
});

test('invalid bodies are rejected before reaching the manager', async () => {
  calls.length = 0;
  const bad = [
    { routeId: 'x', fromStationId: '2', toStationId: '3', car: 3, seats: [1] },
    { routeId: '1', fromStationId: '2', toStationId: '3', car: 3, seats: [1, 2, 3, 4, 5, 6, 7] },
    { routeId: '1', fromStationId: '2', toStationId: '3', car: 99, seats: [1] },
  ];
  for (const b of bad) assert.equal((await call('POST', '/api/job', { headers: ok, body: JSON.stringify(b) })).status, 400);
  assert.equal((await call('POST', '/api/job', { headers: ok, body: '{nope' })).status, 400);
  assert.deepEqual(calls, []);
});

test('retry and stop reach the manager', async () => {
  calls.length = 0;
  assert.equal((await call('POST', '/api/job/retry', { headers: ok })).status, 202);
  assert.equal((await call('DELETE', '/api/job', { headers: ok })).status, 200);
  assert.deepEqual(calls.map((c) => c[0]), ['retry', 'stop']);
});

test('cities are sorted with Czech collation', async () => {
  const res = await call('GET', '/api/cities');
  assert.deepEqual(JSON.parse(res.body), ['Čelákovice', 'Řevnice', 'Zlín']);
});

test('vnc proxy refuses when no display runs', async () => {
  assert.equal((await call('GET', '/vnc/vnc.html')).status, 502);
});
