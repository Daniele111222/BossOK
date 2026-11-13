FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY server/package.json server/tsconfig.json ./server/
RUN npm ci --ignore-scripts --no-audit --no-fund \
    -w @bossok/contracts -w @bossok/server --include-workspace-root

COPY packages/contracts/src ./packages/contracts/src
COPY server/src ./server/src
RUN npm run build:contracts \
    && npm run build -w @bossok/server \
    && npm prune --omit=dev --ignore-scripts --no-audit --no-fund \
       -w @bossok/contracts -w @bossok/server --include-workspace-root

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY server/migrations ./server/migrations

WORKDIR /app/server
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/index.js"]
