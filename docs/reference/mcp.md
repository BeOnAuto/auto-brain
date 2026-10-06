# MCP reference

The Auto runtime exposes brain, reasoning-function and workflow operations through Model Context Protocol (MCP). This reference describes endpoint scope, tool names and result formats. For Claude Code, Claude Desktop and Codex connection setup, see the [local quick start](../get-started/local.md); for a worked example, follow [Build your first brain](../tutorials/first-brain.md).

## Connection direction

This is an inbound interface: an external assistant connects to a local or self-hosted Auto runtime and calls its operations. It does not configure tools inside a reasoning function. Auto Cloud is coming soon; [request an invite](https://on.auto/request-invite) for hosted access.

A reasoning function can also call tools itself, through MCP servers the operator of a self-hosted runtime configures. That outbound connection is set up on the server, never by adding an endpoint to an external assistant. While any MCP server is configured, `execute_spec` carries the destructive annotation, since a function's tools may change something. See [Tool access inside a reasoning function](../concepts/functions.md#tool-access-inside-a-reasoning-function).

## Transport and authentication

Endpoints use streamable HTTP without sessions. The local quick start uses `http://localhost:8080/mcp` without an authentication header. Local mode trusts requests on your computer; do not expose it through a tunnel or public proxy.

An authenticated deployment supplies its own endpoint and API key. Credentials belong in the connection configuration, outside prompts and function documents.

The runtime supports protocol revision `2026-07-28` and the compatible revisions `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`. An MCP client handles protocol negotiation.

Authorization uses the same organization, brain and operation permissions as the [HTTP API](http.md#requests-and-access). A read-only key cannot create or run functions. Choosing a more specific endpoint does not grant extra permissions.

## Endpoint scope

| Path                             | Scope                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/mcp`                           | Brain management, model discovery, function and workflow operations; operations within a brain require a `brain` argument |
| `/orgs/{org}/mcp`                | Brain management and model discovery for the named org                                                                    |
| `/orgs/{org}/brains/{brain}/mcp` | Function and workflow operations for one brain, without a `brain` argument                                                |

Functions and workflows share the definition tools: those tools accept `inference` for reasoning functions and `orchestration` for workflows. Workflow operations also include `send_execution_event`. On `/mcp`, the API key determines the org; local mode uses its local org. Tools do not take a separate org argument. The named org and brain in scoped endpoints remain subject to the key's access restrictions on an authenticated deployment.

## Tools

| Work                       | Tools                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Manage brains              | `create_brain`, `list_brains`, `get_brain`, `update_brain`, `retire_brain`                               |
| List available models      | `list_models`, with an optional `provider` filter                                                        |
| Manage reasoning functions | `create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, with `primitive: "inference"`     |
| Manage workflows           | `create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, with `primitive: "orchestration"` |
| Run and inspect            | `execute_spec`, `get_execution`, `list_executions`, `get_execution_history`                              |
| Answer a waiting workflow  | `send_execution_event`                                                                                   |
| Publish an event           | `publish_event`                                                                                          |
| Follow a brain             | `list_brain_events`                                                                                      |
| Read a brain's analytics   | `get_brain_analytics`                                                                                    |

Every tool supplies its description and input and output JSON Schemas. Read-only operations are marked as such. Brain-management and model-discovery tools are available at `/mcp` and the org endpoint; function, workflow and brain event tools are available at `/mcp` and the brain endpoint.

Definition operations identify a function or workflow by `primitive` and `name`. Creating or updating a definition takes its document as `source`. Running it accepts `input` and an optional UUID `execution_id`; inspecting a run requires `execution_id`. Sending an event requires the run's `execution_id` and an `event` with a `type`; [HTTP workflows](http.md#workflows) lists its other fields and limits. Publishing an event to a brain requires an `event` with a `source` and a `type`; [Publishing events](http.md#publishing-events) lists its attributes and limits and what publishing it again returns. See [HTTP operations](http.md) for field limits and retry behavior.

`list_executions` lists a brain's runs newest first, with optional `primitive`, `name` and `status` filters. `get_execution_history` reads what was recorded about one run, and `list_brain_events` follows everything that happened in a brain, with optional `type` and `since` filters; both take `order`. Their events carry `id`, `at`, `type`, a plain-language `summary` and `data` of at most 4 KiB. All three page with `limit` and `cursor` and answer `has_more` and `next_cursor`; a page may be short or empty while `has_more` is `true`. They work on a retired brain. See [Run history and brain events](http.md#run-history-and-brain-events) for the fields and limits.

`get_brain_analytics` counts the runs of a brain that ended over the last 7, 14 or 30 days, with `days`, or between two days, with `from` and `to`: by how they ended, the tokens their models used, and the median and 95th percentile of how long they took, for the whole window and for each `day` of `by_day`, and in `by_function` the number of runs of each definition. It takes the optional `primitive` and `name` filters of `list_executions`. See [Analytics](http.md#analytics) for the window and how each number is counted.

Retirement is permanent. A retired name cannot be reused, and retired definitions cannot be edited or run.

### Model information

`list_models` lists the model references the server offers, including configured aliases. It requires `org:read`. Its optional `provider` input selects one provider prefix, such as `anthropic`, or a configured gateway name. It is not available on a brain-scoped endpoint.

The result has `object: "list"`, a `data` array, `catalog_status` and `listed_at`. Each entry contains `id`, `object: "model"`, `created` and `owned_by`. Use a concrete `id` as the reasoning function's `model`. Optional fields include `name`, `context_window`, `max_tokens`, `resolved_to` for aliases, and `pattern: true` for wildcard entries. A wildcard describes a supported prefix; it is not a model to run.

`catalog_status: "partial"` means a provider's list is missing or stale. It does not mean the server has no models. The server caches provider lists for five minutes and retains a previous list when a refresh fails. `listed_at` identifies the oldest provider list in the response, or the response time when no provider was queried. Model access rules also apply when a function runs.

This model catalog lists language models, not MCP tools. A self-hosted runtime lists configured servers' tools when a reasoning function needs them. A separately managed tool library is still planned.

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
execute_spec: The workflow “review-brief-revision” has started and is still running. It carries on by itself, and how it ends can be looked up later.
get_execution: The workflow “review-brief-revision” is still running; how it ends can be looked up again later.
send_execution_event: Delivered the event “com.example.brief.revised” to the running workflow. The workflow uses it as soon as it is waiting for it.
get_execution: The run of the workflow “review-brief-revision” finished. Its result is too long to repeat here; the whole of it is in the details below.
```

A workflow run is `started` when `execute_spec` returns. Read it again with `get_execution` until its status is `succeeded`, `rejected` or `failed`; the summary repeats a short result in words and points to `structuredContent` for a long one.

## Errors

An operation failure has `isError: true` and no `structuredContent`. The first text block explains the failure; the second contains the JSON problem document. Its `reason` and `detail` distinguish invalid input, permissions failures, conflicts and unavailable dependencies.

Authentication and origin checks can reject a request before a tool runs, returning an HTTP problem document. Protocol failures can return JSON-RPC errors. These are separate from a tool result with `isError`.

The [HTTP reference](http.md#responses-and-errors) lists common status codes and problem reasons. [Function availability](../concepts/functions.md#availability) identifies the capabilities covered by these references.
