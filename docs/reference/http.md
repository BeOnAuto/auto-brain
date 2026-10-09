# HTTP API

The HTTP API provides brain management, reasoning-function, interaction-function, computation-function, recall-function and workflow definitions, the requests of interaction functions and their answers, recorded runs, events for waiting workflows, events published to a brain, the history of a run and of a brain, the brain's analytics, the tool servers its functions may use, and tests of their tools. Requests use the API base URL and credentials supplied for the workspace.

The runtime exposes the same operations through HTTP and [MCP](mcp.md). The `type` field names the type of a definition: `reasoning`, `interaction`, `computation`, `recall` or `workflow`.

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

Brain ids contain 3 to 48 lowercase letters, digits and hyphens, beginning with a letter. Names contain 1 to 100 characters and descriptions at most 2,000. Read operations need `org:read`, and writes need `org:write`; `list_brains` also answers a key with `brain:read`, so a key that may only read inside some brains can find them. Lists include accessible brains, with retired brains excluded unless requested.

Retirement is permanent. Brain ids cannot be reused, and a retired brain cannot be restored.

A name and a description are stored without the whitespace around them, and a name cannot be all whitespace. `update_brain` takes both, even when only one of them changes, and an update that changes nothing records nothing. A key limited to a list of brains can create only a brain whose id is on that list. A retired brain can still be read with `get_brain` and listed with `include_retired`, but it can no longer be updated, and operations inside it return `not_found`; retiring it again succeeds and changes nothing. `create_brain` returns `conflict` for an id the org has or had, `update_brain` returns `conflict` for a retired brain, and `get_brain`, `update_brain` and `retire_brain` return `not_found` for an id the org does not have. A change that meets another change to the org's brains at the same moment returns `conflict`; send it again.

## Models

`GET /v1/orgs/{org}/models` lists the models the server offers. It requires `org:read` and accepts an optional `provider` query parameter. A provider prefix contains 1 to 32 lowercase letters, digits or hyphens, starting with a letter.

The JSON result contains `object: "list"`, `data`, `catalog_status` and `listed_at`. Entries are sorted by `id`, with each id appearing once. The [MCP model reference](mcp.md#model-information) describes the entry fields, aliases, wildcard patterns and incomplete results. The same output is returned over both interfaces.

## Reasoning functions

These routes are relative to `/v1/orgs/{org}/brains/{brain}`:

| Operation           | Method and route                            | Input                                    |
| ------------------- | ------------------------------------------- | ---------------------------------------- |
| `create_definition` | `POST /definitions/reasoning`               | `name`, `source`                         |
| `list_definitions`  | `GET /definitions/reasoning`                | Optional `include_retired`               |
| `get_definition`    | `GET /definitions/reasoning/{name}`         | Name in path                             |
| `update_definition` | `PUT /definitions/reasoning/{name}`         | `source`                                 |
| `retire_definition` | `POST /definitions/reasoning/{name}/retire` | Name in path                             |
| `run_definition`    | `POST /definitions/reasoning/{name}/run`    | Optional `input`, optional UUID `run_id` |
| `get_run`           | `GET /runs/{run_id}`                        | Run id in path                           |

The `source` is a [reasoning function document](reasoning-format.md). Names follow the same 3 to 48 character rule as brain ids. Source documents may be at most 65,536 UTF-8 bytes. A name is unique within its type and brain and cannot be reused after retirement.

Changing a document creates a version. Updating it with identical source records no change. A run uses the active latest version. Retired definitions can be read but cannot be edited or run.

## Interaction functions

A self-hosted runtime offers interaction functions under the same operations, with `interaction` in place of `reasoning` in each route, such as `POST /definitions/interaction` and `POST /definitions/interaction/{name}/run`. The `source` is an [interaction function document](interaction-format.md), and names, document size, versions and retirement follow the rules for reasoning functions above. A run answers 200 with `status: started` and its `run_id`, and waits until its request is answered, expires or is cancelled; a notification to the inbox, and a function that calls a tool, answer within the request, the second with what the tool answered as its output or with an ending its format lists. A `to` or an argument the function cannot render answers `conflict` with the kind `unworkable`, a server or a tool the brain may not use `unavailable` with the kind `tool_not_offered`, and a brain with as many open requests as the runtime allows `unavailable` with the kind `requests_full`.

These routes are relative to `/v1/orgs/{org}/brains/{brain}`:

| Operation            | Method and route             | Needs         | Input                                                  |
| -------------------- | ---------------------------- | ------------- | ------------------------------------------------------ |
| `list_interactions`  | `GET /interactions`          | `brain:read`  | Optional `to`, `function`, `limit` and `cursor`        |
| `answer_interaction` | `POST /runs/{run_id}/answer` | `brain:write` | Run id in path; `answer` and an optional `claimed_for` |

`list_interactions` returns `interactions`, the brain's open requests newest first, with `has_more` and `next_cursor`. Each has the `run_id` of the interaction function's run, `function` and `version`, `to`, `delivery`, the `server` and `tool` the request is sent through or `null` for the inbox, `message`, `takes_answer`, `requested_at`, `expires_at`, `attempts`, `conversation`, the conversation the brain reads replies in or `null`, `answerer`, the party whose reply counts or `null`, `reply_refusals`, and `standing`, which is `in_inbox`, `to_deliver`, `delivering`, `delivered`, `retrying`, `undelivered`, `answered`, while a reply that answered it settles its run, or `cancelling`, once a cancel of its run was asked.

Each request also has `answer_schema`, the JSON Schema the request recorded when it was asked, which an answer must match: `answer_interaction` checks this one, even once the function has a newer version whose `output_schema` `get_definition` shows. It is `null` for a notification. A schema takes at most 64 KiB as JSON, so a page of 100 requests can hold up to 6.25 MiB of schemas, and a smaller `limit` keeps a page smaller.

`answer_interaction` takes the run's `run_id` and an `answer` that matches the answer schema of the request, at most 64 KiB as JSON, and returns the run, `succeeded` with the answer as its `output`. Its `record` shows `answered_by`, `answered_at` and the optional `claimed_for`, whom the caller says it answers for, at most 256 bytes and never checked; a run a reply answered shows `answered_by` the brain and `reply`, the identity of that reply. An answer that does not match returns `invalid_input` with pointers under `/answer` and leaves the request open. The same answer again returns the run as it stands; a different answer, an answer to a request that has ended, and an answer to a notification return `conflict`; a run the brain does not have returns `not_found`.

A request nobody answered before it expired ends its run `rejected` with the reason `unanswered` and the kind `expired`, and a notification that could not be delivered with the kind `undelivered`. A request with the same run id and input then returns that ending as a `410` problem of the type `https://on.auto/problems/unanswered`. [How a run ends](interaction-format.md#how-a-run-ends) lists every ending.

## Computation functions

A self-hosted runtime offers computation functions under the same operations, with `computation` in place of `reasoning` in each route, such as `POST /definitions/computation` and `POST /definitions/computation/{name}/run`. The `source` is a [computation function document](computation-format.md), and names, document size, versions and retirement follow the rules for reasoning functions above. A run completes within the request that runs it. A program that cannot give its output for the input, because it raised an error, gave no output or more than one, or did more work or nested deeper than a run may, answers `conflict` with the kind `unworkable`; the same input gives the same answer again, so change the definition or the input rather than retrying.

## Recall functions

A self-hosted runtime offers recall functions under the same operations, with `recall` in place of `reasoning` in each route, such as `POST /definitions/recall` and `POST /definitions/recall/{name}/run`. The `source` is a [recall function document](recall-format.md), and names, document size, versions and retirement follow the rules for reasoning functions above; a brain keeps at most 32 active recall functions, and a save past that answers `conflict`. A run completes within the request that runs it, answering from the function's view as it stands. While the view of the latest version is still being built, a run answers `unavailable` with the kind `rebuilding` and a `Retry-After`; while the view has stalled, `conflict` with the kind `stalled`; and an answer that cannot give its output, `conflict` with the kind `unworkable`. `get_definition` adds the view's `standing`, and `get_run` the checkpoint the run answered at in its `record`; see [How the view is kept](recall-format.md#how-the-view-is-kept).

## Workflows

These routes are relative to `/v1/orgs/{org}/brains/{brain}`:

| Operation           | Method and route                           | Input                                                                  |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| `create_definition` | `POST /definitions/workflow`               | `name`, `source`                                                       |
| `list_definitions`  | `GET /definitions/workflow`                | Optional `include_retired`                                             |
| `get_definition`    | `GET /definitions/workflow/{name}`         | Name in path                                                           |
| `update_definition` | `PUT /definitions/workflow/{name}`         | `source`                                                               |
| `retire_definition` | `POST /definitions/workflow/{name}/retire` | Name in path                                                           |
| `run_definition`    | `POST /definitions/workflow/{name}/run`    | Optional `input`, optional UUID `run_id`                               |
| `get_run`           | `GET /runs/{run_id}`                       | Run id in path                                                         |
| `cancel_run`        | `POST /runs/{run_id}/cancel`               | Optional `reason`                                                      |
| `send_run_event`    | `POST /runs/{run_id}/events`               | `event` with `type`, and optional `id`, `source`, `subject` and `data` |

The `source` is a [workflow document](workflow-format.md). Names, document size, versions and retirement follow the rules for reasoning functions above. A saved workflow has the `media_type` `application/yaml`, and its `description`, `input_schema` and `output_schema` come from the document. A workflow whose document has a `schedule` also has `triggers`, in `get_definition` and `list_definitions`: the [triggers](workflow-format.md#triggers) its schedule names, in the order it names them, each with its `kind`, `event`, `cron` or `every`, its `reference`, `/schedule/on`, `/schedule/cron` or `/schedule/every`, and its rule: an event trigger's `filters`, each with its `reference`, `type` and `attributes`, a cron's `expression` or an every's period in `milliseconds`. `get_definition` of an active workflow with triggers adds `triggers_since`, the id of the record that saved its current version: from that record on, what its triggers start is a run of this version. It is one id for the workflow; a trigger that a later version left unchanged goes on from the record that saved it as it is, which `triggers_since` does not show.

`run_definition` returns 200 as soon as the run begins, with its `run_id` and `status: started`, or, for a run that ended before its first wait, how it ended. Read the run with `get_run` until its status is `succeeded`, `rejected` or `failed`, and its steps with `get_run_history`, which holds one `workflow_input_applied` event for each input the run took (see [Run history and brain events](#run-history-and-brain-events)). While the runtime is stopping, `run_definition` returns `unavailable`; try again shortly.

A workflow runs once for each `run_id`. Executing it again with the `run_id` of a run that is going returns the run as it stands; with the `run_id` of a run that ended without a final result, it returns `conflict`, so run the workflow again under a new `run_id`.

`send_run_event` delivers an event to a run that is still `started`. It returns the `run_id` and the delivered `event`, with an `id`, made by the runtime when you leave it out, a `source`, `/callers/` and your caller id when you leave it out, and the `time` it was sent. An event may take at most 256 KiB as JSON; its `type` and `id` at most 256 characters, its `source`, a URI reference such as `/ledger/eu` as for a published event, and its `subject` at most 1,024, and its `data` may nest at most 510 levels deep, so that the run can hold the whole event in a list. A run takes an event with a given `id` once, so a request can be retried with the same id. The types and sources the runtime keeps for its own facts, listed under [Publishing events](#publishing-events), return `invalid_input` here too, and so does text that a published event may not hold: a control character, a lone surrogate or a noncharacter, or a `type`, `id` or `subject` without a character that is not a space. The operation returns `not_found` when the brain has no running workflow with that run id, including one that has ended, and `unavailable` when the run cannot take the event at that moment, as while the runtime is stopping; try again shortly.

### Cancelling a run

`cancel_run` cancels a workflow run that is still `started`, or the run of an interaction function whose request waits, and needs `brain:write`. It takes an optional `reason`, 1 to 1,024 characters with no control character, which the run keeps as the detail of its ending; without one, the detail says who asked. The request is recorded on the run at once, on any server, and it returns 200 with the run as it stands, still `started`. Within a moment the run stops its tasks, cancels each run it waits for, and ends `rejected` with the reason `cancelled` and the kind `requested`; read it with `get_run`. Asking again before it ended records nothing more. It returns `not_found` when the brain has no run with that id, and `conflict` when the run has ended, or when it is a run that ends within the request that started it, as a reasoning, computation or recall function does or an interaction function that calls a tool, which cannot be interrupted from outside.

A cancelled run's rejection names the kind of its cancellation:

| Kind           | The run was cancelled because                                                             |
| -------------- | ----------------------------------------------------------------------------------------- |
| `requested`    | someone allowed to change the brain asked, with `cancel_run`                              |
| `deadline`     | the workflow that waited for it ran out of time                                           |
| `overrun`      | it ran as long as a workflow may run                                                      |
| `parent_ended` | the workflow that waited for it ended first, or the branch that waited for it lost a race |

## Runs and results

A run records its `run_id`, `type`, `name`, `definition_version`, `status`, timestamps and caller identity. Successful runs include `output`; rejected runs include a rejection. `get_run` also returns the detailed `record`.

Reasoning, computation and recall functions normally complete within the request that runs them. A workflow run answers `started` and continues after the request; while it is in progress, its `record` is empty. [Workflows and runs](../concepts/workflows.md) explains how a run waits and ends. Inputs may be at most 256 KiB as encoded JSON and nest at most 512 levels deep, as deep as a workflow holds a value; a deeper one returns `invalid_input` at `/input`. Output and record together may be at most 1 MiB. These limits apply independently of the request-body limit.

Supply `run_id` when you need to inspect failures or retry a request. Reusing an id with a different function or input returns `conflict`. Once a run succeeds, rejects invalid input or is cancelled, another request with the same id and input returns the recorded final result. A request with the id of a workflow run still in progress returns that run as it stands, without starting another.

A run without a final result may be attempted again after an interruption or recoverable failure, with two exceptions. A workflow run runs once for its run id. A reasoning function that calls tools is never run again under its id once one of its tools may have been called: when an earlier attempt called a tool and did not succeed, or when the function names tools and an earlier attempt has started and not ended, since it may still be running. The answer is `conflict` with the kind `tools_called`; check what the run's history shows it called, then start a new run under a new id. A retry can use the latest definition version, which the new attempt records. Do not assume that an external effect happened only once because the runtime records one final result.

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

The event, with its id and time filled in, may take at most 240 KiB as JSON. The types `run_started`, `run_deferred`, `run_succeeded`, `run_rejected`, `run_failed`, `tool_call_started`, `tool_call_answered`, `delivery_started`, `delivery_ended`, `tool_test_started`, `tool_test_answered`, `interaction_requested`, `definition_created`, `definition_updated`, `definition_retired`, `event_published`, `workflow_input_applied`, `step_started`, `step_waiting`, `step_finished`, `step_failed`, `step_skipped` and `reaction_refused`, which include every type the brain's events show, and sources beginning `/runs/`, `/definitions/` or `/callers/`, name what the runtime records itself; an event that uses them returns `invalid_input` at `/event/type` or `/event/source`. `list_brain_events` shows each published event as an `event_published` event. A published event starts the workflows whose [event trigger](workflow-format.md#triggers) matches it, and reaches the runs listening for its type.

## Run history and brain events

These routes are relative to `/v1/orgs/{org}/brains/{brain}` and need `brain:read`:

| Operation           | Method and route             | Input                                                             |
| ------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `list_runs`         | `GET /runs`                  | Optional `type`, `name`, `status`, `limit` and `cursor`           |
| `get_run_history`   | `GET /runs/{run_id}/history` | Run id in path; optional `order`, `limit` and `cursor`            |
| `list_brain_events` | `GET /events`                | Optional `type`, `since`, `run_id`, `order`, `limit` and `cursor` |

`list_runs` returns `runs`, newest first by when each run first started. A listed run has the fields `get_run` returns, without `output`, `record` and the detail and issues of a rejection; a rejection shows its `reason`, with `kind` and `because` when the function gave them. `status` keeps the runs whose status is `started`, `succeeded`, `rejected` or `failed`, and `type` and `name` keep the runs of one definition.

`get_run_history` returns the `events` of one run in the order the brain recorded them, oldest first unless `order` is `desc`, so each event comes after the event that caused it: the facts the runtime recorded about the run, each start and how it ended. Tool-using runs, a reasoning function's and an interaction function's that calls a tool, also record `tool_call_started` and `tool_call_answered`, the first with `read_only: true` where the server marks the tool read-only. The run of an interaction function shows its request as `interaction_requested`, with the delivery, the party, the size of the message and the expiry, each delivery attempt as `delivery_started`, with the tool and the size and digest of its arguments, and `delivery_ended`, with how it ended and the size and digest of what the tool answered, the arguments and the answer shown at 2 KiB only where the operator records the server's content, and each reply taken or refused as `reply_taken` or `reply_refused`, with the reply's identity and never its words; its answer is the run's output, which the history does not show. A run that does not exist in the brain returns `not_found`. For a workflow, the history also holds one `workflow_input_applied` event for each input its run took, followed by one event for each step that input moved, named for how the step ended that input: `step_waiting`, `step_finished`, `step_failed`, `step_skipped`, or `step_started` for a step that runs others, such as a `do` or a `fork`, and was still running. A step that starts and finishes in one input shows only `step_finished`. `list_brain_events` returns the `events` of the whole brain, newest first unless `order` is `asc`: definitions created, updated and retired, runs started and ended, tool calls, tests of a tool, the brain's reads of a conversation that found a reply or failed and its tellings, the inputs workflow runs took and the events published to the brain. `type` keeps one event type. `since`, an ISO 8601 time with its offset such as `2026-10-05T09:00:00Z`, keeps what the brain recorded from that time on, in either order; its date must exist in the calendar and its hour run from 00 to 23, so `T24:00:00Z` is refused. `run_id` keeps what one run and every run it started recorded, such as the functions a workflow called: its whole tree. A run that another run started belongs to the tree of the run at its top, so its own id answers no events; read the tree from the id of the run you started.

Tool-call events identify the server, tool, argument and result sizes and digests, and how each call ended. Content is omitted unless the operator enables `record_content`. Recorded content is scrubbed and bounded; the history API shows at most 2 KiB of each recorded argument or result. Anyone with read access to the brain can read that history. A started call without an answer may have had an external effect; absence of an answer does not prove it was cancelled before acting.

Each event has these fields:

| Field          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | The event's id, a UUID that stays the same on every read                                                                                                                                                                                                                                                                                                                                                                    |
| `cursor`       | The place to read on from: pass it as `cursor` to read what follows the event                                                                                                                                                                                                                                                                                                                                               |
| `causation_id` | The `id` of the event that directly led to this one, or `null` when nothing recorded did, as for a run you started                                                                                                                                                                                                                                                                                                          |
| `at`           | When it happened, by its own clock, in ISO 8601 UTC                                                                                                                                                                                                                                                                                                                                                                         |
| `type`         | `run_started`, `run_succeeded`, `run_rejected`, `run_failed`, `tool_call_started`, `tool_call_answered`, `tool_test_started`, `tool_test_answered`, `replies_read`, `telling_started`, `telling_ended`, `workflow_input_applied`, `step_started`, `step_waiting`, `step_finished`, `step_failed`, `step_skipped`, `definition_created`, `definition_updated`, `definition_retired`, `event_published` or `reaction_refused` |
| `summary`      | A sentence in plain language                                                                                                                                                                                                                                                                                                                                                                                                |
| `data`         | The facts of the event, at most 4 KiB as JSON                                                                                                                                                                                                                                                                                                                                                                               |

In `data`, inputs, outputs, records, documents and schemas appear as their sizes in bytes. `get_run` returns a run's output and record, and `get_definition` a definition's document and schemas; the API does not return a run's original input. A rejection shows its reason, its detail shortened to fit, and for invalid input the number of issues and the first five. A success shows the sizes of its output and record as `output_bytes` and `record_bytes`, and a rejection that kept a record, as a run of a reasoning function does when it is rejected after its model answered, shows its size as `record_bytes` too. A definition's description shows its first 300 characters, and its warnings as a count. A `workflow_input_applied` event shows the kind and key of the input, how many steps it moved and the first five, each with its task, run and outcome, the kind and because of a function's rejection that has them, in its words too, and the kinds of what the run did next; it never shows the run's data. A step event shows the step's `name`, its `reference` in the document, its `run`, which counts each time the step starts, and `times`, which counts how often it moved that way in that run; `step_waiting` adds what it waits for, `call`, `timer` or `event`, and for a call the `run_id` of the run it started, whose `run_started` names that `step_waiting` as its cause; `step_failed` adds how it failed and its error's type and title. An `event_published` event shows the published event's `event_id`, `event_type`, `source`, `subject` and `time`, the size of its data as `data_bytes`, and which attributes the runtime `filled` in; for an event a workflow emitted, `emitted_by` names its run's `run_id`, the `workflow` and its `version`, and `depth` its depth in a chain of triggers. A `reaction_refused` event shows the `workflow` a trigger did not start, how many times in the `minute` it shows as `count`, and the last `reason`. A run a trigger started shows `brain:` and the brain's name as its caller, and its `run_started` shows the `trigger` that started it, its `kind` and `reference`, and says in words which kind it was, such as "was started by its every schedule". A run an event trigger started names the event's record as its cause. A run a schedule started names as its cause the record that saved its schedule as it is, which comes before the record of the run's `definition_version` when a later version left the schedule unchanged.

The causes link the events of a run into a graph. A run you start has no cause. A workflow run's start is followed directly by its inputs and their steps, and its first input is caused by its start. A step that starts in an input is caused by what came before it: the input for the first step, the step before it in its list, the `switch` that chose it, the `fork` it is a branch of, or the failed attempt a retry repeats. A step that goes on from an earlier input is caused by its own event before: the input that answers a call or delivers an event, and the step's `step_finished`, are both caused by its `step_waiting`. The run's end is caused by its last step event.

Every page carries `has_more` and `next_cursor`. Pass `next_cursor` as `cursor` to read the next page, until `next_cursor` is `null`. `limit` is 1 to 100, and 20 when left out; it counts the events a page answers with, step events included, so a page can end between the step events of one input, and its `next_cursor` reads on from the next one. A page can hold fewer items than `limit`, or none, while `has_more` is `true`: records with no event type are left out, a page stops after loading 4 MiB of stored data, and with `status`, `type` or `name` after looking at 1,000 runs or records. Cursors are opaque; a cursor this brain did not give returns `invalid_input` at `/cursor`.

The brain's own creation, changes and retirement are not brain events; `get_brain` shows them. A retired brain stays readable: these reads work on it, while every change to it is refused with `conflict`.

## Analytics

This route is relative to `/v1/orgs/{org}/brains/{brain}` and needs `brain:read`:

| Operation             | Method and route | Input                                                           |
| --------------------- | ---------------- | --------------------------------------------------------------- |
| `get_brain_analytics` | `GET /analytics` | Optional `days`, or `from` and `to`; optional `type` and `name` |

`get_brain_analytics` answers what the brain's runs did over a window of days in UTC. `days` is `7`, `14` or `30`, the last days ending today, and `7` when nothing is given. `from` and `to` name the first and the last day as `YYYY-MM-DD`, both included: at most 366 days, with `to` not before `from` and not after today. A day must exist in the calendar, so `2026-02-30` is refused rather than read as 2 March. `type` and `name` keep the runs of one definition, as they do for `list_runs`. `days` with `from` or `to`, `from` without `to`, any other `days` and any other parameter are refused with `invalid_input`, pointing at the parameter.

```http
GET /v1/orgs/acme/brains/sales/analytics?days=7&type=reasoning
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
      "type": "reasoning",
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
| `by_function` | Each definition by `type` and `name`, with `runs`, how many of its runs ended; the most runs first, then by `type` and `name`                                                                                                                  |

A run started again under its `run_id` counts once: its tokens add up over every attempt that ended, while its duration is that of its last attempt. A percentile is the nearest rank: the duration at place ⌈p × n⌉ of the n durations in order. Rejected runs count in `runs` and in `tokens`, never in `duration_ms`; workflow runs count in `runs` and in `duration_ms`, from when the run started to when the workflow ended. The answer reads a table the runtime keeps as each run is recorded, so it is as current as the runs themselves. A brain that does not exist returns `not_found`; a retired brain answers like any other.

## Tool servers

These routes are relative to `/v1/orgs/{org}`. `list_tool_servers` at the org needs `org:read` or `brain:read`, at a brain `brain:read`, and `test_tool_call` `brain:write`:

| Operation           | Method and route                                               | Input                                             |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| `list_tool_servers` | `GET /tool-servers`                                            | Optional `brain` and `server`                     |
| `list_tool_servers` | `GET /brains/{brain}/tool-servers`                             | Brain id in path; optional `server`               |
| `test_tool_call`    | `POST /brains/{brain}/tool-servers/{server}/tools/{tool}/test` | Server and tool in the path; optional `arguments` |

`list_tool_servers` lists the MCP servers the operator of a self-hosted runtime set up for the brain, with the tools each offers, so a [reasoning function](reasoning-format.md#tools) can name them in `tools` as `server/tool` or `server/*`. It asks each server for its tools when you call it, as a run does, within the same time to connect and to list. `server` keeps only the server of that name, and asks no other; a name that no server of the brain has returns `invalid_input` at `/server`, so call it without `server` to see the names.

```http
GET /v1/orgs/acme/brains/sales/tool-servers
Authorization: Bearer <key>
```

```json
{
  "tool_servers": [
    {
      "name": "graph",
      "type": "http",
      "tools": [
        {
          "name": "search",
          "description": "Finds the operations that answer a question.",
          "input_schema": {
            "type": "object",
            "properties": { "query": { "type": "string" } },
            "required": ["query"]
          },
          "annotations": { "readOnlyHint": true },
          "testable": true
        },
        {
          "name": "execute",
          "description": "Runs an operation of the graph.",
          "input_schema": { "type": "object" },
          "testable": false
        }
      ]
    },
    {
      "name": "notes",
      "type": "stdio",
      "unavailable": "The MCP server notes could not be used: The MCP server could not be reached",
      "because": "unreachable"
    }
  ]
}
```

| Field         | Contents                                                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | The server's name, which a function writes before the slash                                                                                                                                                                       |
| `type`        | `http` for a remote server, `stdio` for a process the runtime starts                                                                                                                                                              |
| `tools`       | The tools the server lists that the operator allows on its entry, in the server's order, each with its `name`, its `description` cut to 4 KiB, its `input_schema`, the hints its server gives it as `annotations`, and `testable` |
| `unavailable` | In place of `tools`, why the server could not be asked for its tools, in words cut to 1 KiB; the other servers are listed beside it                                                                                               |
| `because`     | With `unavailable`: `key_refused` when the server did not accept the key the runtime gives it, which only the operator can put right; `failing`, `rate_limited` or `unreachable` when asking again later may work                 |
| `brains`      | At the org only: the brains of the org whose functions may use the server, or `["*"]` for every brain of the org                                                                                                                  |

A tool's `annotations` are the hints its server gives it, `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`, as booleans and as the server gives them; a tool its server gives no hint has no `annotations`. `testable` is `true` when `test_tool_call` may test the tool: when its server marks it read-only, or the operator marks it testable on its entry.

Servers are sorted by name, and a server set up for another org, or for other brains of the org, is neither listed nor asked. The runtime adds no header, environment value, address, command or credential of a server to the answer. What a server writes, such as its tools' names, descriptions and schemas, is passed on with the values of the operator's `${...}` references and the tokens minted for a server scrubbed out; a referenced value shorter than 8 characters is not scrubbed. At a brain, a brain that does not exist returns `not_found`; a retired brain answers like any other.

At the org, `list_tool_servers` answers for the org's brains, so you can see what the operator set up before a brain exists or without naming one. It lists every server set up for the org, each with `brains`, the brains whose functions may use it, `["*"]` for every brain of the org; `brain` keeps the servers that serve that brain, as the brain's own route lists them, `brains` included. A key limited to some brains must give `brain`, and sees in `brains` only the brains it may access; without `brain` it is refused with `forbidden`, whose detail says to name one of its brains in `brain`. A `brain` the org does not have returns `not_found`, as the brain's own route does, and no server is asked. A `server` that no server of the org, or of the brain given, has returns `invalid_input` at `/server`.

```http
GET /v1/orgs/acme/tool-servers
Authorization: Bearer <key>
```

```json
{
  "tool_servers": [
    { "name": "graph", "type": "http", "brains": ["*"], "tools": [] },
    {
      "name": "notes",
      "type": "stdio",
      "brains": ["sales"],
      "unavailable": "The MCP server notes could not be used: The MCP server could not be reached",
      "because": "unreachable"
    }
  ]
}
```

### Testing a tool

`test_tool_call` calls one tool of one tool server with the `arguments` given, as a run of a reasoning function would call it, and answers what that run's model would see and the document an interaction function's call reads, so you learn what a tool answers before a function names it, or find an id a prompt needs, without making a function to look. `arguments` is the object the tool's `input_schema` takes, `{}` when left out, and may take at most 16 KiB as JSON; more returns `invalid_input` at `/arguments` before anything is called.

```http
POST /v1/orgs/acme/brains/sales/tool-servers/graph/tools/search/test
Authorization: Bearer <key>
Content-Type: application/json

{ "arguments": { "query": "renewals due this month" } }
```

```json
{
  "test_id": "0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b",
  "server": "graph",
  "tool": "search",
  "outcome": "result",
  "text": "Found 2 operations: listRenewals and renewalById.",
  "answer": "Found 2 operations: listRenewals and renewalById.",
  "result_bytes": 98,
  "duration_ms": 312,
  "tested_at": "2026-10-08T09:00:00.000Z"
}
```

| Field               | Contents                                                                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_id`           | The id of the test, a UUID, under which its two events are recorded                                                                                                                                                                                               |
| `outcome`           | `result`; `tool_error` when the tool answered an error or refused the arguments, which a run's model may recover from; `server_failure` when the server failed on the call; `timed_out` when it did not answer within 30 seconds                                  |
| `text`              | What a reasoning function's model would see: text content as text, structured content as JSON only when there is no text, other content as a placeholder, scrubbed of the server's secrets and cut at 64 KiB with a note; for a failure, the words the model gets |
| `answer`            | The document a call's `read` points into: the structured content, else the first text block parsed as JSON, else that text, scrubbed of the server's secrets; absent when the tool answered neither, and when it takes more than 64 KiB as JSON                   |
| `result_bytes`      | The size of the whole result as the server gave it, before the cut; `null` when there is none                                                                                                                                                                     |
| `duration_ms`       | How long the call took                                                                                                                                                                                                                                            |
| `server_request_id` | The server's own id of the request, where the operator's `request_id` says where it carries one                                                                                                                                                                   |
| `tested_at`         | When the call was made, in ISO 8601 UTC                                                                                                                                                                                                                           |

The answer is `200` whenever the call was made, however the tool answered. Only a tool its server marks read-only, or that the operator marks testable on its entry, can be tested; any other returns `unavailable` with kind `tool_not_offered` and `because: "not_testable"`, and nothing is called. A tool the operator does not allow, a server not set up for the brain and a tool the server does not list return the same kind with `tool_not_allowed`, `mcp_server_not_configured` or `tool_not_listed`, and a server that cannot be used returns `unavailable` with kind `mcp_server_failed`. A test is live: a tool the operator marks testable may still change something, which is why `test_tool_call` is marked destructive over MCP while any entry marks a tool testable.

Each test is recorded in the brain's history as `tool_test_started` and `tool_test_answered`, which `list_brain_events` shows, with content only where the operator enables `record_content`; a test starts no run, so `list_runs` and `get_run_history` never show it. A caller that goes away during the call leaves a start without an answer. Each test makes one call; a test of a server no run holds opens a connection and lets it go once the call has answered.

## Responses and errors

Successful responses contain JSON with `Cache-Control: no-store`. Create operations return 201; other successful operations generally return 200.

API errors use RFC 9457 problem documents with `Content-Type: application/problem+json`. Inspect `reason` and `detail`; `invalid_input` includes an `errors` list of JSON pointers. A rejection that has a `kind` carries it, and an `unavailable` or `conflict` one its `because`. A run that called tools and could not finish ends `unavailable` with the kind `tools_unfinished` when every tool it called is one its server marks read-only, so running it again is safe, and `conflict` with the kind `effect_unknown` when any is not, since whether that tool changed something is not known; either way a request with the same run id answers `conflict` with the kind `tools_called`, with the `because` `only_read`, and words that say nothing was changed, when every tool the run called only reads. `Retry-After` comes only with an `unavailable` answer that a retry of the same request may resolve, never with `tools_unfinished`, `tool_not_offered` or `model_not_offered`, and never with `cancelled`. A `conflict` may have the kind `oversized`, for a workflow whose output is larger than a run records.

| Status | Common reason                              |
| ------ | ------------------------------------------ |
| 400    | `bad_request`                              |
| 401    | Missing or invalid credentials             |
| 403    | `forbidden` or `origin_not_allowed`        |
| 404    | `not_found`                                |
| 405    | Unsupported method; see the `Allow` header |
| 409    | `conflict` or `cancelled`                  |
| 410    | `unanswered`                               |
| 422    | `invalid_input`                            |
| 500    | `internal`                                 |
| 503    | `unavailable`                              |

A problem document's `type` is a URI that names its kind of problem:

| Type                                              | Status | Means                                                                                                                                                                                 |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://on.auto/problems/bad_request`            | 400    | The request is malformed, such as a field given twice or a body that is not a JSON object                                                                                             |
| `https://on.auto/problems/unauthenticated`        | 401    | Credentials are missing or invalid                                                                                                                                                    |
| `https://on.auto/problems/forbidden`              | 403    | The credentials may not do that                                                                                                                                                       |
| `https://on.auto/problems/origin_not_allowed`     | 403    | A browser sent the request from an origin the server does not allow                                                                                                                   |
| `https://on.auto/problems/not_found`              | 404    | Something the request names does not exist                                                                                                                                            |
| `https://on.auto/problems/method_not_allowed`     | 405    | The path does not take that method                                                                                                                                                    |
| `https://on.auto/problems/conflict`               | 409    | The request clashes with what is there                                                                                                                                                |
| `https://on.auto/problems/tools_called`           | 409    | A run that may have called tools is not run again under its id; its `reason` is `conflict`                                                                                            |
| `https://on.auto/problems/effect_unknown`         | 409    | A run called a tool that may change something and could not finish, so whether it did is not known; its `reason` is `conflict`, and a person or a workflow rule that names it decides |
| `https://on.auto/problems/cancelled`              | 409    | The run was cancelled, with the `kind` of its cancellation; its `reason` is `cancelled`                                                                                               |
| `https://on.auto/problems/unanswered`             | 410    | Nobody answered the request of an interaction function, with the `kind` `expired` or `undelivered`                                                                                    |
| `https://on.auto/problems/content_too_large`      | 413    | The body is larger than 1 MiB                                                                                                                                                         |
| `https://on.auto/problems/unsupported_media_type` | 415    | The body is not sent as `application/json` in UTF-8                                                                                                                                   |
| `https://on.auto/problems/invalid_input`          | 422    | The input does not fit, with the `errors` that point at it                                                                                                                            |
| `https://on.auto/problems/client_closed_request`  | 499    | The client went away before the answer                                                                                                                                                |
| `https://on.auto/problems/internal`               | 500    | Something went wrong inside the server                                                                                                                                                |
| `https://on.auto/problems/unavailable`            | 503    | Something the server relies on cannot serve now                                                                                                                                       |
| `https://on.auto/problems/tools_unfinished`       | 503    | A run called tools that only read and could not finish; its `reason` is `unavailable`, and a new run may make it                                                                      |
| `https://on.auto/problems/rebuilding`             | 503    | The view of a recall function is still being built; its `reason` is `unavailable`; try again later                                                                                    |

A 500 response contains an incident reference. Its `instance` and the `x-request-id` response header identify the server log entry. Include that reference when reporting a problem, without sharing credentials or confidential input. Malformed HTTP can return a bare status before the API handles it.

A function naming a model outside the deployment's allow list returns `unavailable` with kind `model_not_offered` and `because: "model_not_allowed"`, before calling the provider. A missing provider can return the same kind with `because: "provider_not_configured"`. Use `list_models` to inspect the offered references. A function naming a tool the brain's servers do not offer returns `unavailable` with kind `tool_not_offered`; use `list_tool_servers` to see the servers and tools it may name. `test_tool_call` answers with the same kind, and with `not_testable` for a tool that cannot be tested.
