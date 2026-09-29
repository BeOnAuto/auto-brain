# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:26.10.0-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS dependencies
WORKDIR /app
RUN npm install --global --no-fund --no-audit pnpm@12.8.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @beonauto/server...

FROM node:26.10.0-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=dependencies --chown=node:node /app ./
COPY --chown=node:node packages/config/src packages/config/src
COPY --chown=node:node apps/server/src apps/server/src
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/server/src/main.ts"]
