import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserError } from '../errors.mjs';
import { createJobManager } from '../session.mjs';

const params = { routeId: '1', fromStationId: '2', toStationId: '3', car: 3, seats: [31, 32] };
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function setup(overrides = {}, ttlMs = 60_000) {
  const log = { displays: 0, stopped: 0, contexts: 0, closed: 0, fills: 0 };
  const context = {
    pages: () => [{}], newPage: async () => ({}), on() {},
    close: async () => { log.closed += 1; },
  };
  const deps = {
    departureInfo: async () => ({ effective: new Date(Date.now() + 1e6) }),
    assertNotDeparted: () => {},
    checkSeats: async () => 'C0',
    startDisplay: async () => { log.displays += 1; return { stop: () => { log.stopped += 1; } }; },
    launchBrowser: async () => { log.contexts += 1; return context; },
    fillCart: async () => { log.fills += 1; },
    ...overrides,
  };
  return { manager: createJobManager({ ttlMs, deps }), log };
}

const waitFor = async (manager, state) => { for (let i = 0; i < 100 && manager.snapshot()?.state !== state; i++) await tick(); };

test('happy path reaches ready', async () => {
  const { manager, log } = setup();
  manager.start(params, { trip: 't' });
  await waitFor(manager, 'ready');
  assert.equal(manager.snapshot().state, 'ready');
  assert.equal(manager.snapshot().trip, 't');
  assert.equal(log.fills, 1);
  assert.equal(manager.hasDisplay(), true);
  await manager.stop();
});

test('stop during a running fill does not crash and releases everything (regression)', async () => {
  const gate = deferred();
  const { manager, log } = setup({ checkSeats: async () => { await gate.promise; return 'C0'; } });
  const rejections = [];
  const onRejection = (e) => rejections.push(e);
  process.on('unhandledRejection', onRejection);
  try {
    manager.start(params);
    const stopping = manager.stop();
    await tick();
    gate.resolve();
    await stopping;
    await tick(30);
    assert.equal(manager.snapshot(), null);
    assert.deepEqual(rejections, []);
    assert.equal(log.displays, 0);
    assert.equal(log.fills, 0);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('stop while the browser is still launching disposes display and context', async () => {
  const gate = deferred();
  const { manager, log } = setup({ launchBrowser: async () => { await gate.promise; log2.contexts += 1; return ctx; } });
  const log2 = { contexts: 0 };
  const ctx = { pages: () => [{}], newPage: async () => ({}), on() {}, close: async () => { log.closed += 1; } };
  manager.start(params);
  await tick();
  const stopping = manager.stop();
  await tick();
  gate.resolve();
  await stopping;
  assert.equal(log.stopped, 1);
  assert.equal(log.closed, 1);
  assert.equal(manager.snapshot(), null);
});

test('a second start and a retry while busy are rejected', async () => {
  const gate = deferred();
  const { manager } = setup({ checkSeats: async () => { await gate.promise; return 'C0'; } });
  manager.start(params);
  assert.throws(() => manager.start(params), /už běží/);
  assert.throws(() => manager.retry(), /něco děje/);
  gate.resolve();
  await waitFor(manager, 'ready');
  await manager.stop();
});

test('retry refills the cart on the same browser', async () => {
  const { manager, log } = setup();
  manager.start(params);
  await waitFor(manager, 'ready');
  manager.retry();
  await tick(30);
  assert.equal(log.fills, 2);
  assert.equal(log.contexts, 1);
  assert.equal(manager.snapshot().attempts, 2);
  await manager.stop();
});

test('an unexpected failure releases the browser and reports the error', async () => {
  const { manager, log } = setup({ fillCart: async () => { throw new Error('boom'); } });
  manager.start(params);
  await waitFor(manager, 'error');
  assert.match(manager.snapshot().message, /boom/);
  assert.equal(log.closed, 1);
  assert.equal(manager.hasDisplay(), false);
});

test('taken seats on retry keep the browser and explain why', async () => {
  let calls = 0;
  const { manager, log } = setup({
    checkSeats: async () => { if (++calls > 1) throw new UserError('Tato místa nejsou volná: 31', 2); return 'C0'; },
  });
  manager.start(params);
  await waitFor(manager, 'ready');
  manager.retry();
  await waitFor(manager, 'error');
  assert.match(manager.snapshot().message, /drží tvůj košík/);
  assert.equal(log.closed, 0);
  await manager.stop();
});

test('a filled contact is reflected in the ready message', async () => {
  const { manager } = setup({ fillCart: async () => true });
  manager.start(params);
  await waitFor(manager, 'ready');
  assert.match(manager.snapshot().message, /kontakt je vyplněný/);
  await manager.stop();
});

test('a kept browser still expires after a failed retry', async () => {
  let calls = 0;
  const { manager, log } = setup({
    checkSeats: async () => { if (++calls > 1) throw new UserError('Tato místa nejsou volná: 31', 2); return 'C0'; },
  }, 60);
  manager.start(params);
  await waitFor(manager, 'ready');
  manager.retry();
  await waitFor(manager, 'error');
  assert.equal(log.closed, 0);
  await tick(200);
  assert.equal(manager.snapshot(), null);
  assert.equal(log.closed, 1);
});

test('the job expires after its TTL', async () => {
  const { manager, log } = setup({}, 30);
  manager.start(params);
  await waitFor(manager, 'ready');
  await tick(150);
  assert.equal(manager.snapshot(), null);
  assert.equal(log.closed, 1);
});

test('a dying display fails the job', async () => {
  let onExit;
  const { manager, log } = setup({ startDisplay: async (o) => { onExit = o.onExit; return { stop() { log.stopped += 1; } }; } });
  manager.start(params);
  await waitFor(manager, 'ready');
  onExit('Xvfb exited (1)');
  assert.equal(manager.snapshot().state, 'error');
  assert.match(manager.snapshot().message, /Xvfb/);
  await tick();
  assert.equal(log.closed, 1);
});
