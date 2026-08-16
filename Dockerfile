# The web application, built for Coolify against a remote Postgres.
#
# Lives at the repository root because Coolify's Dockerfile build pack looks
# for `./Dockerfile` by default and the build context has to be the workspace
# root regardless — `apps/web` depends on three workspace packages and the
# lockfile, none of which are reachable from inside its own directory.
#
# Nothing here is Coolify-specific. The image is a Next.js standalone server on
# port 3000 that takes its entire configuration from the environment.

# --- shared base -----------------------------------------------------------
# Node 22 to match `engines` in the root manifest. `corepack` pins pnpm to the
# `packageManager` field rather than to whatever the image happens to ship.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# --- build -----------------------------------------------------------------
FROM base AS build

# Manifests first, so the install layer is cached until a dependency actually
# changes. Every workspace project is copied even though only `@qabandi/web`
# and its three packages are built: `--frozen-lockfile` compares the lockfile
# against the whole workspace, and a missing `apps/service/package.json` reads
# as a lockfile that is out of date.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/service/package.json apps/service/
COPY apps/web/package.json apps/web/
COPY packages/brand/package.json packages/brand/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

COPY . .

# No database is reached during the build. Every route is server-rendered on
# demand — the root layout reads a cookie, which opts the whole tree out of
# prerendering — so `next build` needs no connection string and cannot bake
# one deployment's data into another's image.
RUN pnpm --filter @qabandi/web build \
 && pnpm --filter @qabandi/db build:migrate

# --- runtime ---------------------------------------------------------------
# From the plain image rather than `base`: the standalone output carries its
# own traced `node_modules`, so pnpm, the lockfile and every devDependency stay
# in the build stage.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The pilot fixtures are the fallback when no database is configured, which is
# right on a laptop and wrong here: a deployment that lost its connection
# string would come up serving seeded demo data to the operator instead of
# failing. Pinned off, a missing DATABASE_URL is a startup error naming itself.
# Set it to 1 in Coolify for a fixture-backed demo deployment.
ENV QABANDI_PILOT_FIXTURES=0

# `.next/standalone` unpacks to `apps/web/server.js` with `node_modules` at the
# root, mirroring the workspace. `static` and `public` are deliberately not
# included by the tracer — Next assumes a CDN — so they are copied in and the
# server picks them up from those exact paths.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

# The migration runner and the SQL it applies. `migrate.mjs` resolves
# `../migrations` from its own directory, which is why the folder sits beside
# `db/` rather than inside it. Both are inert unless RUN_MIGRATIONS is set.
COPY --from=build --chown=node:node /app/packages/db/dist/migrate.mjs ./db/migrate.mjs
COPY --from=build --chown=node:node /app/packages/db/migrations ./migrations

COPY infra/web-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

USER node
EXPOSE 3000

# `/` redirects to the sign-in form or the actor's shell, so it exercises
# routing and rendering without needing a session. Any response short of a 5xx
# means the server is up; the check deliberately does not fail on a database
# outage, because taking the container down would not fix one.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint"]
CMD ["node", "apps/web/server.js"]
