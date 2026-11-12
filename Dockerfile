FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini xvfb x11vnc novnc websockify ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npx playwright-core install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /ms-playwright \
 && mkdir /profile && chown 10001:10001 /profile

COPY *.mjs index.html ./

USER 10001
ENV HOME=/tmp \
    REGIOJETATOR_PROFILE=/profile
EXPOSE 8080
# tini reaps the orphaned Chromium helper processes of each job.
ENTRYPOINT ["tini", "--"]
CMD ["node", "server.mjs"]
