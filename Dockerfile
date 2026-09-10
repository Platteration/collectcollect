# Build a self-contained image for one of the apps in this workspace.
#
#   docker build -t collectcollect .                          # the card app
#   docker build -t collectcollect-skins --build-arg APP=skins .
#   docker build -t collectcollect-whisky --build-arg APP=whisky .   # or retro-games, comics, watches
#
# Data (SQLite, photos, and the Markdown copy) lives in the /data volume.
ARG APP=cards

FROM node:22-bookworm-slim AS build
ARG APP
WORKDIR /app
# Every workspace manifest has to be present before `npm ci`, or the install
# resolves against a lockfile describing a tree it cannot see.
COPY package.json package-lock.json ./
COPY apps/cards/package.json ./apps/cards/
COPY apps/skins/package.json ./apps/skins/
COPY apps/retro-games/package.json ./apps/retro-games/
COPY apps/comics/package.json ./apps/comics/
COPY apps/watches/package.json ./apps/watches/
COPY apps/whisky/package.json ./apps/whisky/
COPY packages/core/package.json ./packages/core/
COPY packages/create-domain/package.json ./packages/create-domain/
RUN npm ci
# .dockerignore keeps every `data` directory out of the context, which is
# load-bearing rather than tidiness: the file tracer resolves the database path
# statically, so a data directory present at build time is packaged into the
# standalone output and from there into this image.
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
RUN npm run build -w @collectcollect/${APP}
# Not every app has static files of its own, and a COPY of a directory that is
# not there fails the build. One that is empty costs nothing.
RUN mkdir -p apps/${APP}/public

FROM node:22-bookworm-slim AS runtime
ARG APP
WORKDIR /app
# Each app reads its own data directory variable, so all of them are set to the
# volume and each image uses the one that is its own.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
ENV DATA_DIR=/data SKINS_DATA_DIR=/data RETRO_GAMES_DATA_DIR=/data COMICS_DATA_DIR=/data WATCHES_DATA_DIR=/data WHISKY_DATA_DIR=/data
ENV APP_DIR=apps/${APP}
RUN mkdir -p /data && chown node:node /data
# Standalone output mirrors the workspace layout: shared node_modules at the
# root, the server under the app's own path.
COPY --from=build --chown=node:node /app/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=node:node /app/apps/${APP}/public ./apps/${APP}/public
USER node
VOLUME ["/data"]
EXPOSE 3000
# Shell form, so the app chosen at build time is read from the environment;
# CMD cannot see a build argument directly.
CMD node ${APP_DIR}/server.js
