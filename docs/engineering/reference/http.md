# HTTP API

The runtime exposes the same operations through HTTP and [MCP](mcp.md). The `type` field names the type of a definition: `reasoning`, `interaction`, `computation`, `recall` or `workflow`.

Use an API key as `Authorization: Bearer <key>`, except in loopback-only local mode. See [Authentication and security](../self-host/security.md). For executable examples, follow the [HTTP walkthrough](http-tutorial.md).

## Requests and responses

Org routes begin at `/v1/orgs/{org}`. Playbook routes begin at `/v1/orgs/{org}/playbooks/{playbook}`. A key belongs to one org, with permissions and an allowed set of playbooks.

Send command bodies as UTF-8 JSON objects with `Content-Type: application/json`. Request bodies may be at most 1 MiB; compressed bodies are not accepted. Query parameters belong to GET requests. A field cannot be supplied in more than one location.

Successful responses contain the operation output as JSON with `Cache-Control: no-store`. Create operations return 201; other successful operations generally return 200. Unknown routes return 404. Unsupported methods return 405 with an `Allow` header.

## Playbooks

These routes are relative to `/v1/orgs/{org}`:

| Operation         | Method and route                    | Input                                      |
| ----------------- | ----------------------------------- | ------------------------------------------ |
| `create_playbook` | `POST /playbooks`                   | `playbook`, `name`, optional `description` |
| `list_playbooks`  | `GET /playbooks`                    | Optional `include_retired`                 |
| `get_playbook`    | `GET /playbooks/{playbook}`         | Playbook id in path                        |
| `update_playbook` | `PUT /playbooks/{playbook}`         | `name` and `description`                   |
| `retire_playbook` | `POST /playbooks/{playbook}/retire` | Playbook id in path                        |

Playbook ids contain 3 to 48 lowercase letters, digits and hyphens, beginning with a letter. Names contain 1 to 100 characters and descriptions at most 2,000. Ids are never reused. Retirement is permanent; it is not deletion or an archive that can be restored.

Read operations need `org:read`, and writes need `org:write`; `list_playbooks` is permitted by `playbook:read` as well, since it answers only the playbooks the key may access. The key's playbook restrictions apply to named-playbook operations. Lists include only accessible playbooks, with retired playbooks excluded unless requested.

## Definitions

These routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`:

| Operation           | Method and route                         | Input                                    |
| ------------------- | ---------------------------------------- | ---------------------------------------- |
| `create_definition` | `POST /definitions/{type}`               | `name`, `source`                         |
| `list_definitions`  | `GET /definitions/{type}`                | Optional `include_retired`               |
| `get_definition`    | `GET /definitions/{type}/{name}`         | Path parameters                          |
| `update_definition` | `PUT /definitions/{type}/{name}`         | `source`                                 |
| `retire_definition` | `POST /definitions/{type}/{name}/retire` | Path parameters                          |
| `run_definition`    | `POST /definitions/{type}/{name}/run`    | Optional `input`, optional UUID `run_id` |
| `get_run`           | `GET /runs/{run_id}`                     | Run id in path                           |
| `cancel_run`        | `POST /runs/{run_id}/cancel`             | Optional `reason`, for a workflow's run  |
| `send_run_event`    | `POST /runs/{run_id}/events`             | `event`, for a workflow's run            |

A reasoning function uses the [Markdown prompt format](reasoning-format.md). A workflow uses the [YAML workflow format](../../reference/workflow-format.md); [Workflow format and runs](workflow-format.md) says how it runs.

Names contain 3 to 48 lowercase letters, digits and hyphens, beginning with a letter. Source documents may be at most 65,536 UTF-8 bytes. A name is unique within its type and playbook and cannot be reused after retirement.

Changing a document creates a new version. Updating it with identical source succeeds without recording a change. A run uses the active latest version. Retirement is permanent: retired definitions can be read but cannot be edited or run.

Queries need `playbook:read`; commands, including running a definition and sending an event, need `playbook:write`. An API key with read access alone cannot run a function.

## Runs and results

A run includes `run_id`, `type`, `name`, `definition_version`, `status`, timestamps and caller identity. It includes an `output` when successful or a rejection when rejected. Reading a run with `get_run` also returns its detailed `record`.

Reasoning functions normally complete within the request that runs them. Workflows return `started` while work continues, unless the run ended before its first wait; `get_run` shows whether a run ended, as `succeeded`, `rejected` or `failed`, or is still `started`. An answer to what a run waits on goes to the run that waits, and creates no other run: `answer_interaction` answers the request of an interaction function, in the shape of the `answer_schema` that `list_interactions` shows with the request, the schema it recorded when asked, and `send_run_event` gives a waiting workflow an event it listens for. `cancel_run` records a cancel on a workflow run that is still `started`, on any server, and the run ends `rejected` with the reason `cancelled` within a moment ([Cancelling a run](../../reference/http.md#cancelling-a-run)); it answers `conflict` for a run that has ended or one that runs within its request.

Inputs may be at most 256 KiB as encoded JSON and nest at most 512 levels deep, which `invalid_input` at `/input` refuses before anything is recorded; the data of an event sent to a run or published to a playbook may nest at most 510, so that a run can hold the event in a list. Output and record together may be at most 1 MiB. The runtime applies these limits independently of the request-body limit.

## Published events

`publish_event` is `POST /events` relative to `/v1/orgs/{org}/playbooks/{playbook}`, under `playbook:write`. Its body is `{ event }`, a CloudEvents 1.0 event with `source`, a URI reference, and `type`, and optionally `specversion` (`1.0`), `id`, `subject`, `time` in RFC 3339, `datacontenttype`, `dataschema` and `data`; any other attribute is an extension, at most 32, named in 1 to 20 lowercase letters and digits, whose value is text, a boolean or an integer, kept as given. Text holds no control character, lone surrogate or noncharacter; `id`, `type` and `subject` hold a character that is not a space; `datacontenttype` is a media type; and a second of 60 is taken only at the end of a day in UTC. The runtime fills in a missing `id`, a version 7 UUID, and a missing `time`, the moment it records the event, and answers `{ id, time, recorded_at }`. The event is appended as `event_published` to a stream of its own, `events/<uuid>`, the uuid name-based on its source and id, only while that stream is empty: the same event again records nothing and answers the first record, a retry without `time` included and one that gives a `time` to an event first published without one, which answers the time filled in first; times compare as instants, and a different event under the same source and id is `conflict`. With its id and time, the event takes at most 240 KiB as JSON, or it is `invalid_input` at `/event`; the types and sources of the playbook's own facts are `invalid_input` at `/event/type` and `/event/source`. [`packages/definitions`](https://github.com/BeOnAuto/runtime/blob/main/packages/definitions/README.md#events-of-a-playbook) describes the stream and the facts.

## Run history and playbook events

These queries are relative to `/v1/orgs/{org}/playbooks/{playbook}` and need `playbook:read`; they work on a retired playbook, whose commands are refused with `conflict`:

| Operation              | Method and route             | Input                                                             |
| ---------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `list_runs`            | `GET /runs`                  | Optional `type`, `name`, `status`, `limit` and `cursor`           |
| `get_run_history`      | `GET /runs/{run_id}/history` | Run id in path; optional `order`, `limit` and `cursor`            |
| `list_playbook_events` | `GET /events`                | Optional `type`, `since`, `run_id`, `order`, `limit` and `cursor` |

`list_runs` answers `{ runs, has_more, next_cursor }`, newest first by the position of each run's first start in the ledger, so a run started again with the same id keeps its place. A listed run is the run as `get_run` shows it, without `output`, `record` and the detail and issues of a rejection; a run started again and since finished shows its first start, where `get_run` shows the latest. The ledger answers every filter as it examines the runs, before it counts the page: `status` from the type of each run's latest fact, and `type` and `name` from the run's first start. A page with any filter looks at up to 1,000 runs and holds as many matching runs as `limit` asks while it finds them, so it is short, or empty, with `has_more` true only when it has looked at 1,000 or loaded 4 MiB.

`get_run_history` answers `{ events, has_more, next_cursor }` for one run in the ledger's order, oldest first unless `order` is `desc`, which is also the order of causes, since a message is appended only after the one that caused it, and `not_found` for a run the playbook does not have, decided as `get_run` decides it. On PostgreSQL an oldest-first page of a run whose records are still behind a write open in the ledger's database is empty, with `next_cursor` null; read it again once the write ends. It reads the facts of the run's stream and, for a workflow, its run log: one `workflow_input_applied` event for each input the run took, followed by one event for each step entry of that input. `list_playbook_events` answers the same shape for the playbook's whole partition of the ledger, newest first unless `order` is `asc`. `type` takes one public event type; `since` keeps what the store recorded from that time on, in either order, so an event's own `at` may be a little earlier; `run_id` keeps every message whose correlation is that run, the whole tree of a run that no other run started, through the ledger's index on the playbook and the correlation. The id of a run another run started answers nothing, since its messages carry the correlation of the run at the top of its tree. A hosted runtime that keeps run logs outside the ledger must answer this filter from both places, or keep the logs in the ledger. The playbook's own creation, update and retirement are recorded in the org's registry, not the playbook, and are not among its events.

An event is `{ id, type, summary, data, metadata }` and nothing else: `id` is the id of the message it presents, or for a step event its record's message id, an underscore and the step's number in that record, `type` the stored type or the public name a capability gives it, `summary` plain words, `data` the fact, at most 4 KiB of JSON, and `metadata` the context of the fact under wire names, `{ stream, position, global_position, correlation_id, causation_id, at, by, run_id?, definition?: { type, name, version? }, called_by?, call_depth?, depth?, trigger?, trace_id?, span_id? }`, each optional field present where the message's context holds it. `stream`, `position` and `global_position` are read from the table's own columns, and `global_position` is the store's sequence, with gaps, and on PostgreSQL not the read order; `causation_id` is the id of the message or step event that directly caused it, or null, and `at` the fact's own time. The page carries the paging bookmark, `has_more` and `next_cursor`, and no event carries one, since a page may end between the steps of one record, where no event's id could say where the read stopped. In `data`, `input`, `output`, `record`, `answer`, `arguments`, `result` and a published event's `data` are shown whole within 2 KiB as JSON and otherwise as their size under their name and `_bytes`, the largest replaced first while the data passes 4 KiB; documents and schemas appear as byte sizes; a rejection's detail is cut at a code point and its issues shown as a count and the first five; a description is cut at 300 characters and warnings counted. `run_deferred`, which a run that finishes later records, stays in the ledger, where `status` and a retry read it, and is shown as no event; nothing names it as its cause, so a workflow run's start is followed by its inputs and steps directly. Tool events include the sizes of what a call sent and received, measured over the text the playbook kept, scrubbed of the entry's secrets, and, where that text is kept, its SHA-256 digest, the key a reader joins it by; an entry with `record_content: false` gives its events the sizes alone. The history shows the kept `arguments` and the `answer` derived from the kept result within 2 KiB. `get_event`, `GET /events/{event_id}`, reads one event by its `id` from the ledger's index on the message id, with every field whole and `arguments` and `result` joined from the recorded content under the digests the event has, and nothing joined for an event that has none; a step's id travels in the path as it is, since an underscore is unreserved in a URI, so a proxy that decodes the path changes nothing. Over MCP, every field the 2 KiB rule names past 64 KiB appears as its size. A `workflow_input_applied` event holds the kind and key of the input, how many steps it moved and the first five, each with its task, run and outcome, the `rejection` of an answer that names its kind and because, which its summary also says in words, and the kinds of what the run did next, never the run's data. [`packages/definitions`](https://github.com/BeOnAuto/runtime/blob/main/packages/definitions/README.md#reading-runs) lists every field.

### Ids, causes and correlations

Every message the ledger writes carries, in its metadata, its id, its cause and its correlation, beside the context of its fact: `at`, `by`, and where the fact has them `runId`, the definition's `definitionType`, `definitionName` and `definitionVersion`, `calledBy`, `callDepth`, `depth` and `trigger`, which the row's `metadata` shows under wire names. The id of a message is the version 5 UUID of the UTF-8 JSON array `[stream, position]`, the message's full stream name such as `playbook/acme/sales/runs/<run id>` and its position in that stream from 1, in the ledger's namespace `5f8d7a5a-8d50-4340-9de3-ba16e8fe732e` (`messageIdOf` of `@on.auto/operations`). A step event is no message: its id is its record's message id, an underscore and the step's number among the recorded steps of that record, from 1, such as `<message id>_2`, written without a leading zero, so a reader of the raw ledger derives every id the API answers from the stream, the position and the records, and so does the hosted runtime, and a step is resolved by reading its record. A step entry's `caused_by` names the entry whose outcome moved it, which the step's `causation_id` names as `<message id>_<number>` when that entry is in the same record, or `input`, which stands for the record itself; a step whose entry names one in an earlier record is caused by its own record, the input that moved it on. A record's own cause is the record that holds the step it resumed, the record that started a call for its answer or the record that armed a listener or a timer, which the host keeps beside the call, the listener and the timer, the `run_started` of the run for its first input, or nothing; the run a call started and the run's end name the record that started the call and the record that ended the run. The correlation of a run no other run started is its own run id, and a run another run started, as a function a workflow calls, carries the correlation it is given, so the whole tree shares one.

`limit` is 1 to 100, 20 by default, and counts the events a page answers with, step events included. A page that ends between the step events of one record answers a `next_cursor` that points inside the record, the record's cursor with one more part, the index of the last event answered; a read from it begins with that record and leaves out what was answered, in either order. The cursor is the page's: no event carries one. A page also stops after loading 4 MiB of stored data and, with `status`, `type` or `name`, after looking at 1,000 runs or records, so it may hold fewer items than `limit`, or none, while `has_more` is `true`; read on with `next_cursor` as `cursor` until it is `null`. A cursor that does not decode or that another playbook gave is `invalid_input` at `/cursor`. Cursors are not encrypted: one names a position in the ledger. On PostgreSQL, an oldest-first read stays behind the oldest transaction still writing to the ledger's database, so the newest records can appear a moment later.

## Analytics

`get_playbook_analytics`, `GET /analytics` relative to `/v1/orgs/{org}/playbooks/{playbook}` under `playbook:read`, answers what the playbook's runs did over the last 7, 14 or 30 days (`days`, 7 when left out) or between two days of the calendar (`from` and `to`, both included, at most 366 and to no later than today, in UTC), optionally of one definition (`type`, `name`): `{ days, runs, tokens, duration_ms, by_day, by_function }`. A run counts on the day it first started, once it has succeeded, failed or been rejected; durations are nearest-rank percentiles of the runs that succeeded or failed, from their latest start to their end, `null` when there are none; tokens sum what reasoning runs recorded, a rejected run's included. The [HTTP reference](../../reference/http.md#analytics) gives every field. The answer reads `run_outcomes_4`, a table the ledger keeps inside each append of a run's events; the [ledger README](https://github.com/BeOnAuto/runtime/blob/main/packages/ledger/README.md#keyed-projections) describes it and how it is filled when a server first starts on an existing ledger.

## Tool servers

Five operations reach the entries of [`tool_servers`](../self-host/configuration.md#tool-servers) that serve a playbook, relative to `/v1/orgs/{org}/playbooks/{playbook}`: `search`, `GET /tool-servers/search`, answers `{ servers, tools, scopes }`, the servers by name, each with its `tool_count` or with `unavailable` and `because` when it could not be asked, and the tools its entry allows, `{ server, tool, summary, read_only }`, every tool while the servers offer at most 100 together, or those whose words match `terms`, best first, at most 100; `introspect`, `GET /tool-servers/{server}/tools/{tool}`, answers one tool whole; `validate`, `POST /tool-servers/{server}/tools/{tool}/validate`, checks `arguments` against its input schema with the runtime's JSON Schema compiler; `dry_run`, `POST /tool-servers/{server}/tools/{tool}/dry-run`, answers what `execute` would check; and `execute`, `POST /tool-servers/{server}/tools/{tool}/execute`, under `playbook:write`, calls the tool through the one call path a run takes, with `auto.on/call_id` in its metadata, and records `tool_call_started` and then `tool_call_answered` or `tool_call_failed` on the stream `tool-calls/<call_id>`, with the caller as `by` and no run. The four reads are queries under `playbook:read`, `validate` and `dry_run` routed by `POST` for an input a query string cannot carry, ask the servers they need for their tools and record nothing. `search` answers at the org too, `GET /tool-servers/search` relative to `/v1/orgs/{org}`, under `org:read` or `playbook:read`, each server with its `playbooks`. The [HTTP reference](../../reference/http.md#tool-servers) gives the fields and examples, and [`packages/tool-servers`](https://github.com/BeOnAuto/runtime/blob/main/packages/tool-servers/README.md#five-tools-over-the-tool-servers) the details.

## Idempotency and retries

Supply `run_id` when you need to inspect failures or retry a request. Reusing an id with a different function or input returns `conflict`.

Once a run succeeds, rejects invalid input or is cancelled, it has a final result. Calling again with the same id and input returns that recorded result. A waiting workflow also returns its existing run without restarting it. A workflow runs once for a run id: calling again with the id of a workflow that ended without a final result, `unavailable` or `failed`, returns `conflict`; run it again under a new id.

A run without a final result may be attempted again after an interruption, an unavailable dependency or another recoverable failure. A retry can use the latest definition version, which the new attempt records. Side effects must tolerate being carried out more than once; one recorded final result does not guarantee that an external action ran only once. A reasoning function that calls tools is the exception, since its tools are the side effects: a run whose stream holds a tool call and that did not succeed, or a started run whose function names tools, is not attempted again under its id: the call answers `conflict` with the kind `tools_called`, and a new run needs a new id.

## Errors

API errors use RFC 9457 problem documents with `Content-Type: application/problem+json`, whose `type` is `https://on.auto/problems/<reason>`, or `https://on.auto/problems/tools_unfinished` for a run that called only tools that read and could not finish, `https://on.auto/problems/effect_unknown` for one that called a tool that may change something and could not finish, `https://on.auto/problems/tools_called` for a run not run again under its id because its tools may have been called, and `https://on.auto/problems/cancelled` for a run that was cancelled ([the list](../../reference/http.md#responses-and-errors)). Inspect `reason` and `detail`; `invalid_input` includes an `errors` list of JSON pointers. A rejection that has a `kind` carries it, and an `unavailable` or `conflict` one its `because`, as extension members: `tools_unfinished`, at 503, means a run called tools and could not finish, and every tool it called is one its server marks read-only, so a new run is safe; `effect_unknown`, a `conflict` at 409, means the same of a run that called any other tool, which may have changed something; after either, a request with the same `run_id` answers `conflict` with the kind `tools_called`. `Retry-After: 5` comes only with an `unavailable` answer that a retry of the same request may resolve, never with `tools_unfinished`, `tool_not_offered` or `model_not_offered`.

| Status | Common reason                       |
| ------ | ----------------------------------- |
| 400    | `bad_request`                       |
| 401    | Missing or invalid credentials      |
| 403    | `forbidden` or `origin_not_allowed` |
| 404    | `not_found`                         |
| 409    | `conflict` or `cancelled`           |
| 422    | `invalid_input`                     |
| 500    | `internal`                          |
| 503    | `unavailable`                       |

A 500 response contains an incident reference, not the underlying exception. Its `instance` and the `x-request-id` response header identify the corresponding server log entry. Malformed HTTP rejected by Node's parser can return a bare status without a problem document.

`/health` reports server liveness without authentication. It does not report whether the server's runs are going on; the server logs a warning when it cannot do their work. See [Troubleshooting](../self-host/troubleshooting.md).
