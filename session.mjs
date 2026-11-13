// The single cart job. Everything a job owns lives on one object, and every await re-checks
// `stopping`, so a stop at any moment releases exactly what has been started and nothing leaks.
import { UserError } from './errors.mjs';

const CANCELLED = Symbol('cancelled');
async function withTimeout(p, ms) {
  let timer;
  try {
    await Promise.race([p, new Promise((resolve) => { timer = setTimeout(resolve, ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

export function createJobManager({ ttlMs, deps }) {
  let current = null;
  let displayGen = 0;

  const snapshot = () =>
    current && {
      state: current.state,
      message: current.message,
      attempts: current.attempts,
      lastFillAt: current.lastFillAt,
      expiresAt: current.lastFillAt && current.lastFillAt + ttlMs,
      displayGen: current.displayGen,
      ...current.view,
    };

  async function releaseBrowser(s) {
    const { context, display } = s;
    s.context = null;
    s.display = null;
    try { await withTimeout(context?.close(), 5000); } catch { /* already gone */ }
    display?.stop();
  }

  function fail(s, message) {
    if (current !== s || s.stopping) return;
    s.state = 'error';
    s.message = message;
    clearTimeout(s.timer);
    releaseBrowser(s).catch(console.error);
  }

  const describe = (e, retry) => {
    if (!(e instanceof UserError)) return `Chyba: ${e.message}`;
    if (retry && e.code === 2) {
      return `Místa teď nejsou volná, pravděpodobně je ještě drží tvůj košík. „Naklikat znovu“ je potřeba až po jeho vypršení.\n${e.message}`;
    }
    return e.message;
  };

  async function execute(s, retry) {
    const alive = () => { if (s.stopping) throw CANCELLED; };
    const { routeId, fromStationId, toStationId, car, seats } = s.params;
    try {
      deps.assertNotDeparted(await deps.departureInfo(routeId, fromStationId, toStationId));
      alive();
      const seatClassKey = await deps.checkSeats(routeId, fromStationId, toStationId, car, seats);
      alive();
      if (!s.display) {
        s.message = 'Spouštím displej…';
        s.display = await deps.startDisplay({ onExit: (why) => fail(s, `Displej přestal fungovat: ${why}`) });
        s.displayGen = ++displayGen;
        alive();
      }
      if (!s.context) {
        s.message = 'Spouštím prohlížeč…';
        const context = await deps.launchBrowser();
        s.context = context;
        context.on('close', () => {
          if (s.context === context) { s.context = null; fail(s, 'Prohlížeč byl zavřen.'); }
        });
        alive();
      }
      const page = s.context.pages()[0] ?? (await s.context.newPage());
      alive();
      s.message = 'Dávám místa do košíku…';
      const contactFilled = await deps.fillCart(page, { route: { routeId, fromStationId, toStationId }, car, seats, seatClassKey });
      alive();
      s.attempts += 1;
      s.lastFillAt = Date.now();
      s.state = 'ready';
      s.message = contactFilled
        ? 'Místa jsou v košíku a kontakt je vyplněný. Zaškrtni souhlas s podmínkami a dokonči rezervaci v okně níže.'
        : 'Místa jsou v košíku. Dokonči rezervaci v okně níže.';
      s.timer = setTimeout(() => stop().catch(console.error), ttlMs);
    } catch (e) {
      if (e === CANCELLED || s.stopping) return;
      s.state = 'error';
      s.message = describe(e, retry);
      // A stale selection or an unknown failure leaves nothing worth keeping open.
      if (!(e instanceof UserError) || e.code === 3) await releaseBrowser(s);
      else s.timer = setTimeout(() => stop().catch(console.error), ttlMs);
    } finally {
      s.busy = false;
    }
  }

  function run(s, retry) {
    if (s.busy) throw new UserError('Právě se něco děje, počkej na dokončení.');
    s.busy = true;
    clearTimeout(s.timer);
    s.state = 'starting';
    s.message = 'Ověřuji místa…';
    s.running = execute(s, retry);
  }

  function start(params, view = {}) {
    if (current) throw new UserError('Úloha už běží. Nejdřív ji ukonči.');
    current = {
      params, view, state: 'starting', message: 'Startuji…', attempts: 0, lastFillAt: null,
      busy: false, stopping: false, display: null, context: null, timer: null, displayGen: 0, running: null,
    };
    run(current, false);
    return snapshot();
  }

  function retry() {
    if (!current) throw new UserError('Žádná úloha neběží.');
    if (current.stopping) throw new UserError('Úloha se ukončuje.');
    run(current, true);
    return snapshot();
  }

  async function stop() {
    const s = current;
    if (!s) return;
    s.stopping = true;
    s.state = 'stopping';
    s.message = 'Ukončuji…';
    clearTimeout(s.timer);
    await withTimeout(s.running, 30000);
    await releaseBrowser(s);
    if (current === s) current = null;
  }

  return { start, retry, stop, snapshot, hasDisplay: () => Boolean(current?.display) };
}
