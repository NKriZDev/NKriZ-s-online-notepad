FROM node:24-bookworm-slim AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && openssl version >/dev/null


FROM base AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable \
    && corepack prepare pnpm@10.12.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm build


FROM base AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/apps/web/dist \
    SERVE_WEB=true
WORKDIR /app

COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --chown=node:node --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --chown=node:node --from=build /app/apps/web/dist ./apps/web/dist
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data/blobs \
    && chown -R node:node /data \
    && chmod 0755 /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/server.js"]
