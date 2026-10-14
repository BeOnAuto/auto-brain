# Run with Docker

This guide starts Auto Runtime from its image on Docker Hub, creates an API key, checks the server answers and connects an agent. It ends with a Compose file that runs the runtime beside PostgreSQL.

You need Docker Engine or Docker Desktop. The commands use the org `acme`; use your own org id throughout.

## The image

[`onauto/runtime`](https://hub.docker.com/r/onauto/runtime) is published for `linux/amd64` and `linux/arm64` with three kinds of tag:

| Tag      | Points to                                                |
| -------- | -------------------------------------------------------- |
| `0.9.1`  | Exactly that release; it never changes                   |
| `0.9`    | The newest release of the 0.9 line, moving with each fix |
| `latest` | The newest release                                       |

Pin a full version, such as `0.9.1`, wherever you need to know what is running, and upgrade on purpose. The examples use `latest`.

The server listens on port `5555`, runs as the unprivileged user `node`, keeps a SQLite ledger on the volume at `/data` unless you give it a PostgreSQL database, checks its own health at `/health`, and stops cleanly on `SIGTERM`.

## 1. Create an API key

A container listens on every interface, so every request needs an API key. The key command prints a new key once, with the entry the server needs to accept it:

```bash
docker run --rm --log-driver none onauto/runtime:latest node packages/identity/src/key-command.ts --org acme
```

```text
API key, shown only this once: abk_3e86c2be_...
API_KEYS entry: {"id":"3e86c2be","sha256":"911afdd7...","org":"acme","permissions":["org:read","org:write","playbook:read","playbook:write"],"playbooks":"*"}
```

Keep the key somewhere safe: the server stores only its SHA-256, so it cannot show the key again. `--log-driver none` keeps the key out of Docker's logs. The key may do everything in the org; `--permissions` and `--playbooks` narrow it, as [API keys](security.md#api-keys) describes.

Put the entry in a file of environment variables, inside `[` and `]`, without quotes:

```bash
echo 'API_KEYS=[{"id":"3e86c2be","sha256":"911afdd7...","org":"acme","permissions":["org:read","org:write","playbook:read","playbook:write"],"playbooks":"*"}]' > auto-runtime.env
```

For several keys, separate their entries with commas inside the brackets.

## 2. Start the server

```bash
docker volume create auto-runtime-data
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  onauto/runtime:latest
```

The named volume keeps the ledger when the container is replaced. Without it, Docker gives each container an empty anonymous volume, and its playbooks last only as long as that container.

## 3. Check that it answers {#check-that-it-answers}

```bash
curl http://localhost:5555/health
curl --header 'authorization: Bearer <your key>' http://localhost:5555/v1/orgs/acme/playbooks
```

The first answers `{"status":"ok"}` and needs no key. The second answers `{"playbooks":[]}` on a new server; without the key it answers `401`.

`docker logs auto-runtime` shows what the server read at start, one JSON object per line: where the ledger is kept, which model providers are configured, and a warning for anything missing.

## 4. Add a model provider

Reasoning functions need a model. Add your provider's key to `auto-runtime.env` and start a new container with it:

```bash
echo 'ANTHROPIC_API_KEY=<your Anthropic key>' >> auto-runtime.env
docker rm --force auto-runtime
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  onauto/runtime:latest
```

`OPENAI_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` work the same way. For Amazon Bedrock, Azure OpenAI, Google Vertex AI or a gateway of your own, see [Model providers and gateways](models.md).

## 5. Connect your agent

Agents connect to `/mcp` with the API key as a bearer token.

In Claude Code:

```bash
claude mcp add --transport http auto-runtime http://localhost:5555/mcp --header "Authorization: Bearer <your key>"
```

In Codex, which reads the key from an environment variable:

```bash
export AUTO_RUNTIME_KEY=<your key>
codex mcp add auto-runtime --url http://localhost:5555/mcp --bearer-token-env-var AUTO_RUNTIME_KEY
```

Then ask your agent to create a playbook, as [Build your first playbook](../tutorials/first-playbook.md) does. The [MCP reference](../reference/mcp.md) lists the tools a key may call, and the [HTTP API](../reference/http.md) the same operations over HTTP.

## Run with PostgreSQL

With PostgreSQL, the database holds the ledger and the container keeps nothing of its own. This Compose file runs both, with the database's data on a volume. Save it as `compose.yaml` beside `auto-runtime.env`:

```yaml
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: auto_runtime
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: auto_runtime
    volumes:
      - postgres-data:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready --username auto_runtime --dbname auto_runtime']
      interval: 5s
      retries: 12
    restart: unless-stopped

  runtime:
    image: onauto/runtime:latest
    depends_on:
      postgres:
        condition: service_healthy
    env_file: auto-runtime.env
    environment:
      DATABASE_URL: postgresql://auto_runtime:${POSTGRES_PASSWORD}@postgres:5432/auto_runtime
    ports:
      - '5555:5555'
    restart: unless-stopped

volumes:
  postgres-data:
```

Compose reads `POSTGRES_PASSWORD` from a `.env` file in the same folder. Generate one, then start both:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" > .env
docker compose up --detach
```

The runtime waits until PostgreSQL is ready, creates its tables at start and logs `The ledger is kept in PostgreSQL, in the database auto_runtime on postgres:5432`. Check it as in [step 3](#check-that-it-answers). [Use PostgreSQL](postgresql.md) covers a managed database, a user with only the privileges it needs, and TLS.

## Use a configuration file

Settings that are lists or maps, such as the [tool servers](configuration.md#mcp-servers) functions may call, model gateways and model aliases, can go in a YAML file. The image reads one only when `CONFIG_FILE` names it, so mount it read-only and name it:

```bash
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  --volume "$PWD/auto-runtime.yaml:/etc/auto-runtime/auto-runtime.yaml:ro" \
  --env CONFIG_FILE=/etc/auto-runtime/auto-runtime.yaml \
  onauto/runtime:latest
```

Secrets stay in `auto-runtime.env`; the file refers to them by name, such as `${GATEWAY_API_KEY}`. [Configure the runtime](configuration.md) describes the file and every setting.

## Upgrade

Pull the new release and replace the container. The ledger stays on its volume or in its database, and the new server migrates it at start:

```bash
docker pull onauto/runtime:latest
docker rm --force auto-runtime
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  onauto/runtime:latest
```

With Compose, run `docker compose pull` and then `docker compose up --detach`. Workflows that were waiting go on once the new server starts, and calls cut off by the stop run again. When several servers share a database, stop every server of the old version before starting the new one; see [Upgrades](production.md#upgrades).

## Back up and restore

On a volume, the ledger is three files, `ledger.db`, `ledger.db-wal` and `ledger.db-shm`, which belong together. Stop the server, copy the whole volume, and start it again:

```bash
docker stop auto-runtime
docker run --rm --volume auto-runtime-data:/data:ro --volume "$PWD/backup:/backup" alpine cp -a /data/. /backup/
docker start auto-runtime
```

To restore, stop the server, copy the files back into the volume, and start it. With PostgreSQL, use your database's own backups, or `pg_dump`; the workflows are in the same database, so one backup holds everything.

## Stop

`docker stop auto-runtime` sends `SIGTERM`: the server finishes the work it already took, records where its workflows are, and exits, usually in well under a second. Calls it cut off run again when it next starts. [Workflow operations](workflows.md#starting-stopping-and-restarting) describes the stop in detail.
