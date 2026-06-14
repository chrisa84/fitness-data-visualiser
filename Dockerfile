# Single-container build: the Fastify server serves the API and the built web
# bundle from one image. Intended for a single-VM deploy (e.g. Coolify).

# --- Build stage: install deps + build web ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 is the only native dependency. On this image it normally pulls a
# prebuilt binary and skips compilation; the toolchain below is a fallback for
# when no prebuilt matches (it lives only in this build stage, not the runtime
# image). Remove these three lines for a leaner build if the prebuilt always
# resolves for your platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy manifests first for layer caching, then install the whole workspace.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY . .
RUN npm run build -w web

# --- Runtime stage: copy installed modules + source + built web bundle ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist

# Serve the bundled web app, listen on all interfaces, and read/write databases
# from a mounted /data volume. Override GARMIN_DB_PATH/EVENTS_DB_PATH as needed.
ENV HOST=0.0.0.0 \
    PORT=3001 \
    WEB_DIST_PATH=/app/web/dist \
    GARMIN_DB_PATH=/data/garmin_sync.db \
    EVENTS_DB_PATH=/data/visualiser-events.db

EXPOSE 3001
CMD ["npx", "--no-install", "tsx", "server/src/index.ts"]
