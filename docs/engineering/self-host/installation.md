# Install and run from source

Clone the public repository, then follow the [first-brain guide](../get-started/self-hosted.md) to install dependencies, configure a model and connect your agent.

```sh
git clone https://github.com/BeOnAuto/auto-brain.git
cd auto-brain
pnpm install
cp .env.example .env
```

The repository pins pnpm and Node in `package.json`; pnpm downloads the required Node runtime during installation. The contributor setup and runtime use those pinned versions.

## Development server

`pnpm dev` starts the server, which runs workflows itself, and nothing else. The ledger, and with it the workflows, lives in `packages/server/.data/ledger.db`, so brains, specs and waiting workflows are still there after a restart; delete that directory to start over.

Saving a `.ts` file other than a test under the `src` of any package of the repository, or `packages/server/dev.env`, `.env` or the configuration file, restarts the server through its clean shutdown; a workflow waiting for an event or a timer goes on after the restart, and a call cut off by it runs again. A server that does not start says why and starts again on the next save. Ctrl-C stops it.

`packages/server/dev.env` sets `LOG_FORMAT=pretty`, so the logs read as lines of text; lines from `pnpm dev` itself are marked `[dev]`.

For a packaged deployment, see [Run in a container](container.md).
