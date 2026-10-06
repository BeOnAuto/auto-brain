# Workflow format and execution

The runtime stores workflows as `orchestration` specs and runs them on the workflow machine of `@beonauto/workflow-engine`, in the server, through `@beonauto/workflow-host`. Keep `orchestration` in API calls and MCP arguments.

The public [workflow format reference](../../reference/workflow-format.md) owns the document: its fields, tasks, flow, expressions and their variables, errors, retries, timeouts, events, limits and how a run ends, with examples recorded against this runtime. This page covers what the implementation adds: where each check runs, how expressions are metered, how calls, events and settling work on the host, and how the server runs and bounds its workflows.

## Checking a document

The spec operations read the YAML with `readYaml` of `@beonauto/config`, validate it against the DSL schema and its rules with `@openworkflowspec/sdk`, build its graph of tasks, and apply the policy of `@beonauto/workflow-engine` (`src/dsl/policy.ts`), given the functions of `src/document/workflow-functions.ts`. A document that nests task lists more than 64 levels deep, or any value more than 512, is rejected at the list or value that is too deep, before anything else is checked, and a workflow refuses to start with one however it was stored. A fork's 32 branches are checked when the document is stored and again when a workflow starts. A `wait` or a `timeout` written as a duration longer than `ORCHESTRATION_MAX_DURATION` is rejected when the document is stored, and one an expression computes longer fails the task that computes it with a `configuration` error.

When a workflow starts, the machine applies again only the policy's prohibitions, what this runtime does not allow at all: the tasks, calls, components, `schedule` and `listen` options the public reference lists as refused, executing another workflow, schemas that are not inline JSON Schema, and a DSL version other than 1.0.x. So a document that never went through the spec operations cannot use what the policy forbids. The other problems the spec operations reject, such as an expression that does not parse or uses `localtime`, a duration in years, or a `then` that names no task, are not checked again: they fail the task that has them when it runs.

### Expressions

Expressions are evaluated by `@gabrielbryk/jq-ts` inside the machine. `now` is the time of the input the run is deciding, recorded in its log, never the clock of the host.

### The work of expressions

Workflows of every org share the server's one thread, so no document may make it busy for long. Every operation of jq that builds or visits values charges, before it does so, the work of what it builds or visits, in units of one string character: a value, array item or object entry counts 16, copying an object entry 32, an evaluation step 128, a character encoded with a format or changed in case 16, a character searched for or in 4, a thread of the regex machine at a position 8. The count is deterministic, so the same input decides the same way; no clock is read.

- An expression may do 8000000 units. One that tries to do more stops at once, and the task fails with a `runtime` error of status 500; jq's `try` cannot catch it, and the workflow's `try` can.
- Pure tasks run one after another without waiting. Before a task, a run that has done 8000000 units of expression work, or run 100 tasks, in the input it is deciding lets other runs go: it arms a timer due at once and goes on when it fires. A task cannot pause in the middle, so a run fails with a `runtime` error once it has done 16000000 units in one input.
- A value the workflow holds, its input, the output of a task, its context and its output, may take at most 8000000 units to visit and nest at most 512 levels deep; a value counts a part it shares as often as it holds it, so doubling a value from task to task fails too. An execution with an input deeper than that is rejected with `invalid_input` before the workflow starts.

Measured on an Apple M-series machine, the expressions that do the most work per unit, run up to the budget, take at most about 30 ms and allocate at most about 25 MB (`@base64` of a 400000-character string); before the budget, `"x" * 40000000 | length` took 0.5 s and 0.8 GB, and `"a" * 200000 | indices("a" * 100000)` 2.5 s.

The count comes from a patch of `@gabrielbryk/jq-ts` 1.7.0 (`patches/@gabrielbryk__jq-ts@1.7.0.patch` at the root of the repository), which the library offers no hook for. It adds the `maxWork` limit and the `usage` it reports, charges the operations listed above, and replaces the library's string search, which in the engine's worst case takes time in proportion to the product of the two lengths, with the Knuth-Morris-Pratt search, linear in their sum. A new version of the library needs the patch ported, and `packages/workflow-engine/src/dsl/expression-work.test.ts` fails for any charge that goes missing.

### Executing a spec

`call: execute_spec` executes the active spec of that primitive and name in the same brain through the server's dispatcher, for the caller who started the run, and outputs its output; the public reference lists the errors a call raises. Retrying is the document's choice, with `try` and `catch.retry`: the run waits on durable timers between attempts. The server does not retry a call on its own; a call cut off when the server stopped is performed again when it starts.

Each run of a call is its own execution, with an id derived from the workflow's execution id, the reference of the task and how many times that task ran: a UUID version 5. A call performed again asks for the same execution id, so an execution that already has a final result is answered from the ledger and its model is not called again.

A call may run for the longest a nested execution may legitimately take and a minute more: the most `longestExecutionMs` the server's primitives state (see `@beonauto/specs`), which the server gives the run as its `longestCallMs`. For inference that is the deadline of a model call for the most output tokens, 60 seconds and 25 ms a token, 1660 seconds for 64000, so 1720 seconds; a primitive that states none is given 10 minutes. Each call arms a `call_deadline` timer at that limit: when it fires, the task fails with a `communication` error of status 503, and the call is cut off. When the server stops while a nested execution runs, the call stays recorded and is performed again when the server starts, under the same id, since an execution that started and never finished runs again for its id.

A call cancelled, by the timeout of its task, by its `call_deadline` or because its run ends, stops the nested execution: the host interrupts the fiber that performs the call, `inRuntime` (`packages/server/src/workflows/host-dependencies.ts`) passes the abort of that fiber to the application runtime's `run` as its signal, and the runtime interrupts the execution. A reason function then stops forwarding tool calls, cancels the ones in flight, which its MCP client tells each server with `notifications/cancelled`, ends its sessions and records its ending, `execution_failed`, with each call in flight started and never answered (`src/workflow-executions/workflow-tool-cancellation.test.ts` of the server).

### Events

`send_execution_event` (`src/events/send-execution-event.ts`) gives the run of that execution an `event_received` input, with the event's `id`, made when left out, and its `time`. It answers `not_found` when the brain has no run of that execution that is going, including one that ended, and `unavailable` when the run cannot take the event at that moment, because its log kept changing or the server is stopping. The public HTTP and format references describe the operation, its limits and how `listen` takes events.

## Execution and settling

`execute_spec` of a workflow spec starts the run of that execution and answers the execution `started`, with an empty record: the run's log is `runs/<execution id>` under the brain, and its first input carries the document, the input, the run's limits, a random seed and, as attributes, the org, the brain, the execution id, the spec and the caller. A start with the id of a run that is going answers the execution as it stands, so an execution started twice runs one workflow. A run never starts twice in one log, so a start with the id of a run that ended and settled its execution without a final result, `unavailable` or `failed`, is rejected with `conflict`; the workflow runs again under a new execution id. When the server is stopping, or the run's log keeps changing while the start is decided, the execution is rejected with `unavailable` and the fixed detail `The workflow cannot start now; try again shortly`; an event the run cannot take then answers `unavailable` with `The workflow cannot take the event now; try again shortly`.

When the run ends, its last event settles the execution through `executionSettler` of `@beonauto/specs`:

- **succeeded** with the output of the workflow, when it completes;
- **rejected** when an error is not caught: `invalid_input` for an error of a 4xx status other than 408 and 429 (the input led to it, and retrying the execution answers the same), and `unavailable` for every other status (a timeout, a failure to reach a spec, a server error: retrying the execution may succeed). The detail is the title or type, the detail and the instance of the error;
- **failed** when the run breaks down, when it has run `ORCHESTRATION_MAX_DURATION`, or when its output is larger than an execution records (1048574 bytes as JSON).

The settlement is handed out after the event that holds it is appended, and settling again with the same settlement records nothing, so a server that stops in between settles it when it starts again. A settlement the ledger refuses, such as one for a run that ended before its start recorded that the execution finishes later, or one the ledger cannot take while it cannot be reached, is handed out again at every sweep, and after 20 failed attempts once a minute, for ever, so a run is never left unsettled for want of a retry: the server warns once when the back-off begins, `An execution could not be settled in 20 attempts; it is tried again once a minute until it is`, and once when the execution is settled at last. Starting the execution again tries its settlement at once. An execution the ledger does not have, or one already settled otherwise, stays as it is: the server logs `An execution stays started because settling it failed` as an error with the org, the brain, the execution id and the reason, never the input or output.

Each run arms its deadline when it starts, at `ORCHESTRATION_MAX_DURATION` exactly: when it fires, the run cancels what is running and ends, and its execution settles `failed`. The machine's limits keep a run within what one event and one snapshot hold; the [engine's README](../../../packages/workflow-engine/README.md#limits) lists them, and [The work of expressions](#the-work-of-expressions) has its own.

### Determinism and replay

A run decides each input as a pure function of the input and its state: it reads no clock, no random source and no locale. Expressions get the time of the input; `localtime` and `strflocaltime`, which read the time zone of the host, are rejected; jitter draws from the run's seed. Each event of a run's log holds the change to the state as a JSON Patch, so loading a run applies patches and evaluates nothing, and a run started under one version of the machine loads under the next.

`input-logs/` of `@beonauto/orchestration` holds 15 paths as the workflow machine of `@beonauto/workflow-engine` runs them, each the inputs a run took and the events the machine decided: a call of `execute_spec` and a `set` (`execute-spec`), a `try` retried with backoff on timers (`retry-with-backoff`), a caught error that recovers through `catch.do` (`catch-do-recovery`), a `raise` nobody catches (`uncaught-error`), a `wait` (`timer`), a `for` loop that waits (`for-with-wait`), a fork (`parallel-fork`) and a fork that competes, cancelling the slower branch (`fork-compete`), a `listen` that takes events sent while it waits (`listen-signals`), a `timeout` that fires and is caught (`timeout-fires`), a `switch` (`switch`), a `then` that jumps back to an earlier task (`then-jump-back`), a cancelled run (`cancelled`), a run a new machine rebuilds from its log (`worker-restart`), and a run that reads the time, which comes only from its inputs (`temporal-global`). The names are those of the paths they were first recorded from. `src/input-logs/input-logs.test.ts` replays every log through the machine and expects exactly the events it recorded, and runs every path again and expects the log as committed. To record them again, deliberately, run `RECORD_INPUT_LOGS=1` with the tests.

## Running it

Every server runs workflows (`packages/server/src/workflows/workflows.ts`). The pieces it puts together:

- `openWorkflowHost(options)` of `@beonauto/workflow-host`, opened on the ledger's own database, with `orchestrationMachine`, the calls of `specCalls`, which execute a spec through the server's dispatcher as the caller who started the run (`specExecutionResultOf` turns its outcome into a result), `executionSettler` over the server's ledger, and reports to the server's log.
- `makeOrchestration({ runs, mostDurationMs, longestCallMs })`, the primitive for `makeSpecOperations`, and `defineSendExecutionEvent(runs)`, the brain operation `send_execution_event`.
- `runPresenter`, given with the presenters of the primitives, so a workflow's history and the brain's events show each input its run took.

The host runs in the server's process: it fires timers when they are due, sweeps every `ORCHESTRATION_SWEEP_INTERVAL`, and runs at most `ORCHESTRATION_NESTED_EXECUTIONS` calls at once. When the server stops, the host lets the starts and events it took and the decision in progress finish, then cuts off the calls in flight, which start again when the server next starts, lets go of its claim on the workflows, and closes its database. [Workflow operations](../self-host/workflows.md) describes it for an operator.

### What the server logs of its workflows

- at start-up, one line saying how long a run lasts at most, how many calls run at once and how often the runs are swept;
- a warning for each failure the host retries: a sweep that failed, a timer that could not fire, an answer of a call that could not be recorded or given to its run, and a claim on the workflows that could not be renewed, each with its cause cut at 2,000 characters;
- a warning when the server stands by because another server holds the claim on the workflows of its database, naming that server, and one when it takes the workflows over;
- a warning when the settlement of a run backs off to one attempt a minute, and one when that execution is settled at last;
- on PostgreSQL, a warning for a lost connection of the host's;
- an error for an execution a run could not settle because the ledger has no such execution or settled it otherwise before, with its org, brain, execution id and reason.

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

The public reference lists what a document may not use. The implementation also has no operation that cancels a run, and runs the workflows of a database in one server at a time. A function is added by adding its name and the checks of its arguments to the functions the machine is given (`src/document/workflow-functions.ts`), and what a call of it does to the calls the host performs (`src/calls/spec-calls.ts`).
