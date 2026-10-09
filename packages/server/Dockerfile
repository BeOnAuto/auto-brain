# syntax=docker/dockerfile:1
FROM node:26.10.0-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS dependencies
RUN apt-get update \
  && apt-get install --yes --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --global --no-fund --no-audit pnpm@12.8.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches/
COPY packages/server/package.json packages/server/
COPY packages/api/package.json packages/api/
COPY packages/brains/package.json packages/brains/
COPY packages/config/package.json packages/config/
COPY packages/definitions/package.json packages/definitions/
COPY packages/identity/package.json packages/identity/
COPY packages/ledger/package.json packages/ledger/
COPY packages/mcp/package.json packages/mcp/
COPY packages/operations/package.json packages/operations/
COPY packages/outbound/package.json packages/outbound/
COPY packages/workflow-engine/package.json packages/workflow-engine/
COPY packages/workflow-host/package.json packages/workflow-host/
COPY capabilities/computation/package.json capabilities/computation/
COPY capabilities/coordination/package.json capabilities/coordination/
COPY capabilities/interaction/package.json capabilities/interaction/
COPY capabilities/reasoning/package.json capabilities/reasoning/
COPY capabilities/recall/package.json capabilities/recall/
RUN pnpm install --frozen-lockfile --prod --no-optional --ignore-scripts --filter @beonauto/server...
RUN --network=none npm_config_build_from_source=sqlite3 npm_config_nodedir=/usr/local \
  pnpm rebuild --filter @beonauto/server... sqlite3 \
  && find node_modules/.pnpm -path '*/node_modules/sqlite3/build/Release/*' -prune ! -name node_sqlite3.node \
    -exec rm -rf {} +
ARG AZURE_IDENTITY=false
RUN case "$AZURE_IDENTITY" in \
    true) pnpm install --frozen-lockfile --prod --ignore-scripts --filter @beonauto/reasoning ;; \
    false) ;; \
    *) echo "AZURE_IDENTITY is true or false, not $AZURE_IDENTITY" >&2 && exit 1 ;; \
  esac

FROM node:26.10.0-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1
LABEL org.opencontainers.image.licenses="Elastic-2.0"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=dependencies /app ./
COPY LICENSE ./
COPY docs/concepts/terminology.md docs/concepts/
COPY docs/reference/*-format.md docs/reference/
COPY packages/api/src packages/api/src
COPY packages/brains/src packages/brains/src
COPY packages/config/src packages/config/src
COPY packages/definitions/src packages/definitions/src
COPY packages/identity/src packages/identity/src
COPY packages/ledger/src packages/ledger/src
COPY packages/mcp/src packages/mcp/src
COPY packages/operations/src packages/operations/src
COPY packages/outbound/src packages/outbound/src
COPY packages/server/src packages/server/src
COPY packages/workflow-engine/src packages/workflow-engine/src
COPY packages/workflow-host/src packages/workflow-host/src
COPY capabilities/computation/src capabilities/computation/src
COPY capabilities/coordination/src capabilities/coordination/src
COPY capabilities/interaction/src capabilities/interaction/src
COPY capabilities/reasoning/src capabilities/reasoning/src
COPY capabilities/recall/src capabilities/recall/src
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && install --directory --owner=node --group=node /data \
  && ln --symbolic /data /app/data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "-e", "143", "--"]
CMD ["node", "packages/server/src/main.ts"]
