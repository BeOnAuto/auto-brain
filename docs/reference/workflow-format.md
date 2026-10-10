<div v-pre>

# Workflow format

The API stores a workflow as a definition of the type `workflow`. Its source document is YAML written in the [Open Workflow Specification](https://github.com/open-workflow-specification/specification) DSL 1.0, within the rules and limits on this page. [Build your first workflow](../tutorials/first-workflow.md) provides a guided example, and [Workflows and runs](../concepts/workflows.md) explains how a run starts, waits and ends.

## A workflow document

This workflow reviews a campaign brief with the `review-campaign-brief` reasoning function from [Build your first brain](../tutorials/first-brain.md). It retries the review when the model is unavailable, then waits up to a week for an approval decision:

```yaml
document:
  dsl: '1.0.3'
  namespace: campaign-review
  name: review-and-approve
  version: '1.0.0'
  title: Review a brief and wait for approval
  summary: Reviews a campaign brief, then waits up to a week for an approval decision.
input:
  schema:
    document:
      type: object
      properties:
        brief: { type: string }
      required: [brief]
use:
  retries:
    patient:
      delay: { seconds: 5 }
      backoff: { exponential: {} }
      limit:
        attempt: { count: 3 }
do:
  - review:
      try:
        - review-brief:
            call: run_definition
            with:
              type: reasoning
              name: review-campaign-brief
              input:
                brief: ${ $data.brief }
      catch:
        errors:
          with: { status: 503 }
        retry: patient
        do:
          - give-up:
              raise:
                error:
                  type: https://example.com/errors/review-unavailable
                  status: 503
                  title: The review could not be run
      output:
        as: '${ ({ ...$input, review: $data }) }'
  - decision:
      try:
        - wait-for-decision:
            listen:
              to:
                one:
                  with: { type: com.example.brief.decided }
            timeout:
              after: { days: 7 }
            output:
              as: '${ $data[0] }'
      catch:
        errors:
          with: { status: 408 }
        do:
          - no-answer:
              set: { approved: false, reason: No decision within a week }
      output:
        as: '${ ({ ...$input, decision: $data }) }'
  - route:
      switch:
        - approved:
            when: $data.decision.approved === true
            then: approve
        - otherwise:
            then: decline
  - approve:
      set:
        approved: true
        review: ${ $data.review }
      then: end
  - decline:
      set:
        approved: false
        reason: ${ $data.decision.reason }
        review: ${ $data.review }
```

For this document, `create_definition` takes `type: "workflow"`, a workflow `name` and the document as `source`. `run_definition` takes the same type and name, with `brief` in the `input` object. The run reviews the brief, retrying the review on status 503, which a function's run raises only where trying again is safe: it could not be reached, a tool server could not be used, or it called only tools that read and could not finish. A run whose tool may have changed something raises `effect_unknown` at 409, which the retry leaves alone. The run then waits. Sending it the event `com.example.brief.decided` with `data` of `{"approved": true}` ends it with `approved: true` and the review. A decision of `{"approved": false, "reason": "..."}` ends it with that reason, and no decision within seven days ends it with the reason `No decision within a week`.

## Document fields

| Field                                       | Purpose                                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `document.dsl`                              | Required DSL version, from `1.0.0` to `1.0.3`                                                                                            |
| `document.namespace`, `document.name`       | Required names of the document                                                                                                           |
| `document.version`                          | Required semantic version of the document, such as `1.0.0`                                                                               |
| `document.title`, `document.summary`        | Optional; the summary, or else the title, becomes the definition's `description`                                                         |
| `input.schema.document`                     | Optional inline JSON Schema, published as the definition's `input_schema`                                                                |
| `input.from`                                | Optional expression or template that shapes the run's input before the first task                                                        |
| `evaluate.language`, `evaluate.mode`        | Optional; `typescript` and `strict`, the defaults and the one language and mode this runtime takes; see [Expressions](#expressions)      |
| `schedule`                                  | Optional triggers that start the workflow on its own: `on`, `cron` and `every`, any one, two or three of them; see [Triggers](#triggers) |
| `do`                                        | Required list of named tasks, run in order                                                                                               |
| `output.as`                                 | Optional expression or template that shapes the run's output                                                                             |
| `output.schema.document`                    | Optional inline JSON Schema, published as the definition's `output_schema`                                                               |
| `timeout`                                   | Optional limit for the whole run: `after` with a duration, or the name of a timeout in `use.timeouts`                                    |
| `use.errors`, `use.retries`, `use.timeouts` | Optional named errors, retry policies and timeouts that tasks refer to by name                                                           |

The runtime does not check a run's input or output against these schemas; they tell callers what the workflow takes and gives. A run whose input lacks a value still starts, and a step that depends on the value fails: a reasoning function, for example, rejects input that does not match its own schema. Schemas must be written inline under `document`, as JSON Schema.

`document.version` is part of the document you write. The definition's `version` counts saved changes: it is 1 when the workflow is created and increases each time `update_definition` changes the document.

## Triggers

A workflow whose document has a `schedule` starts on its own, besides when a caller executes it. The schedule names up to three triggers, any one, two or three of them: an event trigger, `on`, and schedule triggers of two kinds, `cron` and `every`. Each is a trigger of its own, kept and matched on its own, so a workflow starts on an event and at its times without switching between them.

| Trigger          | Starts a run                                                        | Input of the run                    |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `schedule.on`    | For each event of the brain that one of its filters matches         | A list holding the event            |
| `schedule.cron`  | At each time its five fields name, in UTC                           | `{ "schedule": { "due": <time> } }` |
| `schedule.every` | At each multiple of its period after the trigger was saved as it is | `{ "schedule": { "due": <time> } }` |

This schedule starts a run for each brief submitted with a high priority, one at nine in the morning, UTC, on working days, and one every fifteen minutes:

```yaml
schedule:
  on:
    one:
      with: { type: com.example.brief.submitted, data: '${ $data.priority === "high" }' }
  cron: '0 9 * * 1-5'
  every: PT15M
```

A trigger is identified by its kind, `event`, `cron` or `every`, and its place in the document, `/schedule/on`, `/schedule/cron` or `/schedule/every`. `get_definition` and `list_definitions` show a saved workflow's triggers in that form as `triggers`, and a run a trigger started names its trigger on its `run_started` event, whose words say which kind started it, such as "was started by its cron schedule". No trigger has an input of its own: a run's input is the list holding the event or the due time, so a workflow with both kinds tells them apart with `input.from` or a `switch`:

```yaml
input:
  from: '${ Array.isArray($data) ? { month: $data[0].data.month } : { due: $data.schedule.due } }'
```

`on.one` takes one filter and `on.any` a list of at least one and at most 64; a run starts when any of them matches. A filter names the `type` of its events as written text, and may name any other attribute of the event, such as `source`, `subject` or `caller`, as written text, a whole number for `depth`, `calldepth` and `definitionversion`, and `data` as a value or as an expression over the event's data alone, which it reads as `$data`, such as `data: '${ $data.region === "eu" }'`; an expression that names anything else, such as `$workflow`, is refused when the document is saved, since no run exists yet. A filter is written once: a filter of `any` whose `type` and attributes an earlier one has, in any order, is refused. Each filter is held on its own to bounds of its own, 250 checkpoints of work an expression and 500 for the filter, 200 milliseconds of the server's time and a sandbox of 64 MiB, and fails no other workflow's filter. An expression that raises on an event, or does more than its work, which the event's data can cause as much as the filter, does not match that event, and the brain records that once for each version and evaluates the filter again on the next event. A filter that its deadline or its memory stops, which the event cannot cause, does not match either, and the event waits and is matched again on a later sweep; a filter so stopped 3 times in a row, with no answer between, is the filter's own defect: the brain records that once and does not evaluate it again for that version of the workflow, and the event it waited on goes on without it. A new version, with the filter made cheaper, is the remedy. The 200 milliseconds are the server's wall-clock time, so a filter near them may be stopped on a loaded server; keep a filter to a quick test of the event's data. The brain keeps what it stopped in memory, so a restart evaluates the filter again. A filter matches every event the brain records: events published with `publish_event`, events workflows emit, and the brain's own facts, such as `run_succeeded`, whose `source` is `/runs/<run id>` and whose `subject` names the definition, as `reasoning/summarize`. A run's facts carry who acted as the attribute `caller`, the trigger that started the run as `triggerkind` and `triggerreference`, and its depth as `depth`, each where the run has it, so a filter names them as it names `subject`, as `triggerkind: event`; a filter that names an attribute the event does not have does not match it. The attributes are listed under [the events](recall-format.md#the-events) of a recall function, which folds the same events.

`cron` has the five fields minute, hour, day of month, month and day of week, read in UTC; when both day of month and day of week are restricted, a day that matches either is due. `every` is a [duration](#durations) of at least a minute, counted from when the trigger was saved as it is.

A trigger applies from the moment it is saved as it is: nothing recorded before is matched. The saving itself is the first thing it can match, so a trigger that names `definition_created` also starts on the fact of its own workflow's definition being saved, which a filter that names the definition it waits for by its `source`, such as `source: /definitions/reasoning/summarize`, leaves out. A new version's triggers are compared with those of the version before, by kind and place: a trigger it leaves unchanged goes on as it was, with its times and its running run, and starts the new version from then on; a trigger it changes or adds applies from the new version's saving, and a changed schedule counts its times from then; a trigger it removes stops. Saving a version without a schedule, or retiring the workflow, stops every trigger. A run a trigger starts uses the version current when the event was recorded or the time came, and its `run_id` is derived from the workflow, that version, the trigger and the event or the due time, so an event or a time starts it once.

A run a trigger starts acts as the brain itself: its `started_by` is `brain:` and the brain's name, and each step acts with read and write access to that brain and nothing else. It never acts for a person, so no key's permissions or revocation affect it.

These keep triggers from running away:

- A workflow does not start for a fact about one of its own runs, about a run one of its runs started, or for an event one of its runs emitted, whichever of its triggers started that run.
- A chain of runs started by events stops at a depth of 8. An event published from outside counts 1, an event or fact about a run counts one more than the run, and a run its trigger starts takes the depth of what it matched; a match deeper than 8 starts nothing. The brain's events carry a run's depth as their `depth` attribute.
- A workflow's event trigger starts at most 60 runs of it a minute, across its filters. More wait for a later minute, at most 1,000 of them, and one more is refused. The runs of its schedules are not counted.
- A schedule trigger has one run at a time: a time due while the run it started before still runs, of this version or of one before, is skipped. After the runtime was stopped, only the latest of the times it missed runs.
- An event and a due time in one moment start two runs, and so do a `cron` and an `every` due at the same time.
- A start the brain refuses, as once the brain is retired, is not tried again; one it cannot take at that moment is tried again at each sweep, about twenty times, before it is given up.

What a trigger did not start is recorded in the brain as a `reaction_refused` event of its workflow, at most once a minute, with how many and the last reason, which names the trigger by its kind; `list_brain_events` shows it beside the runs triggers started.

## Tasks

Each item of a task list is a mapping with one key, the task's name. Its value defines the task, and the kind of task is the key the definition contains. A task is one step of the workflow.

| Task                   | Fields                                                                                                 | Output                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `call: run_definition` | `with.type`, `with.name`, optional `with.input`                                                        | The output of the function's run                                          |
| `set`                  | A template                                                                                             | The template, with its expressions evaluated                              |
| `do`                   | A task list                                                                                            | The output of the list                                                    |
| `switch`               | A list of named cases, each with an optional `when` and a `then`                                       | Its input, unchanged                                                      |
| `for`                  | `for.in`, optional `for.each` and `for.at`, optional `while`, and `do`                                 | The output of the last iteration                                          |
| `fork`                 | `fork.branches`, a task list, and optional `fork.compete`                                              | A list of the branches' outputs, or the first output with `compete: true` |
| `try`                  | `try`, a task list, and `catch` with optional `errors.with`, `as`, `when`, `exceptWhen`, `retry`, `do` | The output of `try`, or of the recovery                                   |
| `raise`                | `raise.error`: an error, or the name of one in `use.errors`                                            | None; it raises the error                                                 |
| `wait`                 | A duration                                                                                             | Its input, unchanged                                                      |
| `listen`               | `listen.to` with `one`, `any` or `all`, and optional `listen.read`                                     | A list with the data of each event it took                                |
| `emit`                 | `emit.event.with`, the event's attributes, with `type` and `source`                                    | Its input, unchanged                                                      |

Every task also accepts these fields:

| Field        | Purpose                                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| `if`         | A condition; when it does not hold, the task is skipped                             |
| `input.from` | An expression or template that shapes the task's input                              |
| `output.as`  | An expression or template that shapes what the task hands on                        |
| `export.as`  | An expression or template whose result becomes `$context` for the tasks that follow |
| `timeout`    | `after` with a duration, or the name of a timeout in `use.timeouts`                 |
| `then`       | What runs next: `continue`, `exit`, `end`, or the name of a task in the same list   |

### Data between tasks

A task takes the output of the task before it as its input. The first task takes the run's input, shaped by the document's `input.from`. In a task's `if`, `timeout` and `input.from`, `$data` is the input it was handed; in the rest of the task, `$data` is its input after its own `input.from`, and `$input` is the same value.

In `output.as`, `$data` is what the task produced and `$input` is its input, so `${ ({ ...$input, review: $data }) }` keeps what came before and adds the new result. In `export.as`, `$data` and `$output` are the task's output and `$context` is the previous context.

A task whose `if` does not hold hands its input on unchanged, and the run continues with the next task; that task's `then` is not followed. The run's output is the output of its last task, or of the task that ended it, shaped by the document's `output.as`.

### Flow

`then: continue` runs the next task in the list, which is the default. `then: exit` leaves the current list, and the task that contains it continues. `then: end` ends the run with the current output. The name of a task in the same list jumps to that task, forwards or back. A branch of a fork can use only `continue`, `exit` and `end`.

A `switch` tests its cases in order and follows the `then` of the first case whose `when` holds. A case without `when` is the default, chosen when no other case holds. When no case is chosen, the `switch` task's own `then` applies. A `switch` hands on its input unchanged.

### Calling a function

`call: run_definition` runs the active latest version of another definition in the same brain: `with.type` names its type, `reasoning` for a reasoning function, `interaction` for an [interaction function](interaction-format.md), `computation` for a [computation function](computation-format.md), `recall` for a [recall function](recall-format.md) or `workflow` for another workflow, and `with.name` the definition. `with.input` is a template for its input, `{}` when left out. The task's output is that run's output: the text or JSON value a reasoning function answered, the answer an interaction function took from its tool or its request, the value a computation function's program gave, what a recall function answered from its view, or the output of the workflow it ran.

Each time the task runs, including on a retry, it starts a separate run of the function, recorded under its own `run_id`. That run acts for the caller who started the workflow, with the permissions that caller had when the workflow started. `run_definition` takes no arguments other than `type`, `name` and `input`.

A run of a reasoning, computation or recall function, or of an interaction function that calls a tool, finishes within the call that starts it. A run of a workflow or of an interaction function that asks a person finishes later, and the task waits for it: the run records the task it answers, and its ending, whenever it comes and on whichever server it is recorded, answers the task. While the task waits, it holds none of the calls the server runs at once, and a restart of the server does not start the run again. A task waits for a run as long as a run of that definition may take, plus a minute, and never past the longest the workflow itself may still run: a workflow may take the longest a run may last, an interaction function the `expires` of its document, or 70 seconds when it calls a tool, a reasoning function its model's deadline or, when it names tools, the bound of its tool loop, and a computation or recall function ten seconds. That is settled when the workflow starts, for each task that names its definition as written; a task whose `with.type` or `with.name` is an expression, or a definition saved after the workflow started, waits as long as the longest run of any function other than a workflow, plus a minute. When the wait passes, the task raises a `timeout` error, status 408, and the run it waited for is cancelled with the kind `deadline`; an ending that comes later answers nothing.

Workflows that call workflows reach at most 8 calls deep: the run that would sit a ninth call below the workflow at the top is refused as a `conflict`, which the calling task raises as a `runtime` error. The runs under one workflow at the top of a tree wait for at most 1,000 calls at once, a limit the deployment can change; the next call is refused in the same way.

A run of the function that does not succeed raises an error the workflow can catch:

| The function's run                                         | Error type                                  | Status |
| ---------------------------------------------------------- | ------------------------------------------- | ------ |
| Rejected with `invalid_input`                              | `validation`                                | 400    |
| Rejected with `forbidden`                                  | `authorization`                             | 403    |
| Rejected with `not_found`                                  | `configuration`                             | 404    |
| Rejected with `conflict`                                   | `runtime`                                   | 409    |
| Rejected with `conflict` of the kind `tools_called`        | `https://on.auto/problems/tools_called`     | 409    |
| Rejected with `conflict` of the kind `effect_unknown`      | `https://on.auto/problems/effect_unknown`   | 409    |
| Rejected with `unavailable`                                | `communication`                             | 503    |
| Rejected with `unavailable` of the kind `tools_unfinished` | `https://on.auto/problems/tools_unfinished` | 503    |
| Rejected with `cancelled`                                  | `https://on.auto/problems/cancelled`        | 409    |
| Rejected with `unanswered`                                 | `https://on.auto/problems/unanswered`       | 410    |
| Ran past the wait of its task                              | `timeout`                                   | 408    |
| Failed                                                     | `runtime`                                   | 500    |
| Could not be reached                                       | `communication`                             | 503    |

The short types are under `https://open-workflow-specification.org/spec/1.0.0/errors/`. A function that called tools and could not finish has a type of its own, never `communication`: the [problem type](http.md#responses-and-errors) `https://on.auto/problems/tools_unfinished`, status 503, when every tool it called is one its server marks read-only, so a `catch` on status 503 may run it again safely, and `https://on.auto/problems/effect_unknown`, status 409, when any is not. That tool may have changed something, so no `catch` on status 503 or on communication errors runs it again under a new id; one that names its type, or its kind in a `when`, does so on purpose. So does a step that meets a run of a function whose tools may have been called before, as when the server restarted during the step and performs it again: it raises `https://on.auto/problems/tools_called`, never `runtime`, and a workflow that ends with it is rejected as a `conflict` of that kind, which says to check the run's history and start a new run. A workflow that wants another run names one of those types in its `catch` and starts one knowingly.

A computation function's run that is rejected with `conflict` has the kind `unworkable`: its program raised an error, gave no output or more than one, or did more work or nested deeper than a run may. The same input gives the same result every time, so a retry policy should not match it: retry on status 503, which a run that was `unavailable` raises, and leave 409 out. [Computation function format](computation-format.md#in-a-workflow) has a workflow that does so.

A recall function's run that is rejected with `conflict` has the kind `stalled`, when its view stopped at an event its fold could not take, or `unworkable`, when its answer could not give an output; neither changes on a retry, so leave 409 out of a retry policy as well. While its view is still being built, its run is `unavailable` with the kind `rebuilding`, status 503, which a retry after a few seconds may resolve. A recall function answers from what its view has folded so far, so a step may not see an event recorded a moment before. [Recall function format](recall-format.md#in-a-workflow) has a workflow that recalls, reasons and computes.

A run that was cancelled raises the [problem type](http.md#responses-and-errors) `https://on.auto/problems/cancelled` with the kind of its cancellation: `requested` when someone cancelled it with `cancel_run`, `deadline` when what waited for it ran out of time, `overrun` when it ran as long as a workflow may, and `parent_ended` when the run that waited for it ended first. No retry policy matches it unless it names that type, so a workflow catches a cancellation only on purpose, as with `errors: { with: { type: https://on.auto/problems/cancelled } }` and `when: '${ $error.kind == "requested" }'`. A workflow that does not catch it is rejected by the error's status, 409, as `invalid_input`, and not as `cancelled`, since the workflow itself was not cancelled.

A request of an [interaction function](interaction-format.md) that nobody answered raises the problem type `https://on.auto/problems/unanswered`, status 410, with the kind `expired` when it expired unanswered or `undelivered` when a notification could not be delivered. No retry policy matches it unless it names that type, as with `errors: { with: { type: https://on.auto/problems/unanswered, kind: expired } }`, since asking again is a decision. A workflow that does not catch it is rejected as `unanswered` with the same kind.

The error's `title` names the definition and, for a rejection, its reason; its `detail` carries the detail the run gave. A rejection that has a kind carries it as the error's `kind`, and its cause as `because`, as the [HTTP problem document](http.md#responses-and-errors) does: a reasoning function whose tools are not offered is `tool_not_offered`, one whose tool server cannot be used `mcp_server_failed`, and one that called tools and could not finish `tools_unfinished` or `effect_unknown`, by whether every tool it called only reads, with the because `tool_error` when a tool answered an error and `server_failed` when a tool server failed. A `catch` reads them in the error it catches, so `when: '${ $error.kind == "tool_not_offered" }'` handles only that, and `${ $error.because }` names why.

### Waiting for events

A `listen` task waits for events sent to the run with `send_run_event`, through [HTTP](http.md) or [MCP](mcp.md), and, through a filter that names its `type` as written text, for the events of the whole brain:

- `listen.to.one` takes one event that matches its filter.
- `listen.to.any` takes the first event that matches any filter in its list.
- `listen.to.all` takes one event for each filter in its list, in the order the filters are listed.

A filter's `with` names event attributes, such as `type`, `source`, `subject` or `data`. An event matches when each named attribute equals the event's. A value written as `${ }` is evaluated instead, with the event's attribute as `$data`, and matches when it holds; `data: '${ $data > 5 }'` takes only events whose data is greater than 5. Such an expression reads `$data` and nothing else, which the brain checks when the document is saved, so an event of the brain is matched without the run, under the bounds and rules of a trigger's filter. Its stops are counted for the task and the version of the workflow, across every run listening there: after 3 in a row by its deadline or its memory, the brain records that once and offers the brain's events through that filter to none of those runs again, so a filter that churns is evaluated at most 3 times for its version on a server, however many runs wait; an event sent to a run still reaches it.

The task's output is a list with the `data` of each event it took. With `listen.read: envelope` or `raw`, the list holds the whole events: `type`, `id`, `time`, and the `source`, `subject` and `data` that were sent.

An event sent before a `listen` task waits for it is kept, and the task takes the earliest event that matches. An event whose `id` the run has already received is ignored, so a sender can retry with the same id. Waiting `until` a condition, `foreach` and `correlate` are not supported.

A filter whose `type` is written out, such as `type: com.example.brief.decided`, also hears the events the brain records: events published with `publish_event`, events workflows emit, and the brain's own facts. Such an event reaches the run only while the task listens; one recorded before the task began to listen, or after it ended, is not offered to it. To wait for the event about one thing the run handles, send that event to the run by its run id. With `all`, the events may come in any order. A filter that computes its `type` hears only events sent to the run. A run never takes an event it emitted itself. Send an event to the run by its run id when the run must not miss it. A brain has at most 4,096 tasks listening for its events at once; one more hears only events sent to its run.

### Emitting an event

An `emit` task records an event in the brain, as `publish_event` would, and hands its input on. `emit.event.with` holds the event's attributes: `type` and `source` are required, and `subject`, `time`, `data`, `datacontenttype`, `dataschema` and extension attributes are optional; any of them can be an expression. A `source` written out is an absolute URI, such as `https://example.com/campaigns`, as the DSL requires; write a relative one, such as `/campaigns`, as an expression, `'${ "/campaigns" }'`.

```yaml
- announce:
    emit:
      event:
        with:
          type: com.example.brief.approved
          source: https://example.com/campaigns
          data: { brief: '${ $data.brief }' }
```

An emitted event takes no `id`: the runtime gives it one made from the run and the task, so a run that goes on after a restart emits the event once. Its `time` is the time of the step unless the task gives one. `list_brain_events` shows it as an `event_published` event with the run and the workflow that emitted it, and a workflow whose trigger matches it starts, one level deeper than the run that emitted it. A type or a source the brain keeps for its own facts is refused when the document is saved, and fails the task with a `validation` error when an expression computes it.

### Errors, retries and timeouts

An error has a `type` (a URI), an integer `status`, an `instance` naming the task that raised it as a JSON Pointer, and an optional `title` and `detail`; an error a function's rejection raised also has its `kind` and `because` when the rejection has them. A `raise`, inline or under `use.errors`, may name a `kind` and a `because` too, so a `catch` can raise the error it caught again without losing them: `kind: '${ $error.kind }'`. A `raise` task raises an error written inline, whose values can be expressions, or one named in `use.errors`. Errors raised by the runtime have types under `https://open-workflow-specification.org/spec/1.0.0/errors/`:

| Situation                                                                                        | Error type      | Status |
| ------------------------------------------------------------------------------------------------ | --------------- | ------ |
| A task or the run exceeds its `timeout`                                                          | `timeout`       | 408    |
| An expression fails while it runs                                                                | `expression`    | 400    |
| `for.in` does not give a list, or a call's arguments are invalid or too large                    | `validation`    | 400    |
| A computed duration is invalid or too long, or `raise` names no error with a `type` and `status` | `configuration` | 400    |
| A limit on expression work, held data, tasks or events is exceeded                               | `runtime`       | 500    |

A `try` task runs its `try` list. When a task in it raises an error, the `catch` decides whether to handle it. The error is caught when each field named in `errors.with` (`type`, `status`, `instance`, `title` or `details`) equals the error's, `when` holds, and `exceptWhen` does not. Those conditions read the task's input as `$data` and `$input` and the error as `$error`, or under the name given in `catch.as`. An error that is not caught passes to the enclosing `try`, or ends the run.

When a caught error has a `retry` policy that allows another attempt, the run waits for the retry delay and runs the whole `try` list again from its first task. When no retry remains, `catch.do` runs with the task's input and the error, and its output becomes the task's output. Without `catch.do`, the task hands on its input.

A retry policy is written inline or named from `use.retries`:

| Field                      | Meaning                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `delay`                    | The wait before a retry; none when left out                                                                             |
| `backoff`                  | `constant` by default; `linear` multiplies the delay by the retry's number, and `exponential` doubles it for each retry |
| `jitter.from`, `jitter.to` | A random duration between the two, added to each delay                                                                  |
| `limit.attempt.count`      | The most retries after the first attempt                                                                                |
| `limit.attempt.duration`   | A time limit for each attempt, which raises a `timeout` error                                                           |
| `limit.duration`           | No retry starts once this much time has passed since the first attempt                                                  |
| `when`, `exceptWhen`       | Retry only when, or except when, the condition holds                                                                    |

The `patient` policy in the example retries at most three times, after 5, 10 and 20 seconds. A `timeout` on a task cancels the task when its duration passes and raises a `timeout` error at that task. A call it cancels stops the function's run at once: a reasoning function's tool calls still in flight are cancelled at their tool servers, and its run ends `rejected` as `cancelled` with the kind `deadline`, its history showing each of those calls started and never answered. A cancelled run is never run again under its id, whether or not it recorded a tool call: a request with its id and input returns its cancellation, as with any final result. The error is still a plain `timeout`, which says nothing of the tools: a `retry` that matches timeouts calls the function again, under a new id, and so calls its tools again. To keep them from being called again, leave timeouts out of such a retry, as with `exceptWhen: '${ $error.status === 408 }'`, and check the run's history before starting another. A `timeout` on the document does the same for the whole run.

### Loops and parallel branches

A `for` task evaluates `for.in` once, on its input, and runs its `do` list for each item of the list it gives. `$item` and `$index` hold the item and its position, or the names given in `for.each` and `for.at`. A `while` condition is checked before each iteration. The first iteration takes the task's input, each later one the output of the iteration before it, and the task hands on the output of the last. `then: exit` in the loop stops it, and `then: end` ends the run.

This task adds up the `amount` of each line in its input; given lines of 120, 80 and 45, it outputs `{"sum": 245}`:

```yaml
- total:
    for:
      each: line
      in: $data.lines
    do:
      - add:
          set:
            sum: ${ ($data.sum ?? 0) + $line.amount }
```

A `fork` task starts its branches together, each with the fork's input, and hands on a list of their outputs in the order the branches are written. With `compete: true`, it hands on the output of the first branch to finish without an error and cancels the others; it raises an error only when every branch fails. A fork may have at most 32 branches.

This task reviews two briefs at once and outputs both reviews:

```yaml
- reviews:
    fork:
      branches:
        - first:
            call: run_definition
            with:
              type: reasoning
              name: review-campaign-brief
              input: { brief: '${ $data.brief }' }
        - second:
            call: run_definition
            with:
              type: reasoning
              name: review-campaign-brief
              input: { brief: '${ $data.revised }' }
```

### Expressions

Expressions are TypeScript, the one language of the brain: `evaluate.language` is `typescript` and `evaluate.mode` is `strict`, the defaults, and the document is refused for any other language or mode, since an expression that fails must fail. The specification's default expression language is not this runtime's. A string enclosed in `${ }` is an expression wherever a value is written, including in templates: the values of `set`, `with`, `raise.error`, durations, and object forms of `input.from`, `output.as` and `export.as`. `if`, `when`, `exceptWhen`, `for.in`, `while` and the string forms of `input.from`, `output.as` and `export.as` are expressions even without `${ }`.

An expression is one TypeScript expression, which may span lines, not a list of statements. Its value is the expression's, and `undefined` gives `null`, at the top or as a member, so `'${ $input.note }'` and `'${ ({ id: $input.id, note: $input.note }) }'` are values even when the input has no note. A condition holds unless it gives `false` or `null`. Write an object in parentheses, `({ ... })`, and text with a template literal, `` `Hello, ${$data.name}` ``.

| Variable          | Value                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `$data`           | The data of the task: its input, or what it produced in `output.as`                 |
| `$input`          | The task's input, in its body, `output.as` and `export.as`                          |
| `$output`         | The task's output, in `export.as`                                                   |
| `$context`        | What earlier tasks exported; `{}` until a task exports                              |
| `$task`           | `name`, `reference`, `definition`, `input`, `startedAt`, and `output` after it ran  |
| `$workflow`       | `id` (the run's `run_id`), `definition`, `input` (before `input.from`), `startedAt` |
| `$runtime`        | `name: auto-brain`, `version` and `metadata.type: workflow`                         |
| `$item`, `$index` | The current item and position in a `for` loop, unless renamed                       |
| `$error`          | The caught error in `catch`, unless renamed with `catch.as`                         |

A name a `for` or a `catch` gives, `for.each`, `for.at` or `catch.as`, is written without `$` and read with it, as `line` and `$line` in the example above; it is letters, digits and underscores. `startedAt` values hold `iso8601` and `epoch` with `seconds` and `milliseconds`.

Every expression is checked when the document is saved, as one file: one that is not one expression, or that names what its place lacks, such as `$input` in an `if`, is refused at its line with the compiler's words, as `Line 8, column 23: at /do/1/read/set/n: Cannot find name '$nope'.` An expression is checked for its syntax and its names, not its types, since a workflow carries no schema of its data. A document whose check takes longer than the 2 seconds a save allows, the server's wall-clock time, is refused, `invalid_input`, as for a computation function; a busy server may also have slowed the check, so a document near the bound may pass when it is saved again later.

Expressions run in the sandbox computation functions run in, with the same library and rules; see [The sandbox](computation-format.md#the-sandbox). `Date.now()` and `new Date()` give the time the run recorded for the task, never the clock of the machine, so a run decides the same way when it is replayed; a `Date` made from local time, such as `new Date(2026, 0, 1)`, raises, and the local-time methods are absent: use `Date.UTC` and the UTC methods.

An expression may do 250 checkpoints of work, the measure of a computation function's work, and the expressions of one input of a run 500 together and at most 2 seconds, in a sandbox of 64 MiB. One that does more, runs longer or uses more memory fails its task with a `runtime` error of status 500, which the workflow's `try` can catch and the expression cannot. A value an expression gives may nest at most 512 levels, as a value a run holds may; one that nests deeper, or that JSON cannot carry, such as a `Map` or a `BigInt`, fails its task with an `expression` error, and so does an error the expression raises, a stack overflow among them.

Quote an expression that contains `: ` or that sits inside a `{ }` mapping, as the examples do; otherwise YAML reads its colon or braces and the document is refused.

### Durations

A duration is an ISO 8601 string such as `PT30M` or `P7D`, in weeks, days, hours, minutes and seconds, or a mapping of `days`, `hours`, `minutes`, `seconds` and `milliseconds` with non-negative numbers. Years and months are refused because their length varies. A duration can also be an expression, evaluated when the task runs.

## Saving a document

`create_definition` and `update_definition` check the whole document before saving it: its YAML, the DSL schema, the connections between its tasks, every expression and duration, and the rules on this page. Anchors, aliases and tags are refused. Each problem is an issue under `/source` with its line, column and JSON Pointer:

```text
Line 7, column 12: at /do/1/loop/for: It needs in
```

These are refused when a document is saved:

| Refused                                                                                       | Reason given                                                               |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `run` tasks                                                                                   | The runtime does not run them                                              |
| `call` of `http`, `grpc`, `openapi`, `asyncapi`, `a2a` or `mcp`                               | A workflow reaches the world only through its brain's functions            |
| A `call` of anything other than `run_definition`                                              | `run_definition` is the one function                                       |
| `schedule.after`, `schedule.on.all`, `schedule.on.until`, or a schedule that names no trigger | A trigger starts one run for each event or time                            |
| A trigger filter without a written `type`                                                     | A trigger is matched before any run exists                                 |
| A trigger or `listen` filter whose expression names anything but `$data`                      | The brain matches it without the run                                       |
| A trigger filter written twice in `any`, or more than 64 filters in one trigger               | See [Triggers](#triggers)                                                  |
| `schedule.every` shorter than a minute, or a `cron` that is not five fields or names no time  | See [Triggers](#triggers)                                                  |
| An `emit` without `type` or `source`, with an `id`, or with a type or source the brain keeps  | See [Emitting an event](#emitting-an-event)                                |
| `use.catalogs`, `use.extensions`, `use.functions`, `use.secrets`, `use.authentications`       | Not supported                                                              |
| `listen` with `until`, `foreach` or `correlate`                                               | Not supported                                                              |
| Schemas on tasks, and schemas not written inline as JSON Schema                               | Task schemas are not checked; external schemas are not fetched             |
| A `then` naming no task in the same list, or a jump from a fork branch                        | Flow must stay within the list                                             |
| A name in `raise.error`, `retry` or `timeout` missing from `use`                              | The reference must exist                                                   |
| `evaluate.language` other than `typescript`, `evaluate.mode` other than `strict`              | The brain's one language is TypeScript; an expression that fails must fail |
| An expression that is not one TypeScript expression, or names what its place lacks            | See [Expressions](#expressions)                                            |
| Durations in years or months, or longer than a run may last                                   | See [Durations](#durations) and [Limits](#limits)                          |

## How a run ends

`run_definition` answers `status: started` as soon as the run begins, or how the run ended when it ended before its first wait. `get_run` shows the run as `started` until it ends:

- `succeeded`, with the run's `output`, when its last task completes or a task ends it.
- `rejected`, when an error is not caught. The rejection's `reason` is `invalid_input` for an error with a 4xx status other than 408 and 429, and `unavailable` otherwise. Its `detail` gives the error's title, or else its type, then its detail and the task that raised it, such as `The brief is not usable: Missing: audience (at /do/0/stop)`.
- `rejected` with the reason `cancelled`, when it was cancelled: with the kind `requested` by `cancel_run`, `deadline` when the workflow that waited for it ran out of time, `overrun` when it was still running at the longest a run may last, and `parent_ended` when the workflow that waited for it ended first, or the branch that waited for it lost a race. The `detail` says why, in the words of whoever cancelled it.
- `rejected` with the reason `unanswered`, with the kind `expired` or `undelivered`, when it did not catch the error of a request of an interaction function that nobody answered.
- `rejected` with the reason `conflict` of the kind `oversized`, when its output is larger than 1 MiB.
- `failed`, when the run broke down inside the runtime.

A timeout that is not caught therefore rejects the run as `unavailable`, and a call rejected with `invalid_input` that is not caught rejects it as `invalid_input`.

`cancel_run` cancels a workflow run that has not ended, from any server: the run stops its tasks, cancels each run it waits for, with the kind `parent_ended`, and ends as `cancelled` within a moment, unless it ends first. It cancels the run of an interaction function whose request waits in the same way. A run that has ended, or a run of a function that finishes within its call, cannot be cancelled.

## Limits

| Limit                        | Value                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Source document              | 65,536 bytes in UTF-8                                                                                          |
| Nested task lists            | 64 levels                                                                                                      |
| Nested values                | 512 levels                                                                                                     |
| Work of an expression        | 250 checkpoints; the expressions of one input 500 together, in 2 seconds and a sandbox of 64 MiB               |
| Branches of a fork           | 32                                                                                                             |
| Duration of a run            | 30 days, unless the deployment sets between 2 hours and 365 days; a run still going at that limit is cancelled |
| Wait for a call              | The longest its function may run, plus a minute, within what remains of the run's duration                     |
| Calls above a run            | 8                                                                                                              |
| Calls waiting under one run  | 1,000 under the workflow at the top of a tree, unless the deployment sets between 1 and 9,999                  |
| Input of a run               | 256 KiB as JSON                                                                                                |
| Input of a call              | 256 KiB as JSON                                                                                                |
| Output of a run              | 1 MiB as JSON, together with the run's record                                                                  |
| Data a run holds at once     | 4 MiB: the values it keeps, as JSON in UTF-8, the document, and 4 KiB for each task under way                  |
| One value kept across a wait | 1.5 MiB (1,572,864 bytes) as JSON, less the rest of the change recorded with it                                |
| Tasks without waiting        | 10,000                                                                                                         |
| Inputs a run takes           | 100,000: its start, each answer of a function, each timer and each event                                       |
| Recorded history of a run    | 512 MiB as JSON                                                                                                |
| An event                     | 256 KiB as JSON; `type` and `id` at most 256 characters, `source` and `subject` at most 1,024                  |
| Events waiting to be taken   | 64, or 1 MiB as JSON                                                                                           |
| Events over a run's life     | 1,024, or 4 MiB as JSON                                                                                        |
| Events a run emits           | 1,024, or 4 MiB as JSON, over its life                                                                         |
| An emitted event             | 240 KiB as JSON                                                                                                |
| Triggers of a workflow       | 3: one `on`, one `cron` and one `every`                                                                        |
| Filters of an event trigger  | 64                                                                                                             |
| Workflows with triggers      | 1,024 in a brain, however many triggers each has; saving one more is refused with `conflict`                   |
| Tasks listening to a brain   | 4,096 at once; one more hears only the events sent to its run                                                  |
| Runs a trigger starts        | 60 a minute for each workflow by its event trigger, at most 1,000 more waiting; its schedules are not counted  |
| Depth of a chain of triggers | 8                                                                                                              |
| `schedule.every`             | At least a minute, counted from when the trigger was saved as it is                                            |

A duration written in the document that is longer than a run may last is refused when the document is saved; one that an expression computes fails its task with a `configuration` error. Exceeding the limits on held data, a value kept across a wait, tasks without waiting, inputs or history ends the run at once, rejected as `unavailable` with a `runtime` error of status 500. One event more than the event limits allow ends the run at once, rejected, and later events to it are refused with `not_found`. An emit beyond the limit on emitted events fails its task with a `runtime` error of status 500, which the workflow's `try` can catch, and an emitted event larger than 240 KiB with a `validation` error of status 400.

## Upgrading

A call whose function's run takes longer than its task waits for it now raises a `timeout` error, status 408, where it raised a `communication` error of status 503, and the run it waited for is cancelled. A retry policy that matches status 503 or the `communication` type therefore no longer retries it; to retry it, match `timeout` or status 408, and remember that a `timeout` also comes from a task's own `timeout`. A run that is cancelled, or still running at the longest a run may last, now ends `rejected` as `cancelled` rather than `failed`, and a run whose output is larger than 1 MiB `rejected` as a `conflict` of the kind `oversized`.

An event sent to a run without a `source` now has the source `/callers/` and the id of the caller who sent it, so that every event says where it came from. A `listen` filter of `source: null` therefore no longer matches an event sent to the run; match it on its `type`, or test the `source` it is sent with.

</div>
