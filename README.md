# auto-brain

**The runtime for business brains.**

[![CI](https://github.com/BeOnAuto/auto-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/BeOnAuto/auto-brain/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/BeOnAuto/auto-brain/badge)](https://scorecard.dev/viewer/?uri=github.com/BeOnAuto/auto-brain)
[![License: ELv2](https://img.shields.io/badge/license-ELv2-blue)](LICENSING.md)

A business brain carries out the way your team works. It gathers context, calls models, runs deterministic steps, and asks people or systems for input when it needs it. Every step lands on a ledger, so the brain's work can be recalled, explained and improved.

auto-brain is the server a brain runs on. Auto can host it for you, or you can run it yourself from one container image.

> **Status: early development.** Two primitives are built: inference, which calls a language model, and orchestration, which runs workflows on Temporal. The server keeps an org's brains on the ledger and runs their specs, over HTTP and over MCP. The other primitives below are designed but not built yet, so auto-brain isn't ready for production use.

## How a brain works

A brain is made of **primitives** that share one **ledger**.

| Primitive                                 | Today   | What it does                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Interaction](primitives/interaction)     | Planned | Input and output between the brain and people or machines, in both directions                                                                                                                                                                                               |
| [Orchestration](primitives/orchestration) | Built   | Runs a workflow of deterministic steps that execute other specs, branch, loop, retry, wait and listen for events, durably, on Temporal. A workflow starts when its spec is executed; starting one from an event or on a schedule is planned                                 |
| [Inference](primitives/inference)         | Built   | Calls a language model with a prompt written in Markdown: front matter sets the model, its settings and the JSON Schemas of the input and output, and a Liquid template renders the prompt from the input. Skills, tools and context from the rest of the brain are planned |
| [Prediction](primitives/prediction)       | Planned | A machine-learning model that makes a prediction, for when an LLM isn't the right tool                                                                                                                                                                                      |
| [Computation](primitives/computation)     | Planned | A deterministic function that workflows and agents can call                                                                                                                                                                                                                 |
| [Recollection](primitives/recollection)   | Planned | A materialized view of the brain's history, built from the ledger                                                                                                                                                                                                           |
| [Dream](primitives/dream)                 | Planned | Explores the ledger around a subject to suggest new scenarios and better ways of working, and can iterate towards a goal                                                                                                                                                    |

The [ledger](packages/ledger) records every input and output of every primitive. That record lets a brain recall what happened and explain its decisions. It also lets you evaluate and improve the method over time.

The diagram shows the design, not what is built today:

```mermaid
flowchart TD
    people(["People"]) <--> interaction["Interaction"]
    machines(["Machines"]) <--> interaction
    triggers(["Events, manual runs and schedules"]) --> orchestration
    interaction --> orchestration["Orchestration"]
    orchestration --> inference["Inference"]
    orchestration --> prediction["Prediction"]
    orchestration --> computation["Computation"]
    interaction & orchestration & inference & prediction & computation --> ledger[("Ledger")]
    ledger --> recollection["Recollection"]
    ledger --> dream["Dream"]
    recollection -. context .-> inference
```

## Where it fits

Three separate things:

- **Auto Studio** is the management plane at [on.auto](https://on.auto), with governance and observability for your brains.
- **Cloud hosting** means Auto runs auto-brain for you, so there's no infrastructure to operate.
- **Self-hosting** means you run the same image on your own infrastructure, free up to a usage threshold (see [Licensing](#licensing)).

## Run it

### Quick start

You need [pnpm](https://pnpm.io/installation), for example from `curl -fsSL https://get.pnpm.io/install.sh | sh -`. In this repository pnpm switches itself to the version the repository pins, 12.8.1, and runs every script on the Node.js it pins, 26.10.0, which it downloads on the first `pnpm install`; the Node.js on your machine does not matter.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Before `pnpm dev`, uncomment one line of `.env` and put your key in it:

| Provider                     | In `.env`                                                                                                                                            | A model to name               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Anthropic                    | `ANTHROPIC_API_KEY=<your key>`                                                                                                                       | `anthropic/claude-sonnet-4-5` |
| OpenAI                       | `OPENAI_API_KEY=<your key>`                                                                                                                          | `openai/gpt-5`                |
| Google                       | `GOOGLE_GENERATIVE_AI_API_KEY=<your key>`                                                                                                            | `google/gemini-2.5-flash`     |
| An OpenAI-compatible gateway | `MODEL_GATEWAYS='[{"name":"gateway","base_url":"https://gateway.example.com/v1","api_key_env":"GATEWAY_API_KEY"}]'` and `GATEWAY_API_KEY=<your key>` | `gateway/<model>`             |

`pnpm dev` starts Temporal's dev server, then the server, in [local mode](#local-mode), on `http://localhost:8080`. Once it is up, it says so:

```text
10:42:44.130 INFO  [dev] auto-brain is ready
  server     http://localhost:8080
  workflows  Temporal web UI at http://127.0.0.1:8233
  models     anthropic
  MCP        http://localhost:8080/mcp
```

Next, connect your AI assistant to `http://localhost:8080/mcp`. Local mode needs no key:

- **Claude Code**: `claude mcp add --transport http auto-brain http://localhost:8080/mcp`
- **Cursor**, in `.cursor/mcp.json` or `~/.cursor/mcp.json`: `{"mcpServers": {"auto-brain": {"url": "http://localhost:8080/mcp"}}}`
- **VS Code**, in `.vscode/mcp.json`: `{"servers": {"auto-brain": {"type": "http", "url": "http://localhost:8080/mcp"}}}`
- **Other assistants** take the entry under [Connecting an agent over MCP](#connecting-an-agent-over-mcp), without its header.

Then ask it, in order:

1. "Create a brain called support for our customer support team."
2. "In support, write a prompt that classifies a support ticket by category (billing, bug, account or other) and urgency (low, normal or high), answering in JSON, and run it on: I was charged twice for March and nobody has answered for three days."
3. "How many tokens did that run use, and what exactly was sent to the model?"
4. "Change the prompt so that anything about money is billing and at least normal urgency, then run it on the same ticket again."
5. "Build a workflow that classifies a ticket and, only when it is urgent, drafts a two-sentence note for the on-call lead. Run it on that ticket and on: How do I export my invoices as CSV?"
6. "Start a workflow that waits for a manager to approve a refund, then send it the approval."

You don't need to teach the assistant anything first: each tool's description says how the documents of its primitive are written.

To try it without an assistant, `scripts/try-inference.sh http://localhost:8080 <provider/model>` and `scripts/try-workflows.sh http://localhost:8080 <provider/model>` run a prompt and a workflow over HTTP and print what happened. [How it works](#how-it-works) walks through the same steps.

### Configuring a model

Settings come from two places. In development, `pnpm dev` and `pnpm dev:lean` read `.env` at the root of the repository after `packages/server/dev.env`, and a variable set in the shell wins over both; the server itself never reads `.env`. A container takes environment variables, or a file of them with `docker run --env-file`.

| To use                                               | Set                                                                              | Example                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A provider's own API                                 | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`          | [Direct API keys](primitives/inference/README.md#direct-api-keys)                                            |
| An OpenAI-compatible gateway                         | `MODEL_GATEWAYS`, a JSON list whose `name` becomes the prefix, `gateway/<model>` | [A gateway](primitives/inference/README.md#an-internal-openai-compatible-gateway-with-a-custom-header)       |
| Amazon Bedrock                                       | `AWS_REGION`, with the AWS default credential chain                              | [Bedrock](primitives/inference/README.md#amazon-bedrock-with-an-iam-role)                                    |
| Azure OpenAI                                         | `AZURE_RESOURCE_NAME` and `AZURE_API_KEY`                                        | [Azure](primitives/inference/README.md#azure-openai-with-an-api-key)                                         |
| Google Vertex AI                                     | `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_LOCATION`                             | [Vertex](primitives/inference/README.md#google-vertex-ai-with-workload-identity)                             |
| Your own names for models                            | `MODEL_ALIASES`                                                                  | [Model aliases](primitives/inference/README.md#model-aliases)                                                |
| An outbound proxy or a private certificate authority | `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`                  | [Proxy and CA](primitives/inference/README.md#behind-an-outbound-proxy-with-a-private-certificate-authority) |

### Developing with pnpm dev

`pnpm dev` starts Temporal's dev server on `127.0.0.1:7233`, with its web UI on `http://127.0.0.1:8233`, and then the server, pointed at it. The first run downloads the Temporal CLI the tests also use, v1.9.1, about 150 MB unpacked, into your temporary directory, and says so; later runs start in about a second. The ledger and Temporal's state live side by side in `packages/server/.data`, so brains, specs and waiting workflows are still there after a restart; delete that directory to start over.

Saving a `.ts` file other than a test under the `src` of any package of the repository, or `packages/server/dev.env` or `.env`, restarts the server through its clean shutdown, while Temporal keeps running. A server that does not start says why and starts again on the next save. Ctrl-C stops both.

When a Temporal already answers on `127.0.0.1:7233`, `pnpm dev` uses it and starts none. `TEMPORAL_ADDRESS`, in the shell or in `.env`, names another Temporal and starts none. When something else holds the port, or the CLI cannot be downloaded or started, the server starts without workflows and one line says why and how to get them. `pnpm dev:lean` runs the server alone, without Temporal and without workflows.

`packages/server/dev.env` sets `LOG_FORMAT=pretty`, so the logs read as lines of text; lines from `pnpm dev` itself are marked `[dev]`, and Temporal's `[temporal]`. Don't run the server by hand under `node --watch` with `TEMPORAL_ADDRESS` set: in watch mode Node sends messages from worker threads that `@temporalio/worker` 1.24.0 mistakes for its own, and the server crashes. `pnpm dev` restarts the server itself instead.

### How it works

Everything an assistant does over MCP is also an operation over HTTP. In local mode every org is open; the brains an assistant makes on `/mcp` belong to the org `local`, so these commands use it. Create a brain, list the org's brains, and read one back:

```bash
curl --request POST http://localhost:8080/v1/orgs/local/brains \
  --header 'content-type: application/json' \
  --data '{"brain":"sales","name":"Sales","description":"Answers questions about the pipeline"}'
curl http://localhost:8080/v1/orgs/local/brains
curl http://localhost:8080/v1/orgs/local/brains/sales
```

`PUT /v1/orgs/local/brains/sales` replaces the name and the description, and `POST /v1/orgs/local/brains/sales/retire` retires the brain for good.

A brain does its work through specs: named, versioned documents, each for one primitive. An inference spec calls a language model, with the key from your `.env`. Write a spec, `greeting.md`: YAML front matter that names the model, then a Liquid template that renders the prompt from the input.

```markdown
---
description: Greets a customer
model: anthropic/claude-sonnet-4-5
input:
  schema: { type: object, properties: { name: { type: string } }, required: [name] }
---

{% system %}You write one warm sentence.{% endsystem %}
Greet {{ input.name }}, whose order shipped today, {{ today }}.
```

Create the spec in the brain, execute it, and read the execution back with the record of the call: the rendered prompt, the model, the tokens it used and how long it took.

```bash
jq --null-input --rawfile source greeting.md '{name: "greeting", source: $source}' |
  curl --request POST http://localhost:8080/v1/orgs/local/brains/sales/specs/inference \
    --header 'content-type: application/json' --data @-
curl --request POST http://localhost:8080/v1/orgs/local/brains/sales/specs/inference/greeting/execute \
  --header 'content-type: application/json' \
  --data '{"input":{"name":"Ada"},"execution_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a"}'
curl http://localhost:8080/v1/orgs/local/brains/sales/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a
```

A document with a problem is rejected with every problem and its line; an input that does not match the schema is rejected before any model is called; a provider that is not configured answers `503`, naming the settings it lacks. The [inference README](primitives/inference/README.md) describes the document, the template language, every rejection and the record, and the [specs README](packages/specs/README.md) the operations. An assistant does the same over [MCP](#connecting-an-agent-over-mcp) on `/mcp`, where the descriptions of the spec tools explain how a spec is written.

A workflow spec runs steps that execute other specs, branch, wait and listen for events, durably, on the Temporal that `pnpm dev` runs. Write `welcome.yaml`, a workflow that executes the greeting above, then waits for the customer's reply:

```yaml
document:
  dsl: '1.0.3'
  namespace: acme
  name: welcome
  version: '1.0.0'
  summary: Greets a customer, then waits for their reply.
do:
  - greet:
      call: execute_spec
      with:
        primitive: inference
        name: greeting
        input:
          name: ${ .name }
      output:
        as: '${ { greeting: . } }'
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.customer.replied }
      output:
        as: '${ $input + { reply: .[0] } }'
```

Create it, execute it, and send it the event it waits for:

```bash
jq --null-input --rawfile source welcome.yaml '{name: "welcome", source: $source}' |
  curl --request POST http://localhost:8080/v1/orgs/local/brains/sales/specs/orchestration \
    --header 'content-type: application/json' --data @-
curl --request POST http://localhost:8080/v1/orgs/local/brains/sales/specs/orchestration/welcome/execute \
  --header 'content-type: application/json' \
  --data '{"input":{"name":"Ada"},"execution_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b"}'
curl --request POST http://localhost:8080/v1/orgs/local/brains/sales/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/events \
  --header 'content-type: application/json' \
  --data '{"event":{"type":"com.acme.customer.replied","data":"Thank you!"}}'
curl http://localhost:8080/v1/orgs/local/brains/sales/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b
```

Executing answers `started` at once; the execution reads `started` until the workflow ends, and then `succeeded` with `{"greeting": ..., "reply": "Thank you!"}`. The greeting the workflow executed is an execution of its own in the ledger, under an id derived from the workflow's run, made by the caller who started the workflow. The [orchestration README](primitives/orchestration/README.md) describes what a workflow may do.

### In a container

Every release publishes the image to Docker Hub (`beonauto/auto-brain`) and GitHub Container Registry (`ghcr.io/beonauto/auto-brain`). A container needs two things: an [API key](#api-keys), because it listens on every interface, and a volume on `/data`, where it keeps the ledger.

```bash
docker run --rm --log-driver none beonauto/auto-brain:latest node packages/identity/src/key-command.ts --org acme
echo 'API_KEYS=[<the API_KEYS entry it printed>]' > auto-brain.env
docker volume create auto-brain-data
docker run --rm --publish 8080:8080 --env-file auto-brain.env --volume auto-brain-data:/data beonauto/auto-brain:latest
curl --header 'authorization: Bearer <the key it printed>' http://localhost:8080/v1/orgs/acme/brains
```

Without a named volume, Docker gives each container a fresh anonymous volume, so its brains last only as long as that container.

| Variable          | Default                                          | Purpose                                                                                                                        |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`            | `8080`                                           | Port the server listens on                                                                                                     |
| `HOST`            | `0.0.0.0`                                        | Interface the server binds to                                                                                                  |
| `ALLOWED_ORIGINS` | none                                             | Comma-separated origins a browser page may call the API from, with CORS; see [Calling from a browser](#calling-from-a-browser) |
| `API_KEYS`        | none                                             | The API keys the server accepts, as a compact JSON array of entries made by the key command                                    |
| `LEDGER_FILE`     | `data/ledger.db`; `/data/ledger.db` in the image | The SQLite database file of the ledger; its directory is created when missing                                                  |
| `LOCAL_MODE`      | `false`                                          | `true` trusts every request as the local developer; see [Local mode](#local-mode)                                              |
| `LOG_FORMAT`      | `json`                                           | `json`, one JSON object per line on stderr, or `pretty`, lines of text for a person at a terminal                              |

The [inference primitive](primitives/inference) calls language models with these settings, all optional; [Configuring a model](#configuring-a-model) says which to set for what. A provider whose settings are absent is not configured, and a spec that names it is rejected as `unavailable` when it runs. When it starts, the server logs one line naming the providers that are configured, or a warning when none is, and a warning for each provider that has some of its settings but not all it needs. Settings it cannot read stop it at start-up, naming the setting and never its value.

| Variable                                                                                         | Purpose                                                                                                                |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`                              | Anthropic (`anthropic/...`)                                                                                            |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API`                                                | OpenAI (`openai/...`); `OPENAI_API=chat_completions` for endpoints without the Responses API                           |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                                   | Gemini API (`google/...`)                                                                                              |
| `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`, `AWS_ENDPOINT_URL` | Amazon Bedrock (`bedrock/...`, `bedrock-anthropic/...`), with the AWS default credential chain                         |
| `AZURE_RESOURCE_NAME` or `AZURE_BASE_URL`, `AZURE_API_KEY`, `AZURE_API_VERSION`                  | Azure OpenAI (`azure/...`); without a key, Microsoft Entra ID in an image built with `--build-arg AZURE_IDENTITY=true` |
| `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`                                                | Vertex AI (`vertex/...`, `vertex-anthropic/...`), with Google application default credentials                          |
| `MODEL_GATEWAYS`                                                                                 | JSON list of OpenAI-compatible gateways, each its own provider prefix                                                  |
| `MODEL_ALIASES`                                                                                  | JSON map from one model reference to another                                                                           |
| `NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`                           | Node's own switches for an outbound proxy and a private certificate authority                                          |

The [orchestration primitive](primitives/orchestration) runs workflow specs on Temporal with these settings. Without `TEMPORAL_ADDRESS` the server does not offer workflows: the spec operations serve only the other primitives, and no Temporal code is loaded. The server logs at start-up whether it offers workflows, and with which Temporal server, namespace and task queue.

| Variable                          | Default                                   | Purpose                                                                                           |
| --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `TEMPORAL_ADDRESS`                | none                                      | `host:port` of the Temporal frontend; set, the server offers workflows                            |
| `TEMPORAL_NAMESPACE`              | `default`                                 | Temporal namespace                                                                                |
| `TEMPORAL_TASK_QUEUE`             | `auto-brain`                              | Task queue the server's worker polls and its workflows start on                                   |
| `TEMPORAL_API_KEY`                | none                                      | API key, for Temporal Cloud; implies TLS                                                          |
| `TEMPORAL_TLS`                    | `false`                                   | Whether to connect with TLS                                                                       |
| `ORCHESTRATION_MAX_DURATION`      | `P30D`                                    | The most a workflow may run, an ISO 8601 duration from `PT2H` to `P365D`                          |
| `ORCHESTRATION_NESTED_EXECUTIONS` | `32`                                      | How many nested executions the server runs at once, from 1 to 1000; shared by every org           |
| `ORCHESTRATION_WORKFLOW_BUNDLE`   | none; `/app/workflow-bundle` in the image | Directory of the workflow code bundled ahead of time; unset, the worker bundles it when it starts |

The image is multi-arch (amd64 and arm64), runs as a non-root user that can read but not change its own code, keeps the ledger on the `/data` volume, where that user may write, as it may only in `/tmp`, `/var/tmp`, `/run/lock` and its home `/home/node` besides, and shuts down cleanly on `SIGTERM`, even in its first milliseconds, because `tini` runs as PID 1 and forwards the signal to the server. Its SQLite driver is compiled from source while the image is built, and its workflow code is bundled while the image is built, checked against the code the image runs. A second `SIGTERM` or `SIGINT` ends the server at once with exit code 1.

### Workflows and Temporal

The server runs the Temporal worker for its workflows in its own process, on the task queue `TEMPORAL_TASK_QUEUE`; give each deployment its own task queue, or its own namespace, so that no other deployment's worker takes its workflows. In development, `pnpm dev` runs Temporal for you.

The server starts whether Temporal can be reached or not. Until it can, it logs a warning each time it tries to start the worker, and executing a workflow spec answers `503` `unavailable`; once Temporal is back, workflows run without a restart. When the server stops, it stops accepting requests, gives the activities in flight 10 seconds to finish while the requests in flight finish, and then closes the ledger. With Temporal unreachable and requests waiting for it, stopping can take up to about 16 seconds, so allow the container at least 20 (`docker stop --time 20`).

Give the container at least 512 MiB of memory without workflows and 1 GiB with them (`docker run --memory 1g`). The [orchestration README](primitives/orchestration/README.md#memory) has the measurements behind these figures and the bound on what workflows can hold.

What an operator must know:

- Temporal's history of each workflow holds its document, its input, the outputs of the specs it executes, the events sent to it and the identity of the caller who started it, unencrypted in this version: whoever can read the namespace can read that tenant data. Access to the namespace is an operator's privilege; grant it accordingly.
- A workflow acts for the caller who started it, with the permissions that caller had then, for as long as it runs, at most `ORCHESTRATION_MAX_DURATION`. Revoking the caller's key does not stop it. To stop one, `temporal workflow cancel --workflow-id <org>/<brain>/<spec>/<execution id>` cancels what it is doing and settles its execution `failed`, and the workflow ends `CANCELLED` in Temporal; `temporal workflow terminate` ends it without running any more of its code, so its execution stays `started`.
- `/health` answers whether the server is alive, not whether its workflow worker runs; the log says that (`The workflow worker started`, and the warnings above).
- There are no limits for one org, and no fairness between orgs: every org's workflows share the server's worker, its 16 cached workflows, its 2 workflow tasks and its `ORCHESTRATION_NESTED_EXECUTIONS` nested executions at a time.
- An execution whose workflow could not settle it stays `started`; the server logs it as an error with its org, brain, execution id and reason, and reconciling it is manual in this version.

### API keys

Every path except `/health` needs an API key, sent as `Authorization: Bearer <key>`. Each key belongs to one org and carries its permissions and the brains it may access. The key command creates one:

```bash
docker run --rm --log-driver none beonauto/auto-brain:latest node packages/identity/src/key-command.ts --org <org>
```

Options are `--id`, `--permissions` (comma-separated, from `org:read`, `org:write`, `brain:read`, `brain:write`; all four by default) and `--brains` (comma-separated brain ids, or `*` for every brain, the default). The command prints the key once and the entry to add to `API_KEYS`; only the key's SHA-256 is stored, so keep the key itself somewhere safe. Write the variable unquoted, for example `API_KEYS=[{"id":"…",…}]` in an env file. `--log-driver none` keeps the key out of Docker's log driver, which could otherwise store or ship it; the command still prints it to your terminal.

Following [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750), a request without an `Authorization` header gets `401` with `WWW-Authenticate: Bearer`, a key that is not valid gets `401` with `error="invalid_token"`, an `Authorization` header that is not exactly one `Bearer <key>` gets `400` with `error="invalid_request"`, and a key that lacks the permission, brain or org a call needs gets `403` with `error="insufficient_scope"`.

Without `API_KEYS`, or with `API_KEYS=[]`, and without local mode, the server rejects every path except `/health` with `401`, on any address, and warns at start-up that no request can authenticate.

### Local mode

Local mode is for development on your own machine. It is on only when `LOCAL_MODE=true`, the server listens only on a loopback address (`localhost`, `127.0.0.1` or `::1`), and `API_KEYS` is not set. Then every request acts as a local developer with every permission in whichever org it names, and no key is needed; the server logs a warning saying so when it starts. To stop a web page from driving it, local mode rejects a request whose `Host` header is not a localhost name, and, as always, a request whose `Origin` is not in `ALLOWED_ORIGINS`.

> **Warning:** never enable local mode on a machine that can be reached through a proxy. A reverse proxy on the same machine, such as nginx with its default settings, forwards remote requests to the loopback address with a localhost `Host` header, so the server would trust every remote client as the local developer.

`LOCAL_MODE=true` with an address that is not loopback stops the server at start-up with an `InvalidLocalModeError`. With `API_KEYS` set, keys are enforced and the server warns that `LOCAL_MODE` is ignored. `pnpm dev` sets `LOCAL_MODE=true` and listens on `127.0.0.1`, so it runs in local mode; `pnpm key -- --org <org>` creates a key from a checkout.

### Calling from a browser

A page may call the API only from an origin listed in `ALLOWED_ORIGINS`; a request with any other `Origin` header gets `403`. For a listed origin the server answers CORS: a preflight (`OPTIONS` with `Access-Control-Request-Method`) gets `204` before any key is checked, allowing `GET`, `HEAD`, `POST` and `PUT` with the `authorization` and `content-type` headers, and every response carries `Access-Control-Allow-Origin` with that origin, `Vary: Origin`, and `x-request-id` among the headers the page may read. There is no wildcard and no credentials mode: the page sends its API key in the `Authorization` header.

### Connecting an agent over MCP

The server is also an [MCP](https://modelcontextprotocol.io) server, so an agent can call the same operations as tools. Connect it to `/mcp`, with an [API key](#api-keys):

```json
{
  "mcpServers": {
    "auto-brain": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}
```

Most MCP clients take an entry of this shape. In Claude Code, `claude mcp add --transport http auto-brain http://localhost:8080/mcp --header "Authorization: Bearer <key>"` adds the same. In [local mode](#local-mode), leave out the header.

`/mcp` serves every tool on one connection, so an agent can create a brain and work in it at once. The org is the key's own, since a key belongs to one org, and never an argument; in local mode, where no key names one, it is `local`, so the brains an agent creates there are the ones `GET /v1/orgs/local/brains` lists. The org id `local` is reserved for local mode: the key command refuses it, and an `API_KEYS` entry with it stops the server at start-up, so no key can reach the brains made in local mode. The brain tools (`create_brain`, `list_brains`, `get_brain`, `update_brain` and `retire_brain`) are as on HTTP. Every tool that works inside a brain (`create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, `execute_spec`, `get_execution` and, when workflows are offered, `send_execution_event`) takes the brain's id as a required `brain` argument: twelve tools, or thirteen with workflows. The server's instructions orient an agent to brains, specs, primitives and executions.

| Endpoint                              | Tools                                                                         | Use it                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `POST /mcp`                           | every tool, those inside a brain taking a `brain` argument                    | by default                                               |
| `POST /orgs/{org}/mcp`                | `create_brain`, `list_brains`, `get_brain`, `update_brain` and `retire_brain` | to manage the brains of one org and nothing else         |
| `POST /orgs/{org}/brains/{brain}/mcp` | the tools inside a brain, acting in that brain, without a `brain` argument    | to lock a connection to one brain, such as for one agent |

Every endpoint speaks streamable HTTP without sessions. It serves the current stateless revision (`2026-07-28`) and the earlier ones the SDK supports (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`), so agents built on older SDKs connect too. Each tool carries the operation's description and its input and output JSON Schemas, and is marked read-only when it only reads. A tool that cannot do what was asked returns `isError` with the same problem document HTTP would answer with, as text, so the agent can read the `reason` and the `detail`, and correct its arguments when the `reason` is `invalid_input`. The key's permissions and brains hold as they do over HTTP: a read-only key can call `list_brains` but gets `forbidden` from `create_brain`, a key limited to some brains gets `forbidden` for any other, and a brain the org does not have is `not_found`. [`packages/api`](packages/api) describes the mappings in full.

### Errors

Every error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document (`application/problem+json`) with a machine-readable `reason`, such as `bad_request`, `invalid_input` (with an `errors` list of JSON pointers), `forbidden`, `not_found` or `conflict`. A `500` says nothing about the cause; its `instance` is `urn:uuid:<id>`, and the server logs the error to stderr under `"incident":"<id>"` together with `"requestId"`, the value of the response's `x-request-id` header, so either id finds the log line. A request that Node's HTTP parser rejects before the API sees it, such as one with oversized headers or invalid framing, gets a bare status line, such as `431` or `400`, and no problem document.

## Licensing

auto-brain is **source-available** under the [Elastic License 2.0](LICENSE), the same model Apollo uses for its GraphQL router.

- Self-hosting is free up to a usage threshold. Above it, you need a commercial license from Auto.
- You can't offer auto-brain to others as a hosted or managed service.

[LICENSING.md](LICENSING.md) explains what's allowed, when you need a license, and how to get one.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). You'll sign the [CLA](CLA.md) on your first pull request, and everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

The [quick start](#quick-start) sets up a checkout. Then:

```bash
pnpm dev          # Temporal and the server on http://localhost:8080, restarting the server on save
pnpm dev:lean     # the server alone, without workflows
pnpm test:watch   # tests on save
pnpm check        # everything CI checks
```

## Repository layout

| Path                       | What's there                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server`          | The HTTP server (`@beonauto/server`), which serves the brain and spec operations on the ledger over HTTP and MCP, and its container build (`Dockerfile`) |
| `packages/api`             | The API (`@beonauto/api`) the server answers every request with: each operation as an HTTP route and as an MCP tool                                      |
| `packages/config`          | Reads the server's configuration from the environment                                                                                                    |
| `packages/identity`        | API keys, local mode and the key command                                                                                                                 |
| `packages/operations`      | The application layer: where operations are defined and run                                                                                              |
| `packages/brains`          | The brain operations: create, list, read, update and retire an org's brains                                                                              |
| `packages/specs`           | The spec operations: define, version, retire and execute the specs of a brain's primitives                                                               |
| `packages/ledger`          | The ledger every primitive records to: event streams on Emmett and SQLite                                                                                |
| `primitives/orchestration` | Workflow specs in the Open Workflow DSL, run on Temporal by one interpreter workflow; the server serves them when `TEMPORAL_ADDRESS` is set              |
| `primitives/*`             | One package per primitive; `primitives/inference` renders prompts from specs and calls language models                                                   |
| `scripts`                  | `try-inference.sh` and `try-workflows.sh`, which create and execute a small inference spec, and a workflow that executes it, against a running server    |
