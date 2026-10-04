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
COPY packages/identity/package.json packages/identity/
COPY packages/ledger/package.json packages/ledger/
COPY packages/operations/package.json packages/operations/
COPY packages/specs/package.json packages/specs/
COPY primitives/inference/package.json primitives/inference/
COPY primitives/orchestration/package.json primitives/orchestration/
RUN pnpm install --frozen-lockfile --prod --no-optional --ignore-scripts --filter @beonauto/server...
RUN --network=none npm_config_build_from_source=sqlite3 npm_config_nodedir=/usr/local \
  pnpm rebuild --filter @beonauto/server... sqlite3 \
  && find node_modules/.pnpm -path '*/node_modules/sqlite3/build/Release/*' -prune ! -name node_sqlite3.node \
    -exec rm -rf {} +
RUN bridge="$(echo node_modules/.pnpm/@temporalio+core-bridge@*/node_modules/@temporalio/core-bridge)" \
  && target="$(node -p "({ x64: 'x86_64', arm64: 'aarch64' })[process.arch] + '-unknown-linux-gnu'")" \
  && test -f "$bridge/releases/$target/index.node" \
  && find "$bridge/releases" -mindepth 1 -maxdepth 1 ! -name "$target" -exec rm -rf {} + \
  && rm -rf "$bridge/sdk-core"
ARG AZURE_IDENTITY=false
RUN case "$AZURE_IDENTITY" in \
    true) pnpm install --frozen-lockfile --prod --ignore-scripts --filter @beonauto/inference ;; \
    false) ;; \
    *) echo "AZURE_IDENTITY is true or false, not $AZURE_IDENTITY" >&2 && exit 1 ;; \
  esac

FROM --platform=$BUILDPLATFORM node:26.10.0-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS workflow-bundle
WORKDIR /app
RUN npm install --global --no-fund --no-audit pnpm@12.8.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches/
COPY packages/config/package.json packages/config/
COPY packages/operations/package.json packages/operations/
COPY packages/specs/package.json packages/specs/
COPY primitives/orchestration/package.json primitives/orchestration/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @beonauto/orchestration...
COPY primitives/orchestration/build-workflow-bundle.ts primitives/orchestration/
COPY primitives/orchestration/src primitives/orchestration/src
RUN node primitives/orchestration/build-workflow-bundle.ts /app/workflow-bundle

FROM node:26.10.0-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1
LABEL org.opencontainers.image.licenses="Elastic-2.0"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 LEDGER_FILE=/data/ledger.db \
  ORCHESTRATION_WORKFLOW_BUNDLE=/app/workflow-bundle
WORKDIR /app
COPY --from=dependencies /app ./
COPY LICENSE ./
COPY packages/api/src packages/api/src
COPY packages/brains/src packages/brains/src
COPY packages/config/src packages/config/src
COPY packages/identity/src packages/identity/src
COPY packages/ledger/src packages/ledger/src
COPY packages/operations/src packages/operations/src
COPY packages/server/src packages/server/src
COPY packages/specs/src packages/specs/src
COPY primitives/inference/src primitives/inference/src
COPY primitives/orchestration/src primitives/orchestration/src
COPY primitives/orchestration/check-workflow-bundle.ts primitives/orchestration/
COPY --from=workflow-bundle /app/workflow-bundle workflow-bundle
RUN node primitives/orchestration/check-workflow-bundle.ts /app/workflow-bundle
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && install --directory --owner=node --group=node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "-e", "143", "--"]
CMD ["node", "packages/server/src/main.ts"]
