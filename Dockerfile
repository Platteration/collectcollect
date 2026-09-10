# Build a self-contained image; data (SQLite + photos) lives in the /data volume.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Every workspace manifest has to be present before `npm ci`, or the install
# resolves against a lockfile describing a tree it cannot see.
COPY package.json package-lock.json ./
COPY apps/cards/package.json ./apps/cards/
COPY apps/skins/package.json ./apps/skins/
COPY packages/core/package.json ./packages/core/
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
RUN npm run build -w @collectcollect/cards

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/data PORT=3000 HOSTNAME=0.0.0.0
RUN mkdir -p /data && chown node:node /data
# Standalone output mirrors the workspace layout: shared node_modules at the
# root, the server under the app's own path.
COPY --from=build --chown=node:node /app/apps/cards/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/cards/.next/static ./apps/cards/.next/static
COPY --from=build --chown=node:node /app/apps/cards/public ./apps/cards/public
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "apps/cards/server.js"]
