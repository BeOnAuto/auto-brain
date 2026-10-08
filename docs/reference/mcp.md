# MCP reference

The Auto runtime exposes brain, reasoning-function and workflow operations through Model Context Protocol (MCP). This reference describes endpoint scope, tool names and result formats. For Claude Code, Claude Desktop and Codex connection setup, see the [local quick start](../get-started/local.md); for a worked example, follow [Build your first brain](../tutorials/first-brain.md).

## Connection direction

This is an inbound interface: an external assistant connects to a local or self-hosted Auto runtime and calls its operations. It does not configure tools inside a reasoning function: the operator configures their servers with `mcp_servers` and `allowed_tools`, which the repository's [configuration guide](https://github.com/BeOnAuto/auto-brain/blob/main/docs/engineering/self-host/configuration.md#mcp-servers) describes, and a function names their tools in its [`tools`](reasoning-format.md#tools). Auto Cloud is currently invite-only. [Request an invitation](https://on.auto/request-invite) if you would prefer a hosted brain.

A reasoning function can also call tools itself, through MCP servers the operator of a self-hosted runtime configures. That outbound connection is set up on the server, never by adding an endpoint to an external assistant. While any MCP server is configured, `execute_spec` carries the destructive annotation, since a function's tools may change something. See [Tool access inside a reasoning function](../concepts/functions.md#tool-access-inside-a-reasoning-function).

## Transport and authentication

Endpoints use streamable HTTP without sessions. The local quick start uses `http://localhost:8080/mcp` without an authentication header. Local mode trusts requests on your computer; do not expose it through a tunnel or public proxy.

An authenticated deployment supplies its own endpoint and API key. Credentials belong in the connection configuration, outside prompts and function documents.

The runtime supports protocol revision `2026-07-28` and the compatible revisions `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`. An MCP client handles protocol negotiation.

Authorization uses the same organization, brain and operation permissions as the [HTTP API](http.md#requests-and-access). A connection lists only the tools its key may call: a read-only key sees the tools that read and none that creates or runs a function, and a key that may only read inside some brains is offered `list_brains`, which lists those brains. Choosing a more specific endpoint does not grant extra permissions.

## Endpoint scope

| Path                             | Scope                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/mcp`                           | Brain management, model discovery, function and workflow operations; operations within a brain require a `brain` argument |
| `/orgs/{org}/mcp`                | Brain management and model discovery for the named org                                                                    |
| `/orgs/{org}/brains/{brain}/mcp` | Function and workflow operations for one brain, without a `brain` argument                                                |

An agent that connects receives instructions built for the tools its key may call. They say what a brain is, in the words of the [terminology](../concepts/terminology.md), with a sentence for each type of function the runtime runs and for workflows; what the connection acts on: `/mcp` acts in the key's own org, `/orgs/{org}/mcp` manages the brains of one org, and `/orgs/{org}/brains/{brain}/mcp` acts inside one brain; the one sentence that maps the tools' names to the product's words, a definition a `spec`, a run an `execution` and a definition's type its `primitive`, whose values the `primitive` argument of each tool names; that `get_guide` holds the format of each definition and the recipes; how a reasoning function names its model and its tools; that `get_execution` shows whether a run that finishes later ended or still waits; that when the person approves, rejects or otherwise answers what a run waits on, the agent answers its request with `answer_interaction`, in the shape its function's answer takes, and starts no new run for it; that runs, history, events and requests come a page at a time; and how to answer the person: what was done and what they can do next, in the words of brains, functions, workflows and runs, with an id or a status only when the person needs it to act. A recall function's sentence says what it answers from: what it keeps of the brain's own history, every run's start and end, with its result when it succeeded, the definitions saved and the events published to the brain, never a run's input or its tool calls, so nothing has to write into it.

Functions and workflows share the definition tools: those tools accept `inference` for reasoning functions, `interaction` for interaction functions, `computation` for computation functions and `recollection` for recall functions in a self-hosted runtime, and `orchestration` for workflows. Workflow operations also include `send_execution_event`, and interaction functions add `list_interactions` and `answer_interaction`. On `/mcp`, the API key determines the org; local mode uses its local org. Tools do not take a separate org argument. The named org and brain in scoped endpoints remain subject to the key's access restrictions on an authenticated deployment.

## Tools

| Work                         | Tools                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Manage brains                | `create_brain`, `list_brains`, `get_brain`, `update_brain`, `retire_brain`                               |
| List available models        | `list_models`, with an optional `provider` filter                                                        |
| Manage reasoning functions   | `create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, with `primitive: "inference"`     |
| Manage interaction functions | `create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, with `primitive: "interaction"`   |
| Manage computation functions | `create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, with `primitive: "computation"`   |
| Manage recall functions      | `create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, with `primitive: "recollection"`  |
| Manage workflows             | `create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, with `primitive: "orchestration"` |
| Run and inspect              | `execute_spec`, `get_execution`, `list_executions`, `get_execution_history`                              |
| Answer a request             | `list_interactions`, `answer_interaction`                                                                |
| Answer a waiting workflow    | `send_execution_event`                                                                                   |
| Cancel a run                 | `cancel_execution`                                                                                       |
| Publish an event             | `publish_event`                                                                                          |
| Follow a brain               | `list_brain_events`                                                                                      |
| Read a brain's analytics     | `get_brain_analytics`                                                                                    |
| Find the tools to name       | `list_tool_servers`, with an optional `server` filter                                                    |
| Learn what a tool answers    | `test_tool_call`, with the `server`, the `tool` and its `arguments`                                      |
| Read a guide                 | `get_guide`, with the name of the guide                                                                  |

Every tool supplies its description and input and output JSON Schemas. A description says what the tool does and when to use it; the rules of each argument are in its schema, and the format of a definition is in its guide. Each tool's annotations say whether it only reads, whether what it does cannot be undone, as retiring, cancelling and answering a request cannot, whether calling it again with the same input changes nothing, and whether it reaches outside the runtime. Brain-management and model-discovery tools are available at `/mcp` and the org endpoint; function, workflow, brain event, tool server and tool test tools are available at `/mcp` and the brain endpoint; `get_guide` is available on every endpoint.

Definition operations identify a function or workflow by `primitive` and `name`. Creating or updating a definition takes its document as `source`. Running it accepts `input` and an optional UUID `execution_id`; inspecting a run requires `execution_id`. Cancelling a run requires its `execution_id` and takes an optional `reason`, 1 to 1,024 characters, which the run keeps as the detail of its ending; [Cancelling a run](http.md#cancelling-a-run) says which runs can be cancelled. Sending an event requires the run's `execution_id` and an `event` with a `type`; [HTTP workflows](http.md#workflows) lists its other fields and limits. Publishing an event to a brain requires an `event` with a `source` and a `type`; [Publishing events](http.md#publishing-events) lists its attributes and limits and what publishing it again returns. See [HTTP operations](http.md) for field limits and retry behavior.

`list_executions` lists a brain's runs newest first, with optional `primitive`, `name` and `status` filters. `get_execution_history` reads what was recorded about one run, and `list_brain_events` follows everything that happened in a brain, with optional `type`, `since` and `execution_id` filters, the last keeping the whole tree of one run; both take `order`. Their events carry `id`, `cursor`, `causation_id`, the `id` of the event that led to it, `at`, `type`, a plain-language `summary` and `data` of at most 4 KiB; a workflow run's start is followed directly by one event for each input it took and each step that moved. All three page with `limit` and `cursor` and answer `has_more` and `next_cursor`; a page may be short or empty while `has_more` is `true`. They work on a retired brain. See [Run history and brain events](http.md#run-history-and-brain-events) for the fields and limits.

`get_brain_analytics` counts the runs of a brain that ended over the last 7, 14 or 30 days, with `days`, or between two days, with `from` and `to`: by how they ended, the tokens their models used, and the median and 95th percentile of how long they took, for the whole window and for each `day` of `by_day`, and in `by_function` the number of runs of each definition. It takes the optional `primitive` and `name` filters of `list_executions`. See [Analytics](http.md#analytics) for the window and how each number is counted.

`list_tool_servers` lists the MCP servers set up for the brain, each with the tools a reasoning function may name in `tools` as `server/tool` or `server/*`, so an agent finds the names without being told them; a server that cannot be asked just now shows `unavailable`, in words, in place of its tools. Each tool carries the hints its server gives it, as `annotations`, and `testable`, whether `test_tool_call` may test it. Its optional `server` keeps one server; a name the brain has no server of is refused with `invalid_input`. It asks the servers when it is called, so it is marked as reaching outside the runtime, and it works on a retired brain. See [Tool servers](http.md#tool-servers) for the fields.

`test_tool_call` calls one tool of a tool server with the `arguments` given, as a run of a reasoning function would call it, and answers what that run's model would see, so an agent learns what a tool answers, or finds an id a prompt needs, such as a channel's, without making a function to look. Only a tool its server marks read-only, or that the operator lists in `testable_tools`, can be tested; any other is refused with words that say so. The call is live and recorded in the brain's history, which `list_brain_events` shows. It needs `brain:write`, so a key that may only read is not offered it, and it is marked as reaching outside the runtime, and as destructive while the operator lists any tool as safe to test. See [Testing a tool](http.md#testing-a-tool) for the fields.

`list_interactions` lists the brain's open requests, newest first, each with the `execution_id` of the interaction function's run that asked, the party, the channel, the message, the expiry and how its delivery stands, with optional `to` and `function` filters; it pages with `limit` and `cursor`. `answer_interaction` answers one, with that `execution_id`, an `answer` the function's answer schema takes and an optional `claimed_for`; the run succeeds with the answer as its output, which reaches the workflow that waits for it. An answer that does not match is `invalid_input` with a pointer under `/answer`, and a request that has ended or was answered otherwise is `conflict`. See [Interaction function format](interaction-format.md#answering-a-request).

Retirement is permanent. A retired name cannot be reused, and retired definitions cannot be edited or run.

### Guides and prompts

`get_guide` reads one of the runtime's guides, whole, by its name. Every endpoint serves the same guides, and lists them as resources, `guide://<name>`, in Markdown, for clients that let a person or a model read them directly.

| Guide                                                                                                  | Holds                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `terminology`                                                                                          | What the words of a brain mean, for the types of function the runtime runs                                                  |
| `reasoning-function`, `interaction-function`, `computation-function`, `recall-function` and `workflow` | The reference page of each format, as the documentation publishes it; the first ends with what this runtime offers          |
| `first-brain`, `remember`, `give-tools` and `schedule`                                                 | Recipes: how a first brain is made, how a brain remembers, how a function gets tools, and how a workflow runs on a schedule |

The recipes are also prompts, which a client that shows MCP prompts offers in its menu, each where the connection lists every tool its steps call, so a brain endpoint offers no `first-brain` and a key that may only read no prompt: `first-brain` ("Create your first brain"), `remember` ("Make the brain remember something", with what to remember), `give-tools` ("Give the brain tools", with an optional tool server) and `schedule` ("Run a workflow on a schedule", with the workflow and when). A prompt answers the recipe with the person's words filled in, followed by the format guide it needs.

### Model information

`list_models` lists the model references the server offers, including configured aliases. It requires `org:read`. Its optional `provider` input selects one provider prefix, such as `anthropic`, or a configured gateway name. It is not available on a brain-scoped endpoint.

The result has `object: "list"`, a `data` array, `catalog_status` and `listed_at`. Each entry contains `id`, `object: "model"`, `created` and `owned_by`. Use a concrete `id` as the reasoning function's `model`. Optional fields include `name`, `context_window`, `max_tokens`, `resolved_to` for aliases, and `pattern: true` for wildcard entries. A wildcard describes a supported prefix; it is not a model to run.

`catalog_status: "partial"` means a provider's list is missing or stale. It does not mean the server has no models. The server caches provider lists for five minutes and retains a previous list when a refresh fails. `listed_at` identifies the oldest provider list in the response, or the response time when no provider was queried. Model access rules also apply when a function runs.

This model catalog lists language models, not MCP tools; `list_tool_servers` lists the tools of the MCP servers a brain's functions may use. A separately managed tool library is still planned.

## Successful results

A successful tool result contains the operation output in `structuredContent`:

| Field               | Contents                                                               |
| ------------------- | ---------------------------------------------------------------------- |
| `structuredContent` | The operation's structured output                                      |
| `content[0].text`   | A human-readable summary                                               |
| `content[1].text`   | The same output as JSON, for clients without structured-output support |

Consumers should read `structuredContent`. The first text block is not JSON.

A run result includes its execution id, definition version, status and output when successful. Reading it through `get_execution` also returns the detailed record. A returned review recommending changes can still belong to a succeeded run: the operation completed and produced that recommendation.

For a workflow, the summaries read like these, recorded from the [first-workflow tutorial](../tutorials/first-workflow.md):

```text
execute_spec: The workflow “review-and-approve” has started and is still running. It carries on by itself, and how it ends can be looked up later.
get_execution: The workflow “review-and-approve” is still running; how it ends can be looked up again later.
list_interactions: Found 1 request waiting on this page.
answer_interaction: The request is answered: the run that asked it succeeded, with the answer as its output.
get_execution: The run of the workflow “review-and-approve” finished. Its result: review: “Revise: the audience lacks a job role.” and approval: (verdict: “approve” and note: “Approved for the autumn launch.”)
```

A workflow run is `started` when `execute_spec` returns, unless it ended before its first wait. Read it again with `get_execution` until its status is `succeeded`, `rejected` or `failed`; a cancelled run is `rejected` with the reason `cancelled`; the summary repeats a short result in words and points to `structuredContent` for a long one.

## Errors

An operation failure has `isError: true` and no `structuredContent`. The first text block explains the failure; the second contains the JSON problem document. Its `reason` and `detail` distinguish invalid input, permissions failures, conflicts and unavailable dependencies.

Authentication and origin checks can reject a request before a tool runs, returning an HTTP problem document. Protocol failures can return JSON-RPC errors. These are separate from a tool result with `isError`.

The [HTTP reference](http.md#responses-and-errors) lists common status codes and problem reasons. [Function availability](../concepts/functions.md#availability) identifies the capabilities covered by these references.
