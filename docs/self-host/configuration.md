# Configure the runtime

Settings come from environment variables and, for those that are lists or maps, from an optional YAML file:

- **Environment variables** can hold every setting, and are the only place for keys and other secrets. A container takes them from its platform, or from a file of them with `docker run --env-file`. `npx @on.auto/runtime` also reads `.env` in the folder it starts in, and a variable set in the shell wins over it.
- **The configuration file**, named by `CONFIG_FILE`, holds `model_gateways`, `model_aliases`, `declared_models`, `allowed_models`, `tool_servers`, `api_keys` and `allowed_origins`. `npx @on.auto/runtime` reads `auto-runtime.yaml` in the folder it starts in when it is there; a container reads a file only when `CONFIG_FILE` names it, as [Use a configuration file](docker.md#use-a-configuration-file) shows. Copy [`auto-runtime.example.yaml`](https://github.com/BeOnAuto/runtime/blob/main/auto-runtime.example.yaml) to start one.

Each key of the file stands for the environment variable of the same name in upper case, and a variable that is set wins over the key, whole: `MODEL_GATEWAYS` replaces the file's `model_gateways`, it is not merged with it. The server logs at start which settings it read from the file, and which of them the environment set too. A secret is never written in the file: the file refers to the variable that holds it as `${NAME}`, or `${NAME:-default}`, and `$$` stands for a literal `$`. A value that looks like a credential and is not such a reference stops the server at start, as does a URL with a password, or whose user or query value looks like one, or an argument whose part after its `=` does; a value is judged by what it holds, never by the name a URL or an argument gives it.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeOnAuto/runtime/main/auto-runtime.schema.json
model_gateways:
  - name: gateway
    base_url: https://gateway.example.com/v1
    api_key: ${GATEWAY_API_KEY}
model_aliases:
  anthropic/*: gateway/anthropic/*
```

[`auto-runtime.schema.json`](https://github.com/BeOnAuto/runtime/blob/main/auto-runtime.schema.json) is the file's JSON Schema, so an editor with the YAML language server completes and checks it. A file the server cannot use, a key it does not hold, a value its setting refuses or a reference to a variable that is not set stops it at start with one line that names the file, the line, the column and the key, never a value.

| To use                                                     | Set                                                                                                                                          | Example                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A provider's own API                                       | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`                                                                      | [Direct API keys](models.md#direct-api-keys)                                            |
| An OpenAI-compatible gateway                               | `model_gateways` in the file, a list whose `name` becomes the prefix, `gateway/<model>`                                                      | [A gateway](models.md#an-internal-openai-compatible-gateway-with-a-custom-header)       |
| Amazon Bedrock                                             | `AWS_REGION`, with the AWS default credential chain                                                                                          | [Bedrock](models.md#amazon-bedrock-with-an-iam-role)                                    |
| Azure OpenAI                                               | `AZURE_RESOURCE_NAME` and `AZURE_API_KEY`                                                                                                    | [Azure](models.md#azure-openai-with-an-api-key)                                         |
| Google Vertex AI                                           | `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_LOCATION`                                                                                         | [Vertex](models.md#google-vertex-ai-with-workload-identity)                             |
| Your own names for models                                  | `model_aliases` in the file                                                                                                                  | [Model aliases](models.md#model-aliases)                                                |
| Another provider's models, through your gateway            | `model_aliases: {anthropic/*: gateway/anthropic/*}` in the file                                                                              | [Model aliases](models.md#model-aliases)                                                |
| The models listed for Bedrock, Azure or Vertex             | `declared_models` in the file, a list of model ids for each provider prefix                                                                  | [Listing the models](models.md#listing-the-models)                                      |
| Only some models                                           | `allowed_models` in the file, such as `[anthropic/*, gateway/llama-3.3-70b]`                                                                 | [Listing the models](models.md#listing-the-models)                                      |
| An outbound proxy or a private certificate authority       | `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`                                                                              | [Proxy and CA](models.md#behind-an-outbound-proxy-with-a-private-certificate-authority) |
| The ledger in Amazon RDS without a database password       | `DATABASE_URL` without a password and `DATABASE_CREDENTIALS=aws-iam`                                                                         | [Without a password](postgresql.md#without-a-password-on-amazon-rds)                    |
| Content kept in an object store instead of the ledger      | `CONTENT_STORE_URL`, an `s3://bucket/prefix` URL                                                                                             | [Object storage](object-storage.md)                                                     |
| Tools that functions may call                              | `tool_servers` in the file, each entry's `allowed` to allow only some of its tools                                                           | [Tool servers](#tool-servers)                                                           |
| The requests interaction functions may keep open           | `INTERACTION_OPEN_REQUESTS`                                                                                                                  | [Interaction functions](#interaction-functions)                                         |
| The model processes and the builds of prediction functions | `PREDICTION_PROCESSES`, `PREDICTION_PROCESS_MEMORY`, `PREDICTION_BUILDS_AT_ONCE`, `PREDICTION_BUILDS_PER_DAY` and `PREDICTION_MAX_FUNCTIONS` | [Prediction functions](#prediction-functions)                                           |
| The folder prediction functions keep model files in        | `PREDICTION_CACHE_DIR`                                                                                                                       | [Prediction functions](#prediction-functions)                                           |

`list_models` (`GET /v1/orgs/{org}/models`, and the MCP tool of the same name) lists the models the server can call: it asks Anthropic, OpenAI, Google and each gateway for their models with the server's own credentials, keeps each list for five minutes, adds the models `declared_models` names and the aliases whose target's provider is configured, and leaves out what `allowed_models` does not allow. A definition that names a model outside `allowed_models`, by its own name or the alias it is sent through, cannot run, and its run says the model is not offered and that `list_models` shows those that are.

```yaml
declared_models:
  bedrock:
    - eu.anthropic.claude-sonnet-4-5-20250929-v1:0
allowed_models:
  - anthropic/*
  - bedrock/*
```

## Settings

Every setting is an environment variable. A value the server cannot read stops it at start, naming the setting and what it expects, and never the value.

### Server, storage and logs

| Variable               | Default                                                                                               | Purpose                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                 | `5555`                                                                                                | The port the server listens on                                                                                                                                                                                                   |
| `HOST`                 | `0.0.0.0` in the image, `127.0.0.1` with `npx`                                                        | The interface the server binds to                                                                                                                                                                                                |
| `CONFIG_FILE`          | none                                                                                                  | The configuration file, absolute or relative to the working directory                                                                                                                                                            |
| `API_KEYS`             | none                                                                                                  | The API keys the server accepts, as a compact JSON array of the entries the key command prints; `api_keys` in the file. See [API keys](security.md#api-keys)                                                                     |
| `ALLOWED_ORIGINS`      | none                                                                                                  | Comma-separated origins a browser page may call the API from, besides Auto Studio's; `allowed_origins` in the file. See [Calling from a browser](security.md#calling-from-a-browser)                                             |
| `LOCAL_MODE`           | `false`, `true` with `npx`                                                                            | `true` trusts every request as the local developer, on a loopback address only; see [Local mode](security.md#local-mode)                                                                                                         |
| `LEDGER_FILE`          | `data/ledger.db`, which in the image is on the `/data` volume; `~/.auto-runtime/ledger.db` with `npx` | The SQLite file of the ledger, absolute or relative to the working directory; its folder is created when missing                                                                                                                 |
| `DATABASE_URL`         | none                                                                                                  | A PostgreSQL URL; set, the ledger is kept in that database instead, and setting `LEDGER_FILE` too stops the server at start. Environment only, since it holds a password. See [Use PostgreSQL](postgresql.md)                    |
| `DATABASE_CREDENTIALS` | `url`                                                                                                 | How the server signs in to that database: `url`, with the password the URL holds, or `aws-iam`, with a token signed for each connection; see [Without a password, on Amazon RDS](postgresql.md#without-a-password-on-amazon-rds) |
| `CONTENT_STORE_URL`    | none                                                                                                  | An `s3://bucket/prefix` URL; set, content is kept in that bucket instead of the ledger's database. See [Keep content on object storage](object-storage.md)                                                                       |
| `LOG_FORMAT`           | `json`, `console` with `npx`                                                                          | `json`, one JSON object per line on stderr; `pretty`, lines of text for a person; or `console`, a time, a mark for the level and the message, in color at a terminal                                                             |
| `LOG_LEVEL`            | `info`, `error` with `npx`                                                                            | The least level logged: `debug`, `info`, `warn` or `error`                                                                                                                                                                       |

### Models

Reasoning functions call language models with these settings, all optional. A provider whose settings are absent is not configured, and a definition that names it is rejected as `unavailable` when it runs, naming the providers that are. At start the server logs the providers that are configured, or a warning when none is, and a warning for each provider that has some of its settings but not all. [Model providers and gateways](models.md) says which to set for what.

| Variable                                                                                         | Purpose                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`                              | Anthropic (`anthropic/...`)                                                                                                                                                                           |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API`                                                | OpenAI (`openai/...`); `OPENAI_API=chat_completions` for endpoints without the Responses API                                                                                                          |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                                   | Gemini API (`google/...`)                                                                                                                                                                             |
| `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`, `AWS_ENDPOINT_URL` | Amazon Bedrock (`bedrock/...`, `bedrock-anthropic/...`), with the AWS default credential chain                                                                                                        |
| `AZURE_RESOURCE_NAME` or `AZURE_BASE_URL`, `AZURE_API_KEY`, `AZURE_API_VERSION`                  | Azure OpenAI (`azure/...`); without a key, Microsoft Entra ID in an image built with `--build-arg AZURE_IDENTITY=true`                                                                                |
| `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`                                                | Vertex AI (`vertex/...`, `vertex-anthropic/...`), with Google application default credentials                                                                                                         |
| `MODEL_GATEWAYS`                                                                                 | A list of OpenAI-compatible gateways, each its own provider prefix; `model_gateways` in the file                                                                                                      |
| `MODEL_ALIASES`                                                                                  | A map from one model reference to another; a trailing `*` on both sides covers every model of a provider; `model_aliases` in the file                                                                 |
| `NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`                           | Node's own switches for an outbound proxy and a private certificate authority                                                                                                                         |
| `REASONING_MAX_INPUT_TOKENS`                                                                     | The most input tokens the model calls of one run of a reasoning function may add up to, from 10,000 to 9,999,999, 2,000,000 unless set; past it the model answers from what it has, without its tools |

### Workflows

[Workflow operations](workflows.md#starting-stopping-and-restarting) lists `WORKFLOW_MAX_DURATION`, `WORKFLOW_NESTED_RUNS`, `WORKFLOW_MAX_OPEN_CALLS` and `WORKFLOW_SWEEP_INTERVAL`, which bound how long a run lasts, how many of its calls run at once and how often the server sweeps the runs.

### Computation and recall functions

Each run of a computation function, and each run and view of a recall function, runs in a worker thread the server keeps between runs. The server never keeps more workers alive than `COMPUTATION_WORKERS`, and folds the views of recall functions in at most half of them at once and at least one. It ends a worker after a run that ran past its time, used too much memory, was cancelled or broke, after its thousandth run, and after a minute without one. A worker is stopped when its heap grows past 256 MiB, and has a stack of 64 MiB, so plan for about 320 MiB for each.

| Variable                   | Default | Purpose                                                                                                                                                      |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `COMPUTATION_WORKERS`      | `4`     | The most worker threads the server keeps, and so the most runs it takes at once, from 1 to 64; a run that finds none free within 10 seconds is `unavailable` |
| `RECALL_MAX_FUNCTIONS`     | `32`    | How many active recall functions a playbook may keep, from 1 to 1000; lowering it below what a playbook keeps refuses its saves and nothing else             |
| `RECALL_MAX_REBUILDS`      | `4`     | How many views of one playbook are built at once, from 1 to 64; the others wait in the order they were saved                                                 |
| `RECALL_PLAYBOOKS_AT_ONCE` | `4`     | How many playbooks the server folds at once, from 1 to 64                                                                                                    |

### Interaction and prediction functions

[Interaction functions](#interaction-functions) and [Prediction functions](#prediction-functions) below list their settings.

## Tool servers

A reasoning function that lists `tools` calls the tools of the tool servers in `tool_servers`, and an interaction function calls the tool it names in `call`, or sends its request through the tool it names in `deliver`. The key is the name a function writes in `server/tool`, and nothing in a function says which kind of server it names. Each entry is one of three types, taken from the field that names the server when `type` is left out:

- `mcp`, a remote MCP server at a `url`, spoken to over Streamable HTTP;
- `stdio`, an MCP server the runtime runs as a process, a `command`;
- `openapi`, an HTTP API described by an OpenAPI document, 3.0 or 3.1, read once at start from its `document`, each of whose operations is one tool.

```yaml
tool_servers:
  graph:
    url: https://gateway.example.com/mcp
    headers:
      Authorization: Bearer ${GRAPH_API_KEY}
    org: acme
    playbooks: [sales, support]
    allowed: [search, introspect, validate, dry_run, execute]
  notes:
    command: /usr/local/bin/notes-mcp-server
    args: [--read-only]
    env:
      PATH: /usr/local/bin:/usr/bin
      NOTES_API_KEY: ${NOTES_API_KEY}
    org: acme
  billing:
    document: https://billing.example.com/openapi.json
    base_url: https://billing.example.com/v2
    security:
      apiKeyAuth: ${BILLING_API_KEY} # the scheme the document declares under components.securitySchemes
    headers:
      X-Tenant: acme-eu # outside the document's schemes
    org: [acme, globex]
    allowed: [listInvoices, getInvoice]
```

| Field            | For              | What it holds                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | every type       | `mcp`, `stdio` or `openapi`; taken from `url`, `command` or `document` when left out                                                                                                                                                                                            |
| `url`            | `mcp`            | The server, spoken to over Streamable HTTP                                                                                                                                                                                                                                      |
| `headers`        | `mcp`, `openapi` | Headers sent with every request: an `mcp` server's credential, and for an `openapi` server only what its document's security schemes do not place, such as a tenant; the value of a reference is a secret, a value written out is not                                           |
| `auth`           | `mcp`, `openapi` | OAuth client credentials instead of a header: `issuer`, `client_id`, `client_secret` or `private_key` with `algorithm`, and `scope`; for an `openapi` server, what satisfies the document's `oauth2` and `openIdConnect` schemes, and refused when it declares neither          |
| `command`        | `stdio`          | An installed, pinned command, started when a run or a listing first needs it and stopped with the server                                                                                                                                                                        |
| `args`           | `stdio`          | Its arguments                                                                                                                                                                                                                                                                   |
| `env`            | `stdio`          | Its whole environment; the value of a reference is a secret, a value written out is not. It inherits nothing else from the server, so give `PATH` or an absolute command                                                                                                        |
| `document`       | `openapi`        | The OpenAPI document of the API, 3.0 or 3.1, in JSON or YAML: an https URL, an http URL on a loopback address, or a path relative to the directory of this file that stays inside it                                                                                            |
| `base_url`       | `openapi`        | The URL the calls go to, in place of the first server the document names; required when the document names none or names it relative to a file. An https URL, or an http URL on a loopback address                                                                              |
| `query_params`   | `openapi`        | Query parameters sent with every call that the document's security schemes do not place, such as a tenant; the value of a reference is a secret, a value written out is not                                                                                                     |
| `security`       | `openapi`        | The credential of each security scheme of the document the entry gives, by the scheme's name, placed as the scheme says, always as a reference such as `${BILLING_API_KEY}` or `ada:${BILLING_PASSWORD}`; see [The credentials of an HTTP API](#the-credentials-of-an-http-api) |
| `org`            | every type       | The org whose functions may use the server, a list of orgs, or `*` for every org of the runtime; required. One entry serves each org under one name, with one credential and one connection, and each org sees the same tools                                                   |
| `playbooks`      | every type       | The playbooks that may use it within each org it names, by id, the same list in each; every playbook of each org when left out, and refused beside `*`, since a playbook id belongs to one org                                                                                  |
| `allowed`        | every type       | The tools of the server a function may name, and a call made by hand with `execute` may call, each named as the server lists it, without the server's name and without `*`; every tool of the server when left out                                                              |
| `record_content` | every type       | Whether the arguments and answers of calls are kept whole, scrubbed of secrets, in the playbook's ledger, where anyone who may read the playbook reads them; `true` when left out, and `false` keeps their sizes alone                                                          |
| `request_id`     | every type       | The response header, or for an MCP server the key of a result's metadata, in which the server returns its own id of a request, recorded with each call                                                                                                                          |

A secret is a value a `${NAME}` reference takes from the environment, a credential of an `auth` block, or a token minted from one, and nothing else: a header such as `X-Region: production-eu` is not, so it is never scrubbed. A secret is scrubbed from every message, event and result, as written, as it appears inside JSON, where a quote, a backslash or a line break in it is escaped, as an address carries it, form-encoded in a query and percent-encoded in a path, and in base64, as a Basic credential carries it; a value of `security`, which always holds a reference, is a secret whole, as well as the value of its reference; a value shorter than 8 characters is not, since scrubbing it would erase ordinary words, so give a server a key at least that long. Only `headers`, `query_params`, `security`, `env` and `auth` may hold a reference; one in `url`, `command`, `args`, `document` or `base_url` stops the server at start, since an argument shows in the machine's list of processes and the URL of a server or of a document is no place for a credential.

Write a `command` as an installed program, never as a package downloaded at start such as `npx -y`, which would run whatever that package is the day the process starts. A process runs under the server's user. With an `auth` block, the server mints tokens from the client credentials, once for every run that needs one, renews them before they expire, and mints once more when the server answers 401; it sends the credentials only to an authorization server whose metadata names the `issuer`. An `mcp` server's authorization server is found through the server's own protected-resource metadata; an `openapi` server's is the `issuer` itself, whose metadata is read by OAuth authorization server metadata or OpenID Connect discovery, since an HTTP API publishes none of its own.

### The credentials of an HTTP API

An OpenAPI document declares its security schemes under `components.securitySchemes`, each saying where its credential goes, and each operation names the schemes it requires under `security`, or takes the document's own `security` when it names none. An `openapi` entry gives a credential by the scheme's name under `security`, and the server places it as the scheme says:

| Scheme                          | What `security` gives             | What a call sends                       |
| ------------------------------- | --------------------------------- | --------------------------------------- |
| `apiKey` in a header            | the key                           | the scheme's header                     |
| `apiKey` in the query           | the key                           | the scheme's query parameter            |
| `http` with the scheme `bearer` | the token                         | `Authorization: Bearer <token>`         |
| `http` with the scheme `basic`  | `user:password`                   | `Authorization: Basic` and their base64 |
| `oauth2` or `openIdConnect`     | nothing: the entry's `auth` block | the token the block mints, as a bearer  |

A requirement is a list of alternatives, each a set of schemes that must all be given. An operation is offered when the entry gives one alternative, and a call sends the credentials of the first alternative it gives, in the document's order, and no other; an operation whose requirement is empty, or of a document that declares none, sends none. An operation the entry gives no alternative of is offered as no tool, and the server logs at WARN, at start, the schemes it needs. The server stops at start, naming the entry, at a name under `security` the document does not declare, an `apiKey` the document places in a cookie, an `http` scheme other than `bearer` and `basic`, a `mutualTLS` scheme, an `oauth2` or `openIdConnect` scheme given a value, whose credential is the client of the `auth` block, a `basic` value that is not `user:password`, a header or query parameter of `headers` or `query_params` that a scheme given under `security` also places, and an `auth` block on an entry whose document declares no `oauth2` or `openIdConnect` scheme. The scopes an `oauth2` requirement names are the operation's; the `auth` block asks for its `scope`, so set it to cover what the operations require. Use `security` for what the document's schemes describe, and `headers` and `query_params` for what they do not, such as a tenant.

### An HTTP API as a tool server

At start the server reads each `openapi` entry's document, at most 4 MiB and 500 operations, within 10 seconds, and stops, naming the entry, when it cannot read it, when its URL answers a redirect, which the server does not follow, when it is Swagger 2.0 or of another version than 3.0 or 3.1, when a part it reads is not of the shape the specification gives it, with the place in the document, when two operations would share a tool name, when a path does not begin with `/`, which would join the host or the port of `base_url`, or holds a `.` or `..` segment, a `?` or a `#`, when its tools take more than 16 MiB listed, when a reference does not resolve inside the document, a reference to an http, https or file address among them, which the server never fetches, or when its calls would have nowhere to go: no `base_url` and no server, or a server that is neither https nor on a loopback address. The slashes `base_url` or the server ends in are dropped. Each operation becomes one tool:

- its name is the `operationId`, with any character a tool name cannot hold as `_`, or, without one, the method and the path in lower case, as `get_invoices_id` for `GET /invoices/{id}`;
- its description is the operation's `summary` and `description`;
- its input is one object: each path and query parameter by its name, and `body` for a JSON request body, each required when the document says so, with the schemas of `components` they refer to held inside it, so a function's model reads one schema whole;
- `GET` and `HEAD` are read-only, `DELETE` destructive, and `GET`, `HEAD`, `PUT` and `DELETE` idempotent, so `allowed`, `search` and a run's read-only calls read an API's tools as they read an MCP server's.

An operation that needs a header or a cookie, takes an object in its query, or takes a body that is not JSON, a `TRACE`, a `GET` or `HEAD` that takes a body, one with a path parameter of a `style` other than `simple` or a query parameter of a `style` other than `form` or with `explode: false`, and one whose input schema takes more than 64 KiB is offered as no tool, and the server logs at WARN, at start, which operation of which entry it leaves out and why. A call fills the path and the query, an array as repeated keys, refuses a path argument that is empty, holds a `/`, or is `.` or `..`, sends nothing to an address that would leave the origin or the path of `base_url`, sends the body as JSON with the entry's headers and query parameters, and reads the answer as a call of an MCP server is read, within the same bounds: JSON as the tool's structured content and its text, text as text, any other media type noted and not shown; 401 is a key the server refused, 429 waits out a `Retry-After` that fits, 5xx is a failing server, a redirect is an error result with its status and is not followed, so the entry's headers and token go to no address but its own, and any other answer, a 404 among them, is an error result carrying what the API answered. Listing an HTTP API's tools asks the API nothing: the document is the list.

`allowed` narrows what a function may name, as `allowed_models` narrows the models, and a server's own policy remains the hard boundary; a function's `server/*` offers exactly the tools its server's entry allows. It is the one list of a server's tools: the five tools over the playbook's tool servers, `search`, `introspect`, `validate`, `dry_run` and `execute`, show and call the tools it allows and no other. `execute` calls one tool as a run would, under the entry's credential, which is the playbook's, so it needs `playbook:write` whatever the tool does, and is live: `search` and `dry_run` say whether the server marks a tool read-only (`readOnlyHint`), and a client that honours the MCP hints asks the person before a call while a tool server is configured, since `execute` is marked destructive then. Every call made with `execute` is recorded in the playbook's history under the caller, with its content where the entry keeps it.

`search` (`GET /v1/orgs/{org}/playbooks/{playbook}/tool-servers/search`, and the MCP tool of the same name) shows anyone who may read a playbook the entries that serve it, and at the org (`GET /v1/orgs/{org}/tool-servers/search`, and the same tool on `/mcp` without a `playbook`) a key that may read every playbook of the org, by `org:read` or `playbook:read`, every entry that serves the org, by naming it in `org` or by `*`, each with its `playbooks`, `["*"]` when they are left out, by name and type, with the tools its entry lets its functions name, each with the first sentence of its description and whether it only reads, found by the words of `terms` where they are given, asking each MCP server as a run does; `introspect` shows one tool whole, with its input schema and its hints. They add no header, environment value, URL, command or credential of their own, and what a server writes is passed on with the secrets above scrubbed out, a value shorter than 8 characters excepted.

The server checks every entry at start and stops, naming the setting and the place but never a value, at an entry with none of `url`, `command` and `document` or with more than one, the fields of another type, a name that is not 1 to 32 lowercase letters, digits and hyphens starting with a letter, a name with two hyphens together or one at the end, which would blur where the server's name ends in the `server__tool` a model sees, the name of a model provider or gateway, a missing `org`, a credential written out instead of referenced, among them a password in a `url`, and a user, a query value or the part of an argument after its `=` that looks like a credential, such as `--key=sk-live-...`, judged by the value and never by the name it is given, a reference outside `headers`, `query_params`, `security`, `env` and `auth`, a value of `security` written out instead of referenced, an `Authorization` header beside an `auth` block, a header the runtime sets itself, an `issuer`, a `base_url` or a `document` URL that is neither https nor on a loopback address, a `base_url`, or a first server of a document, with a query or a fragment, a `document` path that leaves the directory of this file, and in `allowed` a name that is not a tool name of 1 to 128 letters, digits, underscores, hyphens and dots, such as `graph/search`, a `*`, a name listed twice or an empty list; a key an entry does not hold is refused as any unknown key is. It does not connect to an MCP server or start a process until a run or one of the five tools needs one. The servers' messages, a process's output on stderr and every failed call go to the server's log, scrubbed of the entry's secrets.

## Interaction functions

An interaction function calls a tool of a server in `tool_servers` and answers with its result, naming it in its own document under `call`, or sends its request through such a tool, named under `deliver`, or leaves it in the playbook's inbox, and may read the replies to what it sent through another tool of that server. Nothing is configured for it beyond the tool server: the entry's `allowed` names the tools its functions may use, checked again at every call, every attempt and every read, and its `record_content`, on unless the entry turns it off, keeps what they send and what the tool answers.

One setting goes with interaction functions:

| Setting                     | What it holds                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTERACTION_OPEN_REQUESTS` | The most requests a playbook may have open at once, from 1 to 1,000,000, 10,000 when unset; a run past it is `unavailable` with the kind `requests_full` |

## Prediction functions

A prediction function's uploaded datasets, the rows and the brief of each build and the model file each version holds are content the playbook keeps, in the ledger's database or, with `CONTENT_STORE_URL`, in the object store, where a build's candidates are also staged until the build ends. Its model processes load models and read a build's rows from files the server keeps on its own disk, written again from the playbook's content whenever one is missing, so the folder needs no volume and loses nothing when it is emptied. These settings go with prediction functions, each read with its range and logged at start; a value outside its range stops the server at start, naming the setting, and [Plan memory](production.md#plan-memory) sets out how much the processes take:

| Setting                     | What it holds                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PREDICTION_MAX_FUNCTIONS`  | The most active prediction functions a playbook may keep, from 1 to 1,000, 32 when unset; a save past it is refused                                                                                                                                                                                                                                  |
| `PREDICTION_PROCESSES`      | The most model processes that run at once, from 2 to 64, 4 when unset                                                                                                                                                                                                                                                                                |
| `PREDICTION_PROCESS_MEMORY` | The data each model process may reserve, in MiB, from 768 to 16,384, 1,280 when unset; a process that reaches it is ended and its job ends out of memory                                                                                                                                                                                             |
| `PREDICTION_BUILDS_AT_ONCE` | The most builds the server scores at once, from 1 to 63, 2 when unset, and below `PREDICTION_PROCESSES` so that a question always finds a process; a build past it is `unavailable` with the kind `builds_full`                                                                                                                                      |
| `PREDICTION_BUILDS_PER_DAY` | The most builds a prediction function may ask in the trailing 24 hours, from 1 to 100, 4 when unset; a build past it is `unavailable` with the kind `builds_full` and the because `builds_of_the_day`                                                                                                                                                |
| `PREDICTION_CACHE_DIR`      | The absolute path of the folder the model files are kept in, `/var/tmp/auto-runtime` when unset. As it starts, the server makes it, readable by its own user alone, when it is not there, as it does each folder within it, and refuses to start, naming the setting, when it cannot be made, belongs to another user or other users may write to it |

Give two servers on one machine a folder each, since each bounds the files it keeps, 1 GiB of models and 1 GiB of rows, by what it counts itself. A folder another user may write to would let that user change a model before it is loaded, which is why the server refuses one; the files found in the folder at start are read again and kept only when their bytes are the digest they are named by.
