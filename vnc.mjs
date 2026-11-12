// Pass-through of /vnc/* to websockify on localhost (noVNC pages and its WebSocket).
import http from 'node:http';
import net from 'node:net';
import { hostAllowed, sameOrigin } from './guard.mjs';

export function createVnc({ manager, config }) {
  const upstreamPath = (req) => req.url.slice('/vnc'.length);

  function handleHttp(req, res) {
    if (!hostAllowed(req, config)) { res.writeHead(403); return res.end(); }
    if (!manager.hasDisplay()) { res.writeHead(502); return res.end('VNC neběží (žádná aktivní úloha).'); }
    const up = http.request(
      { host: '127.0.0.1', port: config.novncPort, path: upstreamPath(req), method: req.method, headers: req.headers },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
    );
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => up.destroy());
    req.pipe(up);
  }

  function handleUpgrade(req, socket, head) {
    if (!req.url.startsWith('/vnc/') || !manager.hasDisplay() || !hostAllowed(req, config) || !sameOrigin(req)) {
      return socket.destroy();
    }
    const up = net.connect(config.novncPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${upstreamPath(req)} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up);
      up.pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  }

  return { handleHttp, handleUpgrade };
}
