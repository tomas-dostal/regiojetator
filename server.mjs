import fs from 'node:fs';
import { config } from './config.mjs';
import * as rj from './regiojet.mjs';
import { startDisplay, launchBrowser, fillCart } from './browser.mjs';
import { createJobManager } from './session.mjs';
import { createApp } from './app.mjs';

const manager = createJobManager({
  ttlMs: config.jobTtlMs,
  deps: {
    departureInfo: rj.departureInfo, assertNotDeparted: rj.assertNotDeparted, checkSeats: rj.checkSeats,
    startDisplay, launchBrowser, fillCart,
  },
});
const indexHtml = fs.readFileSync(new URL('./index.html', import.meta.url));
const server = createApp({ manager, rj, config, indexHtml });

const shutdown = async () => {
  await manager.stop();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(config.port, () => {
  console.log(`regiojetator on :${config.port}, browser=${config.browser}, profile=${config.profile}, hosts=${config.allowedHosts.join(',')}`);
});
