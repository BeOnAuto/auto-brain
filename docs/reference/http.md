# HTTP API

The HTTP API provides brain management, reasoning-function, computation-function, recall-function and workflow definitions, recorded runs, events for waiting workflows, events published to a brain, the history of a run and of a brain, and the brain's analytics. Requests use the API base URL and credentials supplied for the workspace.

The runtime exposes the same operations through HTTP and [MCP](mcp.md). The API calls definitions `specs` and runs `executions`. The `primitive` field names the type of a definition: `inference` for a reasoning function, `computation` for a computation function, `recollection` for a recall function and `orchestration` for a workflow.

## Requests and access

Send credentials as `Authorization: Bearer <key>` and command bodies as UTF-8 JSON with `Content-Type: application/json`. Keep credentials out of prompts and source documents.

Org routes begin at `/v1/orgs/{org}`. Brain routes begin at `/v1/orgs/{org}/brains/{brain}`. Each API key belongs to one org and has permissions for a set of brains. Reading definitions and runs requires `brain:read`; creating, changing or running a function or workflow, and sending or publishing an event, require `brain:write`.

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

A name and a description are stored without the whitespace around them, and a name cannot be all whitespace. `update_brain` takes both, even when only one of them changes, and an update that changes nothing records nothing. A key limited to a list of brains can create only a brain whose id is on that list. A retired brain can still be read with `get_brain` and listed with `include_retired`, but it can no longer be updated, and operations inside it return `not_found`; retiring it again succeeds and changes nothing. `create_brain` returns `conflict` for an id the org has or had, `update_brain` returns `conflict` for a retired brain, and `get_brain`, `update_brain` and `retire_brain` return `not_found` for an id the org does not have. A change that meets another change to the org's brains at the same moment returns `conflict`; send it again.

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

## Computation functions

A self-hosted runtime offers computation functions under the same operations, with `computation` in place of `inference` in each route, such as `POST /specs/computation` and `POST /specs/computation/{name}/execute`. The `source` is a [computation function document](computation-format.md), and names, document size, versions and retirement follow the rules for reasoning functions above. A run completes within the execute request. A program that cannot give its output for the input, because it raised an error, gave no output or more than one, or did more work or nested deeper than a run may, answers `conflict` with the kind `unworkable`; the same input gives the same answer again, so change the definition or the input rather than retrying.

## Recall functions

A self-hosted runtime offers recall functions under the same operations, with `recollection` in place of `inference` in each route, such as `POST /specs/recollection` and `POST /specs/recollection/{name}/execute`. The `source` is a [recall function document](recall-format.md), and names, document size, versions and retirement follow the rules for reasoning functions above; a brain keeps at most 32 active recall functions, and a save past that answers `conflict`. A run completes within the execute request, answering from the function's view as it stands. While the view of the latest version is still being built, a run answers `unavailable` with the kind `rebuilding` and a `Retry-After`; while the view has stalled, `conflict` with the kind `stalled`; and an answer that cannot give its output, `conflict` with the kind `unworkable`. `get_spec` adds the view's `standing`, and `get_execution` the checkpoint the run answered at in its `record`; see [How the view is kept](recall-format.md#how-the-view-is-kept).

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
| `cancel_execution`     | `POST /executions/{execution_id}/cancel`   | Optional `reason`                                                      |
| `send_execution_event` | `POST /executions/{execution_id}/events`   | `event` with `type`, and optional `id`, `source`, `subject` and `data` |

The `source` is a [workflow document](workflow-format.md). Names, document size, versions and retirement follow the rules for reasoning functions above. A saved workflow has the `media_type` `application/yaml`, and its `description`, `input_schema` and `output_schema` come from the document.

`execute_spec` returns 200 as soon as the run begins, with its `execution_id` and `status: started`, or, for a run that ended before its first wait, how it ended. Read the run with `get_execution` until its status is `succeeded`, `rejected` or `failed`, and its steps with `get_execution_history`, which holds one `workflow_input_applied` event for each input the run took (see [Run history and brain events](#run-history-and-brain-events)). While the runtime is stopping, `execute_spec` returns `unavailable`; try again shortly.

A workflow runs once for each `execution_id`. Executing it again with the `execution_id` of a run that is going returns the run as it stands; with the `execution_id` of a run that ended without a final result, it returns `conflict`, so run the workflow again under a new `execution_id`.

`send_execution_event` delivers an event to a run that is still `started`. It returns the `execution_id` and the delivered `event`, with an `id`, made by the runtime when you leave it out, a `source`, `/callers/` and your caller id when you leave it out, and the `time` it was sent. An event may take at most 256 KiB as JSON; its `type` and `id` at most 256 characters, its `source`, a URI reference such as `/ledger/eu` as for a published event, and its `subject` at most 1,024, and its `data` may nest at most 510 levels deep, so that the run can hold the whole event in a list. A run takes an event with a given `id` once, so a request can be retried with the same id. The types and sources the runtime keeps for its own facts, listed under [Publishing events](#publishing-events), return `invalid_input` here too, and so does text that a published event may not hold: a control character, a lone surrogate or a noncharacter, or a `type`, `id` or `subject` without a character that is not a space. The operation returns `not_found` when the brain has no running workflow with that execution id, including one that has ended, and `unavailable` when the run cannot take the event at that moment, as while the runtime is stopping; try again shortly.

### Cancelling a run

`cancel_execution` cancels a workflow run that is still `started`, and needs `brain:write`. It takes an optional `reason`, 1 to 1,024 characters with no control character, which the run keeps as the detail of its ending; without one, the detail says who asked. The request is recorded on the run at once, on any server, and it returns 200 with the run as it stands, still `started`. Within a moment the run stops its tasks, cancels each run it waits for, and ends `rejected` with the reason `cancelled` and the kind `requested`; read it with `get_execution`. Asking again before it ended records nothing more. It returns `not_found` when the brain has no run with that id, and `conflict` when the run has ended, or when it is a run of a reasoning, computation or recall function, which ends within the request that started it and cannot be interrupted from outside.

A cancelled run's rejection names the kind of its cancellation:

| Kind           | The run was cancelled because                                                             |
| -------------- | ----------------------------------------------------------------------------------------- |
| `requested`    | someone allowed to change the brain asked, with `cancel_execution`                        |
| `deadline`     | the workflow that waited for it ran out of time                                           |
| `overrun`      | it ran as long as a workflow may run                                                      |
| `parent_ended` | the workflow that waited for it ended first, or the branch that waited for it lost a race |

## Runs and results

A run records its `execution_id`, `primitive`, `name`, `spec_version`, `status`, timestamps and caller identity. Successful runs include `output`; rejected runs include a rejection. `get_execution` also returns the detailed `record`.

Reasoning, computation and recall functions normally complete within the execute request. A workflow run answers `started` and continues after the request; while it is in progress, its `record` is empty. [Workflows and runs](../concepts/workflows.md) explains how a run waits and ends. Inputs may be at most 256 KiB as encoded JSON and nest at most 512 levels deep, as deep as a workflow holds a value; a deeper one returns `invalid_input` at `/input`. Output and record together may be at most 1 MiB. These limits apply independently of the request-body limit.

Supply `execution_id` when you need to inspect failures or retry a request. Reusing an id with a different function or input returns `conflict`. Once a run succeeds, rejects invalid input or is cancelled, another request with the same id and input returns the recorded final result. A request with the id of a workflow run still in progress returns that run as it stands, without starting another.

A run without a final result may be attempted again after an interruption or recoverable failure, with two exceptions. A workflow run runs once for its execution id. A reasoning function that calls tools is never run again under its id once one of its tools may have been called: when an earlier attempt called a tool and did not succeed, or when the function names tools and an earlier attempt has started and not ended, since it may still be running. The answer is `conflict` with the kind `tools_called`; check what the run's history shows it called, then start a new run under a new id. A retry can use the latest definition version, which the new attempt records. Do not assume that an external effect happened only once because the runtime records one final result.

## Publishing events

`publish_event` records an event in a brain, such as a month closed in a ledger or a deal won in a CRM. It is `POST /v1/orgs/{org}/brains/{brain}/events`, relative to the brain like the routes above, and needs `brain:write`. Its body holds `event`, a [CloudEvents 1.0](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md) event:

| Attribute                       | Required | Contents                                                                                                      |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `source`                        | Yes      | Where the event comes from, a URI reference such as `/ledger/eu` or `https://acme.example/ledger`             |
| `type`                          | Yes      | What happened, such as `com.acme.ledger.month-closed`                                                         |
| `id`                            | No       | Unique among the events of its source; the runtime makes one when you leave it out                            |
| `time`                          | No       | When it happened, in RFC 3339 such as `2026-10-01T09:00:00Z`; the runtime takes the time it records the event |
| `subject`                       | No       | What the event is about within its source                                                                     |
| `specversion`                   | No       | `1.0`                                                                                                         |
| `datacontenttype`, `dataschema` | No       | The media type of `data`, and the absolute URI of a schema it follows                                         |
| `data`                          | No       | Any JSON value                                                                                                |

`id` and `type` take at most 256 characters, and `source` and `subject` at most 1,024. `data` may nest at most 510 levels deep, so that a run can hold the event in a list, or it returns `invalid_input` at `/event/data`. Any other attribute is an extension, at most 32 of them: its name is 1 to 20 lowercase letters and digits, its value text, a boolean or an integer, and it is kept as given. As CloudEvents requires, no text may hold a control character, a lone surrogate or a noncharacter, `id`, `type` and `subject` need a character that is not a space, `datacontenttype` is a media type such as `application/json`, and a `time` has a second of 60 only at the end of a day in UTC.

```http
POST /v1/orgs/acme/brains/finance/events
Content-Type: application/json

{
  "event": {
    "source": "/ledger/eu",
    "type": "com.acme.ledger.month-closed",
    "id": "2026-09",
    "subject": "september",
    "data": { "region": "eu", "revenue": 120000 }
  }
}
```

It returns 200 with the event's `id` and `time`, and `recorded_at`, when the brain recorded it:

```json
{ "id": "2026-09", "time": "2026-10-01T09:00:00.000Z", "recorded_at": "2026-10-01T09:00:00.000Z" }
```

A brain holds one event for each `source` and `id`. Publishing the same event again records nothing and returns the first `id`, `time` and `recorded_at`, so a request can be retried with the same id; a retry that leaves out `time` is the same event. Times are compared as instants, so `2026-10-01T10:59:00+02:00` is the same time as `2026-10-01T08:59:00Z`. A leap second counts as the first second of the next day, so `2016-12-31T23:59:60Z` is the same time as `2017-01-01T00:00:00Z`. A retry that gives a `time` to an event first published without one is the same event too, and returns the time the runtime filled in the first time, not the one the retry gave. A different event with the same `source` and `id` returns `conflict`. Without an `id`, every request records a new event.

The event, with its id and time filled in, may take at most 240 KiB as JSON. The types `execution_started`, `execution_deferred`, `execution_succeeded`, `execution_rejected`, `execution_failed`, `tool_call_started`, `tool_call_answered`, `spec_created`, `spec_updated`, `spec_retired`, `event_published`, `workflow_input_applied`, `step_started`, `step_waiting`, `step_finished`, `step_failed`, `step_skipped` and `reaction_refused`, which include every type the brain's events show, and sources beginning `/executions/`, `/specs/` or `/callers/`, name what the runtime records itself; an event that uses them returns `invalid_input` at `/event/type` or `/event/source`. `list_brain_events` shows each published event as an `event_published` event. A published event starts the workflows whose [event trigger](workflow-format.md#triggers) matches it, and reaches the runs listening for its type.

## Run history and brain events

These routes are relative to `/v1/orgs/{org}/brains/{brain}` and need `brain:read`:

| Operation               | Method and route                         | Input                                                                   |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `list_executions`       | `GET /executions`                        | Optional `primitive`, `name`, `status`, `limit` and `cursor`            |
| `get_execution_history` | `GET /executions/{execution_id}/history` | Execution id in path; optional `order`, `limit` and `cursor`            |
| `list_brain_events`     | `GET /events`                            | Optional `type`, `since`, `execution_id`, `order`, `limit` and `cursor` |

`list_executions` returns `executions`, newest first by when each run first started. A listed run has the fields `get_execution` returns, without `output`, `record` and the detail and issues of a rejection; a rejection shows its `reason`, with `kind` and `because` when the function gave them. `status` keeps the runs whose status is `started`, `succeeded`, `rejected` or `failed`, and `primitive` and `name` keep the runs of one definition.

`get_execution_history` returns the `events` of one run in the order the brain recorded them, oldest first unless `order` is `desc`, so each event comes after the event that caused it: the facts the runtime recorded about the run, each start and how it ended. Tool-using runs also record `tool_call_started` and `tool_call_answered`. A run that does not exist in the brain returns `not_found`. For a workflow, the history also holds one `workflow_input_applied` event for each input its run took, followed by one event for each step that input moved, named for how the step ended that input: `step_waiting`, `step_finished`, `step_failed`, `step_skipped`, or `step_started` for a step that runs others, such as a `do` or a `fork`, and was still running. A step that starts and finishes in one input shows only `step_finished`. `list_brain_events` returns the `events` of the whole brain, newest first unless `order` is `asc`: definitions created, updated and retired, runs started and ended, tool calls, the inputs workflow runs took and the events published to the brain. `type` keeps one event type. `since`, an ISO 8601 time with its offset such as `2026-10-05T09:00:00Z`, keeps what the brain recorded from that time on, in either order; its date must exist in the calendar and its hour run from 00 to 23, so `T24:00:00Z` is refused. `execution_id` keeps what one run and every run it started recorded, such as the functions a workflow called: its whole tree. A run that another run started belongs to the tree of the run at its top, so its own id answers no events; read the tree from the id of the run you started.

Tool-call events identify the server, tool, argument and result sizes and digests, and how each call ended. Content is omitted unless the operator enables `record_content`. Recorded content is scrubbed and bounded; the history API shows at most 2 KiB of each recorded argument or result. Anyone with read access to the brain can read that history. A started call without an answer may have had an external effect; absence of an answer does not prove it was cancelled before acting.

Each event has these fields:

| Field          | Contents                                                                                                                                                                                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | The event's id, a UUID that stays the same on every read                                                                                                                                                                                                                                                                           |
| `cursor`       | The place to read on from: pass it as `cursor` to read what follows the event                                                                                                                                                                                                                                                      |
| `causation_id` | The `id` of the event that directly led to this one, or `null` when nothing recorded did, as for a run you started                                                                                                                                                                                                                 |
| `at`           | When it happened, by its own clock, in ISO 8601 UTC                                                                                                                                                                                                                                                                                |
| `type`         | `execution_started`, `execution_succeeded`, `execution_rejected`, `execution_failed`, `tool_call_started`, `tool_call_answered`, `workflow_input_applied`, `step_started`, `step_waiting`, `step_finished`, `step_failed`, `step_skipped`, `spec_created`, `spec_updated`, `spec_retired`, `event_published` or `reaction_refused` |
| `summary`      | A sentence in plain language                                                                                                                                                                                                                                                                                                       |
| `data`         | The facts of the event, at most 4 KiB as JSON                                                                                                                                                                                                                                                                                      |

In `data`, inputs, outputs, records, documents and schemas appear as their sizes in bytes. `get_execution` returns a run's output and record, and `get_spec` a definition's document and schemas; the API does not return a run's original input. A rejection shows its reason, its detail shortened to fit, and for invalid input the number of issues and the first five. A success shows the sizes of its output and record as `output_bytes` and `record_bytes`, and a rejection that kept a record, as a run of a reasoning function does when it is rejected after its model answered, shows its size as `record_bytes` too. A definition's description shows its first 300 characters, and its warnings as a count. A `workflow_input_applied` event shows the kind and key of the input, how many steps it moved and the first five, each with its task, run and outcome, the kind and because of a function's rejection that has them, in its words too, and the kinds of what the run did next; it never shows the run's data. A step event shows the step's `name`, its `reference` in the document, its `run`, which counts each time the step starts, and `times`, which counts how often it moved that way in that run; `step_waiting` adds what it waits for, `call`, `timer` or `event`, and for a call the `execution_id` of the run it started, whose `execution_started` names that `step_waiting` as its cause; `step_failed` adds how it failed and its error's type and title. An `event_published` event shows the published event's `event_id`, `event_type`, `source`, `subject` and `time`, the size of its data as `data_bytes`, and which attributes the runtime `filled` in; for an event a workflow emitted, `emitted_by` names its run's `execution_id`, the `workflow` and its `version`, and `depth` its depth in a chain of triggers. A `reaction_refused` event shows the `workflow` a trigger did not start, how many times in the `minute` it shows as `count`, and the last `reason`. A run a trigger started shows `brain:` and the brain's name as its caller, and its `execution_started` names the event that started it as its cause.

The causes link the events of a run into a graph. A run you start has no cause. A workflow run's start is followed directly by its inputs and their steps, and its first input is caused by its start. A step that starts in an input is caused by what came before it: the input for the first step, the step before it in its list, the `switch` that chose it, the `fork` it is a branch of, or the failed attempt a retry repeats. A step that goes on from an earlier input is caused by its own event before: the input that answers a call or delivers an event, and the step's `step_finished`, are both caused by its `step_waiting`. The run's end is caused by its last step event.

Every page carries `has_more` and `next_cursor`. Pass `next_cursor` as `cursor` to read the next page, until `next_cursor` is `null`. `limit` is 1 to 100, and 20 when left out; it counts the events a page answers with, step events included, so a page can end between the step events of one input, and its `next_cursor` reads on from the next one. A page can hold fewer items than `limit`, or none, while `has_more` is `true`: `primitive` and `name` apply to the runs a page looked at, records with no event type are left out, a page stops after loading 4 MiB of stored data, and with `status` or `type` after looking at 1,000 runs or records. Cursors are opaque; a cursor this brain did not give returns `invalid_input` at `/cursor`.

The brain's own creation, changes and retirement are not brain events; `get_brain` shows them. A retired brain stays readable: these reads work on it, while every change to it is refused with `conflict`.

## Analytics

This route is relative to `/v1/orgs/{org}/brains/{brain}` and needs `brain:read`:

| Operation             | Method and route | Input                                                                |
| --------------------- | ---------------- | -------------------------------------------------------------------- |
| `get_brain_analytics` | `GET /analytics` | Optional `days`, or `from` and `to`; optional `primitive` and `name` |

`get_brain_analytics` answers what the brain's runs did over a window of days in UTC. `days` is `7`, `14` or `30`, the last days ending today, and `7` when nothing is given. `from` and `to` name the first and the last day as `YYYY-MM-DD`, both included: at most 366 days, with `to` not before `from` and not after today. A day must exist in the calendar, so `2026-02-30` is refused rather than read as 2 March. `primitive` and `name` keep the runs of one definition, as they do for `list_executions`. `days` with `from` or `to`, `from` without `to`, any other `days` and any other parameter are refused with `invalid_input`, pointing at the parameter.

```http
GET /v1/orgs/acme/brains/sales/analytics?days=7&primitive=inference
Authorization: Bearer <key>
```

```json
{
  "days": 7,
  "runs": { "total": 12, "succeeded": 9, "failed": 1, "rejected": 2 },
  "tokens": { "input": 18400, "output": 2950, "cached": 12000 },
  "duration_ms": { "p50": 1840, "p95": 6210 },
  "by_day": [
    {
      "day": "2026-09-30",
      "runs": { "total": 0, "succeeded": 0, "failed": 0, "rejected": 0 },
      "tokens": { "input": 0, "output": 0, "cached": 0 },
      "duration_ms": null
    }
  ],
  "by_function": [
    {
      "primitive": "inference",
      "name": "triage",
      "runs": 12
    }
  ]
}
```

The example shortens `by_day`, which holds every day of the window, oldest first, days with no runs included. A run counts on the day it first started, also when it was started again later. It counts once it has ended: `succeeded`, `failed` or `rejected`; a run still going counts nowhere.

| Field         | Contents                                                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `days`        | How many days the window holds                                                                                                                                                                                                                 |
| `runs`        | The runs that ended, by how they ended, and their `total`                                                                                                                                                                                      |
| `tokens`      | The `input` and `output` tokens the models of reasoning functions used, a rejected run's included when its model answered before the rejection; `cached` is the part of `input` read from the provider's cache; `0` where nothing was recorded |
| `duration_ms` | The median, `p50`, and the 95th percentile, `p95`, of how long the runs that succeeded or failed took, from their latest start to their end, in milliseconds; `null` when no run of the period has a duration                                  |
| `by_day`      | The same `runs`, `tokens` and `duration_ms` for each `day`                                                                                                                                                                                     |
| `by_function` | Each definition by `primitive` and `name`, with `runs`, how many of its runs ended; the most runs first, then by `primitive` and `name`                                                                                                        |

A run started again under its `execution_id` counts once: its tokens add up over every attempt that ended, while its duration is that of its last attempt. A percentile is the nearest rank: the duration at place ⌈p × n⌉ of the n durations in order. Rejected runs count in `runs` and in `tokens`, never in `duration_ms`; workflow runs count in `runs` and in `duration_ms`, from when the run started to when the workflow ended. The answer reads a table the runtime keeps as each run is recorded, so it is as current as the runs themselves. A brain that does not exist returns `not_found`; a retired brain answers like any other.

## Responses and errors

Successful responses contain JSON with `Cache-Control: no-store`. Create operations return 201; other successful operations generally return 200.

API errors use RFC 9457 problem documents with `Content-Type: application/problem+json`. Inspect `reason` and `detail`; `invalid_input` includes an `errors` list of JSON pointers. A rejection that has a `kind` carries it, and an `unavailable` one its `because`: `tools_unfinished` means a run called tools and could not finish, so its tools may have changed something, and a request with the same execution id answers `conflict` with the kind `tools_called`. `Retry-After` comes only with an `unavailable` answer that a retry of the same request may resolve, never with `tools_unfinished`, `tool_not_offered` or `model_not_offered`, and never with `cancelled`. A `conflict` may have the kind `oversized`, for a workflow whose output is larger than a run records.

| Status | Common reason                              |
| ------ | ------------------------------------------ |
| 400    | `bad_request`                              |
| 401    | Missing or invalid credentials             |
| 403    | `forbidden` or `origin_not_allowed`        |
| 404    | `not_found`                                |
| 405    | Unsupported method; see the `Allow` header |
| 409    | `conflict` or `cancelled`                  |
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
| `https://on.auto/problems/cancelled`              | 409    | The run was cancelled, with the `kind` of its cancellation; its `reason` is `cancelled`                  |
| `https://on.auto/problems/content_too_large`      | 413    | The body is larger than 1 MiB                                                                            |
| `https://on.auto/problems/unsupported_media_type` | 415    | The body is not sent as `application/json` in UTF-8                                                      |
| `https://on.auto/problems/invalid_input`          | 422    | The input does not fit, with the `errors` that point at it                                               |
| `https://on.auto/problems/client_closed_request`  | 499    | The client went away before the answer                                                                   |
| `https://on.auto/problems/internal`               | 500    | Something went wrong inside the server                                                                   |
| `https://on.auto/problems/unavailable`            | 503    | Something the server relies on cannot serve now                                                          |
| `https://on.auto/problems/tools_unfinished`       | 503    | A run called tools and could not finish; its `reason` is `unavailable`, and it is never retried as it is |
| `https://on.auto/problems/rebuilding`             | 503    | The view of a recall function is still being built; its `reason` is `unavailable`; try again later       |

A 500 response contains an incident reference. Its `instance` and the `x-request-id` response header identify the server log entry. Include that reference when reporting a problem, without sharing credentials or confidential input. Malformed HTTP can return a bare status before the API handles it.

A function naming a model outside the deployment's allow list returns `unavailable` with kind `model_not_offered` and `because: "model_not_allowed"`, before calling the provider. A missing provider can return the same kind with `because: "provider_not_configured"`. Use `list_models` to inspect the offered references.
