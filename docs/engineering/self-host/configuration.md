# Configure the runtime

Settings come from environment variables and, for those that are lists or maps, from an optional YAML file:

- **Environment variables** can hold every setting, and are the only place for keys and other secrets. In development, `pnpm dev` reads `.env` at the root of the repository after `packages/server/dev.env`, and a variable set in the shell wins over both; the server itself never reads `.env`. A container takes environment variables, or a file of them with `docker run --env-file`.
- **The configuration file**, named by `CONFIG_FILE`, holds `model_gateways`, `model_aliases`, `declared_models`, `allowed_models`, `mcp_servers`, `api_keys`, `identity_providers` and `allowed_origins`. `pnpm dev` passes `auto-runtime.yaml` at the root of the repository when it is there; copy [`auto-runtime.example.yaml`](https://github.com/BeOnAuto/runtime/blob/main/auto-runtime.example.yaml) to start one. Git ignores it. In development, the environment variables that a `${NAME}` reference in it needs go in `.env` at the root of the repository, which `pnpm dev` loads and Git also ignores.

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
| The ledger in Amazon RDS without a database password       | `DATABASE_URL` without a password and `DATABASE_CREDENTIALS=aws-iam`                                                                         | [Without a password](container.md#without-a-password-on-amazon-rds)                     |
| Content kept in an object store instead of the ledger      | `CONTENT_STORE_URL`, an `s3://bucket/prefix` URL                                                                                             | [Content on object storage](container.md#content-on-object-storage)                     |
| Tools that functions may call                              | `mcp_servers` in the file, each entry's `allowed` to allow only some of its tools                                                            | [MCP servers](#mcp-servers)                                                             |
| Persons signed in through the company's identity provider  | `identity_providers` in the file and `PUBLIC_URL`                                                                                            | [Identity providers](#identity-providers)                                               |
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

## MCP servers

A reasoning function that lists `tools` calls the tools of the MCP servers in `mcp_servers` ([decision 0003](../../decisions/0003-mcp-servers.md)), and an interaction function calls the tool it names in `call`, or sends its request through the tool it names in `deliver`. The key is the name a function writes in `server/tool`, and each entry is a remote server or a process, in the shape assistants read:

```yaml
mcp_servers:
  graph:
    url: https://gateway.example.com/mcp
    headers:
      Authorization: Bearer ${GRAPH_API_KEY}
    org: acme
    playbooks: [sales, support]
    allowed: [search, introspect, validate, dry_run, execute]
    testable: [search, introspect, validate, dry_run] # the gateway marks no tool read-only; these four only read
  notes:
    command: /usr/local/bin/notes-mcp-server
    args: [--read-only]
    env:
      PATH: /usr/local/bin:/usr/bin
      NOTES_API_KEY: ${NOTES_API_KEY}
    org: acme
```

| Field            | For     | What it holds                                                                                                                                                                                                                      |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | both    | `http` or `stdio`; taken from `url` or `command` when left out                                                                                                                                                                     |
| `url`            | `http`  | The server, spoken to over Streamable HTTP                                                                                                                                                                                         |
| `headers`        | `http`  | Headers sent with every request; the values of their references are secrets                                                                                                                                                        |
| `auth`           | `http`  | OAuth client credentials instead of a header: `issuer`, `client_id`, `client_secret` or `private_key` with `algorithm`, and `scope`                                                                                                |
| `command`        | `stdio` | An installed, pinned command, started when a run or a listing first needs it and stopped with the server                                                                                                                           |
| `args`           | `stdio` | Its arguments                                                                                                                                                                                                                      |
| `env`            | `stdio` | Its whole environment; the values of its references are secrets. It inherits nothing else from the server, so give `PATH` or an absolute command                                                                                   |
| `org`            | both    | The org whose functions may use the server; required                                                                                                                                                                               |
| `playbooks`      | both    | The playbooks of that org that may use it; every playbook of the org when left out                                                                                                                                                 |
| `allowed`        | both    | The tools of the server a function may name, each named as the server lists it, without the server's name and without `*`; every tool of the server when left out                                                                  |
| `testable`       | both    | The tools `test_tool_call` may test although the server does not mark them read-only, each among `allowed`; only the tools the server marks read-only when left out                                                                |
| `record_content` | both    | Whether the arguments and answers of calls are kept whole, scrubbed of secrets, in the playbook's ledger, where anyone who may read the playbook reads them; `true` when left out, and `false` keeps their sizes and digests alone |
| `request_id`     | both    | The response header, or the key of a result's metadata, in which the server returns its own id of a request, recorded with each call                                                                                               |

A secret is a value a `${NAME}` reference takes from the environment, a credential of an `auth` block, or a token minted from one, and nothing else: a header such as `X-Region: production-eu` is not, so it is never scrubbed. A secret is scrubbed from every message, event and result, as written and as it appears inside JSON, where a quote, a backslash or a line break in it is escaped; a value shorter than 8 characters is not, since scrubbing it would erase ordinary words, so give a server a key at least that long. Only `headers`, `env` and `auth` may hold a reference; one in `url`, `command` or `args` stops the server at start, since an argument shows in the machine's list of processes and a URL is not a header.

Write a `command` as an installed program, never as a package downloaded at start such as `npx -y`, which would run whatever that package is the day the process starts. A process runs under the server's user. With an `auth` block, the server mints tokens from the client credentials, once for every run that needs one, and renews them before they expire; it sends the credentials only to an authorization server whose metadata names the `issuer`.

`allowed` narrows what a function may name, as `allowed_models` narrows the models, and a server's own policy remains the hard boundary; a function's `server/*` offers exactly the tools its server's entry allows. `testable` names the tools `test_tool_call` may test although the server does not mark them read-only. `test_tool_call` lets an agent call one tool as a run would, to learn what it answers before a function names it, and is live: a tool its server marks read-only (`readOnlyHint`) can be tested without being named, since the operator who allowed it trusts its server that far, and any other only once its entry names it under `testable`. A tool with no hints, one marked destructive and one marked only as additive are not tested unless named there. Name a tool only when calling it to see what it answers is safe, such as a lookup its server forgot to mark; a tool named under `testable` may still change something, and while any entry names one `test_tool_call` is marked destructive, so a client that honours the hint asks the person first. A server that marks its read-only tools needs no `testable`; one that marks none needs its read-only tools named, as the gateway above does. When a server marks none of the tools its entry allows read-only and its entry marks none testable, the server logs once at INFO, by the server's name, where its tools are first listed, by `list_tool_servers`, a run or a test, and never at start, that `test_tool_call` can test none of its tools and that the tools safe to test go under `testable`.

`list_tool_servers` (`GET /v1/orgs/{org}/playbooks/{playbook}/tool-servers`, and the MCP tool of the same name) shows anyone who may read a playbook the entries that serve it, and at the org (`GET /v1/orgs/{org}/tool-servers`, and the same tool on `/mcp` without a `playbook`) a key that may read every playbook of the org, by `org:read` or `playbook:read`, every entry whose `org` is the org, each with its `playbooks`, `["*"]` when they are left out, by name and type, with the tools its entry lets its functions name, each with the hints its server gives it and whether it can be tested, asking each server as a run does; it adds no header, environment value, URL, command or credential of its own, and what a server writes is passed on with the secrets above scrubbed out, a value shorter than 8 characters excepted.

The server checks every entry at start and stops, naming the setting and the place but never a value, at an entry with neither `url` nor `command` or with both, a name that is not 1 to 32 lowercase letters, digits and hyphens starting with a letter, the name of a model provider or gateway, a missing `org`, a credential written out instead of referenced, among them a password in a `url`, and a user, a query value or the part of an argument after its `=` that looks like a credential, such as `--key=sk-live-...`, judged by the value and never by the name it is given, a reference in `url`, `command` or `args`, an `Authorization` header beside an `auth` block, an `issuer` that is neither https nor on a loopback address, and in `allowed` or `testable` a name that is not a tool name of 1 to 128 letters, digits, underscores, hyphens and dots, such as `graph/search`, a `*`, a name listed twice or an empty list, and a name in `testable` that `allowed` does not name. It does not connect to a server or start a process until a run, `list_tool_servers` or `test_tool_call` needs one. The servers' messages, a process's output on stderr and every failed call go to the server's log, scrubbed of the entry's secrets.

## Identity providers

A person the company signs in through its identity provider calls the runtime with the provider's access token instead of a key, through an agent gateway that brokers them or an agent that runs the authorization flow; the [security guide](security.md#signed-in-persons) sets out what the runtime verifies and what it answers. `identity_providers` lists the providers, one entry for each org a provider admits people to, and `PUBLIC_URL` is the runtime's own URL, which every token must name as its audience:

```yaml
identity_providers:
  - name: corp
    issuer: https://login.example.com/oauth2/default
    org: acme
    membership: { claim: tenant, value: acme }
    grants:
      claim: groups
      by:
        playbook-authors: { permissions: [org:read, playbook:read, playbook:write], playbooks: '*' }
        sales-readers: { permissions: [playbook:read], playbooks: [sales] }
  - name: corp
    issuer: https://login.example.com/oauth2/default
    org: globex
    grants:
      claim: scope
      by:
        playbook:read: { permissions: [playbook:read], playbooks: '*' }
```

| Field        | What it holds                                                                                                                                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | The provider's name, 1 to 32 lowercase letters, digits and hyphens starting with a letter; a signed-in person is recorded as `person:<name>/<subject>`. An issuer has one name, and a name one issuer                                                                                                                       |
| `issuer`     | The `https` URL the tokens' `iss` equals, written as the provider writes it, with no query or fragment; its metadata and key set are read from it at start                                                                                                                                                                  |
| `org`        | The org this entry admits a person to, any org id but `local`; an org has at most one entry for each issuer                                                                                                                                                                                                                 |
| `membership` | `claim` and `value`: the entry applies only to a token whose claim holds the value, such as a tenant or a group of everyone who may use the runtime; to every token of the issuer when left out                                                                                                                             |
| `grants`     | `claim` and `by`: each value of the claim that `by` names grants its `permissions` and `playbooks` in the org, and a person's are the union of the values they hold, `*` winning; a claim holds an array of strings or a string of words separated by spaces, as `scope` does. A person granted nothing is admitted nowhere |
| `subject`    | The claim that names the person, `sub` when left out, such as `oid` for an identifier the same across a provider's applications; a token that does not hold it is not admitted by this entry, and one that holds it longer than 256 bytes is refused                                                                        |

`PUBLIC_URL` is `https` with no path, query or fragment, such as `https://runtime.example.com`, and is required when `identity_providers` lists an entry; it is the audience a token must name and the base of the metadata's `resource`. An entry the setting refuses stops the server at start, naming the entry and the field, and so does a provider whose metadata or key set cannot be read, naming the provider. The server logs at start the providers persons sign in through and the audience their tokens name. Persons and keys work side by side: a credential that has the form of a key is checked as a key, and any other as a token.

## Interaction functions

An interaction function calls a tool of a server in `mcp_servers` and answers with its result, naming it in its own document under `call` ([decision 0021](../../decisions/0021-asking-a-system.md)), or sends its request through such a tool, named under `deliver`, or leaves it in the playbook's inbox, and may read the replies to what it sent through another tool of that server ([decision 0010](../../decisions/0010-interaction-functions.md)). Nothing is configured for it beyond the tool server: the entry's `allowed` names the tools its functions may use, checked again at every call, every attempt and every read, and its `record_content`, on unless the entry turns it off, keeps what they send and what the tool answers.

One setting goes with interaction functions:

| Setting                     | What it holds                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTERACTION_OPEN_REQUESTS` | The most requests a playbook may have open at once, from 1 to 1,000,000, 10,000 when unset; a run past it is `unavailable` with the kind `requests_full` |

## Prediction functions

A prediction function's uploaded datasets, the rows and the brief of each build and the model file each version holds are content the playbook keeps, in the ledger's database or, with `CONTENT_STORE_URL`, in the object store, where a build's candidates are also staged until the build ends. Its model processes load models and read a build's rows from files the server keeps on its own disk, written again from the playbook's content whenever one is missing, so the folder needs no volume and loses nothing when it is emptied. These settings go with prediction functions, each read with its range and logged at start; a value outside its range stops the server at start, naming the setting, and the [container guide](container.md) sets out how to plan the processes' memory:

| Setting                     | What it holds                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PREDICTION_MAX_FUNCTIONS`  | The most active prediction functions a playbook may keep, from 1 to 1,000, 32 when unset; a save past it is refused                                                                                                                                                                                                                                  |
| `PREDICTION_PROCESSES`      | The most model processes that run at once, from 2 to 64, 4 when unset                                                                                                                                                                                                                                                                                |
| `PREDICTION_PROCESS_MEMORY` | The data each model process may reserve, in MiB, from 768 to 16,384, 1,280 when unset; a process that reaches it is ended and its job ends out of memory                                                                                                                                                                                             |
| `PREDICTION_BUILDS_AT_ONCE` | The most builds the server scores at once, from 1 to 63, 2 when unset, and below `PREDICTION_PROCESSES` so that a question always finds a process; a build past it is `unavailable` with the kind `builds_full`                                                                                                                                      |
| `PREDICTION_BUILDS_PER_DAY` | The most builds a prediction function may ask in the trailing 24 hours, from 1 to 100, 4 when unset; a build past it is `unavailable` with the kind `builds_full` and the because `builds_of_the_day`                                                                                                                                                |
| `PREDICTION_CACHE_DIR`      | The absolute path of the folder the model files are kept in, `/var/tmp/auto-runtime` when unset. As it starts, the server makes it, readable by its own user alone, when it is not there, as it does each folder within it, and refuses to start, naming the setting, when it cannot be made, belongs to another user or other users may write to it |

Give two servers on one machine a folder each, since each bounds the files it keeps, 1 GiB of models and 1 GiB of rows, by what it counts itself. A folder another user may write to would let that user change a model before it is loaded, which is why the server refuses one; the files found in the folder at start are read again and kept only when their bytes are the digest they are named by.
