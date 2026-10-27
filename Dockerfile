# cargosharks.com, as one image.
#
# The site is a static export (`next build` writes `out/`), served by
# `scripts/preview.mjs`: no rewrites, no SPA fallback, a real 404 with a 404
# status, and nothing imported but Node's own `http` and `fs`. Traefik, run by
# Coolify, is the router in front; this container only answers on its port.
#
# Moved from the product repository's Dockerfile (its `landing` stage) with the
# website, unchanged in behaviour.

FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
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
COPY --from=build --chown=node:node /app/out ./out
COPY --chown=node:node scripts/preview.mjs ./scripts/preview.mjs
# The blog's daily cron, run in this container by a Coolify scheduled task
# (`node scripts/trigger.mjs`); scripts/blog/README.md has the setup.
COPY --chown=node:node scripts/blog/trigger.mjs ./scripts/trigger.mjs

USER node
ENV PORT=3002
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/preview.mjs"]
