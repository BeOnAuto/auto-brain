# auto-brain

The Auto server runtime, packaged as one container image you can run anywhere.

## Run it

```bash
docker run --rm --publish 8080:8080 beonauto/auto-brain:latest
curl http://localhost:8080/health
```

| Variable | Default   | Purpose                       |
| -------- | --------- | ----------------------------- |
| `PORT`   | `8080`    | Port the server listens on    |
| `HOST`   | `0.0.0.0` | Interface the server binds to |

## Develop

Requires Node 26 (`nvm use`) and pnpm 12 (`npm install --global pnpm@12`).

```bash
pnpm install
pnpm dev          # server on http://localhost:8080 with reload on save
pnpm test:watch   # tests on save
pnpm check        # everything CI checks
```

See [CLAUDE.md](CLAUDE.md) for the layout and the rules the codebase holds to.
