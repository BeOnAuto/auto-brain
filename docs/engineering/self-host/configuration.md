# Configure the runtime

Settings come from environment variables and, for those that are lists or maps, from an optional YAML file:

- **Environment variables** can hold every setting, and are the only place for keys and other secrets. In development, `pnpm dev` reads `.env` at the root of the repository after `packages/server/dev.env`, and a variable set in the shell wins over both; the server itself never reads `.env`. A container takes environment variables, or a file of them with `docker run --env-file`.
- **The configuration file**, named by `CONFIG_FILE`, holds `model_gateways`, `model_aliases`, `declared_models`, `allowed_models`, `mcp_servers`, `channels`, `allowed_tools`, `api_keys` and `allowed_origins`. `pnpm dev` passes `auto-brain.yaml` at the root of the repository when it is there; copy [`auto-brain.example.yaml`](https://github.com/BeOnAuto/auto-brain/blob/main/auto-brain.example.yaml) to start one. Git ignores it. In development, the environment variables that a `${NAME}` reference in it needs go in `.env` at the root of the repository, which `pnpm dev` loads and Git also ignores.

Each key of the file stands for the environment variable of the same name in upper case, and a variable that is set wins over the key, whole: `MODEL_GATEWAYS` replaces the file's `model_gateways`, it is not merged with it. The server logs at start which settings it read from the file, and which of them the environment set too. A secret is never written in the file: the file refers to the variable that holds it as `${NAME}`, or `${NAME:-default}`, and `$$` stands for a literal `$`. A value that looks like a credential and is not such a reference stops the server at start, as does a URL with a password, or whose user or query value looks like one, or an argument whose part after its `=` does; a value is judged by what it holds, never by the name a URL or an argument gives it.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeOnAuto/auto-brain/main/auto-brain.schema.json
model_gateways:
  - name: gateway
    base_url: https://gateway.example.com/v1
    api_key: ${GATEWAY_API_KEY}
model_aliases:
  anthropic/*: gateway/anthropic/*
```

[`auto-brain.schema.json`](https://github.com/BeOnAuto/auto-brain/blob/main/auto-brain.schema.json) is the file's JSON Schema, so an editor with the YAML language server completes and checks it. A file the server cannot use, a key it does not hold, a value its setting refuses or a reference to a variable that is not set stops it at start with one line that names the file, the line, the column and the key, never a value.

| To use                                               | Set                                                                                     | Example                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A provider's own API                                 | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`                 | [Direct API keys](models.md#direct-api-keys)                                            |
| An OpenAI-compatible gateway                         | `model_gateways` in the file, a list whose `name` becomes the prefix, `gateway/<model>` | [A gateway](models.md#an-internal-openai-compatible-gateway-with-a-custom-header)       |
| Amazon Bedrock                                       | `AWS_REGION`, with the AWS default credential chain                                     | [Bedrock](models.md#amazon-bedrock-with-an-iam-role)                                    |
| Azure OpenAI                                         | `AZURE_RESOURCE_NAME` and `AZURE_API_KEY`                                               | [Azure](models.md#azure-openai-with-an-api-key)                                         |
| Google Vertex AI                                     | `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_LOCATION`                                    | [Vertex](models.md#google-vertex-ai-with-workload-identity)                             |
| Your own names for models                            | `model_aliases` in the file                                                             | [Model aliases](models.md#model-aliases)                                                |
| Another provider's models, through your gateway      | `model_aliases: {anthropic/*: gateway/anthropic/*}` in the file                         | [Model aliases](models.md#model-aliases)                                                |
| The models listed for Bedrock, Azure or Vertex       | `declared_models` in the file, a list of model ids for each provider prefix             | [Listing the models](models.md#listing-the-models)                                      |
| Only some models                                     | `allowed_models` in the file, such as `[anthropic/*, gateway/llama-3.3-70b]`            | [Listing the models](models.md#listing-the-models)                                      |
| An outbound proxy or a private certificate authority | `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`                         | [Proxy and CA](models.md#behind-an-outbound-proxy-with-a-private-certificate-authority) |
| Tools that reasoning functions may call              | `mcp_servers` in the file, and `allowed_tools` to allow only some                       | [MCP servers](#mcp-servers)                                                             |
| Channels that interaction functions ask through      | `channels` in the file, with `PUBLIC_ORIGIN` and `INTERACTION_OPEN_REQUESTS`            | [Channels](#channels)                                                                   |

`list_models` (`GET /v1/orgs/{org}/models`, and the MCP tool of the same name) lists the models the server can call: it asks Anthropic, OpenAI, Google and each gateway for their models with the server's own credentials, keeps each list for five minutes, adds the models `declared_models` names and the aliases whose target's provider is configured, and leaves out what `allowed_models` does not allow. A spec that names a model outside `allowed_models`, by its own name or the alias it is sent through, cannot run, and its run says the model is not offered and that `list_models` shows those that are.

```yaml
declared_models:
  bedrock:
    - eu.anthropic.claude-sonnet-4-5-20250929-v1:0
allowed_models:
  - anthropic/*
  - bedrock/*
```

## MCP servers

A reasoning function that lists `tools` calls the tools of the MCP servers in `mcp_servers` ([decision 0003](../../decisions/0003-mcp-servers.md)). The key is the name a function writes in `server/tool`, and each entry is a remote server or a process, in the shape assistants read:

```yaml
mcp_servers:
  graph:
    url: https://gateway.example.com/mcp
    headers:
      Authorization: Bearer ${GRAPH_API_KEY}
    org: acme
    brains: [sales, support]
  notes:
    command: /usr/local/bin/notes-mcp-server
    args: [--read-only]
    env:
      PATH: /usr/local/bin:/usr/bin
      NOTES_API_KEY: ${NOTES_API_KEY}
    org: acme
allowed_tools: [graph/search, graph/execute, notes/*]
```

| Field            | For     | What it holds                                                                                                                                                       |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | both    | `http` or `stdio`; taken from `url` or `command` when left out                                                                                                      |
| `url`            | `http`  | The server, spoken to over Streamable HTTP                                                                                                                          |
| `headers`        | `http`  | Headers sent with every request; the values of their references are secrets                                                                                         |
| `auth`           | `http`  | OAuth client credentials instead of a header: `issuer`, `client_id`, `client_secret` or `private_key` with `algorithm`, and `scope`                                 |
| `command`        | `stdio` | An installed, pinned command, started when a run or a listing first needs it and stopped with the server                                                            |
| `args`           | `stdio` | Its arguments                                                                                                                                                       |
| `env`            | `stdio` | Its whole environment; the values of its references are secrets. It inherits nothing else from the server, so give `PATH` or an absolute command                    |
| `org`            | both    | The org whose functions may use the server; required                                                                                                                |
| `brains`         | both    | The brains of that org that may use it; every brain of the org when left out                                                                                        |
| `record_content` | both    | `true` to record the arguments and results of calls, scrubbed and cut to 4 KiB as stored, in the history of the run, where anyone who may read the brain reads them |
| `request_id`     | both    | The response header, or the key of a result's metadata, in which the server returns its own id of a request, recorded with each call                                |

A secret is a value a `${NAME}` reference takes from the environment, a credential of an `auth` block, or a token minted from one, and nothing else: a header such as `X-Region: production-eu` is not, so it is never scrubbed. A secret is scrubbed from every message, event and result, as written and as it appears inside JSON, where a quote, a backslash or a line break in it is escaped; a value shorter than 8 characters is not, since scrubbing it would erase ordinary words, so give a server a key at least that long. Only `headers`, `env` and `auth` may hold a reference; one in `url`, `command` or `args` stops the server at start, since an argument shows in the machine's list of processes and a URL is not a header.

Write a `command` as an installed program, never as a package downloaded at start such as `npx -y`, which would run whatever that package is the day the process starts. A process runs under the server's user. With an `auth` block, the server mints tokens from the client credentials, once for every run that needs one, and renews them before they expire; it sends the credentials only to an authorization server whose metadata names the `issuer`.

`allowed_tools` narrows what a function may name, as `allowed_models` narrows the models: each entry is `server/tool`, or `server/*` for every tool of a server, and a server's own policy remains the hard boundary. Every tool is allowed when it is left out.

`list_tool_servers` (`GET /v1/orgs/{org}/brains/{brain}/tool-servers`, and the MCP tool of the same name) shows anyone who may read a brain the entries that serve it, by name and type, with the tools `allowed_tools` lets its functions name, asking each server as a run does, except one on which `allowed_tools` allows nothing; it adds no header, environment value, URL, command or credential of its own, and what a server writes is passed on with the secrets above scrubbed out, a value shorter than 8 characters excepted.

The server checks both at start and stops, naming the setting and the place but never a value, at an entry with neither `url` nor `command` or with both, a name that is not 1 to 32 lowercase letters, digits and hyphens starting with a letter, the name of a model provider or gateway, a missing `org`, a credential written out instead of referenced, among them a password in a `url`, and a user, a query value or the part of an argument after its `=` that looks like a credential, such as `--key=sk-live-...`, judged by the value and never by the name it is given, a reference in `url`, `command` or `args`, an `Authorization` header beside an `auth` block, an `issuer` that is neither https nor on a loopback address, and an `allowed_tools` entry that names no configured server. It does not connect to a server or start a process until a run or `list_tool_servers` needs one. The servers' messages, a process's output on stderr and every failed call go to the server's log, scrubbed of the entry's secrets.

## Channels

An interaction function sends its request through the brain's own inbox, which needs nothing set up, or through a channel in `channels` ([decision 0010](../../decisions/0010-interaction-functions.md)). The key is the name a function writes in `channel`, 1 to 32 lowercase letters, digits and hyphens starting with a letter; `inbox` is the brain's own and no channel takes it. Each entry is a webhook or a tool of an MCP server:

```yaml
channels:
  partner:
    type: webhook
    url: https://partner.example.com/brain/requests
    headers:
      Authorization: Bearer ${PARTNER_API_KEY}
    secret: ${PARTNER_WEBHOOK_SECRET}
    to: '^[a-z.]+@partner\.example\.com$'
    answers: true
    org: acme
    brains: [sales]
  approvals:
    type: mcp
    server: chat
    tool: post_message
    to: '^#approvals-[a-z-]+$'
    with:
      channel: '{{ to }}'
      text: '{{ message }}'
    org: acme
```

| Field     | For       | What it holds                                                                                                                                                                              |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`    | both      | `webhook`, an HTTP POST of the request, signed; or `mcp`, one call of a tool of a server in `mcp_servers`                                                                                  |
| `to`      | both      | A regular expression the whole of the party a request is rendered to must match, so a brain addresses no one you did not allow                                                             |
| `org`     | both      | The org whose functions may use the channel; required                                                                                                                                      |
| `brains`  | both      | The brains of that org that may use it; every brain of the org when left out                                                                                                               |
| `url`     | `webhook` | The URL the request is posted to: https, or http on a loopback address                                                                                                                     |
| `secret`  | `webhook` | The [Standard Webhooks](https://www.standardwebhooks.com/) secret every delivery is signed with, `whsec_` and a key of 24 to 64 bytes in base64, as a reference                            |
| `headers` | `webhook` | Headers sent with every delivery, their values secrets; none of `content-type`, `content-length`, `host` and the three `webhook-` headers each delivery sets                               |
| `answers` | `webhook` | `true` when the receiver may answer within the delivery, with a `200` whose body is the answer                                                                                             |
| `server`  | `mcp`     | The entry of `mcp_servers` whose tool delivers the request; the channel's org and brains must lie within the server's                                                                      |
| `tool`    | `mcp`     | The tool of that server, which `allowed_tools` must allow                                                                                                                                  |
| `with`    | `mcp`     | The arguments of the call, each a Liquid template over `to`, `message`, `run_id`, `function`, `expires_at` and `answer_schema`; write `{{ answer_schema \| json }}` for a structured value |

Only `headers` and `secret` may hold a reference to an environment variable, and a `with` template may not hold `${`, so a secret never reaches a template, a URL or a record. The server checks every channel at start and stops, naming the setting and the place but never a value, at an unknown key, a name it does not take, a `to` that is not a regular expression, a webhook URL that is neither https nor on a loopback address, a secret that is not a Standard Webhooks secret, a credential written out instead of referenced, an MCP channel whose server is not in `mcp_servers`, lies outside the channel's org or brains or whose tool `allowed_tools` does not allow, a template that does not compile or renders something other than text, and more than 32 channels. The secrets of every channel are scrubbed from every message, event and result, as those of an MCP server are.

A system that receives a request by webhook verifies its signature with the secret, and answers it either within the delivery, on a channel with `answers: true`, or later with `Authorization: Request <answer_token>` at the `answer_url` the request gives, a token derived from the channel's secret for that request alone and never stored. The [interaction function format](../../reference/interaction-format.md#what-a-webhook-receives) describes the request and its attempts.

Two settings go with channels:

| Setting                     | What it holds                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTERACTION_OPEN_REQUESTS` | The most requests a brain may have open at once, from 1 to 1,000,000, 10,000 when unset; a run past it is `unavailable` with the kind `requests_full`                         |
| `PUBLIC_ORIGIN`             | The origin a delivered request names in its `source` and `answer_url`, such as `https://brains.example.com`; `http://localhost` and the port the server listens on when unset |
