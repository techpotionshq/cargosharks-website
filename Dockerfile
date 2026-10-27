# cargosharks.com, as one image: the site, the blog's CMS and its admin.
#
# `next build` with `output: 'standalone'` traces what the server imports into
# `.next/standalone`; that, the static assets and `public/` are all production
# needs. Marketing pages are prerendered into it as files; the blog, `/admin`
# and the API read PostgreSQL at request time (`DATABASE_URL`). Traefik, run by
# Coolify, is the router in front; this container only answers on its port.
#
# Migrations run when the server starts (`prodMigrations` in
# `src/payload.config.ts`), so a deploy needs no separate step and the build
# needs no database.

FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# From the plain image: this stage never runs pnpm, so neither corepack nor a
# pnpm shim belongs in production.
FROM node:24-bookworm-slim AS site
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# The blog's daily drafting run, started in this container by a Coolify
# scheduled task (`node scripts/cron.mjs`); scripts/blog/README.md has the setup.
COPY --chown=node:node scripts/cron.mjs ./scripts/cron.mjs

# Uploaded images. Mount a volume here, or every redeploy loses them: the
# database keeps the rows, the files would be gone.
ENV MEDIA_DIR=/app/media
RUN mkdir -p /app/media && chown node:node /app/media
VOLUME ["/app/media"]

USER node
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
EXPOSE 3002

# `/robots.txt` is prerendered, so the check says the server is up without
# making every probe a database read.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
