# HTTP API

The runtime exposes the same operations through HTTP and [MCP](mcp.md). The API calls a definition a `spec` and its run an `execution`.

Use an API key as `Authorization: Bearer <key>`, except in loopback-only local mode. See [Authentication and security](../self-host/security.md). For executable examples, follow the [HTTP walkthrough](http-tutorial.md).

## Requests and responses

Org routes begin at `/v1/orgs/{org}`. Brain routes begin at `/v1/orgs/{org}/brains/{brain}`. A key belongs to one org, with permissions and an allowed set of brains.

Send command bodies as UTF-8 JSON objects with `Content-Type: application/json`. Request bodies may be at most 1 MiB; compressed bodies are not accepted. Query parameters belong to GET requests. A field cannot be supplied in more than one location.

Successful responses contain the operation output as JSON with `Cache-Control: no-store`. Create operations return 201; other successful operations generally return 200. Unknown routes return 404. Unsupported methods return 405 with an `Allow` header.

## Brains

These routes are relative to `/v1/orgs/{org}`:

| Operation      | Method and route              | Input                                   |
| -------------- | ----------------------------- | --------------------------------------- |
| `create_brain` | `POST /brains`                | `brain`, `name`, optional `description` |
| `list_brains`  | `GET /brains`                 | Optional `include_retired`              |
| `get_brain`    | `GET /brains/{brain}`         | Brain id in path                        |
| `update_brain` | `PUT /brains/{brain}`         | `name` and `description`                |
| `retire_brain` | `POST /brains/{brain}/retire` | Brain id in path                        |

Brain ids contain 3 to 48 lowercase letters, digits and hyphens, beginning with a letter. Names contain 1 to 100 characters and descriptions at most 2,000. Ids are never reused. Retirement is permanent; it is not deletion or an archive that can be restored.

Read operations need `org:read`, and writes need `org:write`. The key's brain restrictions apply to named-brain operations. Lists include only accessible brains, with retired brains excluded unless requested.

## Definitions

These routes are relative to `/v1/orgs/{org}/brains/{brain}`:

| Operation              | Method and route                         | Input                                          |
| ---------------------- | ---------------------------------------- | ---------------------------------------------- |
| `create_spec`          | `POST /specs/{primitive}`                | `name`, `source`                               |
| `list_specs`           | `GET /specs/{primitive}`                 | Optional `include_retired`                     |
| `get_spec`             | `GET /specs/{primitive}/{name}`          | Path parameters                                |
| `update_spec`          | `PUT /specs/{primitive}/{name}`          | `source`                                       |
| `retire_spec`          | `POST /specs/{primitive}/{name}/retire`  | Path parameters                                |
| `execute_spec`         | `POST /specs/{primitive}/{name}/execute` | Optional `input`, optional UUID `execution_id` |
| `get_execution`        | `GET /executions/{execution_id}`         | Execution id in path                           |
| `send_execution_event` | `POST /executions/{execution_id}/events` | `event`, for a workflow's run                  |

Supported primitive identifiers are `inference` and `orchestration`. A reasoning function uses the [Markdown prompt format](reasoning-format.md). A workflow uses the [YAML workflow format](../../reference/workflow-format.md), which [workflow execution](workflow-format.md) runs.

Names contain 3 to 48 lowercase letters, digits and hyphens, beginning with a letter. Source documents may be at most 65,536 UTF-8 bytes. A name is unique within its primitive and brain and cannot be reused after retirement.

Changing a document creates a new version. Updating it with identical source succeeds without recording a change. Execution uses the active latest version. Retirement is permanent: retired definitions can be read but cannot be edited or run.

Queries need `brain:read`; commands, including execution and events, need `brain:write`. An API key with read access alone cannot run a function.

## Runs and results

A run includes `execution_id`, `primitive`, `name`, `spec_version`, `status`, timestamps and caller identity. It includes an `output` when successful or a rejection when rejected. Reading a run with `get_execution` also returns its detailed `record`.

Reasoning functions normally complete within the execute request. Workflows return `started` while work continues. Poll `get_execution` until the status becomes `succeeded`, `rejected` or `failed`. An approval event should be sent to the waiting run; it does not create another run.

Inputs may be at most 256 KiB as encoded JSON and nest at most 512 levels deep, which `invalid_input` at `/input` refuses before anything is recorded; the data of an event sent to a run or published to a brain may nest at most 510, so that a run can hold the event in a list. Output and record together may be at most 1 MiB. The runtime applies these limits independently of the request-body limit.

## Published events

`publish_event` is `POST /events` relative to `/v1/orgs/{org}/brains/{brain}`, under `brain:write`. Its body is `{ event }`, a CloudEvents 1.0 event with `source`, a URI reference, and `type`, and optionally `specversion` (`1.0`), `id`, `subject`, `time` in RFC 3339, `datacontenttype`, `dataschema` and `data`; any other attribute is an extension of lowercase letters and digits whose value is text, a boolean or an integer, kept as given. The runtime fills in a missing `id`, a version 7 UUID, and a missing `time`, the moment it records the event, and answers `{ id, time, recorded_at }`. The event is appended as `event_published` to a stream of its own, `events/<uuid>`, the uuid name-based on its source and id, only while that stream is empty: the same event again records nothing and answers the first record, a retry without `time` included, and a different event under the same source and id is `conflict`. With its id and time, the event takes at most 240 KiB as JSON, or it is `invalid_input` at `/event`; the types and sources of the brain's own facts are `invalid_input` at `/event/type` and `/event/source`. [`packages/specs`](https://github.com/BeOnAuto/auto-brain/blob/main/packages/specs/README.md#events-of-a-brain) describes the stream and the facts.

## Run history and brain events

These queries are relative to `/v1/orgs/{org}/brains/{brain}` and need `brain:read`; they work on a retired brain, whose commands are refused with `conflict`:

| Operation               | Method and route                         | Input                                                        |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `list_executions`       | `GET /executions`                        | Optional `primitive`, `name`, `status`, `limit` and `cursor` |
| `get_execution_history` | `GET /executions/{execution_id}/history` | Execution id in path; optional `order`, `limit` and `cursor` |
| `list_brain_events`     | `GET /events`                            | Optional `type`, `since`, `order`, `limit` and `cursor`      |

`list_executions` answers `{ executions, has_more, next_cursor }`, newest first by the position of each run's first start in the ledger, so a run started again with the same id keeps its place. A listed run is the run as `get_execution` shows it, without `output`, `record` and the detail and issues of a rejection; a run started again and since finished shows its first start, where `get_execution` shows the latest. `status` is answered by the ledger from the type of each run's latest fact; `primitive` and `name` apply after the page is read.

`get_execution_history` answers `{ events, has_more, next_cursor }` for one run, oldest first unless `order` is `desc`, and `not_found` for a run the brain does not have, decided as `get_execution` decides it. On PostgreSQL an oldest-first page of a run whose records are still behind a write open in the ledger's database is empty, with `next_cursor` null; read it again once the write ends. It reads the run's execution facts and, for a workflow, its run's log: one `workflow_input_applied` event for each input the run took. `list_brain_events` answers the same shape for the brain's whole partition of the ledger, newest first unless `order` is `asc`. `type` takes one public event type; `since` keeps what the store recorded from that time on, in either order, so an event's own `at` may be a little earlier. The brain's own creation, update and retirement are recorded in the org's registry, not the brain, and are not among its events.

An event is `{ id, at, type, summary, data }`: `id` is the record's opaque cursor, `at` the event's own time, `type` one of `execution_started`, `execution_deferred`, `execution_succeeded`, `execution_rejected`, `execution_failed`, `tool_call_started`, `tool_call_answered`, `workflow_input_applied`, `spec_created`, `spec_updated`, `spec_retired` and `event_published`, `summary` plain words, and `data` at most 4 KiB of JSON. Inputs, outputs, records, documents and schemas appear as byte sizes; a rejection's detail is cut at a code point and its issues shown as a count and the first five; a description is cut at 300 characters and warnings counted. Tool events include sizes and digests, plus at most 2 KiB each of arguments or results when the operator records content. A `workflow_input_applied` event holds the kind and key of the input, how many steps it moved and the first five, each with its task, run and outcome, the `rejection` of an answer that names its kind and because, which its summary also says in words, and the kinds of what the run did next, never the run's data. [`packages/specs`](https://github.com/BeOnAuto/auto-brain/blob/main/packages/specs/README.md#reading-runs) lists every field.

`limit` is 1 to 100, 20 by default. A page also stops after loading 4 MiB of stored data and, with `status` or `type`, after looking at 1,000 runs or records, so it may hold fewer items than `limit`, or none, while `has_more` is `true`; read on with `next_cursor` as `cursor` until it is `null`. A cursor that does not decode or that another brain gave is `invalid_input` at `/cursor`. Cursors are not encrypted: one names a position in the ledger. On PostgreSQL, an oldest-first read stays behind the oldest transaction still writing to the ledger's database, so the newest records can appear a moment later.

## Idempotency and retries

Supply `execution_id` when you need to inspect failures or retry a request. Reusing an id with a different function or input returns `conflict`.

Once a run succeeds or rejects invalid input, it has a final result. Calling again with the same id and input returns that recorded result. A waiting workflow also returns its existing run without restarting it. A workflow runs once for an execution id: calling again with the id of a workflow that ended without a final result, `unavailable` or `failed`, returns `conflict`; run it again under a new id.

A run without a final result may be attempted again after an interruption, an unavailable dependency or another recoverable failure. A retry can use the latest definition version, which the new attempt records. Side effects must tolerate at-least-once execution; one recorded final result does not guarantee that an external action ran only once. A reasoning function that calls tools is the exception, since its tools are the side effects: a run whose stream holds a tool call and that did not succeed, or a started run whose function names tools, is not attempted again under its id: the call answers `conflict` with the kind `tools_called`, and a new run needs a new id.

## Errors

API errors use RFC 9457 problem documents with `Content-Type: application/problem+json`, whose `type` is `https://on.auto/problems/<reason>`, or `https://on.auto/problems/tools_unfinished` for a run that called tools and could not finish and `https://on.auto/problems/tools_called` for a run not run again under its id because its tools may have been called ([the list](../../reference/http.md#responses-and-errors)). Inspect `reason` and `detail`; `invalid_input` includes an `errors` list of JSON pointers. A rejection that has a `kind` carries it, and an `unavailable` one its `because`, as extension members: `tools_unfinished` means a run called tools and could not finish, so its tools may have changed something, and a request with the same `execution_id` answers `conflict` with the kind `tools_called`. `Retry-After: 5` comes only with an `unavailable` answer that a retry of the same request may resolve, never with `tools_unfinished`, `tool_not_offered` or `model_not_offered`.

| Status | Common reason                       |
| ------ | ----------------------------------- |
| 400    | `bad_request`                       |
| 401    | Missing or invalid credentials      |
| 403    | `forbidden` or `origin_not_allowed` |
| 404    | `not_found`                         |
| 409    | `conflict`                          |
| 422    | `invalid_input`                     |
| 500    | `internal`                          |
| 503    | `unavailable`                       |

A 500 response contains an incident reference, not the underlying exception. Its `instance` and the `x-request-id` response header identify the corresponding server log entry. Malformed HTTP rejected by Node's parser can return a bare status without a problem document.

`/health` reports server liveness without authentication. It does not report whether the server's runs are going on; the server logs a warning when it cannot do their work. See [Troubleshooting](../self-host/troubleshooting.md).
