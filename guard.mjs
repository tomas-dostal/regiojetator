// Request guards. Access is VPN-only at the ingress; these stop other web pages from reaching the app
// through the user's browser (cross-site requests and DNS rebinding).
export const hostAllowed = (req, config) =>
  config.allowedHosts.includes(String(req.headers.host ?? '').toLowerCase());

/** Requests without an Origin header pass; a browser always sends one on cross-site calls. */
export const sameOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
};

/** The custom header forces a CORS preflight, which this server never answers. */
export const mutationAllowed = (req, config) =>
  req.headers['x-regiojetator'] === '1' && sameOrigin(req) && hostAllowed(req, config);
