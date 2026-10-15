# Run with Docker

This guide starts Auto Runtime from its image on Docker Hub, checks the server answers, connects an agent and signs you in through the Auto identity service. It then gives a machine or a pipeline an API key, and ends with a Compose file that runs the runtime beside PostgreSQL.

You need Docker Engine or Docker Desktop, and a browser on the same machine to sign in with.

## The image

[`onauto/runtime`](https://hub.docker.com/r/onauto/runtime) is published for `linux/amd64` and `linux/arm64` with three kinds of tag:

| Tag      | Points to                                                |
| -------- | -------------------------------------------------------- |
| `0.9.1`  | Exactly that release; it never changes                   |
| `0.9`    | The newest release of the 0.9 line, moving with each fix |
| `latest` | The newest release                                       |

Pin a full version, such as `0.9.1`, wherever you need to know what is running, and upgrade on purpose. The examples use `latest`.

The server listens on port `5555`, runs as the unprivileged user `node`, keeps a SQLite ledger on the volume at `/data` unless you give it a PostgreSQL database, checks its own health at `/health`, and stops cleanly on `SIGTERM`.

## 1. Start the server {#start-the-server}

A person signs in through the Auto identity service, and the runtime needs the address it is reached at, `PUBLIC_URL`, and a key to seal the secrets it keeps under, `SECRETS_KEY`, 32 random bytes in base64. Put both in a file of environment variables, which later steps add to, and start the server with a volume for its ledger:

```bash
echo 'PUBLIC_URL=http://localhost:5555' > auto-runtime.env
echo "SECRETS_KEY=$(openssl rand -base64 32)" >> auto-runtime.env
docker volume create auto-runtime-data
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 127.0.0.1:5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  onauto/runtime:latest
```

`--publish 127.0.0.1:5555:5555` publishes the port on this machine's loopback address alone. An `http` address is for a runtime reached on its own machine, since a token sent over plain HTTP between machines can be read on the way; to reach the runtime from other machines, put HTTPS in front of it and set `PUBLIC_URL` to its `https` address, as [Run in production](production.md#put-https-in-front) describes.

The named volume keeps the ledger when the container is replaced. Without it, Docker gives each container an empty anonymous volume, and its playbooks last only as long as that container.

`SECRETS_KEY` stays out of the volume, so a copy of the volume holds no secret anyone can read without it. Without `SECRETS_KEY` the server would make a key itself, in `secrets.key` on the volume beside the ledger, where a copy of the volume would carry it. Keep a copy of the key with your other secrets: a secret sealed under a lost key cannot be read again. Where there is no `openssl`, `docker run --rm onauto/runtime:latest node --print "require('node:crypto').randomBytes(32).toString('base64')"` makes one too.

## 2. Check that it answers {#check-that-it-answers}

```bash
curl http://localhost:5555/health
curl --include http://localhost:5555/v1/orgs/acme/playbooks
```

The first answers `{"status":"ok"}` and needs no credential. The second answers `401` with `WWW-Authenticate: Bearer resource_metadata="http://localhost:5555/.well-known/oauth-protected-resource", scope="user:org:read"`, which tells an agent where to sign you in.

`docker logs auto-runtime` shows what the server read at start, one JSON object per line: where the ledger is kept, which model providers are configured, the identity service persons sign in through with the audience of their tokens, and a warning for anything missing.

## 3. Connect your agent and sign in {#connect-your-agent}

Agents connect to `/mcp`. In Claude Code:

```bash
claude mcp add --transport http auto-runtime http://localhost:5555/mcp
```

In Codex:

```bash
codex mcp add auto-runtime --url http://localhost:5555/mcp
```

The first time your agent connects, it opens the Auto identity service in your browser. Sign in and choose your organization: you act in the org whose id is that organization's, with every permission over every playbook there, as [Signed-in persons](security.md#signed-in-persons) describes. In Claude Code, `/mcp` shows whether `auto-runtime` is connected, and offers the sign-in while it is not.

Then ask your agent to create a playbook, as [Build your first playbook](../tutorials/first-playbook.md) does. The [MCP reference](../reference/mcp.md) lists the tools, and the [HTTP API](../reference/http.md) the same operations over HTTP.

## 4. Add a model provider {#add-a-model-provider}

Reasoning functions need a model. Add your provider's key to `auto-runtime.env` and start a new container with it:

```bash
echo 'ANTHROPIC_API_KEY=<your Anthropic key>' >> auto-runtime.env
docker rm --force auto-runtime
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 127.0.0.1:5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  onauto/runtime:latest
```

`OPENAI_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` work the same way. For Amazon Bedrock, Azure OpenAI, Google Vertex AI or a gateway of your own, see [Model providers and gateways](models.md).

## Keys for machines and pipelines

A machine, a pipeline or a trainer's agent signs in nowhere, and some callers need a grant narrower than a signed-in person's, such as reading one playbook. Each of them calls with an API key, and keys work beside sign-in. The key command prints a new key once, with the entry the server needs to accept it; the commands use the org `acme`, so use your own org id:

```bash
docker run --rm --log-driver none onauto/runtime:latest node packages/identity/src/key-command.ts --org acme
```

```text
API key, shown only this once: abk_3e86c2be_...
API_KEYS entry: {"id":"3e86c2be","sha256":"911afdd7...","org":"acme","permissions":["org:read","org:write","playbook:read","playbook:write"],"playbooks":"*"}
```

Keep the key somewhere safe: the server stores only its SHA-256, so it cannot show the key again. `--log-driver none` keeps the key out of Docker's logs. The key may do everything in the org; `--permissions` and `--playbooks` narrow it, as [API keys](security.md#api-keys) describes.

Add the entry to `auto-runtime.env`, inside `[` and `]`, without quotes, and start a new container with it as in [step 4](#add-a-model-provider):

```bash
echo 'API_KEYS=[{"id":"3e86c2be","sha256":"911afdd7...","org":"acme","permissions":["org:read","org:write","playbook:read","playbook:write"],"playbooks":"*"}]' >> auto-runtime.env
```

For several keys, separate their entries with commas inside the brackets. A caller sends its key as a bearer token, over HTTP or to `/mcp`:

```bash
curl --header 'authorization: Bearer <your key>' http://localhost:5555/v1/orgs/acme/playbooks
claude mcp add --transport http auto-runtime http://localhost:5555/mcp --header "Authorization: Bearer <your key>"
```

Codex reads the key from an environment variable:

```bash
export AUTO_RUNTIME_KEY=<your key>
codex mcp add auto-runtime --url http://localhost:5555/mcp --bearer-token-env-var AUTO_RUNTIME_KEY
```

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
      - '127.0.0.1:5555:5555'
    restart: unless-stopped

volumes:
  postgres-data:
```

The runtime takes `SECRETS_KEY` from `auto-runtime.env`, as in [step 1](#start-the-server); a ledger in PostgreSQL needs it, and the runtime stops at start without it. Compose reads `POSTGRES_PASSWORD` from a `.env` file in the same folder. Generate one, then start both:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" > .env
docker compose up --detach
```

The runtime waits until PostgreSQL is ready, creates its tables at start and logs `The ledger is kept in PostgreSQL, in the database auto_runtime on postgres:5432`. Check it as in [step 2](#check-that-it-answers). [Use PostgreSQL](postgresql.md) covers a managed database, a user with only the privileges it needs, and TLS.

## Use a configuration file

Settings that are lists or maps, such as the [tool servers](configuration.md#tool-servers) functions may call, model gateways and model aliases, can go in a YAML file. The image reads one only when `CONFIG_FILE` names it, so mount it read-only and name it:

```bash
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 127.0.0.1:5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  --volume "$PWD/auto-runtime.yaml:/etc/auto-runtime/auto-runtime.yaml:ro" \
  --env CONFIG_FILE=/etc/auto-runtime/auto-runtime.yaml \
  onauto/runtime:latest
```

Secrets stay in `auto-runtime.env`; the file refers to them by name, such as `${GATEWAY_API_KEY}`. The OpenAPI document of an `openapi` tool server, when its entry in `tool_servers` names it by a path, is read at start from the directory of the file, so mount it there too, as `--volume "$PWD/billing.json:/etc/auto-runtime/billing.json:ro"`, or name it by an https URL the container can reach; a document the server cannot read stops the start, naming the entry. [Configure the runtime](configuration.md) describes the file and every setting.

## Upgrade

Pull the new release and replace the container. The ledger stays on its volume or in its database, and the new server migrates it at start:

```bash
docker pull onauto/runtime:latest
docker rm --force auto-runtime
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 127.0.0.1:5555:5555 --env-file auto-runtime.env --volume auto-runtime-data:/data \
  onauto/runtime:latest
```

With Compose, run `docker compose pull` and then `docker compose up --detach`. Workflows that were waiting go on once the new server starts, and calls cut off by the stop run again. When several servers share a database, stop every server of the old version before starting the new one; see [Upgrades](production.md#upgrades).

## Rotate the secrets key

To replace `SECRETS_KEY`, move its value to `SECRETS_KEY_PREVIOUS`, add a new key, and start a new container as in [step 4](#add-a-model-provider):

```bash
sed 's/^SECRETS_KEY=/SECRETS_KEY_PREVIOUS=/' auto-runtime.env > auto-runtime.env.next
echo "SECRETS_KEY=$(openssl rand -base64 32)" >> auto-runtime.env.next
mv auto-runtime.env.next auto-runtime.env
```

At start the server seals again under the new key what the old one sealed, and `docker logs auto-runtime` says how many: `Secrets are kept sealed under the key <id>, and <count> sealed under the previous key were sealed again under it`. Then delete the `SECRETS_KEY_PREVIOUS` line from `auto-runtime.env` and start a new container once more. [Rotate the secrets key](production.md#rotate-the-secrets-key) covers several servers.

## Back up and restore

On a volume, the ledger is three files, `ledger.db`, `ledger.db-wal` and `ledger.db-shm`, which belong together. Stop the server, copy the whole volume, and start it again:

```bash
docker stop auto-runtime
docker run --rm --volume auto-runtime-data:/data:ro --volume "$PWD/backup:/backup" alpine cp -a /data/. /backup/
docker start auto-runtime
```

To restore, stop the server, copy the files back into the volume, and start it. With PostgreSQL, use your database's own backups, or `pg_dump`; the workflows are in the same database, so one backup holds everything. The secrets in a backup open only under the `SECRETS_KEY` that sealed them, so a restored ledger starts with that key, which you keep apart from the backups.

## Stop

`docker stop auto-runtime` sends `SIGTERM`: the server finishes the work it already took, records where its workflows are, and exits, usually in well under a second. Calls it cut off run again when it next starts. [Workflow operations](workflows.md#starting-stopping-and-restarting) describes the stop in detail.
