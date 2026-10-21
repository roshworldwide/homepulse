# HomePulse server and console, set up as the public "try to break in" page.
# Build:  docker build -t homepulse .
# Run:    docker run -p 8787:8787 -e ALLOWED_HOSTS=localhost homepulse   (then open http://localhost:8787)
FROM node:22.22.0-bookworm-slim

WORKDIR /app

# Install from the lockfile first, so code changes don't reinstall dependencies.
COPY package.json package-lock.json ./
COPY packages/guard/package.json packages/guard/
COPY apps/server/package.json apps/server/
COPY apps/console/package.json apps/console/
COPY harness/package.json harness/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && mkdir -p /app/data && chown -R node:node /app/data

# Public deployment defaults: no demo clock, "/" goes to the break-in page, the
# console never hands out phone tokens, and rate limits read the visitor's
# address from the load balancer's X-Forwarded-For (one proxy hop).
ENV HOST=0.0.0.0 \
    PORT=8787 \
    DEMO_MODE=false \
    HOME_PAGE=/break-it \
    CONSOLE_EXPOSE_TOKENS=false \
    TRUST_PROXY=1 \
    HOMEPULSE_TZ=America/Los_Angeles

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8787/api/break-it/stats').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
