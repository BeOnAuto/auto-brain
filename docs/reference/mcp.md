# MCP reference

Auto Runtime exposes playbook, reasoning-function and workflow operations through Model Context Protocol (MCP). This reference describes endpoint scope, tool names and result formats. For Claude Code, Claude Desktop and Codex connection setup, see the [local quick start](../get-started/local.md); for a worked example, follow [Build your first playbook](../tutorials/first-playbook.md).

## Connection direction

This is an inbound interface: an external assistant connects to a local or self-hosted Auto Runtime and calls its operations. It does not configure tools inside a reasoning function: the operator configures their servers in `mcp_servers`, each entry with the tools it allows, which the [configuration guide](../self-host/configuration.md#mcp-servers) describes, and a function names their tools in its [`tools`](reasoning-format.md#tools). Auto Cloud is coming soon. [Request an invitation](https://on.auto/request-invite) if you would prefer a hosted playbook.

A reasoning function can also call tools itself, through MCP servers the operator of a self-hosted runtime configures. That outbound connection is set up on the server, never by adding an endpoint to an external assistant. While any MCP server is configured, `run_definition` carries the destructive annotation, since a function's tools may change something. See [Tool access inside a reasoning function](../concepts/functions.md#tool-access-inside-a-reasoning-function).

## Transport and authentication

Endpoints use streamable HTTP without sessions. The local quick start uses `http://localhost:5555/mcp` without an authentication header. Local mode trusts requests on your computer; do not expose it through a tunnel or public proxy.

An authenticated deployment supplies its own endpoint and a credential: an API key, or, where the operator turns sign-in on, a person's access token from the Auto identity service. Credentials belong in the connection configuration, outside prompts and function documents.

With sign-in on, an endpoint is an OAuth 2.1 protected resource, as the MCP authorization specification describes. A client that connects without a token gets `401` with `WWW-Authenticate: Bearer resource_metadata="<the server's URL>/.well-known/oauth-protected-resource", scope="org:read org:write playbook:read playbook:write"`, and `error="invalid_token"` when the token it sent was refused. The protected resource metadata is answered without a key at that path and under each endpoint's own path, such as `/.well-known/oauth-protected-resource/orgs/acme/mcp`; it names the server, followed by the endpoint's path, as the `resource`, the identity service as the authorization server and the four permissions as the scopes. The client signs the person in with the authorization server, asks for a token for the resource, and connects with it as `Authorization: Bearer <token>`; an agent gateway that brokers the person does the same. The token must name the server's URL, or that URL followed by the endpoint's path, as its audience. A connection then acts as the signed-in person, with every permission over every playbook in the org their token names, which is also the org `/mcp` acts in. An org or playbook the person may not reach is refused with `403`, `error="insufficient_scope"`, the four permissions as `scope` and the metadata of that endpoint. Without sign-in, the endpoints take API keys alone and serve no metadata.

The runtime supports protocol revision `2026-07-28` and the compatible revisions `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`. An MCP client handles protocol negotiation.

Authorization uses the same organization, playbook and operation permissions as the [HTTP API](http.md#requests-and-access), for a key and a signed-in person alike. A connection lists only the tools its key or token may call: a read-only key sees the tools that read and none that creates or runs a function, and a key that may only read inside some playbooks is offered `list_playbooks`, which lists those playbooks. Choosing a more specific endpoint does not grant extra permissions.

## Endpoint scope

| Path                                   | Scope                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`                                 | Playbook management, model and tool server discovery, function and workflow operations; operations within a playbook require a `playbook` argument, which `list_tool_servers` takes as an optional one |
| `/orgs/{org}/mcp`                      | Playbook management, model and tool server discovery for the named org                                                                                                                                 |
| `/orgs/{org}/playbooks/{playbook}/mcp` | Function and workflow operations for one playbook, without a `playbook` argument                                                                                                                       |

An agent that connects receives instructions built for the tools its key may call. They say what a playbook is, in the words of the [terminology](../concepts/terminology.md), with a sentence for each type of function the runtime runs and for workflows; what the connection acts on: `/mcp` acts in the key's own org, `/orgs/{org}/mcp` manages the playbooks of one org, and `/orgs/{org}/playbooks/{playbook}/mcp` acts inside one playbook; that `get_guide` holds the format of each definition and the recipes; how a reasoning function names its model and its tools; that `get_run` shows whether a run that finishes later ended or still waits; that when the person approves, rejects or otherwise answers what a run waits on, the agent answers its request with `answer_interaction`, in the shape its function's answer takes, and starts no new run for it; that runs, history, events and requests come a page at a time; and how to answer the person: what was done and what they can do next, in the words of playbooks, functions, workflows and runs, with an id or a status only when the person needs it to act. A recall function's sentence says what it answers from: what it keeps of the playbook's own history, every run's start and end, with its result when it succeeded, the definitions saved and the events published to the playbook, never a run's input or its tool calls, so nothing has to write into it. A prediction function's sentence says that it answers a question from a model a trainer built on the playbook's history, and that a build, the input `{ build: {} }`, answers `started`.

Functions and workflows share the definition tools, whose `type` is `reasoning`, `interaction`, `prediction`, `recall`, `computation` or `workflow`; a self-hosted runtime is the one that offers `interaction`, `prediction`, `recall` and `computation`. Workflow operations also include `send_run_event`, and interaction functions add `list_interactions` and `answer_interaction`, which also find and answer the request of a prediction function's build. The routes a build's trainer calls, the upload of a dataset and the activation of a version are served over [HTTP](http.md#prediction-functions) alone, so they are no tool on any endpoint. On `/mcp`, the API key determines the org, a signed-in person acts in the org their token's `org_id` names, and local mode uses its local org. Tools do not take a separate org argument. The named org and playbook in scoped endpoints remain subject to the key's access restrictions on an authenticated deployment.

## Tools

| Work                         | Tools                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Manage playbooks             | `create_playbook`, `list_playbooks`, `get_playbook`, `update_playbook`, `retire_playbook`                                       |
| List available models        | `list_models`, with an optional `provider` filter                                                                               |
| Manage reasoning functions   | `create_definition`, `list_definitions`, `get_definition`, `update_definition`, `retire_definition`, with `type: "reasoning"`   |
| Manage interaction functions | `create_definition`, `list_definitions`, `get_definition`, `update_definition`, `retire_definition`, with `type: "interaction"` |
| Manage prediction functions  | `create_definition`, `list_definitions`, `get_definition`, `update_definition`, `retire_definition`, with `type: "prediction"`  |
| Manage recall functions      | `create_definition`, `list_definitions`, `get_definition`, `update_definition`, `retire_definition`, with `type: "recall"`      |
| Manage computation functions | `create_definition`, `list_definitions`, `get_definition`, `update_definition`, `retire_definition`, with `type: "computation"` |
| Manage workflows             | `create_definition`, `list_definitions`, `get_definition`, `update_definition`, `retire_definition`, with `type: "workflow"`    |
| Run and inspect              | `run_definition`, `get_run`, `list_runs`, `get_run_history`                                                                     |
| Answer a request             | `list_interactions`, `answer_interaction`                                                                                       |
| Answer a waiting workflow    | `send_run_event`                                                                                                                |
| Cancel a run                 | `cancel_run`                                                                                                                    |
| Publish an event             | `publish_event`                                                                                                                 |
| Follow a playbook            | `list_playbook_events`, `get_event`                                                                                             |
| Read a playbook's analytics  | `get_playbook_analytics`                                                                                                        |
| Find the tools to name       | `list_tool_servers`, with optional `playbook` and `server` filters                                                              |
| Learn what a tool answers    | `test_tool_call`, with the `server`, the `tool` and its `arguments`                                                             |
| Read a guide                 | `get_guide`, with the name of the guide                                                                                         |

Every tool supplies its description and the JSON Schema of its input, and no output schema; [Successful results](#successful-results) says what a result carries. A description says what the tool does and when to use it; the rules of each argument are in its schema, and the format of a definition is in its guide. Each tool's annotations say whether it only reads, whether what it does cannot be undone, as retiring, cancelling and answering a request cannot, whether calling it again with the same input changes nothing, and whether it reaches outside the runtime. Playbook-management and model-discovery tools are available at `/mcp` and the org endpoint; function, workflow, playbook event and tool test tools are available at `/mcp` and the playbook endpoint; `list_tool_servers` and `get_guide` are available on every endpoint.

Definition operations identify a function or workflow by `type` and `name`. Creating or updating a definition takes its document as `source`. Running it accepts `input` and an optional UUID `run_id`; inspecting a run requires `run_id`. Cancelling a run requires its `run_id` and takes an optional `reason`, 1 to 1,024 characters, which the run keeps as the detail of its ending; [Cancelling a run](http.md#cancelling-a-run) says which runs can be cancelled. Sending an event requires the run's `run_id` and an `event` with a `type`; [HTTP workflows](http.md#workflows) lists its other fields and limits. Publishing an event to a playbook requires an `event` with a `source` and a `type`; [Publishing events](http.md#publishing-events) lists its attributes and limits and what publishing it again returns. See [HTTP operations](http.md) for field limits and retry behavior.

`list_runs` lists a playbook's runs newest first, with optional `type`, `name` and `status` filters. `get_run_history` reads what was recorded about one run, and `list_playbook_events` follows everything that happened in a playbook, with optional `type`, `since` and `run_id` filters, the last keeping the whole tree of one run; both take `order`. Their events carry `id`, `type`, a plain-language `summary`, `data`, the fact, of at most 4 KiB, a field larger than 2 KiB shown as its size, and `metadata`, with `causation_id`, the `id` of the event that led to it, `at`, `by`, the run and its definition; a workflow run's start is followed directly by one event for each input it took and each step that moved. `get_event` reads one event by its `id`, a step's being its input's id, an underscore and its number, with every field whole up to 64 KiB, each larger one shown as its size, so an agent opens what a tool answered. All three page with `limit` and `cursor` and answer `has_more` and `next_cursor`; a page may be short or empty while `has_more` is `true`. They work on a retired playbook. See [Run history and playbook events](http.md#run-history-and-playbook-events) for the fields and limits.

`get_playbook_analytics` counts the runs of a playbook that ended over the last 7, 14 or 30 days, with `days`, or between two days, with `from` and `to`: by how they ended, the tokens their models used, and the median and 95th percentile of how long they took, for the whole window and for each `day` of `by_day`, and in `by_function` the number of runs of each definition. It takes the optional `type` and `name` filters of `list_runs`. See [Analytics](http.md#analytics) for the window and how each number is counted.

`list_tool_servers` lists the MCP servers set up for the playbook, each with the tools a reasoning function may name in `tools` as `server/tool` or `server/*`, so an agent finds the names without being told them; a server that cannot be asked just now shows `unavailable`, in words, in place of its tools. Each tool carries the hints its server gives it, as `annotations`, and `testable`, whether `test_tool_call` may test it. Its optional `server` keeps one server; a name the playbook has no server of is refused with `invalid_input`. It asks the servers when it is called, so it is marked as reaching outside the runtime, and it works on a retired playbook. On `/mcp` and the org endpoint its `playbook` is optional: without it, the tool answers for the whole org, each server with `playbooks`, the playbooks whose functions may use it, `["*"]` for every playbook of the org, so an agent can see what is set up before a playbook exists; with it, the tool keeps the servers that serve that playbook. A key limited to some playbooks gives `playbook`. On a playbook endpoint it takes no `playbook` and lists that playbook's servers. See [Tool servers](http.md#tool-servers) for the fields.

`test_tool_call` calls one tool of a tool server with the `arguments` given, as a run of a reasoning function would call it, and answers what that run's model would see, `text`, and the document an interaction function's call reads, `answer`, so an agent learns what a tool answers, or finds an id a prompt needs, such as a channel's, without making a function to look. Only a tool its server marks read-only, or that the operator marks testable on its entry, can be tested; any other is refused with words that say so. The call is live and recorded in the playbook's history, which `list_playbook_events` shows. It needs `playbook:write`, so a key that may only read is not offered it, and it is marked as reaching outside the runtime, and as destructive while the operator marks any tool testable. See [Testing a tool](http.md#testing-a-tool) for the fields.

`list_interactions` lists the playbook's open requests, newest first, each with the `run_id` of the run that asked, the `type` and the name of the function that asked, the party, the `delivery`, the tool it is sent through or `null` for the inbox, the message, the expiry, how its delivery stands, `answer_schema`, the shape an answer must have as the request recorded it, `null` for a notification, and, for a request whose function reads replies, the `conversation` read, the `answerer` and how many replies were refused, with optional `to`, `type` and `function` filters, `function` with `type` naming one function, since a name is unique within its type; it pages with `limit` and `cursor`. `answer_interaction` answers a request a function's run waits on, with that `run_id`, an `answer` its `answer_schema` takes and an optional `claimed_for`: it records the answer on the run as one fact, `request_answered`, answers that fact, and the run takes the answer within the host's sweep, a second by default, an interaction function's run succeeding with it as its output, which reaches the workflow that waits for it, and a prediction function's build scoring the candidates it names, `{ candidates }`, each the SHA-256 an upload answered, which it refuses as `invalid_input` when one was not uploaded to that build. A reply the playbook takes is recorded as the same fact, with the reply's identity. An answer that does not match is `invalid_input` with a pointer under `/answer`; another answer once the run took one, or an answer to a request that has ended or whose run was asked to cancel, is `conflict`. See [Interaction function format](interaction-format.md#answering-a-request).

Retirement is permanent. A retired name cannot be reused, and retired definitions cannot be edited or run.

### Guides and prompts

`get_guide` reads one of the runtime's guides, whole, by its name. Every endpoint serves the same guides, and lists them as resources, `guide://<name>`, in Markdown, for clients that let a person or a model read them directly.

| Guide                                                                                                                         | Holds                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `terminology`                                                                                                                 | What the words of a playbook mean, for the types of function the runtime runs                                                     |
| `reasoning-function`, `interaction-function`, `computation-function`, `recall-function`, `prediction-function` and `workflow` | The reference page of each format, as the documentation publishes it; the first ends with what this runtime offers                |
| `first-playbook`, `remember`, `give-tools` and `schedule`                                                                     | Recipes: how a first playbook is made, how a playbook remembers, how a function gets tools, and how a workflow runs on a schedule |

The recipes are also prompts, which a client that shows MCP prompts offers in its menu, each where the connection lists every tool its steps call, so a playbook endpoint offers no `first-playbook` and a key that may only read no prompt: `first-playbook` ("Create your first playbook"), `remember` ("Make the playbook remember something", with what to remember), `give-tools` ("Give the playbook tools", with an optional tool server) and `schedule` ("Run a workflow on a schedule", with the workflow and when). A prompt answers the recipe with the person's words filled in, followed by the format guide it needs.

### Model information

`list_models` lists the model references the server offers, including configured aliases. It requires `org:read`. Its optional `provider` input selects one provider prefix, such as `anthropic`, or a configured gateway name. It is not available on a playbook-scoped endpoint.

The result has `object: "list"`, a `data` array, `catalog_status` and `listed_at`. Each entry contains `id`, `object: "model"`, `created` and `owned_by`. Use a concrete `id` as the reasoning function's `model`. Optional fields include `name`, `context_window`, `max_tokens`, `resolved_to` for aliases, and `pattern: true` for wildcard entries. A wildcard describes a supported prefix; it is not a model to run.

`catalog_status: "partial"` means a provider's list is missing or stale. It does not mean the server has no models. The server caches provider lists for five minutes and retains a previous list when a refresh fails. `listed_at` identifies the oldest provider list in the response, or the response time when no provider was queried. Model access rules also apply when a function runs.

This model catalog lists language models, not MCP tools; `list_tool_servers` lists the tools of the MCP servers a playbook's functions may use. A separately managed tool library is still planned.

## Successful results

A successful tool result carries a plain-language summary, the operation's output as JSON text and the same output as structured content. No tool advertises an output schema, so a client takes `structuredContent` as it comes instead of checking it against one.

| Field               | Contents                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| `content[0].text`   | A plain-language summary of what was done                                      |
| `content[1].text`   | The operation's output as JSON text, for clients that do not read the next one |
| `structuredContent` | The same output as structured content                                          |

Consumers should read `structuredContent`. The first text block is not JSON.

A run result includes its run id, definition version, status and output when successful. Reading it through `get_run` also returns the detailed record. A returned review recommending changes can still belong to a succeeded run: the operation completed and produced that recommendation.

For a workflow, the summaries read like these, recorded from the [first-workflow tutorial](../tutorials/first-workflow.md):

```text
run_definition: The workflow “review-and-approve” has started and is still running. It carries on by itself, and how it ends can be looked up later.
get_run: The workflow “review-and-approve” is still running; how it ends can be looked up again later.
list_interactions: Found 1 request waiting on this page.
answer_interaction: The request is answered: the run that asked it takes the answer within the host's sweep, a second by default, and get_run shows how it ended.
get_run: The run of the workflow “review-and-approve” finished. Its result: review: “Revise: the audience lacks a job role.” and approval: (verdict: “approve” and note: “Approved for the autumn launch.”)
```

A run that finishes later is `started` when `run_definition` returns, unless it ended before its first wait: a workflow's, an interaction function's that asks a person, and a prediction function's build, the input `{ build: {} }`, which waits for its trainer, while a prediction function's question ends within its call. Read it again with `get_run` until its status is `succeeded`, `rejected` or `failed`; a cancelled run is `rejected` with the reason `cancelled`; the summary repeats a short result in words and points to `structuredContent` for a long one.

## Errors

An operation failure has `isError: true` and no `structuredContent`. The first text block explains the failure; the second contains the JSON problem document. Its `reason` and `detail` distinguish invalid input, permissions failures, conflicts and unavailable dependencies.

Authentication and origin checks can reject a request before a tool runs, returning an HTTP problem document. Protocol failures can return JSON-RPC errors. These are separate from a tool result with `isError`.

The [HTTP reference](http.md#responses-and-errors) lists common status codes and problem reasons. [Function availability](../concepts/functions.md#availability) identifies the capabilities covered by these references.
