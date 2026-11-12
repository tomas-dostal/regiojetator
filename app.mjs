// Wires routes and the VNC proxy into one HTTP server (dependencies are injected for tests).
import http from 'node:http';
import { UserError } from './errors.mjs';
import { createRoutes, send } from './routes.mjs';
import { createVnc } from './vnc.mjs';

export function createApp({ manager, rj, config, indexHtml }) {
  const handle = createRoutes({ manager, rj, config, indexHtml });
  const vnc = createVnc({ manager, config });

  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/vnc/')) return vnc.handleHttp(req, res);
    try {
      await handle(req, res);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof UserError) return send(res, 400, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Interní chyba.' });
    }
  });
  server.on('upgrade', vnc.handleUpgrade);
  return server;
}
