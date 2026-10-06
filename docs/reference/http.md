# HTTP API

The HTTP API provides brain management, reasoning-function and workflow definitions, recorded runs, events for waiting workflows, and the history of a run and of a brain. Requests use the API base URL and credentials supplied for the workspace.

The runtime exposes the same operations through HTTP and [MCP](mcp.md). The API calls definitions `specs` and runs `executions`. The `primitive` field names the type of a definition: `inference` for a reasoning function and `orchestration` for a workflow.

## Requests and access

Send credentials as `Authorization: Bearer <key>` and command bodies as UTF-8 JSON with `Content-Type: application/json`. Keep credentials out of prompts and source documents.

Org routes begin at `/v1/orgs/{org}`. Brain routes begin at `/v1/orgs/{org}/brains/{brain}`. Each API key belongs to one org and has permissions for a set of brains. Reading definitions and runs requires `brain:read`; creating, changing or running a function or workflow, and sending an event, require `brain:write`.

Request bodies may be at most 1 MiB; compressed bodies are not accepted. Query parameters belong to GET requests. A field cannot be supplied in more than one location.

## Brains

These routes are relative to `/v1/orgs/{org}`:

| Operation      | Method and route              | Input                                   |
| -------------- | ----------------------------- | --------------------------------------- |
| `create_brain` | `POST /brains`                | `brain`, `name`, optional `description` |
| `list_brains`  | `GET /brains`                 | Optional `include_retired`              |
| `get_brain`    | `GET /brains/{brain}`         | Brain id in path                        |
| `update_brain` | `PUT /brains/{brain}`         | `name` and `description`                |
| `retire_brain` | `POST /brains/{brain}/retire` | Brain id in path                        |

Brain ids contain 3 to 48 lowercase letters, digits and hyphens, beginning with a letter. Names contain 1 to 100 characters and descriptions at most 2,000. Read operations need `org:read`, and writes need `org:write`. Lists include accessible brains, with retired brains excluded unless requested.

Retirement is permanent. Brain ids cannot be reused, and a retired brain cannot be restored.

## Models

`GET /v1/orgs/{org}/models` lists the models the server offers. It requires `org:read` and accepts an optional `provider` query parameter. A provider prefix contains 1 to 32 lowercase letters, digits or hyphens, starting with a letter.

The JSON result contains `object: "list"`, `data`, `catalog_status` and `listed_at`. Entries are sorted by `id`, with each id appearing once. The [MCP model reference](mcp.md#model-information) describes the entry fields, aliases, wildcard patterns and incomplete results. The same output is returned over both interfaces.

## Reasoning functions

These routes are relative to `/v1/orgs/{org}/brains/{brain}`:

| Operation       | Method and route                       | Input                                          |
| --------------- | -------------------------------------- | ---------------------------------------------- |
| `create_spec`   | `POST /specs/inference`                | `name`, `source`                               |
| `list_specs`    | `GET /specs/inference`                 | Optional `include_retired`                     |
| `get_spec`      | `GET /specs/inference/{name}`          | Name in path                                   |
| `update_spec`   | `PUT /specs/inference/{name}`          | `source`                                       |
| `retire_spec`   | `POST /specs/inference/{name}/retire`  | Name in path                                   |
| `execute_spec`  | `POST /specs/inference/{name}/execute` | Optional `input`, optional UUID `execution_id` |
| `get_execution` | `GET /executions/{execution_id}`       | Execution id in path                           |

The `source` is a [reasoning function document](reasoning-format.md). Names follow the same 3 to 48 character rule as brain ids. Source documents may be at most 65,536 UTF-8 bytes. A name is unique within its primitive and brain and cannot be reused after retirement.

Changing a document creates a version. Updating it with identical source records no change. A run uses the active latest version. Retired definitions can be read but cannot be edited or run.

## Workflows

These routes are relative to `/v1/orgs/{org}/brains/{brain}`:

| Operation              | Method and route                           | Input                                                                  |
| ---------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| `create_spec`          | `POST /specs/orchestration`                | `name`, `source`                                                       |
| `list_specs`           | `GET /specs/orchestration`                 | Optional `include_retired`                                             |
| `get_spec`             | `GET /specs/orchestration/{name}`          | Name in path                                                           |
| `update_spec`          | `PUT /specs/orchestration/{name}`          | `source`                                                               |
| `retire_spec`          | `POST /specs/orchestration/{name}/retire`  | Name in path                                                           |
| `execute_spec`         | `POST /specs/orchestration/{name}/execute` | Optional `input`, optional UUID `execution_id`                         |
| `get_execution`        | `GET /executions/{execution_id}`           | Execution id in path                                                   |
| `send_execution_event` | `POST /executions/{execution_id}/events`   | `event` with `type`, and optional `id`, `source`, `subject` and `data` |

The `source` is a [workflow document](workflow-format.md). Names, document size, versions and retirement follow the rules for reasoning functions above. A saved workflow has the `media_type` `application/yaml`, and its `description`, `input_schema` and `output_schema` come from the document.

`execute_spec` returns 200 as soon as the run begins, with its `execution_id` and `status: started`. Read the run with `get_execution` until its status is `succeeded`, `rejected` or `failed`, and its steps with `get_execution_history`, which holds one `workflow_input_applied` event for each input the run took (see [Run history and brain events](#run-history-and-brain-events)). While the runtime is stopping, `execute_spec` returns `unavailable`; try again shortly.

A workflow runs once for each `execution_id`. Executing it again with the `execution_id` of a run that is going returns the run as it stands; with the `execution_id` of a run that ended without a final result, it returns `conflict`, so run the workflow again under a new `execution_id`.

`send_execution_event` delivers an event to a run that is still `started`. It returns the `execution_id` and the delivered `event`, with an `id`, made by the runtime when you leave it out, and the `time` it was sent. An event may take at most 256 KiB as JSON; its `type` and `id` at most 256 characters, and its `source` and `subject` at most 1,024. A run takes an event with a given `id` once, so a request can be retried with the same id. The operation returns `not_found` when the brain has no running workflow with that execution id, including one that has ended, and `unavailable` when the run cannot take the event at that moment, as while the runtime is stopping; try again shortly.

## Runs and results

A run records its `execution_id`, `primitive`, `name`, `spec_version`, `status`, timestamps and caller identity. Successful runs include `output`; rejected runs include a rejection. `get_execution` also returns the detailed `record`.

Reasoning functions normally complete within the execute request. A workflow run answers `started` and continues after the request; while it is in progress, its `record` is empty. [Workflows and runs](../concepts/workflows.md) explains how a run waits and ends. Inputs may be at most 256 KiB as encoded JSON. Output and record together may be at most 1 MiB. These limits apply independently of the request-body limit.

Supply `execution_id` when you need to inspect failures or retry a request. Reusing an id with a different function or input returns `conflict`. Once a run succeeds or rejects invalid input, another request with the same id and input returns the recorded final result. A request with the id of a workflow run still in progress returns that run as it stands, without starting another.

A run without a final result may be attempted again after an interruption or recoverable failure, with two exceptions. A workflow run runs once for its execution id. A reasoning function that calls tools is never run again under its id once one of its tools may have been called: when an earlier attempt called a tool and did not succeed, or when the function names tools and an earlier attempt has started and not ended, since it may still be running. The answer is `conflict` with the kind `tools_called`; check what the run's history shows it called, then start a new run under a new id. A retry can use the latest definition version, which the new attempt records. Do not assume that an external effect happened only once because the runtime records one final result.

## Run history and brain events

These routes are relative to `/v1/orgs/{org}/brains/{brain}` and need `brain:read`:

| Operation               | Method and route                         | Input                                                                   |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `list_executions`       | `GET /executions`                        | Optional `primitive`, `name`, `status`, `limit` and `cursor`            |
| `get_execution_history` | `GET /executions/{execution_id}/history` | Execution id in path; optional `order`, `limit` and `cursor`            |
| `list_brain_events`     | `GET /events`                            | Optional `type`, `since`, `execution_id`, `order`, `limit` and `cursor` |

`list_executions` returns `executions`, newest first by when each run first started. A listed run has the fields `get_execution` returns, without `output`, `record` and the detail and issues of a rejection; a rejection shows its `reason`, with `kind` and `because` when the function gave them. `status` keeps the runs whose status is `started`, `succeeded`, `rejected` or `failed`, and `primitive` and `name` keep the runs of one definition.

`get_execution_history` returns the `events` of one run, oldest first unless `order` is `desc`: the facts the runtime recorded about the run, each start and how it ended. Tool-using runs also record `tool_call_started` and `tool_call_answered`. A run that does not exist in the brain returns `not_found`. For a workflow, the history also holds one `workflow_input_applied` event for each input its run took, followed by one event for each step that input moved: `step_started`, `step_waiting`, `step_finished`, `step_failed` or `step_skipped`. `list_brain_events` returns the `events` of the whole brain, newest first unless `order` is `asc`: definitions created, updated and retired, runs started and ended, tool calls and the inputs workflow runs took. `type` keeps one event type. `since`, an ISO 8601 time with its offset such as `2026-10-05T09:00:00Z`, keeps what the brain recorded from that time on, in either order. `execution_id` keeps what one run and every run it started recorded, such as the functions a workflow called: its whole tree. A run that another run started belongs to the tree of the run at its top, so its own id answers no events; read the tree from the id of the run you started.

Tool-call events identify the server, tool, argument and result sizes and digests, and how each call ended. Content is omitted unless the operator enables `record_content`. Recorded content is scrubbed and bounded; the history API shows at most 2 KiB of each recorded argument or result. Anyone with read access to the brain can read that history. A started call without an answer may have had an external effect; absence of an answer does not prove it was cancelled before acting.

Each event has these fields:

| Field          | Contents                                                                                                                                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | The event's id, a UUID that stays the same on every read                                                                                                                                                                                                                                                          |
| `cursor`       | The place to read on from: pass it as `cursor` to read what follows the event                                                                                                                                                                                                                                     |
| `causation_id` | The `id` of the event that directly led to this one, or `null` when nothing recorded did, as for a run you started                                                                                                                                                                                                |
| `at`           | When it happened, by its own clock, in ISO 8601 UTC                                                                                                                                                                                                                                                               |
| `type`         | `execution_started`, `execution_deferred`, `execution_succeeded`, `execution_rejected`, `execution_failed`, `tool_call_started`, `tool_call_answered`, `workflow_input_applied`, `step_started`, `step_waiting`, `step_finished`, `step_failed`, `step_skipped`, `spec_created`, `spec_updated` or `spec_retired` |
| `summary`      | A sentence in plain language                                                                                                                                                                                                                                                                                      |
| `data`         | The facts of the event, at most 4 KiB as JSON                                                                                                                                                                                                                                                                     |

In `data`, inputs, outputs, records, documents and schemas appear as their sizes in bytes. `get_execution` returns a run's output and record, and `get_spec` a definition's document and schemas; the API does not return a run's original input. A rejection shows its reason, its detail shortened to fit, and for invalid input the number of issues and the first five. A definition's description shows its first 300 characters, and its warnings as a count. A `workflow_input_applied` event shows the kind and key of the input, how many steps it moved and the first five, each with its task, run and outcome, the kind and because of a function's rejection that has them, in its words too, and the kinds of what the run did next; it never shows the run's data. A step event shows the step's `name`, its `reference` in the document, its `run`, which counts each time the step starts, and `times`, which counts how often it moved that way in that run; `step_waiting` adds what it waits for, `call`, `timer` or `event`, and for a call the `execution_id` of the run it started, whose `execution_started` names that `step_waiting` as its cause; `step_failed` adds how it failed and its error's type and title.

The causes link the events of a run into a graph. A run you start has no cause; its first input, and each step, is caused by what came before it: the step before it in its list, the `switch` that chose it, the `fork` that started its branch, or the failed attempt a retry repeats. An input that resumes a waiting step is caused by that step's `step_waiting`, and the run's end by its last step event.

Every page carries `has_more` and `next_cursor`. Pass `next_cursor` as `cursor` to read the next page, until `next_cursor` is `null`. `limit` is 1 to 100, and 20 when left out; it counts the events a page answers with, step events included, so a page can end between the step events of one input, and its `next_cursor` reads on from the next one. A page can hold fewer items than `limit`, or none, while `has_more` is `true`: `primitive` and `name` apply to the runs a page looked at, records with no event type are left out, a page stops after loading 4 MiB of stored data, and with `status` or `type` after looking at 1,000 runs or records. Cursors are opaque; a cursor this brain did not give returns `invalid_input` at `/cursor`.

The brain's own creation, changes and retirement are not brain events; `get_brain` shows them. A retired brain stays readable: these reads work on it, while every change to it is refused with `conflict`.

## Responses and errors

Successful responses contain JSON with `Cache-Control: no-store`. Create operations return 201; other successful operations generally return 200.

API errors use RFC 9457 problem documents with `Content-Type: application/problem+json`. Inspect `reason` and `detail`; `invalid_input` includes an `errors` list of JSON pointers. A rejection that has a `kind` carries it, and an `unavailable` one its `because`: `tools_unfinished` means a run called tools and could not finish, so its tools may have changed something, and a request with the same execution id answers `conflict` with the kind `tools_called`. `Retry-After` comes only with an `unavailable` answer that a retry of the same request may resolve, never with `tools_unfinished`, `tool_not_offered` or `model_not_offered`.

| Status | Common reason                              |
| ------ | ------------------------------------------ |
| 400    | `bad_request`                              |
| 401    | Missing or invalid credentials             |
| 403    | `forbidden` or `origin_not_allowed`        |
| 404    | `not_found`                                |
| 405    | Unsupported method; see the `Allow` header |
| 409    | `conflict`                                 |
| 422    | `invalid_input`                            |
| 500    | `internal`                                 |
| 503    | `unavailable`                              |

A problem document's `type` is a URI that names its kind of problem:

| Type                                              | Status | Means                                                                                                    |
| ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `https://on.auto/problems/bad_request`            | 400    | The request is malformed, such as a field given twice or a body that is not a JSON object                |
| `https://on.auto/problems/unauthenticated`        | 401    | Credentials are missing or invalid                                                                       |
| `https://on.auto/problems/forbidden`              | 403    | The credentials may not do that                                                                          |
| `https://on.auto/problems/origin_not_allowed`     | 403    | A browser sent the request from an origin the server does not allow                                      |
| `https://on.auto/problems/not_found`              | 404    | Something the request names does not exist                                                               |
| `https://on.auto/problems/method_not_allowed`     | 405    | The path does not take that method                                                                       |
| `https://on.auto/problems/conflict`               | 409    | The request clashes with what is there                                                                   |
| `https://on.auto/problems/tools_called`           | 409    | A run that may have called tools is not run again under its id; its `reason` is `conflict`               |
| `https://on.auto/problems/content_too_large`      | 413    | The body is larger than 1 MiB                                                                            |
| `https://on.auto/problems/unsupported_media_type` | 415    | The body is not sent as `application/json` in UTF-8                                                      |
| `https://on.auto/problems/invalid_input`          | 422    | The input does not fit, with the `errors` that point at it                                               |
| `https://on.auto/problems/client_closed_request`  | 499    | The client went away before the answer                                                                   |
| `https://on.auto/problems/internal`               | 500    | Something went wrong inside the server                                                                   |
| `https://on.auto/problems/unavailable`            | 503    | Something the server relies on cannot serve now                                                          |
| `https://on.auto/problems/tools_unfinished`       | 503    | A run called tools and could not finish; its `reason` is `unavailable`, and it is never retried as it is |

A 500 response contains an incident reference. Its `instance` and the `x-request-id` response header identify the server log entry. Include that reference when reporting a problem, without sharing credentials or confidential input. Malformed HTTP can return a bare status before the API handles it.

A function naming a model outside the deployment's allow list returns `unavailable` with kind `model_not_offered` and `because: "model_not_allowed"`, before calling the provider. A missing provider can return the same kind with `because: "provider_not_configured"`. Use `list_models` to inspect the offered references.
