# regiojetator

Puts chosen seats of a RegioJet train into the cart, once. The user finishes the purchase;
nothing is paid, and nothing is refreshed or held in the background.

## Web UI

`node server.mjs` (the Docker image's default command) serves on port 8080: search a connection,
pick a car and seats, put them into the cart, then finish the reservation in a noVNC window embedded
in the page. "Naklikat znovu" repeats the cart step on explicit click once the short-lived cart has
expired. Chromium, Xvfb and VNC run only while a job exists; the job is stopped `JOB_TTL_MIN` minutes
after the last cart fill.

There is no authentication. Restrict access at the ingress (VPN only). The app additionally checks the
`Host` header against `ALLOWED_HOSTS`, and mutating calls need an `X-Regiojetator` header and a same-origin `Origin`.

## CLI in Docker

```sh
./regiojetator.sh --from Praha --to Košice --date 2026-11-19 --time 07:41 --car 3 --seats 31-36
```

The browser window is at <http://localhost:6080/vnc.html?autoconnect=1&resize=scale>.
`--dry-run` only verifies the train and the seats; `--help` lists all options.

## Configuration (environment, read once in `config.mjs`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP port |
| `ALLOWED_HOSTS` | `localhost:PORT,127.0.0.1:PORT` | Accepted `Host` headers, comma separated |
| `JOB_TTL_MIN` | 60 | Minutes after the last cart fill before the browser is stopped |
| `REGIOJETATOR_BROWSER` | `chromium` | `chromium` (Playwright's) or `chrome` (installed) |
| `REGIOJETATOR_PROFILE` | `~/.regiojetator/profile` | Browser profile directory (`/profile` in the image) |
| `REGIOJETATOR_WINDOW_SIZE` | `1440,900` | Browser window and virtual display size |
| `REGIOJETATOR_EMAIL` | empty | E-mail typed into the passenger step after the cart (never logged or shown in the UI) |
| `REGIOJETATOR_PHONE` | empty | Phone typed into the same step (optional on the site, default prefix +420) |
| `REGIOJETATOR_VNC_BIND` | `127.0.0.1` | Bind address of noVNC (CLI in Docker uses `0.0.0.0`) |

## Behaviour

- Trains are matched on date and departure time; a departed train is refused, a delayed one uses its predicted departure.
- Occupied seats abort with the list of free seats in the car (CLI exit code 2).
- The selection shown on the site is compared with the request before continuing.
- RegioJet allows at most 6 passengers per order.
- With `REGIOJETATOR_EMAIL`/`REGIOJETATOR_PHONE` set, the cart step continues to the passenger page and fills those two fields. Consent to the terms and the final button stay with the user.

## Memory

Measured in the container on the checkout page: idle ~85 MB, with an active job ~520 MB of anonymous
memory (about 140 MB of it is Node, Xvfb and VNC, the rest is Chromium). Chromium flags barely help.

## Tests

`npm test` (Node's built-in runner, no extra dependencies).

API notes: `NOTES.md`.
