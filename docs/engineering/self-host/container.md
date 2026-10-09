# Run in a container

The runtime is in early development and is not ready for production use. Review [authentication and security](security.md) before exposing a deployment.

Every release publishes the image to Docker Hub (`beonauto/auto-brain`) and GitHub Container Registry (`ghcr.io/beonauto/auto-brain`). A container needs two things: an [API key](security.md#api-keys), because it listens on every interface, and a place for the ledger: a volume on `/data`, where it keeps the ledger in a SQLite file, or a [PostgreSQL database](#the-ledger-in-postgresql).

```bash
docker run --rm --log-driver none beonauto/auto-brain:latest node packages/identity/src/key-command.ts --org acme
echo 'API_KEYS=[<the API_KEYS entry it printed>]' > auto-brain.env
docker volume create auto-brain-data
docker run --rm --publish 8080:8080 --env-file auto-brain.env --volume auto-brain-data:/data beonauto/auto-brain:latest
curl --header 'authorization: Bearer <the key it printed>' http://localhost:8080/v1/orgs/acme/brains
```

Without a named volume, Docker gives each container a fresh anonymous volume, so its brains last only as long as that container.

The image reads a configuration file only when `CONFIG_FILE` names one. Mount the file read-only and name it:

```bash
docker run --rm --publish 8080:8080 --env-file auto-brain.env --volume auto-brain-data:/data \
  --volume "$PWD/auto-brain.yaml:/etc/auto-brain/auto-brain.yaml:ro" --env CONFIG_FILE=/etc/auto-brain/auto-brain.yaml \
  beonauto/auto-brain:latest
```

The secrets the file refers to, such as `GATEWAY_API_KEY`, go in `auto-brain.env` with the other variables.

| Variable          | Default                                                                | Purpose                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `8080`                                                                 | Port the server listens on                                                                                                                                                                                                |
| `HOST`            | `0.0.0.0`                                                              | Interface the server binds to                                                                                                                                                                                             |
| `CONFIG_FILE`     | none                                                                   | The [configuration file](configuration.md) to read the settings that are lists or maps from, absolute or relative to the working directory                                                                                |
| `ALLOWED_ORIGINS` | none                                                                   | Comma-separated origins a browser page may call the API from, with CORS, besides the studio's; see [Calling from a browser](security.md#calling-from-a-browser); `allowed_origins` in the file                            |
| `API_KEYS`        | none                                                                   | The API keys the server accepts, as a compact JSON array of entries made by the key command; `api_keys` in the file                                                                                                       |
| `LEDGER_FILE`     | `data/ledger.db`; in the image `/app/data` links to the `/data` volume | The SQLite database file of the ledger; its directory is created when missing, and the server logs it at start                                                                                                            |
| `DATABASE_URL`    | none                                                                   | A PostgreSQL URL, `postgresql://user:password@host:5432/database`; set, the ledger is kept in that database instead, and setting `LEDGER_FILE` too stops the server at start; environment only, since it holds a password |
| `LOCAL_MODE`      | `false`                                                                | `true` trusts every request as the local developer; see [Local mode](security.md#local-mode)                                                                                                                              |
| `LOG_FORMAT`      | `json`                                                                 | `json`, one JSON object per line on stderr, or `pretty`, lines of text for a person at a terminal                                                                                                                         |

The [reasoning function adapter](../reference/reasoning-format.md) calls language models with these settings, all optional; [Configuring a model](configuration.md) says which to set for what. A provider whose settings are absent is not configured, and a definition that names it is rejected as `unavailable` when it runs, naming the providers that are configured; the reasoning function description that the definition tools carry names them too, so an assistant writes the model with one of them. When it starts, the server logs one line naming the providers that are configured, or a warning when none is, and a warning for each provider that has some of its settings but not all it needs. Settings it cannot read stop it at start-up, naming the setting and never its value.

| Variable                                                                                         | Purpose                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`                              | Anthropic (`anthropic/...`)                                                                                                              |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API`                                                | OpenAI (`openai/...`); `OPENAI_API=chat_completions` for endpoints without the Responses API                                             |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                                   | Gemini API (`google/...`)                                                                                                                |
| `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`, `AWS_ENDPOINT_URL` | Amazon Bedrock (`bedrock/...`, `bedrock-anthropic/...`), with the AWS default credential chain                                           |
| `AZURE_RESOURCE_NAME` or `AZURE_BASE_URL`, `AZURE_API_KEY`, `AZURE_API_VERSION`                  | Azure OpenAI (`azure/...`); without a key, Microsoft Entra ID in an image built with `--build-arg AZURE_IDENTITY=true`                   |
| `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`                                                | Vertex AI (`vertex/...`, `vertex-anthropic/...`), with Google application default credentials                                            |
| `MODEL_GATEWAYS`                                                                                 | JSON list of OpenAI-compatible gateways, each its own provider prefix; `model_gateways` in the file                                      |
| `MODEL_ALIASES`                                                                                  | JSON map from one model reference to another; a trailing `*` on both sides covers every model of a provider; `model_aliases` in the file |
| `NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`                           | Node's own switches for an outbound proxy and a private certificate authority                                                            |

The [workflow adapter](../reference/workflow-format.md) runs workflow definitions in the server, keeping them in the ledger's database, with these settings; [Workflow operations](workflows.md) says what an operator must know about them. The server logs at start-up how long a run lasts at most, how many calls run at once and how often the runs are swept.

| Variable                  | Default | Purpose                                                                             |
| ------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `WORKFLOW_MAX_DURATION`   | `P30D`  | The most a workflow may run, an ISO 8601 duration from `PT2H` to `P365D`            |
| `WORKFLOW_NESTED_RUNS`    | `32`    | How many nested runs the server runs at once, from 1 to 1000; shared by every org   |
| `WORKFLOW_MAX_OPEN_CALLS` | `1000`  | How many calls may wait under one run at the top of a tree, from 1 to 9999          |
| `WORKFLOW_SWEEP_INTERVAL` | `PT1S`  | How often the server sweeps the runs, an ISO 8601 duration from `PT0.01S` to `PT1M` |

The [computation function adapter](../../reference/computation-format.md) runs each run of a computation function in a worker thread the server keeps between runs, so a run pays for starting a worker only when none is ready, with this setting:

| Variable              | Default | Purpose                                                                                                                                                      |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `COMPUTATION_WORKERS` | `4`     | The most worker threads the server keeps, and so the most runs it takes at once, from 1 to 64; a run that finds none free within 10 seconds is `unavailable` |

The server never keeps more worker threads alive, idle or busy, than this setting. It ends a worker after a run that ran past its time, used too much memory, was cancelled or broke, after its thousandth run, and after a minute without one, and starts another when a run needs it. A worker is stopped when its heap grows past 256 MiB, and it has a stack of 64 MiB, so plan for about 320 MiB for each worker on top of the server's own memory, about 1.25 GiB for the default four. A value outside the range stops the server at start, naming the setting.

The [recall function adapter](../../reference/recall-format.md) shares those workers: a run of a recall function answers in one, and the server that runs the workflows keeps the views of recall functions, folding each page of a brain's history in one, using at most half of them at once and at least one. It keeps each view in a table beside the workflows' tables, in the ledger's database, so a view needs no other storage. These settings bound it:

| Variable                | Default | Purpose                                                                                                                                    |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `RECALL_MAX_FUNCTIONS`  | `32`    | How many active recall functions a brain may keep, from 1 to 1000; lowering it below what a brain keeps refuses its saves and nothing else |
| `RECALL_MAX_REBUILDS`   | `4`     | How many views of one brain are built at once, from 1 to 64; the others wait in the order they were saved                                  |
| `RECALL_BRAINS_AT_ONCE` | `4`     | How many brains the server folds at once, from 1 to 64                                                                                     |

A value outside its range stops the server at start, naming the setting.

The [interaction function adapter](../../reference/interaction-format.md) keeps the open requests in a table of the ledger's database, written in the same transaction as each run's facts, and the server that runs the workflows performs their expiries and delivery attempts with its timers, so a request needs no other storage or schedule. A function sends its request through a tool of a server in `mcp_servers`, which it names itself, and this setting goes with it:

| Variable                    | Default | Purpose                                                                                                                            |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `INTERACTION_OPEN_REQUESTS` | `10000` | How many requests a brain may have open at once, from 1 to 1,000,000; a run past it is `unavailable` with the kind `requests_full` |

The image is multi-arch (amd64 and arm64), runs as a non-root user that can read but not change its own code, keeps the ledger on the `/data` volume, where that user may write, as it may only in `/tmp`, `/var/tmp`, `/run/lock` and its home `/home/node` besides, and shuts down cleanly on `SIGTERM`, even in its first milliseconds, because `tini` runs as PID 1 and forwards the signal to the server. Its SQLite driver is compiled from source while the image is built. A second `SIGTERM` or `SIGINT` ends the server at once with exit code 1.

## The ledger in PostgreSQL

Set `DATABASE_URL` to a PostgreSQL database, and the server keeps the ledger there instead of in a file; the container then needs no volume. The URL holds the database's password, so it goes in `auto-brain.env` with the other secrets, never in the configuration file, which refuses a `database_url` key:

```bash
echo 'DATABASE_URL=postgresql://auto-brain:<password>@db.example.com:5432/auto_brain' >> auto-brain.env
docker run --rm --publish 8080:8080 --env-file auto-brain.env beonauto/auto-brain:latest
```

The server creates or migrates the ledger's tables in the database's `public` schema at every start, so its user needs `CREATE` on that schema at every start, not only the first; a user that may only read and write the tables fails to start with `permission denied for schema public`. It logs at start that the ledger is kept in PostgreSQL, naming the database and its host and never the URL. A database it cannot reach stops it at start, naming the host and port. The image needs nothing more for it: the PostgreSQL driver, `pg`, is pure JavaScript. Several servers may share the database: one runs the workflows and the others stand by to take them over; see [Workflow operations](workflows.md). Servers of different versions do not share a database at the same time: stop the servers of the old version before starting those of the new one. A version that keeps a new table in the ledger, such as the outcomes of runs that a brain's analytics read, fills it from the ledger's history at its first start, before it answers, under the database's migration lock; another server starting meanwhile waits for that lock up to 60 seconds, longer than the longest fill the ledger README records, and stops only if it is still held then; start it again once the first is ready. The [ledger README](../../../packages/ledger/README.md#keyed-projections) records how long the fill takes. The [ledger README](../../../packages/ledger/README.md#postgresql) has the details and what was verified.

For TLS to a managed database, end the URL with `?sslmode=verify-full`: the connection is encrypted, and the database's certificate and host name are checked against the certificate authorities Node trusts. A private authority, such as your provider's root certificate mounted in the container, is added with `NODE_EXTRA_CA_CERTS`. `pg` 8 treats `sslmode=require`, `prefer` and `verify-ca` as `verify-full` too, but prints a multi-line security warning to stderr the first time it connects, so write `verify-full`. `sslmode=no-verify` encrypts without checking the certificate, which lets a machine in between read the connection; use it for nothing but a test.
