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

`pnpm dev` starts Temporal's dev server on `127.0.0.1:7233`, with its web UI on `http://127.0.0.1:8233`, and then the server, pointed at it. The first run downloads the Temporal CLI the tests also use, v1.9.1, about 150 MB unpacked, into your temporary directory, and says so; later runs start in about a second. The ledger and Temporal's state live side by side in `packages/server/.data`, so brains, specs and waiting workflows are still there after a restart; delete that directory to start over.

Saving a `.ts` file other than a test under the `src` of any package of the repository, or `packages/server/dev.env`, `.env` or the configuration file, restarts the server through its clean shutdown, while Temporal keeps running. A server that does not start says why and starts again on the next save. Ctrl-C stops both.

When a Temporal already answers on `127.0.0.1:7233`, `pnpm dev` uses it and starts none. `TEMPORAL_ADDRESS`, in the shell or in `.env`, names another Temporal and starts none. When something else holds the port, or the CLI cannot be downloaded or started, the server starts without workflows and one line says why and how to get them. `pnpm dev:lean` runs the server alone, without Temporal and without workflows.

`packages/server/dev.env` sets `LOG_FORMAT=pretty`, so the logs read as lines of text; lines from `pnpm dev` itself are marked `[dev]`, and Temporal's `[temporal]`. Don't run the server by hand under `node --watch` with `TEMPORAL_ADDRESS` set: in watch mode Node sends messages from worker threads that `@temporalio/worker` 1.24.0 mistakes for its own, and the server crashes. `pnpm dev` restarts the server itself instead.

For a packaged deployment, see [Run in a container](container.md).
