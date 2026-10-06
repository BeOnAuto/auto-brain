<div v-pre>

# Workflow format

The API stores a workflow as an `orchestration` spec. Its source document is YAML written in the [Open Workflow Specification](https://github.com/open-workflow-specification/specification) DSL 1.0, within the rules and limits on this page. [Build your first workflow](../tutorials/first-workflow.md) provides a guided example, and [Workflows and runs](../concepts/workflows.md) explains how a run starts, waits and ends.

## A workflow document

This workflow reviews a campaign brief with the `review-campaign-brief` reason function from [Build your first brain](../tutorials/first-brain.md). It retries the review when the model is unavailable, then waits up to a week for an approval decision:

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
            call: execute_spec
            with:
              primitive: inference
              name: review-campaign-brief
              input:
                brief: ${ .brief }
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
        as: '${ $input + { review: . } }'
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
              as: '${ .[0] }'
      catch:
        errors:
          with: { status: 408 }
        do:
          - no-answer:
              set: { approved: false, reason: No decision within a week }
      output:
        as: '${ $input + { decision: . } }'
  - route:
      switch:
        - approved:
            when: .decision.approved == true
            then: approve
        - otherwise:
            then: decline
  - approve:
      set:
        approved: true
        review: ${ .review }
      then: end
  - decline:
      set:
        approved: false
        reason: ${ .decision.reason }
        review: ${ .review }
```

For this document, `create_spec` takes `primitive: "orchestration"`, a workflow `name` and the document as `source`. `execute_spec` takes the same primitive and name, with `brief` in the `input` object. The run reviews the brief, then waits. Sending it the event `com.example.brief.decided` with `data` of `{"approved": true}` ends it with `approved: true` and the review. A decision of `{"approved": false, "reason": "..."}` ends it with that reason, and no decision within seven days ends it with the reason `No decision within a week`.

## Document fields

| Field                                       | Purpose                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `document.dsl`                              | Required DSL version, from `1.0.0` to `1.0.3`                                                         |
| `document.namespace`, `document.name`       | Required names of the document                                                                        |
| `document.version`                          | Required semantic version of the document, such as `1.0.0`                                            |
| `document.title`, `document.summary`        | Optional; the summary, or else the title, becomes the definition's `description`                      |
| `input.schema.document`                     | Optional inline JSON Schema, published as the definition's `input_schema`                             |
| `input.from`                                | Optional expression or template that shapes the run's input before the first task                     |
| `do`                                        | Required list of named tasks, run in order                                                            |
| `output.as`                                 | Optional expression or template that shapes the run's output                                          |
| `output.schema.document`                    | Optional inline JSON Schema, published as the definition's `output_schema`                            |
| `timeout`                                   | Optional limit for the whole run: `after` with a duration, or the name of a timeout in `use.timeouts` |
| `use.errors`, `use.retries`, `use.timeouts` | Optional named errors, retry policies and timeouts that tasks refer to by name                        |

The runtime does not check a run's input or output against these schemas; they tell callers what the workflow takes and gives. A run whose input lacks a value still starts, and a step that depends on the value fails: a reason function, for example, rejects input that does not match its own schema. Schemas must be written inline under `document`, as JSON Schema.

`document.version` is part of the document you write. The definition's `version` counts saved changes: it is 1 when the workflow is created and increases each time `update_spec` changes the document.

## Tasks

Each item of a task list is a mapping with one key, the task's name. Its value defines the task, and the kind of task is the key the definition contains. A task is one step of the workflow.

| Task                 | Fields                                                                                                 | Output                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `call: execute_spec` | `with.primitive`, `with.name`, optional `with.input`                                                   | The output of the function's run                                          |
| `set`                | A template                                                                                             | The template, with its expressions evaluated                              |
| `do`                 | A task list                                                                                            | The output of the list                                                    |
| `switch`             | A list of named cases, each with an optional `when` and a `then`                                       | Its input, unchanged                                                      |
| `for`                | `for.in`, optional `for.each` and `for.at`, optional `while`, and `do`                                 | The output of the last iteration                                          |
| `fork`               | `fork.branches`, a task list, and optional `fork.compete`                                              | A list of the branches' outputs, or the first output with `compete: true` |
| `try`                | `try`, a task list, and `catch` with optional `errors.with`, `as`, `when`, `exceptWhen`, `retry`, `do` | The output of `try`, or of the recovery                                   |
| `raise`              | `raise.error`: an error, or the name of one in `use.errors`                                            | None; it raises the error                                                 |
| `wait`               | A duration                                                                                             | Its input, unchanged                                                      |
| `listen`             | `listen.to` with `one`, `any` or `all`, and optional `listen.read`                                     | A list with the data of each event it took                                |

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

A task takes the output of the task before it as its input. The first task takes the run's input, shaped by the document's `input.from`. In a task's expressions, `.` is its input after its own `input.from`, and `$input` is the same value.

In `output.as`, `.` is what the task produced and `$input` is its input, so `${ $input + { review: . } }` keeps what came before and adds the new result. In `export.as`, `.` and `$output` are the task's output and `$context` is the previous context.

A task whose `if` does not hold hands its input on unchanged, and the run continues with the next task; that task's `then` is not followed. The run's output is the output of its last task, or of the task that ended it, shaped by the document's `output.as`.

### Flow

`then: continue` runs the next task in the list, which is the default. `then: exit` leaves the current list, and the task that contains it continues. `then: end` ends the run with the current output. The name of a task in the same list jumps to that task, forwards or back. A branch of a fork can use only `continue`, `exit` and `end`.

A `switch` tests its cases in order and follows the `then` of the first case whose `when` holds. A case without `when` is the default, chosen when no other case holds. When no case is chosen, the `switch` task's own `then` applies. A `switch` hands on its input unchanged.

### Calling a function

`call: execute_spec` runs the active latest version of another definition in the same brain: `with.primitive` names its type, such as `inference`, and `with.name` the definition. `with.input` is a template for its input, `{}` when left out. The task's output is that run's output: the text or JSON value a reason function answered.

Each time the task runs, including on a retry, it starts a separate run of the function, recorded under its own `execution_id`. That run acts for the caller who started the workflow, with the permissions that caller had when the workflow started. A workflow cannot execute another workflow, and `execute_spec` takes no arguments other than `primitive`, `name` and `input`.

A run of the function that does not succeed raises an error the workflow can catch:

| The function's run                                         | Error type                                  | Status |
| ---------------------------------------------------------- | ------------------------------------------- | ------ |
| Rejected with `invalid_input`                              | `validation`                                | 400    |
| Rejected with `forbidden`                                  | `authorization`                             | 403    |
| Rejected with `not_found`                                  | `configuration`                             | 404    |
| Rejected with `conflict`                                   | `runtime`                                   | 409    |
| Rejected with `unavailable`                                | `communication`                             | 503    |
| Rejected with `unavailable` of the kind `tools_unfinished` | `https://on.auto/problems/tools_unfinished` | 503    |
| Failed                                                     | `runtime`                                   | 500    |
| Could not be reached                                       | `communication`                             | 503    |

The short types are under `https://open-workflow-specification.org/spec/1.0.0/errors/`. A reason function that called tools and could not finish has a type of its own, the [problem type](http.md#responses-and-errors) `https://on.auto/problems/tools_unfinished`, never `communication`: its tools may have changed something, so a `catch` that retries communication errors does not run them again under a new id. A workflow that wants another run names that type in its `catch` and starts one knowingly.

The error's `title` names the definition and, for a rejection, its reason; its `detail` carries the detail the run gave. A rejection that has a kind carries it as the error's `kind`, and its cause as `because`, as the [HTTP problem document](http.md#responses-and-errors) does: a reason function whose tools are not offered is `tool_not_offered`, one whose tool server cannot be used `mcp_server_failed`, and one that called tools and could not finish `tools_unfinished`, its tools having perhaps changed something. A `catch` reads them in the error it catches, so `when: '${ $error.kind == "tool_not_offered" }'` handles only that, and `${ $error.because }` names why.

### Waiting for events

A `listen` task waits for events sent to the run with `send_execution_event`, through [HTTP](http.md) or [MCP](mcp.md):

- `listen.to.one` takes one event that matches its filter.
- `listen.to.any` takes the first event that matches any filter in its list.
- `listen.to.all` takes one event for each filter in its list, in the order the filters are listed.

A filter's `with` names event attributes, such as `type`, `source`, `subject` or `data`. An event matches when each named attribute equals the event's. A value written as `${ }` is evaluated instead, with `.` as the event's attribute, and matches when it holds; `data: '${ . > 5 }'` takes only events whose data is greater than 5.

The task's output is a list with the `data` of each event it took. With `listen.read: envelope` or `raw`, the list holds the whole events: `type`, `id`, `time`, and the `source`, `subject` and `data` that were sent.

An event sent before a `listen` task waits for it is kept, and the task takes the earliest event that matches. An event whose `id` the run has already received is ignored, so a sender can retry with the same id. Waiting `until` a condition, `foreach` and `correlate` are not supported.

### Errors, retries and timeouts

An error has a `type` (a URI), an integer `status`, an `instance` naming the task that raised it as a JSON Pointer, and an optional `title` and `detail`; an error a function's rejection raised also has its `kind` and `because` when the rejection has them. A `raise` task raises an error written inline, whose values can be expressions, or one named in `use.errors`. Errors raised by the runtime have types under `https://open-workflow-specification.org/spec/1.0.0/errors/`:

| Situation                                                                                        | Error type      | Status |
| ------------------------------------------------------------------------------------------------ | --------------- | ------ |
| A task or the run exceeds its `timeout`                                                          | `timeout`       | 408    |
| An expression fails while it runs                                                                | `expression`    | 400    |
| `for.in` does not give a list, or a call's arguments are invalid or too large                    | `validation`    | 400    |
| A computed duration is invalid or too long, or `raise` names no error with a `type` and `status` | `configuration` | 400    |
| A limit on expression work, held data, tasks or events is exceeded                               | `runtime`       | 500    |

A `try` task runs its `try` list. When a task in it raises an error, the `catch` decides whether to handle it. The error is caught when each field named in `errors.with` (`type`, `status`, `instance`, `title` or `details`) equals the error's, `when` holds, and `exceptWhen` does not. Those conditions read the task's input as `.` and the error as `$error`, or under the name given in `catch.as`. An error that is not caught passes to the enclosing `try`, or ends the run.

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

The `patient` policy in the example retries at most three times, after 5, 10 and 20 seconds. A `timeout` on a task cancels the task when its duration passes and raises a `timeout` error at that task. A call it cancels stops the function's run at once: a reason function's tool calls still in flight are cancelled at their tool servers, and its run ends `failed`, its history showing each of those calls started and never answered. Since its tools may have changed something, that run is not run again under its id. A `timeout` on the document does the same for the whole run.

### Loops and parallel branches

A `for` task evaluates `for.in` once, on its input, and runs its `do` list for each item of the list it gives. `$item` and `$index` hold the item and its position, or the names given in `for.each` and `for.at`. A `while` condition is checked before each iteration. The first iteration takes the task's input, each later one the output of the iteration before it, and the task hands on the output of the last. `then: exit` in the loop stops it, and `then: end` ends the run.

This task adds up the `amount` of each line in its input; given lines of 120, 80 and 45, it outputs `{"sum": 245}`:

```yaml
- total:
    for:
      each: line
      in: .lines
    do:
      - add:
          set:
            sum: ${ (.sum // 0) + $line.amount }
```

A `fork` task starts its branches together, each with the fork's input, and hands on a list of their outputs in the order the branches are written. With `compete: true`, it hands on the output of the first branch to finish without an error and cancels the others; it raises an error only when every branch fails. A fork may have at most 32 branches.

This task reviews two briefs at once and outputs both reviews:

```yaml
- reviews:
    fork:
      branches:
        - first:
            call: execute_spec
            with:
              primitive: inference
              name: review-campaign-brief
              input: { brief: '${ .brief }' }
        - second:
            call: execute_spec
            with:
              primitive: inference
              name: review-campaign-brief
              input: { brief: '${ .revised }' }
```

### Expressions

Expressions are [jq](https://jqlang.org). A string enclosed in `${ }` is an expression wherever a value is written, including in templates: the values of `set`, `with`, `raise.error`, durations, and object forms of `input.from`, `output.as` and `export.as`. `if`, `when`, `exceptWhen`, `for.in`, `while` and the string forms of `input.from`, `output.as` and `export.as` are expressions even without `${ }`. A condition holds unless it gives `false` or `null`.

| Variable          | Value                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `.`               | The data of the task: its input, or what it produced in `output.as`                       |
| `$input`          | The task's input                                                                          |
| `$output`         | The task's output, in `export.as`                                                         |
| `$context`        | What earlier tasks exported; `{}` until a task exports                                    |
| `$task`           | `name`, `reference`, `definition`, `input`, `startedAt`, and `output` after it ran        |
| `$workflow`       | `id` (the run's `execution_id`), `definition`, `input` (before `input.from`), `startedAt` |
| `$runtime`        | `name: auto-brain`, `version` and `metadata.primitive: orchestration`                     |
| `$item`, `$index` | The current item and position in a `for` loop, unless renamed                             |
| `$error`          | The caught error in `catch`, unless renamed with `catch.as`                               |

`startedAt` values hold `iso8601` and `epoch` with `seconds` and `milliseconds`. `now` gives the time the run recorded for the task, never the clock of the machine. `localtime` and `strflocaltime`, which read the machine's time zone, are refused; use the UTC builtins.

An expression may do a bounded amount of work, about one pass over a few megabytes of data. One that does more fails its task with a `runtime` error that the workflow's `try` can catch and jq's `try` cannot.

Quote an expression that contains `: ` or that sits inside a `{ }` mapping, as the examples do; otherwise YAML reads its colon or braces and the document is refused.

### Durations

A duration is an ISO 8601 string such as `PT30M` or `P7D`, in weeks, days, hours, minutes and seconds, or a mapping of `days`, `hours`, `minutes`, `seconds` and `milliseconds` with non-negative numbers. Years and months are refused because their length varies. A duration can also be an expression, evaluated when the task runs.

## Saving a document

`create_spec` and `update_spec` check the whole document before saving it: its YAML, the DSL schema, the connections between its tasks, every expression and duration, and the rules on this page. Anchors, aliases and tags are refused. Each problem is an issue under `/source` with its line, column and JSON Pointer:

```text
Line 7, column 12: at /do/1/loop/for: It needs in
```

These are refused when a document is saved:

| Refused                                                                                 | Reason given                                                    |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `run` and `emit` tasks                                                                  | The runtime does not run them                                   |
| `call` of `http`, `grpc`, `openapi`, `asyncapi`, `a2a` or `mcp`                         | A workflow reaches the world only through its brain's functions |
| A `call` of anything other than `execute_spec`                                          | `execute_spec` is the one function                              |
| `execute_spec` of an `orchestration` definition                                         | A workflow cannot execute another workflow                      |
| `schedule`                                                                              | A workflow starts when it is executed                           |
| `use.catalogs`, `use.extensions`, `use.functions`, `use.secrets`, `use.authentications` | Not supported                                                   |
| `listen` with `until`, `foreach` or `correlate`                                         | Not supported                                                   |
| Schemas on tasks, and schemas not written inline as JSON Schema                         | Task schemas are not checked; external schemas are not fetched  |
| A `then` naming no task in the same list, or a jump from a fork branch                  | Flow must stay within the list                                  |
| A name in `raise.error`, `retry` or `timeout` missing from `use`                        | The reference must exist                                        |
| `localtime`, `strflocaltime`, and expressions that do not parse                         | Expressions must be valid and deterministic                     |
| Durations in years or months, or longer than a run may last                             | See [Durations](#durations) and [Limits](#limits)               |

## How a run ends

`execute_spec` answers `status: started` as soon as the run begins. `get_execution` shows the run as `started` until it ends:

- `succeeded`, with the run's `output`, when its last task completes or a task ends it.
- `rejected`, when an error is not caught. The rejection's `reason` is `invalid_input` for an error with a 4xx status other than 408 and 429, and `unavailable` otherwise. Its `detail` gives the error's title, or else its type, then its detail and the task that raised it, such as `The brief is not usable: Missing: audience (at /do/0/stop)`.
- `failed`, when the run broke down inside the runtime, produced an output larger than 1 MiB, or was still running when it reached the longest a run may last.

A timeout that is not caught therefore rejects the run as `unavailable`, and a call rejected with `invalid_input` that is not caught rejects it as `invalid_input`.

## Limits

| Limit                        | Value                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Source document              | 65,536 bytes in UTF-8                                                                                   |
| Nested task lists            | 64 levels                                                                                               |
| Nested values                | 512 levels                                                                                              |
| Branches of a fork           | 32                                                                                                      |
| Duration of a run            | 30 days, unless the deployment sets between 2 hours and 365 days; a run still going at that limit fails |
| Input of a run               | 256 KiB as JSON                                                                                         |
| Input of a call              | 256 KiB as JSON                                                                                         |
| Output of a run              | 1 MiB as JSON, together with the run's record                                                           |
| Data a run holds at once     | 4 MiB: the values it keeps, as JSON in UTF-8, the document, and 4 KiB for each task under way           |
| One value kept across a wait | 1.5 MiB (1,572,864 bytes) as JSON, less the rest of the change recorded with it                         |
| Tasks without waiting        | 10,000                                                                                                  |
| Inputs a run takes           | 100,000: its start, each answer of a function, each timer and each event                                |
| Recorded history of a run    | 512 MiB as JSON                                                                                         |
| An event                     | 256 KiB as JSON; `type` and `id` at most 256 characters, `source` and `subject` at most 1,024           |
| Events waiting to be taken   | 64, or 1 MiB as JSON                                                                                    |
| Events over a run's life     | 1,024, or 4 MiB as JSON                                                                                 |

A duration written in the document that is longer than a run may last is refused when the document is saved; one that an expression computes fails its task with a `configuration` error. Exceeding the limits on held data, a value kept across a wait, tasks without waiting, inputs or history ends the run at once, rejected as `unavailable` with a `runtime` error of status 500. One event more than the event limits allow ends the run at once, rejected, and later events to it are refused with `not_found`.

</div>
