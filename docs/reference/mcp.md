# MCP reference

The Auto runtime exposes brain, reason-function and workflow operations through Model Context Protocol (MCP). This reference describes endpoint scope, tool names and result formats. For connection setup, see [Connect your agent](https://on.auto/docs/get-started/cloud); for a worked example, follow [Build your first brain](../tutorials/first-brain.md).

## Connection direction

This is an inbound interface: an external assistant connects to Auto Cloud or a self-hosted runtime and calls its operations. It does not configure tools inside a reason function.

Internal tool access through a shared catalog, an outbound MCP gateway or direct tool lists is coming soon, together with bounded tool-call loops. None of those capabilities is enabled by adding an endpoint to an external assistant. See [Tool access inside a reason function](../concepts/functions.md#tool-access-inside-a-reason-function).

## Transport and authentication

Endpoints use streamable HTTP without sessions. Clients supply the endpoint and authentication details issued for their workspace. Credentials belong in the connection configuration, outside prompts and function documents.

The runtime supports protocol revision `2026-07-28` and the compatible revisions `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`. An MCP client handles protocol negotiation.

Authorization uses the same organization, brain and operation permissions as the [HTTP API](http.md#requests-and-access). A read-only key cannot create or run functions. Choosing a more specific endpoint does not grant extra permissions.

## Endpoint scope

| Path                             | Scope                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/mcp`                           | Brain management, model discovery and function operations; function tools require a `brain` argument |
| `/orgs/{org}/mcp`                | Brain management and model discovery for the named org                                               |
| `/orgs/{org}/brains/{brain}/mcp` | Function operations for one brain, without a `brain` argument                                        |

On `/mcp`, the API key determines the org; tools do not take a separate org argument. The named org and brain in scoped endpoints remain subject to the key's access restrictions.

## Tools

Product terminology uses reason functions, workflows and runs. Tool names retain the API's `spec` and `execution` identifiers.

| Work                    | Tools                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Manage brains           | `create_brain`, `list_brains`, `get_brain`, `update_brain`, `retire_brain`                           |
| List available models   | `list_models`, with an optional `provider` filter                                                    |
| Manage reason functions | `create_spec`, `list_specs`, `get_spec`, `update_spec`, `retire_spec`, with `primitive: "inference"` |
| Manage workflows        | The same tools, with `primitive: "orchestration"`                                                    |
| Run and inspect         | `execute_spec`, `get_execution`, `list_executions`, `get_execution_history`                          |
| Send a run an event     | `send_execution_event`, to a workflow run waiting for one                                            |
| Follow a brain          | `list_brain_events`                                                                                  |

Every tool supplies its description and input and output JSON Schemas. Read-only operations are marked as such. Brain-management and model-discovery tools are available at `/mcp` and the org endpoint; function tools are available at `/mcp` and the brain endpoint.

Definition operations identify the function by `primitive` and `name`. Creating or updating a definition takes its document as `source`. Running it accepts `input` and an optional UUID `execution_id`; inspecting a run requires `execution_id`. See [HTTP operations](http.md) for field limits and retry behavior.

`list_executions` lists a brain's runs newest first, with optional `primitive`, `name` and `status` filters. `get_execution_history` reads what was recorded about one run, and `list_brain_events` follows everything that happened in a brain, with optional `type` and `since` filters; both take `order`. Their events carry `id`, `at`, `type`, a plain-language `summary` and `data` of at most 4 KiB. All three page with `limit` and `cursor` and answer `has_more` and `next_cursor`; a page may be short or empty while `has_more` is `true`. They work on a retired brain. See [Run history and brain events](http.md#run-history-and-brain-events) for the fields and limits.

Retirement is permanent. A retired name cannot be reused, and retired definitions cannot be edited or run.

### Model information

`list_models` lists the model references the server offers, including configured aliases. It requires `org:read`. Its optional `provider` input selects one provider prefix, such as `anthropic`, or a configured gateway name. It is not available on a brain-scoped endpoint.

The result has `object: "list"`, a `data` array, `catalog_status` and `listed_at`. Each entry contains `id`, `object: "model"`, `created` and `owned_by`. Use a concrete `id` as the reason function's `model`. Optional fields include `name`, `context_window`, `max_tokens`, `resolved_to` for aliases, and `pattern: true` for wildcard entries. A wildcard describes a supported prefix; it is not a model to run.

`catalog_status: "partial"` means a provider's list is missing or stale. It does not mean the server has no models. The server caches provider lists for five minutes and retains a previous list when a refresh fails. `listed_at` identifies the oldest provider list in the response, or the response time when no provider was queried. Model access rules also apply when a function runs.

This model catalog lists language models. The shared catalog for tools used inside reason functions is a separate, upcoming capability.

## Successful results

A successful tool result contains the operation output in `structuredContent`:

| Field               | Contents                                                               |
| ------------------- | ---------------------------------------------------------------------- |
| `structuredContent` | The operation's structured output                                      |
| `content[0].text`   | A human-readable summary                                               |
| `content[1].text`   | The same output as JSON, for clients without structured-output support |

Consumers should read `structuredContent`. The first text block is not JSON.

A run result includes its execution id, definition version, status and output when successful. Reading it through `get_execution` also returns the detailed record. A returned review recommending changes can still belong to a succeeded run: the operation completed and produced that recommendation.

## Errors

An operation failure has `isError: true` and no `structuredContent`. The first text block explains the failure; the second contains the JSON problem document. Its `reason` and `detail` distinguish invalid input, permissions failures, conflicts and unavailable dependencies.

Authentication and origin checks can reject a request before a tool runs, returning an HTTP problem document. Protocol failures can return JSON-RPC errors. These are separate from a tool result with `isError`.

The [HTTP reference](http.md#responses-and-errors) lists common status codes and problem reasons. [Function availability](../concepts/functions.md#availability) identifies the capabilities covered by these references.
