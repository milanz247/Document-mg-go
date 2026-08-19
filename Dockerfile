# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html postcss.config.js tailwind.config.js tsconfig.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    DATABASE_PATH=/app/data/atlas.sqlite \
    BACKUP_DIR=/app/backups \
    LOG_LEVEL=warn

WORKDIR /app
RUN mkdir -p /app/data /app/backups && chown -R node:node /app

COPY --from=build --chown=node:node /app/dist/server.cjs /app/dist/server.cjs
COPY --from=build --chown=node:node /app/scripts/backup.mjs /app/scripts/backup.mjs

USER node
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.cjs"]
