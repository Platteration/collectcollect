# Build a self-contained image; data (SQLite + photos) lives in the /data volume.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts are off because the one that fails here has nothing to do.
# better-sqlite3 ships compiled Node-API binaries inside the package
# (prebuilds/: glibc and musl, x64 and arm64), loads the one for this platform
# when a database is opened, and sets "gypfile": false to say no build step is
# needed. The lockfile does not record that field, so `npm ci` runs
# `node-gyp rebuild` for it anyway: with a prebuild for this platform its
# binding.gyp builds nothing, but gyp is Python and this image has none. The
# only other install script on Linux is unrs-resolver's postinstall, which
# makes sure eslint's import resolver has its platform binary, and the image
# never lints; sharp has no install script (its binaries are optional
# dependencies). With scripts off, a platform with no prebuild installs without
# a binding, and the health check never opens the database, so a database is
# opened here and a missing binding fails the build. (`next build` also happens
# to open one today, prerendering the layout's unread-alert count; this check
# does not depend on that.)
RUN npm ci --ignore-scripts \
  && node -e "new (require('better-sqlite3'))(':memory:').close()"
COPY . .
# The app ships no static assets, so there is no public/ to copy in, but the
# runtime stage copies it and COPY refuses a path that does not exist.
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/data PORT=3000 HOSTNAME=0.0.0.0
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
VOLUME ["/data"]
EXPOSE 3000
# No curl in the image: node can make the one request itself. The check goes
# by address and needs no session; the proxy allows that for this path alone.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
