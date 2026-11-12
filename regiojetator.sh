#!/bin/sh
# Runs the CLI inside Docker so no browser opens on the host.
# The browser window is served at http://localhost:6080/vnc.html?autoconnect=1&resize=scale
set -e
cd "$(dirname "$0")"

docker build -q -t regiojetator . >/dev/null

exec docker run --rm -it \
  -p 127.0.0.1:6080:6080 \
  -v regiojetator-profile:/profile \
  -e REGIOJETATOR_VNC=1 \
  -e REGIOJETATOR_VNC_BIND=0.0.0.0 \
  -e REGIOJETATOR_VNC_URL='http://localhost:6080/vnc.html?autoconnect=1&resize=scale' \
  --init --entrypoint node \
  regiojetator regiojetator.mjs --profile /profile "$@"
