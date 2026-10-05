# Workflow format

The runtime stores workflows as `orchestration` specs and runs them on the workflow machine of `@beonauto/workflow-engine`, in the server, through `@beonauto/workflow-host`. Keep `orchestration` in API calls and MCP arguments. Starting workflows from schedules or event triggers, calling subworkflows, and direct external tool calls are not implemented in this version.

## A workflow spec

A spec document of orchestration is a YAML workflow in the [Open Workflow Specification](https://github.com/open-workflow-specification/specification) DSL 1.0.x (the CNCF Serverless Workflow DSL), media type `application/yaml`. It has:

- `document`: `dsl` (`1.0.0` to `1.0.3`), `namespace`, `name`, `version`, and an optional `title` and `summary`. The `summary`, or else the `title`, is the description of the spec.
- `input`: an optional `from` that shapes the input, and an optional inline JSON Schema `document`, published as the `input_schema` of the spec.
- `do`: the named tasks, run in order.
- `output`: an optional `as` that shapes the output, and an optional inline JSON Schema, published as the `output_schema`.
- an optional `timeout`, and optional `use.errors`, `use.retries` and `use.timeouts` that tasks reuse by name.

This workflow classifies a support ticket with an inference spec, branches on the answer, and retries paging someone until it gives up:

```yaml
document:
  dsl: '1.0.3'
  namespace: acme
  name: triage-ticket
  version: '1.0.0'
  title: Triage a support ticket
  summary: Classifies a ticket with an inference spec, then escalates urgent ones and files the rest.
input:
  schema:
    document:
      type: object
      properties:
        ticket: { type: string }
      required: [ticket]
use:
  retries:
    patient:
      delay: { seconds: 2 }
      backoff: { exponential: {} }
      limit:
        attempt: { count: 3 }
do:
  - classify:
      call: execute_spec
      with:
        primitive: inference
        name: classify-ticket
        input:
          ticket: ${ .ticket }
      output:
        as: '${ $input + { category: .category, urgent: .urgent } }'
  - route:
      switch:
        - urgent:
            when: .urgent == true
            then: escalate
        - routine:
            then: file
  - escalate:
      try:
        - page:
            call: execute_spec
            with:
              primitive: interaction
              name: page-on-call
              input:
                summary: '${ "Urgent " + .category + " ticket: " + .ticket }'
      catch:
        errors:
          with: { status: 503 }
        retry: patient
        do:
          - giveUp:
              raise:
                error:
                  type: https://example.com/errors/on-call-unreachable
                  status: 503
                  title: Nobody on call could be paged
      then: end
  - file:
      set:
        filed: true
        category: ${ .category }
```

## What a workflow may do

| Allowed                                                                       | Rejected in this version                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `set`, `do`, `switch`, `for` (with `while`), `fork` (with `compete`)          | `run` (shell, script, container, workflow) and `emit`                                                    |
| `call: execute_spec`                                                          | `call` of `http`, `grpc`, `openapi`, `asyncapi`, `a2a`, `mcp`, or of any other function                  |
| `try` with `catch` (`errors.with`, `as`, `when`, `exceptWhen`, `retry`, `do`) | `use.catalogs`, `use.extensions`, `use.functions`, `use.secrets`, `use.authentications`, and `schedule`  |
| `raise`, `wait`, `listen` (`one`, `all`, `any`; `read`)                       | `listen` with `until`, `foreach` or `correlate`; schemas on tasks; schemas not inline or not JSON Schema |
| `then: continue`, `exit`, `end`, or the name of a task in the same list       | executing an orchestration spec from a workflow                                                          |
| `if`, `input.from`, `output.as`, `export.as`, `timeout`                       | the jq builtins `localtime` and `strflocaltime`; durations in years or months                            |

A document may nest task lists (`do`, `for`, `try`, `catch.do`, `fork.branches`) at most 64 levels deep and any value at most 512 levels; a deeper document is rejected at the list or value that is too deep, before anything else is checked, and a workflow refuses to start with one however it was stored.

A fork may have at most 32 branches, checked when the document is stored and again when a workflow starts. A workflow may run for at most `ORCHESTRATION_MAX_DURATION` (30 days unless set otherwise): a `wait` or a `timeout` written as a duration longer than that is rejected when the document is stored, and one an expression computes longer fails the task that computes it with a `configuration` error.

Creating or updating a spec checks its document fully: it reads the YAML without aliases, anchors or tags, validates it against the DSL schema and its rules, builds its graph of tasks, and applies the policy above. Every problem is an issue under `/source` with the line, the column and the JSON Pointer of the place: `Line 8, column 12: at /do/0/loop/for: It needs in`. When a workflow starts, the machine applies again only the policy's prohibitions, what this runtime does not allow at all: the tasks, calls, components, `schedule` and `listen` options of the rejected column above, executing another workflow, schemas that are not inline JSON Schema, and a DSL version other than 1.0.x. So a document that never went through the spec operations cannot use what the policy forbids. The other problems the spec operations reject, such as an expression that does not parse or uses `localtime`, a duration in years, or a `then` that names no task, are not checked again: they fail the task that has them when it runs.

### Expressions

Expressions are [jq](https://jqlang.org), evaluated by `@gabrielbryk/jq-ts` inside the workflow. A string enclosed in `${ }` is an expression wherever the DSL takes a value; `if`, `when`, `exceptWhen`, `for.in`, `while`, and the strings of `input.from`, `output.as` and `export.as` are expressions even without `${ }`. They see `.` (the data of the step), `$context` (what tasks exported), `$input`, `$output` (in `export.as`), `$task` (`name`, `reference`, `definition`, `input`, `startedAt`, and `output` after the task ran), `$workflow` (`id`, the execution id; `definition`; `input`; `startedAt`), `$runtime` (`name: auto-brain`), and the variables of loops (`$item` and `$index` unless named with `each` and `at`) and catches (`$error` unless named with `as`). `now` is the time of the input the run is deciding, recorded in its log, never the clock of the host.

### The work of expressions

Workflows of every org share the server's one thread, so no document may make it busy for long. Every operation of jq that builds or visits values charges, before it does so, the work of what it builds or visits, in units of one string character: a value, array item or object entry counts 16, copying an object entry 32, an evaluation step 128, a character encoded with a format or changed in case 16, a character searched for or in 4, a thread of the regex machine at a position 8. The count is deterministic, so the same input decides the same way; no clock is read.

- An expression may do 8000000 units. One that tries to do more stops at once, and the task fails with a `runtime` error of status 500; jq's `try` cannot catch it, and the workflow's `try` can.
- Pure tasks run one after another without waiting. Before a task, a run that has done 8000000 units of expression work, or run 100 tasks, in the input it is deciding lets other runs go: it arms a timer due at once and goes on when it fires. A task cannot pause in the middle, so a run fails with a `runtime` error once it has done 16000000 units in one input.
- A value the workflow holds, its input, the output of a task, its context and its output, may take at most 8000000 units to visit and nest at most 512 levels deep; a value counts a part it shares as often as it holds it, so doubling a value from task to task fails too. An execution with an input deeper than that is rejected with `invalid_input` before the workflow starts.

Measured on an Apple M-series machine, the expressions that do the most work per unit, run up to the budget, take at most about 30 ms and allocate at most about 25 MB (`@base64` of a 400000-character string); before the budget, `"x" * 40000000 | length` took 0.5 s and 0.8 GB, and `"a" * 200000 | indices("a" * 100000)` 2.5 s.

The count comes from a patch of `@gabrielbryk/jq-ts` 1.7.0 (`patches/@gabrielbryk__jq-ts@1.7.0.patch` at the root of the repository), which the library offers no hook for. It adds the `maxWork` limit and the `usage` it reports, charges the operations listed above, and replaces the library's string search, which in the engine's worst case takes time in proportion to the product of the two lengths, with the Knuth-Morris-Pratt search, linear in their sum. A new version of the library needs the patch ported, and `packages/workflow-engine/src/dsl/expression-work.test.ts` fails for any charge that goes missing.

### Executing a spec

`call: execute_spec` with `with: { primitive, name, input }` executes the active spec of that primitive and name in the same brain, for the caller who started the workflow, and outputs its output. The input is `{}` when left out and may take at most 262144 bytes as JSON. A rejection or a failure is an error the workflow can catch:

| The execution            | Error type (under `https://open-workflow-specification.org/spec/1.0.0/errors/`) | Status |
| ------------------------ | ------------------------------------------------------------------------------- | ------ |
| rejected `invalid_input` | `validation`                                                                    | 400    |
| rejected `forbidden`     | `authorization`                                                                 | 403    |
| rejected `not_found`     | `configuration`                                                                 | 404    |
| rejected `conflict`      | `runtime`                                                                       | 409    |
| rejected `unavailable`   | `communication`                                                                 | 503    |
| failed                   | `runtime`                                                                       | 500    |
| could not be reached     | `communication`                                                                 | 503    |

The `title` names the spec and the reason, and the `detail` carries the detail of the rejection with its issues. Retrying is the document's choice, with `try` and `catch.retry`: the run waits on durable timers between attempts. The server does not retry a call on its own; a call cut off when the server stopped is performed again when it starts.

Each run of a call is its own execution, with an id derived from the workflow's execution id, the reference of the task and how many times that task ran: a UUID version 5. A call performed again asks for the same execution id, so an execution that already has a final result is answered from the ledger and its model is not called again.

A call may run for the longest a nested execution may legitimately take and a minute more: the most `longestExecutionMs` the server's primitives state (see `@beonauto/specs`), which the server gives the run as its `longestCallMs`. For inference that is the deadline of a model call for the most output tokens, 60 seconds and 25 ms a token, 1660 seconds for 64000, so 1720 seconds; a primitive that states none is given 10 minutes. Each call arms a `call_deadline` timer at that limit: when it fires, the task fails with a `communication` error of status 503, and the call is cut off. When the server stops while a nested execution runs, the call stays recorded and is performed again when the server starts, under the same id, since an execution that started and never finished runs again for its id.

### Events

A `listen` task waits for events sent to the running execution with `send_execution_event`, an operation of this package:

| Operation              | Kind    | Route                                    | Input                                                                                               | Answer                                              | Rejections                 |
| ---------------------- | ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------- |
| `send_execution_event` | command | `POST /executions/{execution_id}/events` | `execution_id`, `event` (`type`, and optional `source`, `subject`, `data` of at most 256 KiB, `id`) | `{ execution_id, event }`, with its `id` and `time` | `not_found`, `unavailable` |

An event waits in the workflow until a `listen` task takes it; an event with an id the workflow already received is ignored, so a call can be retried with the same id. A filter matches an event when every attribute it names equals the attribute of the event, or, for an attribute written as an expression, when the expression holds on it. `read: data` (the default) outputs the `data` of the events, `envelope` and `raw` the whole events.

## Execution and settling

`execute_spec` of a workflow spec starts the run of that execution and answers the execution `started`, with an empty record: the run's log is `runs/<execution id>` under the brain, and its first input carries the document, the input, the run's limits, a random seed and, as attributes, the org, the brain, the execution id, the spec and the caller. A start with the id of a run that is going answers the execution as it stands, so an execution started twice runs one workflow. A run never starts twice in one log, so a start with the id of a run that ended and settled its execution without a final result, `unavailable` or `failed`, is rejected with `conflict`; the workflow runs again under a new execution id. When the server is stopping, or the run's log keeps changing while the start is decided, the execution is rejected with `unavailable` and the fixed detail `The workflow cannot start now; try again shortly`; an event the run cannot take then answers `unavailable` with `The workflow cannot take the event now; try again shortly`.

When the run ends, its last event settles the execution through `executionSettler` of `@beonauto/specs`:

- **succeeded** with the output of the workflow, when it completes;
- **rejected** when an error is not caught: `invalid_input` for an error of a 4xx status other than 408 and 429 (the input led to it, and retrying the execution answers the same), and `unavailable` for every other status (a timeout, a failure to reach a spec, a server error: retrying the execution may succeed). The detail is the title or type, the detail and the instance of the error;
- **failed** when the run breaks down, when it has run `ORCHESTRATION_MAX_DURATION`, or when its output is larger than an execution records (1048574 bytes as JSON).

The settlement is handed out after the event that holds it is appended, and settling again with the same settlement records nothing, so a server that stops in between settles it when it starts again. A settlement the ledger refuses, such as one for a run that ended before its start recorded that the execution finishes later, is handed out again at every sweep, and after 20 failed attempts given up. An execution that cannot be settled, because the ledger has no such execution, it ended otherwise, or every attempt failed, stays `started` in the ledger: the server logs `An execution stays started because settling it failed` as an error with the org, the brain, the execution id and the reason, never the input or output. Reconciling such an execution is manual in this version.

Each run arms its deadline when it starts, at `ORCHESTRATION_MAX_DURATION` exactly: when it fires, the run cancels what is running and ends, and its execution settles `failed`. The machine's limits keep a run within what one event and one snapshot hold; the [engine's README](../../../packages/workflow-engine/README.md#limits) lists them, and [The work of expressions](#the-work-of-expressions) has its own.

### Determinism and replay

A run decides each input as a pure function of the input and its state: it reads no clock, no random source and no locale. Expressions get the time of the input; `localtime` and `strflocaltime`, which read the time zone of the host, are rejected; jitter draws from the run's seed. Each event of a run's log holds the change to the state as a JSON Patch, so loading a run applies patches and evaluates nothing, and a run started under one version of the machine loads under the next.

`input-logs/` of `@beonauto/orchestration` holds 15 paths as the workflow machine of `@beonauto/workflow-engine` runs them, each the inputs a run took and the events the machine decided: a call of `execute_spec` and a `set` (`execute-spec`), a `try` retried with backoff on timers (`retry-with-backoff`), a caught error that recovers through `catch.do` (`catch-do-recovery`), a `raise` nobody catches (`uncaught-error`), a `wait` (`timer`), a `for` loop that waits (`for-with-wait`), a fork (`parallel-fork`) and a fork that competes, cancelling the slower branch (`fork-compete`), a `listen` that takes events sent while it waits (`listen-signals`), a `timeout` that fires and is caught (`timeout-fires`), a `switch` (`switch`), a `then` that jumps back to an earlier task (`then-jump-back`), a cancelled run (`cancelled`), a run a new machine rebuilds from its log (`worker-restart`), and a run that reads the time, which comes only from its inputs (`temporal-global`). The names are those of the paths they were first recorded from. `src/input-logs/input-logs.test.ts` replays every log through the machine and expects exactly the events it recorded, and runs every path again and expects the log as committed. To record them again, deliberately, run `RECORD_INPUT_LOGS=1` with the tests.

## Running it

Every server runs workflows (`packages/server/src/workflows/workflows.ts`). The pieces it puts together:

- `openWorkflowHost(options)` of `@beonauto/workflow-host`, opened on the ledger's own database, with `orchestrationMachine`, the calls of `specCalls`, which execute a spec through the server's dispatcher as the caller who started the run (`specExecutionResultOf` turns its outcome into a result), `executionSettler` over the server's ledger, and reports to the server's log.
- `makeOrchestration({ runs, mostDurationMs, longestCallMs })`, the primitive for `makeSpecOperations`, and `defineSendExecutionEvent(runs)`, the brain operation `send_execution_event`.
- `runPresenter`, given with the presenters of the primitives, so a workflow's history and the brain's events show each input its run took.

The host runs in the server's process: it fires timers when they are due, sweeps every `ORCHESTRATION_SWEEP_INTERVAL`, and runs at most `ORCHESTRATION_NESTED_EXECUTIONS` calls at once. When the server stops, the host lets the decision in progress finish, cuts off the calls in flight, which start again when the server next starts, and closes its database. [Workflow operations](../self-host/workflows.md) describes it for an operator.

### What the server logs of its workflows

- at start-up, one line saying how long a run lasts at most, how many calls run at once and how often the runs are swept;
- a warning for each failure the host retries: a sweep that failed, a timer that could not fire, a call that could not record its answer or give it to its run, each with its cause cut at 2,000 characters;
- on PostgreSQL, a warning for a lost connection of the host's;
- an error for an execution a run could not settle, with its org, brain, execution id and reason.

A workflow that fails for a reason of its tenant, an uncaught error, a rejected nested execution or a limit, is not logged at all; its execution's rejection says why, and its history shows its steps.

### Memory

What a server spends on workflows is bounded by limits a tenant cannot raise:

- **Data a run holds at once**, at most 4 MiB, counted by the machine (`heldBytes`); a value held across a wait or a yield is bounded by the 1,572,864 bytes one event holds. A run that would hold more ends with a `runtime` error.
- **Events** (`send_execution_event`): each at most 256 KiB as JSON, its `type` and `id` at most 256 characters and its `source` and `subject` at most 1024. A run holds at most 64 events it has not consumed, and 1 MiB of them; it takes at most 1024 events, or 4 MiB of them as JSON, over its life. One more ends the run with a `runtime` error at once, whatever it is doing; its execution settles `rejected`, and later events are rejected as `not_found`.
- **Loaded runs**: the engine keeps at most 1,024 runs and 64 MiB of the data they hold between their inputs, letting go of the run used longest ago; a run it let go of is loaded again from its latest snapshot, at most about 5.3 MiB, and the events after it.
- **Compiled expressions** are kept in one cache for the process, holding at most 262,144 characters of expression source and letting go of the expression used longest ago. A compiled expression measured 22 to 34 bytes of heap for each character of its source, so the cache holds at most about 9 MiB; compiling one again took 10 to 150 µs.

Measured once with the arm64 image and no memory limit, the server took about 180 MiB idle. Requests to the API add what they carry (each body at most 1 MiB), and calls add what their primitives use, at most `ORCHESTRATION_NESTED_EXECUTIONS` (32) of them at once. To cap the resident size, give the container a memory limit, from which Node sizes its heap to about half of it, or set `--max-old-space-size` in `NODE_OPTIONS`.

### Settings

| Variable                          | Default | Purpose                                                                                              |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `ORCHESTRATION_MAX_DURATION`      | `P30D`  | The most a run may last, an ISO 8601 duration from `PT2H` to `P365D`; checked when the server starts |
| `ORCHESTRATION_NESTED_EXECUTIONS` | `32`    | How many calls of runs the server runs at once, from 1 to 1000; more wait until one ends             |
| `ORCHESTRATION_SWEEP_INTERVAL`    | `PT1S`  | How often the host sweeps the runs, an ISO 8601 duration from `PT0.01S` to `PT1M`                    |

### Tenancy

- A run is addressed by its org, its brain and its execution id, and its log is a stream under the brain's prefix of the ledger, where the brain's other records are.
- A call executes a spec in the org and brain of its run, for the caller who started the run, with the permissions that caller had then.
- There is no fairness between orgs and no limit for one: the calls of every org share the server's `ORCHESTRATION_NESTED_EXECUTIONS` slots, so one org's runs can take them all, and the others' calls wait.
- A run's log holds its document, its input, the outputs of the specs it executes and of the workflow, its events, and the identity of the caller who started it, in the ledger's database: tenant data is stored once, beside the brain's records, and is readable by whoever can read that database.

## Not in this version

Starting workflows from schedules or events, cancelling a run, `run`, `emit`, outbound calls, catalogs and functions beyond `execute_spec`, executing a workflow from a workflow (or any spec that finishes later), checking inputs and outputs against their schemas, listening `until` a condition, correlating events, and several servers on one database. A function is added by adding its name and the checks of its arguments to the functions the machine is given (`src/document/workflow-functions.ts`), and what a call of it does to the calls the host performs (`src/calls/spec-calls.ts`).
